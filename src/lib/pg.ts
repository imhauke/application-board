// Postgres connection shared by Next.js routes, the crawler and the scripts (one pool per process).
// Dates come back as the ISO strings the rest of the app already uses.

import pg from "pg";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://board:board@localhost:5434/board";

// timestamptz → ISO string, date → "YYYY-MM-DD" (pg would build local-time Date objects)
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
pg.types.setTypeParser(1114, (v) => new Date(`${v}Z`).toISOString());
pg.types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __pgPool?: pg.Pool };

export function pool(): pg.Pool {
  g.__pgPool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 8, idleTimeoutMillis: 30_000 });
  return g.__pgPool;
}

/** Every write that reads before it writes takes this lock, so the web app, the crawler and the scripts never interleave. */
const WRITE_LOCK = 20_270_316;

/** Runs `fn` in a transaction that holds the write lock. */
export async function withWriteTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Closes the pool so command-line scripts can exit. */
export async function closePool(): Promise<void> {
  await g.__pgPool?.end();
  g.__pgPool = undefined;
}
