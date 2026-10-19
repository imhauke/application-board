// Public sources the original board was built from. Each adapter returns normalized listings;
// classification and merging happen later.

import { parse as parseYaml } from "yaml";
import { decodeEntities } from "./html";
import { httpGet, httpJson, pool } from "./http";

export interface RawListing {
  source: string;
  key: string;
  company: string;
  title: string;
  url: string;
  locations: string[];
  kind: "intern" | "grad";
  season?: string;
  postedAt?: string;
  active: boolean;
  /** Pay as published by the tracker ("$60/hr", "$202k/yr", or a number in USD/year) */
  salary?: string;
  /** Role category given by the source (Kadoa), used before title heuristics */
  roleHint?: string;
  /** The source only lists quant firms */
  quant?: boolean;
  /** Kadoa's firm type (proprietary, hedge_fund, asset_manager…) */
  firmType?: string;
  /** Still listed, but not something we would add as a new row (past season, senior role…):
   *  used only to recognise offers already on the board. */
  matchOnly?: boolean;
  sponsorship?: string;
}

export interface SourceResult {
  name: string;
  listings: RawListing[];
  error?: string;
}

const RAW = "https://raw.githubusercontent.com";
const iso = (unix?: number) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : undefined);

// ---------- Simplify-format trackers (SimplifyJobs and vanshb03 forks)

interface SimplifyListing {
  id: string;
  company_name: string;
  title: string;
  url: string;
  locations: string[];
  active: boolean;
  is_visible?: boolean;
  terms?: string[];
  season?: string;
  date_posted?: number;
  category?: string;
  sponsorship?: string;
}

const SKIP_CATEGORY = /hardware|product/i;

async function simplifyLike(name: string, repo: string, kind: "intern" | "grad"): Promise<SourceResult> {
  const data = await httpJson<SimplifyListing[]>(`${RAW}/${repo}/dev/.github/scripts/listings.json`, { timeoutMs: 60000 });
  if (!data) return { name, listings: [], error: "could not download listings.json" };
  const listings: RawListing[] = [];
  for (const x of data) {
    if (!x.url) continue;
    // Hidden listings are kept to recognise (and close) offers already on the board
    let matchOnly = x.is_visible === false || (!!x.category && SKIP_CATEGORY.test(x.category));
    let season: string | undefined;
    if (kind === "intern") {
      const terms = x.terms?.length ? x.terms : x.season ? [`${x.season} 2027`] : ["Summer 2027"];
      // Fall 2027 needs you to still be enrolled after a spring graduation, so it is not added
      const current = terms.filter((t) => /2027/.test(t) && !/fall|autumn/i.test(t));
      if (!current.length) matchOnly = true;
      season = (current.length ? current : terms).join(", ");
    }
    listings.push({
      source: name,
      key: `${name}:${x.id}`,
      company: x.company_name,
      title: x.title,
      url: x.url,
      locations: x.locations ?? [],
      kind,
      season,
      postedAt: iso(x.date_posted),
      active: x.active && x.is_visible !== false,
      sponsorship: x.sponsorship,
      matchOnly,
    });
  }
  return { name, listings };
}

// ---------- speedyapply (markdown tables)

const SPEEDY_FILES: { file: string; kind: "intern" | "grad" }[] = [
  { file: "README.md", kind: "intern" },
  { file: "INTERN_INTL.md", kind: "intern" },
  { file: "NEW_GRAD_USA.md", kind: "grad" },
  { file: "NEW_GRAD_INTL.md", kind: "grad" },
];

function ageToDate(age: string, today = new Date()): string | undefined {
  const m = age.trim().match(/^(\d+)\s*(d|w|mo|y)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const days = m[2] === "d" ? n : m[2] === "w" ? n * 7 : m[2] === "mo" ? n * 30 : n * 365;
  return new Date(today.getTime() - days * 864e5).toISOString().slice(0, 10);
}

async function speedyapply(): Promise<SourceResult> {
  const name = "speedyapply";
  const listings: RawListing[] = [];
  const errors: string[] = [];
  for (const { file, kind } of SPEEDY_FILES) {
    const r = await httpGet(`${RAW}/speedyapply/2027-SWE-College-Jobs/main/${file}`, { timeoutMs: 60000 }).catch(() => null);
    if (!r || r.status !== 200) {
      errors.push(file);
      continue;
    }
    let quantSection = false;
    let headers: string[] = [];
    for (const line of r.text.split("\n")) {
      if (/<!-- TABLE_QUANT_START/.test(line)) quantSection = true;
      if (/<!-- TABLE_QUANT_END/.test(line)) quantSection = false;
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells[0] === "Company") {
        headers = cells.map((c) => c.toLowerCase());
        continue;
      }
      if (cells[0].startsWith("---") || !headers.length) continue;
      const col = (h: string) => cells[headers.indexOf(h)] ?? "";
      const company = decodeEntities(col("company").replace(/<[^>]+>/g, "")).trim();
      const url = col("posting").match(/href="([^"]+)"/)?.[1];
      if (!company || !url) continue;
      const location = decodeEntities(col("location").replace(/<[^>]+>/g, " ")).replace(/\s*\+\d+$/, "").trim();
      listings.push({
        source: name,
        key: `${name}:${url}`,
        company,
        title: decodeEntities(col("position").replace(/<[^>]+>/g, "")).trim(),
        url,
        locations: location.split(/\s*[;/]\s*|<br>/).filter(Boolean),
        kind,
        postedAt: ageToDate(col("age")),
        active: true,
        salary: col("salary") || undefined,
        quant: quantSection,
      });
    }
  }
  return { name, listings, error: errors.length ? `missing ${errors.join(", ")}` : undefined };
}

// ---------- Kadoa quant jobs

interface KadoaJob {
  id: string;
  firmName: string;
  jobTitle: string;
  datePosted?: string;
  url: string;
  applyUrl?: string;
  locations: string[];
  salary: number | null;
  roleCategory: string;
  seniorityLevel: string;
  firmType?: string;
}

async function kadoa(): Promise<SourceResult> {
  const name = "Kadoa quant";
  const data = await httpJson<KadoaJob[]>(`${RAW}/kadoa-org/quant-jobs/main/public/data/jobs.json`, { timeoutMs: 60000 });
  if (!data) return { name, listings: [], error: "could not download jobs.json" };
  return {
    name,
    listings: data
      .map((j) => ({
        source: name,
        key: `${name}:${j.id}`,
        company: j.firmName,
        title: j.jobTitle,
        url: j.url || j.applyUrl || "",
        locations: j.locations ?? [],
        kind: j.seniorityLevel === "intern" ? ("intern" as const) : ("grad" as const),
        postedAt: j.datePosted,
        active: true,
        salary: j.salary ? String(j.salary) : undefined,
        roleHint: j.roleCategory,
        quant: true,
        firmType: j.firmType,
        matchOnly: j.seniorityLevel !== "intern" && j.seniorityLevel !== "junior",
      }))
      .filter((l) => l.url),
  };
}

// ---------- Northwestern FinTech quant internships (one YAML per firm)

interface NuFirm {
  name: string;
  locations?: string;
  roles?: { role_type: string; links: { url: string; label?: string }[] }[];
}

const NU_ROLE: Record<string, string> = { QT: "Quantitative Trader Intern", QR: "Quantitative Researcher Intern", SWE: "Software Engineer Intern", QD: "Quantitative Developer Intern" };

async function nuFintech(): Promise<SourceResult> {
  const name = "NWFT quant";
  const tree = await httpJson<{ tree: { path: string; type: string }[] }>(
    "https://api.github.com/repos/northwesternfintech/2027QuantInternships/git/trees/main?recursive=1",
  );
  if (!tree) return { name, listings: [], error: "could not read the repository" };
  const files = tree.tree.filter((t) => t.type === "blob" && /^data\/.+\.ya?ml$/.test(t.path));
  const listings: RawListing[] = [];
  await pool(files, 6, async (f) => {
    const r = await httpGet(`${RAW}/northwesternfintech/2027QuantInternships/main/${f.path}`).catch(() => null);
    if (!r || r.status !== 200) return;
    let firm: NuFirm;
    try {
      firm = parseYaml(r.text) as NuFirm;
    } catch {
      return;
    }
    for (const role of firm.roles ?? []) {
      for (const link of role.links ?? []) {
        listings.push({
          source: name,
          key: `${name}:${link.url}`,
          company: firm.name,
          title: `${NU_ROLE[role.role_type] ?? `${role.role_type} Intern`}${link.label ? ` (${link.label})` : ""}`,
          url: link.url,
          locations: (firm.locations ?? "").split(/\s*[,;/]\s*|\s+and\s+/).filter(Boolean),
          kind: "intern",
          season: "Summer 2027",
          active: true,
          roleHint: role.role_type === "QT" ? "quantitative_trading" : role.role_type === "QR" ? "quantitative_research" : role.role_type === "SWE" ? "software_engineering" : "quantitative_development",
          quant: true,
        });
      }
    }
  });
  return { name, listings };
}

export interface SourceDef {
  name: string;
  run: () => Promise<SourceResult>;
}

export const SOURCES: SourceDef[] = [
  { name: "Simplify", run: () => simplifyLike("Simplify", "SimplifyJobs/Summer2027-Internships", "intern") },
  { name: "Simplify NG", run: () => simplifyLike("Simplify NG", "SimplifyJobs/New-Grad-Positions", "grad") },
  { name: "vanshb03", run: () => simplifyLike("vanshb03", "vanshb03/Summer2027-Internships", "intern") },
  { name: "vanshb03 NG", run: () => simplifyLike("vanshb03 NG", "vanshb03/New-Grad-2027", "grad") },
  { name: "speedyapply", run: speedyapply },
  { name: "Kadoa quant", run: kadoa },
  { name: "NWFT quant", run: nuFintech },
];

export async function fetchAllSources(onSource?: (r: SourceResult) => void, sources: SourceDef[] = SOURCES): Promise<SourceResult[]> {
  return Promise.all(
    sources.map(async (s) => {
      let r: SourceResult;
      try {
        r = await s.run();
      } catch (e) {
        r = { name: s.name, listings: [], error: (e as Error).message };
      }
      onSource?.(r);
      return r;
    }),
  );
}
