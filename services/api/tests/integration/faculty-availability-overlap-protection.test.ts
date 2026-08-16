import { Pool } from 'pg';
import { createPool } from '../../src/db/client';

/**
 * Post-Level-7 development, Phase 1 Task 2: dedicated coverage for
 * migration 0007 (the faculty_availability_no_overlap GiST exclusion
 * constraint).
 *
 * This closes documented Gap 2: faculty_availability previously had no
 * database-level protection against two ACTIVE windows for the same
 * faculty member, on the same day of week, with overlapping effective-date
 * ranges, genuinely overlapping in time. See migration 0007's header
 * comment for the full mechanism (a custom TIME range type + DATERANGE,
 * the same EXCLUDE USING gist technique already used for appointments.slot
 * in migration 0002, applied to a second table).
 *
 * There is deliberately no repository/service layer under test here —
 * faculty-managed availability editing does not exist yet at the
 * application layer (documented Gap 4, later work once the HTTP/auth layer
 * exists). This file exercises the constraint directly against real
 * PostgreSQL, the same way advanced-sql-features.test.ts already does for
 * the appointments exclusion constraint.
 */

const FACULTY = '200'; // Prof. Rao — has 5 permanent Mon-Fri rows (day_of_week 1-5), 09:00-17:00, effective_from 2026-01-01
const OTHER_FACULTY = '201';
const UNUSED_DAY = 6; // Saturday — nothing seeded here, safe to use and clean up freely

async function cleanupUnusedDay(pool: Pool) {
  await pool.query(
    `DELETE FROM faculty_availability WHERE faculty_id IN ($1,$2) AND day_of_week = $3`,
    [FACULTY, OTHER_FACULTY, UNUSED_DAY]
  );
}

describe('faculty_availability overlap protection (real PostgreSQL, migration 0007)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await cleanupUnusedDay(pool);
    await pool.end();
  });

  beforeEach(async () => {
    // faculty_availability is NOT covered by the appointments/audit_log/
    // notifications TRUNCATE used elsewhere — clean only what this file's
    // own tests touch (day_of_week=6), never the permanent seed rows.
    await cleanupUnusedDay(pool);
  });

  it('rejects an exact duplicate window for the same faculty/day', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
      [FACULTY, UNUSED_DAY]
    );
    await expect(
      pool.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
        [FACULTY, UNUSED_DAY]
      )
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it.each([
    ['one window fully contains the other', '09:00', '17:00', '10:00', '11:00'],
    ['partial overlap, second starts inside the first', '09:00', '12:00', '11:00', '14:00'],
    ['partial overlap, second ends inside the first', '11:00', '14:00', '09:00', '12:00'],
    ['one window fully contained by the other', '10:00', '11:00', '09:00', '17:00'],
  ])('rejects an overlapping window: %s', async (_label, aStart, aEnd, bStart, bEnd) => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,$3,$4,'2026-01-01')`,
      [FACULTY, UNUSED_DAY, aStart, aEnd]
    );
    await expect(
      pool.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,$3,$4,'2026-01-01')`,
        [FACULTY, UNUSED_DAY, bStart, bEnd]
      )
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('allows two ADJACENT (touching, not overlapping) windows for the same faculty/day', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
      [FACULTY, UNUSED_DAY]
    );
    // [)-semantics: 12:00 is excluded from the first window and included as
    // the start of the second — genuinely no shared instant, so this must
    // succeed. (This is also exactly why book_appointment() itself allows
    // back-to-back slots — the same half-open convention throughout.)
    const result = await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'12:00','14:00','2026-01-01') RETURNING id`,
      [FACULTY, UNUSED_DAY]
    );
    expect(result.rows).toHaveLength(1);
  });

  it('allows the same overlapping time window for a DIFFERENT faculty member — the constraint is scoped per faculty_id', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
      [FACULTY, UNUSED_DAY]
    );
    const result = await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01') RETURNING id`,
      [OTHER_FACULTY, UNUSED_DAY]
    );
    expect(result.rows).toHaveLength(1);
  });

  it('allows the same overlapping time window on a DIFFERENT day of week — the constraint is scoped per day_of_week', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
      [FACULTY, UNUSED_DAY]
    );
    // A different unused day (Sunday, 0) — cleaned up explicitly here since
    // this test uses a second day beyond the shared UNUSED_DAY constant.
    try {
      const result = await pool.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,0,'09:00','12:00','2026-01-01') RETURNING id`,
        [FACULTY]
      );
      expect(result.rows).toHaveLength(1);
    } finally {
      await pool.query(`DELETE FROM faculty_availability WHERE faculty_id = $1 AND day_of_week = 0`, [FACULTY]);
    }
  });

  it('allows the same time window when the effective-date ranges genuinely do not overlap (bounded on both sides)', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until) VALUES ($1,$2,'09:00','12:00','2026-01-01','2026-06-01')`,
      [FACULTY, UNUSED_DAY]
    );
    const result = await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until) VALUES ($1,$2,'09:00','12:00','2026-06-02','2026-12-01') RETURNING id`,
      [FACULTY, UNUSED_DAY]
    );
    expect(result.rows).toHaveLength(1);
  });

  it('a NULL effective_until (this schema\'s "ongoing indefinitely" convention) is treated as unbounded — it conflicts with a later window at the same time, not just an immediately-adjacent one', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until) VALUES ($1,$2,'09:00','12:00','2026-01-01',NULL)`,
      [FACULTY, UNUSED_DAY]
    );
    await expect(
      pool.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until) VALUES ($1,$2,'09:00','12:00','2030-01-01','2030-06-01') RETURNING id`,
        [FACULTY, UNUSED_DAY]
      )
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('an overlapping window is allowed once the original row is deactivated (is_active = false) — mirrors how a CANCELLED appointment frees its slot', async () => {
    const original = await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01') RETURNING id`,
      [FACULTY, UNUSED_DAY]
    );
    await pool.query(`UPDATE faculty_availability SET is_active = FALSE WHERE id = $1`, [original.rows[0].id]);

    const result = await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'10:00','13:00','2026-01-01') RETURNING id`,
      [FACULTY, UNUSED_DAY]
    );
    expect(result.rows).toHaveLength(1);
  });

  it('under real concurrency, two independent connections racing to insert overlapping windows: exactly one succeeds, the other is rejected safely', async () => {
    const poolA = createPool();
    const poolB = createPool();
    try {
      const attemptA = poolA.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
        [FACULTY, UNUSED_DAY]
      );
      const attemptB = poolB.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'11:00','14:00','2026-01-01')`,
        [FACULTY, UNUSED_DAY]
      );

      const results = await Promise.allSettled([attemptA, attemptB]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: '23P01' });

      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM faculty_availability WHERE faculty_id = $1 AND day_of_week = $2 AND is_active`,
        [FACULTY, UNUSED_DAY]
      );
      expect(rows.rows[0].n).toBe(1); // never zero, never both
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });

  it('is_faculty_available() and get_available_slots() remain consistent — with the constraint in place, no faculty/day can ever have two contradictory active windows to reconcile', async () => {
    await pool.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,$2,'09:00','12:00','2026-01-01')`,
      [FACULTY, UNUSED_DAY]
    );
    // 2026-08-15 is a Saturday (day_of_week=6) in this project's timeline — matches UNUSED_DAY.
    const available = await pool.query('SELECT is_faculty_available($1, $2::tstzrange) AS ok', [
      FACULTY,
      '[2026-08-15T10:00:00+05:30,2026-08-15T10:30:00+05:30)',
    ]);
    expect(available.rows[0].ok).toBe(true);

    const slots = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-15']);
    // Every slot returned appears exactly once — no duplicates from a
    // contradictory second row (the exact failure mode migration 0007 closes).
    const starts = slots.rows.map((r) => new Date(r.slot_start).toISOString());
    expect(new Set(starts).size).toBe(starts.length);
  });
});
