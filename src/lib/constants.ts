import type { CvKind, Eligibility, InterviewType, Priority, Prestige, Region, Status } from "./types";

export const PREFERRED_REGIONS: Region[] = ["NY", "London", "Zurich", "Hong Kong"];
export const EU_REGIONS: Region[] = ["Europe (other)", "Remote EU"];

export const REGION_LABEL: Record<Region, string> = {
  NY: "New York",
  London: "London",
  Zurich: "Zurich",
  "Hong Kong": "Hong Kong",
  "Europe (other)": "Europe",
  "Remote EU": "Remote EU",
  "USA (other)": "USA",
  "Remote US": "Remote US",
  Canada: "Canada",
  "Asia/Oceania": "Asia / Oceania",
};

export const LOCATION_FILTERS = [
  ["all", "All"],
  ["preferred", "Preferred + Europe"],
  ["London", "London"],
  ["NY", "New York"],
  ["Zurich", "Zurich"],
  ["Hong Kong", "Hong Kong"],
  ["eu", "Rest of Europe"],
  ["other", "Outside Europe"],
] as const;
export type LocationFilter = (typeof LOCATION_FILTERS)[number][0];

export const KIND_FILTERS = [
  ["all", "All"],
  ["intern", "Internship"],
  ["grad", "New grad"],
] as const;
export const KIND_LABEL = { intern: "Internship", grad: "New grad" } as const;

export const ROLES = ["SWE", "SRE/Infra", "Quant Dev/SWE", "AI/ML/Data Eng", "Quant Trading", "Quant Research", "Data Science"];
export const ROLE_LABEL: Record<string, string> = {
  SWE: "SWE",
  "SRE/Infra": "SRE / Infra",
  "Quant Dev/SWE": "Quant Dev",
  "AI/ML/Data Eng": "AI / Data",
  "Quant Trading": "Quant Trading",
  "Quant Research": "Quant Research",
  "Data Science": "Data Science",
};

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  ok: "Eligible",
  maybe: "Check",
  warn: "Unlikely",
  no: "Not eligible",
};
/** Closing reason of an offer whose posting the company has taken down while trackers still list it */
export const GONE_REASON = "taken down from the company's site";

export const ELIGIBILITY_ORDER: Record<Eligibility, number> = { ok: 0, maybe: 1, warn: 2, no: 3 };

export const INTERVIEW_LABEL: Record<InterviewType, string> = { lc: "LeetCode", prac: "Practical", math: "Math", ds: "SQL" };
export const INTERVIEW_FILTERS = [["all", "All"], ["lc", "LeetCode"], ["prac", "Practical"], ["math", "Math"], ["ds", "SQL"]] as const;

/** The two CVs are the same but for one project: the Quant one has a low-level project (a compiler, systems), the SWE one a project in production. */
export const CV_INFO: Record<CvKind, { label: string; project: string; file: string }> = {
  quant: { label: "CV Quant", project: "the low-level project", file: "cv/quant.pdf" },
  swe: { label: "CV SWE", project: "the production project", file: "cv/swe.pdf" },
};
export const CV_FILTERS = [["all", "All"], ["quant", "Quant"], ["swe", "SWE"]] as const;

export const STATUS_OPTIONS: [Status, string][] = [
  ["", "—"],
  ["preparing", "Preparing"],
  ["applied", "Applied"],
  ["interview", "OA / Interview"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
  ["dropped", "Dropped"],
];
export const DONE_STATUSES = new Set<Status>(["applied", "interview", "offer", "rejected", "dropped"]);
/** You sent the application (a rejection still counts against the company's limits) */
export const APPLIED_STATUSES = new Set<Status>(["applied", "interview", "offer", "rejected"]);
/** Still going: the "In progress" view */
export const IN_PROCESS_STATUSES = new Set<Status>(["applied", "interview", "offer"]);
/** You did their assessment or an interview (waiting periods start here) */
export const ASSESSED_STATUSES = new Set<Status>(["interview", "offer"]);

export const PRIORITY_ORDER: Record<Priority, number> = { A: 0, B: 1, C: 2, D: 3, X: 4 };
export const PRESTIGE_ORDER: Record<Prestige, number> = { S: 0, A: 1, B: 2, C: 3 };
