"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingFn,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoardRow } from "@/lib/board";
import { APPLIED_STATUSES, ELIGIBILITY_LABEL, ELIGIBILITY_ORDER, GONE_REASON, KIND_LABEL, PREFERRED_REGIONS, PRESTIGE_ORDER, PRIORITY_ORDER, ROLE_LABEL } from "@/lib/constants";
import { clickSort, effectiveSort, SORT_LABEL, type SortId, type SortKey } from "@/lib/filters";
import { longDate, shortDate } from "@/lib/format";
import { ruleSummary, type Block, type CrossTrack } from "@/lib/limits";
import type { PolicyRule, Status, Tracking } from "@/lib/types";
import { VISAS } from "@/lib/visa";
import { Dots, PayBadge, RestoreButton, StarButton, StatusSelect, TrashButton } from "./ui";

export interface OfferRow extends BoardRow {
  track: Tracking | undefined;
  block: Block | undefined;
  limit: PolicyRule | null;
  /** You already applied to the other kind (internship / graduate) at this company: whether this one can be added */
  cross: (CrossTrack & { appliedTo: string[] }) | null;
  /** Not seen yet in "New" */
  fresh: boolean;
}

const ROW_H = 58;
const COLUMN_VISIBILITY = { posted: false, tieName: false, tiePrio: false, tieScore: false };
const SCROLL_KEY = "application-board.scroll";

const by = <T,>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
// Each column compares only its own value, so the next sort level applies within its groups;
// the hidden "tie" columns break the remaining ties (company name, priority, score).
const prioSort: SortingFn<OfferRow> = (a, b) => by(PRIORITY_ORDER[a.original.priority], PRIORITY_ORDER[b.original.priority]);
/** Company tier: prestige S → C, then pay level */
const tierSort: SortingFn<OfferRow> = (a, b) => by(PRESTIGE_ORDER[a.original.prestige], PRESTIGE_ORDER[b.original.prestige]) || b.original.payTier - a.original.payTier;
const paySort: SortingFn<OfferRow> = (a, b) => a.original.pay.annualUsd - b.original.pay.annualUsd;
const fitSort: SortingFn<OfferRow> = (a, b) => a.original.fit - b.original.fit;
const postedSort: SortingFn<OfferRow> = (a, b) => by(a.original.firstSeenAt ?? a.original.postedAt ?? "", b.original.firstSeenAt ?? b.original.postedAt ?? "");
const eligSort: SortingFn<OfferRow> = (a, b) => by(ELIGIBILITY_ORDER[a.original.elig], ELIGIBILITY_ORDER[b.original.elig]);
/** By publication day; offers without a date go after the dated ones */
const publishedSort: SortingFn<OfferRow> = (a, b) => by(a.original.published?.date ?? "", b.original.published?.date ?? "");
const nameSort: SortingFn<OfferRow> = (a, b) => by(a.original.company.toLowerCase(), b.original.company.toLowerCase());
const scoreSort: SortingFn<OfferRow> = (a, b) => a.original.score - b.original.score;

function age(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(`${iso}T00:00:00`)) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

const ELIG_SHORT = { ok: "Eligible", maybe: "Check", warn: "Unlikely", no: "No" } as const;
const SORT_HINT: Partial<Record<string, string>> = {
  prio: "Sort by priority (A, B, C)",
  co: "Sort by company tier (S, A, B, C and pay level)",
  pay: "Sort by pay (yearly equivalent)",
  fit: "Sort by fit with your CV",
  published: "Sort by publication date (undated last)",
  elig: "Sort by eligibility",
};

function prioBadge(r: OfferRow) {
  const s = r.track?.status ?? "";
  if (APPLIED_STATUSES.has(s) || r.priority === "X") return { cls: "X", txt: "Sent" };
  if (r.priority === "D") return { cls: "D", txt: "No" };
  return { cls: r.priority, txt: r.priority };
}

export default function OffersTable({
  rows,
  sort,
  onSort,
  onPatch,
  trashView,
  empty,
  notice,
  selected,
  onSelect,
}: {
  rows: OfferRow[];
  /** Sort levels as you picked them (empty = by priority) */
  sort: SortKey[];
  onSort: (s: SortKey[]) => void;
  onPatch: (id: string, patch: { status?: Status; interested?: boolean; trashed?: boolean }) => void;
  trashView: boolean;
  empty: React.ReactNode;
  notice?: React.ReactNode;
  selected: Set<string>;
  onSelect: (ids: string[], checked: boolean) => void;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<Table<OfferRow> | null>(null);
  const lastPicked = useRef<string | null>(null);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selected.has(r.id));

  /** Shift-click selects the range from the last row you ticked, in the order you are looking at. */
  const pick = (id: string, checked: boolean, shift: boolean) => {
    const order = tableRef.current?.getRowModel().rows.map((r) => r.id) ?? [];
    const from = lastPicked.current ? order.indexOf(lastPicked.current) : -1;
    const to = order.indexOf(id);
    if (shift && from >= 0 && to >= 0) onSelect(order.slice(Math.min(from, to), Math.max(from, to) + 1), checked);
    else onSelect([id], checked);
    lastPicked.current = id;
  };

  const columns = useMemo<ColumnDef<OfferRow>[]>(
    () => [
      {
        id: "sel",
        size: 36,
        enableSorting: false,
        header: () => (
          <input
            type="checkbox"
            className="sel"
            aria-label="Select every offer in this view"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => onSelect(rows.map((r) => r.id), e.target.checked)}
          />
        ),
        cell: ({ row: { original: r } }) => (
          <input
            type="checkbox"
            className="sel"
            aria-label={`Seleccionar ${r.company} ${r.title}`}
            checked={selected.has(r.id)}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              pick(r.id, (e.target as HTMLInputElement).checked, e.shiftKey);
            }}
          />
        ),
      },
      {
        id: "prio",
        accessorFn: (r) => r.score,
        header: "Prio",
        size: 52,
        sortingFn: prioSort,
        cell: ({ row: { original: r } }) => {
          const b = prioBadge(r);
          return (
            <span className={`pr pr-${b.cls}`} title={`Priority ${r.priority} · score ${r.score}`}>
              {b.txt}
            </span>
          );
        },
      },
      {
        id: "star",
        header: () => <span className="sr-only">Starred</span>,
        size: 38,
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <StarButton on={!!r.track?.interested} label={`${r.company} ${r.title}`} onToggle={() => onPatch(r.id, { interested: !r.track?.interested })} />
        ),
      },
      {
        id: "co",
        accessorFn: (r) => r.company,
        header: "Company",
        size: 158,
        sortingFn: tierSort,
        cell: ({ row: { original: r } }) => (
          <div className="stack">
            <span className="co">
              <span className="co-name">{r.company}</span>
              <span className={`pre pre-${r.prestige}`} title={`Tier ${r.prestige} · pay ${r.payTier}/5`}>
                {r.prestige}
              </span>
            </span>
            <span className="sub">{r.sector}</span>
          </div>
        ),
      },
      {
        id: "title",
        header: "Role",
        size: 212,
        meta: { grow: true },
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <div className="stack">
            <span className="title-co">{r.company}</span>
            <Link href={`/offers/${r.id}`} className="ttl" onClick={(e) => e.stopPropagation()}>
              {r.title}
            </Link>
            <span className="tags">
              {r.fresh && <span className="tag tag-new">New</span>}
              <span className={`tag tag-${r.kind}`}>{KIND_LABEL[r.kind]}</span>
              <span className="tag">{ROLE_LABEL[r.role] ?? r.role}</span>
              {r.stale && r.published && (
                <span className="tag tag-old" title={`Published on ${longDate(r.published.date)}: from another cycle or a permanent opening. That is why it is in the Archive and not in "To apply".`}>
                  Old
                </span>
              )}
              {r.cover?.state === "none" && (
                <span className="tag tag-nocover" title={`Its application form (${r.cover.from}) has no field for a cover letter`}>
                  No cover letter
                </span>
              )}
              {r.cover?.state === "required" && (
                <span className="tag tag-cover-req" title={`Its application form (${r.cover.from}) requires a cover letter`}>
                  Cover letter required
                </span>
              )}
              {!r.active && (
                <span className="tag tag-closed" title={r.closedReason ? `Cerrada: ${r.closedReason}` : undefined}>
                  {r.closedReason === GONE_REASON ? "Retirada" : "Cerrada"}
                </span>
              )}
              {r.block ? (
                <span className="tag tag-limit" title={`${ruleSummary(r.block.rule)}. ${r.block.rule.kind === "cooldown" ? "You did the OA or an interview for" : "You already sent"}: ${r.block.appliedTo.map((x) => x.title).join(", ")}`}>
                  <Lock size={11} aria-hidden /> {r.block.rule.kind === "linked" ? "Already counts" : r.block.rule.kind === "cooldown" ? "Waiting period" : "Limit used"}
                </span>
              ) : r.cross ? (
                <span className="tag tag-cross" data-verdict={r.cross.verdict} title={`You already applied here to: ${r.cross.appliedTo.join(", ")}. ${r.cross.text}`}>
                  {r.kind === "intern" ? "Applied as new grad" : "Applied as intern"} · {r.cross.label}
                </span>
              ) : r.limit ? (
                <span className="tag tag-limit" title={ruleSummary(r.limit)}>
                  <Lock size={11} aria-hidden /> Max. {r.limit.max}
                </span>
              ) : null}
              {r.offList && <span className="tag tag-x">not on your list</span>}
            </span>
          </div>
        ),
      },
      {
        id: "cities",
        header: "Cities",
        size: 142,
        enableSorting: false,
        cell: ({ row: { original: r } }) => {
          const shown = r.locations.slice(0, 2);
          const rest = r.locations.length - shown.length;
          return (
            <div className="stack">
              <span className="cities" title={r.locations.map((l) => l.city).join(", ")}>
                {shown.map((l, i) => (
                  <span key={l.city} className={PREFERRED_REGIONS.includes(l.region) ? "pref" : undefined}>
                    {i > 0 && <span className="sep"> · </span>}
                    {l.city}
                  </span>
                ))}
              </span>
              <span className="sub">{rest > 0 ? `+${rest} more ${rest > 1 ? "cities" : "city"}` : " "}</span>
            </div>
          );
        },
      },
      {
        id: "published",
        accessorFn: (r) => r.published?.date,
        header: "Published",
        size: 98,
        sortingFn: publishedSort,
        sortDescFirst: true,
        sortUndefined: "last",
        cell: ({ row: { original: r } }) =>
          r.published ? (
            <div
              className="stack"
              data-from={r.published.from}
              title={
                r.published.from === "web"
                  ? `Published on ${longDate(r.published.date)} on the company's site${r.published.other ? ` · ${r.published.other}` : ""}`
                  : `The company's site gives no date: this is when ${r.published.source} listed it (${longDate(r.published.date)}), usually the same day or the next${r.published.other ? ` · ${r.published.other}` : ""}`
              }
            >
              <span>{shortDate(r.published.date)}</span>
              <span className="sub">{r.published.from === "web" ? age(r.published.date) : `on ${r.published.source}`}</span>
            </div>
          ) : null,
      },
      {
        id: "pay",
        accessorFn: (r) => r.pay.annualUsd,
        header: "Pay",
        size: 140,
        sortingFn: paySort,
        sortDescFirst: true,
        cell: ({ row: { original: r } }) => (
          <div className="stack">
            <span className={`pay pay-${r.pay.source}`}>
              {r.pay.source === "estimate" && "≈ "}
              {r.pay.label}
            </span>
            <PayBadge source={r.pay.source} />
          </div>
        ),
      },
      {
        id: "fit",
        accessorFn: (r) => r.fit,
        header: "Fit",
        size: 76,
        sortingFn: fitSort,
        sortDescFirst: true,
        cell: ({ row: { original: r } }) => <Dots n={r.fit} label="Fit with your CV" />,
      },
      {
        id: "visa",
        header: "Visa",
        size: 124,
        enableSorting: false,
        cell: ({ row: { original: r } }) => {
          const first = VISAS[r.visas[0]];
          const noVisaSomewhere = r.visas.includes("eu");
          return (
            <span className="visa-cell" title={r.visas.map((v) => VISAS[v].long).join("\n")}>
              <span className={`pill t-${first.tone}`}>{first.label}</span>
              {r.visas.length > 1 && <span className="more-visa">{noVisaSomewhere && r.visas[0] !== "eu" ? "+EU" : `+${r.visas.length - 1}`}</span>}
            </span>
          );
        },
      },
      {
        id: "elig",
        accessorFn: (r) => r.elig,
        header: "Eligible",
        size: 96,
        sortingFn: eligSort,
        cell: ({ row: { original: r } }) => (
          <span className={`pill e-${r.elig}`} title={`${ELIGIBILITY_LABEL[r.elig]} · ${r.eligFromPosting ? "from the posting's text" : "from the type of role"}`}>
            {ELIG_SHORT[r.elig]}
          </span>
        ),
      },
      {
        id: "cv",
        header: "CV",
        size: 80,
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <a
            className={`cv cv-${r.cv}`}
            data-changed={r.cvChanged || undefined}
            href={`/api/cv/${r.cv}`}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            title={`${r.cvChanged ? "The posting's text decides it. " : ""}${r.cvWhy} Click: open the PDF.`}
          >
            <i aria-hidden />
            {r.cv === "quant" ? "Quant" : "SWE"}
          </a>
        ),
      },
      {
        id: "status",
        header: "My status",
        size: 118,
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <StatusSelect value={r.track?.status ?? ""} label={`Status of ${r.company} ${r.title}`} onChange={(s) => onPatch(r.id, { status: s })} />
        ),
      },
      {
        id: "trash",
        header: () => <span className="sr-only">{trashView ? "Restore" : "Trash"}</span>,
        size: 44,
        enableSorting: false,
        cell: ({ row: { original: r } }) =>
          trashView ? (
            <RestoreButton label={`${r.company} ${r.title}`} onRestore={() => onPatch(r.id, { trashed: false })} />
          ) : (
            <TrashButton label={`${r.company} ${r.title}`} onConfirm={() => onPatch(r.id, { trashed: true })} />
          ),
      },
      { id: "posted", accessorFn: (r) => r.firstSeenAt ?? r.postedAt ?? "", sortingFn: postedSort, sortDescFirst: true, enableHiding: true },
      { id: "tieName", accessorFn: (r) => r.company, sortingFn: nameSort, enableHiding: true },
      { id: "tiePrio", accessorFn: (r) => r.priority, sortingFn: prioSort, enableHiding: true },
      { id: "tieScore", accessorFn: (r) => r.score, sortingFn: scoreSort, enableHiding: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onPatch, trashView, selected, allSelected, someSelected, rows, onSelect],
  );

  // The levels you picked (grouping columns before pay), then the tie-breakers
  const levels = useMemo(() => effectiveSort(sort.length ? sort : [{ id: "prio", desc: false }]), [sort]);
  const sorting: SortingState = useMemo(
    () => [
      ...levels,
      ...(levels[levels.length - 1]?.id === "co" ? [{ id: "tieName", desc: false }] : []),
      ...(levels.some((k) => k.id === "prio") ? [] : [{ id: "tiePrio", desc: false }]),
      { id: "tieScore", desc: true },
    ],
    [levels],
  );
  const levelOf = (id: string) => (sort.length > 1 ? levels.findIndex((k) => k.id === id) + 1 : 0);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility: COLUMN_VISIBILITY },
    manualSorting: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (r) => r.id,
  });
  tableRef.current = table;

  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // Keep the scroll position when coming back from an offer page
  const [restored, setRestored] = useState(false);
  useLayoutEffect(() => {
    if (restored || !scrollRef.current) return;
    try {
      const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0);
      if (y > 0) scrollRef.current.scrollTop = y;
    } catch {}
    setRestored(true);
  }, [restored]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop));
        } catch {}
      }, 120);
    };
    el.addEventListener("scroll", save, { passive: true });
    return () => el.removeEventListener("scroll", save);
  }, []);

  const width = (c: { getSize: () => number; columnDef: { meta?: unknown } }) =>
    (c.columnDef.meta as { grow?: boolean } | undefined)?.grow ? { flex: "1 0 auto", width: c.getSize() } : { flex: "0 0 auto", width: c.getSize() };

  return (
    <div className="table-wrap" ref={scrollRef}>
      {notice}
      <table className="offers">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const level = levels.find((k) => k.id === h.column.id);
                const sorted = level ? (level.desc ? "desc" : "asc") : false;
                const n = levelOf(h.column.id);
                return (
                  <th
                    key={h.id}
                    style={width(h.column)}
                    data-col={h.column.id}
                    aria-sort={sorted ? (sorted === "desc" ? "descending" : "ascending") : undefined}
                  >
                    {h.column.getCanSort() ? (
                      <button
                        type="button"
                        className="th-sort"
                        data-on={!!sorted || undefined}
                        onClick={() => onSort(clickSort(sort, h.column.id as SortId))}
                        title={`${SORT_HINT[h.column.id] ?? ""}${sort.length ? ". Another click reverses it, a third removes it; another column adds a level" : ""}`}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp size={12} aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown size={12} aria-hidden />
                        ) : (
                          <ArrowUpDown size={12} aria-hidden className="th-sort-idle" />
                        )}
                        {n > 0 && (
                          <span className="th-level" aria-label={`sort level ${n}`}>
                            {n}
                          </span>
                        )}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = tableRows[vi.index];
            const r = row.original;
            const s = r.track?.status ?? "";
            return (
              <tr
                key={row.id}
                style={{ transform: `translateY(${vi.start}px)`, height: ROW_H }}
                data-dim={(!trashView && (s === "dropped" || APPLIED_STATUSES.has(s) || !r.active || !!r.block || !!r.stale)) || undefined}
                data-fav={r.track?.interested || undefined}
                data-fresh={r.fresh || undefined}
                data-selected={selected.has(r.id) || undefined}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a,button,select,input,.trash")) return;
                  if (e.metaKey || e.ctrlKey) window.open(`/offers/${r.id}`, "_blank");
                  else router.push(`/offers/${r.id}`);
                }}
              >
                {row.getVisibleCells().map((c) => (
                  <td key={c.id} style={width(c.column)} data-col={c.column.id}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!tableRows.length && <div className="empty">{empty}</div>}
    </div>
  );
}
