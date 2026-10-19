"use client";

import { ArrowDown, ArrowUp, CircleHelp, Eye, RotateCcw, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardData, BoardRow } from "@/lib/board";
import { APPLIED_STATUSES, LOCATION_FILTERS, ROLE_LABEL, ROLES, type LocationFilter } from "@/lib/constants";
import {
  DEFAULT_FILTERS,
  dimensionMatch,
  effectiveSort,
  FACETS,
  facetCounts,
  inView,
  isDefaultFilters,
  isNew,
  localToday,
  locMatch,
  payActive,
  pubActive,
  restoreFilters,
  secondaryCount,
  SORT_LABEL,
  VIEWS,
  type Filters,
  type SortId,
  type SortKey,
  type View,
} from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { BOTH_TRACKS, blockedOffers, coveredBy, crossTrack, hardRuleFor, ruleSummary } from "@/lib/limits";
import type { CompanyPolicy, CrawlRun, Kind, Status, Tracking, TrackingPatch } from "@/lib/types";
import CrawlControl from "./CrawlControl";
import { ActiveFilterBar, activeFilters, MorePanel, payLabel, PayPanel, pubLabel, PubPanel } from "./FilterControls";
import OffersTable, { type OfferRow } from "./OffersTable";
import { Dropdown, PayBadge, useToast } from "./ui";

const filtersKey = (board: string) => `application-board.filters.${board}`;
/** What each sort level groups by, to explain the levels below it */
const GROUP_NOUN: Partial<Record<SortId, string>> = {
  prio: "priority",
  co: "company tier",
  fit: "fit level",
  elig: "eligibility level",
  published: "publication day",
};
const EMPTY: Tracking = { status: "", interested: false, notes: "", updatedAt: null };

export default function BoardApp({ data }: { data: BoardData }) {
  const locFilters = LOCATION_FILTERS as unknown as [LocationFilter, string][];
  const [tracking, setTracking] = useState(data.tracking);
  const [policies, setPolicies] = useState(data.policies);
  const [newSeenAt, setNewSeenAt] = useState(data.newSeenAt);
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  const policiesRef = useRef(policies);
  policiesRef.current = policies;
  useEffect(() => {
    setTracking(data.tracking);
    setPolicies(data.policies);
    setNewSeenAt((prev) => (prev && data.newSeenAt && prev > data.newSeenAt ? prev : data.newSeenAt));
  }, [data]);

  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  // Rows you edit stay visible until you change filters, so they don't vanish under the cursor
  const [sticky, setSticky] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useToast();
  // Rows ticked for a bulk action; cleared whenever the view or the filters change
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(filtersKey(data.board)) ?? "null");
      if (saved && typeof saved === "object") {
        const locs: string[] = LOCATION_FILTERS.map(([k]) => k);
        const restored = restoreFilters(saved, locs);
        setF(restored);
        setQuery(restored.q);
      }
    } catch {}
    // Links like /?q=Jane%20Street (from an offer page) open the board searching that company, in every view
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setQuery(q);
      setF((prev) => ({ ...prev, q: q.toLowerCase(), view: "all" }));
      window.history.replaceState(null, "", window.location.pathname);
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(filtersKey(data.board), JSON.stringify(f));
    } catch {}
  }, [f, loaded]);

  const set = useCallback((patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setSticky(new Set());
    setSelected(new Set());
    setConfirmBulk(false);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => set({ q: query.trim().toLowerCase() }), 150);
    return () => clearTimeout(t);
  }, [query, set]);

  // ---------- "New": each new offer stays new until you open it or mark it as seen

  const freshIds = useMemo(
    () => new Set(data.rows.filter((r) => isNew(r, newSeenAt, tracking[r.id]?.seenAt)).map((r) => r.id)),
    [data.rows, newSeenAt, tracking],
  );

  // ---------- derived rows

  // Dates in "Published" are compared with today in your time zone
  const today = useMemo(() => localToday(), []);

  // Limits count everything you applied to
  const allOffers = useMemo(() => [...data.rows, ...data.others], [data.rows, data.others]);
  const blocked = useMemo(() => blockedOffers(allOffers, tracking, policies), [allOffers, tracking, policies]);
  const dimRows = useMemo(() => data.rows.filter((r) => dimensionMatch(r, f, tracking[r.id], today)), [data.rows, f, tracking, today]);
  const member = useCallback(
    (view: View, r: (typeof data.rows)[number]) =>
      inView(view, r, tracking[r.id], {
        blocked: blocked.has(r.id),
        isNew: freshIds.has(r.id),
        hideNo: f.hideNo,
        lowFit: f.lowFit,
      }),
    [tracking, blocked, f.hideNo, f.lowFit, freshIds],
  );
  const viewCounts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.id, dimRows.filter((r) => locMatch(r, f.loc) && member(v.id, r)).length])) as Record<View, number>,
    [dimRows, f.loc, member],
  );
  const regionCounts = useMemo(
    () => Object.fromEntries(locFilters.map(([k]) => [k, dimRows.filter((r) => locMatch(r, k) && member(f.view, r)).length])),
    [dimRows, f.view, member],
  );
  const roleCounts = useMemo(() => {
    const base = data.rows.filter((r) => dimensionMatch(r, f, tracking[r.id], today, "roles") && locMatch(r, f.loc) && member(f.view, r));
    return Object.fromEntries(ROLES.map((role) => [role, base.filter((r) => r.role === role).length]));
  }, [data.rows, f, member, tracking, today]);
  // What each option of the choice filters would show, in this view and region
  const facets = useMemo(
    () => facetCounts(data.rows.filter((r) => locMatch(r, f.loc) && member(f.view, r)), f, tracking, today),
    [data.rows, f, member, tracking, today],
  );

  // Offers of the other kind (internship / graduate) you already applied to, per company
  const appliedByCompany = useMemo(() => {
    const m = new Map<string, { kind: Kind; title: string }[]>();
    for (const r of allOffers) {
      if (!APPLIED_STATUSES.has(tracking[r.id]?.status ?? "")) continue;
      m.set(r.company, [...(m.get(r.company) ?? []), { kind: r.kind, title: r.title }]);
    }
    return m;
  }, [allOffers, tracking]);
  const crossFor = useCallback(
    (r: BoardRow) => {
      const s = tracking[r.id]?.status ?? "";
      if (s !== "" && s !== "preparing") return null;
      const others = (appliedByCompany.get(r.company) ?? []).filter((x) => x.kind !== r.kind || BOTH_TRACKS.test(x.title));
      if (!others.length) return null;
      const titles = others.map((x) => x.title);
      return { ...(coveredBy(titles) ?? crossTrack(policies[r.company], r.kind)), appliedTo: titles };
    },
    [appliedByCompany, tracking, policies],
  );

  const rows: OfferRow[] = useMemo(
    () =>
      dimRows
        .filter((r) => (sticky.has(r.id) && !tracking[r.id]?.trashed) || (locMatch(r, f.loc) && member(f.view, r)))
        .map((r) => ({
          ...r,
          track: tracking[r.id],
          block: blocked.get(r.id),
          limit: hardRuleFor(policies[r.company], r.kind),
          cross: crossFor(r),
          fresh: freshIds.has(r.id),
        })),
    [dimRows, sticky, f.loc, f.view, member, tracking, blocked, policies, freshIds, crossFor],
  );

  const pickedIds = useMemo(() => rows.filter((r) => selected.has(r.id)).map((r) => r.id), [rows, selected]);

  // ---------- edits

  /** Tells you what the company's rule means now that you applied: how many offers it moves to the Archive. */
  const announceLimit = useCallback(
    (company: string, policy: CompanyPolicy | undefined, before: Record<string, Tracking>, after: Record<string, Tracking>) => {
      const policiesNow = policy ? { ...policiesRef.current, [company]: policy } : policiesRef.current;
      const was = blockedOffers(allOffers, before, policiesRef.current);
      const now = blockedOffers(allOffers, after, policiesNow);
      const newly = [...now.entries()].filter(([id]) => {
        const r = data.rows.find((x) => x.id === id);
        return !was.has(id) && r?.company === company && r.active && !after[id]?.trashed;
      });
      const p = policiesNow[company];
      // The kind you just applied to, and whether the company still has open offers of the other kind
      const justApplied = data.rows.find((r) => r.company === company && APPLIED_STATUSES.has(after[r.id]?.status ?? "") && !APPLIED_STATUSES.has(before[r.id]?.status ?? ""));
      const otherOpen = justApplied
        ? data.rows.filter((r) => r.company === company && r.kind !== justApplied.kind && r.active && r.elig !== "no" && !after[r.id]?.trashed && !APPLIED_STATUSES.has(after[r.id]?.status ?? ""))
        : [];
      const cross = otherOpen.length ? ` ${otherOpen[0].kind === "intern" ? "Internship" : "New grad"} (${otherOpen.length} open): ${crossTrack(p, otherOpen[0].kind).text}` : "";
      if (newly.length) {
        setToast(`${company}: ${ruleSummary(newly[0][1].rule).toLowerCase()}. ${newly.length} offer${newly.length > 1 ? "s move" : " moves"} to the Archive.${cross}`);
      } else if (p?.status === "found" && p.rules.length) {
        setToast(`${company}: ${p.rules.map(ruleSummary).join(" · ")}.${cross}`);
      } else if (p) {
        setToast(`${company}: ${p.note ?? "no application limit found"}${cross}`);
      }
    },
    [data.rows, allOffers, setToast],
  );

  const waitForPolicy = useCallback(
    async (company: string, before: Record<string, Tracking>, after: Record<string, Tracking>) => {
      const checked = policiesRef.current[company]?.checkedAt;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const c = await fetch(`/api/companies/${encodeURIComponent(company)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
        if (c?.policy && c.policy.checkedAt !== checked) {
          announceLimit(company, c.policy, before, after);
          setPolicies((p) => ({ ...p, [company]: c.policy }));
          return;
        }
      }
    },
    [announceLimit],
  );

  const onPatch = useCallback(
    async (id: string, patch: TrackingPatch) => {
      const before = trackingRef.current;
      const prev = before[id];
      setTracking({ ...before, [id]: { ...EMPTY, ...prev, ...patch } as Tracking });
      setSticky((s) => {
        const n = new Set(s);
        if (patch.trashed === undefined) n.add(id);
        else n.delete(id);
        return n;
      });
      try {
        const res = await fetch(`/api/applications/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(await res.text());
        const out: { tracking: Tracking; company: string; policyCheck: "started" | "known" | null } = await res.json();
        const after = { ...trackingRef.current, [id]: out.tracking };
        setTracking(after);
        if (patch.trashed === true) {
          setToast({ text: "Moved to the trash.", action: { label: "Undo", onClick: () => onPatchRef.current(id, { trashed: false }) } });
        } else if (patch.trashed === false) {
          setToast("Restored: it is back in its usual view.");
        } else if (out.policyCheck === "started") {
          setToast(`Applied. Checking how many applications ${out.company} accepts…`);
          waitForPolicy(out.company, before, after);
        } else if (out.policyCheck === "known") {
          announceLimit(out.company, undefined, before, after);
        }
      } catch {
        setTracking((t) => {
          const n = { ...t };
          if (prev) n[id] = prev;
          else delete n[id];
          return n;
        });
        setToast("The change could not be saved");
      }
    },
    [announceLimit, setToast, waitForPolicy],
  );
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  const onSelect = useCallback((ids: string[], checked: boolean) => {
    setConfirmBulk(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  /** Moves the selected offers to the trash (or back), in one write, with undo. */
  const bulkTrash = useCallback(
    async (ids: string[], trashed: boolean, undo = true) => {
      if (!ids.length) return;
      const before = trackingRef.current;
      setTracking((t) => {
        const n = { ...t };
        for (const id of ids) n[id] = { ...EMPTY, ...t[id], trashed, trashedAt: trashed ? new Date().toISOString() : null };
        return n;
      });
      setSelected(new Set());
      setConfirmBulk(false);
      try {
        const res = await fetch("/api/applications/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, trashed }) });
        if (!res.ok) throw new Error(await res.text());
        const out: { tracking: Record<string, Tracking> } = await res.json();
        setTracking((t) => ({ ...t, ...out.tracking }));
        const n = ids.length;
        const text = trashed ? `${n} offer${n > 1 ? "s" : ""} moved to the trash.` : `${n} offer${n > 1 ? "s" : ""} restored.`;
        setToast(undo ? { text, action: { label: "Undo", onClick: () => bulkTrashRef.current(ids, !trashed, false) } } : text);
      } catch {
        setTracking(before);
        setToast("The change could not be saved");
      }
    },
    [setToast],
  );
  const bulkTrashRef = useRef(bulkTrash);
  bulkTrashRef.current = bulkTrash;

  /** Marks offers as seen (they leave "New"), or back to new from the undo. */
  const setSeen = useCallback(
    async (ids: string[], seen: boolean, undo = true) => {
      if (!ids.length) return;
      const before = trackingRef.current;
      const now = new Date().toISOString();
      setTracking((t) => {
        const n = { ...t };
        for (const id of ids) n[id] = { ...EMPTY, ...t[id], seenAt: seen ? (t[id]?.seenAt ?? now) : null };
        return n;
      });
      setSelected(new Set());
      setConfirmBulk(false);
      try {
        const res = await fetch("/api/applications/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, seen }) });
        if (!res.ok) throw new Error(await res.text());
        const out: { tracking: Record<string, Tracking> } = await res.json();
        setTracking((t) => ({ ...t, ...out.tracking }));
        const n = ids.length;
        const text = seen ? `${n} offer${n > 1 ? "s" : ""} marked as seen.` : `${n} offer${n > 1 ? "s are" : " is"} back in New.`;
        setToast(undo ? { text, action: { label: "Undo", onClick: () => setSeenRef.current(ids, !seen, false) } } : text);
      } catch {
        setTracking(before);
        setToast("The change could not be saved");
      }
    },
    [setToast],
  );
  const setSeenRef = useRef(setSeen);
  setSeenRef.current = setSeen;

  const onCrawlDone = useCallback(
    (run: CrawlRun) => {
      if (!run.ok) return setToast(`The search failed: ${run.error ?? "unknown error"}`);
      // Offers that were already published before the previous search are added, but are not new
      const fresh = run.fresh ?? run.added.length;
      const old = run.added.length - fresh;
      const text = `Search finished: ${fresh} new${old > 0 ? ` (and ${old} already published before, which do not count as new)` : ""}${run.closed ? `, ${run.closed} closed` : ""}.`;
      setToast(fresh ? { text, action: { label: "See new ones", onClick: () => set({ view: "new", sort: [{ id: "posted", desc: true }] }) } } : text);
    },
    [setToast, set],
  );

  const toggleRole = (role: string) => {
    const all = f.roles.length === ROLES.length;
    if (all) return set({ roles: [role] });
    if (f.roles.includes(role)) {
      const next = f.roles.filter((x) => x !== role);
      return set({ roles: next.length ? next : ROLES });
    }
    set({ roles: [...f.roles, role] });
  };

  const rolesLabel =
    f.roles.length === ROLES.length
      ? "All roles"
      : f.roles.length <= 2
        ? f.roles.map((r) => ROLE_LABEL[r]).join(", ")
        : `${ROLE_LABEL[f.roles[0]]} +${f.roles.length - 1}`;
  const extraFilters = secondaryCount(f);
  const isDefault = isDefaultFilters(f);
  const activeList = activeFilters(f, f.loc === "all" ? null : (locFilters.find(([k]) => k === f.loc)?.[1] ?? null));
  const paySrcLabel = FACETS.paySrc.options
    .filter(([k]) => (f.paySrc as string[]).includes(k))
    .map(([, l]) => l.toLowerCase())
    .join(" o ");
  const clearFilter = (patch: Partial<Filters>) => {
    if ("q" in patch) setQuery("");
    set(patch);
  };
  const unseen = viewCounts.new;
  const showNew = () => set({ view: "new", sort: [{ id: "posted", desc: true }] });

  const notice =
    f.view === "new" && rows.length ? (
      <p className="table-notice">
        They stay here until you open each one or mark them as seen (select them and "Mark as seen").{" "}
        <button type="button" className="link-btn" onClick={() => setSeen(rows.map((r) => r.id), true)}>
          Mark all {rows.length.toLocaleString("en-US")} as seen
        </button>
      </p>
    ) : f.view === "trash" && rows.length ? (
      <p className="table-notice">Offers you removed. Restore them with the button on the right; they go back to their usual view.</p>
    ) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Applications 2027</h1>
          <nav className="nav" aria-label="Sections">
            <Link href="/visas">Visas</Link>
            <a href="/api/cv/quant" target="_blank" rel="noopener">
              CV Quant
            </a>
            <a href="/api/cv/swe" target="_blank" rel="noopener">
              CV SWE
            </a>
            <Dropdown label={<><CircleHelp size={15} aria-hidden /> How to read it</>}>
              <Legend cv={data.cv} />
            </Dropdown>
          </nav>
        </div>
        <CrawlControl board={data.board} lastRun={data.lastCrawl} onDone={onCrawlDone} unseen={f.view === "new" ? 0 : unseen} onShowNew={showNew} />
      </header>

      <div className="controls">
        <div className="views-row">
          <div className="tabs" role="tablist" aria-label="Views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={f.view === v.id}
                data-unread={(v.id === "new" && f.view !== "new" && viewCounts.new > 0) || undefined}
                title={v.hint}
                onClick={() =>
                  set({ view: v.id, sort: v.id === "new" ? [{ id: "posted", desc: true }] : f.view === "new" ? DEFAULT_FILTERS.sort : f.sort })
                }
              >
                {v.label}
                <span className="count">{viewCounts[v.id].toLocaleString("en-US")}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company, role or city" aria-label="Search" />
          </label>
        </div>

        <div className="filter-row">
          <div className="seg" role="radiogroup" aria-label="Region">
            {locFilters.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={f.loc === k} onClick={() => set({ loc: k })}>
                {label}
                <span className="count">{regionCounts[k]}</span>
              </button>
            ))}
          </div>
          <select className="seg-select" value={f.loc} onChange={(e) => set({ loc: e.target.value as LocationFilter })} aria-label="Region">
            {locFilters.map(([k, label]) => (
              <option key={k} value={k}>
                {label} ({regionCounts[k]})
              </option>
            ))}
          </select>

          <Dropdown label={rolesLabel} active={f.roles.length !== ROLES.length}>
            <div className="menu" role="group" aria-label="Roles">
              {ROLES.map((role) => (
                <div key={role} className="menu-item">
                  <label>
                    <input type="checkbox" checked={f.roles.includes(role)} onChange={() => toggleRole(role)} />
                    <span>{ROLE_LABEL[role]}</span>
                  </label>
                  <span className="count">{roleCounts[role]}</span>
                  <button type="button" className="link-btn" onClick={() => set({ roles: [role] })} aria-label={`Only ${ROLE_LABEL[role]}`}>
                    only
                  </button>
                </div>
              ))}
              <button type="button" className="menu-foot link-btn" onClick={() => set({ roles: ROLES })} disabled={f.roles.length === ROLES.length}>
                All roles
              </button>
            </div>
          </Dropdown>

          <Dropdown label={`Pay${payActive(f) ? ` ${payLabel(f)}` : ""}${paySrcLabel ? ` · ${paySrcLabel}` : ""}`} active={payActive(f) || f.paySrc.length > 0}>
            <PayPanel f={f} set={set} counts={facets.counts} />
          </Dropdown>

          <Dropdown label={pubActive(f) ? `Published: ${pubLabel(f).toLowerCase()}` : "Published"} active={pubActive(f)}>
            <PubPanel f={f} set={set} undated={facets.undated} today={today} />
          </Dropdown>

          <Dropdown label="More filters" badge={extraFilters} active={extraFilters > 0}>
            <MorePanel f={f} set={set} counts={facets.counts} />
          </Dropdown>

          <span className="filter-spacer" />
          {pickedIds.length > 0 ? (
            <div className="bulk" role="region" aria-label="Actions on the selection">
              <span className="bulk-count">
                {pickedIds.length} selected
              </span>
              {f.view !== "trash" && pickedIds.some((id) => freshIds.has(id)) && !confirmBulk && (
                <button type="button" className="btn btn-xs" onClick={() => setSeen(pickedIds.filter((id) => freshIds.has(id)), true)}>
                  <Eye size={14} aria-hidden /> Mark as seen
                </button>
              )}
              {f.view === "trash" ? (
                <button type="button" className="btn btn-xs" onClick={() => bulkTrash(pickedIds, false)}>
                  <RotateCcw size={14} aria-hidden /> Restore
                </button>
              ) : confirmBulk ? (
                <>
                  <span className="bulk-ask">Move {pickedIds.length} to the trash?</span>
                  <button type="button" className="btn btn-danger btn-xs" autoFocus onClick={() => bulkTrash(pickedIds, true)}>
                    Yes, move
                  </button>
                  <button type="button" className="btn btn-xs" onClick={() => setConfirmBulk(false)}>
                    No
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-xs" onClick={() => setConfirmBulk(true)}>
                  <Trash2 size={14} aria-hidden /> Move to the trash
                </button>
              )}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setSelected(new Set());
                  setConfirmBulk(false);
                }}
              >
                Clear selection
              </button>
            </div>
          ) : (
            <span className="result-count">
              {rows.length.toLocaleString("en-US")} offer{rows.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <ActiveFilterBar
        items={activeList}
        onClear={clearFilter}
        onClearAll={() => {
          setQuery("");
          set({ ...DEFAULT_FILTERS, view: f.view, sort: f.sort });
        }}
      />
      {f.sort.length > 0 && <SortBar sort={f.sort} onSort={(sort) => set({ sort })} />}

      <OffersTable
        rows={rows}
        sort={f.sort}
        onSort={(sort: SortKey[]) => set({ sort })}
        onPatch={onPatch}
        trashView={f.view === "trash"}
        notice={notice}
        selected={selected}
        onSelect={onSelect}
        empty={
          f.view === "new" ? (
            <>
              <p>No new offers since your last visit.</p>
              <p className="muted">Press "Search offers" at the top right to search the trackers.</p>
            </>
          ) : f.view === "trash" ? (
            <p>The trash is empty.</p>
          ) : (
            <>
              <p>No offers in "{VIEWS.find((v) => v.id === f.view)?.label}" with these filters.</p>
              {!isDefault && <p className="muted">Try removing filters or switching views.</p>}
            </>
          )
        }
      />
      {toast}
    </div>
  );
}

function Legend({ cv }: { cv: BoardData["cv"] }) {
  return (
    <div className="legend">
      <dl>
        <dt>Priority</dt>
        <dd>
          <b>A</b> first (preferred city or EU, eligible, good fit and pay), then <b>B</b>; <b>C</b> for volume. <b>No</b>: you cannot apply. <b>Sent</b>: already sent.
        </dd>
        <dt>Fit</dt>
        <dd>From 1 to 5, computed with your PDF CVs: role, technical requirements you meet, years of experience, languages and the degree the posting asks for.</dd>
        <dt>Pay</dt>
        <dd>
          <PayBadge source="posted" /> published by the posting itself. <PayBadge source="tracker" /> given by the tracker, not the posting. <PayBadge source="estimate" />{" "}
          approximate (≈, in grey): from the company&apos;s pay level, the city and the type of role. No bonus.
        </dd>
        <dt>No cover letter</dt>
        <dd>
          Its application form has no field for a cover letter; <b>Cover letter required</b> if it requires one. Only known for Greenhouse, Ashby, Lever and Workable: the
          rest show nothing.
        </dd>
        <dt>Eligible</dt>
        <dd>Checked against the posting&apos;s text and your graduation date (from your CV).</dd>
        <dt>Visa</dt>
        <dd>
          Green: no visa. Amber: the company handles it. Red: H-1B. <b>+EU</b>: one of its cities needs no visa.
        </dd>
        <dt>Max. N</dt>
        <dd>
          The company limits applications. When you mark one as applied its rule is checked and the others move to the Archive (<b>Limit used</b>; <b>Already counts</b> if
          one application covers all its roles; <b>Waiting period</b> if you did their OA or an interview and they ask you to wait).
        </dd>
        <dt>Applied as intern / new grad</dt>
        <dd>You already applied to the other type at that company, and whether they can be combined: Allowed, Better 1, Only 1 in total, Already counts, Careful: OA (doing the OA for one blocks the other) or Unknown.</dd>
        <dt>New</dt>
        <dd>Found by the crawler. They stay new until you open them or mark them as seen.</dd>
        <dt>Your CV</dt>
        <dd>
          {cv.map((c) => (
            <span key={c.kind} className="cv-status">
              {c.kind === "quant" ? "Quant" : "SWE"}: {c.ok ? `read (${c.skills} skills), modified on ${fmtDate(c.modifiedAt.slice(0, 10))}` : c.error}
            </span>
          ))}
        </dd>
      </dl>
    </div>
  );
}

/** The sort levels in effect, each removable, with what the lower levels mean ("within each priority"). */
function SortBar({ sort, onSort }: { sort: SortKey[]; onSort: (s: SortKey[]) => void }) {
  const levels = effectiveSort(sort);
  const reordered = levels.some((k, i) => k.id !== sort[i]?.id);
  const within = levels
    .slice(1)
    .map((k, i) => (GROUP_NOUN[levels[i].id] ? `${SORT_LABEL[k.id].toLowerCase()} within each ${GROUP_NOUN[levels[i].id]}` : null))
    .filter(Boolean);
  return (
    <div className="sort-bar" role="group" aria-label="Table order">
      <span className="sort-bar-label">Sort</span>
      {levels.map((k, i) => (
        <span key={k.id} className="sort-chip">
          {i > 0 && (
            <span className="sort-sep" aria-hidden>
              ›
            </span>
          )}
          <button type="button" className="sort-chip-dir" onClick={() => onSort(sort.map((x) => (x.id === k.id ? { ...x, desc: !x.desc } : x)))} title="Reverse the order">
            {SORT_LABEL[k.id]} {k.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />}
          </button>
          <button type="button" className="sort-chip-x" onClick={() => onSort(sort.filter((x) => x.id !== k.id))} aria-label={`Remove ${SORT_LABEL[k.id]} from the sort`}>
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      {within.length > 0 && <span className="sort-bar-note">{within.join(" · ")}</span>}
      {reordered && <span className="sort-bar-note">(pay goes after the grouping columns)</span>}
      <button type="button" className="link-btn" onClick={() => onSort([])}>
        Default order
      </button>
    </div>
  );
}
