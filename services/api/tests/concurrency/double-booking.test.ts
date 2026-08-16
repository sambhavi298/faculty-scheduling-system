import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';

/**
 * THE flagship test (Level 2, Level 5 Section 13.2): fires two genuinely
 * concurrent booking attempts for the *same* faculty member and an
 * *overlapping* time slot, from two separate students, using two separate
 * pg.Pool connections (so they are truly independent client connections,
 * not sharing one connection/transaction) — and proves that exactly one
 * succeeds and the other is rejected safely, with no double-booked row
 * ever existing.
 *
 * This is precisely the scenario a naive "check availability, then insert"
 * application-level implementation cannot safely guarantee (Level 5,
 * Section 5) — both requests could see the slot as free before either
 * commits. This test proves our design's actual mechanism, the exclusion
 * constraint, closes that race under real concurrency, not just in theory.
 */

const STUDENT_A = '100';
const STUDENT_B = '101';
const FACULTY = '200';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

/**
 * Asserts a rejected concurrent-booking attempt failed with the expected,
 * mapped SlotConflictError — and if it didn't, logs the raw error's
 * SQLSTATE `code` and `message` before failing, so a failure on another
 * machine (different PostgreSQL version, different lock-timing behavior)
 * is diagnosable from CI/test output alone. AppointmentRepository only
 * maps SQLSTATE 23P01 (exclusion_violation) and 23505 (unique_violation,
 * idempotency path) to SlotConflictError; any other code reaching here
 * unmapped — e.g. 40P01 (deadlock_detected) or 40001
 * (serialization_failure), both legitimate outcomes of two transactions
 * racing to insert into the same GiST index page — is a real,
 * evidence-worth-seeing gap in that mapping, not something to guess at.
 */
function assertSlotConflict(reason: unknown): void {
  if (!(reason instanceof SlotConflictError)) {
    const err = reason as { constructor?: { name?: string }; code?: string; message?: string };
    // eslint-disable-next-line no-console
    console.error('[double-booking] unexpected rejection — not a SlotConflictError:', {
      constructorName: err?.constructor?.name,
      code: err?.code,
      message: err?.message,
    });
  }
  expect(reason).toBeInstanceOf(SlotConflictError);
}

describe('Double booking under real concurrency (concurrency — real PostgreSQL)', () => {
  let poolA: Pool;
  let poolB: Pool;
  let repoA: AppointmentRepository;
  let repoB: AppointmentRepository;
  let cleanupPool: Pool;

  beforeAll(() => {
    // Two independent connection pools = two independent client connections,
    // exactly like two different students' requests arriving at the API
    // through two different HTTP connections at the same time.
    poolA = createPool();
    poolB = createPool();
    cleanupPool = createPool();
    repoA = new AppointmentRepository(poolA);
    repoB = new AppointmentRepository(poolB);
  });

  afterAll(async () => {
    await poolA.end();
    await poolB.end();
    await cleanupPool.end();
  });

  beforeEach(async () => {
    await cleanupPool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  it('when two students request the exact same slot at the same instant, exactly one booking succeeds and the other is rejected — never both, never neither', async () => {
    const theSlot = slot('2026-10-01T10:00:00+05:30', '2026-10-01T10:30:00+05:30');

    const attemptA = repoA.bookAppointment({
      studentId: STUDENT_A, facultyId: FACULTY, slot: theSlot, reason: 'Student A: doubt in DBMS assignment',
    });
    const attemptB = repoB.bookAppointment({
      studentId: STUDENT_B, facultyId: FACULTY, slot: theSlot, reason: 'Student B: doubt in the same assignment',
    });

    // Fired truly concurrently — both promises are already in flight before we await either.
    const results = await Promise.allSettled([attemptA, attemptB]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    assertSlotConflict((rejected[0] as PromiseRejectedResult).reason);

    // The database itself — not this test's bookkeeping — is the source of truth:
    // exactly one PENDING row exists for this faculty member and slot, no matter
    // which of the two requests physically reached Postgres microseconds first.
    const dbCheck = await cleanupPool.query(
      `SELECT student_id, status FROM appointments WHERE faculty_id = $1`,
      [FACULTY]
    );
    expect(dbCheck.rows).toHaveLength(1);
    expect(['PENDING']).toContain(dbCheck.rows[0].status);

    const winnerId = dbCheck.rows[0].student_id;
    expect([STUDENT_A, STUDENT_B]).toContain(winnerId);
  });

  it('when two students request overlapping (not identical) slots at the same instant, exactly one booking succeeds', async () => {
    const attemptA = repoA.bookAppointment({
      studentId: STUDENT_A, facultyId: FACULTY,
      slot: slot('2026-10-02T14:00:00+05:30', '2026-10-02T14:30:00+05:30'),
      reason: 'Student A: 14:00-14:30 slot',
    });
    const attemptB = repoB.bookAppointment({
      studentId: STUDENT_B, facultyId: FACULTY,
      slot: slot('2026-10-02T14:15:00+05:30', '2026-10-02T14:45:00+05:30'), // overlaps A's slot, not identical
      reason: 'Student B: 14:15-14:45 slot, overlapping A',
    });

    const results = await Promise.allSettled([attemptA, attemptB]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    assertSlotConflict((rejected[0] as PromiseRejectedResult).reason);
  });

  it('ten simultaneous requests for the same slot: exactly one succeeds, nine are rejected safely, none crash the process', async () => {
    const theSlot = slot('2026-10-05T09:00:00+05:30', '2026-10-05T09:30:00+05:30'); // Monday, but 09:00 is before the 10:00 teaching block — available
    const pools = Array.from({ length: 10 }, () => createPool());

    try {
      const attempts = pools.map((pool, i) =>
        new AppointmentRepository(pool).bookAppointment({
          studentId: String(100 + (i % 2)), // reuses seeded students 100/101, doesn't matter which
          facultyId: FACULTY,
          slot: theSlot,
          reason: `Concurrent request #${i + 1} for the same slot`,
        })
      );

      const results = await Promise.allSettled(attempts);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        assertSlotConflict((r as PromiseRejectedResult).reason);
      }

      const dbCheck = await cleanupPool.query(
        `SELECT count(*)::int AS n FROM appointments WHERE faculty_id = $1 AND status = 'PENDING'`,
        [FACULTY]
      );
      expect(dbCheck.rows[0].n).toBe(1); // never zero, never more than one
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
    // Explicit timeout, not left to the jest.config.js project default: a
    // 10-way race for the same slot can involve more than one PostgreSQL
    // deadlock_timeout wait (~1s each, default config) as the deadlock
    // detector resolves lock cycles among the losers, and testing showed
    // the concurrency project's configured testTimeout (20000) is not
    // actually applied per-project by this Jest version — only an
    // explicit per-test timeout reliably takes effect.
  }, 20000);
});
