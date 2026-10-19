// Fetches the full text of a job posting from its ATS. Each adapter turns a careers URL into the
// ATS's public JSON endpoint when one exists; everything else falls back to the page HTML
// (JSON-LD JobPosting first, then the visible text).

import type { ApplicationForm, PayRange } from "../types";
import { ashbyForm, greenhouseForm, leverForm, workableForm, type GreenhouseQuestion } from "./forms";
import { decodeEntities, htmlToLines, jsonLd } from "./html";
import { httpGet, httpJson } from "./http";

export type RawPay = PayRange;

export interface FetchedPosting {
  ok: boolean;
  via: string;
  url: string;
  error?: string;
  title?: string;
  lines: string[];
  pay: RawPay[];
  datePosted?: string;
  validThrough?: string;
  /** Set when datePosted is a job board's publication date rather than the company's own (the board's name) */
  dateFrom?: string;
  /** Languages the source states as structured data, not in the text */
  langs?: { name: string; required: boolean; explicit?: boolean; quote?: string }[];
  /** The application form (cover letter field, written questions), where the ATS publishes it */
  form?: ApplicationForm;
}

const fail = (via: string, url: string, error: string): FetchedPosting => ({ ok: false, via, url, error, lines: [], pay: [] });

/** A removed posting that still answers 200 */
const GONE = /^(page not found|404\b|diese stelle ist (besetzt|nicht mehr verf[üu]gbar)|das inserat wurde (vom arbeitgeber )?entfernt|cette offre n['’]est plus (disponible|en ligne)|questa offerta non [èe] pi[ùu] disponibile|this (job|position|posting|role) (is no longer|has been (filled|closed|removed))|(the )?(job|position|posting) (you('re| are) looking for )?(is no longer available|no longer exists|has (expired|been removed|closed))|sorry,? (this|the) (job|position|page))/i;
export const GONE_ERROR = "the posting no longer exists on the company's site";

// ---------- Greenhouse

/** Board tokens for companies that host Greenhouse behind their own domain (gh_jid=… or /position/<id>). */
const GREENHOUSE_TOKENS: Record<string, string> = {
  "Hudson River Trading": "wehrtyou",
  "Jane Street": "janestreet",
  WorldQuant: "worldquant",
  Databricks: "databricks",
  "Jump Trading": "jumptrading",
  "Five Rings Capital": "fiveringsllc",
  "Tower Research Capital": "towerresearchcapital",
  "Akuna Capital": "akunacapital",
  "Old Mission Capital": "oldmissioncapital",
  QRT: "quberesearchandtechnologies",
  Virtu: "virtu",
  "Flow Traders": "flowtraders",
  "Squarepoint Capital": "squarepointcapital",
  "Belvedere Trading": "belvederetrading",
  "Maven Securities": "mavensecurities",
  "GSA Capital": "gsacapital",
  "Engineers Gate": "engineersgate",
  Anduril: "andurilindustries",
  DRW: "drweng",
};

const tokenCache = new Map<string, string | null>();

function tokenCandidates(company: string): string[] {
  const base = company.toLowerCase().replace(/&/g, "and");
  const plain = base.replace(/[^a-z0-9]/g, "");
  const trimmed = base
    .replace(/\b(capital|trading|group|llc|inc|securities|technologies|technology|asset management|partners|markets|research)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return [...new Set([GREENHOUSE_TOKENS[company], plain, trimmed, plain + "llc", plain + "careers"].filter(Boolean) as string[])];
}

interface GreenhouseJob {
  title: string;
  content: string;
  updated_at?: string;
  first_published?: string;
  location?: { name: string };
  pay_input_ranges?: { min_cents: number; max_cents: number; currency_type: string; title?: string }[];
  questions?: GreenhouseQuestion[];
}

async function greenhouseJob(token: string, id: string) {
  return httpJson<GreenhouseJob>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}?pay_transparency=true&questions=true`);
}

function fromGreenhouse(job: GreenhouseJob, url: string, token: string): FetchedPosting {
  const html = decodeEntities(job.content ?? "");
  const pay: RawPay[] = (job.pay_input_ranges ?? [])
    .filter((p) => p.min_cents > 0)
    .map((p) => {
      const min = p.min_cents / 100;
      const max = p.max_cents / 100;
      return {
        min,
        max,
        currency: p.currency_type,
        period: min < 500 ? "hour" : min < 25000 ? "month" : "year",
        text: `${p.title ?? "Pay range"}: ${p.currency_type} ${min.toLocaleString("en-US")} – ${max.toLocaleString("en-US")}`,
        source: "structured",
      } as RawPay;
    });
  return {
    ok: true,
    via: `greenhouse:${token}`,
    url,
    title: job.title,
    lines: htmlToLines(html),
    pay,
    datePosted: job.first_published?.slice(0, 10),
    form: greenhouseForm(job.questions),
  };
}

async function greenhouse(url: string, company: string): Promise<FetchedPosting | null> {
  const u = new URL(url);
  const direct = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (/greenhouse\.io$/.test(u.hostname) && direct && !u.hostname.includes(".eu.")) {
    const job = await greenhouseJob(direct[1], direct[2]);
    return job ? fromGreenhouse(job, url, direct[1]) : null;
  }
  const id =
    u.searchParams.get("gh_jid") ??
    (u.hostname.includes("greenhouse.io") ? u.searchParams.get("token") : null) ??
    (/janestreet\.com|worldquant\.com|databricks\.com/.test(u.hostname) ? (url.match(/(\d{7,})\/?$/)?.[1] ?? u.searchParams.get("id")) : null);
  if (!id) return null;
  const cached = tokenCache.get(company);
  const candidates = cached ? [cached] : cached === null ? [] : tokenCandidates(company);
  for (const token of candidates) {
    const job = await greenhouseJob(token, id);
    if (job) {
      tokenCache.set(company, token);
      return fromGreenhouse(job, url, token);
    }
  }
  if (cached === undefined) tokenCache.set(company, null);
  return null;
}

// ---------- Lever

interface LeverPosting {
  text: string;
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
  createdAt?: number;
  salaryRange?: { min: number; max: number; currency: string; interval: string };
}

async function lever(url: string): Promise<FetchedPosting | null> {
  const m = url.match(/jobs\.(eu\.)?lever\.co\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  for (const api of m[1] ? ["api.eu.lever.co", "api.lever.co"] : ["api.lever.co", "api.eu.lever.co"]) {
    const p = await httpJson<LeverPosting>(`https://${api}/v0/postings/${m[2]}/${m[3]}`);
    if (!p) continue;
    const html = [p.description ?? "", ...(p.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), p.additional ?? ""].join("\n");
    const pay: RawPay[] = p.salaryRange
      ? [
          {
            min: p.salaryRange.min,
            max: p.salaryRange.max,
            currency: p.salaryRange.currency,
            period: /hour/.test(p.salaryRange.interval) ? "hour" : /month/.test(p.salaryRange.interval) ? "month" : "year",
            text: `${p.salaryRange.currency} ${p.salaryRange.min}–${p.salaryRange.max} (${p.salaryRange.interval})`,
            source: "structured",
          },
        ]
      : [];
    return {
      ok: true,
      via: "lever",
      url,
      title: p.text,
      lines: htmlToLines(html),
      pay,
      datePosted: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : undefined,
      form: await leverForm(m[1] ? "jobs.eu.lever.co" : "jobs.lever.co", m[2], m[3]).catch(() => undefined),
    };
  }
  return null;
}

// ---------- Ashby

interface AshbyJob {
  id: string;
  title: string;
  descriptionHtml?: string;
  publishedAt?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: { compensationType: string; interval: string; currencyCode: string; minValue: number; maxValue: number }[];
  };
}
const ashbyBoards = new Map<string, Promise<AshbyJob[] | null>>();

async function ashby(url: string): Promise<FetchedPosting | null> {
  const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const org = decodeURIComponent(m[1]);
  if (!ashbyBoards.has(org)) {
    ashbyBoards.set(
      org,
      httpJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`).then((r) => r?.jobs ?? null),
    );
  }
  const board = await ashbyBoards.get(org);
  const job = board?.find((j) => j.id === m[2]);
  // The board answered and the posting is not on it: it was taken down
  if (!job) return board ? fail("ashby", url, GONE_ERROR) : null;
  const pay: RawPay[] = (job.compensation?.summaryComponents ?? [])
    .filter((c) => c.compensationType === "Salary" && c.minValue > 0)
    .map((c) => {
      // Intervals look like "1 HOUR", "1 YEAR", "2 WEEK": weeks become months
      const weeks = c.interval.match(/(\d+)\s*WEEK/i);
      const factor = weeks ? 52 / 12 / Number(weeks[1]) : 1;
      return {
        min: Math.round(c.minValue * factor),
        max: Math.round(c.maxValue * factor),
        currency: c.currencyCode,
        period: weeks ? "month" : /HOUR/i.test(c.interval) ? "hour" : /MONTH/i.test(c.interval) ? "month" : "year",
        text: job.compensation?.compensationTierSummary ?? "",
        source: "structured",
      } as RawPay;
    });
  const form = await ashbyForm(org, m[2]).catch(() => undefined);
  return { ok: true, via: "ashby", url, title: job.title, lines: htmlToLines(job.descriptionHtml ?? ""), pay, datePosted: job.publishedAt?.slice(0, 10), form };
}

// ---------- Workday

async function workday(url: string): Promise<FetchedPosting | null> {
  const u = new URL(url);
  let api: string | null = null;
  if (/\.myworkdayjobs\.com$/.test(u.hostname)) {
    const tenant = u.hostname.split(".")[0];
    const parts = u.pathname.split("/").filter(Boolean);
    if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? "")) parts.shift();
    const site = parts.shift();
    if (!site || parts[0] !== "job") return null;
    api = `https://${u.hostname}/wday/cxs/${tenant}/${site}/${parts.join("/")}`;
  } else if (/myworkdaysite\.com$/.test(u.hostname)) {
    const m = u.pathname.match(/\/recruiting\/([^/]+)\/([^/]+)\/(job\/.+)$/);
    if (!m) return null;
    api = `https://${u.hostname}/wday/cxs/${m[1]}/${m[2]}/${m[3]}`;
  }
  if (!api) return null;
  const res = await httpGet(api, { headers: { accept: "application/json" } });
  // Workday answers a JSON error (403 "S22", 404) for postings it no longer shows; live ones answer 200
  if ([403, 404, 410].includes(res.status) && /"errorCode"/.test(res.text)) return fail("workday", url, GONE_ERROR);
  let info: { title: string; jobDescription: string; startDate?: string; postedOn?: string } | undefined;
  try {
    info = res.status === 200 ? JSON.parse(res.text).jobPostingInfo : undefined;
  } catch {
    info = undefined;
  }
  if (!info) return null;
  return { ok: true, via: "workday", url, title: info.title, lines: htmlToLines(info.jobDescription ?? ""), pay: [], datePosted: info.startDate };
}

// ---------- Eightfold (Microsoft, Millennium)

const EIGHTFOLD_DOMAINS: Record<string, string> = { "apply.careers.microsoft.com": "microsoft.com", "mlp.eightfold.ai": "mlp.com" };

async function eightfold(url: string): Promise<FetchedPosting | null> {
  const u = new URL(url);
  const domain = EIGHTFOLD_DOMAINS[u.hostname];
  const id = u.pathname.match(/\/job\/(\d+)/)?.[1];
  if (!domain || !id) return null;
  const r = await httpJson<{ name?: string; job_description?: string; t_create?: number }>(`https://${u.hostname}/api/apply/v2/jobs/${id}?domain=${domain}`);
  if (!r?.job_description) return null;
  // t_create is when the posting was created (t_update changes with every edit)
  const datePosted = r.t_create ? new Date(r.t_create * 1000).toISOString().slice(0, 10) : undefined;
  return { ok: true, via: "eightfold", url, title: r.name, lines: htmlToLines(r.job_description), pay: [], datePosted };
}

// ---------- Workable

async function workable(url: string, company: string): Promise<FetchedPosting | null> {
  const m = url.match(/apply\.workable\.com\/(?:([^/]+)\/)?j\/([A-Z0-9]+)/i);
  if (!m) return null;
  const account = m[1] ?? company.toLowerCase().replace(/[^a-z0-9]/g, "");
  const r = await httpJson<{ title: string; description?: string; requirements?: string; benefits?: string; published?: string }>(
    `https://apply.workable.com/api/v2/accounts/${account}/jobs/${m[2]}`,
  );
  if (!r) return null;
  const html = [r.description, r.requirements ? `<h3>Requirements</h3>${r.requirements}` : "", r.benefits ? `<h3>Benefits</h3>${r.benefits}` : ""].join("\n");
  const form = await workableForm(m[2]).catch(() => undefined);
  return { ok: true, via: "workable", url, title: r.title, lines: htmlToLines(html), pay: [], datePosted: r.published?.slice(0, 10), form };
}

// ---------- Oracle Recruiting Cloud (Oracle, Uber…): public REST API behind the candidate site

interface OracleJob {
  Title: string;
  ExternalPostedStartDate?: string | null;
  ExternalDescriptionStr?: string | null;
  ExternalResponsibilitiesStr?: string | null;
  ExternalQualificationsStr?: string | null;
}

async function oracleCloud(url: string): Promise<FetchedPosting | null> {
  const u = new URL(url);
  const path = `${u.pathname}${u.hash.replace(/^#/, "/")}`;
  const m = path.match(/\/sites\/([^/]+)\/job\/(\d+)/);
  if (!m) return null;
  // careers.oracle.com is Oracle's own front for the same requisitions
  const host = u.hostname === "careers.oracle.com" ? "eeho.fa.us2.oraclecloud.com" : u.hostname;
  const site = u.hostname === "careers.oracle.com" ? "CX_45001" : m[1];
  const api = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${m[2]}%22,siteNumber=${site}`;
  const r = await httpJson<{ items?: OracleJob[] }>(api);
  if (!r) return null;
  const job = r.items?.[0];
  if (!job) return fail("oracle", url, GONE_ERROR);
  const part = (head: string, html?: string | null) => (html ? [head, ...htmlToLines(decodeEntities(html))] : []);
  const lines = [
    ...part("Description", job.ExternalDescriptionStr),
    ...part("Responsibilities", job.ExternalResponsibilitiesStr),
    ...part("Qualifications", job.ExternalQualificationsStr),
  ];
  return { ok: true, via: "oracle", url, title: job.Title, lines, pay: [], datePosted: job.ExternalPostedStartDate?.slice(0, 10) };
}

// ---------- Apple (job embedded as JSON in the page)

interface AppleJob {
  jobNumber: string;
  postingTitle: string;
  jobSummary?: string;
  description?: string;
  responsibilities?: string;
  minimumQualifications?: string;
  preferredQualifications?: string;
  postDateInGMT?: string;
}

/** Apple's page only has legal text outside this data, so there is no fallback to the generic reader. */
async function apple(url: string): Promise<FetchedPosting> {
  const res = await httpGet(url);
  if (res.status >= 400) return fail("apple", url, `HTTP ${res.status}`);
  const m = res.text.match(/__staticRouterHydrationData = JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
  if (!m) return fail("apple", url, GONE_ERROR);
  let job: AppleJob | undefined;
  const walk = (o: unknown): void => {
    if (job || !o || typeof o !== "object") return;
    const x = o as Partial<AppleJob>;
    if (x.jobNumber && x.postingTitle) job = x as AppleJob;
    else for (const v of Object.values(o)) walk(v);
  };
  try {
    walk(JSON.parse(JSON.parse(m[1])));
  } catch {
    return fail("apple", url, "could not read the posting's data");
  }
  if (!job) return fail("apple", url, GONE_ERROR);
  const bullets = (t?: string) => (t ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => `• ${l}`);
  const lines = [
    ...(job.jobSummary ? ["Summary", job.jobSummary] : []),
    ...(job.description ? ["Description", job.description] : []),
    ...(job.responsibilities ? ["Responsibilities", ...bullets(job.responsibilities)] : []),
    "Minimum Qualifications",
    ...bullets(job.minimumQualifications),
    "Preferred Qualifications",
    ...bullets(job.preferredQualifications),
  ];
  return { ok: true, via: "apple", url, title: job.postingTitle, lines, pay: [], datePosted: job.postDateInGMT?.slice(0, 10) };
}

/** SmartRecruiters: the posting's sections and its release date. */
async function smartRecruiters(url: string): Promise<FetchedPosting | null> {
  const m = new URL(url).pathname.match(/^\/([^/]+)\/(\d{6,})/);
  if (!m) return null;
  const res = await httpGet(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`, { headers: { accept: "application/json" } });
  if (res.status === 404 || res.status === 410) return fail("smartrecruiters", url, GONE_ERROR);
  let p: { name?: string; releasedDate?: string; active?: boolean; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
  try {
    p = JSON.parse(res.text);
  } catch {
    return null;
  }
  if (p.active === false) return fail("smartrecruiters", url, GONE_ERROR);
  const sections = Object.values(p.jobAd?.sections ?? {}).filter((s) => s.text);
  const lines = sections.flatMap((s) => [...(s.title ? [s.title] : []), ...htmlToLines(decodeEntities(s.text!))]);
  return { ok: true, via: "smartrecruiters", url, title: p.name, lines, pay: [], datePosted: p.releasedDate?.slice(0, 10) };
}

// ---------- Generic page (JSON-LD JobPosting, then visible text)

interface LdJob {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } };
}

function ldPay(ld: LdJob): RawPay[] {
  const v = ld.baseSalary?.value;
  // JSON-LD often carries numbers as strings ("45")
  const min = Number(v?.minValue ?? v?.value);
  if (!(min > 0) || !ld.baseSalary?.currency) return [];
  const unit = (v?.unitText ?? "").toUpperCase();
  return [
    {
      min,
      max: Number(v?.maxValue ?? min) || min,
      currency: ld.baseSalary.currency,
      period: unit.startsWith("HOUR") ? "hour" : unit.startsWith("MONTH") ? "month" : "year",
      text: `${ld.baseSalary.currency} ${min}${v?.maxValue ? `–${v.maxValue}` : ""} ${unit}`.trim(),
      source: "structured",
    },
  ];
}

/** The part of a careers page that holds the posting: <main>/<article> when they are substantial. */
function mainHtml(html: string): string {
  for (const tag of ["main", "article"]) {
    const m = html.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "i"))?.[0];
    if (m && m.length > 2500) return m;
  }
  return html;
}

const FOOTER = /^(privacy( policy| notice)?|cookie|©|copyright|terms( of (use|service))?|all rights reserved|follow us|similar jobs|related jobs|more jobs|other jobs|share this (job|role|position)|back to (jobs|search|all jobs)|apply for this job|equal (employment )?opportunity)/i;

const CONTENT = /^(job description|description|about the (role|job|team|position|opportunity)|the role|responsibilities|what you('ll| will) (do|work on)|qualifications|minimum qualifications|requirements|about you|who you are|your role|role overview|overview)\b/i;
const words = (ls: string[]) => ls.join(" ").split(/\s+/).length;

/** Drops navigation before the posting and footers after it. Falls back to the whole page when unsure. */
export function focusLines(lines: string[], title?: string): string[] {
  const norm = (l: string) => l.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = title ? norm(title).slice(0, 40) : "";
  const titleIdx = t.length > 6 ? lines.findIndex((l) => norm(l).includes(t)) : -1;
  const contentIdx = lines.findIndex((l) => l.length < 80 && CONTENT.test(l.replace(/[:：]$/, "")));
  const start = titleIdx >= 0 ? Math.max(0, titleIdx - 2) : contentIdx >= 0 ? Math.max(0, contentIdx - 12) : 0;
  const after = Math.max(start, contentIdx) + 10;
  let end = lines.length;
  for (let j = after; j < lines.length; j++) {
    if (FOOTER.test(lines[j])) {
      end = j;
      break;
    }
  }
  const focused = lines.slice(start, Math.min(end, start + 500));
  return words(focused) >= 120 ? focused : lines.slice(0, 500);
}

async function generic(url: string, title?: string): Promise<FetchedPosting> {
  const u = new URL(url);
  const target = /icims\.com$/.test(u.hostname) ? `${u.origin}${u.pathname.replace(/\/job$/, "")}/job?in_iframe=1` : url;
  let res;
  try {
    res = await httpGet(target);
  } catch (e) {
    return fail("html", url, (e as Error).message);
  }
  if (res.status === 404 || res.status === 410) return fail("html", url, GONE_ERROR);
  if (res.status >= 400) return fail("html", url, `HTTP ${res.status}`);
  const job = jsonLd(res.text).find((x) => {
    const t = (x as LdJob)?.["@type"];
    return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
  }) as LdJob | undefined;
  if (job?.description) {
    return {
      ok: true,
      via: "jsonld",
      url,
      title: job.title,
      lines: htmlToLines(decodeEntities(job.description)),
      pay: ldPay(job),
      datePosted: job.datePosted?.slice(0, 10),
      validThrough: job.validThrough?.slice(0, 10),
    };
  }
  const lines = focusLines(htmlToLines(mainHtml(res.text)).filter((l) => l.length < 2000), title);
  if (lines.slice(0, 12).some((l) => l.length < 120 && GONE.test(l))) return fail("html", url, GONE_ERROR);
  const words = lines.join(" ").split(/\s+/).length;
  if (words < 120) return fail("html", url, "page without readable content (probably rendered with JavaScript)");
  return { ok: true, via: "html", url, lines, pay: [] };
}

/** Fetches a posting with the most specific adapter available. Never throws. */
export async function fetchPosting(url: string, company: string, title?: string): Promise<FetchedPosting> {
  try {
    const host = new URL(url).hostname;
    const specific =
      (url.includes("greenhouse.io") || url.includes("gh_jid=") || /janestreet\.com|worldquant\.com|databricks\.com/.test(host)
        ? await greenhouse(url, company)
        : null) ??
      (host.includes("lever.co") ? await lever(url) : null) ??
      (host.includes("ashbyhq.com") ? await ashby(url) : null) ??
      (/myworkdayjobs\.com$|myworkdaysite\.com$/.test(host) ? await workday(url) : null) ??
      (EIGHTFOLD_DOMAINS[host] ? await eightfold(url) : null) ??
      (host === "apply.workable.com" ? await workable(url, company) : null) ??
      (host === "jobs.apple.com" && /\/details\/\d+/.test(url) ? await apple(url) : null) ??
      (/\.oraclecloud\.com$/.test(host) || host === "careers.oracle.com" ? await oracleCloud(url) : null) ??
      (host === "jobs.smartrecruiters.com" ? await smartRecruiters(url) : null);
    return specific ?? (await generic(url, title));
  } catch (e) {
    return fail("error", url, (e as Error).message);
  }
}
