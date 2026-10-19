// Turns a posting's text into facts, independent of your CV: posted pay, graduation/enrolment
// sentences, required vs nice-to-have bullets, the skills each part mentions, years of experience,
// languages and degree it requires, and any limit on applications. Your CV is compared later
// (lib/fit.ts), so updating the CV never requires downloading postings again.

import { gzipSync, gunzipSync } from "node:zlib";
import { gradVerdict, type GradDate } from "../grad";
import { findSkills } from "../skills";
import type { ExperienceNeed, ExperienceReq, PostingDetails } from "../types";
import type { FetchedPosting, RawPay } from "./posting";

export type GradCheck = NonNullable<PostingDetails["grad"]>;

const DEFAULT_GRAD: GradDate = { year: 2027, month: 3 };

// ---------- sentences

export function sentences(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // Not after abbreviations ("mind. B2", "z.B. Java", "e.g. Python"), which are not the end of a sentence
    for (const s of line
      .replace(/^[•\-–*·]\s*/, "")
      .split(/(?<=[.!?])(?<!\b(?:mind|Mind|min|max|ca|bzw|bspw|inkl|evtl|ggf|etc|vs|Nr|Dr|Prof|resp|approx|incl|env|z\.B|u\.a|e\.g|i\.e|p\.ex)\.)\s+(?=[A-Z(])/)) {
      const t = s.trim();
      if (t.length > 3) out.push(t);
    }
  }
  return out;
}

const clip = (s: string, n = 280) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

// ---------- pay

const CUR = String.raw`(?:US\$|USD|CA\$|CAD|C\$|AU\$|AUD|A\$|S\$|SGD|HK\$|HKD|CHF|GBP|EUR|JPY|CNY|RMB|INR|[$£€¥₹])`;
const NUM = String.raw`\d{1,3}(?:[,.'’ ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const PAY_RE = new RegExp(String.raw`(${CUR})\s?(${NUM})\s?([kK])?(?:\s?(?:-|–|—|to|and)\s?(?:${CUR})?\s?(${NUM})\s?([kK])?)?`, "g");
const PAY_CONTEXT = /salary|pay range|base pay|pay rate|compensation|wage|hourly|stipend|per (hour|year|month|annum|week)|an hour|annual|annually|bi-?weekly|weekly|\/\s?(yr|hr|hour|year|month|week|wk)\b/i;
const NOT_PAY = /billion|million|\bbn\b|funding|raised|revenue|valuation|assets under|aum\b|donat|relocation|sign[- ]on|bonus|stock|equity|401|tuition|reimburse|gym|allowance|credit|differential|clearance|additional|housing|education|learning|wellness|fitness|commut|phone|internet|home office|conference|meal|lunch|travel|referral/i;

const CURRENCY: Record<string, string> = {
  $: "USD", "US$": "USD", USD: "USD", "£": "GBP", GBP: "GBP", "€": "EUR", EUR: "EUR", CHF: "CHF", S$: "SGD", SGD: "SGD",
  HK$: "HKD", HKD: "HKD", C$: "CAD", "CA$": "CAD", CAD: "CAD", A$: "AUD", "AU$": "AUD", AUD: "AUD", "¥": "JPY", JPY: "JPY", CNY: "CNY", RMB: "CNY", "₹": "INR", INR: "INR",
};

function parseNum(raw: string, k?: string): number {
  let s = raw.replace(/[ '’]/g, "");
  if (/[.,]\d{3}(?![\d])/.test(s) && !/[.,]\d{1,2}$/.test(s)) s = s.replace(/[.,]/g, "");
  else if (/,\d{3}/.test(s)) s = s.replace(/,(?=\d{3})/g, "");
  s = s.replace(",", ".");
  const n = parseFloat(s);
  return k ? n * 1000 : n;
}

/** Weekly and bi-weekly amounts become monthly ones. */
function perMonthFactor(window: string): number | null {
  if (/bi-?weekly|every (two|2) weeks|fortnight/i.test(window)) return 26 / 12;
  if (/per\s?week|\/\s?w(ee)?k\b|weekly|a week/i.test(window)) return 52 / 12;
  return null;
}

function periodOf(window: string, min: number): RawPay["period"] | null {
  if (/per\s?hour|\/\s?h(ou)?r\b|hourly|an hour/i.test(window)) return "hour";
  if (/per\s?month|\/\s?mo(nth)?\b|monthly|a month/i.test(window)) return "month";
  if (/per\s?(year|annum)|\/\s?y(ea)?r\b|annual|yearly|a year|salary range/i.test(window)) return "year";
  if (min < 300) return "hour";
  if (min >= 30000) return "year";
  return null;
}

export function extractPay(lines: string[]): RawPay[] {
  const out: RawPay[] = [];
  for (const s of sentences(lines)) {
    if (!PAY_CONTEXT.test(s)) continue;
    for (const m of s.matchAll(PAY_RE)) {
      const before = s.slice(Math.max(0, (m.index ?? 0) - 90), m.index ?? 0);
      const after = s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 60);
      if (NOT_PAY.test(before.slice(-45) + after.slice(0, 25))) continue;
      let min = parseNum(m[2], m[3]);
      let max = m[4] ? parseNum(m[4], m[5] ?? m[3]) : min;
      if (!(min > 0) || max < min || max > min * 4) continue;
      const near = s.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40);
      const factor = perMonthFactor(near);
      if (factor) {
        min = Math.round(min * factor);
        max = Math.round(max * factor);
      }
      const period = factor ? "month" : periodOf(before + m[0] + after, min);
      if (!period) continue;
      if (period === "year" && min < 15000 && !["JPY", "INR", "CNY"].includes(CURRENCY[m[1]])) continue;
      out.push({ min, max, currency: CURRENCY[m[1]] ?? m[1], period, text: clip(s, 240), source: "text" });
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.currency}${p.min}${p.max}${p.period}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- graduation / enrolment

const GRAD_HINT =
  /graduat|immatrikul|eingeschrieben|studium|studierst|semester|absolvent|abschluss|berufseinst|pflichtpraktikum|praktikumssemester|hochschulpraktikum|dipl[ôo]m|[ée]tudiant|fin d['’][ée]tudes|stage obligatoire|convention de stage|laurea|neolaureat|iscritt|studente|tirocinio curriculare|\b20\d\d grads?\b|enrol|returning to (school|university|college|your studies)|class of 20\d\d|final[- ]year|penultimate|degree (completion|conferred)|conferred|completion of (your|their|the) degree|currently (pursuing|enrolled|a student|an undergraduate)|expected (graduation|to graduate)|recent(ly)? grad|matriculat|full[- ]time student|rising (junior|senior)|sophomore|freshman|second[- ]to[- ]last|semester (remaining|left)|year of (study|university)/i;

export function extractGrad(lines: string[], kind: "intern" | "grad" = "intern", grad: GradDate = DEFAULT_GRAD): GradCheck | null {
  const hits = sentences(lines).filter((s) => GRAD_HINT.test(s) && s.length < 600);
  if (!hits.length) return null;
  const { verdict, ordered } = gradVerdict(hits, kind, grad);
  return { verdict, evidence: ordered.slice(0, 4).map((s) => clip(s)) };
}

// ---------- requirement sections

const REQ_HEADING =
  /^(minimum |basic |required |key |core )?(qualifications?|requirements?|skills( and experience)?|experience( and skills)?|what you('ll)? (need|bring|have)|what we('re| are) looking for|what we look for|about you|who you are|you (have|bring|are|might be)|you should have|your (profile|background|skills|experience)|profile|ideal candidate|the ideal candidate|must[- ]haves?|we expect|competencies|requisitos|perfil)\b/i;
const NICE_HEADING =
  /^(preferred|desired|bonus|nice[- ]to[- ]haves?|pluses|desirable|additional|it would be (great|nice)|it's a plus|ideally|we('d| would) love|even better|extra credit|good to have|preferred qualifications)\b/i;

const BULLET = /^[•\-–*·]\s/;
/** Website boilerplate that sometimes sits in the same list as the requirements. */
const BOILERPLATE = /recruiting agenc|interview (prep|process)|equal (employment )?opportunity|accommodation|disabilit|inclusive culture|privacy (policy|notice)|visit our|click here|apply now|follow us|benefits include|we offer|our (benefits|perks)|discriminat|e-verify|criminal histor|lie detector|fair chance|background check|drug[- ]free/i;

function isHeading(l: string) {
  const h = l.replace(/[:：]$/, "");
  return l.length < 80 && !BULLET.test(l) && (REQ_HEADING.test(h) || NICE_HEADING.test(h) || /:$/.test(l));
}

export function extractSections(lines: string[]): { required: string[]; nice: string[] } {
  const required: string[] = [];
  const nice: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].replace(/[:：]$/, "");
    if (head.length > 80 || BULLET.test(lines[i])) continue;
    const bucket = NICE_HEADING.test(head) ? nice : REQ_HEADING.test(head) ? required : null;
    if (!bucket) continue;
    let taken = 0;
    for (let j = i + 1; j < lines.length && taken < 14; j++) {
      const n = lines[j];
      const isBullet = BULLET.test(n);
      if (!isBullet && isHeading(n)) break;
      if (!isBullet && taken && n.length < 90) break;
      const text = n.replace(/^[•\-–*·]\s*/, "");
      if (text.length > 12 && !BOILERPLATE.test(text)) {
        bucket.push(clip(text, 240));
        taken++;
      }
    }
  }
  if (!required.length) {
    // No headings: bullets that read like requirements
    for (const l of lines) {
      if (BULLET.test(l) && /experience|proficien|knowledge|degree|familiar|understanding|\babilit(y|ies)\b|skills|strong|fluent/i.test(l) && !BOILERPLATE.test(l)) {
        required.push(clip(l.replace(/^[•\-–*·]\s*/, ""), 240));
        if (required.length >= 10) break;
      }
    }
  }
  return { required: uniq(required), nice: uniq(nice.filter((x) => !required.includes(x))) };
}

// ---------- experience

const NUMW = String.raw`\d{1,2}(?:\.\d{1,2})?|zero|one|two|three|four|five|six|seven|eight|nine|ten`;
/** "3+ years", "3-5 years", "three (3) years", "0.6-2 years", "3 months - 2 years" (not "2-year program", "15 years ago") */
const YEARS_RE = new RegExp(
  String.raw`(?:\b(\d{1,2})\s*months?\s*(?:-|–|to)\s*)?\b(${NUMW})(?:\s*\(\d{1,2}\))?\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(${NUMW})(?:\s*\(\d{1,2}\))?\s*\+?\s*)?(?:years?|yrs?)(?!\s*(?:old|ago))\b(?:['’]s?)?`,
  "gi",
);
const WORD_NUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (x: string) => WORD_NUM[x.toLowerCase()] ?? Number(x);

/** Words that make "N years" about experience */
const EXP_CONTEXT =
  /experience|industry|professional|employment|career|\bwork(ing|ed)?\b|\b(role|position|capacity)\b|programming|coding|developing|building|writing|designing|engineering|hands-on|as an? \w/i;
/** About working (not just using a technology, which coursework and projects can cover) */
const PROFESSIONAL =
  /professional|industry|work(ing)? experience|related experience|relevant experience|full[- ]time|employment|non[- ]internship|post[- ]?(graduat|degree)|after graduat|in (a|an|the) [\w\s/-]{0,30}(role|position|capacity|setting|environment)|job offered|occupation|commercial|career experience|production experience|experience as an?\b|working (as|in)\b|in the industry/i;
const POST_GRAD_ONLY = /post[- ]?(graduat|degree)|after graduat|since graduat|following graduation/i;
const FULL_TIME_ONLY = /non[- ]internship|not including internships|excluding internships|full[- ]time (professional |paid |industry )*(work|experience|employment)|years? of full[- ]time/i;
const INTERNSHIPS_COUNT = /(including|to include|incl\.?) (\w+ )?internships?|internships?[^.;)]{0,50}\bcount\b|internships? (experience )?(is |are )?(applicable|included)/i;
/** "2 years of study", "4+ years of computer science fundamentals": school counts */
const EDUCATION = /fundamentals|coursework|education|academic|\bstud(y|ies)\b|school|university|college|degree program|of (undergraduate|graduate) (study|studies)/i;
/** Company facts, programme lengths and time windows, not requirements */
const COMPANY_FACT =
  /founded|history|track record of (success|growth|returns)|anniversary|since (19|20)\d\d|in business|of (operation|operating|existence|profitab|growth|returns|trading history)/i;
/** "we have over 20 years of experience", "for more than 15 years", "for the past 3 years", "a Portfolio Manager with 10+ years" */
const COMPANY_BEFORE =
  /\b(we|our [\w ]{0,20})\s*(have|has|['’]ve)\b[^.;]{0,40}$|\bfor (over |more than |nearly |almost )?$|\b(the )?(past|last|next|first)\s*$|\b(led|managed|headed|run|founded|built) by\b[^.;]{0,60}$|\b(manager|founder|partner|leader|head|director|ceo|cto|engineers|colleagues|mentors?|members|traders|researchers|alumni)\s+(with|who have|having)\s*$/i;
/** Benefits sentences ("for the first five years of employment") */
const BENEFITS = /paid time off|vacation|accru|\bpto\b|vest(ing|s)\b|401\(k\)|parental leave|sabbatical|per pay period|holiday/i;
const PROGRAMME_AFTER = /^\s*(?:long\s+)?(?:program|programme|rotation|rotational|contract|commitment|fixed[- ]term|degree|course|scheme|apprenticeship|plan|placement|assignment|tenure|vesting|period|cycle|journey|track)\b/i;
const UPPER_BEFORE = /(?:up to|maximum of|max(?:imum)?\.?|no more than|not more than|less than|fewer than|under|at most|below)\s*$/i;
const UPPER_AFTER = /^\s*(?:or less|or fewer|max(?:imum)?\b|at most)/i;
const PREFERRED = /preferred|a plus\b|ideally|nice[- ]to[- ]have|bonus|desired|desirable|an advantage|advantageous|beneficial|would be great/i;
/** "Bachelor's degree, OR 3+ years of experience", "OR 2+ years … in lieu of a degree" */
const IN_LIEU = /in lieu of|instead of (a |your )?degree|in place of a degree|without a (\w+ )?degree/i;
const OR_GRADS = /\bor (a |as a )?(recent|new) grad|recent grad(uate)?s? (or|and)\b|new grads? (or|and)\b|\bor (a )?(current )?student/i;
const MASTER_PATH = /\b(master['’]?s?|m\.?sc?\b|ms\b|graduate degree|advanced degree|ph\.?d|doctorate|doctoral)/i;
const BACHELOR_PATH = /\b(bachelor['’]?s?|b\.?sc?\b|bs\b|ba\b|b\.a\.|undergraduate)/i;

type Section = "req" | "nice" | "other";

// German, French and Italian: "mindestens 3 Jahre Berufserfahrung", "mehrjährige Erfahrung",
// "erste Berufserfahrung", "3 ans d'expérience", "esperienza pluriennale"…
const LOCAL_NUM: Record<string, number> = {
  ein: 1, eine: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, funf: 5, sechs: 6,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5,
};
const LOCAL_YEARS =
  /\b(\d{1,2}|ein(?:e[mr]?)?|zwei|drei|vier|f[üu]nf|sechs|une?|deux|trois|quatre|cinq|uno|due|tre|quattro|cinque)\s*(?:\+|plus)?\s*(?:(?:-|–|bis|à|a)\s*(\d{1,2}))?\s*\+?\s*(?:jahre?n?|ans?|anni)\b/gi;
const LOCAL_EXP = /erfahrung|exp[ée]rience|esperienza|praxis/i;
const LOCAL_PROFESSIONAL = /berufserfahrung|praxiserfahrung|berufspraxis|professionnelle|en entreprise|lavorativa|professionale/i;
const LOCAL_SEVERAL =
  /mehrj[äa]hrige|langj[äa]hrige|plusieurs ann[ée]es|exp[ée]rience (solide|significative|confirm[ée]e|approfondie)|pluriennale|comprovata esperienza|several years|many years|multiple years|extensive (professional |industry |work )experience/i;
const LOCAL_SOME = /einige jahre|quelques ann[ée]es|alcuni anni/i;
const LOCAL_ENTRY =
  /erste (berufs|praxis)?erfahrung|berufseinst|keine berufserfahrung|premi[eè]re exp[ée]rience|d[ée]butant|jeune dipl[ôo]m|prima esperienza|neolaureat|no (prior |previous )?(professional |work )?experience (is )?(required|needed|necessary)|first (professional|work) experience/i;
const LOCAL_UPPER_BEFORE = /(bis zu|maximal|h[öo]chstens|weniger als|jusqu['’]à|moins de|fino a|meno di|max\.?)\s*$/i;

/** Adds what a German, French or Italian sentence says about years of experience. */
function localExperience(s: string, section: Section, hits: YearsHit[], caps: NonNullable<ExperienceReq["max"]>[], quotes: string[]) {
  if (!LOCAL_EXP.test(s) || s.length > 600) return;
  const quote = clip(s, 240);
  const professional = LOCAL_PROFESSIONAL.test(s);
  const optional = section === "nice" || LOCAL_OPTIONAL.test(s);
  if (LOCAL_ENTRY.test(s)) {
    caps.push({ years: 1, counts: null, strict: false, quote });
    quotes.push(quote);
    return;
  }
  let found = false;
  for (const m of s.matchAll(LOCAL_YEARS)) {
    const lo = LOCAL_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    if (!Number.isFinite(lo) || lo > 15) continue;
    const before = s.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    // "seit 20 Jahren", "depuis 30 ans": company facts
    if (/(seit|depuis|da oltre|über|plus de|oltre)\s*$/i.test(before) && !LOCAL_EXP.test(s.slice(m.index ?? 0, (m.index ?? 0) + 60))) continue;
    found = true;
    quotes.push(quote);
    if (LOCAL_UPPER_BEFORE.test(before) || (m[2] && lo < 1)) {
      caps.push({ years: m[2] ? Number(m[2]) : lo, counts: null, strict: LOCAL_UPPER_BEFORE.test(before), quote });
      continue;
    }
    if (lo > 0 && !optional) hits.push({ years: lo, path: "any", need: { years: lo, professional, counts: null, soft: false, quote } });
  }
  if (found || optional) return;
  if (LOCAL_SEVERAL.test(s)) {
    quotes.push(quote);
    hits.push({ years: 3, path: "any", need: { years: 3, professional: true, counts: null, soft: false, quote } });
  } else if (LOCAL_SOME.test(s)) {
    quotes.push(quote);
    hits.push({ years: 2, path: "any", need: { years: 2, professional, counts: null, soft: false, quote } });
  }
}

/** Sentences tagged with the kind of section they sit in (requirements, nice-to-haves, anything else). */
function sectionedSentences(lines: string[]): { s: string; section: Section }[] {
  const out: { s: string; section: Section }[] = [];
  let section: Section = "other";
  for (const line of lines) {
    const head = line.replace(/[:：]$/, "").trim();
    if (!BULLET.test(line) && head.length < 80 && !/\d\s*\+?\s*(years?|yrs?)\b/i.test(line)) {
      if (NICE_HEADING.test(head)) {
        section = "nice";
        continue;
      }
      if (REQ_HEADING.test(head)) {
        section = "req";
        continue;
      }
      if (/[:：]$/.test(line) && head.length < 50) {
        section = /qualif|requirement|experience|skills/i.test(head) ? (PREFERRED.test(head) ? "nice" : "req") : "other";
        continue;
      }
    }
    for (const s of sentences([line])) out.push({ s, section });
  }
  return out;
}

interface YearsHit {
  years: number;
  path: "bachelor" | "master" | "any";
  need: ExperienceNeed;
}

/**
 * Years of experience the posting asks for, from its own sentences: requirements on the bachelor's
 * path (a master's-only path is dropped when there is one), without the "or N years instead of a
 * degree" alternatives, upper limits ("up to 2 years", "no more than 2 years", which mark an
 * early-career role) or preferences. Independent of your CV.
 */
export function extractExperience(lines: string[]): { sentences: string[]; req: ExperienceReq | null } {
  const hits: YearsHit[] = [];
  const caps: NonNullable<ExperienceReq["max"]>[] = [];
  const quotes: string[] = [];
  for (const { s, section } of sectionedSentences(lines)) {
    if (s.length > 600) continue;
    for (const m of s.matchAll(YEARS_RE)) {
      const idx = m.index ?? 0;
      const end = idx + m[0].length;
      const before = s.slice(Math.max(0, idx - 80), idx);
      const after = s.slice(end, end + 140);
      const near = before.slice(-60) + " " + after.slice(0, 90);
      if (!EXP_CONTEXT.test(after) && !/(experience|worked)[^.;]{0,40}$/i.test(before)) continue;
      if (PROGRAMME_AFTER.test(after) || /\b(a|an|the|this|our)\s*$/i.test(before)) continue;
      // What the years are of: "4+ years of computer science fundamentals" (school counts) vs "3+ years of experience, with strong fundamentals"
      const object = after.slice(0, 80).split(/experience|[,;(]/i)[0];
      if (COMPANY_FACT.test(near) || COMPANY_BEFORE.test(before) || BENEFITS.test(s) || EDUCATION.test(object)) continue;
      if (/within( the)?( last| past)?\s*$/i.test(before) || /^\s*(of|after|since|from) (graduat|completing|your degree)/i.test(after)) continue;
      const lo = m[1] ? Number(m[1]) / 12 : num(m[2]);
      const hi = m[3] ? num(m[3]) : m[1] ? num(m[2]) : null;
      if (!Number.isFinite(lo) || lo > 15) continue;
      const quote = clip(s, 240);
      const counts = POST_GRAD_ONLY.test(s) ? "post-grad" : INTERNSHIPS_COUNT.test(s) ? "internships" : FULL_TIME_ONLY.test(s) ? "full-time" : null;
      quotes.push(quote);
      // Upper limit: "up to 4 years", "no more than two years" (strict), "0-2 years", "3 months - 2 years" (a range)
      const strict = UPPER_BEFORE.test(before) || UPPER_AFTER.test(after);
      if (strict || (hi != null && lo < 1)) {
        const cap = strict ? (hi ?? lo) : hi!;
        if (cap > 0) caps.push({ years: cap, counts, strict, quote });
        continue;
      }
      if (lo <= 0) continue;
      if (section === "nice" || PREFERRED.test(s) || OR_GRADS.test(s)) continue;
      if (IN_LIEU.test(s) || (/\bor\s+(?:at least\s+|a minimum of\s+|minimum\s+)?$/i.test(before) && /\b(degree|bachelor|diploma|qualification)/i.test(s.slice(0, idx)))) continue;
      const head = s.slice(0, idx);
      const path = BACHELOR_PATH.test(head) ? "bachelor" : MASTER_PATH.test(head) ? "master" : "any";
      hits.push({
        years: lo,
        path,
        need: { years: lo, professional: PROFESSIONAL.test(before.slice(-50) + " " + after), counts, soft: /or equivalent|or related (practical|academic)|or similar/i.test(after), quote },
      });
    }
    localExperience(s, section, hits, caps, quotes);
  }
  const bachelor = hits.filter((h) => h.path === "bachelor");
  const applies = hits.filter((h) => h.path === "any" || (bachelor.length ? h.path === "bachelor" : h.path === "master"));
  const needs = new Map<string, ExperienceNeed>();
  for (const h of applies) {
    const k = `${h.years}|${h.need.quote}`;
    if (!needs.has(k)) needs.set(k, h.need);
  }
  const max = caps.length ? caps.reduce((a, b) => (b.years < a.years ? b : a)) : null;
  const list = [...needs.values()].sort((a, b) => b.years - a.years).slice(0, 6);
  return {
    sentences: uniq(quotes).slice(0, 4),
    req: list.length || max ? { needs: list, max } : null,
  };
}

const LANGS: Record<string, string> = {
  german: "German", french: "French", italian: "Italian", dutch: "Dutch", mandarin: "Mandarin", chinese: "Chinese", cantonese: "Cantonese",
  japanese: "Japanese", korean: "Korean", spanish: "Spanish", polish: "Polish", portuguese: "Portuguese", swedish: "Swedish", danish: "Danish", hebrew: "Hebrew",
};
const LANG_RE = new RegExp(String.raw`\b(${Object.keys(LANGS).join("|")})\b`, "gi");

type Lang = { name: string; required: boolean; explicit?: boolean; quote?: string };

// German, French and Italian postings (Switzerland) name languages their own way
const LOCAL_LANGS: [RegExp, string][] = [
  [/\bdeutsch|\bgerman\b|\ballemand|\btedesco/i, "German"],
  [/franz[öo]sisch|\bfran[çc]ais|\bfrench\b|\bfrancese/i, "French"],
  [/italienisch|\bitalien\b|\bitalian\b|\bitaliano/i, "Italian"],
  [/englisch|\banglais|\benglish\b|\binglese/i, "English"],
];
const LOCAL_LANG_CONTEXT =
  /kenntnisse|\bsprachen\b|\blangues?\b|\blingue\b|fliessend|fließend|verhandlungssicher|muttersprache|in wort und schrift|stilsicher|sprachniveau|\b[abc][12]\b|ma[iî]tris|courant|connaissance|langue maternelle|bilingue|conoscenz|madrelingua|fluent|parlat|sprichst|beherrschst/i;
const LOCAL_OPTIONAL =
  /von vorteil|w[üu]nschenswert|ein plus|erw[üu]nscht|vorteilhaft|un atout|un plus|appr[ée]ci|souhait|serait un|gradit|vantaggio|preferibil|a plus|an advantage|nice to have|is a bonus|(commitment|willingness|willing|readiness|ready) to learn|bereitschaft[^.]{0,40}(zu )?lernen|volont[ée] d['’]apprendre|dispost[oa] ad? imparare/i;

/** The posting's own language (from its most common short words), or null when the text is too short. */
export function detectLanguage(lines: string[]): "de" | "fr" | "it" | "en" | null {
  const text = ` ${lines.join(" ").slice(0, 8000)} `;
  if (text.split(/\s+/).length < 40) return null;
  const STOP: Record<"de" | "fr" | "it" | "en", RegExp> = {
    de: /\s(und|der|die|das|mit|für|wir|sie|du|ist|von|zu|im|den|des|bei|eine?|nicht|oder|als|auch|dein|deine|unser|unsere|bist|hast|sowie)(?=\s)/gi,
    fr: /\s(et|le|la|les|des|avec|pour|nous|vous|est|du|une?|dans|sur|aux?|que|qui|votre|vos|notre|nos|sont)(?=\s)/gi,
    it: /\s(il|gli|con|per|noi|del|della|dei|una|nel|sul|che|non|sono|tuo|tua|nostro|nostra|delle|alla)(?=\s)/gi,
    en: /\s(the|and|is|with|for|we|you|of|to|in|on|an?|are|be|our|your|will|have|as)(?=\s)/gi,
  };
  let best: ["de" | "fr" | "it" | "en", number] | null = null;
  for (const lang of ["de", "fr", "it", "en"] as const) {
    const n = (text.match(STOP[lang]) ?? []).length;
    if (!best || n > best[1]) best = [lang, n];
  }
  return best && best[1] >= 8 ? best[0] : null;
}

/** "English is our working language": a German or French ad does not then require that language. */
const WORKS_IN_ENGLISH =
  /english (is )?(the |our )?(working|company|team|corporate|main|official) language|englischsprachig|arbeitssprache( ist)?:? englisch|unternehmenssprache( ist)?:? englisch|konzernsprache( ist)?:? englisch|langue de travail( est)?:? l['’]anglais|lingua di lavoro( è)?:? l['’]inglese|english[- ]speaking (team|environment|company)|(deutsch|german)(kenntnisse)? (sind |ist )?(von vorteil|w[üu]nschenswert|ein plus|a plus|nice to have)/i;
const POSTING_LANG: Record<"de" | "fr" | "it", string> = { de: "German", fr: "French", it: "Italian" };

/** A German, French or Italian ad needs that language unless it says the work is in English. */
export function postingLanguageNeed(lines: string[], lang: ReturnType<typeof detectLanguage>): Lang | null {
  if (!lang || lang === "en") return null;
  // Written in that language: expected, but not a stated requirement
  return WORKS_IN_ENGLISH.test(lines.join(" ")) ? null : { name: POSTING_LANG[lang], required: true, explicit: false, quote: `The posting is written in ${POSTING_LANG[lang]}.` };
}

/** Words that say outright that a language is mandatory, not just a level or a wish */
const MANDATORY =
  /zwingend|unabdingbar|unerl[äa]sslich|voraussetzung|vorausgesetzt|erforderlich|notwendig|ein muss|\bmusst?\b|\brequired\b|mandatory|\bessential\b|a must\b|\bmust (be|have|speak|read|write)|\bmust[- ]haves?\b|\b(is|are) needed|necessary|obligatoire|indispensable|exig[ée]|imp[ée]rati|\brequis|\bdoi(t|vent)\b|\bdevez\b|obbligatori|indispensabil|richiest|necessari|\bdev(e|i|ono)\b/i;
const NOT_MANDATORY =
  /nicht (zwingend|erforderlich|notwendig|n[öo]tig|vorausgesetzt|unbedingt|voraussetzung)|kein muss|not (required|mandatory|necessary|essential|a must|needed)|no [a-z]+ (is )?(required|needed|necessary)|pas (obligatoire|indispensable|requis|n[ée]cessaire|exig)|non (obbligatori|richiest|necessari|indispensabil)/i;

const EN_OPTIONAL = /a plus|preferred|advantage|beneficial|nice to have|bonus|desirable|ideally|\basset\b|\boptional\b|facultati|facoltativ|(commitment|willingness|willing|ready) to learn/i;

type Need = { required: boolean; explicit: boolean };

/** Languages a sentence names, by name. */
function languagesIn(text: string): string[] {
  const out = new Set<string>();
  for (const [re, name] of LOCAL_LANGS) if (re.test(text)) out.add(name);
  for (const m of text.matchAll(LANG_RE)) if (LANGS[m[1].toLowerCase()]) out.add(LANGS[m[1].toLowerCase()]);
  return [...out];
}

/** A clause that is only a language of a list ("with French", "German", "oder Italienisch"). */
function bareLanguage(clause: string): boolean {
  let rest = clause.replace(LANG_RE, " ");
  for (const [re] of LOCAL_LANGS) rest = rest.replace(new RegExp(re.source, "gi"), " ");
  return !rest.replace(/\b(with|and|or|also|und|oder|sowie|et|ou|e|o|ed|oppure)\b|[()/&.]/gi, " ").trim();
}

/**
 * What a sentence says about each language it names, clause by clause: a qualifier ("zwingend",
 * "von Vorteil", "required", "a plus") applies to the languages of its own clause, a clause without
 * a language ("…, aber nicht zwingend") to those of the clause before, and a label ("Required: …")
 * to the clause after it.
 * "Sehr gute Deutschkenntnisse, Englisch zwingend, Französisch von Vorteil": German expected,
 * English mandatory, French optional.
 */
function languageNeeds(sentence: string): Map<string, Need> {
  const out = new Map<string, Need>();
  const parts = sentence.split(/(\s*[,;:]\s*|\s+[–—-]\s+)/);
  let previous: string[] = [];
  // Languages listed bare before the clause that qualifies them all ("French, German, or Italian being an asset")
  let listed: string[] = [];
  let label: Need | null = null;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    const optional = LOCAL_OPTIONAL.test(clause) || NOT_MANDATORY.test(clause) || EN_OPTIONAL.test(clause);
    const mandatory = !optional && MANDATORY.test(clause);
    const langs = languagesIn(clause);
    const own: Need | null = optional || mandatory ? { required: !optional, explicit: mandatory } : null;
    if (langs.length) {
      const need = own ?? label ?? { required: true, explicit: false };
      for (const l of [...(own ? listed : []), ...langs]) out.set(l, need);
      listed = !own && !label && bareLanguage(clause) ? [...listed, ...langs] : [];
      previous = [...listed, ...langs];
      label = null;
    } else if (own) {
      if (parts[i + 1]?.trim() === ":") label = own;
      // Qualifies the clause before, unless that clause already said something itself
      else for (const l of previous) if (out.get(l)?.required && !out.get(l)?.explicit) out.set(l, own);
    }
  }
  return out;
}

/** "Deutsch zwingend", "Englisch (von Vorteil)", "French: required": a language with its qualifier right after it */
const LANG_QUALIFIED =
  /\b(deutsch|englisch|franz[öo]sisch|italienisch|german|english|french|italian|fran[çc]ais|anglais|allemand|italien|tedesco|inglese|francese|italiano)\b\s*[(:–-]?\s*(zwingend|erforderlich|vorausgesetzt|ein muss|von vorteil|erw[üu]nscht|ein plus|required|mandatory|essential|a must|a plus|preferred|an asset|optional|obligatoire|indispensable|exig[ée]|requis|un atout|un plus|obbligatori|richiest|indispensabil|gradit)/i;

export function extractLanguages(lines: string[]): Lang[] {
  const out = new Map<string, Lang>();
  const add = (name: string, need: Need, s: string) => {
    const prev = out.get(name);
    const next: Lang = { name, required: (prev?.required ?? false) || need.required, explicit: (prev?.explicit ?? false) || need.explicit };
    // Keep the sentence that decides it (the explicit one first)
    next.quote = need.explicit || !prev?.quote ? clip(s, 220) : prev.quote;
    out.set(name, next);
  };
  for (const s of sentences(lines)) {
    if (s.length > 400) continue;
    // Other job titles on the page ("Account Executive, Mandarin Speaking (Singapore)") are not requirements
    if (/speaking\s*(\([^)]*\))?\s*$/i.test(s) || s.length < 15) continue;
    const local = LOCAL_LANG_CONTEXT.test(s);
    const english =
      /fluen|proficien|native|business[- ]level|working knowledge|command of|written and spoken|spoken and written|language skills|required|a must|mandatory|essential|a plus|preferred|advantage|beneficial|nice to have/i.test(s) &&
      /fluen|proficien|native|(you|ability to|able to|must|should) (speak|read|write|communicate)|spoken|language|command of|business[- ]level|working knowledge/i.test(s);
    if (!local && !english && !LANG_QUALIFIED.test(s)) continue;
    for (const [name, need] of languageNeeds(s)) add(name, need, s);
  }
  return [...out.values()];
}

export function extractDegree(required: string[], nice: string[], title = ""): PostingDetails["degree"] {
  const phd = /\bph\.?d\b|doctoral|doctorate/i;
  const master = /\bmaster'?s\b|\bm\.?sc?\b|\bms degree\b|graduate degree/i;
  const reqText = `${title} ${required.join(" ")}`;
  const bachelorOk = /bachelor|\bbs\b|\bb\.?sc?\b|undergraduate|or equivalent/i;
  if (phd.test(reqText) && !bachelorOk.test(reqText)) return { level: "phd", required: true };
  if (master.test(reqText) && !bachelorOk.test(reqText)) return { level: "master", required: true };
  if (phd.test(nice.join(" "))) return { level: "phd", required: false };
  if (master.test(nice.join(" ")) || (master.test(reqText) && bachelorOk.test(reqText))) return { level: "master", required: false };
  return null;
}

// ---------- application policy

const POLICY_RE =
  /one application|single application|apply (to|for) (only )?(the )?(one|a single|1) (role|position|job|program|posting)|only (apply|submit)[^.]{0,30}\bone\b|up to (one|two|three|four|five|[1-5]) (separate |different )?(roles|positions|applications|jobs|programs|programmes|business)|do not allow multiple|apply only once|only apply once|maximum of (one|two|three|four|five|[1-5])|no more than (one|two|three|four|five|[1-5]) (roles|positions|applications|jobs)|considered for (all|other|multiple|any)( open| relevant| other)? (roles|positions|teams|opportunities)|considers? one role|first preference|per (recruiting|recruitment|hiring) (season|cycle)|one role per|reappl(y|ication)[^.]{0,80}(month|year|season|cycle)|(month|year)s?[^.]{0,80}(eligible to|cannot|can['’]t) reapply|consider (you|it|your application) for (all|other|multiple)|multiple applications|more than one (role|position|application|job)|apply to multiple|apply for multiple|one (internship|graduate) application/i;

export function extractPolicy(lines: string[]): string[] {
  return uniq(sentences(lines).filter((s) => POLICY_RE.test(s) && s.length < 500).map((s) => clip(s, 300))).slice(0, 4);
}

// ---------- text storage

export const packText = (lines: string[]) => gzipSync(Buffer.from(lines.join("\n"), "utf8")).toString("base64");
export const unpackText = (z: string | undefined): string[] => (z ? gunzipSync(Buffer.from(z, "base64")).toString("utf8").split("\n") : []);

/** "We don't expect you to know OCaml" is not a requirement. */
const NEGATED = /\b(don['’]?t|do not|doesn['’]?t|does not|no need to|not)\s+(expect|need|require|have to|necessary|required|mandatory)|\bnot (a )?(requirement|prerequisite)|\bno (prior )?(experience|background|knowledge) (in|with|of|is) (required|necessary|needed)|\bregardless of\b|\bisn['’]?t (required|necessary)|\baren['’]?t (required|necessary)/i;

// ---------- all together

export function analyzePosting(f: FetchedPosting, kind: "intern" | "grad" = "intern", title = ""): PostingDetails {
  const lines = f.ok ? f.lines.slice(0, 600) : [];
  const text = lines.join("\n");
  const { required, nice } = extractSections(lines);
  const textPay = f.ok ? extractPay(lines) : [];
  const pay = [...f.pay, ...textPay.filter((t) => !f.pay.some((s) => Math.abs(s.min - t.min) < 1 && s.currency === t.currency))];
  const exp = extractExperience(lines);
  const lang = f.ok ? detectLanguage(lines) : null;
  const stated = f.ok ? extractLanguages(lines) : [];
  const inferred = f.ok && f.via !== "html" ? postingLanguageNeed(lines, lang) : null;
  return {
    fetchedAt: new Date().toISOString(),
    ok: f.ok,
    via: f.via,
    url: f.url,
    error: f.error,
    title: f.title,
    datePosted: f.datePosted,
    validThrough: f.validThrough,
    pay,
    grad: f.ok ? extractGrad(lines, kind) : null,
    requirements: required.slice(0, 12),
    niceToHave: nice.slice(0, 8),
    skills: {
      found: f.ok ? findSkills(lines.filter((l) => !NEGATED.test(l)).join("\n")) : [],
      required: findSkills(required.filter((b) => !NEGATED.test(b)).join("\n")),
      nice: findSkills(nice.filter((b) => !NEGATED.test(b)).join("\n")),
    },
    experience: exp.sentences,
    experienceYears: exp.req?.needs[0]?.years ?? null,
    experienceReq: f.ok ? exp.req : null,
    // The page language only says something when the text is the ad itself (not a site with its own menus),
    // and not about a language the ad already talks about ("Deutschkenntnisse von Vorteil")
    languages: f.ok ? mergeLanguages(stated, f.langs ?? [], inferred && !stated.some((l) => l.name === inferred.name) ? inferred : null) : [],
    lang: f.ok ? lang : null,
    dateFrom: f.dateFrom,
    ...(f.langs?.length ? { sourceLangs: f.langs } : {}),
    degree: f.ok ? extractDegree(required, nice, title || f.title) : null,
    policy: f.ok ? extractPolicy(lines) : [],
    chars: text.length,
    textZ: f.ok ? packText(lines) : undefined,
    form: f.ok ? (f.form ?? null) : null,
  };
}

/** Languages from the text, from the source's structured data and from the ad's own language, required wins. */
function mergeLanguages(...lists: (Lang[] | Lang | null)[]): Lang[] {
  const out = new Map<string, Lang>();
  for (const l of lists.flat()) {
    if (!l) continue;
    const prev = out.get(l.name);
    out.set(l.name, {
      name: l.name,
      required: (prev?.required ?? false) || l.required,
      explicit: (prev?.explicit ?? false) || !!l.explicit,
      quote: (l.explicit ? l.quote : prev?.quote) ?? prev?.quote ?? l.quote,
    });
  }
  return [...out.values()];
}

/** Postings stored before the v2 analyser (skills matched/gaps, languages as names) read as the new shape. */
export function normalizePosting(p: PostingDetails | undefined | null): PostingDetails | null {
  if (!p) return null;
  const old = p as unknown as { skills?: { matched?: string[]; gaps?: string[]; found?: string[] }; languages?: unknown[] };
  const skills = Array.isArray(old.skills?.found)
    ? p.skills
    : { found: uniq([...(old.skills?.matched ?? []), ...(old.skills?.gaps ?? [])]), required: [], nice: [] };
  const languages = (old.languages ?? []).map((l) => (typeof l === "string" ? { name: l, required: true } : (l as { name: string; required: boolean })));
  return { ...p, niceToHave: p.niceToHave ?? [], experienceYears: p.experienceYears ?? null, degree: p.degree ?? null, skills, languages };
}
