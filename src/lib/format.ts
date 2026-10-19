const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(date: string | null) {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** A real calendar date (YYYY-MM-DD) or null: rejects "Fri Oct 16", future dates and nonsense years. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : /\b(19|20)\d{2}\b/.test(String(raw)) ? new Date(String(raw)) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  if (iso < "2015-01-01" || d.getTime() > Date.now() + 864e5) return null;
  return iso;
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Oct 12" this year, "Jul 8, 2025" otherwise. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${y === new Date().getFullYear() ? "" : `, ${y}`}`;
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

export interface Published {
  date: string;
  from: "web" | "tracker";
  /** The other source's date, when it differs */
  other: { date: string; from: "web" | "tracker" } | null;
}

/** Dates further apart than this belong to different hiring cycles */
const CYCLE_GAP_DAYS = 180;

/**
 * When the offer was published: the earliest date among the company's own posting and the trackers.
 * When they are more than half a year apart, the later one is this cycle's: a company date that old is an
 * evergreen opening re-listed now, and a tracker date that old is last cycle's entry kept for a reposting.
 */
export function publishedOf(trackerDate: string | null | undefined, webDate: string | null | undefined): Published | null {
  const t = toIsoDate(trackerDate);
  const w = toIsoDate(webDate);
  if (!t && !w) return null;
  if (t && !w) return { date: t, from: "tracker", other: null };
  if (w && !t) return { date: w, from: "web", other: null };
  const apart = Math.abs(Date.parse(t!) - Date.parse(w!)) > CYCLE_GAP_DAYS * 864e5;
  const useWeb = apart ? w! > t! : w! <= t!;
  const date = useWeb ? w! : t!;
  const otherDate = useWeb ? t! : w!;
  return { date, from: useWeb ? "web" : "tracker", other: otherDate !== date ? { date: otherDate, from: useWeb ? "tracker" : "web" } : null };
}

/** Published more than a year ago: last cycle's posting or a permanent opening, not something to triage now. */
export const STALE_DAYS = 365;

/** An offer published over a year ago whose title does not say 2027 (a "2027 internship" reposted is current). */
export function isStale(date: string | null | undefined, title: string, now = Date.now()): boolean {
  if (!date || /2027|2026\s*[-/–]\s*(20)?27/.test(title)) return false;
  return Date.parse(date) < now - STALE_DAYS * 864e5;
}
