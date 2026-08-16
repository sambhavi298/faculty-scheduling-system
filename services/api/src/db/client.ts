import { Pool } from 'pg';

/**
 * Real pg.Pool, used by integration/concurrency tests and (eventually) the
 * running application. pg.Pool structurally satisfies the Queryable
 * interface already (see queryable.ts) — no adapter needed.
 *
 * Connection info is read from environment variables so the same code works
 * against a local dev database and a CI database without code changes; the
 * defaults match this sandbox's local PostgreSQL instance and test database
 * (Level 5, migrations/sql/*).
 */
export function createPool(): Pool {
  return new Pool({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'faculty_scheduling',
  });
}
