import { Pool } from 'pg';
import { createPool } from '../../src/db/client';

/**
 * Level 7 — Section 12: Advanced SQL feature tests.
 *
 * Every object under test here is a real, migrated PostgreSQL object (see
 * migrations/sql/0002-0005) — this file executes SQL directly against them,
 * the same way Section 12 asks: "directly test stored functions, triggers,
 * views, materialized view, CTE query, window-function queries,
 * constraints, indexes via EXPLAIN ANALYZE, isolation/locking behavior."
 * This is deliberately independent of the repository/service layer (those
 * are exercised everywhere else in Level 7) — the point of this file is to
 * prove the DATABASE objects themselves are correct, not just correct when
 * called through the one application code path that happens to use them.
 */

const FACULTY = '200';       // Prof. Rao — has availability, teaching block, leave day seeded
const STUDENT_A = '100';
const STUDENT_B = '101';

describe('Level 7 — Advanced SQL feature tests (real PostgreSQL objects)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  // ────────────────────────────── STORED FUNCTIONS ──────────────────────────────

  describe('Stored functions', () => {
    it('book_appointment() remaps the raw exclusion_violation into a documented SLOT_CONFLICT error, still carrying SQLSTATE 23P01', async () => {
      await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-22T10:00:00+05:30,2026-12-22T10:30:00+05:30)', 'First booking', null] // Tuesday, available
      );
      await expect(
        pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_B, FACULTY, '[2026-12-22T10:15:00+05:30,2026-12-22T10:45:00+05:30)', 'Conflicting booking', null]
        )
      ).rejects.toMatchObject({ code: '23P01', message: expect.stringContaining('SLOT_CONFLICT') });
    });

    it('book_appointment() is atomic: a failed call leaves no partial row behind (single-statement function, no half-written appointment)', async () => {
      // Post-migration-0006 note: a nonexistent faculty id has zero
      // faculty_availability rows, so is_faculty_available() now reports
      // FALSE and book_appointment() raises AV001 BEFORE the INSERT is ever
      // attempted — the FK constraint (23503) is never reached via this
      // path anymore, since the availability gate runs first. The
      // atomicity property under test (no partial row survives a failed
      // call) still holds regardless of which check fails first; only the
      // specific error code changes. The FK constraint itself is still
      // exercised directly elsewhere (see the raw-INSERT "nonexistent
      // faculty" test in negative-boundary-and-integrity.test.ts, which
      // deliberately bypasses book_appointment() to isolate that check).
      await expect(
        pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, '999999998', '[2026-12-22T11:00:00+05:30,2026-12-22T11:30:00+05:30)', 'References a nonexistent faculty', null]
        )
      ).rejects.toMatchObject({ code: 'AV001' });
      const count = await pool.query('SELECT count(*)::int AS n FROM appointments');
      expect(count.rows[0].n).toBe(0);
    });

    it('get_available_slots() correctly reconciles FOUR independent sources (availability window, teaching schedule, leave exception, existing appointments) into one answer, in a single call', async () => {
      // Prof. Rao (200), Monday 2026-08-24: available 09:00-17:00, but
      // teaches CSE301 10:00-11:00 (seeded) — that hour must be absent.
      const before = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-24']);
      // Date.prototype.toISOString() always renders in UTC ('Z'), regardless
      // of the database session timezone (migration 0008 pins the DB
      // session to Asia/Kolkata, but that only affects how PostgreSQL
      // itself interprets/displays TIME<->TIMESTAMPTZ — it has no effect on
      // this JS-side formatting). So these expected values are the UTC
      // instants equivalent to the intended IST wall-clock times
      // (IST = UTC+5:30): 09:00 IST = 03:30 UTC, 10:00 IST = 04:30 UTC,
      // 10:30 IST = 05:00 UTC.
      const slotStarts: string[] = before.rows.map((r) => new Date(r.slot_start).toISOString());
      expect(slotStarts).toContain('2026-08-24T03:30:00.000Z'); // 09:00 IST — inside the availability window, not blocked
      expect(slotStarts).not.toContain('2026-08-24T04:30:00.000Z'); // 10:00 IST — blocked by the teaching schedule
      expect(slotStarts).not.toContain('2026-08-24T05:00:00.000Z'); // 10:30 IST — still inside the teaching hour

      // Now book one of the genuinely free slots, and confirm the SAME
      // function immediately reflects it as gone — the fourth source
      // (existing appointments) reconciled live, not from a stale cache.
      await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-08-24T09:00:00+05:30,2026-08-24T09:30:00+05:30)', 'Consumes the 09:00 slot', null]
      );
      const after = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-24']);
      const afterStarts: string[] = after.rows.map((r) => new Date(r.slot_start).toISOString());
      expect(afterStarts).not.toContain('2026-08-24T03:30:00.000Z'); // 09:00 IST, in UTC — see note above

      // And on the declared leave day, every slot is blocked (source #3).
      const leaveDay = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-31']);
      expect(leaveDay.rows).toEqual([]);
    });
  });

  // ────────────────────────────── TRIGGERS ──────────────────────────────

  describe('Triggers', () => {
    it('trg_enforce_transition blocks an invalid status transition even via a raw UPDATE that bypasses the application entirely, with SQLSTATE 22023 and a clear message', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-22T10:00:00+05:30,2026-12-22T10:30:00+05:30)', 'Trigger transition test', null] // Tuesday, available
      );
      const id = rows[0].id;
      // PENDING -> COMPLETED is not in the allowed map at all (only
      // PENDING -> APPROVED/REJECTED/CANCELLED/EXPIRED are), so the
      // trigger — not the Service layer, which was never involved here —
      // must be the thing that rejects this raw UPDATE.
      await expect(
        pool.query(`UPDATE appointments SET status = 'COMPLETED' WHERE id = $1`, [id])
      ).rejects.toMatchObject({ code: '22023', message: expect.stringContaining('INVALID_TRANSITION') });

      const stillPending = await pool.query(`SELECT status FROM appointments WHERE id = $1`, [id]);
      expect(stillPending.rows[0].status).toBe('PENDING'); // the rejected write had zero effect
    });

    it('a second invalid transition (REJECTED -> APPROVED, a terminal state with no outgoing transitions at all) is likewise rejected outright by the trigger', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-21T11:00:00+05:30,2026-12-21T11:30:00+05:30)', 'Trigger transition test 2', null]
      );
      const id = rows[0].id;
      await pool.query(`UPDATE appointments SET status = 'REJECTED' WHERE id = $1`, [id]); // valid: PENDING -> REJECTED
      await expect(
        pool.query(`UPDATE appointments SET status = 'APPROVED' WHERE id = $1`, [id]) // invalid: REJECTED -> APPROVED, REJECTED has no outgoing transitions
      ).rejects.toMatchObject({ code: '22023', message: expect.stringContaining('INVALID_TRANSITION') });
    });

    it('trg_enforce_transition allows a no-op update (same status, e.g. touching completion_notes) and still refreshes updated_at', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-21T12:00:00+05:30,2026-12-21T12:30:00+05:30)', 'No-op transition test', null]
      );
      const id = rows[0].id;
      const before = rows[0].updated_at;
      await new Promise((r) => setTimeout(r, 20));
      const { rows: updated } = await pool.query(
        `UPDATE appointments SET status = 'PENDING' WHERE id = $1 RETURNING updated_at`,
        [id]
      );
      expect(new Date(updated[0].updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());
    });

    it('trg_audit_appointment writes an audit_log row automatically on every INSERT and UPDATE, even via raw SQL that never went through the application\'s repository at all', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-21T13:00:00+05:30,2026-12-21T13:30:00+05:30)', 'Audit trigger test', null]
      );
      const id = rows[0].id;

      const afterInsert = await pool.query(
        `SELECT * FROM audit_log WHERE entity_type = 'appointment' AND entity_id = $1 ORDER BY created_at`,
        [id]
      );
      expect(afterInsert.rows).toHaveLength(1);
      expect(afterInsert.rows[0].action).toBe('INSERT');
      expect(afterInsert.rows[0].old_data).toBeNull();
      expect(afterInsert.rows[0].new_data.status).toBe('PENDING');

      await pool.query(`UPDATE appointments SET status = 'REJECTED' WHERE id = $1`, [id]);
      const afterUpdate = await pool.query(
        `SELECT * FROM audit_log WHERE entity_type = 'appointment' AND entity_id = $1 ORDER BY created_at`,
        [id]
      );
      expect(afterUpdate.rows).toHaveLength(2);
      expect(afterUpdate.rows[1].action).toBe('UPDATE');
      expect(afterUpdate.rows[1].old_data.status).toBe('PENDING');
      expect(afterUpdate.rows[1].new_data.status).toBe('REJECTED');
    });
  });

  // ────────────────────────────── VIEWS ──────────────────────────────

  describe('Views', () => {
    it('faculty_pending_requests exposes only PENDING appointments, ordered by requested_at, joined with the requesting student\'s name', async () => {
      const a = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-22T10:00:00+05:30,2026-12-22T10:30:00+05:30)', 'First pending request', null]
      );
      const b = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_B, FACULTY, '[2026-12-22T11:00:00+05:30,2026-12-22T11:30:00+05:30)', 'Second pending request', null]
      );
      await pool.query(`UPDATE appointments SET status = 'REJECTED' WHERE id = $1`, [b.rows[0].id]);

      const view = await pool.query('SELECT * FROM faculty_pending_requests WHERE faculty_id = $1', [FACULTY]);
      expect(view.rows).toHaveLength(1); // the rejected one is correctly excluded
      expect(view.rows[0].id).toBe(a.rows[0].id);
      expect(view.rows[0].student_name).toBeTruthy();
    });

    it('student_upcoming_appointments only includes PENDING/APPROVED appointments whose slot has not already started', async () => {
      // 2026-02-03 (Tuesday) is inside Prof. Rao's seeded availability
      // window (effective_from '2026-01-01') and safely in the past
      // relative to "now" for this test run — a date outside the seeded
      // window (e.g. the original 2020-01-01) would now correctly be
      // rejected as FacultyUnavailableError by migration 0006, which is
      // not what this test is about.
      const past = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-02-03T10:00:00+05:30,2026-02-03T10:30:00+05:30)', 'Long-past appointment', null]
      );
      const future = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2027-01-01T10:00:00+05:30,2027-01-01T10:30:00+05:30)', 'Far-future appointment', null]
      );

      const view = await pool.query('SELECT id FROM student_upcoming_appointments WHERE student_id = $1', [STUDENT_A]);
      const ids = view.rows.map((r) => r.id);
      expect(ids).not.toContain(past.rows[0].id); // already started/passed — correctly excluded
      expect(ids).toContain(future.rows[0].id);
    });

    it('faculty_current_status derives IN_APPOINTMENT for a faculty member with an APPROVED appointment covering the current instant', async () => {
      // Build a slot that genuinely spans "right now", using the
      // database's own clock (not the test runner's), so this is robust
      // regardless of clock skew between the test host and Postgres.
      const nowRow = await pool.query('SELECT now() AS now');
      const now: Date = nowRow.rows[0].now;
      const start = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

      // "Right now" is real wall-clock time, whatever day/hour that happens
      // to be when this suite runs (including outside Prof. Rao's seeded
      // Mon-Fri 09:00-17:00 window, e.g. a weekend CI run). Since migration
      // 0006, book_appointment() correctly enforces availability, so this
      // test needs its own test-scoped, wide-open window covering today's
      // actual date only — cleaned up immediately after — rather than
      // relying on the seeded Mon-Fri fixture, which this test was never
      // really about in the first place (it's testing faculty_current_status,
      // not the availability gate).
      const startDate = new Date(start);
      const todayStr = start.slice(0, 10);
      const dow = startDate.getUTCDay(); // matches EXTRACT(DOW FROM ...) used by is_faculty_available()

      // Since migration 0007, faculty_availability itself now has a GiST
      // exclusion constraint blocking two overlapping ACTIVE windows for
      // the same faculty/day — so unconditionally inserting a wide-open
      // window here would itself fail whenever "today" happens to be one
      // of Prof. Rao's seeded Mon-Fri days (it would overlap the permanent
      // 09:00-17:00 row). Only insert the test-scoped window if the slot
      // isn't already genuinely available; only clean up what we inserted.
      const alreadyAvailable = (
        await pool.query('SELECT is_faculty_available($1, $2::tstzrange) AS ok', [FACULTY, `[${start},${end})`])
      ).rows[0].ok as boolean;
      if (!alreadyAvailable) {
        await pool.query(
          `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until)
           VALUES ($1, $2, '00:00', '23:59', $3, $3)`,
          [FACULTY, dow, todayStr]
        );
      }
      try {
        const { rows } = await pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, `[${start},${end})`, 'Covers right now', null]
        );
        await pool.query(`UPDATE appointments SET status = 'APPROVED' WHERE id = $1`, [rows[0].id]);

        const status = await pool.query('SELECT current_status FROM faculty_current_status WHERE faculty_id = $1', [FACULTY]);
        expect(status.rows[0].current_status).toBe('IN_APPOINTMENT');
      } finally {
        if (!alreadyAvailable) {
          await pool.query(
            `DELETE FROM faculty_availability WHERE faculty_id = $1 AND effective_from = $2 AND day_of_week = $3`,
            [FACULTY, todayStr, dow]
          );
        }
      }
    });
  });

  // ────────────────────────────── MATERIALIZED VIEW ──────────────────────────────

  describe('Materialized view (faculty_appointment_stats)', () => {
    it('does NOT reflect a new appointment until explicitly REFRESHed — proving it is genuinely materialized (a snapshot), not a live view', async () => {
      // Establish a KNOWN baseline first. A materialized view is global,
      // cross-connection state that TRUNCATE on the source table does not
      // reset — if an earlier, unrelated test (or file) left it stale with
      // a different row count, reading it without refreshing first would
      // silently inherit that leftover state. This was caught empirically:
      // running this file back-to-back with the performance suite (which
      // seeds 50,000 rows and never refreshes back down) made `beforeCount`
      // pick up a stale 50,000+ figure instead of reflecting the table this
      // test actually just truncated to empty. Refreshing here first is
      // what makes this test self-contained regardless of run order.
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats');
      const before = await pool.query(
        'SELECT total_requests FROM faculty_appointment_stats WHERE faculty_id = $1', [FACULTY]
      );
      const beforeCount = before.rows[0]?.total_requests ?? 0;

      await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-23T10:00:00+05:30,2026-12-23T10:30:00+05:30)', 'Not yet reflected in the mat view', null]
      );

      const stillStale = await pool.query(
        'SELECT total_requests FROM faculty_appointment_stats WHERE faculty_id = $1', [FACULTY]
      );
      expect(Number(stillStale.rows[0]?.total_requests ?? 0)).toBe(Number(beforeCount)); // staleness proven

      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats');

      const refreshed = await pool.query(
        'SELECT total_requests FROM faculty_appointment_stats WHERE faculty_id = $1', [FACULTY]
      );
      expect(Number(refreshed.rows[0].total_requests)).toBe(Number(beforeCount) + 1);
    });

    it('correctly reports zero requests (not one) for a faculty member with no appointments at all — the LEFT JOIN COUNT(a.id) fix found during Level 7 testing', async () => {
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats');
      const stats = await pool.query(
        'SELECT total_requests FROM faculty_appointment_stats WHERE faculty_id = $1', ['201'] // Prof. Iyer, zero appointments
      );
      expect(Number(stats.rows[0].total_requests)).toBe(0);
    });
  });

  // ────────────────────────────── WINDOW FUNCTIONS ──────────────────────────────

  describe('Window functions (Level 5 reporting queries)', () => {
    it('RANK() OVER + running SUM() OVER correctly rank faculty workload and compute a running per-faculty total, without collapsing row detail', async () => {
      // Two faculty members, several completed appointments across two
      // distinct weeks, so both RANK (cross-faculty) and the running SUM
      // (per-faculty, ordered by week) have something real to compute.
      // Prof. Iyer (201) has zero declared faculty_availability rows in the
      // base fixture (used elsewhere as "the faculty with no availability"
      // boundary case). Since migration 0006 gates book_appointment() on
      // real availability, give it a test-scoped window for the one date
      // this test needs, cleaned up in the finally block below.
      await pool.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until)
         VALUES ($1, 1, '09:00', '17:00', '2026-11-02', '2026-11-02')`, // 2026-11-02 is a Monday (day_of_week=1), scoped to this one date only
        ['201']
      );
      try {
      const bookings = [
        [STUDENT_A, FACULTY, '2026-11-02T09:00:00+05:30', '2026-11-02T09:30:00+05:30'], // week of Nov 2 (Mon), before the 10:00 teaching block
        [STUDENT_B, FACULTY, '2026-11-02T11:00:00+05:30', '2026-11-02T11:30:00+05:30'], // same week, after the teaching block ends
        [STUDENT_A, FACULTY, '2026-11-09T09:00:00+05:30', '2026-11-09T09:30:00+05:30'], // week of Nov 9, before the teaching block
        [STUDENT_A, '201', '2026-11-02T10:00:00+05:30', '2026-11-02T10:30:00+05:30'],
      ] as const;
      for (const [student, faculty, start, end] of bookings) {
        const { rows } = await pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [student, faculty, `[${start},${end})`, 'Window function seed data', null]
        );
        // COMPLETED is only reachable via APPROVED (PENDING -> COMPLETED
        // directly is not a valid transition — the trigger rejects it).
        await pool.query(`UPDATE appointments SET status = 'APPROVED' WHERE id = $1`, [rows[0].id]);
        await pool.query(`UPDATE appointments SET status = 'COMPLETED' WHERE id = $1`, [rows[0].id]);
      }

      const result = await pool.query(`
        SELECT
            faculty_id, full_name, week_start, appointments_that_week,
            RANK() OVER (ORDER BY appointments_that_week DESC) AS workload_rank,
            SUM(appointments_that_week) OVER (
                PARTITION BY faculty_id ORDER BY week_start
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS running_total_this_semester
        FROM (
            SELECT f.id AS faculty_id, u.full_name,
                   date_trunc('week', lower(a.slot)) AS week_start,
                   COUNT(*) AS appointments_that_week
            FROM appointments a
            JOIN faculty f ON f.id = a.faculty_id
            JOIN users u ON u.id = f.id
            WHERE a.status IN ('COMPLETED','APPROVED')
            GROUP BY f.id, u.full_name, date_trunc('week', lower(a.slot))
        ) weekly
        ORDER BY faculty_id, week_start
      `);

      const facultyRao = result.rows.filter((r) => r.faculty_id === FACULTY);
      expect(facultyRao).toHaveLength(2); // two distinct weeks
      expect(Number(facultyRao[0].appointments_that_week)).toBe(2); // Nov 2 week: 2 appointments
      expect(Number(facultyRao[0].running_total_this_semester)).toBe(2);
      expect(Number(facultyRao[1].appointments_that_week)).toBe(1); // Nov 9 week: 1 more
      expect(Number(facultyRao[1].running_total_this_semester)).toBe(3); // running total accumulates: 2 + 1

      // Prof. Rao (3 total) outranks Prof. Iyer (1 total) — RANK() reflects
      // it, and crucially every row is STILL individually visible (window
      // functions, unlike GROUP BY, never collapse the per-row detail).
      const raoWeek1 = facultyRao.find((r) => Number(r.appointments_that_week) === 2)!;
      const iyerRow = result.rows.find((r) => r.faculty_id === '201')!;
      expect(Number(raoWeek1.workload_rank)).toBeLessThan(Number(iyerRow.workload_rank));
      } finally {
        await pool.query(`DELETE FROM faculty_availability WHERE faculty_id = $1 AND effective_from = '2026-11-02'`, ['201']);
      }
    });

    it('ROW_NUMBER() OVER (PARTITION BY student) correctly numbers each student\'s Nth appointment while preserving full row detail', async () => {
      const slots: [string, string][] = [
        ['2026-11-16T09:00:00+05:30', '2026-11-16T09:30:00+05:30'], // Monday, before the 10:00 teaching block
        ['2026-11-16T09:30:00+05:30', '2026-11-16T10:00:00+05:30'], // still before the block
        ['2026-11-16T11:00:00+05:30', '2026-11-16T11:30:00+05:30'], // after the block ends
      ];
      for (const [start, end] of slots) {
        await pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, `[${start},${end})`, 'Nth appointment seed', null]
        );
      }

      const result = await pool.query(`
        SELECT a.id, a.student_id, a.slot,
               ROW_NUMBER() OVER (PARTITION BY a.student_id ORDER BY a.requested_at) AS nth_request_this_semester
        FROM appointments a
        WHERE a.student_id = $1
        ORDER BY nth_request_this_semester
      `, [STUDENT_A]);

      expect(result.rows).toHaveLength(3);
      expect(result.rows.map((r) => Number(r.nth_request_this_semester))).toEqual([1, 2, 3]);
      // Full row detail (id, slot) is preserved per row — nothing collapsed.
      expect(new Set(result.rows.map((r) => r.id)).size).toBe(3);
    });
  });

  // ────────────────────────────── CONSTRAINTS (direct, bypassing the app) ──────────────────────────────

  describe('Constraints enforced directly at the database, independent of any application code', () => {
    it('the GiST exclusion constraint blocks an overlapping raw INSERT, not just a book_appointment() call', async () => {
      await pool.query(
        `INSERT INTO appointments (student_id, faculty_id, slot, reason) VALUES ($1,$2,$3::tstzrange,$4)`,
        [STUDENT_A, FACULTY, '[2026-12-24T10:00:00+05:30,2026-12-24T10:30:00+05:30)', 'Raw insert, first']
      );
      await expect(
        pool.query(
          `INSERT INTO appointments (student_id, faculty_id, slot, reason) VALUES ($1,$2,$3::tstzrange,$4)`,
          [STUDENT_B, FACULTY, '[2026-12-24T10:15:00+05:30,2026-12-24T10:45:00+05:30)', 'Raw insert, overlapping']
        )
      ).rejects.toMatchObject({ code: '23P01' });
    });

    it('the exclusion constraint only applies to ACTIVE (PENDING/APPROVED) rows — a CANCELLED appointment does not block a new overlapping booking for the same slot', async () => {
      const first = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-25T10:00:00+05:30,2026-12-25T10:30:00+05:30)', 'Will be cancelled', null]
      );
      await pool.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [first.rows[0].id]);

      await expect(
        pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_B, FACULTY, '[2026-12-25T10:00:00+05:30,2026-12-25T10:30:00+05:30)', 'Re-books the freed slot', null]
        )
      ).resolves.toBeTruthy();
    });
  });

  // ────────────────────────────── INDEXES via EXPLAIN ANALYZE ──────────────────────────────

  describe('Indexes, verified via EXPLAIN ANALYZE against a realistic data volume', () => {
    beforeEach(async () => {
      // A tiny table never needs an index — the planner correctly prefers
      // a sequential scan below some size, regardless of what indexes
      // exist. To honestly test that an index is USED, there must be
      // enough data that using it is actually the better plan. This seeds
      // several thousand terminal-status rows (bypassing the exclusion
      // constraint, which does not apply to terminal statuses) purely to
      // give the planner a real, non-trivial choice to make.
      //
      // student_id and faculty_id are deliberately DECORRELATED across the
      // 4 real (student, faculty) pairs seeded by seed_test_data.sql —
      // (100,200), (100,201), (101,200), (101,201) — 1/4 of the 5000 rows
      // each. An earlier version of this seed fixed student_id=100 and
      // faculty_id=200 for every row, which made
      // appointments_student_status_idx (student_id, status) and
      // appointments_faculty_status_idx (faculty_id, status) statistically
      // IDENTICAL for this data (every row matched both single-column
      // predicates at once), so the planner had no real cost basis to
      // prefer one over the other — the "wrong" index it then picked was a
      // reasonable, equally-costed choice, not a bug, and which one it
      // picked was an implementation-detail tie-break that differed
      // between PostgreSQL versions (observed: consistently one index on
      // PostgreSQL 16, consistently the other on PostgreSQL 18). Varying
      // student_id and faculty_id independently makes each index genuinely
      // more selective for its own matching query, so the assertions below
      // test an actual selectivity difference rather than an arbitrary
      // tie-break.
      await pool.query(`
        INSERT INTO appointments (student_id, faculty_id, slot, status, reason, requested_at)
        SELECT
            CASE WHEN n % 4 IN (0, 1) THEN 100 ELSE 101 END,
            CASE WHEN n % 4 IN (0, 2) THEN 200 ELSE 201 END,
            tstzrange('2015-01-01'::timestamptz + (n || ' minutes')::interval,
                      '2015-01-01'::timestamptz + ((n + 15) || ' minutes')::interval),
            (ARRAY['COMPLETED','REJECTED','CANCELLED','MISSED'])[1 + (n % 4)]::appointment_status,
            'Bulk seed row ' || n,
            now() - (n || ' minutes')::interval
        FROM generate_series(1, 5000) AS n
      `);
      await pool.query('ANALYZE appointments');
    });

    it('a faculty-scoped status query uses appointments_faculty_status_idx, not a sequential scan, once the table has real volume', async () => {
      const plan = await pool.query(
        `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM appointments WHERE faculty_id = $1 AND status = 'REJECTED'`,
        [FACULTY]
      );
      const planText = JSON.stringify(plan.rows[0]['QUERY PLAN']);
      expect(planText).toContain('appointments_faculty_status_idx');
      expect(planText).not.toContain('Seq Scan');
    });

    it('an overlap ("&&") query against the slot column uses the GiST exclusion index, the same index enforcing the double-booking guarantee', async () => {
      const plan = await pool.query(
        `EXPLAIN (ANALYZE, FORMAT JSON)
         SELECT * FROM appointments
         WHERE faculty_id = $1 AND slot && $2::tstzrange AND status IN ('PENDING','APPROVED')`,
        [FACULTY, '[2015-01-01T00:10:00+05:30,2015-01-01T00:20:00+05:30)']
      );
      const planText = JSON.stringify(plan.rows[0]['QUERY PLAN']);
      expect(planText).toContain('appointments_faculty_id_slot_excl');
    });

    it('a student-scoped status query uses appointments_student_status_idx', async () => {
      const plan = await pool.query(
        `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM appointments WHERE student_id = $1 AND status = 'COMPLETED'`,
        [STUDENT_A]
      );
      const planText = JSON.stringify(plan.rows[0]['QUERY PLAN']);
      expect(planText).toContain('appointments_student_status_idx');
      expect(planText).not.toContain('Seq Scan');
    });
  });

  // ────────────────────────────── ISOLATION / LOCKING ──────────────────────────────

  describe('Transaction isolation behavior', () => {
    it('under the default READ COMMITTED isolation, a transaction sees a committed change made by another transaction mid-way through its own execution (non-repeatable read is possible) — demonstrating why the guarded UPDATE pattern, not a plain re-read, is what the app actually relies on for correctness', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
        [STUDENT_A, FACULTY, '[2026-12-22T13:00:00+05:30,2026-12-22T13:30:00+05:30)', 'Isolation demo', null] // Tuesday, available
      );
      const id = rows[0].id;

      const txnClient = await pool.connect();
      const otherClient = await pool.connect();
      try {
        await txnClient.query('BEGIN');
        const firstRead = await txnClient.query('SELECT status FROM appointments WHERE id = $1', [id]);
        expect(firstRead.rows[0].status).toBe('PENDING');

        // A completely different, already-committed transaction changes
        // the row in between.
        await otherClient.query(`UPDATE appointments SET status = 'REJECTED' WHERE id = $1`, [id]);

        // Read it again inside the SAME still-open transaction: under
        // READ COMMITTED (Postgres's default, confirmed by SHOW below),
        // this sees the new committed value — a non-repeatable read. This
        // is precisely why the application never trusts a plain re-read
        // for a decision; every write goes through the guarded UPDATE's
        // own WHERE clause, evaluated fresh at write time.
        const secondRead = await txnClient.query('SELECT status FROM appointments WHERE id = $1', [id]);
        expect(secondRead.rows[0].status).toBe('REJECTED');

        await txnClient.query('COMMIT');
      } finally {
        txnClient.release();
        otherClient.release();
      }

      const isolationLevel = await pool.query('SHOW default_transaction_isolation');
      expect(isolationLevel.rows[0].default_transaction_isolation).toBe('read committed');
    });
  });
});
