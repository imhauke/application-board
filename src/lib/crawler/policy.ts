// Reads "how many applications can I send" rules out of posting sentences. It runs when you mark
// an offer as applied: we read that company's postings and react to whatever they state.

import type { Application, CompanyPolicy, Kind, PolicyRule, PolicyScope, PostingDetails } from "../types";

const WORDS: Record<string, number> = { one: 1, single: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (w: string) => WORDS[w.toLowerCase()] ?? Number(w);

function windowOf(s: string): { windowDays: number | null; windowLabel: string } {
  const days = s.match(/(\d+|thirty|sixty|ninety)[- ]day/i);
  if (days) {
    const n = { thirty: 30, sixty: 60, ninety: 90 }[days[1].toLowerCase()] ?? Number(days[1]);
    return { windowDays: n, windowLabel: `${n} days` };
  }
  const months = s.match(/(\d+|six|twelve|three)[- ]month/i);
  if (months) {
    const n = { six: 6, twelve: 12, three: 3 }[months[1].toLowerCase()] ?? Number(months[1]);
    return { windowDays: n * 30, windowLabel: `${n} months` };
  }
  if (/\b(each|per|a|any given) (calendar )?year\b|recruiting year|annual/i.test(s)) return { windowDays: null, windowLabel: "recruiting year" };
  return { windowDays: null, windowLabel: "recruiting season" };
}

/**
 * Which applications a rule counts: internships, graduate roles, or both together. A rule that names
 * neither ("Please only apply to one job posting") counts both; one about duplicates of the same
 * posting in several places ("only apply once within the USA or Canada") stays with the posting's kind.
 */
function scopeOf(s: string, foundIn: Kind): PolicyScope {
  const intern = /\bintern(ship)?s?\b|summer (analyst|program)|placement/i.test(s);
  const grad = /\bgraduate\b|full[- ]time|new grad/i.test(s);
  if (intern && !grad) return "intern";
  if (grad && !intern) return "grad";
  if (intern && grad) return "all";
  if (/within (the )?(usa|us|u\.s\.|canada|uk|europe|emea|apac|region|country)|location|office/i.test(s)) return foundIn;
  return "all";
}

/** Turns one sentence into a rule, or null when it states no limit. */
export function parsePolicySentence(s: string, foundIn: Kind, url: string): PolicyRule | null {
  const base = { quote: s, url, ...windowOf(s) };
  // "If you have completed an online assessment or interviewed for a graduate or internship role … in the past 8 months, you are not yet eligible to reapply"
  if (/(assessment|test|interview)[^.]{0,160}(past|last|within) [^.]{0,30}(month|year|day)[^.]{0,80}(not (yet )?eligible|cannot|can['’]t|unable) to (re)?apply/i.test(s)) {
    return { ...base, scope: scopeOf(s, foundIn), kind: "cooldown", max: null };
  }
  // "we will consider you for all open positions": one application already counts for every role
  const linked = /consider(ed)? (you |it |your application )?for (all|other|multiple|any)( open| relevant| other)? (roles|positions|teams|opportunities)|application[^.]{0,40}considered for (all|every)/i;
  const onlyOne = /(only|just) (submit|apply|consider)[^.]{0,40}\bone\b|do not allow multiple|one application per (candidate|applicant)/i;
  if (linked.test(s) && !onlyOne.test(s)) return { ...base, scope: "all", kind: "linked", max: null };
  if (/one application per (role|position|job)|apply (to|for) (each|a) (role|position) once|per role (each|per) year/i.test(s)) {
    return { ...base, scope: scopeOf(s, foundIn), kind: "per-role", max: null };
  }
  const count =
    s.match(/(?:maximum of|up to|no more than|at most) (\w+) (?:separate |different )?(?:applications?|positions?|roles?|jobs?|programs?|programmes?|postings?|business)|(\w+) applications? (?:within|in|per|during|every)/i) ??
    null;
  if (count) {
    const n = num(count.slice(1).find(Boolean) ?? "");
    if (n >= 1 && n <= 10) return { ...base, scope: scopeOf(s, foundIn), kind: "hard", max: n };
  }
  if (
    /(only|just) (submit|apply|consider)[^.]{0,40}\bone\b|one application per (candidate|applicant)|only one application|do not allow multiple applications|apply to (only )?(the )?one (role|posting|position|job)|only apply (to|for) (one|a single)|apply to only one|apply only once|only apply once|one (internship|graduate) application/i.test(s)
  ) {
    return { ...base, scope: scopeOf(s, foundIn), kind: "hard", max: 1 };
  }
  if (/strongly encourage[^.]*(top choice|one|single)|encourage you to (focus on|apply to) (a single|one|your top)|best fits your/i.test(s)) {
    return { ...base, scope: scopeOf(s, foundIn), kind: "soft", max: 1 };
  }
  if (/(able|free|welcome) to apply (to|for) (multiple|several|more than one)|apply to (multiple|several) (roles|positions)/i.test(s)) {
    return { ...base, scope: scopeOf(s, foundIn), kind: "none", max: null };
  }
  return null;
}

const RANK = { hard: 0, linked: 1, cooldown: 2, "per-role": 3, soft: 4, none: 5 } as const;

/** Builds a company policy from the policy sentences of its postings. */
export function policyFromPostings(
  apps: Application[],
  postings: Record<string, PostingDetails>,
): Pick<CompanyPolicy, "status" | "rules"> {
  const rules: PolicyRule[] = [];
  for (const a of apps) {
    const p = postings[a.id];
    for (const s of p?.policy ?? []) {
      const r = parsePolicySentence(s, a.kind, p?.url ?? a.urls[0]);
      if (!r) continue;
      const dup = rules.find((x) => x.scope === r.scope && x.kind === r.kind && x.max === r.max && x.windowDays === r.windowDays);
      if (!dup) rules.push(r);
    }
  }
  // When a hard limit exists for a scope, drop the weaker readings of that same scope
  const sorted = [...rules].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  // (a waiting period after an assessment applies on top of any limit, so it is always kept)
  const kept = sorted.filter(
    (r) => r.kind === "hard" || r.kind === "cooldown" || !sorted.some((h) => h.kind === "hard" && (h.scope === r.scope || h.scope === "all")),
  );
  return { status: kept.length ? "found" : "none", rules: kept };
}
