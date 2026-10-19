"use client";

import { ArrowLeft, Check, Copy, ExternalLink, Lock, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { APPLIED_STATUSES, KIND_LABEL, STATUS_OPTIONS } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { BOTH_TRACKS, coveredBy, crossTrack, ruleSummary } from "@/lib/limits";
import { DEFAULT_CONTEXT_OPTIONS, renderContext, type ContextOptions, type CtxSection, type OfferContext } from "@/lib/offerContext";
import type { CompanyPolicy, CvKind, Kind, Status, Tracking, TrackingPatch } from "@/lib/types";
import { RestoreButton, StarButton, StatusSelect, TrashButton } from "./ui";

// ---------- shared tracking state for one offer

interface Ctx {
  track: Tracking;
  saving: boolean;
  error: string | null;
  checking: boolean;
  patch: (p: TrackingPatch) => Promise<void>;
}

const TrackingCtx = createContext<Ctx | null>(null);
const EMPTY: Tracking = { status: "", interested: false, notes: "", updatedAt: null };

export function TrackingProvider({ id, initial, company, children }: { id: string; initial: Tracking | null; company: string; children: ReactNode }) {
  const router = useRouter();
  const [track, setTrack] = useState<Tracking>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const waitForPolicy = useCallback(async () => {
    setChecking(true);
    const before = await fetch(`/api/companies/${encodeURIComponent(company)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => c.policy?.checkedAt ?? null)
      .catch(() => null);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const c = await fetch(`/api/companies/${encodeURIComponent(company)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      if (c?.policy && c.policy.checkedAt !== before) break;
    }
    setChecking(false);
    router.refresh();
  }, [company, router]);

  const patch = useCallback(
    async (p: TrackingPatch) => {
      const prev = track;
      setTrack({ ...track, ...p });
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/applications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
        if (!res.ok) throw new Error();
        const out: { tracking: Tracking; policyCheck: "started" | "known" | null } = await res.json();
        setTrack(out.tracking);
        if (out.policyCheck === "started") waitForPolicy();
        else if (p.status !== undefined) router.refresh();
      } catch {
        setTrack(prev);
        setError("The change could not be saved");
      } finally {
        setSaving(false);
      }
    },
    [id, track, router, waitForPolicy],
  );

  return <TrackingCtx.Provider value={{ track, saving, error, checking, patch }}>{children}</TrackingCtx.Provider>;
}

function useTracking() {
  const c = useContext(TrackingCtx);
  if (!c) throw new Error("TrackingProvider missing");
  return c;
}

// ---------- header actions

export function OfferActions({ url, cvKind, cvLabel, title }: { url: string; cvKind: CvKind; cvLabel: string; title: string }) {
  const { track, patch, error } = useTracking();
  return (
    <div className="offer-actions">
      <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">
        Open the posting <ExternalLink size={15} aria-hidden />
      </a>
      <StatusSelect size="md" value={track.status} label={`Status of ${title}`} onChange={(s: Status) => patch({ status: s })} />
      <StarButton withText on={track.interested} label={title} onToggle={() => patch({ interested: !track.interested })} />
      <a className="btn" href={`/api/cv/${cvKind}`} target="_blank" rel="noopener">
        {cvLabel} <ExternalLink size={14} aria-hidden />
      </a>
      {!track.trashed && <TrashButton withText label={title} onConfirm={() => patch({ trashed: true })} />}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// ---------- visiting

/** Opening a new offer counts as seeing it: from now on it is no longer in "New". */
export function SeenOnVisit({ isNew }: { isNew: boolean }) {
  const { patch } = useTracking();
  const done = useRef(false);
  useEffect(() => {
    if (!isNew || done.current) return;
    done.current = true;
    patch({ seen: true });
  }, [isNew, patch]);
  return null;
}

/** Back to the board you came from (history keeps its filters and scroll); the offer's board otherwise. */
export function BackToBoard({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className="back"
      onClick={(e) => {
        try {
          const ref = document.referrer ? new URL(document.referrer) : null;
          if (ref && ref.origin === window.location.origin && ref.pathname === "/" && window.history.length > 1) {
            e.preventDefault();
            router.back();
          }
        } catch {}
      }}
    >
      <ArrowLeft size={15} aria-hidden /> {label}
    </Link>
  );
}

// ---------- trash

export function TrashBanner() {
  const { track, patch } = useTracking();
  if (!track.trashed) return null;
  return (
    <div className="trash-banner" role="status">
      <span>
        In the trash{track.trashedAt ? ` since ${fmtDate(track.trashedAt.slice(0, 10))}` : ""}: it only shows up on the board under "Trash".
      </span>
      <RestoreButton withText label="this offer" onRestore={() => patch({ trashed: false })} />
    </div>
  );
}

// ---------- my tracking

export function TrackingPanel() {
  const { track, patch } = useTracking();
  const [draft, setDraft] = useState(track.notes);
  const statusLabel = STATUS_OPTIONS.find(([v]) => v === track.status)?.[1];
  return (
    <section>
      <h2>My tracking</h2>
      <p>
        {track.status ? <b>{statusLabel}</b> : "Not started"}
        {track.appliedAt && <span className="muted"> · applied on {fmtDate(track.appliedAt.slice(0, 10))}</span>}
      </p>
      <label className="notes">
        <span className="label">Notes</span>
        <textarea
          value={draft}
          placeholder="Contacts, referral, OA dates, visa questions for HR…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== track.notes && patch({ notes: draft })}
        />
      </label>
      <p className="muted small">Saved when you leave the field.</p>
    </section>
  );
}

// ---------- application limits at this company

interface Sibling {
  id: string;
  title: string;
  kind: Kind;
  active: boolean;
  status: Status;
  blocked: boolean;
  /** You cannot apply to it (graduation, experience…) */
  ineligible: boolean;
}

const ORIGIN: Record<CompanyPolicy["origin"], string> = { posting: "read from its postings", faq: "from its official FAQ", manual: "edited by you" };

export function PolicyPanel({
  company,
  kind,
  policy,
  block,
  siblings,
}: {
  company: string;
  kind: Kind;
  policy: CompanyPolicy | null;
  block: { summary: string; appliedTo: { id: string; title: string }[]; cooldown?: boolean } | null;
  siblings: Sibling[];
}) {
  const router = useRouter();
  const { checking } = useTracking();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/companies/${encodeURIComponent(company)}`, { method: "POST" });
    if (!r.ok) setErr("No se pudo comprobar ahora");
    setBusy(false);
    router.refresh();
  };

  const sameTrack = siblings.filter((s) => s.kind === kind);
  const other = siblings.filter((s) => s.kind !== kind);
  const otherWord = kind === "intern" ? "new grad" : "internship";
  const otherApplied = siblings.filter((s) => APPLIED_STATUSES.has(s.status) && (s.kind !== kind || BOTH_TRACKS.test(s.title)));
  const cross = coveredBy(otherApplied.map((s) => s.title)) ?? crossTrack(policy ?? undefined, kind);
  const otherOpen = other.filter((s) => s.active && !s.ineligible && (s.status === "" || s.status === "preparing"));
  const list = [...sameTrack, ...other].slice(0, 12);
  const working = busy || checking;

  return (
    <section>
      <h2>Applications at {company}</h2>
      {block && (
        <p className="limit-hit">
          <Lock size={14} aria-hidden /> {block.summary}. {block.cooldown ? "You did the OA or an interview for" : "You already sent"}{" "}
          {block.appliedTo.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link href={`/offers/${a.id}`}>{a.title}</Link>
            </span>
          ))}
          .
        </p>
      )}
      {other.length > 0 && (
        <div className="cross" data-verdict={cross.verdict}>
          <h3>{KIND_LABEL[kind]} and {otherWord} at the same time?</h3>
          <p>{cross.text}</p>
          {otherApplied.length > 0 && (
            <p className="small">
              You already applied to {otherWord}:{" "}
              {otherApplied.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link href={`/offers/${a.id}`}>{a.title}</Link>
                </span>
              ))}
              .
            </p>
          )}
          {otherApplied.length === 0 && otherOpen.length === 0 && (
            <p className="muted small">None of its open {otherWord} offers is for you (not eligible or closed): this does not affect you.</p>
          )}
          {cross.rule && <q className="quote">{cross.rule.quote}</q>}
        </div>
      )}
      {working ? (
        <p className="muted" aria-live="polite">
          <RefreshCw size={14} aria-hidden className="spin" /> Reading its postings to see how many applications it accepts…
        </p>
      ) : policy?.rules.length ? (
        <ul className="rules">
          {policy.rules.map((r, i) => (
            <li key={i}>
              <b>{ruleSummary(r)}</b>
              <q className="quote">{r.quote}</q>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="small">
                Source <ExternalLink size={11} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {policy?.note ?? "Not checked yet. It is checked automatically when you mark one of its offers as applied."}
        </p>
      )}
      {policy?.note && policy.rules.length > 0 && <p className="muted small">{policy.note}</p>}
      <p className="muted small">
        {policy ? `${ORIGIN[policy.origin]}, ${fmtDate(policy.checkedAt.slice(0, 10))}. ` : ""}
        <button type="button" className="link-btn" onClick={check} disabled={working}>
          Check now
        </button>
        {err && <span className="error"> {err}</span>}
      </p>

      {list.length > 0 && (
        <>
          <h3>Its other offers</h3>
          <ul className="siblings">
            {list.map((s) => (
              <li key={s.id} data-dim={!s.active || s.blocked || undefined}>
                <Link href={`/offers/${s.id}`}>{s.title}</Link>
                <span className="muted small">
                  {KIND_LABEL[s.kind]}
                  {s.status ? ` · ${STATUS_OPTIONS.find(([v]) => v === s.status)?.[1]}` : ""}
                  {s.blocked ? " · limit used" : ""}
                  {s.ineligible ? " · not eligible" : ""}
                  {!s.active ? " · closed" : ""}
                </span>
              </li>
            ))}
          </ul>
          {siblings.length > list.length && (
            <p className="muted small">
              and {siblings.length - list.length} more.{" "}
              <Link href={`/?q=${encodeURIComponent(company)}`}>See them on the board</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------- copy the offer's context

const COPY_OPTIONS_KEY = "copy-context-options";

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // Plain http on another host (the board opened from the LAN): the old way
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}

const thousands = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : String(n));

/** Everything known about the offer and its company, to paste somewhere else. */
export function CopyContext({ ctx }: { ctx: OfferContext }) {
  const { track } = useTracking();
  const [opts, setOpts] = useState<ContextOptions>(DEFAULT_CONTEXT_OPTIONS);
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  const preview = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const saved = localStorage.getItem(COPY_OPTIONS_KEY);
      if (saved) setOpts({ ...DEFAULT_CONTEXT_OPTIONS, ...JSON.parse(saved) });
    } catch {}
  }, []);

  const set = (p: Partial<ContextOptions>) => {
    const next = { ...opts, ...p };
    setOpts(next);
    setState("idle");
    try {
      localStorage.setItem(COPY_OPTIONS_KEY, JSON.stringify(next));
    } catch {}
  };

  // Your status and notes as they are now on this page (not as they were when it loaded)
  const tracking = useMemo<CtxSection>(
    () => ({
      id: "tracking",
      title: "My tracking",
      items: [
        { k: "Status", v: track.status ? (STATUS_OPTIONS.find(([v]) => v === track.status)?.[1] ?? track.status) : "Not started" },
        { k: "Starred", v: track.interested ? "yes" : "" },
        { k: "Applied on", v: track.appliedAt ? fmtDate(track.appliedAt.slice(0, 10)) : "" },
        { k: "In the trash", v: track.trashed ? "yes" : "" },
        { k: "Notes", v: track.notes },
      ],
    }),
    [track],
  );
  const hasText = !!ctx.text;
  const text = useMemo(() => renderContext(ctx, { ...opts, text: opts.text && hasText }, tracking, origin), [ctx, opts, hasText, tracking, origin]);

  const copy = async () => {
    try {
      await writeClipboard(text);
      setState("ok");
    } catch {
      setState("error");
      if (preview.current) preview.current.open = true;
    }
  };

  return (
    <section className="copy-ctx">
      <h2>Copy context</h2>
      <p className="muted small">Everything the board knows about this offer and the company, ready to paste elsewhere: an AI chat, your notes, an email.</p>
      <div className="copy-opts">
        <label className="check">
          <input type="checkbox" checked={opts.text && hasText} disabled={!hasText} onChange={(e) => set({ text: e.target.checked })} />
          <span>
            Full posting text <span className="muted small">{hasText ? `${thousands(ctx.text!.length)} characters` : "could not be read"}</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.tracking} onChange={(e) => set({ tracking: e.target.checked })} />
          <span>My tracking and notes</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.profile} onChange={(e) => set({ profile: e.target.checked })} />
          <span>My profile: graduation, experience, languages and skills</span>
        </label>
      </div>
      <div className="copy-row">
        <div className="seg seg-keep" role="radiogroup" aria-label="Format">
          {(["md", "json"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={opts.format === f} onClick={() => set({ format: f })}>
              {f === "md" ? "Text" : "JSON"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={copy}>
          {state === "ok" ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {state === "ok" ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="muted small" role="status" aria-live="polite">
        {state === "error" ? (
          <span className="error">Could not copy. Select the text below and copy it by hand.</span>
        ) : (
          `${thousands(text.length)} characters${state === "ok" ? " on the clipboard" : ""}`
        )}
      </p>
      <details className="copy-preview" ref={preview}>
        <summary>See what is copied</summary>
        <pre>{text}</pre>
      </details>
    </section>
  );
}
