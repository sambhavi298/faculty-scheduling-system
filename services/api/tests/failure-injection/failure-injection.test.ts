import { execSync } from 'child_process';
import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';
import { stopPostgres, startPostgres, waitForPostgresUp } from './postgres-process-control';

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
 * project by itself, using the npm script (NOT the raw `npx jest ...`
 * command — the script is what carries `--coverage=false`; without it,
 * this project's 0% coverage of the app-layer files `npm test` tracks
 * trips the same coverage-threshold failure `test:performance` used to
 * have, for the same reason — see `package.json`):
 *
 *   npm run test:failure-injection
 *
 * `stopPostgres()`/`startPostgres()`/`waitForPostgresUp()` — the actual
 * cross-platform process control, including Windows service-name
 * auto-detection — live in `./postgres-process-control.ts`, with their own
 * unit tests in `./postgres-process-control.test.ts` (pure logic, mocked
 * `execSync`, no real Postgres/Windows service required to run them).
 */

const STUDENT_A = '100';
const FACULTY = '200';

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
