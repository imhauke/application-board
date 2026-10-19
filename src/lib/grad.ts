// Can you apply given your graduation date (read from your CV)? Reads the graduation windows a
// posting states ("between December 2027 and June 2028", "2027 or 2028", "by Summer 2027", "or later")
// and phrases that require staying enrolled.

export interface GradDate {
  year: number;
  month: number;
}

export type GradVerdict = "ok" | "bad" | "unclear";

const MONTH: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  spring: 5, summer: 8, fall: 12, autumn: 12, winter: 12,
};

const DATE_RE = new RegExp(String.raw`\b(?:(${Object.keys(MONTH).join("|")})\.?\s*(?:of\s*)?)?'?((?:19|20)\d{2}|(?<=')\d{2})\b`, "gi");

interface Token {
  start: number;
  end: number;
  from: number;
  to: number;
}

const ym = (y: number, m: number) => y * 12 + (m - 1);

function tokens(s: string): Token[] {
  const out: Token[] = [];
  for (const m of s.matchAll(DATE_RE)) {
    let year = Number(m[2]);
    if (year < 100) year += 2000;
    if (year < 2015 || year > 2035) continue;
    const month = m[1] ? MONTH[m[1].toLowerCase()] : null;
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, from: ym(year, month ?? 1), to: ym(year, month ?? 12) });
  }
  return out;
}

const SPAN = /\b(between|from)\b|\s(?:-|–|—|to|through|until)\s/i;
const LATER = /or (later|after)|and (later|after)|onwards|\bafter\b|no earlier than|at the earliest|or beyond/i;
const BEFORE = /\bby\b|\bbefore\b|no later than|prior to|or (earlier|before)/i;

/** in = your date fits the window, out = it does not, null = no window stated. */
export function windowCheck(sentence: string, grad: GradDate): "in" | "out" | null {
  if (!/graduat|\bgrads?\b|class of|degree (conferred|completion|completed)|conferred|completion of (your|the|their) degree|expected to (graduate|complete)/i.test(sentence)) return null;
  const toks = tokens(sentence);
  if (!toks.length) return null;
  const me = ym(grad.year, grad.month);
  let lo = Math.min(...toks.map((t) => t.from));
  let hi = Math.max(...toks.map((t) => t.to));
  const tail = sentence.slice(toks[toks.length - 1].end, toks[toks.length - 1].end + 30);
  const head = sentence.slice(Math.max(0, toks[0].start - 30), toks[0].start);
  if (toks.length === 1 || !SPAN.test(sentence)) {
    if (LATER.test(tail)) hi = Infinity;
    else if (BEFORE.test(head)) lo = -Infinity;
  }
  return me >= lo && me <= hi ? "in" : "out";
}

/** Why a posting fits or excludes your graduation date; drives the verdict and its explanation. */
export type GradReason =
  | "window-in"
  | "window-out"
  | "enrolled-after"
  | "penultimate-only"
  | "early-student"
  | "recent-grad"
  | "final-year"
  | "enrolled-now"
  | "grad-after-internship"
  | null;

const ENROLLED_AFTER = [
  /returning to (school|university|college|your studies|their studies)/i,
  /return to (school|university|college|your studies|full[- ]time study)/i,
  /(must|should|need to) (be|remain) (currently )?enrolled[^.]*(after|following|upon completion|return|throughout|during)/i,
  /(at least|minimum of) (one|1|a) (semester|term|quarter|year) (remaining|left|of study)/i,
  /not (be )?graduat\w* (before|prior to)/i,
  // German / French / Italian postings: still enrolled during and after, or a mandatory internship of the degree
  /(weiterhin|w[äa]hrend (des|dem) praktikums?|nach dem praktikum)[^.]{0,60}(immatrikuliert|eingeschrieben)|pflichtpraktikum|im rahmen (deines|des|eines) (studiums|studienganges)|praktikumssemester/i,
  /(mindestens|noch) (ein|1|zwei|2) (weiteres? )?semester/i,
  /stage (obligatoire|de fin d['’][ée]tudes)|convention de stage|(toujours|encore) (inscrit|immatricul)[^.]{0,40}(apr[eè]s|pendant)/i,
  /tirocinio curriculare|ancora iscritt/i,
];
/** "anticipated graduation date after the completion of your internship": compare with when the internship ends */
const GRAD_AFTER_INTERNSHIP =
  /graduat\w*[^.]{0,80}\b(after|following|upon) (the )?(completion|end|conclusion) of (the |your |their )?(internship|placement|program)|graduat\w*[^.]{0,40}\bafter (the |your )?(internship|placement)/i;
const EARLY_STUDENT = /\b(sophomores?|freshm[ae]n|rising (juniors?|seniors?)|first[- ]year (students?|undergrad)|second[- ]year (students?|undergrad))\b/i;
const PENULTIMATE = /penultimate|second[- ]to[- ]last year/i;
/** Final-year students are included: that is you now (until you graduate). */
const FINAL_YEAR = /final[- ]year|last year of (study|studies|your degree|university)/i;
const RECENT_GRAD =
  /recent(ly)? (graduate|grad)|graduated within|have (already )?graduated|completed (a|your|their) (bachelor|degree)|open to (recent )?graduates|no need to be enrolled|not required to be enrolled|welcome applicants who have (already )?graduated|abgeschlossene[nrs]? (bachelor|master|hochschul|fachhochschul|uni|informatik)?\s*(studium|abschluss)|(kürzlich|frisch|soeben) abgeschlossen|nach (deinem|dem|ihrem) (studien)?abschluss|hochschulpraktikum|absolvent|berufseinst|jeune(s)? dipl[ôo]m|r[ée]cemment dipl[ôo]m|dipl[ôo]me (obtenu|r[ée]cent)|neolaureat|laurea conseguita/i;
const ENROLLED_NOW =
  /currently (enrolled|pursuing|studying)|current(ly)? (a )?(university )?students?|enrolled[^.]{0,100}at (the )?time of (application|applying)|immatrikuliert|eingeschrieben|du studierst|im (bachelor|master)studium|[ée]tudiant(e)? (en|inscrit|immatricul)|actuellement (en )?[ée]tud|iscritt[oa]|studente/i;

/** Verdict over the graduation sentences of a posting, the reason, and the sentences ordered by relevance. */
export function gradVerdict(
  sentences: string[],
  kind: "intern" | "grad",
  grad: GradDate,
  /** When the internship ends (from its season); Summer of your graduation year when unknown */
  internEnd?: GradDate,
): { verdict: GradVerdict; reason: GradReason; ordered: string[] } {
  const checks = sentences.map((s) => ({ s, w: windowCheck(s, grad) }));
  const ins = checks.filter((c) => c.w === "in").map((c) => c.s);
  const outs = checks.filter((c) => c.w === "out" && (kind === "intern" || /20(2[89]|3\d)/.test(c.s))).map((c) => c.s);
  const finalIncluded = sentences.some((s) => FINAL_YEAR.test(s));
  const enrolledAfter = kind === "intern" ? sentences.filter((s) => ENROLLED_AFTER.some((r) => r.test(s))) : [];
  const penultimateOnly = kind === "intern" && !finalIncluded ? sentences.filter((s) => PENULTIMATE.test(s)) : [];
  const early = kind === "intern" && !finalIncluded ? sentences.filter((s) => EARLY_STUDENT.test(s)) : [];
  const recent = sentences.filter((s) => RECENT_GRAD.test(s));
  const enrolledNow = sentences.filter((s) => ENROLLED_NOW.test(s));
  const end = internEnd ?? { year: grad.year, month: 9 };
  const gradAfter = kind === "intern" ? sentences.filter((s) => GRAD_AFTER_INTERNSHIP.test(s)) : [];
  const gradsTooEarly = gradAfter.length > 0 && ym(grad.year, grad.month) <= ym(end.year, end.month);

  let verdict: GradVerdict = "unclear";
  let reason: GradReason = null;
  let lead: string[] = [];
  if (enrolledAfter.length) [verdict, reason, lead] = ["bad", "enrolled-after", enrolledAfter];
  else if (gradsTooEarly) [verdict, reason, lead] = ["bad", "grad-after-internship", gradAfter];
  else if (ins.length) [verdict, reason, lead] = ["ok", "window-in", ins];
  else if (outs.length) [verdict, reason, lead] = ["bad", "window-out", outs];
  else if (penultimateOnly.length) [verdict, reason, lead] = ["bad", "penultimate-only", penultimateOnly];
  else if (early.length) [verdict, reason, lead] = ["bad", "early-student", early];
  else if (recent.length) [verdict, reason, lead] = ["ok", "recent-grad", recent];
  // "Final-year students" and "currently enrolled" describe you when you apply: you are in your last year now.
  // Offers that need you to still be a student later say so ("return to university", "graduation after the internship").
  else if (finalIncluded) [verdict, reason, lead] = ["ok", "final-year", sentences.filter((s) => FINAL_YEAR.test(s))];
  else if (enrolledNow.length) [verdict, reason, lead] = ["ok", "enrolled-now", enrolledNow];
  return { verdict, reason, ordered: [...new Set([...lead, ...sentences])] };
}
