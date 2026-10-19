// Checks a company's application rules on demand (when you mark one of its offers as applied):
// reads its postings, parses what they say about limits and stores the result on the company.

import { readDb, transact } from "../store";
import type { CompanyPolicy, PolicyRule } from "../types";
import { enrichPostings } from "./enrich";
import { policyFromPostings } from "./policy";

const g = globalThis as unknown as { __policyChecks?: Map<string, Promise<CompanyPolicy>> };
const inflight = () => (g.__policyChecks ??= new Map());

/** Postings fetched per check for a company whose offers were never read. */
const MAX_FETCH = 8;
/** Days after which a policy read from postings is checked again. */
export const POLICY_TTL_DAYS = 7;

export function policyIsFresh(p: CompanyPolicy | undefined): boolean {
  if (!p) return false;
  if (p.origin !== "posting") return true;
  return Date.now() - Date.parse(p.checkedAt) < POLICY_TTL_DAYS * 864e5;
}

const same = (a: PolicyRule, b: PolicyRule) => a.scope === b.scope && a.kind === b.kind && a.max === b.max && a.windowDays === b.windowDays;

export function checkCompanyPolicy(company: string, focusId?: string): Promise<CompanyPolicy> {
  const running = inflight().get(company);
  if (running) return running;
  const job = (async () => {
    const db = await readDb({ company });
    const apps = db.applications.filter((a) => a.company === company);
    if (!apps.length) throw new Error(`No offers from ${company}`);
    // The offer you just applied to first, then the ones whose posting was never read
    const unread = apps
      .filter((a) => !db.postings[a.id]?.ok)
      .sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0))
      .slice(0, MAX_FETCH);
    const fresh = await enrichPostings(unread, undefined, 4, db.postings);
    const postings = { ...db.postings, ...fresh };
    const found = policyFromPostings(apps, postings);
    const checkedAt = new Date().toISOString();

    return transact(
      (d) => {
        Object.assign(d.postings, fresh);
        const info = d.companies[company];
        const prev = info?.policy;
        let policy: CompanyPolicy;
        if (prev && prev.origin !== "posting") {
          // Keep what came from the company's FAQ (or your own edits) and add anything new from postings
          const extra = found.rules.filter((r) => !prev.rules.some((p) => same(p, r)));
          policy = { ...prev, rules: [...prev.rules, ...extra], checkedAt };
        } else if (found.status === "found") {
          policy = { status: "found", origin: "posting", rules: found.rules, checkedAt };
        } else {
          const read = apps.filter((a) => postings[a.id]?.ok).length;
          policy = {
            status: read ? "none" : "error",
            origin: "posting",
            rules: [],
            checkedAt,
            note: read
              ? `Read ${read} of its ${apps.length} postings: none mentions an application limit.`
              : "None of its postings could be read (the site blocks automated reads).",
          };
        }
        if (info) info.policy = policy;
        return policy;
      },
      { company },
    );
  })();
  inflight().set(company, job);
  job.finally(() => inflight().delete(company)).catch(() => {});
  return job;
}
