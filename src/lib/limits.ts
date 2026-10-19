// Per-company application limits: once you have used a company's quota for a track
// (internships, new grad, or both), its other open roles in that track are no longer actionable.
// Also answers the question that matters most when a company has both: can you apply to an
// internship and a graduate role at the same time, or would the second one be wasted?

import { APPLIED_STATUSES, ASSESSED_STATUSES } from "./constants";
import type { CompanyPolicy, Kind, PolicyRule, PolicyScope, Status, Tracking } from "./types";

export interface Block {
  rule: PolicyRule;
  appliedTo: { id: string; title: string }[];
}

interface Offer {
  id: string;
  company: string;
  kind: Kind;
  title: string;
}

const SCOPE_LABEL: Record<PolicyScope, string> = { intern: "for internships", grad: "for new grad roles", all: "" };
const KIND_WORD: Record<Kind, string> = { intern: "internship", grad: "new grad" };

const months = (days: number | null) => (days ? `${Math.round(days / 30)} months` : "the whole season");

export function ruleSummary(r: PolicyRule): string {
  const scope = SCOPE_LABEL[r.scope];
  switch (r.kind) {
    case "hard":
      return `Max. ${r.max} application${r.max === 1 ? "" : "s"}${scope ? ` ${scope}` : " in total (internship and new grad)"} every ${r.windowLabel}`
        .replace("every recruiting season", "per season")
        .replace("every recruiting year", "per year");
    case "linked":
      return "One application counts for all its roles: no need to send more";
    case "cooldown":
      return `After their OA or an interview, you cannot apply again${r.scope === "all" ? " (internship or new grad)" : ` to ${KIND_WORD[r.scope]} roles`} for ${months(r.windowDays)}`;
    case "per-role":
      return "One application per role and season; you can apply to several roles";
    case "soft":
      return `They recommend applying to a single role${scope ? ` ${scope}` : ""}`;
    default:
      return "Several applications allowed";
  }
}

const inScope = (r: PolicyRule, kind: Kind) => r.scope === "all" || r.scope === kind;

/** The rule that caps this kind of offer at its company, if any ("one application counts for all" caps at one). */
export function hardRuleFor(policy: CompanyPolicy | undefined, kind: Kind): PolicyRule | null {
  const r = policy?.rules.find((x) => (x.kind === "hard" && x.max != null) || x.kind === "linked");
  return r && inScope(r, kind) ? (r.kind === "linked" ? { ...r, max: 1 } : r) : null;
}

/** Offers hidden because their company's limit is already used, one application already covers them, or you are in a waiting period. */
export function blockedOffers(
  offers: Offer[],
  tracking: Record<string, Tracking>,
  policies: Record<string, CompanyPolicy>,
  now = Date.now(),
): Map<string, Block> {
  const out = new Map<string, Block>();
  const byCompany = new Map<string, Offer[]>();
  for (const o of offers) {
    if (!policies[o.company]?.rules.some((r) => r.kind === "hard" || r.kind === "linked" || r.kind === "cooldown")) continue;
    const list = byCompany.get(o.company) ?? [];
    list.push(o);
    byCompany.set(o.company, list);
  }
  const open = (o: Offer) => {
    const s = tracking[o.id]?.status ?? "";
    return s === "" || s === "preparing";
  };
  const within = (since: string | null | undefined, days: number | null) => days == null || !since || now - Date.parse(since) <= days * 864e5;
  for (const [name, list] of byCompany) {
    for (const rule of policies[name].rules) {
      const scoped = list.filter((o) => inScope(rule, o.kind));
      let used: Offer[] = [];
      if (rule.kind === "cooldown") {
        used = scoped.filter((o) => {
          const t = tracking[o.id];
          // An OA or interview counts even after the offer moved on to "rejected" or "dropped"
          return !!t && (ASSESSED_STATUSES.has(t.status) || !!t.assessedAt) && within(t.assessedAt ?? t.appliedAt ?? t.updatedAt, rule.windowDays);
        });
        if (!used.length) continue;
      } else if (rule.kind === "hard" || rule.kind === "linked") {
        const max = rule.kind === "linked" ? 1 : rule.max;
        if (max == null) continue;
        used = scoped.filter((o) => {
          const t = tracking[o.id];
          return !!t && APPLIED_STATUSES.has(t.status) && within(t.appliedAt ?? t.updatedAt, rule.windowDays);
        });
        if (used.length < max) continue;
      } else continue;
      const appliedTo = used.map((o) => ({ id: o.id, title: o.title }));
      for (const o of scoped) if (open(o) && !out.has(o.id)) out.set(o.id, { rule, appliedTo });
    }
  }
  return out;
}

export type CrossVerdict = "no" | "linked" | "cooldown" | "soft" | "yes" | "unknown";

/** Postings for both tracks at once ("2027 - Internship or Graduate, Software Engineer") */
export const BOTH_TRACKS = /\bintern(ship)?s?\s*(or|\/|&|and)\s*(new )?grad(uate)?s?\b|\b(new )?grad(uate)?s?\s*(or|\/|&|and)\s*intern(ship)?s?\b/i;

/** An application you sent to a posting that already covers both tracks makes the other track redundant. */
export function coveredBy(appliedTitles: string[]): CrossTrack | null {
  const both = appliedTitles.find((t) => BOTH_TRACKS.test(t));
  return both
    ? { verdict: "linked", label: "Already covered", text: `Your application to "${both}" already covers internship and new grad: no need for another one for the other type.`, rule: null }
    : null;
}

export interface CrossTrack {
  verdict: CrossVerdict;
  /** Short label for tags */
  label: string;
  text: string;
  rule: PolicyRule | null;
}

/**
 * Can you have an internship and a graduate application at this company at the same time?
 * `kind` is the offer you are looking at; the answer is about adding it to one of the other track.
 */
export function crossTrack(policy: CompanyPolicy | undefined, kind: Kind): CrossTrack {
  const other = KIND_WORD[kind === "intern" ? "grad" : "intern"];
  const rules = policy?.rules ?? [];
  const both = rules.filter((r) => r.scope === "all");
  const find = (k: PolicyRule["kind"], f: (r: PolicyRule) => boolean = () => true) => both.find((r) => r.kind === k && f(r)) ?? null;

  const one = find("hard", (r) => r.max === 1);
  if (one) return { verdict: "no", label: "Only 1 in total", text: `No: they accept a single application in total, so it is ${KIND_WORD[kind]} or ${other}, not both. Pick the one you are eligible for.`, rule: one };
  const linked = find("linked");
  if (linked) return { verdict: "linked", label: "Already counts", text: "No need: one application counts for all its roles, the other type included. Sending another adds nothing.", rule: linked };
  const cool = rules.find((r) => r.kind === "cooldown" && (r.scope === "all" || r.scope === kind)) ?? null;
  if (cool)
    return {
      verdict: "cooldown",
      label: "Careful: OA",
      text: `You can apply to both, but once you take the OA or an interview for one, you cannot apply to the other for ${months(cool.windowDays)}. Send first the one you want most (and are eligible for).`,
      rule: cool,
    };
  const many = find("hard", (r) => (r.max ?? 0) > 1);
  if (many) return { verdict: "yes", label: `Max. ${many.max} in total`, text: `Yes, but they count together: at most ${many.max} applications across internship and new grad every ${many.windowLabel}.`, rule: many };
  const soft = find("soft");
  if (soft) return { verdict: "soft", label: "Better 1", text: "You can, but they recommend applying only to your first choice.", rule: soft };
  const yes = find("none") ?? find("per-role") ?? rules.find((r) => r.kind === "per-role" || r.kind === "none") ?? null;
  if (yes) return { verdict: "yes", label: "Allowed", text: "Yes: several applications are allowed (one per role).", rule: yes };
  const trackOnly = rules.find((r) => r.kind === "hard" && r.scope !== "all") ?? null;
  if (trackOnly)
    return {
      verdict: "unknown",
      label: "Unknown",
      text: `Their limit is only for ${KIND_WORD[trackOnly.scope as Kind]} roles (${ruleSummary(trackOnly).toLowerCase()}); they say nothing about combining it with ${trackOnly.scope === "intern" ? "new grad" : "internship"} roles.`,
      rule: trackOnly,
    };
  return {
    verdict: "unknown",
    label: "Unknown",
    text: policy ? "They say nothing about applying to internship and new grad roles at the same time." : "Not checked yet; it is checked when you mark one of their offers as applied.",
    rule: null,
  };
}
