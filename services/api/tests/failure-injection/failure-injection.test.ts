import { execSync } from 'child_process';
import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';

/**
 * Level 7 — Section 6: Failure injection.
 *
 * HONEST SCOPE NOTE: as of the end of Level 6, no notification-DISPATCHING
 * service exists yet — the `notifications` table is defined in the schema
 * (Level 5, Section 3) but nothing in this codebase currently writes to it
 * or sends an email/push/websocket notification. "Notification service
 * unavailable/slow" therefore cannot be genuinely tested here: there is
 * nothing running to take down or slow down. This is a real gap, not a
 * skipped test — it is called out explicitly in the Break Report rather
 * than faked with a mock service that doesn't reflect anything in this
 * codebase.
 *
 * IMPORTANT — RUN THIS FILE IN ISOLATION: the first test below actually
 * stops and restarts the real PostgreSQL server process (per Level 7's
 * explicit instruction to inject REAL failures, not mocked ones). Running
 * it in the same `jest` invocation as the other projects (unit,
 * integration, concurrency, security) risks their in-flight database
 * queries failing collaterally while Postgres is down. Always run this
 * project by itself:
 *
 *   npx jest --selectProjects failure-injection --runInBand
 */

const STUDENT_A = '100';
const FACULTY = '200';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

function waitForPostgresUp(timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync('pg_isready -h 127.0.0.1 -p 5432', { stdio: 'ignore' });
      return;
    } catch {
      // not ready yet, keep polling
    }
  }
  throw new Error('Postgres did not come back up within the timeout');
}

/**
 * Process control for the real PostgreSQL server, made cross-platform.
 *
 * PROBLEM: this file previously hardcoded `service postgresql start/stop`,
 * which only exists on Linux distributions that use the `service` wrapper
 * (e.g. the Debian/Ubuntu-style container this project was originally
 * developed in). On Windows — where PostgreSQL normally installs as a
 * Windows Service — `service` does not exist at all, so this test failed
 * outright with "'service' is not recognized..." rather than testing
 * anything.
 *
 * FIX: pick a platform-appropriate default, but make it overridable via
 * PG_STOP_CMD / PG_START_CMD environment variables, because there is no
 * single correct Windows command here — the Windows service name depends
 * on the installer and PostgreSQL version (commonly
 * `postgresql-x64-16`, but this varies). Find your exact service name with
 * `Get-Service -Name postgresql*` in PowerShell, and if it isn't
 * `postgresql-x64-16`, set PG_STOP_CMD / PG_START_CMD in your `.env` (or
 * the shell environment) to match, e.g.:
 *
 *   PG_STOP_CMD=net stop postgresql-x64-17
 *   PG_START_CMD=net start postgresql-x64-17
 *
 * `net start`/`net stop` require an elevated (Run as Administrator)
 * terminal on Windows. HONEST CAVEAT: the Windows default below has not
 * been executed against a real Windows PostgreSQL service from this
 * codebase's own test runs — only the Linux `service postgresql` path has
 * been verified end-to-end. If the default service name doesn't match
 * your install, override it with the env vars above rather than editing
 * this file.
 */
function stopPostgres(): void {
  const cmd = process.env.PG_STOP_CMD
    ?? (process.platform === 'win32' ? 'net stop postgresql-x64-16' : 'service postgresql stop');
  execSync(cmd);
}
function startPostgres(): void {
  const cmd = process.env.PG_START_CMD
    ?? (process.platform === 'win32' ? 'net start postgresql-x64-16' : 'service postgresql start');
  try {
    execSync(cmd);
  } catch {
    // Discovered on a real Windows run: this test's own body already
    // restarts Postgres before finishing (line ~127 below), then the
    // afterEach below calls startPostgres() again unconditionally "to
    // always leave Postgres running for every other test file" — which is
    // the right end goal, but on Windows, `net start` on an
    // ALREADY-running service exits non-zero ("The requested service has
    // already been started."), unlike Debian's `service ... start`, which
    // tolerates it. This function's actual contract is "Postgres ends up
    // running", not "this specific command had to do work" — so a failed
    // start attempt here is not fatal by itself; waitForPostgresUp() right
    // after every call site is the real check, and it will correctly
    // throw if Postgres genuinely isn't up for some other reason.
  }
}

describe('Level 7 — Failure injection (real PostgreSQL, real process control)', () => {
  describe('Database unavailable', () => {
    afterEach(() => {
      // Always leave Postgres running for every other test file in the suite.
      startPostgres();
      waitForPostgresUp(15000);
    });

    it('a query against a genuinely stopped PostgreSQL server fails with a connection error, not a hang or a crash — and the application recovers cleanly once the database comes back', async () => {
      stopPostgres();
      // Confirm it is actually down before asserting anything about it.
      let stillUp = true;
      try {
        execSync('pg_isready -h 127.0.0.1 -p 5432', { stdio: 'ignore' });
      } catch {
        stillUp = false;
      }
      expect(stillUp).toBe(false);

      const pool = new Pool({
        host: process.env.PGHOST ?? '127.0.0.1',
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? 'postgres',
        password: process.env.PGPASSWORD ?? 'postgres',
        database: process.env.PGDATABASE ?? 'faculty_scheduling',
        connectionTimeoutMillis: 2000,
      });
      try {
        await expect(pool.query('SELECT 1')).rejects.toThrow();
      } finally {
        await pool.end().catch(() => {}); // pool.end() itself may also fail while the server is down
      }

      startPostgres();
      waitForPostgresUp(15000);

      // Recovery: a fresh connection after the database is back up works
      // normally again — the earlier outage left no lingering broken state.
      const recoveredPool = createPool();
      try {
        const result = await recoveredPool.query('SELECT 1 AS ok');
        expect(result.rows[0].ok).toBe(1);
      } finally {
        await recoveredPool.end();
      }
    }, 30000);
  });

  describe('Database timeout', () => {
    let pool: Pool;
    beforeAll(() => { pool = createPool(); });
    afterAll(async () => { await pool.end(); });

    it('a query that runs longer than statement_timeout is cancelled by PostgreSQL itself with SQLSTATE 57014, not left to hang indefinitely', async () => {
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 500'); // milliseconds
        await expect(client.query('SELECT pg_sleep(3)')).rejects.toMatchObject({ code: '57014' }); // query_canceled
      } finally {
        await client.query('SET statement_timeout = 0'); // reset before returning to the pool
        client.release();
      }
    }, 15000);
  });

  describe('Transaction rollback', () => {
    let pool: Pool;
    let repo: AppointmentRepository;
    beforeAll(() => {
      pool = createPool();
      repo = new AppointmentRepository(pool);
    });
    afterAll(async () => { await pool.end(); });
    beforeEach(async () => {
      await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
    });

    it('an explicit ROLLBACK after a successful write inside the transaction leaves the database completely unchanged', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, '[2026-12-15T10:00:00+05:30,2026-12-15T10:30:00+05:30)', 'Will be rolled back', null]
        );
        // Inside the transaction, the write is visible to this same connection...
        const insideTxn = await client.query('SELECT count(*)::int AS n FROM appointments');
        expect(insideTxn.rows[0].n).toBe(1);

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // ...but after rollback, it never happened as far as the database is concerned.
      const afterRollback = await pool.query('SELECT count(*)::int AS n FROM appointments');
      expect(afterRollback.rows[0].n).toBe(0);
    });

    it('a mid-transaction failure (partial failure across two writes) rolls back the entire transaction atomically — the first, individually-valid write does NOT survive', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Step 1: a genuinely valid booking.
        await client.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, '[2026-12-15T11:00:00+05:30,2026-12-15T11:30:00+05:30)', 'Valid write before the failure', null]
        );
        // Step 2: a deliberately invalid write in the SAME transaction
        // (references a faculty member that does not exist). Since
        // migration 0006, is_faculty_available() runs before the INSERT
        // and a nonexistent faculty id always has zero availability rows,
        // so this now fails with AV001 rather than ever reaching the FK
        // constraint (23503) — the availability gate short-circuits first.
        // The transaction-abort behavior under test here is unaffected:
        // any error raised inside the transaction, from RAISE EXCEPTION or
        // from a constraint violation, aborts it the same way.
        await expect(
          client.query(
            `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
            [STUDENT_A, '999999998', '[2026-12-15T12:00:00+05:30,2026-12-15T12:30:00+05:30)', 'This step fails', null]
          )
        ).rejects.toMatchObject({ code: 'AV001' });

        // PostgreSQL aborts the whole transaction on error — every
        // subsequent statement in it (even a harmless SELECT) is refused
        // until we explicitly roll back. This IS the correctness guarantee:
        // there is no way to salvage step 1 from an aborted transaction.
        await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' }); // in_failed_sql_transaction
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      const finalCount = await pool.query('SELECT count(*)::int AS n FROM appointments');
      expect(finalCount.rows[0].n).toBe(0); // step 1's otherwise-valid write did not survive
    });

    it('COMMIT (the positive control for the two tests above) does persist a valid write, proving the rollback behavior above is a real transaction boundary and not just a query never having run', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, '[2026-12-15T13:00:00+05:30,2026-12-15T13:30:00+05:30)', 'Will be committed', null]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const finalCount = await pool.query('SELECT count(*)::int AS n FROM appointments');
      expect(finalCount.rows[0].n).toBe(1);
    });
  });

  describe('Connection pool exhaustion', () => {
    it('when every connection in a small pool is busy, an additional request queues and completes once a connection frees up — it does not crash or silently drop the request', async () => {
      const smallPool = new Pool({
        host: process.env.PGHOST ?? '127.0.0.1',
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? 'postgres',
        password: process.env.PGPASSWORD ?? 'postgres',
        database: process.env.PGDATABASE ?? 'faculty_scheduling',
        max: 2, connectionTimeoutMillis: 5000,
      });
      try {
        const holder1 = smallPool.query('SELECT pg_sleep(1)');
        const holder2 = smallPool.query('SELECT pg_sleep(1)');
        // Both of the pool's 2 connections are now busy. This third query
        // has nowhere to run immediately and must queue.
        const queuedStart = Date.now();
        const queued = smallPool.query('SELECT 1 AS ok');

        const [, , queuedResult] = await Promise.all([holder1, holder2, queued]);
        const queuedElapsedMs = Date.now() - queuedStart;

        expect(queuedResult.rows[0].ok).toBe(1);
        // It genuinely had to wait for a connection to free up (~1s), not
        // run instantly on some phantom 3rd connection.
        expect(queuedElapsedMs).toBeGreaterThanOrEqual(800);
      } finally {
        await smallPool.end();
      }
    }, 15000);

    it('when the queue wait would exceed connectionTimeoutMillis, the pool fails that request with a clear timeout error instead of hanging forever', async () => {
      const tinyPool = new Pool({
        host: process.env.PGHOST ?? '127.0.0.1',
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? 'postgres',
        password: process.env.PGPASSWORD ?? 'postgres',
        database: process.env.PGDATABASE ?? 'faculty_scheduling',
        max: 1, connectionTimeoutMillis: 300,
      });
      try {
        const holder = tinyPool.query('SELECT pg_sleep(2)');
        // Only one connection exists and it's busy for 2s, but this
        // request gives up waiting after 300ms.
        await expect(tinyPool.query('SELECT 1')).rejects.toThrow(/timeout/i);
        await holder; // let the holder finish so pool.end() below doesn't race it
      } finally {
        await tinyPool.end();
      }
    }, 15000);
  });
});
