// The database: Postgres (schema in db/migrations, managed with Alembic). The app keeps working
// with the same `Database` object as before; this layer loads it from the tables and writes back
// only the rows that changed. Every write takes one advisory lock, so the web app, the crawler
// and the scripts never interleave.
//
// What is loaded: every offer, your tracking, companies, crawler runs and turned-down offers;
// postings for all offers (or one company's), and their full texts only when asked (re-analysis).

import type pg from "pg";
import { pool, withWriteTx } from "./pg";
import type { Application, Board, CompanyInfo, CrawlRun, Database, PostingDetails, Reference, RejectedOffer, Tracking } from "./types";

export interface ReadOptions {
  /** Load the postings of this board's offers. Default: all */
  board?: Board;
  /** Load only the postings of this company's offers (offer page) */
  company?: string;
  /** Skip postings altogether */
  postings?: boolean;
  /** Also load the postings' full texts */
  texts?: boolean;
}

export const boardOf = (a: Pick<Application, "board">): Board => a.board ?? "global";

/** The offers a board shows: its own. */
export const onBoard = (a: Application, board: Board) => boardOf(a) === board;

const EMPTY_REFERENCE: Reference = { regions: [], eligibilityNotes: [], interviewNotes: [], cvReasons: {} };

// ---------- rows ⇄ objects

interface OfferRow {
  id: string;
  board: Board;
  data: Application;
}
interface TrackingRow {
  offer_id: string;
  status: Tracking["status"];
  interested: boolean;
  notes: string;
  updated_at: string | null;
  applied_at: string | null;
  trashed: boolean;
  trashed_at: string | null;
  seen_at: string | null;
  assessed_at: string | null;
}

const trackingOf = (r: TrackingRow): Tracking => ({
  status: r.status,
  interested: r.interested,
  notes: r.notes,
  updatedAt: r.updated_at,
  appliedAt: r.applied_at,
  trashed: r.trashed,
  trashedAt: r.trashed_at,
  seenAt: r.seen_at,
  assessedAt: r.assessed_at,
});

/** "2026-10-12" or null, for the date columns (the JSON keeps whatever the source said). */
const isoDay = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

async function queryPostings(c: pg.PoolClient | pg.Pool, opts: ReadOptions): Promise<Record<string, PostingDetails>> {
  const text = opts.texts ? ", p.text_z" : ", p.text_z IS NOT NULL AS has_text";
  const rows = opts.company
    ? await c.query(`SELECT p.offer_id, p.details${text} FROM postings p JOIN offers o ON o.id = p.offer_id WHERE o.company = $1`, [opts.company])
    : opts.board
      ? await c.query(
          `SELECT p.offer_id, p.details${text} FROM postings p JOIN offers o ON o.id = p.offer_id WHERE o.board = $1`,
          [opts.board],
        )
      : await c.query(`SELECT p.offer_id, p.details${text} FROM postings p`);
  const out: Record<string, PostingDetails> = {};
  for (const r of rows.rows) out[r.offer_id] = r.text_z ? { ...r.details, textZ: r.text_z } : r.has_text ? { ...r.details, hasText: true } : r.details;
  return out;
}

/** Postings of one company's offers (the offer page) or one board's. */
export const loadPostings = (opts: Pick<ReadOptions, "board" | "company" | "texts">) => queryPostings(pool(), opts);

async function load(c: pg.PoolClient | pg.Pool, board: Board, opts: ReadOptions): Promise<Database> {
  // In parallel on the pool; one after the other inside a transaction (a client runs one query at a time)
  const queries = [
    () => c.query<OfferRow>("SELECT id, board, data FROM offers ORDER BY id"),
    () => c.query<TrackingRow>("SELECT * FROM tracking"),
    () => c.query("SELECT name, sector, prestige, pay, aliases, on_list, policy FROM companies ORDER BY name"),
    () => c.query("SELECT * FROM rejected"),
    () => c.query("SELECT data FROM crawls WHERE board = $1 ORDER BY started_at DESC LIMIT 30", [board]),
    () => c.query("SELECT key, value FROM ui_state WHERE board = $1", [board]),
    () => c.query("SELECT key, value FROM reference"),
  ] as const;
  const inTx = "release" in c;
  const results: pg.QueryResult[] = [];
  if (inTx) for (const q of queries) results.push(await q());
  else results.push(...(await Promise.all(queries.map((q) => q()))));
  const [offers, tracking, companies, rejected, crawls, ui, reference] = results as [
    pg.QueryResult<OfferRow>,
    pg.QueryResult<TrackingRow>,
    ...pg.QueryResult[],
  ];
  const applications = offers.rows.map((r) => ({ ...r.data, board: r.board }));

  const postings = opts.postings === false ? {} : await queryPostings(c, opts);

  const refs = Object.fromEntries(reference.rows.map((r) => [r.key, r.value]));
  return {
    version: 2,
    board,
    ui: { newSeenAt: ui.rows.find((r) => r.key === "newSeenAt")?.value ?? null },
    rejected: Object.fromEntries(
      rejected.rows.map((r) => [
        r.url_key,
        {
          company: r.company,
          title: r.title,
          kind: r.kind,
          reason: r.reason,
          at: r.at,
          grad: r.grad,
          ...(r.exp != null ? { exp: r.exp } : {}),
          ...(r.lang ? { lang: r.lang } : {}),
          board: r.board,
        } as RejectedOffer,
      ]),
    ),
    generated: refs.generated ?? new Date().toISOString(),
    reference: refs.reference ?? EMPTY_REFERENCE,
    applications,
    tracking: Object.fromEntries(tracking.rows.map((r) => [r.offer_id, trackingOf(r)])),
    postings,
    companies: Object.fromEntries(
      companies.rows.map((r) => [
        r.name,
        { name: r.name, sector: r.sector, prestige: r.prestige, pay: r.pay, aliases: r.aliases, onList: r.on_list, ...(r.policy ? { policy: r.policy } : {}) } as CompanyInfo,
      ]),
    ),
    crawls: crawls.rows.map((r) => r.data as CrawlRun),
  };
}

export async function readDb(opts: ReadOptions = {}): Promise<Database> {
  return load(pool(), opts.board ?? "global", opts);
}

// ---------- writes: only what changed

interface Snapshot {
  apps: Map<string, string>;
  tracking: Map<string, string>;
  postings: Map<string, string>;
  texts: Map<string, string | undefined>;
  companies: Map<string, string>;
  rejected: Map<string, string>;
  crawls: Map<string, string>;
  ui: string;
  reference: string;
  generated: string;
}

const withoutText = (p: PostingDetails) => {
  const { textZ, hasText, ...rest } = p;
  void textZ;
  void hasText;
  return rest;
};

function snapshot(db: Database): Snapshot {
  const map = <T,>(entries: [string, T][], f: (v: T) => unknown = (v) => v) => new Map(entries.map(([k, v]) => [k, JSON.stringify(f(v))]));
  return {
    apps: map(db.applications.map((a) => [a.id, a])),
    tracking: map(Object.entries(db.tracking)),
    postings: map(Object.entries(db.postings), withoutText),
    texts: new Map(Object.entries(db.postings).map(([k, p]) => [k, p.textZ])),
    companies: map(Object.entries(db.companies)),
    rejected: map(Object.entries(db.rejected ?? {})),
    crawls: map((db.crawls ?? []).map((r) => [r.id, r])),
    ui: JSON.stringify(db.ui ?? {}),
    reference: JSON.stringify(db.reference),
    generated: db.generated,
  };
}

/** Rows of `current` that are new or differ from the snapshot, and snapshot keys no longer present. */
function diff<T>(current: [string, T][], before: Map<string, string>, f: (v: T) => unknown = (v) => v) {
  const changed: [string, T][] = [];
  const seen = new Set<string>();
  for (const [k, v] of current) {
    seen.add(k);
    if (before.get(k) !== JSON.stringify(f(v))) changed.push([k, v]);
  }
  return { changed, removed: [...before.keys()].filter((k) => !seen.has(k)) };
}

async function save(c: pg.PoolClient, db: Database, snap: Snapshot, opts: ReadOptions): Promise<void> {
  const board = db.board ?? "global";
  const json = (rows: unknown[]) => JSON.stringify(rows);

  // Companies first (offers name them), then offers, then what hangs from offers
  const companies = diff(Object.entries(db.companies), snap.companies);
  if (companies.changed.length) {
    await c.query(
      `INSERT INTO companies (name, sector, prestige, pay, aliases, on_list, policy, updated_at)
       SELECT r.name, coalesce(r.sector, ''), coalesce(r.prestige, 'C'), coalesce(r.pay, 3), coalesce(r.aliases, '[]'), coalesce(r.on_list, false), r.policy, now()
       FROM jsonb_to_recordset($1::jsonb) AS r(name text, sector text, prestige text, pay smallint, aliases jsonb, on_list boolean, policy jsonb)
       ON CONFLICT (name) DO UPDATE SET sector = EXCLUDED.sector, prestige = EXCLUDED.prestige, pay = EXCLUDED.pay, aliases = EXCLUDED.aliases,
         on_list = EXCLUDED.on_list, policy = EXCLUDED.policy, updated_at = now()`,
      [json(companies.changed.map(([, v]) => ({ name: v.name, sector: v.sector, prestige: v.prestige, pay: v.pay, aliases: v.aliases ?? [], on_list: v.onList, policy: v.policy ?? null })))],
    );
  }

  const apps = diff(db.applications.map((a) => [a.id, a] as [string, Application]), snap.apps);
  if (apps.changed.length) {
    await c.query(
      `INSERT INTO offers (id, board, company, kind, title, active, first_seen_at, posted_at, data, updated_at)
       SELECT r.id, r.board, r.company, r.kind, r.title, r.active, r.first_seen_at, r.posted_at, r.data, now()
       FROM jsonb_to_recordset($1::jsonb) AS r(id text, board text, company text, kind text, title text, active boolean,
         first_seen_at timestamptz, posted_at date, data jsonb)
       ON CONFLICT (id) DO UPDATE SET board = EXCLUDED.board, company = EXCLUDED.company, kind = EXCLUDED.kind,
         title = EXCLUDED.title, active = EXCLUDED.active, first_seen_at = EXCLUDED.first_seen_at, posted_at = EXCLUDED.posted_at,
         data = EXCLUDED.data, updated_at = now()`,
      [
        json(
          apps.changed.map(([, a]) => {
            const { board: own, ...data } = a;
            return {
              id: a.id,
              board: own ?? "global",
              company: a.company,
              kind: a.kind,
              title: a.title,
              active: a.active,
              first_seen_at: a.firstSeenAt,
              posted_at: isoDay(a.postedAt),
              data,
            };
          }),
        ),
      ],
    );
  }
  const offerIds = new Set(db.applications.map((a) => a.id));

  const tracking = diff(Object.entries(db.tracking), snap.tracking);
  const trackRows = tracking.changed.filter(([id]) => offerIds.has(id));
  if (trackRows.length) {
    await c.query(
      `INSERT INTO tracking (offer_id, status, interested, notes, updated_at, applied_at, trashed, trashed_at, seen_at, assessed_at)
       SELECT r.offer_id, coalesce(r.status, ''), coalesce(r.interested, false), coalesce(r.notes, ''), r.updated_at, r.applied_at,
         coalesce(r.trashed, false), r.trashed_at, r.seen_at, r.assessed_at
       FROM jsonb_to_recordset($1::jsonb) AS r(offer_id text, status text, interested boolean, notes text, updated_at timestamptz,
         applied_at timestamptz, trashed boolean, trashed_at timestamptz, seen_at timestamptz, assessed_at timestamptz)
       ON CONFLICT (offer_id) DO UPDATE SET status = EXCLUDED.status, interested = EXCLUDED.interested, notes = EXCLUDED.notes,
         updated_at = EXCLUDED.updated_at, applied_at = EXCLUDED.applied_at, trashed = EXCLUDED.trashed, trashed_at = EXCLUDED.trashed_at,
         seen_at = EXCLUDED.seen_at, assessed_at = EXCLUDED.assessed_at`,
      [
        json(
          trackRows.map(([id, t]) => ({
            offer_id: id,
            status: t.status,
            interested: t.interested,
            notes: t.notes,
            updated_at: t.updatedAt,
            applied_at: t.appliedAt ?? null,
            trashed: t.trashed ?? false,
            trashed_at: t.trashedAt ?? null,
            seen_at: t.seenAt ?? null,
            assessed_at: t.assessedAt ?? null,
          })),
        ),
      ],
    );
  }

  const postings = diff(Object.entries(db.postings), snap.postings, withoutText);
  // A posting whose details did not change may still have a new text
  const textChanged = Object.entries(db.postings).filter(([k, p]) => opts.texts && snap.texts.has(k) && snap.texts.get(k) !== p.textZ);
  const postRows = [...new Map([...postings.changed, ...textChanged]).entries()].filter(([id]) => offerIds.has(id));
  for (let i = 0; i < postRows.length; i += 200) {
    // Batches: full texts make these rows large
    await c.query(
      `INSERT INTO postings (offer_id, fetched_at, ok, via, url, gone, date_posted, details, text_z)
       SELECT r.offer_id, r.fetched_at, r.ok, coalesce(r.via, ''), coalesce(r.url, ''), coalesce(r.gone, false), r.date_posted, r.details, r.text_z
       FROM jsonb_to_recordset($1::jsonb) AS r(offer_id text, fetched_at timestamptz, ok boolean, via text, url text, gone boolean,
         date_posted date, details jsonb, text_z text)
       ON CONFLICT (offer_id) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, ok = EXCLUDED.ok, via = EXCLUDED.via, url = EXCLUDED.url,
         gone = EXCLUDED.gone, date_posted = EXCLUDED.date_posted, details = EXCLUDED.details,
         text_z = ${opts.texts ? "EXCLUDED.text_z" : "coalesce(EXCLUDED.text_z, postings.text_z)"}`,
      [
        json(
          postRows.slice(i, i + 200).map(([id, p]) => ({
            offer_id: id,
            fetched_at: p.fetchedAt,
            ok: p.ok,
            via: p.via,
            url: p.url,
            gone: p.gone ?? false,
            date_posted: isoDay(p.datePosted),
            details: withoutText(p),
            text_z: p.textZ ?? null,
          })),
        ),
      ],
    );
  }

  // Removals (offers cascade to their tracking and posting)
  if (apps.removed.length) await c.query("DELETE FROM offers WHERE id = ANY($1)", [apps.removed]);
  if (tracking.removed.length) await c.query("DELETE FROM tracking WHERE offer_id = ANY($1)", [tracking.removed]);
  if (postings.removed.length) await c.query("DELETE FROM postings WHERE offer_id = ANY($1)", [postings.removed]);
  if (companies.removed.length) await c.query("DELETE FROM companies WHERE name = ANY($1) AND NOT EXISTS (SELECT 1 FROM offers WHERE company = companies.name)", [companies.removed]);

  const rejected = diff(Object.entries(db.rejected ?? {}), snap.rejected);
  if (rejected.changed.length) {
    await c.query(
      `INSERT INTO rejected (url_key, board, company, title, kind, reason, at, grad, exp, lang)
       SELECT r.url_key, coalesce(r.board, 'global'), r.company, r.title, r.kind, r.reason, r.at, r.grad, r.exp, r.lang
       FROM jsonb_to_recordset($1::jsonb) AS r(url_key text, board text, company text, title text, kind text, reason text, at timestamptz, grad text,
         exp smallint, lang text)
       ON CONFLICT (url_key) DO UPDATE SET board = EXCLUDED.board, company = EXCLUDED.company, title = EXCLUDED.title, kind = EXCLUDED.kind,
         reason = EXCLUDED.reason, at = EXCLUDED.at, grad = EXCLUDED.grad, exp = EXCLUDED.exp, lang = EXCLUDED.lang`,
      [json(rejected.changed.map(([k, r]) => ({ url_key: k, ...r, board: r.board ?? board })))],
    );
  }
  if (rejected.removed.length) await c.query("DELETE FROM rejected WHERE url_key = ANY($1)", [rejected.removed]);

  const crawls = diff((db.crawls ?? []).map((r) => [r.id, r] as [string, CrawlRun]), snap.crawls);
  if (crawls.changed.length) {
    await c.query(
      `INSERT INTO crawls (id, board, started_at, finished_at, ok, data)
       SELECT r.id, r.board, r.started_at, r.finished_at, r.ok, r.data FROM jsonb_to_recordset($1::jsonb)
         AS r(id text, board text, started_at timestamptz, finished_at timestamptz, ok boolean, data jsonb)
       ON CONFLICT (id) DO UPDATE SET finished_at = EXCLUDED.finished_at, ok = EXCLUDED.ok, data = EXCLUDED.data`,
      [json(crawls.changed.map(([, r]) => ({ id: r.id, board: r.board ?? board, started_at: r.startedAt, finished_at: r.finishedAt, ok: r.ok, data: r })))],
    );
  }
  if (crawls.removed.length) await c.query("DELETE FROM crawls WHERE id = ANY($1) AND board = $2", [crawls.removed, board]);

  if (JSON.stringify(db.ui ?? {}) !== snap.ui) {
    await c.query(
      "INSERT INTO ui_state (board, key, value) VALUES ($1, 'newSeenAt', $2::jsonb) ON CONFLICT (board, key) DO UPDATE SET value = EXCLUDED.value",
      [board, JSON.stringify(db.ui?.newSeenAt ?? null)],
    );
  }
  for (const [key, value, before] of [
    ["reference", JSON.stringify(db.reference), snap.reference],
    ["generated", JSON.stringify(db.generated), JSON.stringify(snap.generated)],
  ]) {
    if (value !== before) {
      await c.query("INSERT INTO reference (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
    }
  }
}

/**
 * Runs `fn` on a fresh copy of the database and saves what changed, in one transaction under the
 * write lock. `opts` says which postings `fn` needs (see ReadOptions).
 */
export function transact<T>(fn: (db: Database) => T | Promise<T>, opts: ReadOptions = {}): Promise<T> {
  return withWriteTx(async (c) => {
    const db = await load(c, opts.board ?? "global", opts);
    const snap = snapshot(db);
    const result = await fn(db);
    await save(c, db, snap, opts);
    return result;
  });
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
