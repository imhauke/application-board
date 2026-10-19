// Removes offers you are not eligible for (judged with your CV: graduation date, years of experience,
// seniority in the title) from the database.
// Offers you have touched (status, star, notes or trash) are always kept. A backup is written first
// to data/backups/, and each removed offer is remembered so the crawler does not add it again.
//
//   npx tsx scripts/purge-ineligible.mts          # removes them, with a backup first
//   npx tsx scripts/purge-ineligible.mts --dry    # only counts

import { mkdirSync, writeFileSync } from "node:fs";
import { urlKey } from "../src/lib/crawler/merge";
import { candidateOf, loadCvs } from "../src/lib/cv";
import { eligibilityOf } from "../src/lib/fit";
import { closePool } from "../src/lib/pg";
import { readDb, transact } from "../src/lib/store";

const cvs = await loadCvs();
const me = candidateOf(cvs);
const gradKey = `${me.grad.year}-${String(me.grad.month).padStart(2, "0")}`;
const expYears = Math.floor(me.months / 12);
const dry = process.argv.includes("--dry");

const snapshot = await readDb({ texts: !dry });
if (!dry) {
  mkdirSync("data/backups", { recursive: true });
  const file = `data/backups/db-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  writeFileSync(file, JSON.stringify(snapshot));
  console.log(`Backup: ${file}`);
}

const result = await (dry ? (async (fn: (db: typeof snapshot) => unknown) => fn(snapshot)) : transact)((db) => {
  const touched = (id: string) => {
    const t = db.tracking[id];
    return !!t && (t.status !== "" || t.interested || !!t.notes || !!t.trashed);
  };
  const out = { removed: 0, keptTouched: 0, byReason: {} as Record<string, number> };
  db.rejected ??= {};
  db.applications = db.applications.filter((a) => {
    const e = eligibilityOf(a, db.reference.eligibilityNotes[a.eligibilityNote], db.postings[a.id], me);
    if (e.value !== "no") return true;
    if (touched(a.id)) {
      out.keptTouched++;
      return true;
    }
    out.removed++;
    out.byReason[e.summary] = (out.byReason[e.summary] ?? 0) + 1;
    const exp = e.basis === "experience" || e.basis === "title" ? expYears : undefined;
    const lang = e.basis === "language" ? db.postings[a.id]?.languages.find((l) => l.required && !me.languages.some((m) => m.name === l.name && m.level !== "low"))?.name : undefined;
    for (const u of a.urls) db.rejected![urlKey(u)] = { board: a.board ?? "global", company: a.company, title: a.title, kind: a.kind, reason: e.summary, at: new Date().toISOString(), grad: gradKey, exp, lang };
    delete db.postings[a.id];
    return false;
  });
  return out;
});

const r = result as { removed: number; keptTouched: number; byReason: Record<string, number> };
console.log(`${dry ? "Would remove" : "Removed"} ${r.removed} ineligible offers (keeping ${r.keptTouched} you have touched).`);
for (const [why, n] of Object.entries(r.byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${n} · ${why}`);
await closePool();
