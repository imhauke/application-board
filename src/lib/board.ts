// Server-side: turns the database into the light rows the board needs (no posting texts).
// Fit, eligibility, score and priority are computed here from your current CV PDFs, so they
// follow any change to the CV without touching the stored data.

import { compFor, compLabel, FX, toAnnualUsd, type CompSource } from "./comp";
import { priorityFor, scoreFor } from "./crawler/classify";
import { candidateOf, type CvProfile } from "./cv";
import { assessFit, eligibilityOf } from "./fit";
import { APPLIED_STATUSES, GONE_REASON } from "./constants";
import { isStale, publishedOf } from "./format";
import { onBoard } from "./store";
import type {
  Application,
  Board,
  CompanyPolicy,
  CrawlRun,
  CvKind,
  Database,
  Eligibility,
  InterviewType,
  JobLocation,
  Kind,
  PostingDetails,
  Prestige,
  Priority,
  Region,
  Tracking,
  VisaCode,
} from "./types";

export interface BoardRow {
  id: string;
  company: string;
  title: string;
  kind: Kind;
  role: string;
  sector: string;
  prestige: Prestige;
  /** Company pay level 1-5 (with prestige, the company "tier") */
  payTier: number;
  priority: Priority;
  score: number;
  fit: number;
  offList: boolean;
  active: boolean;
  closedReason?: string;
  season: string;
  url: string;
  locations: JobLocation[];
  /** Distinct visas, in the order of the cities */
  visas: VisaCode[];
  /** CV to send: the default rule, or the other one when the posting clearly matches it better */
  cv: CvKind;
  /** The posting's text tipped the CV against what the role alone suggests */
  cvChanged: boolean;
  /** Why this CV, in one line (tooltip) */
  cvWhy: string;
  interview: InterviewType;
  elig: Eligibility;
  eligFromPosting: boolean;
  /** eurMin / eurMax: the range a year in € (internships: the monthly pay × 12), for the pay filter */
  pay: { label: string; source: CompSource; annualUsd: number; eurMin: number; eurMax: number };
  postedAt: string | null;
  firstSeenAt: string | null;
  /** When it was published in its sources (company site or tracker); null when no source says */
  published: { date: string; from: "web" | "tracker"; source: string; label: string; other: string | null } | null;
  /** Cover letter in the application form (only where the ATS publishes the form) */
  cover?: { state: "required" | "optional" | "none"; from: string };
  /** Published over a year ago and not for 2027: last cycle's or a permanent opening (in the Archive) */
  stale?: boolean;
  /** It was already published before the search ahead of the one that found it: never "new" */
  oldOnArrival?: boolean;
}

/** An offer of another board you applied to: it counts for its company's limits here too. */
export interface OtherApplied {
  id: string;
  company: string;
  kind: Kind;
  title: string;
}

export interface CvStatus {
  kind: CvKind;
  ok: boolean;
  modifiedAt: string;
  skills: number;
  error?: string;
}

export interface BoardData {
  board: Board;
  rows: BoardRow[];
  others: OtherApplied[];
  tracking: Record<string, Tracking>;
  policies: Record<string, CompanyPolicy>;
  lastCrawl: CrawlRun | null;
  newSeenAt: string | null;
  cv: CvStatus[];
  generated: string;
}

/** Sources that never give a publication date: a label never names them */
const UNDATED = new Set(["Manual (web)"]);
export const trackerName = (sources: string[]) => sources.find((x) => !UNDATED.has(x)) ?? sources.find((x) => x !== "Manual (web)") ?? "the tracker";

/**
 * The company's own publication date, unless it is just the day the page was read: some sites
 * (G-Research, Point72, IMC) stamp the current date in their metadata.
 */
export function webDateOf(posting: { datePosted?: string; fetchedAt?: string; via?: string } | undefined, firstSeenAt: string | null): string | null {
  const d = posting?.datePosted?.slice(0, 10);
  if (!d) return null;
  const stamped = (posting?.via === "jsonld" || posting?.via === "html") && d === posting?.fetchedAt?.slice(0, 10);
  return stamped && firstSeenAt?.slice(0, 10) !== d ? null : d;
}

/** The offer's publication date with its label. */
export function publishedOfOffer(a: Pick<Application, "postedAt" | "postedBy" | "sources" | "firstSeenAt">, posting: PostingDetails | undefined | null): BoardRow["published"] {
  const p = publishedOf(a.postedAt, webDateOf(posting ?? undefined, a.firstSeenAt));
  return publishedLabel(p, a.postedBy ? [a.postedBy] : a.sources, posting?.dateFrom);
}

/** Where the publication date comes from, in words, for tooltips and the offer page. */
export function publishedLabel(p: ReturnType<typeof publishedOf>, sources: string[], dateFrom?: string): BoardRow["published"] {
  if (!p) return null;
  // A date read from a job board's page is that board's, not the company's
  const where = (from: "web" | "tracker") => (from === "web" ? (dateFrom ? `on ${dateFrom}` : "on the company's site") : `on ${trackerName(sources)}`);
  return {
    date: p.date,
    from: p.from,
    source: p.from === "web" ? (dateFrom ?? "the company") : trackerName(sources),
    label: where(p.from),
    other: p.other ? `${where(p.other.from)}: ${p.other.date}` : null,
  };
}

export function buildBoardData(db: Database, cvs: Record<CvKind, CvProfile>, board: Board = "global"): BoardData {
  const me = candidateOf(cvs);
  const mine = db.applications.filter((a) => onBoard(a, board));
  const others = db.applications
    .filter((a) => !onBoard(a, board) && APPLIED_STATUSES.has(db.tracking[a.id]?.status ?? ""))
    .map((a) => ({ id: a.id, company: a.company, kind: a.kind, title: a.title }));
  const rows: BoardRow[] = mine.map((a) => {
    const posting = db.postings[a.id];
    const comp = compFor(a, posting);
    const fit = assessFit(a, posting, cvs);
    const elig = eligibilityOf(a, db.reference.eligibilityNotes[a.eligibilityNote], posting, me);
    const visas: VisaCode[] = [];
    for (const l of a.locations) {
      const v = a.visas.find((x) => x.region === l.region)?.visa ?? a.visa;
      if (!visas.includes(v)) visas.push(v);
    }
    const region: Region = a.locations[0]?.region ?? "USA (other)";
    const published = publishedOfOffer(a, posting);
    const score =
      Math.round(scoreFor({ pay: a.pay, difficulty: a.difficulty, fit: fit.fit, prestige: a.prestige, eligibility: elig.value, region, kind: a.kind, visa: visas[0] ?? a.visa }) * 100) / 100;
    return {
      id: a.id,
      company: a.company,
      title: a.title,
      kind: a.kind,
      role: a.role,
      sector: a.sector,
      prestige: a.prestige,
      payTier: a.pay,
      priority: a.preApplied ? "X" : priorityFor(score, elig.value, region),
      score,
      fit: fit.fit,
      offList: a.offList,
      active: a.active && !posting?.gone,
      closedReason: posting?.gone && a.active ? GONE_REASON : a.closedReason,
      season: a.season,
      url: a.urls[0],
      locations: a.locations,
      visas: visas.length ? visas : [a.visa],
      cv: fit.cvBest,
      cvChanged: fit.cvChoice.byPosting,
      cvWhy: `${fit.cvChoice.project}. ${fit.cvChoice.reasons.join(" ")}`,
      interview: a.interview.type,
      elig: elig.value,
      eligFromPosting: elig.from === "posting",
      pay: {
        label: compLabel(comp),
        source: comp.source,
        annualUsd: Math.round(comp.annualUsd),
        eurMin: Math.round(toAnnualUsd(comp.min, comp.currency, comp.period) / FX.EUR),
        eurMax: Math.round(toAnnualUsd(comp.max, comp.currency, comp.period) / FX.EUR),
      },
      postedAt: a.postedAt,
      firstSeenAt: a.firstSeenAt,
      published,
      ...(isStale(published?.date, a.title) ? { stale: true } : {}),
      ...(a.oldOnArrival ? { oldOnArrival: true } : {}),
      ...(posting?.form ? { cover: { state: posting.form.coverLetter, from: posting.form.from } } : {}),
    };
  });
  const policies: Record<string, CompanyPolicy> = {};
  for (const c of Object.values(db.companies)) if (c.policy) policies[c.name] = c.policy;
  return {
    board,
    rows,
    others,
    tracking: db.tracking,
    policies,
    lastCrawl: db.crawls?.[0] ?? null,
    newSeenAt: db.ui?.newSeenAt ?? null,
    cv: Object.values(cvs).map((c) => ({ kind: c.kind, ok: c.ok, modifiedAt: c.modifiedAt, skills: c.skills.length, error: c.error })),
    generated: db.generated,
  };
}
