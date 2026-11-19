import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

export const PG = Symbol('PG');
export type Db = pg.Pool;

export function createPool(): Db {
  const pool = new pg.Pool({ connectionString: required('DATABASE_URL'), max: 10 });
  // An idle client that loses its connection (database restart, failover) emits 'error' on the pool.
  // Unhandled, that event kills the process: found by the Atalaya orders-flagship-db-down game day.
  // pg already discards the broken client; the next query opens a new connection.
  pool.on('error', (e) => console.warn(JSON.stringify({ level: 'warn', msg: 'idle database connection lost', error: e.message })));
  return pool;
}

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Forward-only SQL migrations; an advisory lock lets api and worker boot concurrently. */
export async function migrate(db: Db): Promise<void> {
  const dir = join(import.meta.dirname, 'migrations');
  await tx(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727274)');
    await c.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, run_at timestamptz DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM _migrations')).rows.map((r) => r.name));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await c.query(await readFile(join(dir, file), 'utf8'));
      await c.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
    }
  });
}
