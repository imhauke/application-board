// Pay for an offer: what the posting publishes when it does (US postings must), what the tracker
// lists, or an estimate from the company's pay tier, the city and the contract type.

import type { Application, PayRange, PostingDetails } from "./types";

/** Towns in Switzerland that the trackers list under "Europe" */
const SWISS_TOWN = /\b(z[üu]rich|geneva|gen[eè]ve|genf|basel|b[âa]le|bern|berne|lausanne|lugano|zug|winterthur|switzerland|schweiz|suisse)\b/i;

export type CompSource = "posted" | "tracker" | "estimate";

export interface Comp {
  source: CompSource;
  min: number;
  max: number;
  currency: string;
  period: PayRange["period"];
  /** All ranges the posting lists (several cities or levels) */
  all: PayRange[];
  quote?: string;
  /** Annualized midpoint in USD, for sorting */
  annualUsd: number;
}

/** Approximate FX to USD (Oct 2026), only for sorting and the € equivalent. */
export const FX: Record<string, number> = {
  USD: 1, EUR: 1.1, GBP: 1.3, CHF: 1.2, HKD: 0.128, CAD: 0.72, SGD: 0.76, AUD: 0.65, JPY: 0.0066, CNY: 0.14, INR: 0.0115, TWD: 0.031, KRW: 0.00072,
};

const PER_YEAR = { hour: 2080, month: 12, year: 1 } as const;

export const toAnnualUsd = (amount: number, currency: string, period: PayRange["period"]) => amount * PER_YEAR[period] * (FX[currency] ?? 1);

// ---------- tracker salary strings: "$60/hr", "$202k/yr", "300000", "CHF 83.000-126.000"

export function parseTrackerSalary(s: string, kind: Application["kind"] = "grad"): PayRange | null {
  const t = s.trim();
  if (!t) return null;
  const cur = /CHF/i.test(t) ? "CHF" : /£|GBP/.test(t) ? "GBP" : /€|EUR/.test(t) ? "EUR" : "USD";
  const nums = [...t.matchAll(/(\d[\d.,']*)\s*(k)?/gi)].map((m) => {
    const n = parseFloat(m[1].replace(/[.,'](?=\d{3}\b)/g, "").replace(",", "."));
    return m[2] ? n * 1000 : n;
  });
  if (!nums.length || !(nums[0] > 0)) return null;
  const min = nums[0];
  const max = nums[1] && nums[1] >= min ? nums[1] : min;
  // A bare number from a tracker: hourly when tiny; for internships up to ~40k it is a monthly figure
  const period: PayRange["period"] = /\/\s?h|hour/i.test(t)
    ? "hour"
    : /\/\s?mo|month/i.test(t)
      ? "month"
      : /\/\s?y|year|annual/i.test(t)
        ? "year"
        : min < 300
          ? "hour"
          : min < (kind === "intern" ? 40000 : 25000)
            ? "month"
            : "year";
  return { min, max, currency: cur, period, text: t, source: "text" };
}

// ---------- estimates

type Band = [number, number];
/** [tier 5, 4, 3, 2, 1] → [min, max]; new grad = base per year, internship = per month. */
interface Table {
  currency: string;
  grad: Band[];
  intern: Band[];
}

const k = (a: number, b: number): Band => [a * 1000, b * 1000];

const TABLES: Record<string, Table> = {
  US: { currency: "USD", grad: [k(200, 250), k(140, 185), k(105, 140), k(90, 120), k(75, 100)], intern: [k(17, 25), k(8.5, 11), k(6.5, 8.5), k(5, 7), k(4, 5.5)] },
  UK: { currency: "GBP", grad: [k(90, 140), k(60, 85), k(50, 65), k(40, 55), k(32, 45)], intern: [k(6, 9), k(3.5, 5), k(2.8, 3.8), k(2.2, 3), k(1.8, 2.4)] },
  CH: { currency: "CHF", grad: [k(140, 190), k(120, 150), k(95, 125), k(85, 105), k(75, 95)], intern: [k(8, 12), k(6, 8), k(3.5, 5.5), k(2.5, 4), k(2, 3)] },
  EU: { currency: "EUR", grad: [k(90, 130), k(60, 85), k(48, 65), k(40, 55), k(32, 45)], intern: [k(6, 9), k(3, 4.5), k(2, 3), k(1.5, 2.5), k(1, 2)] },
  HK: { currency: "HKD", grad: [k(800, 1200), k(450, 650), k(350, 500), k(300, 420), k(250, 350)], intern: [k(60, 90), k(30, 45), k(20, 30), k(15, 22), k(12, 18)] },
  CA: { currency: "CAD", grad: [k(140, 200), k(100, 135), k(80, 105), k(70, 90), k(60, 80)], intern: [k(12, 18), k(7, 9.5), k(5, 7), k(4, 5.5), k(3.5, 4.5)] },
  SG: { currency: "SGD", grad: [k(140, 200), k(90, 130), k(70, 95), k(60, 80), k(50, 70)], intern: [k(10, 15), k(5, 7), k(3.5, 5), k(2.5, 3.5), k(2, 3)] },
  AU: { currency: "AUD", grad: [k(150, 200), k(110, 140), k(85, 110), k(75, 95), k(65, 85)], intern: [k(9, 13), k(6, 8), k(4.5, 6), k(4, 5), k(3.5, 4.5)] },
  ASIA: { currency: "USD", grad: [k(60, 120), k(35, 70), k(25, 50), k(20, 40), k(15, 30)], intern: [k(4, 8), k(2, 4), k(1.2, 2.5), k(1, 2), k(0.8, 1.5)] },
};

export function marketOf(app: Application): keyof typeof TABLES {
  const loc = app.locations[0];
  if (!loc) return "US";
  const city = loc.city.toLowerCase();
  switch (loc.region) {
    case "London":
      return "UK";
    case "Zurich":
      return "CH";
    case "Hong Kong":
      return "HK";
    case "Canada":
      return "CA";
    case "Europe (other)":
    case "Remote EU":
      if (app.visas.find((v) => v.region === loc.region)?.visa === "uk") return "UK";
      if (SWISS_TOWN.test(loc.city)) return "CH";
      return "EU";
    case "Asia/Oceania":
      if (/singapore/.test(city)) return "SG";
      if (/sydney|melbourne|brisbane|perth/.test(city)) return "AU";
      return "ASIA";
    default:
      return "US";
  }
}

export function estimateFor(app: Application): Omit<Comp, "all" | "annualUsd" | "source"> {
  const table = TABLES[marketOf(app)];
  const tier = Math.min(5, Math.max(1, app.pay));
  const [min, max] = (app.kind === "intern" ? table.intern : table.grad)[5 - tier];
  return { min, max, currency: table.currency, period: app.kind === "intern" ? "month" : "year" };
}

/** Numbers as numbers, and weekly / bi-weekly amounts stored as yearly turned into monthly ones. */
function cleanRange(r: PayRange): PayRange {
  const out = { ...r, min: Number(r.min), max: Number(r.max) };
  if (out.period === "year" && out.min < 15000) {
    const f = /bi-?weekly|every (two|2) weeks/i.test(r.text) ? 26 / 12 : /per\s?week|weekly|\/\s?w(ee)?k\b/i.test(r.text) ? 52 / 12 : null;
    if (f) return { ...out, min: Math.round(out.min * f), max: Math.round(out.max * f), period: "month" };
  }
  return out;
}

const plausible = (r: PayRange) => r.min > 0 && r.max >= r.min && !(r.period === "year" && r.min < 10000);

function pick(ranges: PayRange[]): PayRange | null {
  const usable = ranges.map(cleanRange).filter(plausible);
  if (!usable.length) return null;
  return usable.find((r) => r.source === "structured") ?? usable[0];
}

export function compFor(app: Application, posting?: PostingDetails | null): Comp {
  const posted = pick(posting?.pay ?? []);
  if (posted) {
    const all = (posting?.pay ?? []).map(cleanRange).filter(plausible);
    return { source: "posted", min: posted.min, max: posted.max, currency: posted.currency, period: posted.period, all, quote: posted.text, annualUsd: toAnnualUsd((posted.min + posted.max) / 2, posted.currency, posted.period) };
  }
  const tracker = parseTrackerSalary(app.salary, app.kind);
  if (tracker) {
    return { source: "tracker", min: tracker.min, max: tracker.max, currency: tracker.currency, period: tracker.period, all: [tracker], quote: app.salary, annualUsd: toAnnualUsd((tracker.min + tracker.max) / 2, tracker.currency, tracker.period) };
  }
  const e = estimateFor(app);
  return { source: "estimate", ...e, all: [], annualUsd: toAnnualUsd((e.min + e.max) / 2, e.currency, e.period) };
}

// ---------- formatting

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CHF: "CHF ", HKD: "HK$", CAD: "C$", SGD: "S$", AUD: "A$", JPY: "¥", CNY: "CN¥", INR: "₹" };
const PERIOD: Record<PayRange["period"], string> = { hour: "/h", month: "/mo", year: "/yr" };

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function money(min: number, max: number, currency: string, period?: PayRange["period"]): string {
  const sym = SYMBOL[currency] ?? `${currency} `;
  const range = Math.abs(max - min) < 1 ? short(min) : `${short(min)}–${short(max)}`;
  const amount = `${sym}${range}`;
  return period ? `${amount}${PERIOD[period]}` : amount;
}

export const compLabel = (c: Pick<Comp, "min" | "max" | "currency" | "period">) => money(c.min, c.max, c.currency, c.period);

/** Equivalent in € per month (interns) or per year (grads), for comparing across cities. */
export function eurEquivalent(c: Pick<Comp, "min" | "max" | "currency" | "period">, per: "month" | "year"): string {
  const f = (n: number) => (toAnnualUsd(n, c.currency, c.period) / FX.EUR) / (per === "month" ? 12 : 1);
  return money(Math.round(f(c.min) / 100) * 100, Math.round(f(c.max) / 100) * 100, "EUR", per);
}

export const SOURCE_LABEL: Record<CompSource, string> = { posted: "posted", tracker: "from a tracker", estimate: "estimated" };
