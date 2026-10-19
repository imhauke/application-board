// One crawl: download the sources, merge them into the offers, read the new postings and save.
// The state lives on globalThis so the API can report progress while it runs.

import { publishedOfOffer } from "../board";
import { candidateOf, loadCvs } from "../cv";
import { isStale } from "../format";
import { assessFit, eligibilityOf } from "../fit";
import { urlKey } from "./merge";
import { boardOf, readDb, transact } from "../store";
import type { Board, CrawlRun } from "../types";
import { enrichPostings } from "./enrich";
import { mergeListings, type MergeOptions } from "./merge";
import { fetchAllSources, SOURCES, type SourceDef } from "./sources";

/** What each board crawls and how it treats what only it finds. */
export const BOARD_CRAWLS: Record<Board, { sources: SourceDef[]; merge: Omit<MergeOptions, "board" | "foreign"> }> = {
  global: { sources: SOURCES, merge: {} },
};

export interface CrawlState {
  running: boolean;
  phase: string;
  progress: { done: number; total: number } | null;
  startedAt: string | null;
  lastRun: CrawlRun | null;
  error: string | null;
}

const g = globalThis as unknown as { __crawls?: Partial<Record<Board, CrawlState>> };

export function crawlState(board: Board = "global"): CrawlState {
  g.__crawls ??= {};
  g.__crawls[board] ??= { running: false, phase: "", progress: null, startedAt: null, lastRun: null, error: null };
  return g.__crawls[board]!;
}

/** Postings not read yet (or read with the old analyser) are filled in a few hundred per run, so a crawl stays short. */
const BACKFILL_PER_RUN = 300;
/** Postings older than this are read again (pay ranges and requirements change), a batch per run. */
const REFRESH_DAYS = 21;
const REFRESH_PER_RUN = 120;
/** An offer published more than this before the previous search was already there: not new */
export const LATE_MARGIN_DAYS = 2;

export async function runCrawl(board: Board = "global", log: (msg: string) => void = () => {}): Promise<CrawlRun> {
  const state = crawlState(board);
  const cfg = BOARD_CRAWLS[board];
  if (state.running) throw new Error("A search is already running");
  const startedAt = new Date().toISOString();
  Object.assign(state, { running: true, phase: "Downloading sources", progress: { done: 0, total: cfg.sources.length }, startedAt, error: null });
  const run: CrawlRun = { board, id: `${board}:${startedAt}`, startedAt, finishedAt: null, ok: false, sources: [], added: [], updated: 0, closed: 0, reopened: 0, enriched: 0 };

  try {
    let done = 0;
    const results = await fetchAllSources((r) => {
      state.progress = { done: ++done, total: cfg.sources.length };
      log(`${r.name}: ${r.listings.length} offers${r.error ? ` (${r.error})` : ""}`);
    }, cfg.sources);
    run.sources = results.map((r) => ({ name: r.name, listings: r.listings.length, error: r.error }));

    state.phase = "Comparing with the board";
    state.progress = null;
    const snapshot = await readDb({ board });
    const cvs = await loadCvs();
    const me = candidateOf(cvs);
    const gradKey = `${me.grad.year}-${String(me.grad.month).padStart(2, "0")}`;
    const expYears = Math.floor(me.months / 12);
    // This board's offers are merged; other boards' are only recognised (no duplicates)
    const own = { ...snapshot, applications: snapshot.applications.filter((a) => boardOf(a) === board) };
    const foreign = snapshot.applications.filter((a) => boardOf(a) !== board);
    const speaks = (lang: string) => me.languages.some((l) => l.name === lang && l.level !== "low");
    const merged = mergeListings(own, results, startedAt, gradKey, expYears, { ...cfg.merge, board, foreign, speaks });
    run.added = merged.added.map((a) => a.id);
    run.updated = merged.updated;
    run.closed = merged.closed;
    run.reopened = merged.reopened;
    log(`${merged.added.length} new, ${merged.closed} closed, ${merged.reopened} reopened${merged.removed.length ? `, ${merged.removed.length} duplicates merged` : ""}`);

    const all = [...own.applications, ...merged.added];
    const stale = Date.now() - REFRESH_DAYS * 864e5;
    const hasText = (id: string) => !!(snapshot.postings[id]?.textZ || snapshot.postings[id]?.hasText);
    const toRead = [
      ...merged.added,
      ...own.applications.filter((a) => a.active && !hasText(a.id)).slice(0, BACKFILL_PER_RUN),
      ...own.applications.filter((a) => a.active && hasText(a.id) && Date.parse(snapshot.postings[a.id].fetchedAt) < stale).slice(0, REFRESH_PER_RUN),
    ];
    state.phase = "Reading postings";
    state.progress = { done: 0, total: toRead.length };
    const postings = await enrichPostings(toRead, (d, t) => (state.progress = { done: d, total: t }), 8, snapshot.postings);
    run.enriched = Object.keys(postings).length;

    // New offers you are not eligible for are not kept: only a note so they are not read again
    const rejected: NonNullable<typeof snapshot.rejected> = {};
    const kept = merged.added.filter((a) => {
      const e = eligibilityOf(a, snapshot.reference.eligibilityNotes[a.eligibilityNote], postings[a.id], me);
      if (e.value !== "no") return true;
      const exp = e.basis === "experience" || e.basis === "title" ? expYears : undefined;
      const lang = e.basis === "language" ? postings[a.id]?.languages.find((l) => l.required && !speaks(l.name))?.name : undefined;
      for (const u of a.urls) rejected[urlKey(u)] = { board, company: a.company, title: a.title, kind: a.kind, reason: e.summary, at: startedAt, grad: gradKey, exp, lang };
      delete postings[a.id];
      return false;
    });
    run.added = kept.map((a) => a.id);
    run.rejected = merged.added.length - kept.length;
    const keptIds = new Set(kept.map((a) => a.id));
    const finalApps = all.filter((a) => !merged.added.some((x) => x.id === a.id) || keptIds.has(a.id));
    // How many of the new ones fit your CV (computed from the PDFs as they are now)
    run.relevant = kept.filter((a) => assessFit(a, postings[a.id], cvs).fit >= 2).length;
    // Already published when the previous search looked (2 days of margin: trackers list a day or two late):
    // found now, but not new. A new source turns up many of these.
    const previous = snapshot.crawls?.find((c) => c.ok)?.startedAt ?? snapshot.ui?.newSeenAt ?? null;
    const cutoff = previous ? new Date(Date.parse(previous) - LATE_MARGIN_DAYS * 864e5).toISOString().slice(0, 10) : null;
    for (const a of kept) {
      const date = publishedOfOffer(a, postings[a.id])?.date;
      if (cutoff && date && date < cutoff) a.oldOnArrival = true;
    }
    run.fresh = kept.filter((a) => !a.oldOnArrival && !isStale(publishedOfOffer(a, postings[a.id])?.date, a.title)).length;

    state.phase = "Saving";
    state.progress = null;
    run.finishedAt = new Date().toISOString();
    run.ok = true;
    await transact(
      (db) => {
        // This board's offers belong to the crawler; tracking, company policies and other boards may have changed meanwhile
        db.applications = [...db.applications.filter((a) => boardOf(a) !== board), ...finalApps];
        db.rejected = { ...(db.rejected ?? {}), ...rejected };
        for (const c of merged.newCompanies) if (kept.some((a) => a.company === c.name)) db.companies[c.name] ??= c;
        for (const id of merged.removed) delete db.postings[id];
        Object.assign(db.postings, postings);
        db.crawls = [run, ...(db.crawls ?? [])].slice(0, 30);
      },
      { board },
    );
    log(
      `Saved: ${run.fresh} new${run.added.length > run.fresh ? ` and ${run.added.length - run.fresh} already published before` : ""} (${run.rejected} left out as not eligible), ${run.enriched} postings read`,
    );
    state.lastRun = run;
    return run;
  } catch (e) {
    run.error = (e as Error).message;
    run.finishedAt = new Date().toISOString();
    state.error = run.error;
    await transact(
      (db) => {
        db.crawls = [run, ...(db.crawls ?? [])].slice(0, 30);
      },
      { board, postings: false },
    ).catch(() => {});
    throw e;
  } finally {
    state.running = false;
    state.phase = "";
    state.progress = null;
  }
}

/** Starts a crawl in the background; false when one is already running. */
export function startCrawl(board: Board = "global"): boolean {
  if (crawlState(board).running) return false;
  runCrawl(board).catch(() => {});
  return true;
}
