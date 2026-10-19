// Company names differ between trackers ("Susquehanna (SIG)", "SIG", "Susquehanna International
// Group"). The resolver maps them to the board's names; profiles carry the per-company values
// (difficulty, interview notes) the original board assigned, for classifying new offers.

import type { Application, CompanyInfo, InterviewType } from "../types";

export const ALIASES: Record<string, string[]> = {
  Sig: ["susquehanna", "susquehanna sig", "susquehanna international group", "susquehanna international", "sig"],
  TikTok: ["bytedance", "tiktok"],
  Citadel: ["citadel securities", "citadel"],
  "D. E. Shaw": ["de shaw", "d e shaw", "the de shaw group", "deshaw"],
  QRT: ["qube research technologies", "qube research and technologies", "qube rt", "qube rt qrt", "qube"],
  "Everpure (Pure Storage)": ["pure storage", "everpure"],
  "Superhuman (Grammarly)": ["grammarly", "superhuman"],
  Millennium: ["millennium management", "millennium"],
  CFM: ["capital fund management", "cfm"],
  "AQR Capital": ["aqr capital management", "aqr"],
  "IMC Trading": ["imc", "imc trading"],
  "Two Sigma": ["two sigma investments", "two sigma"],
  "Jump Trading": ["jump trading group", "jump"],
  "XTX Markets": ["xtx"],
  Virtu: ["virtu financial"],
  "Hudson River Trading": ["hrt", "hudson river trading"],
  "Man Group": ["man group", "man ahl"],
  Square: ["block", "square"],
  Wolverine: ["wolverine trading", "wolverine"],
  "Five Rings Capital": ["five rings"],
  "Old Mission Capital": ["old mission"],
  "Garda Capital Partners": ["garda capital", "garda"],
  "GSA Capital": ["gsa capital partners", "gsa"],
  Schonfeld: ["schonfeld strategic advisors", "schonfeld"],
  "Balyasny Asset Management": ["balyasny", "bam"],
  "Tower Research Capital": ["tower research", "tower"],
  "Belvedere Trading": ["belvedere"],
  "Maven Securities": ["maven"],
  "Akuna Capital": ["akuna"],
  Trexquant: ["trexquant investment"],
  Headlands: ["headlands technologies"],
  "Arrowstreet Capital": ["arrowstreet"],
  Bridgewater: ["bridgewater associates"],
  Point72: ["point72 asset management"],
  Voleon: ["the voleon group", "voleon"],
  Quantbot: ["quantbot technologies"],
  Wintermute: ["wintermute trading"],
  Meta: ["meta platforms", "facebook"],
  Google: ["alphabet", "google deepmind"],
  Amazon: ["amazon web services", "aws"],
  Nvidia: ["nvidia corporation"],
  Draftkings: ["draftkings"],
  "Zip HQ": ["zip"],
};

const SUFFIX = /\b(inc|llc|ltd|limited|plc|corp|corporation|co|company|the|holdings|lp|technologies|technology|international|global|management|group)\b/g;

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keys(name: string): string[] {
  const n = normName(name);
  const stripped = n.replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
  const out = [n, n.replace(/ /g, "")];
  if (stripped && stripped.length >= 3) out.push(stripped, stripped.replace(/ /g, ""));
  const paren = name.match(/\(([^)]+)\)/)?.[1];
  if (paren) out.push(normName(paren));
  const noParen = name.replace(/\([^)]*\)/g, "").trim();
  if (noParen !== name) out.push(normName(noParen));
  return [...new Set(out.filter(Boolean))];
}

/** Maps a tracker's company name to the board's company name (or null); `add` registers new ones. */
export function buildResolver(companies: Record<string, CompanyInfo>) {
  const map = new Map<string, string>();
  const add = (c: CompanyInfo) => {
    for (const k of keys(c.name)) map.set(k, c.name);
    for (const a of [...(c.aliases ?? []), ...(ALIASES[c.name] ?? [])]) for (const k of keys(a)) map.set(k, c.name);
  };
  for (const c of Object.values(companies)) add(c);
  const resolve = (raw: string): string | null => {
    for (const k of keys(raw)) {
      const hit = map.get(k);
      if (hit) return hit;
    }
    return null;
  };
  return Object.assign(resolve, { add });
}

// ---------- per-company values, derived from the offers already on the board

export interface CompanyProfile {
  difficultyByRole: Map<string, number>;
  difficulty: number;
  interview: Partial<Record<InterviewType, { confirmed: boolean; note: number }>>;
}

const mode = <T,>(xs: T[]): T | undefined => {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

export function buildProfiles(apps: Application[]): Map<string, CompanyProfile> {
  const by = new Map<string, Application[]>();
  for (const a of apps) by.set(a.company, [...(by.get(a.company) ?? []), a]);
  const out = new Map<string, CompanyProfile>();
  for (const [name, list] of by) {
    const roles = new Set(list.map((a) => a.role));
    const difficultyByRole = new Map<string, number>();
    for (const r of roles) difficultyByRole.set(r, mode(list.filter((a) => a.role === r).map((a) => a.difficulty))!);
    const interview: CompanyProfile["interview"] = {};
    for (const t of ["lc", "prac", "math", "ds"] as InterviewType[]) {
      const rows = list.filter((a) => a.interview.type === t);
      if (rows.length) interview[t] = { confirmed: rows.some((a) => a.interview.confirmed), note: mode(rows.map((a) => a.interview.note))! };
    }
    out.set(name, { difficultyByRole, difficulty: mode(list.map((a) => a.difficulty)) ?? 3, interview });
  }
  return out;
}

/** Interview note indices of the original board, used when a company has no example of that type. */
export const DEFAULT_INTERVIEW_NOTE: Record<InterviewType, number> = { lc: 5, prac: 4, math: 3, ds: 14 };
