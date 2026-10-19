// Loads the starting data into an empty database: the target companies (tier, pay level, aliases and
// the application rules their postings state) and the reference notes (eligibility, interviews, CV).
// Offers come from the crawler afterwards ("Search offers" or npm run crawl).
//
//   npm run db:seed                 # data/seed.json
//   npm run db:seed -- other.json   # another file of the same shape
//   npm run db:seed -- --force      # on top of what is there (overwrites those companies)

import { readFileSync } from "node:fs";
import { closePool, pool } from "../src/lib/pg";
import { transact } from "../src/lib/store";
import type { CompanyInfo, Reference } from "../src/lib/types";

const file = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "data/seed.json";
const seed = JSON.parse(readFileSync(file, "utf8")) as { companies: Record<string, CompanyInfo>; reference: Reference };
const existing = Number((await pool().query("SELECT count(*) FROM companies")).rows[0].count);
if (existing && !process.argv.includes("--force")) {
  console.error(`The database already has ${existing} companies; use --force to load the seed on top.`);
  process.exit(1);
}

await transact(
  (db) => {
    Object.assign(db.companies, seed.companies);
    db.reference = seed.reference;
    db.generated = new Date().toISOString().slice(0, 10);
  },
  { board: "global", postings: false },
);
console.log(`Loaded ${Object.keys(seed.companies).length} companies and the reference notes from ${file}. Next: npm run crawl`);
await closePool();
