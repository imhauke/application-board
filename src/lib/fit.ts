// How well an offer fits your CV, computed from your actual PDFs (lib/cv.ts) and what the posting
// asks for (lib/crawler/extract.ts). Change a PDF and every fit, reason and priority follows.

import { normalizePosting } from "./crawler/extract";
import type { Candidate, CvProfile } from "./cv";
import { chooseCv, type CvChoice } from "./cvChoice";
import { gradVerdict, type GradDate } from "./grad";
import { SKILL_GROUP, type Skill } from "./skills";
import type { Application, CvKind, Eligibility, ExperienceNeed, ExperienceReq, PostingDetails } from "./types";

export interface FitAssessment {
  fit: number;
  /** Fit from the role alone, before reading the posting */
  base: number;
  level: "high" | "mid" | "low";
  headline: string;
  pros: string[];
  cons: string[];
  /** Required skills you have / lack; optional ones you have */
  matched: string[];
  gaps: string[];
  niceMatched: string[];
  projects: { name: string; skills: string[] }[];
  cvBest: CvKind;
  cvScores: Record<CvKind, number>;
  /** Which CV to send and why (lib/cvChoice.ts) */
  cvChoice: CvChoice;
}

const ROLE_GROUPS: Record<string, Skill["group"][]> = {
  "SRE/Infra": ["infra", "fundamentals"],
  SWE: ["language", "framework", "data"],
  "Quant Dev/SWE": ["language", "fundamentals"],
  "AI/ML/Data Eng": ["ai", "data"],
  "Quant Trading": ["quant"],
  "Quant Research": ["quant"],
  "Data Science": ["quant", "data"],
};

function cvMentions(cv: CvProfile, role: string, n = 4): string {
  const groups = ROLE_GROUPS[role] ?? [];
  const xs = cv.skills.filter((s) => groups.includes(SKILL_GROUP[s])).slice(0, n);
  return xs.length ? ` (on your CV: ${xs.join(", ")})` : "";
}

function roleReason(app: Application, cv: CvProfile): { text: string; pro: boolean } {
  const t = app.title.toLowerCase();
  const own = cvMentions(cv, app.role);
  switch (app.role) {
    case "SRE/Infra":
      return { text: `SRE or infrastructure role: the closest match to deploying and running services${own}.`, pro: true };
    case "Quant Research":
      return { text: "Quant research asks for master's or PhD-level maths and statistics; a software engineering CV rarely shows that.", pro: false };
    case "Quant Trading":
      return { text: "Trading asks for probability, mental maths and statistics rather than engineering; your CV does not show them.", pro: false };
    case "Data Science":
      if (app.fit >= 3)
        return { text: `Data analysis: SQL, Python and dashboards${own}.`, pro: true };
      return { text: "Data science asks for statistics and modelling; your CV is about building systems, not analysing data.", pro: false };
    case "AI/ML/Data Eng":
      if (app.fit <= 2) return { text: "ML research: it usually asks for publications or a master's; your CV shows applied AI, not research.", pro: false };
      if (app.fit >= 5) return { text: `Applied AI or data engineering: just what your projects show${own}.`, pro: true };
      return { text: `AI or data with an engineering side: your applied AI counts${own}, even without classic ML.`, pro: true };
    case "Quant Dev/SWE":
      if (app.fit <= 3) return { text: "Quant development centred on C++, kdb+ or desk work: they value CS fundamentals, but your projects are not in that stack.", pro: false };
      return { text: `Development at a quant firm: they value CS fundamentals and systems${own}.`, pro: true };
    default:
      if (app.fit <= 2) return { text: "Mobile, graphics, robotics or embedded: your CV does not show that stack.", pro: false };
      if (app.fit === 3 && /front|ui\b/.test(t)) return { text: "Frontend role: it needs frontend depth, check your CV shows it.", pro: false };
      if (app.fit === 3) return { text: "C++ as the main language: show it with a project if you can.", pro: false };
      if (app.fit >= 5) return { text: `Backend or platform: right in your area${own}.`, pro: true };
      return { text: `Generalist SWE: full-stack and backend experience covers the usual asks${own}.`, pro: true };
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---------- years of experience

type Worked = Pick<Candidate, "months" | "fullTimeMonths" | "postGradMonths">;

const monthsLabel = (m: number) => (m >= 24 ? `${(m / 12).toFixed(1).replace(/\.0$/, "")} years` : `${m} ${m === 1 ? "month" : "months"}`);
const yearsLabel = (y: number) => (Number.isInteger(y) ? String(y) : y.toFixed(1));
const COUNTS: Record<NonNullable<ExperienceNeed["counts"]>, string> = {
  "post-grad": " after graduating",
  "full-time": " full time (internships do not count)",
  internships: " (internships count)",
};
const needLabel = (n: Pick<ExperienceNeed, "years" | "counts" | "professional">) =>
  `${yearsLabel(n.years)}+ years of${n.professional && !n.counts ? " professional" : ""} experience${n.counts ? COUNTS[n.counts] : ""}`;
/** The months of yours that count for a requirement */
const workedFor = (counts: ExperienceNeed["counts"], w: Worked) => (counts === "post-grad" ? w.postGradMonths : counts === "full-time" ? w.fullTimeMonths : w.months);

/** The posting's experience terms in words, each with the sentence it comes from (offer page). */
export function experienceTerms(req: ExperienceReq | null | undefined): { text: string; quote: string }[] {
  if (!req) return [];
  const out = req.needs.slice(0, 2).map((n) => ({ text: `They ask for ${needLabel(n)}${n.soft ? " or equivalent" : ""}`, quote: n.quote }));
  if (req.max) out.push({ text: `${req.max.strict ? "At most" : "0 to"} ${yearsLabel(req.max.years)} years of experience: an entry-level role`, quote: req.max.quote });
  return out;
}

/** The experience part of the fit: the most demanding requirement and any upper limit, against your CV. */
function experienceFit(posting: PostingDetails, w: Worked): { pros: string[]; cons: string[]; adj: number } {
  const out = { pros: [] as string[], cons: [] as string[], adj: 0 };
  const req: ExperienceReq | null =
    posting.experienceReq ?? (posting.experienceYears ? { needs: [{ years: posting.experienceYears, professional: false, counts: null, soft: false, quote: "" }], max: null } : null);
  if (!req) return out;
  const top = req.needs[0];
  if (top) {
    const mine = workedFor(top.counts, w);
    const gap = top.years - mine / 12;
    const text = `It asks for ${needLabel(top)}; your CV adds up to ${monthsLabel(mine)}.`;
    if (gap > 0.1) {
      out.cons.push(text);
      out.adj -= gap >= 1.25 ? 2 : gap > 0.5 ? 1 : 0;
    } else out.pros.push(text);
  }
  if (req.max) {
    const mine = workedFor(req.max.counts, w);
    if (mine / 12 <= req.max.years + 0.25) out.pros.push(`It is for little experience (${req.max.strict ? "at most" : "0 to"} ${yearsLabel(req.max.years)} years) and your CV adds up to ${monthsLabel(mine)}.`);
    else if (req.max.strict) out.cons.push(`They ask for at most ${yearsLabel(req.max.years)} years of experience and your CV adds up to ${monthsLabel(mine)}.`);
  }
  return out;
}
const SPOKEN_OK = new Set(["high", "mid"]);

export function assessFit(app: Application, postingRaw: PostingDetails | null | undefined, cvs: Record<CvKind, CvProfile>): FitAssessment {
  const assigned = cvs[app.cv.kind].ok ? cvs[app.cv.kind] : cvs[app.cv.kind === "quant" ? "swe" : "quant"];
  const cv = assigned.ok ? assigned : cvs[app.cv.kind];
  const mine = new Set(cv.skills);
  const posting = normalizePosting(postingRaw);
  const base = app.fit;
  const pros: string[] = [];
  const cons: string[] = [];
  const role = roleReason(app, cv);
  (role.pro ? pros : cons).push(role.text);

  let matched: string[] = [];
  let gaps: string[] = [];
  let niceMatched: string[] = [];
  let projects: FitAssessment["projects"] = [];
  let adj = 0;

  if (posting?.ok) {
    const req = posting.skills.required.length ? posting.skills.required : posting.skills.found;
    const fromReq = posting.skills.required.length > 0;
    matched = req.filter((s) => mine.has(s));
    gaps = req.filter((s) => !mine.has(s));
    niceMatched = posting.skills.nice.filter((s) => mine.has(s));
    const ratio = req.length ? matched.length / req.length : 0;

    if (matched.length) pros.push(`${fromReq ? "You meet" : "The posting mentions"} ${matched.length} of ${req.length} ${fromReq ? "technical requirements" : "technologies"}${fromReq ? "" : " you have"}: ${matched.slice(0, 8).join(", ")}.`);
    if (gaps.length) cons.push(`${fromReq ? "Missing" : "Not on your CV"}: ${gaps.slice(0, 6).join(", ")}.`);
    if (niceMatched.length) pros.push(`You also have what they list as a plus: ${niceMatched.slice(0, 5).join(", ")}.`);
    if (req.length >= 3 && ratio >= 0.75) adj += 1;
    else if (req.length >= 3 && ratio < 0.4) adj -= 1;

    // Most relevant projects of the CV you would send
    projects = cv.projects
      .map((p) => ({ name: p.name, skills: p.skills.filter((s) => posting.skills.found.includes(s)) }))
      .filter((p) => p.skills.length >= 2)
      .sort((a, b) => b.skills.length - a.skills.length)
      .slice(0, 2);
    for (const p of projects) pros.push(`Your project ${p.name} matches what they ask for (${p.skills.slice(0, 5).join(", ")}).`);

    const exp = experienceFit(posting, { months: cv.experienceMonths, fullTimeMonths: cv.fullTimeMonths, postGradMonths: cv.postGradMonths });
    pros.push(...exp.pros);
    cons.push(...exp.cons);
    adj += exp.adj;

    for (const l of posting.languages) {
      const spoken = cv.languages.find((x) => x.name === l.name);
      if (spoken && SPOKEN_OK.has(spoken.level)) pros.push(`${l.required ? "It asks for" : "They value"} ${l.name} and you speak it (${spoken.raw}).`);
      else if (l.required) {
        cons.push(`${l.explicit ? "It requires" : "It asks for"} ${l.name}${spoken ? `; your level is ${spoken.raw.toLowerCase()}` : ", which you do not speak"}.`);
        adj -= 1;
      } else cons.push(`They value ${l.name}${spoken ? ` (your level: ${spoken.raw.toLowerCase()})` : ", which you do not speak"}.`);
    }

    if (posting.degree?.required) {
      cons.push(posting.degree.level === "phd" ? "It requires a PhD." : "It requires a master's degree.");
      adj -= posting.degree.level === "phd" ? 2 : 1;
    } else if (posting.degree) {
      cons.push(`They value a ${posting.degree.level === "phd" ? "PhD" : "master's degree"}, but do not require it.`);
    }

  } else {
    cons.push("The posting could not be read: the fit is based on the title and the role only.");
  }

  const fit = clamp(base + clamp(adj, -2, 1), 1, 5);
  const cvChoice = chooseCv(app, posting, cvs);
  const cvBest = cvChoice.kind;
  const cvScores = cvChoice.score;
  const level = fit >= 4 ? "high" : fit === 3 ? "mid" : "low";
  const headline = level === "high" ? "Fits your CV" : level === "mid" ? "Partly fits" : "Barely fits your CV";
  return { fit, base, level, headline, pros, cons, matched, gaps, niceMatched, projects, cvBest, cvScores, cvChoice };
}

// ---------- eligibility

export interface EligibilityView {
  value: Eligibility;
  from: "posting" | "rule";
  /** What decided it: graduation or enrolment, years of experience, the seniority in the title, or the source's general rule */
  basis: "grad" | "experience" | "title" | "language" | "rule";
  summary: string;
  evidence: string[];
}

const RANK: Record<Eligibility, number> = { ok: 0, maybe: 1, warn: 2, no: 3 };

/** Seniority stated by the title. Level "II" depends on the company (at Google it is the entry level), so there only the text decides. */
export function seniorTitle(title: string): string | null {
  if (/\b(senior|sr\.?|staff|principal|distinguished)\b/i.test(title)) return "senior";
  if (/\b(leiter(in)?|teamleiter(in)?|abteilungsleiter(in)?|bereichsleiter(in)?|chef(fe)? d[e'’]|responsable d[e'’]|directeur|directrice|direttore|capo)\b/i.test(title)) return "management";
  if (/\b(tech(nical)? lead|team lead)\b|^lead\b|\blead (software|engineer|developer|quant|data|machine|ml|research|site|platform|infrastructure|back[- ]?end|front[- ]?end|full[- ]?stack|systems|devops|sre|security)/i.test(title)) return "tech lead";
  if (/\b(manager|director|head of|vice president|vp)\b/i.test(title)) return "manager";
  if (/\barchitect\b/i.test(title) && !/associate|junior|graduate|early career|new grad|intern/i.test(title)) return "architect";
  const lvl = title.match(/\b(?:engineer|developer|sde|swe|analyst|scientist|programmer|specialist)\s*(iii|iv|v|3|4|5)\b/i);
  return lvl ? `level ${lvl[1].toUpperCase()}` : null;
}

/** Titles that say the role is for graduates or juniors, so years asked for can usually be met with internships and projects. */
const EARLY_TITLE =
  /new grad|graduate|university|campus|entry[- ]level|early[- ]careers?|junior|\bjr\b|20(26|27) start|class of 20|associate|apprentice|rotational|residency|\b(engineer|developer|sde|swe|analyst|scientist)\s*(i|1)\b/i;

/** Years of experience and seniority against yours; null when the offer says nothing about either. */
function experienceView(app: Application, posting: PostingDetails | null, me: Candidate): EligibilityView | null {
  const senior = seniorTitle(app.title);
  if (senior) return { value: "no", from: "posting", basis: "title", summary: `The title says it is a ${senior} role: not entry level.`, evidence: [] };
  const req = app.kind === "grad" ? posting?.experienceReq : null;
  if (!req) return null;
  let worst: { value: Eligibility; need: ExperienceNeed; lenient: string | null } | null = null;
  for (const need of req.needs) {
    const gap = need.years - workedFor(need.counts, me) / 12;
    if (gap <= 0.1) continue;
    const lenient =
      need.counts === "post-grad"
        ? null
        : need.soft
          ? "They accept equivalent experience."
          : EARLY_TITLE.test(app.title)
            ? "An entry-level role: internships and projects usually count."
            : !need.professional
              ? "It does not have to be a job: projects and your degree can count."
              : null;
    const value: Eligibility = !lenient && gap >= 1 ? "no" : !lenient || gap >= 1 ? "warn" : "maybe";
    if (!worst || RANK[value] > RANK[worst.value]) worst = { value, need, lenient };
  }
  if (worst) {
    const mine = monthsLabel(workedFor(worst.need.counts, me));
    const pending = worst.need.counts === "post-grad" && me.postGradMonths === 0 ? " (you have not graduated yet)" : "";
    const tail = worst.value === "no" ? "Not a junior role." : worst.lenient ?? "You are a little short: apply if it fits.";
    return { value: worst.value, from: "posting", basis: "experience", summary: `It asks for ${needLabel(worst.need)} and your CV adds up to ${mine}${pending}. ${tail}`, evidence: worst.need.quote ? [worst.need.quote] : [] };
  }
  if (req.max?.strict && workedFor(req.max.counts, me) / 12 > req.max.years + 0.25) {
    return {
      value: "maybe",
      from: "posting",
      basis: "experience",
      summary: `They ask for at most ${yearsLabel(req.max.years)} years of experience and your CV adds up to ${monthsLabel(workedFor(req.max.counts, me))}: check they accept you.`,
      evidence: [req.max.quote],
    };
  }
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SEASON_END: Record<string, number> = { winter: 4, spring: 6, summer: 9, fall: 12, autumn: 12 };

/** Roughly when an internship ends, from its season ("Summer 2027"); Summer of your graduation year when unknown. */
function internshipEnd(season: string | undefined, grad: GradDate): GradDate {
  const m = season?.match(/\b(winter|spring|summer|fall|autumn)\b\D*(20\d\d)/i);
  return m ? { year: Number(m[2]), month: SEASON_END[m[1].toLowerCase()] } : { year: grad.year, month: 9 };
}

/**
 * What a company says about its internship cohort outside the posting (its student pages), used only
 * when the posting itself says nothing about graduation dates.
 */
const COHORT_RULES: { company: RegExp; area: "emea" | "apac" | "americas" | "any"; value: Eligibility; summary: string }[] = [
  {
    company: /^hudson river trading$/i,
    area: "any",
    value: "no",
    summary: "HRT advertises its summer 2027 internships \"For 2028 Grads\" (student page and form); for 2027 graduates it has the full-time roles.",
  },
  { company: /^goldman sachs$/i, area: "emea", value: "ok", summary: "Goldman's Summer Analyst in EMEA takes penultimate and final-year students." },
  { company: /^goldman sachs$/i, area: "apac", value: "no", summary: "Goldman's Summer Analyst in Asia-Pacific is for penultimate-year students." },
  { company: /^goldman sachs$/i, area: "americas", value: "warn", summary: "In the Americas, Goldman's Summer Analyst is usually done in the penultimate year." },
  { company: /^blackrock$/i, area: "emea", value: "no", summary: "BlackRock's Summer Internship in EMEA is for penultimate-year students graduating in 2028." },
];

function areaOf(app: Application): "emea" | "apac" | "americas" {
  const v = app.visas.find((x) => x.region === app.locations[0]?.region)?.visa ?? app.visa;
  return v === "eu" || v === "uk" ? "emea" : v === "hk" || v === "asia" ? "apac" : "americas";
}

/** Languages the offer requires against the ones on your CV. */
function languageView(posting: PostingDetails | null, me: Candidate): EligibilityView | null {
  let worst: EligibilityView | null = null;
  for (const need of posting?.languages ?? []) {
    if (!need.required) continue;
    const mine = me.languages.find((l) => l.name === need.name);
    if (mine && mine.level !== "low") continue;
    // Only a language the ad says outright is mandatory rules the offer out; a level, a wish or the ad's own language is to check
    const lang = need.name;
    // Inferred from the language the ad is written in, or something the ad says (quoted)
    const written = !!need.quote?.startsWith("The posting is written in");
    const evidence = need.quote && !written ? [need.quote] : [];
    const says = written ? `The posting is written in ${lang} and does not say it is required` : `It asks for ${lang}, but does not say it is a must`;
    const view: EligibilityView = mine
      ? need.explicit
        ? { value: "warn", from: "posting", basis: "language", summary: `It requires ${lang} and your level is basic (${mine.raw}): hard if the interviews or the job are in that language.`, evidence }
        : { value: "maybe", from: "posting", basis: "language", summary: `${says}; your level is basic (${mine.raw}). Check before applying.`, evidence }
      : need.explicit
        ? { value: "no", from: "posting", basis: "language", summary: `It requires ${lang} (it says so explicitly) and it is not on your CV.`, evidence }
        : { value: "maybe", from: "posting", basis: "language", summary: `${says}. It is not on your CV: check before applying.`, evidence };
    if (!worst || RANK[view.value] > RANK[worst.value]) worst = view;
  }
  return worst;
}

function gradView(app: Application, ruleNote: string, posting: PostingDetails | null, grad: GradDate): EligibilityView {
  const ev = posting?.grad?.evidence ?? [];
  const end = internshipEnd(app.season, grad);
  const { verdict, reason, ordered } = ev.length ? gradVerdict(ev, app.kind, grad, end) : { verdict: null, reason: null, ordered: [] as string[] };
  const when = `${MONTHS[grad.month - 1]} ${grad.year}`;
  const view = (value: Eligibility, summary: string): EligibilityView => ({ value, from: "posting", basis: "grad", summary, evidence: ordered });

  if (verdict === "bad") {
    switch (reason) {
      case "enrolled-after":
        return view("no", `It requires you to still be enrolled after the internship, and you graduate in ${when}.`);
      case "grad-after-internship":
        return view("no", `It requires graduating after the internship (it ends around ${MONTHS[end.month - 1]} ${end.year}), and you graduate in ${when}.`);
      case "penultimate-only":
        return view("no", "It is only for penultimate-year students; you are in your final year.");
      case "early-student":
        return view("no", "It is for early-year students who will keep studying afterwards.");
      default:
        return view("no", `It asks for a different graduation date than yours (${when}).`);
    }
  }
  if (verdict === "ok" && app.eligibility !== "no") {
    if (reason === "window-in") return view("ok", `Your graduation (${when}) falls within the range they ask for.`);
    if (reason === "recent-grad") return view("ok", "They accept recent graduates.");
    if (reason === "final-year" && app.kind === "intern")
      return view("ok", `They accept final-year students, as you are (you graduate in ${when}). They do not ask you to return to university afterwards.`);
    if (reason === "enrolled-now" && app.kind === "intern") {
      // US summer internships often expect you to go back to university even when the posting does not say it
      const us = (app.visas.length ? app.visas.map((v) => v.visa) : [app.visa]).every((v) => v.startsWith("us_"));
      return us
        ? view("maybe", `They ask you to be enrolled when you apply, and you are. They do not say you must keep studying afterwards, but many US internships expect it: check they accept graduating in ${when}.`)
        : view("ok", "They ask you to be enrolled when you apply: you are, in your final year. They do not ask you to keep studying after the internship.");
    }
    return view("ok", "It is for final-year students or recent graduates, as you are.");
  }
  if (app.kind === "intern" && verdict !== "ok") {
    const area = areaOf(app);
    const rule = COHORT_RULES.find((r) => r.company.test(app.company) && (r.area === "any" || r.area === area));
    if (rule) return { value: rule.value, from: "rule", basis: "rule", summary: rule.summary, evidence: ordered };
  }
  return { value: app.eligibility, from: "rule", basis: "rule", summary: ruleNote, evidence: ordered };
}

/** Whether you can apply: graduation and enrolment, years of experience and seniority, each judged against your CV. The strictest wins. */
export function eligibilityOf(app: Application, ruleNote: string, postingRaw: PostingDetails | null | undefined, me: Candidate): EligibilityView {
  const posting = normalizePosting(postingRaw);
  const g = gradView(app, ruleNote, posting, me.grad);
  // The strictest of graduation, experience and seniority, and languages
  let out = g;
  for (const x of [experienceView(app, posting, me), languageView(posting, me)]) {
    if (!x || RANK[x.value] < RANK[out.value]) continue;
    if (RANK[x.value] > RANK[out.value] || out.value === "ok") out = x;
    else out = { ...out, summary: `${out.summary} ${x.summary}`, evidence: [...out.evidence, ...x.evidence] };
  }
  return out;
}
