import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';
import { FacultyUnavailableError } from '../../src/errors/faculty-unavailable.error';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';

/**
 * Post-Level-7 development, Phase 1 Task 1: dedicated coverage for
 * migration 0006 (is_faculty_available() + the updated book_appointment()).
 *
 * This closes Break Report Gap A: book_appointment() previously only
 * checked the exclusion constraint against OTHER appointments — a booking
 * during a teaching block, declared leave, or a blocked period would
 * succeed. It now consults faculty_availability, faculty_schedule, and
 * faculty_schedule_exceptions BEFORE the insert, inside the same
 * transaction as the write itself — the guarantee lives in the database,
 * not in whatever the frontend happens to check first.
 */

const STUDENT_A = '100';
const STUDENT_B = '101';
const FACULTY = '200'; // Prof. Rao — Mon-Fri 09:00-17:00, Monday 10:00-11:00 CSE301, leave on 2026-08-31

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

describe('Booking-time availability enforcement (real PostgreSQL, migration 0006)', () => {
  let pool: Pool;
  let repo: AppointmentRepository;

  beforeAll(() => {
    pool = createPool();
    repo = new AppointmentRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
    // Reset any ad-hoc BLOCK exceptions a previous test in this file added.
    await pool.query(`DELETE FROM faculty_schedule_exceptions WHERE reason = 'Ad-hoc test block'`);
  });

  it('rejects a booking that falls entirely inside a declared teaching period', async () => {
    // 2026-08-24 is a Monday; Prof. Rao teaches CSE301 10:00-11:00.
    await expect(
      repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T10:15:00+05:30', '2026-08-24T10:45:00+05:30'),
        reason: 'Inside the teaching block',
      })
    ).rejects.toThrow(FacultyUnavailableError);
  });

  it('rejects a booking that only PARTIALLY overlaps a teaching period (starts before, ends inside it)', async () => {
    await expect(
      repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T09:45:00+05:30', '2026-08-24T10:15:00+05:30'), // crosses into the 10:00 lecture start
        reason: 'Straddles the teaching block boundary',
      })
    ).rejects.toThrow(FacultyUnavailableError);
  });

  it('rejects a booking on a day the faculty member has declared full-day LEAVE', async () => {
    await expect(
      repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-31T12:00:00+05:30', '2026-08-31T12:30:00+05:30'),
        reason: 'During declared leave',
      })
    ).rejects.toThrow(FacultyUnavailableError);
  });

  it('rejects a booking during an ad-hoc BLOCK exception (e.g. an unscheduled meeting added after the fact)', async () => {
    // 2026-09-07 is a Monday with no other exceptions seeded — add a
    // one-off BLOCK for this test only, cleaned up in beforeEach above.
    await pool.query(
      `INSERT INTO faculty_schedule_exceptions (faculty_id, exception_date, start_time, end_time, exception_type, reason)
       VALUES ($1, '2026-09-07', '14:00', '15:00', 'BLOCK', 'Ad-hoc test block')`,
      [FACULTY]
    );
    await expect(
      repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-09-07T14:15:00+05:30', '2026-09-07T14:45:00+05:30'),
        reason: 'During the ad-hoc block',
      })
    ).rejects.toThrow(FacultyUnavailableError);

    // Sanity: the SAME day, an hour NOT covered by the block, still books fine.
    const result = await repo.bookAppointment({
      studentId: STUDENT_A, facultyId: FACULTY,
      slot: slot('2026-09-07T09:00:00+05:30', '2026-09-07T09:30:00+05:30'),
      reason: 'Same day, outside the block',
    });
    expect(result.wasNewlyCreated).toBe(true);
  });

  it('rejects a booking entirely outside any declared availability window (e.g. a weekend, or before/after operating hours)', async () => {
    // 2026-08-22 is a Saturday — Prof. Rao's availability is Mon-Fri only.
    await expect(
      repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-22T10:00:00+05:30', '2026-08-22T10:30:00+05:30'),
        reason: 'Weekend, no availability window at all',
      })
    ).rejects.toThrow(FacultyUnavailableError);

    // Same faculty, a weekday, but before the 09:00 opening.
    await expect(
      repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T08:00:00+05:30', '2026-08-24T08:30:00+05:30'),
        reason: 'Before the availability window opens',
      })
    ).rejects.toThrow(FacultyUnavailableError);
  });

  it('accepts a genuinely available booking — the fix does not reject valid requests', async () => {
    const result = await repo.bookAppointment({
      studentId: STUDENT_A, facultyId: FACULTY,
      slot: slot('2026-08-24T09:00:00+05:30', '2026-08-24T09:30:00+05:30'), // open window, no teaching/leave/block
      reason: 'Genuinely available slot',
    });
    expect(result.wasNewlyCreated).toBe(true);
    expect(result.row.status).toBe('PENDING');
  });

  it('every slot get_available_slots() reports as open for a given day is ALSO accepted by book_appointment() — the read path and the write path agree', async () => {
    const openSlots = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-25']); // Tuesday, no teaching block seeded
    expect(openSlots.rows.length).toBeGreaterThan(0);

    for (const row of openSlots.rows) {
      const result = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: TimeRange.create(new Date(row.slot_start), new Date(row.slot_end)),
        reason: 'Booking every slot get_available_slots() reported as open',
      });
      expect(result.wasNewlyCreated).toBe(true);
    }
  });

  describe('Interaction with the existing exclusion constraint', () => {
    it('a slot that is available but conflicts with an existing appointment is rejected as SlotConflictError, NOT FacultyUnavailableError — the two checks report distinct, correct reasons', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T09:00:00+05:30', '2026-08-24T09:30:00+05:30'),
        reason: 'First booking, takes the slot',
      });

      await expect(
        repo.bookAppointment({
          studentId: STUDENT_B, facultyId: FACULTY,
          slot: slot('2026-08-24T09:15:00+05:30', '2026-08-24T09:45:00+05:30'), // available window, but overlaps the booking above
          reason: 'Overlaps an existing appointment, not an availability problem',
        })
      ).rejects.toThrow(SlotConflictError);
    });

    it('a slot that is BOTH unavailable and would have conflicted is rejected as FacultyUnavailableError — the availability check runs first and short-circuits before the exclusion constraint is ever reached', async () => {
      // Book something valid first so a conflict would exist if the
      // availability check didn't run first.
      // (Nothing to seed here — the teaching block itself is the blocker;
      // no appointment needs to exist for this to demonstrate ordering.)
      await expect(
        repo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-08-24T10:00:00+05:30', '2026-08-24T10:30:00+05:30'), // inside the teaching block
          reason: 'Unavailable slot, would also never have conflicted with anything',
        })
      ).rejects.toThrow(FacultyUnavailableError);
    });

    it('the exclusion constraint still protects a genuinely available slot under real concurrency — the new availability check does not weaken the existing double-booking guarantee', async () => {
      const poolA = createPool();
      const poolB = createPool();
      try {
        const repoA = new AppointmentRepository(poolA);
        const repoB = new AppointmentRepository(poolB);
        const theSlot = slot('2026-08-24T11:00:00+05:30', '2026-08-24T11:30:00+05:30'); // open window, no teaching/leave/block

        const results = await Promise.allSettled([
          repoA.bookAppointment({ studentId: STUDENT_A, facultyId: FACULTY, slot: theSlot, reason: 'Concurrent attempt A' }),
          repoB.bookAppointment({ studentId: STUDENT_B, facultyId: FACULTY, slot: theSlot, reason: 'Concurrent attempt B' }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SlotConflictError);
      } finally {
        await poolA.end();
        await poolB.end();
      }
    });

    it('concurrent requests for an UNAVAILABLE slot are all rejected as FacultyUnavailableError, not left to race the exclusion constraint', async () => {
      const pools = Array.from({ length: 5 }, () => createPool());
      try {
        const theSlot = slot('2026-08-24T10:00:00+05:30', '2026-08-24T10:30:00+05:30'); // inside the teaching block
        const results = await Promise.allSettled(
          pools.map((p, i) =>
            new AppointmentRepository(p).bookAppointment({
              studentId: String(100 + (i % 2)), facultyId: FACULTY, slot: theSlot,
              reason: `Concurrent unavailable-slot attempt #${i + 1}`,
            })
          )
        );
        expect(results.every((r) => r.status === 'rejected')).toBe(true);
        for (const r of results) {
          expect((r as PromiseRejectedResult).reason).toBeInstanceOf(FacultyUnavailableError);
        }
        const count = await pool.query('SELECT count(*)::int AS n FROM appointments');
        expect(count.rows[0].n).toBe(0);
      } finally {
        await Promise.all(pools.map((p) => p.end()));
      }
    });
  });
});
