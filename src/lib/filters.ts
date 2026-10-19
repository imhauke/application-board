import type { BoardRow } from "./board";
import type { CompSource } from "./comp";
import { EU_REGIONS, IN_PROCESS_STATUSES, PREFERRED_REGIONS, REGION_LABEL, ROLES, type LocationFilter } from "./constants";
import type { CvKind, Eligibility, InterviewType, Kind, Prestige, Region, Status, Tracking } from "./types";

export type View = "todo" | "interested" | "new" | "progress" | "archive" | "all" | "trash";

export const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "todo", label: "To apply", hint: "Open, not sent yet, a fit for your CV and within the company's application limit" },
  { id: "new", label: "New", hint: "Found by the crawler and not opened yet. They stay here until you open each one or mark them as seen." },
  { id: "interested", label: "Starred", hint: "The ones you starred" },
  { id: "progress", label: "In progress", hint: "Applied, OA, interview or offer" },
  { id: "archive", label: "Archive", hint: "Rejected, dropped, closed, blocked by the company's limit, or old (published over a year ago)" },
  { id: "all", label: "All", hint: "Every offer except the trash" },
  { id: "trash", label: "Trash", hint: "The ones you removed. They can be restored." },
];

export type SortId = "prio" | "co" | "pay" | "fit" | "posted" | "published" | "elig";

/** One level of the sort: rows are ordered by the first level, ties by the next, and so on. */
export interface SortKey {
  id: SortId;
  desc: boolean;
}

export const SORT_LABEL: Record<SortId, string> = {
  prio: "Priority",
  co: "Company (tier)",
  pay: "Pay",
  fit: "Fit",
  posted: "Found",
  published: "Published",
  elig: "Eligibility",
};

/** First click: best first (A before C, highest pay, newest, fit 5, eligible first). */
export const SORT_DEFAULT_DESC: Record<SortId, boolean> = { prio: false, co: false, pay: true, fit: true, posted: true, published: true, elig: false };

/** Near-unique values: they go after the grouping columns, otherwise the levels below them would never apply. */
export const CONTINUOUS_SORTS: ReadonlySet<SortId> = new Set(["pay", "posted"]);

/** Groups the sort levels: grouping columns (priority, tier, fit, eligibility, publication day) first, in the order you picked them, then pay. */
export function effectiveSort(chain: SortKey[]): SortKey[] {
  return [...chain.filter((k) => !CONTINUOUS_SORTS.has(k.id)), ...chain.filter((k) => CONTINUOUS_SORTS.has(k.id))];
}

export const MAX_SORT_LEVELS = 3;

/**
 * A click on a column header: a new column becomes the next level (the oldest drops beyond three);
 * one already sorted flips direction, and a third click removes it. Empty = the default order (priority).
 */
export function clickSort(chain: SortKey[], id: SortId): SortKey[] {
  const i = chain.findIndex((k) => k.id === id);
  if (i < 0) return [...chain, { id, desc: SORT_DEFAULT_DESC[id] }].slice(-MAX_SORT_LEVELS);
  const k = chain[i];
  if (k.desc === SORT_DEFAULT_DESC[id]) return chain.map((x, j) => (j === i ? { ...x, desc: !x.desc } : x));
  return chain.filter((_, j) => j !== i);
}

/** Older saved filters kept one sort as an object. */
export function normalizeSort(raw: unknown): SortKey[] {
  const ids = new Set(Object.keys(SORT_LABEL));
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const keys = list.filter((k): k is SortKey => !!k && ids.has((k as SortKey).id)).map((k) => ({ id: k.id, desc: !!k.desc }));
  // The old default ("prio" ascending) is now the empty chain
  return keys.length === 1 && keys[0].id === "prio" && !keys[0].desc ? [] : keys.slice(0, MAX_SORT_LEVELS);
}

export type CoverFacet = "none" | "optional" | "required" | "unknown";

export interface Filters {
  q: string;
  view: View;
  /** Region; "all" = everywhere */
  loc: LocationFilter;
  roles: string[];
  // Choice filters: an empty list means "all"
  kinds: Kind[];
  cvs: CvKind[];
  ivs: InterviewType[];
  statuses: Status[];
  covers: CoverFacet[];
  /** Where the pay figure comes from: the posting (official), a tracker, an estimate */
  paySrc: CompSource[];
  eligs: Eligibility[];
  tiers: Prestige[];
  /** Fit with your CV of at least this (1 = any) */
  fitMin: number;
  /** Pay range in thousands of € (a year, or a month); null = open. Overlapping ranges count. */
  payMin: number | null;
  payMax: number | null;
  payUnit: "year" | "month";
  /** Published in the last N days, or between two dates (YYYY-MM-DD) */
  pubDays: number | null;
  pubFrom: string | null;
  pubTo: string | null;
  /** With a date filter on: keep the offers no source dates */
  pubUndated: boolean;
  hideNo: boolean;
  extra: boolean;
  /** Show offers whose fit with your CV is 1/5 in "To apply" and "New" */
  lowFit: boolean;
  /** Sort levels; empty = by priority */
  sort: SortKey[];
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  view: "todo",
  loc: "all",
  roles: ROLES,
  kinds: [],
  cvs: [],
  ivs: [],
  statuses: [],
  covers: [],
  paySrc: [],
  eligs: [],
  tiers: [],
  fitMin: 1,
  payMin: null,
  payMax: null,
  payUnit: "year",
  pubDays: null,
  pubFrom: null,
  pubTo: null,
  pubUndated: false,
  hideNo: true,
  extra: true,
  lowFit: false,
  sort: [],
};

export type ChipFacet = "statuses" | "covers" | "cvs" | "kinds" | "eligs" | "tiers" | "ivs" | "paySrc";

/** Each choice filter: its title and its options, in the order shown */
export const FACETS: Record<ChipFacet, { label: string; options: [string, string][] }> = {
  statuses: {
    label: "My status",
    options: [["", "Not started"], ["preparing", "Preparing"], ["applied", "Applied"], ["interview", "OA / Interview"], ["offer", "Offer"], ["rejected", "Rejected"], ["dropped", "Dropped"]],
  },
  covers: { label: "Cover letter", options: [["none", "No cover letter"], ["optional", "Optional"], ["required", "Required"], ["unknown", "Unknown"]] },
  cvs: { label: "CV", options: [["swe", "CV SWE"], ["quant", "CV Quant"]] },
  kinds: { label: "Type", options: [["intern", "Internship"], ["grad", "New grad"]] },
  eligs: { label: "Eligibility", options: [["ok", "Eligible"], ["maybe", "Check"], ["warn", "Unlikely"]] },
  tiers: { label: "Company tier", options: [["S", "S"], ["A", "A"], ["B", "B"], ["C", "C"]] },
  ivs: { label: "Interview", options: [["lc", "LeetCode"], ["prac", "Practical"], ["math", "Math"], ["ds", "SQL"]] },
  paySrc: { label: "Pay", options: [["posted", "Official"], ["tracker", "From a tracker"], ["estimate", "Approximate"]] },
};
export const CHIP_FACETS = Object.keys(FACETS) as ChipFacet[];

/** The value a row has for a choice filter */
export function facetValue(k: ChipFacet, r: BoardRow, t: Tracking | undefined): string {
  switch (k) {
    case "statuses":
      return t?.status ?? "";
    case "covers":
      return r.cover?.state ?? "unknown";
    case "cvs":
      return r.cv;
    case "kinds":
      return r.kind;
    case "eligs":
      return r.elig;
    case "tiers":
      return r.prestige;
    case "ivs":
      return r.interview;
    case "paySrc":
      return r.pay.source;
  }
}

/** YYYY-MM-DD, `days` from `iso` */
export const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
/** Today in your time zone, as YYYY-MM-DD */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const payActive = (f: Filters) => f.payMin != null || f.payMax != null;
export const pubActive = (f: Filters) => !!(f.pubDays || f.pubFrom || f.pubTo);

/** The pay range asked for, in € a year */
export function payBounds(f: Filters): [number | null, number | null] {
  const k = f.payUnit === "month" ? 12_000 : 1000;
  return [f.payMin != null ? f.payMin * k : null, f.payMax != null ? f.payMax * k : null];
}

/** The publication dates asked for (inclusive); null = open */
export function pubRange(f: Filters, today: string): [string | null, string | null] {
  return f.pubDays ? [shiftDays(today, -f.pubDays), null] : [f.pubFrom, f.pubTo];
}

export type FilterKey = ChipFacet | "roles" | "pay" | "pub" | "fit" | "extra" | "q";
const FILTER_KEYS: FilterKey[] = [...CHIP_FACETS, "roles", "pay", "pub", "fit", "extra", "q"];

function passes(k: FilterKey, r: BoardRow, f: Filters, t: Tracking | undefined, today: string): boolean {
  switch (k) {
    case "roles":
      return f.roles.includes(r.role);
    case "pay": {
      const [lo, hi] = payBounds(f);
      return (lo == null || r.pay.eurMax >= lo) && (hi == null || r.pay.eurMin <= hi);
    }
    case "pub": {
      if (!pubActive(f)) return true;
      const d = r.published?.date;
      if (!d) return f.pubUndated;
      const [from, to] = pubRange(f, today);
      return (!from || d >= from) && (!to || d <= to);
    }
    case "fit":
      return r.fit >= f.fitMin;
    case "extra":
      return f.extra || !r.offList;
    case "q": {
      if (!f.q) return true;
      const h = `${r.company} ${r.title} ${r.sector} ${r.role} ${r.locations.map((l) => `${l.city} ${REGION_LABEL[l.region]}`).join(" ")}`.toLowerCase();
      return f.q.split(/\s+/).every((w) => h.includes(w));
    }
    default: {
      const chosen = f[k] as string[];
      return !chosen.length || chosen.includes(facetValue(k, r, t));
    }
  }
}

/** Every filter but the view and the region (counted separately for their controls); `except` leaves one out. */
export function dimensionMatch(r: BoardRow, f: Filters, t: Tracking | undefined, today: string, except?: FilterKey): boolean {
  for (const k of FILTER_KEYS) if (k !== except && !passes(k, r, f, t, today)) return false;
  return true;
}

/**
 * How many rows each option of each choice filter would show, with the other filters as they are
 * (`rows` already in the view and the region), plus the undated ones the date filter leaves out.
 */
export function facetCounts(rows: BoardRow[], f: Filters, tracking: Record<string, Tracking>, today: string) {
  const counts = Object.fromEntries(CHIP_FACETS.map((k) => [k, {} as Record<string, number>])) as Record<ChipFacet, Record<string, number>>;
  let undated = 0;
  for (const r of rows) {
    const t = tracking[r.id];
    const failed = FILTER_KEYS.filter((k) => !passes(k, r, f, t, today));
    if (failed.length > 1) continue;
    for (const k of CHIP_FACETS) {
      if (failed.length && failed[0] !== k) continue;
      const v = facetValue(k, r, t);
      counts[k][v] = (counts[k][v] ?? 0) + 1;
    }
    if (!r.published && (!failed.length || failed[0] === "pub")) undated++;
  }
  return { counts, undated };
}

/** How many filters inside "More filters" differ from the defaults. */
export function secondaryCount(f: Filters): number {
  const chips: ChipFacet[] = ["statuses", "covers", "cvs", "kinds", "eligs", "tiers", "ivs"];
  return [...chips.map((k) => f[k].length > 0), f.fitMin > 1, f.lowFit, !f.extra].filter(Boolean).length;
}

export const isDefaultFilters = (f: Filters) =>
  f.loc === "all" && f.roles.length === ROLES.length && !f.q && !secondaryCount(f) && !payActive(f) && !f.paySrc.length && !pubActive(f);

/** Saved filters from older versions of the board (single choices, "high fit only") read as the current ones. */
export function restoreFilters(saved: Record<string, unknown>, locs: string[]): Filters {
  const list = <T extends string>(v: unknown, allowed: string[]): T[] => (Array.isArray(v) ? (v.filter((x) => allowed.includes(x)) as T[]) : []);
  const allowed = (k: ChipFacet) => FACETS[k].options.map(([o]) => o);
  // Before: kind / iv / cv were one value each ("all" = no filter)
  const old = <T extends string>(key: string, k: ChipFacet): T[] => (typeof saved[key] === "string" && saved[key] !== "all" ? list<T>([saved[key]], allowed(k)) : []);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    ...DEFAULT_FILTERS,
    q: typeof saved.q === "string" ? saved.q : "",
    view: VIEWS.some((v) => v.id === saved.view) ? (saved.view as View) : DEFAULT_FILTERS.view,
    loc: locs.includes(saved.loc as string) ? (saved.loc as Filters["loc"]) : "all",
    roles: Array.isArray(saved.roles) && saved.roles.length ? (saved.roles as string[]).filter((r) => ROLES.includes(r)) : ROLES,
    kinds: Array.isArray(saved.kinds) ? list<Kind>(saved.kinds, allowed("kinds")) : old<Kind>("kind", "kinds"),
    cvs: Array.isArray(saved.cvs) ? list<CvKind>(saved.cvs, allowed("cvs")) : old<CvKind>("cv", "cvs"),
    ivs: Array.isArray(saved.ivs) ? list<InterviewType>(saved.ivs, allowed("ivs")) : old<InterviewType>("iv", "ivs"),
    statuses: list<Status>(saved.statuses, allowed("statuses")),
    covers: list<CoverFacet>(saved.covers, allowed("covers")),
    paySrc: list<CompSource>(saved.paySrc, allowed("paySrc")),
    eligs: list<Eligibility>(saved.eligs, allowed("eligs")),
    tiers: list<Prestige>(saved.tiers, allowed("tiers")),
    fitMin: typeof saved.fitMin === "number" && saved.fitMin >= 1 && saved.fitMin <= 5 ? saved.fitMin : saved.fit4 ? 4 : 1,
    payMin: num(saved.payMin),
    payMax: num(saved.payMax),
    payUnit: saved.payUnit === "month" ? "month" : "year",
    pubDays: num(saved.pubDays),
    pubFrom: day(saved.pubFrom),
    pubTo: day(saved.pubTo),
    pubUndated: saved.pubUndated === true,
    hideNo: true,
    extra: saved.extra !== false,
    lowFit: saved.lowFit === true,
    sort: normalizeSort(saved.sort),
  };
}

/**
 * Found by the crawler and not seen yet: it stays new until you open it or mark it as seen.
 * `since` is the board's old marker: offers found before it already count as seen. An offer that was
 * already published before the previous search (oldOnArrival), or over a year ago (stale), is never new.
 */
export const isNew = (r: { firstSeenAt: string | null; oldOnArrival?: boolean; stale?: boolean }, since: string | null, seenAt?: string | null) =>
  !!r.firstSeenAt && !r.oldOnArrival && !r.stale && (!since || r.firstSeenAt > since) && !seenAt;

export interface ViewContext {
  blocked: boolean;
  isNew: boolean;
  hideNo: boolean;
  lowFit: boolean;
}

export function inView(view: View, r: BoardRow, t: Tracking | undefined, ctx: ViewContext): boolean {
  if (view === "trash") return !!t?.trashed;
  if (t?.trashed) return false;
  const s: Status = t?.status ?? "";
  const open = s === "" || s === "preparing";
  const relevant = !(ctx.hideNo && r.elig === "no") && (ctx.lowFit || r.fit > 1);
  switch (view) {
    case "todo":
      return r.active && open && !ctx.blocked && !r.stale && relevant;
    case "new":
      return ctx.isNew && r.active && open && !r.stale && relevant;
    case "interested":
      return !!t?.interested && s !== "dropped" && s !== "rejected";
    case "progress":
      return IN_PROCESS_STATUSES.has(s);
    case "archive":
      return s === "dropped" || s === "rejected" || !r.active || (open && (ctx.blocked || !!r.stale));
    default:
      return true;
  }
}

export function locMatch(r: BoardRow, loc: LocationFilter) {
  const regions = r.locations.map((l) => l.region);
  const pref = (x: Region) => PREFERRED_REGIONS.includes(x);
  const eu = (x: Region) => EU_REGIONS.includes(x);
  switch (loc) {
    case "all":
      return true;
    case "preferred":
      return regions.some((x) => pref(x) || eu(x));
    case "eu":
      return regions.some(eu);
    case "other":
      return regions.some((x) => !pref(x) && !eu(x));
    default:
      return regions.includes(loc as Region);
  }
}
