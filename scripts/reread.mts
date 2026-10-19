// Re-analyses postings with the current analyser.
//
//   npx tsx scripts/reread.mts --offline   # from the stored text, nothing downloaded (seconds)
//   npx tsx scripts/reread.mts --missing   # downloads only the ones without a stored text
//   npx tsx scripts/reread.mts             # downloads them all again
//   npx tsx scripts/reread.mts --via greenhouse,ashby,lever,workable   # only those ATS (e.g. to read their forms)
//
// A posting that fails to download keeps what was already read.

import { analyzePosting, unpackText } from "../src/lib/crawler/extract";
import { enrichPostings } from "../src/lib/crawler/enrich";
import { closePool } from "../src/lib/pg";
import { readDb, transact } from "../src/lib/store";
import type { PostingDetails } from "../src/lib/types";

const offline = process.argv.includes("--offline");
// --board ch: only that board's offers
const onlyBoard = process.argv.includes("--board") ? process.argv[process.argv.indexOf("--board") + 1] : null;
const missing = process.argv.includes("--missing");
// --via greenhouse,lever: only postings read through those adapters
const via = process.argv.includes("--via") ? process.argv[process.argv.indexOf("--via") + 1].split(",") : null;
// Offline needs the stored texts; --missing only needs to know which have one
const db = await readDb({ texts: offline || !missing });
const t0 = Date.now();

if (offline) {
  const out: Record<string, PostingDetails> = {};
  for (const a of db.applications) {
    const p = db.postings[a.id];
    if (!p?.textZ) continue;
    const fresh = analyzePosting(
      {
        ok: true,
        via: p.via,
        url: p.url,
        title: p.title,
        lines: unpackText(p.textZ),
        pay: (p.pay ?? []).filter((x) => x.source === "structured").map((x) => ({ ...x, min: Number(x.min), max: Number(x.max) })),
        datePosted: p.datePosted,
        validThrough: p.validThrough,
        // What came from the source as data, not from the text
        dateFrom: p.dateFrom,
        langs: p.sourceLangs,
        form: p.form ?? undefined,
      },
      a.kind,
      a.title,
    );
    out[a.id] = { ...fresh, fetchedAt: p.fetchedAt, gone: p.gone };
  }
  await transact(
    (fresh) => {
      Object.assign(fresh.postings, out);
    },
    { postings: false, texts: true },
  );
  console.log(`Re-analysed ${Object.keys(out).length} postings from their text in ${Date.now() - t0} ms`);
} else {
  const apps = db.applications.filter(
    (a) =>
      (!onlyBoard || (a.board ?? "global") === onlyBoard) &&
      (!missing || !(db.postings[a.id]?.textZ || db.postings[a.id]?.hasText)) &&
      (!via || (a.active && via.some((v) => db.postings[a.id]?.via?.startsWith(v)))),
  );
  console.log(`Reading ${apps.length} postings…`);
  let last = 0;
  const postings = await enrichPostings(
    apps,
    (d, t) => {
      if (d - last >= 100 || d === t) {
        last = d;
        console.log(`  ${d}/${t} (${Math.round((Date.now() - t0) / 1000)} s)`);
      }
    },
    10,
    db.postings,
  );
  await transact(
    (fresh) => {
      Object.assign(fresh.postings, postings);
    },
    { postings: false },
  );
  const ok = Object.values(postings).filter((p) => p.ok).length;
  const kadoa = Object.values(postings).filter((p) => p.via === "kadoa").length;
  const gone = Object.values(postings).filter((p) => p.gone).length;
  const forms = Object.values(postings).filter((p) => p.form);
  const cover = (c: string) => forms.filter((p) => p.form!.coverLetter === c).length;
  console.log(`Done: ${ok}/${apps.length} with text (${kadoa} from Kadoa), ${gone} taken down from the company's site`);
  if (forms.length) console.log(`Forms: ${forms.length} (cover letter required ${cover("required")}, optional ${cover("optional")}, no option ${cover("none")})`);
}
await closePool();
