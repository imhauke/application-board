import "server-only";
import { APPLIED_STATUSES, ASSESSED_STATUSES } from "./constants";
import { unpackText } from "./crawler/extract";
import { pool, withWriteTx } from "./pg";
import { loadPostings, NotFoundError, readDb, transact, ValidationError } from "./store";
import type { Board, CompanyInfo, CrawlRun, Status, Tracking, TrackingPatch } from "./types";

export { loadPostings, readDb, transact, NotFoundError, ValidationError };

const EMPTY_TRACKING: Tracking = { status: "", interested: false, notes: "", updatedAt: null };
const STATUSES: Status[] = ["", "preparing", "applied", "interview", "offer", "rejected", "dropped"];

export interface TrackingUpdate {
  tracking: Tracking;
  company: string;
  /** The offer just moved into "applied": time to check the company's application rules */
  justApplied: boolean;
}

const SELECT_TRACKING = `SELECT status, interested, notes, updated_at AS "updatedAt", applied_at AS "appliedAt", trashed, trashed_at AS "trashedAt",
  seen_at AS "seenAt", assessed_at AS "assessedAt" FROM tracking WHERE offer_id = $1`;

async function writeTracking(c: { query: (q: string, v: unknown[]) => Promise<unknown> }, id: string, t: Tracking) {
  await c.query(
    `INSERT INTO tracking (offer_id, status, interested, notes, updated_at, applied_at, trashed, trashed_at, seen_at, assessed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (offer_id) DO UPDATE SET status = EXCLUDED.status, interested = EXCLUDED.interested, notes = EXCLUDED.notes,
       updated_at = EXCLUDED.updated_at, applied_at = EXCLUDED.applied_at, trashed = EXCLUDED.trashed, trashed_at = EXCLUDED.trashed_at,
       seen_at = EXCLUDED.seen_at, assessed_at = EXCLUDED.assessed_at`,
    [id, t.status, t.interested, t.notes, t.updatedAt, t.appliedAt ?? null, t.trashed ?? false, t.trashedAt ?? null, t.seenAt ?? null, t.assessedAt ?? null],
  );
}

/** One offer's status, star, notes or trash: a single-row write. */
export function updateTracking(id: string, patch: TrackingPatch): Promise<TrackingUpdate> {
  return withWriteTx(async (c) => {
    const offer = await c.query<{ company: string }>("SELECT company FROM offers WHERE id = $1", [id]);
    if (!offer.rows.length) throw new NotFoundError(id);
    const prev: Tracking = (await c.query<Tracking>(SELECT_TRACKING, [id])).rows[0] ?? EMPTY_TRACKING;
    const next: Tracking = { ...prev, updatedAt: new Date().toISOString() };
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw new ValidationError(`Invalid status: ${patch.status}`);
      next.status = patch.status;
      if (APPLIED_STATUSES.has(patch.status) && !prev.appliedAt) next.appliedAt = next.updatedAt;
      // An OA or interview starts the company's waiting period, whatever the status says later
      if (ASSESSED_STATUSES.has(patch.status) && !prev.assessedAt) next.assessedAt = next.updatedAt;
    }
    if (patch.interested !== undefined) next.interested = Boolean(patch.interested);
    if (patch.notes !== undefined) next.notes = String(patch.notes).slice(0, 5000);
    if (patch.trashed !== undefined) {
      next.trashed = Boolean(patch.trashed);
      next.trashedAt = next.trashed ? next.updatedAt : null;
    }
    // Seeing an offer is not an edit: it keeps its "updated" time
    if (patch.seen !== undefined) {
      next.seenAt = patch.seen ? (prev.seenAt ?? new Date().toISOString()) : null;
      if (Object.keys(patch).length === 1) next.updatedAt = prev.updatedAt;
    }
    await writeTracking(c, id, next);
    return { tracking: next, company: offer.rows[0].company, justApplied: APPLIED_STATUSES.has(next.status) && !APPLIED_STATUSES.has(prev.status) };
  });
}

/** The same change for several offers in one write (bulk trash / restore, or marking them as seen). */
export function updateTrackingMany(ids: string[], patch: Pick<TrackingPatch, "trashed" | "seen">): Promise<Record<string, Tracking>> {
  return withWriteTx(async (c) => {
    const now = new Date().toISOString();
    const known = new Set((await c.query<{ id: string }>("SELECT id FROM offers WHERE id = ANY($1)", [ids])).rows.map((r) => r.id));
    const out: Record<string, Tracking> = {};
    for (const id of ids) {
      if (!known.has(id)) continue;
      const prev = (await c.query<Tracking>(SELECT_TRACKING, [id])).rows[0] ?? EMPTY_TRACKING;
      const next: Tracking = { ...prev, updatedAt: patch.trashed !== undefined ? now : prev.updatedAt };
      if (patch.trashed !== undefined) {
        next.trashed = Boolean(patch.trashed);
        next.trashedAt = next.trashed ? now : null;
      }
      if (patch.seen !== undefined) next.seenAt = patch.seen ? (prev.seenAt ?? now) : null;
      await writeTracking(c, id, next);
      out[id] = next;
    }
    return out;
  });
}

/** The board's old "New" marker: offers found before it count as seen (later ones are new until opened or marked). */
export async function newSince(board: Board = "global"): Promise<string | null> {
  const r = await pool().query("SELECT value FROM ui_state WHERE board = $1 AND key = 'newSeenAt'", [board]);
  return r.rows[0]?.value ?? null;
}

export async function getCompany(name: string): Promise<CompanyInfo | null> {
  const r = await pool().query("SELECT name, sector, prestige, pay, aliases, on_list, policy FROM companies WHERE name = $1", [name]);
  const row = r.rows[0];
  return row ? { name: row.name, sector: row.sector, prestige: row.prestige, pay: row.pay, aliases: row.aliases, onList: row.on_list, ...(row.policy ? { policy: row.policy } : {}) } : null;
}

export async function getOfferName(id: string): Promise<{ company: string; title: string } | null> {
  return (await pool().query("SELECT company, title FROM offers WHERE id = $1", [id])).rows[0] ?? null;
}

export async function lastCrawl(board: Board = "global"): Promise<CrawlRun | null> {
  const r = await pool().query("SELECT data FROM crawls WHERE board = $1 ORDER BY started_at DESC LIMIT 1", [board]);
  return r.rows[0]?.data ?? null;
}

/** The full text read from an offer's posting, or null when none was stored. */
export async function postingText(id: string): Promise<string | null> {
  const z: string | null | undefined = (await pool().query("SELECT text_z FROM postings WHERE offer_id = $1", [id])).rows[0]?.text_z;
  return z ? unpackText(z).join("\n") : null;
}
