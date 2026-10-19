// Classifies a raw listing the same way the original board did: region and visa per city, role
// from the title, eligibility for someone graduating in 2027, CV, fit, score and priority.
// The weights in `scoreFor` were fitted on the 1,389 hand-scored offers of the original board.

import type { CvKind, Eligibility, InterviewType, Kind, Priority, Region, VisaCode } from "../types";
import { normalizeTitle, NOT_TECH_LOCAL } from "./titles";

// ---------- locations

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const CA_PROVINCES = "ON|BC|QC|AB|MB|NS|NB|SK|NL|PE";

const UK_CITIES = /\b(london|cambridge|oxford|bristol|manchester|edinburgh|glasgow|belfast|reading|leeds|birmingham|guildford|brighton|newcastle|cardiff|uk|united kingdom|england|scotland|wales|northern ireland|great britain)\b/i;
const SWISS = /\b(z[üu]rich|geneva|gen[eè]ve|zug|basel|bern|lausanne|lugano|switzerland|schweiz|suisse)\b/i;
const EUROPE =
  /\b(amsterdam|rotterdam|the hague|eindhoven|utrecht|netherlands|dublin|cork|galway|ireland|paris|clichy|lyon|toulouse|nice|sophia antipolis|france|berlin|munich|m[üu]nchen|hamburg|frankfurt|cologne|stuttgart|germany|deutschland|madrid|barcelona|m[áa]laga|valencia|spain|lisbon|porto|portugal|milan|milano|rome|turin|italy|warsaw|krak[óo]w|wroc[łl]aw|gda[ńn]sk|pozna[ńn]|poland|prague|brno|czech|czechia|vienna|austria|stockholm|gothenburg|sweden|copenhagen|aarhus|denmark|oslo|norway|helsinki|finland|brussels|belgium|luxembourg|bucharest|cluj|ia[șs]i|romania|sofia|bulgaria|belgrade|serbia|budapest|hungary|athens|greece|tallinn|estonia|riga|latvia|vilnius|lithuania|zagreb|croatia|ljubljana|slovenia|bratislava|slovakia|limassol|cyprus|malta|kyiv|ukraine|europe|emea)\b/i;
const HK = /\bhong kong\b|\bhk\b/i;
const ASIA =
  /\b(singapore|shanghai|beijing|shenzhen|hangzhou|guangzhou|chengdu|china|taipei|hsinchu|taiwan|tokyo|osaka|japan|seoul|korea|bengaluru|bangalore|hyderabad|gurgaon|gurugram|mumbai|pune|chennai|noida|delhi|india|sydney|melbourne|brisbane|perth|australia|auckland|wellington|new zealand|kuala lumpur|malaysia|jakarta|indonesia|manila|philippines|bangkok|thailand|ho chi minh|hanoi|vietnam)\b/i;
const CANADA = new RegExp(String.raw`\b(toronto|montr[ée]al|vancouver|waterloo|ottawa|calgary|edmonton|burnaby|richmond|kitchener|markham|mississauga|quebec|canada)\b|,\s*(${CA_PROVINCES})\b`, "i");
const NYC = /\b(new york|nyc|manhattan|brooklyn)\b/i;
const US = new RegExp(
  String.raw`,\s*(${US_STATES})\b|\b(usa|united states|u\.s\.|us)\b|\b(chicago|boston|san francisco|seattle|austin|houston|dallas|miami|greenwich|stamford|philadelphia|bala cynwyd|princeton|jersey city|hoboken|atlanta|denver|los angeles|san jose|mountain view|palo alto|menlo park|sunnyvale|redmond|bellevue|cupertino|santa clara|san mateo|washington|pittsburgh|boca raton|charlotte|plano|irving|mclean|richmond|salt lake city|minneapolis|detroit|baltimore|raleigh|durham|nashville|portland|san diego|phoenix|columbus|cambridge, ma)\b`,
  "i",
);
const REMOTE = /\bremote\b/i;

export interface Place {
  city: string;
  region: Region;
}

const CITY_FIX: Record<string, string> = { zurich: "Zürich", "zürich": "Zürich", "new york city": "New York", nyc: "New York", montreal: "Montréal" };

function cleanCity(raw: string): string {
  let c = raw.replace(/\s+/g, " ").trim();
  c = c.replace(/,\s*(USA|US|United States|UK|United Kingdom|England|Switzerland|Netherlands|Ireland|France|Germany|Spain|Canada|Singapore|China|Japan|India|Australia|Hong Kong SAR|Taiwan)$/i, "");
  c = c.replace(new RegExp(String.raw`,\s*(${US_STATES}|${CA_PROVINCES})$`), "");
  return CITY_FIX[c.toLowerCase()] ?? c;
}

/** Maps a tracker location string ("New York, NY", "Remote in USA", "Zurich, Switzerland") to our regions. */
export function placeOf(loc: string): Place | null {
  const l = loc.trim();
  if (!l) return null;
  if (REMOTE.test(l)) {
    if (EUROPE.test(l) || UK_CITIES.test(l) || /\beu\b/i.test(l)) return { city: "Remote EU", region: "Remote EU" };
    if (CANADA.test(l)) return { city: "Remote Canada", region: "Canada" };
    if (US.test(l) || /^remote$/i.test(l)) return { city: "Remote US", region: "Remote US" };
  }
  if (NYC.test(l)) return { city: "New York", region: "NY" };
  if (/\blondon\b/i.test(l) && !/ontario|\bON\b/.test(l)) return { city: "London", region: "London" };
  if (/\bz[üu]rich\b/i.test(l)) return { city: "Zürich", region: "Zurich" };
  if (HK.test(l)) return { city: "Hong Kong", region: "Hong Kong" };
  if (SWISS.test(l) || UK_CITIES.test(l) || EUROPE.test(l)) return { city: cleanCity(l), region: "Europe (other)" };
  if (CANADA.test(l)) return { city: cleanCity(l), region: "Canada" };
  if (ASIA.test(l)) return { city: cleanCity(l), region: "Asia/Oceania" };
  if (US.test(l)) return { city: cleanCity(l), region: "USA (other)" };
  return null;
}

export function visaFor(place: Place, kind: Kind): VisaCode {
  switch (place.region) {
    case "Zurich":
    case "Remote EU":
      return "eu";
    case "London":
      return "uk";
    case "Europe (other)":
      return UK_CITIES.test(place.city) ? "uk" : "eu";
    case "Hong Kong":
      return "hk";
    case "Canada":
      return "ca";
    case "Asia/Oceania":
      return "asia";
    default:
      return kind === "intern" ? "us_j1" : "us_h1b";
  }
}

// ---------- roles

const NOT_TECH =
  /recruit|talent acquisition|sales|marketing|account (executive|manager)|finance (intern|analyst)|accounting|legal|counsel|compliance|human resources|\bhr\b|people partner|business (development|analyst|operations)|operations analyst|strategy and operations|product manager|program manager|project manager|designer|\bux\b|procurement|logistics|facilities|investment banking|wealth|audit|\btax\b|actuar/i;
/** Hardware and lab roles were never part of the board, even when the title says "software". */
const HARDWARE = /fpga|asic|silicon|analog|\bcad\b|\brf\b|verilog|vhdl|firmware|mechanical|electrical engineer|hardware engineer|manufacturing|technician|chemical|civil engineer|thermal|optical|controls engineer/i;
/** PhD-only and pure research-scientist roles were excluded from the original board, and so are senior roles. */
const RESEARCH_ONLY = /research scientist|postdoc|\b(senior|staff|principal)\b|\bsr\.? /i;
const phdOnly = (t: string) => /\bph\.?d\b/i.test(t) && !/\b(bs|ba|b\.s\.|bachelor|undergrad)/i.test(t);

export function roleFor(title: string, hint?: string): string | null {
  // German, French and Italian titles (European postings) are read in English
  const t = normalizeTitle(title).toLowerCase();
  if (NOT_TECH_LOCAL.test(title) && !/software|developer|engineer|entwickler|informati|data|devops|cloud/i.test(title)) return null;
  if (HARDWARE.test(t) || RESEARCH_ONLY.test(t) || phdOnly(t)) return null;
  if (NOT_TECH.test(t) && !/software|developer|engineer/.test(t)) return null;
  if (hint) {
    const byHint: Record<string, string> = {
      quantitative_research: "Quant Research",
      quantitative_trading: "Quant Trading",
      quantitative_development: "Quant Dev/SWE",
      hft_systems: "Quant Dev/SWE",
      data_science: "Data Science",
      machine_learning: "AI/ML/Data Eng",
      software_engineering: "SWE",
    };
    if (byHint[hint]) {
      if (byHint[hint] === "SWE" && /site reliability|\bsre\b|infrastructure|devops|network|linux|systems engineer|production engineer/.test(t)) return "SRE/Infra";
      return byHint[hint];
    }
    return null;
  }
  if (/quant(itative)?\s+(research|researcher)|research(er)?\b.*\bquant|alpha research|quantitative analyst/.test(t)) return "Quant Research";
  if (/\btrader\b|trading (analyst|intern|assistant)|quant(itative)? trading/.test(t) && !/engineer|developer|software|systems/.test(t)) return "Quant Trading";
  if (/quant(itative)? (developer|dev|engineer|software)|trading systems|low[- ]latency|\bhft\b|execution (engineer|developer)/.test(t)) return "Quant Dev/SWE";
  if (/site reliability|\bsre\b|infrastructure|devops|platform engineer|production engineer|systems engineer|system engineer|cloud engineer|network engineer|\blinux\b|\bhpc\b|operations engineer|security engineer|cybersecurity|system administrator|sysadmin|\bict\b/.test(t)) return "SRE/Infra";
  if (/data scien|analytics|data analyst|business intelligence|\bbi (analyst|developer|engineer)|risk (analyst|analytics|model)|financial data|market data analyst|reporting analyst/.test(t)) return "Data Science";
  if (/machine learning|\bml\b|\bai\b|artificial intelligence|data engineer|deep learning|\bllm|computer vision|\bnlp\b|applied scientist|research engineer/.test(t)) return "AI/ML/Data Eng";
  if (/software|developer|engineer|swe\b|sde\b|programmer|coding|technology (intern|analyst|graduate)|tech (intern|analyst)/.test(t)) return "SWE";
  return null;
}

export function fitFor(role: string, title: string): number {
  const t = title.toLowerCase();
  switch (role) {
    case "SRE/Infra":
      return 5;
    case "Quant Research":
      return 1;
    case "Quant Trading":
      return 2;
    case "Data Science":
      // Analysing data (SQL, Python, dashboards) fits a CV built on data pipelines; statistics research does not
      return /analyst|analytics|business intelligence|\bbi\b|reporting/.test(t) && !/scientist|research/.test(t) ? 3 : 2;
    case "AI/ML/Data Eng":
      if (/research|scientist|deep learning/.test(t)) return 2;
      if (/data engineer|platform|ai engineer|applied ai|infrastructure|data platform/.test(t)) return 5;
      return 4;
    case "Quant Dev/SWE":
      if (/c\+\+|kdb|front[- ]?end|desk quant|quant(itative)? developer/.test(t)) return 3;
      if (/systems|infrastructure|operations|platform|python/.test(t)) return 5;
      return 4;
    default:
      if (/mobile|\bios\b|android|graphics|robotics|embedded|game/.test(t)) return 2;
      if (/front[- ]?end|\bui\b|c\+\+/.test(t)) return 3;
      if (/back[- ]?end|platform|full[- ]?stack|infrastructure|data platform|distributed|agent|reliability/.test(t)) return 5;
      return 4;
  }
}

// ---------- eligibility (graduating in 2027, not enrolled afterwards)

/** Indices into reference.eligibilityNotes (kept from the original board). */
export const ELIG = { usSummer: 0, lastYear: 1, masters: 2, offCycle: 3, grad: 4, intake2026: 5, earlyCareer: 6, finalYear: 7, midDegree: 8, grads2028: 9 } as const;

export function eligibilityFor(kind: Kind, regions: Region[], title: string, season = ""): { eligibility: Eligibility; note: number } {
  const t = `${title} ${season}`.toLowerCase();
  if (/2028|class of 2029|2029/.test(t) && !/2027/.test(t)) return { eligibility: "no", note: ELIG.grads2028 };
  if (/sophomore|freshman|first[- ]year|penultimate|explore|step intern|spring week|insight (week|program)|discovery/.test(t)) return { eligibility: "no", note: ELIG.midDegree };
  if (/\bph\.?d\b|master'?s|\bms\b|\bmsc\b|m\.s\./.test(t) && !/bs\/ms|bachelor/.test(t)) return { eligibility: "warn", note: ELIG.masters };
  if (kind === "grad") {
    if (/2026/.test(t) && !/2027/.test(t)) return { eligibility: "maybe", note: ELIG.intake2026 };
    if (/early career/.test(t)) return { eligibility: "ok", note: ELIG.earlyCareer };
    return { eligibility: "ok", note: ELIG.grad };
  }
  if (/off[- ]cycle|winter|spring|january|february|co-?op/.test(t) && !/summer/.test(t)) return { eligibility: "maybe", note: ELIG.offCycle };
  const usOnly = regions.length > 0 && regions.every((r) => r === "NY" || r === "USA (other)" || r === "Remote US");
  if (usOnly) return { eligibility: "warn", note: ELIG.usSummer };
  return { eligibility: "maybe", note: ELIG.lastYear };
}

// ---------- CV, interview, score

export function cvFor(role: string, sector: string, title: string): { kind: CvKind; reason: string } {
  const t = title.toLowerCase();
  if (role === "AI/ML/Data Eng" || role === "Data Science" || role === "Quant Research") return { kind: "swe", reason: "M-role" };
  if (role === "Quant Trading" || role === "Quant Dev/SWE") return { kind: "quant", reason: "C-quant" };
  // Reliability, infrastructure and "systems" roles: a service running in production says more than a low-level project
  if (role === "SRE/Infra") return { kind: "swe", reason: "M-role" };
  if (/compiler|kernel|embedded|firmware|driver|toolchain|low[- ]latency|\bhpc\b/.test(t)) return { kind: "quant", reason: "C-role" };
  if (/front[- ]?end|full[- ]?stack|product|web|\bui\b|mobile|growth|systems|infrastructure|back[- ]?end|distributed|platform|storage|network/.test(t)) return { kind: "swe", reason: "M-role" };
  const bySector: Record<string, { kind: CvKind; reason: string }> = {
    "Big Tech": { kind: "quant", reason: "C-bigtech" },
    "Quant/Trading": { kind: "quant", reason: "C-quant" },
    "Banking/Fin. data": { kind: "quant", reason: "C-bank" },
    "Infra/Dev tools": { kind: "quant", reason: "C-infra" },
    "Autonomy/Robotics": { kind: "quant", reason: "C-sys" },
  };
  return bySector[sector] ?? { kind: "swe", reason: "M-product" };
}

export function interviewTypeFor(role: string): InterviewType | null {
  if (role === "Quant Trading" || role === "Quant Research") return "math";
  if (role === "Data Science") return "ds";
  return null; // company default (LeetCode or practical)
}

const PRESTIGE_N = { S: 3, A: 2, B: 1, C: 0 } as const;
const ELIG_W: Record<Eligibility, number> = { ok: 0, maybe: -1.54, warn: -3.17, no: -8.88 };
const REGION_W: Record<Region, number> = {
  London: 3.71, NY: 2.54, Zurich: 2.07, "Hong Kong": 2.0, "Europe (other)": 1.79, "Remote EU": 1.79,
  Canada: 0.35, "Remote US": 0.03, "USA (other)": -0.03, "Asia/Oceania": 0,
};
const VISA_W: Record<VisaCode, number> = { eu: 0.65, hk: 0.63, us_j1: 0.45, asia: 0, ca: -0.48, uk: -0.86, us_h1b: -1.68 };

export function scoreFor(x: {
  pay: number; difficulty: number; fit: number; prestige: keyof typeof PRESTIGE_N; eligibility: Eligibility; region: Region; kind: Kind; visa: VisaCode;
}): number {
  const s =
    4.51 + 0.12 * x.pay - 0.36 * x.difficulty + 1.09 * x.fit + 0.48 * PRESTIGE_N[x.prestige] + ELIG_W[x.eligibility] + REGION_W[x.region] + (x.kind === "grad" ? 0.74 : 0) + VISA_W[x.visa];
  return Math.round(s * 100) / 100;
}

const TOP_REGIONS: Region[] = ["London", "NY", "Zurich", "Hong Kong", "Europe (other)", "Remote EU"];

export function priorityFor(score: number, eligibility: Eligibility, bestRegion: Region): Priority {
  if (eligibility === "no") return "D";
  if (score >= 10.2 && TOP_REGIONS.includes(bestRegion)) return "A";
  if (score >= 8.1) return "B";
  return "C";
}

/** City order inside a row, as in the original board: preferred cities first, then Europe, then the rest. */
export const REGION_ORDER: Region[] = ["Zurich", "London", "NY", "Hong Kong", "Europe (other)", "Remote EU", "Remote US", "USA (other)", "Canada", "Asia/Oceania"];
