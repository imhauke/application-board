export type Region =
  | "Zurich"
  | "London"
  | "NY"
  | "Hong Kong"
  | "Europe (other)"
  | "Remote EU"
  | "Remote US"
  | "USA (other)"
  | "Canada"
  | "Asia/Oceania";

export type Kind = "grad" | "intern";
/** The board an offer belongs to (one worldwide board) */
export type Board = "global";
export type CvKind = "quant" | "swe";
export type Eligibility = "ok" | "maybe" | "warn" | "no";
export type VisaCode = "eu" | "uk" | "hk" | "us_j1" | "us_h1b" | "ca" | "asia";
export type InterviewType = "lc" | "prac" | "math" | "ds";
export type Priority = "A" | "B" | "C" | "D" | "X";
export type Prestige = "S" | "A" | "B" | "C";
/** rejected: the company turned you down (it still counts as an application sent) · dropped: you dropped it */
export type Status = "" | "preparing" | "applied" | "interview" | "offer" | "rejected" | "dropped";

export interface JobLocation {
  city: string;
  region: Region;
  url: string;
}

export interface Application {
  id: string;
  /** Board whose crawler owns it (absent = global) */
  board?: Board;
  company: string;
  title: string;
  /** A quant firm that was not on the starting list of companies */
  offList: boolean;
  kind: Kind;
  role: string;
  sector: string;
  season: string;
  urls: string[];
  locations: JobLocation[];
  moreLocations: boolean;
  postedAt: string | null;
  /** Source whose date postedAt is */
  postedBy?: string;
  deadline: string;
  deadlineDate: string | null;
  /** The company's pay level, 1-5 */
  pay: number;
  difficulty: number;
  fit: number;
  prestige: Prestige;
  priority: Priority;
  score: number;
  eligibility: Eligibility;
  /** index in reference.eligibilityNotes */
  eligibilityNote: number;
  /** visa for the preferred city */
  visa: VisaCode;
  visas: { region: Region; visa: VisaCode }[];
  interview: { type: InterviewType; confirmed: boolean; /** index in reference.interviewNotes */ note: number };
  cv: { kind: CvKind; /** key in reference.cvReasons */ reason: string };
  /** Salary published by the tracker ("$60/hr", "$202k/yr" or a yearly amount in USD) */
  salary: string;
  note: string;
  sources: string[];
  preApplied: boolean;
  /** When the crawler first saw it (null = imported) */
  firstSeenAt: string | null;
  /** Already published before the search ahead of the one that found it: never counts as new */
  oldOnArrival?: boolean;
  /** Last time a source listed it */
  lastSeenAt: string | null;
  active: boolean;
  closedAt: string | null;
  closedReason?: string;
  /** Keys of the sources that list it (to match offers across searches) */
  sourceKeys: string[];
}

export interface Tracking {
  status: Status;
  /** Starred: to keep it in view even if you are not applying yet */
  interested: boolean;
  notes: string;
  updatedAt: string | null;
  appliedAt?: string | null;
  /** In the trash: not interesting, but it can be restored */
  trashed?: boolean;
  trashedAt?: string | null;
  /** When you opened it or marked it as seen: until then a new offer stays in "New" */
  seenAt?: string | null;
  /** When it reached an OA or interview: waiting periods count from here, even after "rejected" */
  assessedAt?: string | null;
}

export interface Reference {
  regions: Region[];
  eligibilityNotes: string[];
  interviewNotes: string[];
  cvReasons: Record<string, string>;
}

// ---------- what was read from the posting

export interface PayRange {
  min: number;
  max: number;
  currency: string;
  period: "hour" | "month" | "year";
  text: string;
  source: "structured" | "text";
}

export interface PostingDetails {
  fetchedAt: string;
  ok: boolean;
  via: string;
  url: string;
  error?: string;
  title?: string;
  datePosted?: string;
  validThrough?: string;
  pay: PayRange[];
  /** Graduation / enrolment sentences; the verdict is re-judged against your CV's graduation date */
  grad: { verdict: "ok" | "bad" | "unclear"; evidence: string[] } | null;
  /** Bullets under "requirements / qualifications" */
  requirements: string[];
  /** Bullets under "preferred / nice to have" */
  niceToHave: string[];
  /** Catalogue skills the posting mentions: anywhere, in the requirements, in the nice-to-haves (independent of your CV) */
  skills: { found: string[]; required: string[]; nice: string[] };
  /** Sentences that mention years of experience */
  experience: string[];
  /** Most years any requirement asks for (see experienceReq) */
  experienceYears: number | null;
  /** Years of experience asked for, read for someone with a bachelor's degree (absent in postings read before it existed) */
  experienceReq?: ExperienceReq | null;
  /** required: the ad expects it · explicit: it says outright that it is mandatory ("zwingend", "required"…) · quote: where it says so */
  languages: { name: string; required: boolean; explicit?: boolean; quote?: string }[];
  /** Language the ad is written in (German and French ads in Switzerland usually need that language) */
  lang?: "de" | "fr" | "it" | "en" | null;
  /** The publication date is a job board's, not the company's */
  dateFrom?: string;
  /** Languages the source gave as data, kept so re-analysing the text does not lose them */
  sourceLangs?: { name: string; required: boolean; explicit?: boolean; quote?: string }[];
  degree: { level: "master" | "phd"; required: boolean } | null;
  policy: string[];
  chars: number;
  /** Full posting text (gzip + base64) so it can be re-analysed without downloading it again */
  textZ?: string;
  /** The company's site no longer has the posting (as of fetchedAt), even if a tracker still lists it */
  gone?: boolean;
  /** Set when loading without texts: whether the full text is stored (never saved) */
  hasText?: boolean;
  /** The application form, where the ATS publishes it (absent: not known) */
  form?: ApplicationForm | null;
}

/** An application form as the ATS publishes it (Greenhouse, Ashby, Lever, Workable). */
export interface ApplicationForm {
  /** ATS it was read from */
  from: string;
  /** A field for a cover letter you must fill, one you may fill, or no field for it at all */
  coverLetter: "required" | "optional" | "none";
  /** How the form names that field ("Cover Letter", "Additional information") */
  coverField?: string;
  /** With no cover letter field: a free-text box the form does have ("Additional information") */
  freeText?: string;
  /** Questions answered in writing (why this company, a project…), in the form's words */
  questions: { label: string; required: boolean; /** "If you're a human, leave this blank": a trap for bots and AI answers */ trap?: boolean }[];
}

export interface ExperienceNeed {
  years: number;
  /** About working ("professional", "industry", "in a similar role"), not just using a technology */
  professional: boolean;
  /** What counts: only work after graduating ("post-graduation"), only full-time work ("non-internship"),
   *  internships too ("internship experience is applicable"), or not said */
  counts: "post-grad" | "full-time" | "internships" | null;
  /** "or equivalent experience": it can be met in other ways */
  soft: boolean;
  quote: string;
}

export interface ExperienceReq {
  /** Requirements that apply, the most demanding first */
  needs: ExperienceNeed[];
  /** Upper limit ("up to 2 years", "no more than 2 years of full-time work"): an early-career role */
  max: { years: number; counts: ExperienceNeed["counts"]; /** "no more than" (true) or the top of a "0-2 years" range */ strict: boolean; quote: string } | null;
}

// ---------- companies and their application rules

export type PolicyScope = "intern" | "grad" | "all";

export interface PolicyRule {
  /** Which applications it covers: internship, new grad or both at once */
  scope: PolicyScope;
  /** hard = a limit that hides the rest · per-role = one per role, several roles allowed · soft = a recommendation · none = several allowed
   *  linked = one application counts for all its roles · cooldown = after an OA or interview you cannot apply again for windowDays */
  kind: "hard" | "per-role" | "soft" | "none" | "linked" | "cooldown";
  max: number | null;
  /** The limit's period, in days (null = per recruiting season) */
  windowDays: number | null;
  windowLabel: string;
  quote: string;
  url: string;
}

export interface CompanyPolicy {
  status: "found" | "none" | "error";
  checkedAt: string;
  /** posting = read from its postings · faq = the company's official page · manual = edited by you */
  origin: "posting" | "faq" | "manual";
  rules: PolicyRule[];
  note?: string;
}

export interface CompanyInfo {
  name: string;
  sector: string;
  prestige: Prestige;
  /** Pay level 1-5 */
  pay: number;
  aliases: string[];
  onList: boolean;
  policy?: CompanyPolicy;
}

// ---------- searches

export interface CrawlRun {
  board?: Board;
  id: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  sources: { name: string; listings: number; error?: string }[];
  added: string[];
  /** New offers whose fit with your CV is 2/5 or more */
  relevant?: number;
  /** Added offers that are really new: published after the previous search (or with no date) and not stale */
  fresh?: number;
  /** New offers not kept because you are not eligible */
  rejected?: number;
  updated: number;
  closed: number;
  reopened: number;
  enriched: number;
  error?: string;
}

export interface UiState {
  /** Offers first seen after this moment count as "New" until you open or mark them */
  newSeenAt: string | null;
}

/** An offer the crawler saw but did not keep because you are not eligible (only enough to skip it next time). */
export interface RejectedOffer {
  board?: Board;
  company: string;
  title: string;
  kind: Kind;
  reason: string;
  at: string;
  /** Graduation date it was judged against ("2027-03"): if your CV changes, it is judged again */
  grad: string;
  /** Whole years of experience on your CV when it was turned down for experience or seniority: judged again when that changes */
  exp?: number;
  /** Language it requires that your CV did not have: judged again once your CV has it */
  lang?: string;
}

export interface Database {
  version: 2;
  /** The board this copy was loaded for (its "New" marker and crawler runs) */
  board?: Board;
  ui?: UiState;
  /** Keyed by posting URL identity (see crawler/merge urlKey) */
  rejected?: Record<string, RejectedOffer>;
  generated: string;
  reference: Reference;
  applications: Application[];
  tracking: Record<string, Tracking>;
  postings: Record<string, PostingDetails>;
  companies: Record<string, CompanyInfo>;
  crawls: CrawlRun[];
}

export type TrackingPatch = Partial<Pick<Tracking, "status" | "interested" | "notes" | "trashed">> & {
  /** true: you have seen it (opened it or marked it); false: back to new */
  seen?: boolean;
};
