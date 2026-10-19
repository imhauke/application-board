// Runs the crawler from the terminal (the board's "Search offers" button does the same).
//
//   npm run crawl              # searches, compares and saves
//   npm run crawl -- --dry     # only shows what would change

import { mergeListings } from "../src/lib/crawler/merge";
import { BOARD_CRAWLS, runCrawl } from "../src/lib/crawler/run";
import { fetchAllSources } from "../src/lib/crawler/sources";
import { closePool } from "../src/lib/pg";
import { readDb } from "../src/lib/store";

const board = "global";

if (process.argv.includes("--dry")) {
  const cfg = BOARD_CRAWLS[board];
  const results = await fetchAllSources((r) => console.log(`${r.name}: ${r.listings.length}${r.error ? ` (${r.error})` : ""}`), cfg.sources);
  const db = await readDb({ board, postings: false });
  const before = new Map(db.applications.map((a) => [a.id, a.active]));
  const m = mergeListings(db, results, new Date().toISOString(), "", 0, { ...cfg.merge, board });
  console.log(`\nNew: ${m.added.length} · closed: ${m.closed} · reopened: ${m.reopened} · updated: ${m.updated} · new companies: ${m.newCompanies.length}`);
  for (const a of m.added.slice(0, 40)) console.log(`  + [${a.priority}] ${a.company} — ${a.title} (${a.kind}, ${a.locations.map((l) => l.city).join(", ")})`);
  const closed = db.applications.filter((a) => before.get(a.id) && !a.active);
  for (const a of closed.slice(0, 25)) console.log(`  − ${a.company} — ${a.title}: ${a.closedReason}`);
  if (m.newCompanies.length) console.log(`  New companies: ${m.newCompanies.map((c) => c.name).join(", ")}`);
} else {
  const run = await runCrawl(board, (msg) => console.log(msg));
  console.log(`Done: ${run.fresh ?? run.added.length} new, ${run.closed} closed, ${run.enriched} postings read`);
}
await closePool();
