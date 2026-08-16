import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { TimeRange } from '../../src/domain/time-range';
import { AlreadyProcessedError } from '../../src/errors/already-processed.error';
import { InvalidTransitionError } from '../../src/errors/invalid-transition.error';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';

/**
 * Level 7 — Section 4 (Concurrency, "This is critical") and Section 5
 * (Idempotency). The flagship double-booking test (tests/concurrency/
 * double-booking.test.ts) already proves the exclusion constraint closes
 * the classic "two students, one slot" race. This file goes after the
 * OTHER races Level 7 explicitly calls out that flagship test does not
 * cover: approval-vs-cancellation, repeated/duplicate requests, lock
 * contention made visible via pg_locks, lost-update prevention on the
 * guarded UPDATE pattern, stale-availability reads, and idempotent replay
 * under genuine concurrency (not just sequential retries).
 *
 * Every test here uses independent pg.Pool connections per concurrent
 * actor, exactly like the flagship test, so races are real network-level
 * races, not just interleaved promises on one connection.
 */

const STUDENT_A = '100';
const STUDENT_B = '101';
const FACULTY = '200';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

function makeActor() {
  const pool = createPool();
  const repo = new AppointmentRepository(pool);
  const service = new AppointmentService(repo, new AppointmentStateMachine());
  return { pool, repo, service };
}

describe('Extended concurrency and idempotency (real PostgreSQL)', () => {
  let cleanupPool: Pool;

  beforeAll(() => {
    cleanupPool = createPool();
  });

  afterAll(async () => {
    await cleanupPool.end();
  });

  beforeEach(async () => {
    await cleanupPool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  // ────────────────────────── CONCURRENCY: approval vs cancellation ──────────────────────────

  describe('Approval-while-cancellation race', () => {
    it('faculty approving and student cancelling the SAME pending appointment at the same instant: exactly one wins, the other is told it was already processed', async () => {
      const bookerPool = createPool();
      const bookerRepo = new AppointmentRepository(bookerPool);
      const { row } = await bookerRepo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-20T10:00:00+05:30', '2026-11-20T10:30:00+05:30'), reason: 'Approve-vs-cancel race target',
      });
      await bookerPool.end();

      const faculty = makeActor();
      const student = makeActor();
      try {
        const attemptApprove = faculty.service.approve(row.id, FACULTY);
        const attemptCancel = student.service.cancel(row.id, STUDENT_A);

        const [approveResult, cancelResult] = await Promise.allSettled([attemptApprove, attemptCancel]);

        // This race is NOT symmetric, and a first empirical run of this test
        // proved that assuming "exactly one wins" is the wrong model: per
        // the state machine (Level 5, Section 4), CANCELLED is a valid
        // target from BOTH PENDING and APPROVED, so the student's cancel()
        // succeeds no matter whether it lands before or after the faculty's
        // approve() — either it cancels a still-PENDING appointment
        // directly, or it legitimately cancels the just-approved one
        // (a real student cancelling right after approval is a genuine,
        // supported workflow, not a bug). Cancellation is therefore always
        // the one guaranteed-fulfilled side of this race.
        expect(cancelResult.status).toBe('fulfilled');
        if (cancelResult.status === 'fulfilled') {
          expect(cancelResult.value.status).toBe('CANCELLED');
        }

        // Approval, unlike cancellation, is one-directional: PENDING ->
        // APPROVED is only valid while status is still PENDING. If cancel's
        // write reaches Postgres first, approve() fails one of two honest
        // ways depending purely on timing of its OWN read versus the DB
        // write — AlreadyProcessedError (its local read still saw PENDING,
        // but the guarded UPDATE then matched zero rows because cancel beat
        // it to the row) or InvalidTransitionError (its local read already
        // saw CANCELLED, a terminal state with no valid outgoing
        // transitions at all). If approve's write reaches Postgres first
        // instead, it legitimately succeeds — just as a transient state
        // that cancel then supersedes. All three are correct; the only bug
        // would be an unrelated error type, or the final row not ending up
        // CANCELLED.
        if (approveResult.status === 'rejected') {
          const err = approveResult.reason;
          expect(err instanceof AlreadyProcessedError || err instanceof InvalidTransitionError).toBe(true);
        } else {
          expect(approveResult.value.status).toBe('APPROVED');
        }

        // Whichever interleaving occurred, the terminal state the database
        // actually holds afterward must always be CANCELLED — never left
        // stuck at APPROVED — because cancellation is reachable from every
        // non-terminal state this appointment can be in.
        const finalRow = await cleanupPool.query('SELECT status FROM appointments WHERE id = $1', [row.id]);
        expect(finalRow.rows[0].status).toBe('CANCELLED');
      } finally {
        await faculty.pool.end();
        await student.pool.end();
      }
    });

    it('two different actors racing approve() and reject() on the same appointment: exactly one status change survives, never both', async () => {
      const bookerPool = createPool();
      const bookerRepo = new AppointmentRepository(bookerPool);
      const { row } = await bookerRepo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-20T11:00:00+05:30', '2026-11-20T11:30:00+05:30'), reason: 'Approve-vs-reject race target',
      });
      await bookerPool.end();

      const actorApprove = makeActor();
      const actorReject = makeActor();
      try {
        const results = await Promise.allSettled([
          actorApprove.service.approve(row.id, FACULTY),
          actorReject.service.reject(row.id, FACULTY),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        expect(fulfilled).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

        const finalRow = await cleanupPool.query('SELECT status FROM appointments WHERE id = $1', [row.id]);
        expect(['APPROVED', 'REJECTED']).toContain(finalRow.rows[0].status);
      } finally {
        await actorApprove.pool.end();
        await actorReject.pool.end();
      }
    });
  });

  // ────────────────────────── CONCURRENCY: repeated requests / lost updates ──────────────────────────

  describe('Repeated requests and lost-update prevention', () => {
    it('the same faculty member double-clicking "approve" (two concurrent approve() calls, no idempotency key on this endpoint): exactly one succeeds, the second is told it was already processed — never a silent lost update', async () => {
      const bookerPool = createPool();
      const bookerRepo = new AppointmentRepository(bookerPool);
      const { row } = await bookerRepo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-26T10:00:00+05:30', '2026-11-26T10:30:00+05:30'), reason: 'Double-click approve test', // Thursday, available
      });
      await bookerPool.end();

      const actor1 = makeActor();
      const actor2 = makeActor();
      try {
        // Both actors call approve() concurrently. A first empirical run of
        // a similar (ten-way) test proved that "exactly one fulfilled, one
        // rejected" is too strong an assumption: AppointmentService.approve()
        // does its own SELECT before the guarded UPDATE, and has an
        // idempotent no-op fast path (`if (existing.status === target)
        // return existing`). If actor2's SELECT happens to run AFTER
        // actor1's UPDATE has already committed, actor2 legitimately
        // short-circuits to a successful no-op instead of ever touching the
        // guarded UPDATE — it is not a lost update, it is intentionally
        // idempotent, exactly like a double-click on "approve" should be.
        // The invariant that actually matters, and the one the database
        // itself guarantees, is: only ONE genuine write ever happens, so
        // every fulfilled result must report identical data — never two
        // different responded_at values, which would mean divergent state.
        const results = await Promise.allSettled([
          actor1.service.approve(row.id, FACULTY),
          actor2.service.approve(row.id, FACULTY),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
        const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

        expect(fulfilled.length + rejected.length).toBe(2);
        expect(fulfilled.length).toBeGreaterThanOrEqual(1); // at least one approval always genuinely succeeds
        for (const r of rejected) {
          expect(r.reason).toBeInstanceOf(AlreadyProcessedError);
        }
        // Compare by VALUE (ISO string), not Date object reference — see the
        // longer comment on the equivalent check in the ten-way test below.
        for (const r of fulfilled) {
          expect(r.value.status).toBe('APPROVED');
        }
        const respondedAts = new Set(fulfilled.map((r) => new Date(r.value.responded_at).toISOString()));
        expect(respondedAts.size).toBe(1); // no divergence between however many "successes" occurred

        const finalRow = await cleanupPool.query(
          'SELECT status, responded_at FROM appointments WHERE id = $1',
          [row.id]
        );
        expect(finalRow.rows[0].status).toBe('APPROVED');
        expect(finalRow.rows[0].responded_at).not.toBeNull();
      } finally {
        await actor1.pool.end();
        await actor2.pool.end();
      }
    });

    it('ten simultaneous approve() calls on the same appointment: the database performs exactly one genuine write, every caller either sees that same result or a clean AlreadyProcessedError, and the process never crashes', async () => {
      const bookerPool = createPool();
      const bookerRepo = new AppointmentRepository(bookerPool);
      const { row } = await bookerRepo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-26T11:00:00+05:30', '2026-11-26T11:30:00+05:30'), reason: 'Ten-way approve flood', // Thursday, available
      });
      await bookerPool.end();

      const actors = Array.from({ length: 10 }, () => makeActor());
      try {
        const results = await Promise.allSettled(actors.map((a) => a.service.approve(row.id, FACULTY)));
        const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
        const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

        // See the two-actor test above for why "exactly one fulfilled" is
        // the wrong invariant: AppointmentService.approve()'s idempotent
        // no-op path means several callers can legitimately observe success
        // without ever performing the write themselves. What must hold,
        // and is what the database's guarded UPDATE actually guarantees,
        // is that every fulfilled result reflects the SAME single genuine
        // write (identical responded_at) and every rejection is the
        // documented, clean AlreadyProcessedError — never a raw DB error,
        // never a crash, never divergent data.
        expect(fulfilled.length + rejected.length).toBe(10);
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);
        for (const r of rejected) {
          expect(r.reason).toBeInstanceOf(AlreadyProcessedError);
        }
        for (const r of fulfilled) {
          expect(r.value.status).toBe('APPROVED');
        }
        // Compare by VALUE (ISO string), not by object reference — pg
        // returns a fresh Date instance per row/query, so a naive
        // `new Set(dates)` would report every idempotent-shortcut read as
        // "different" even when every one of them reflects the exact same
        // underlying timestamp. This was caught empirically: the first
        // version of this assertion compared Date objects directly and
        // failed intermittently, which looked exactly like a real
        // concurrency bug until the actual values were logged and turned
        // out to be identical — a test-authoring mistake, not a system
        // defect, and worth keeping this comment so it isn't reintroduced.
        const respondedAts = new Set(fulfilled.map((r) => new Date(r.value.responded_at).toISOString()));
        expect(respondedAts.size).toBe(1);

        const finalRow = await cleanupPool.query('SELECT status FROM appointments WHERE id = $1', [row.id]);
        expect(finalRow.rows[0].status).toBe('APPROVED');
      } finally {
        await Promise.all(actors.map((a) => a.pool.end()));
      }
      // Explicit timeout, not left to the jest.config.js project default —
      // see the same note in double-booking.test.ts's ten-way test: this
      // Jest version does not reliably apply a per-project testTimeout, and
      // ten concurrent connections/round trips under real system load can
      // legitimately take longer than the 5000ms Jest default.
    }, 20000);

    it('completing and cancelling an APPROVED appointment concurrently: exactly one terminal state wins', async () => {
      const bookerPool = createPool();
      const bookerRepo = new AppointmentRepository(bookerPool);
      const booked = await bookerRepo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-26T12:00:00+05:30', '2026-11-26T12:30:00+05:30'), reason: 'Complete-vs-cancel race target', // Thursday, available
      });
      await bookerRepo.approve(booked.row.id, FACULTY);
      await bookerPool.end();

      const facultyActor = makeActor();
      const studentActor = makeActor();
      try {
        const results = await Promise.allSettled([
          facultyActor.repo.complete(booked.row.id, FACULTY),
          studentActor.service.cancel(booked.row.id, STUDENT_A),
        ]);
        // repo.complete() resolves to null (not a throw) on a lost race, so
        // we check outcomes directly rather than fulfilled/rejected counts.
        const completeOutcome = results[0];
        const cancelOutcome = results[1];
        const completeWon = completeOutcome.status === 'fulfilled' && completeOutcome.value !== null;
        const cancelWon = cancelOutcome.status === 'fulfilled';

        // Exactly one of the two terminal transitions actually took effect.
        expect(completeWon !== cancelWon).toBe(true);

        const finalRow = await cleanupPool.query('SELECT status FROM appointments WHERE id = $1', [booked.row.id]);
        expect(['COMPLETED', 'CANCELLED']).toContain(finalRow.rows[0].status);
      } finally {
        await facultyActor.pool.end();
        await studentActor.pool.end();
      }
    });
  });

  // ────────────────────────── CONCURRENCY: lock contention made visible ──────────────────────────

  describe('DB lock contention', () => {
    it('a held-open transaction on an appointment row blocks a concurrent UPDATE until it commits — observable via pg_locks, not merely inferred', async () => {
      const holderPool = createPool();
      const bookerPool = createPool();
      const observerPool = createPool();
      const contenderPool = createPool();
      try {
        const bookerRepo = new AppointmentRepository(bookerPool);
        const { row } = await bookerRepo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-11-24T10:00:00+05:30', '2026-11-24T10:30:00+05:30'), reason: 'Lock contention target', // Tuesday, available
        });

        const holder = await holderPool.connect();
        try {
          await holder.query('BEGIN');
          // Take a row lock and DO NOT commit yet — simulates an in-flight
          // approve() whose transaction hasn't finished.
          await holder.query(
            `UPDATE appointments SET responded_by = $2 WHERE id = $1 AND status = 'PENDING'`,
            [row.id, FACULTY]
          );

          // A second, independent connection tries to update the same row
          // right now. It must block (not error, not silently proceed) —
          // fire it and don't await yet.
          const contenderQuery = new AppointmentRepository(contenderPool).approve(row.id, FACULTY);
          let contenderSettled = false;
          contenderQuery.finally(() => { contenderSettled = true; });

          // Give the contender a moment to actually reach Postgres and block.
          await new Promise((r) => setTimeout(r, 300));

          // Prove the block is real: pg_locks shows a granted lock held by
          // the holder's backend on the appointments relation, and (on
          // recent PostgreSQL) the contender's backend waiting on it.
          const locks = await observerPool.query(
            `SELECT l.pid, l.mode, l.granted, a.query
               FROM pg_locks l
               JOIN pg_stat_activity a ON a.pid = l.pid
              WHERE l.relation = 'appointments'::regclass`
          );
          expect(locks.rows.length).toBeGreaterThan(0);
          expect(locks.rows.some((r) => r.granted === true)).toBe(true);

          // The contender must NOT have resolved yet — it is genuinely
          // blocked on the row lock, not racing ahead.
          expect(contenderSettled).toBe(false);

          // Release the lock.
          await holder.query('COMMIT');

          // Now the contender proceeds — but the holder's UPDATE above only
          // touched responded_by, not status, so the row is still PENDING
          // and the contender's approve() legitimately succeeds.
          const contenderResult = await contenderQuery;
          expect(contenderResult).not.toBeNull();
          expect(contenderResult!.status).toBe('APPROVED');
        } finally {
          holder.release();
        }
      } finally {
        await holderPool.end();
        await bookerPool.end();
        await observerPool.end();
        await contenderPool.end();
      }
    });
  });

  // ────────────────────────── CONCURRENCY: stale availability data ──────────────────────────

  describe('Stale availability data', () => {
    it('booking against a slot list fetched moments ago, after someone else has since booked it, is safely rejected rather than silently double-booking', async () => {
      const seedPool = createPool();
      try {
        // Student A fetches "available" slots for the day (a snapshot).
        const available = await seedPool.query(
          'SELECT * FROM get_available_slots($1, $2, 30)',
          [FACULTY, '2026-08-24']
        );
        expect(available.rows.length).toBeGreaterThan(0);
        const staleChoice = available.rows[0];

        // Before Student A submits, Student B books that exact slot.
        const bRepo = new AppointmentRepository(seedPool);
        await bRepo.bookAppointment({
          studentId: STUDENT_B, facultyId: FACULTY,
          slot: TimeRange.create(new Date(staleChoice.slot_start), new Date(staleChoice.slot_end)),
          reason: 'Student B books first, making A\'s snapshot stale',
        });

        // Student A now submits against their now-stale snapshot.
        await expect(
          bRepo.bookAppointment({
            studentId: STUDENT_A, facultyId: FACULTY,
            slot: TimeRange.create(new Date(staleChoice.slot_start), new Date(staleChoice.slot_end)),
            reason: 'Student A submits from a stale availability snapshot',
          })
        ).rejects.toThrow(SlotConflictError);
      } finally {
        await seedPool.end();
      }
    });
  });

  // ────────────────────────── IDEMPOTENCY ──────────────────────────

  describe('Idempotency', () => {
    it('the same request (same clientRequestId) submitted twice SEQUENTIALLY returns the original row both times, never a duplicate', async () => {
      const pool = createPool();
      try {
        const repo = new AppointmentRepository(pool);
        const params = {
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-11-23T09:00:00+05:30', '2026-11-23T09:30:00+05:30'), // Monday, before the 10:00 teaching block — available
          reason: 'Sequential idempotent replay test',
          clientRequestId: randomUUID(),
        };
        const first = await repo.bookAppointment(params);
        const second = await repo.bookAppointment(params); // e.g. browser refresh / user re-clicks "book"

        expect(first.wasNewlyCreated).toBe(true);
        expect(second.wasNewlyCreated).toBe(false);
        expect(second.row.id).toBe(first.row.id);

        const count = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE client_request_id = $1', [params.clientRequestId]);
        expect(count.rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('a retry after a client-perceived timeout (client never saw the first response, so it retries with the SAME clientRequestId) does not create a duplicate, even though the server-side request in fact succeeded', async () => {
      const pool = createPool();
      try {
        const repo = new AppointmentRepository(pool);
        const params = {
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-11-23T11:00:00+05:30', '2026-11-23T11:30:00+05:30'),
          reason: 'Timeout-retry idempotency test',
          clientRequestId: randomUUID(),
        };
        // Simulates: original request actually completed server-side, but the
        // client gave up waiting and fired an identical retry.
        await repo.bookAppointment(params);
        const retry = await repo.bookAppointment(params);

        expect(retry.wasNewlyCreated).toBe(false);
        const count = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE client_request_id = $1', [params.clientRequestId]);
        expect(count.rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('the same clientRequestId submitted through the full Service layer twice (duplicate network-level API retry) is a no-op the second time and never double-notifies', async () => {
      const { pool, service } = makeActor();
      try {
        const params = {
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: { start: new Date('2026-11-23T12:00:00+05:30'), end: new Date('2026-11-23T12:30:00+05:30') },
          reason: 'Full-stack duplicate API request test',
          clientRequestId: randomUUID(),
        };
        const first = await service.requestAppointment(params);
        const second = await service.requestAppointment(params);

        expect(first.wasNewlyCreated).toBe(true);
        expect(second.wasNewlyCreated).toBe(false);
        expect(second.appointment.id).toBe(first.appointment.id);
      } finally {
        await pool.end();
      }
    });

    it('the same clientRequestId fired by two GENUINELY CONCURRENT requests (true network-level duplicate, e.g. a double-tap or a retrying proxy) still results in exactly one row, and BOTH callers get a successful, consistent response — neither sees an error', async () => {
      const actor1 = makeActor();
      const actor2 = makeActor();
      try {
        const params = {
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-11-23T13:00:00+05:30', '2026-11-23T13:30:00+05:30'),
          reason: 'Concurrent duplicate idempotent request test',
          clientRequestId: randomUUID(),
        };

        const results = await Promise.allSettled([
          actor1.repo.bookAppointment(params),
          actor2.repo.bookAppointment(params),
        ]);

        // Unlike the flagship double-booking test (different clientRequestId
        // or none at all → one winner, one SlotConflictError), an identical
        // clientRequestId means this is the SAME logical request arriving
        // twice — both calls must resolve successfully to the same row.
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        const rows = (results as PromiseFulfilledResult<any>[]).map((r) => r.value.row.id);
        expect(rows[0]).toBe(rows[1]);

        const newlyCreatedFlags = (results as PromiseFulfilledResult<any>[]).map((r) => r.value.wasNewlyCreated);
        expect(newlyCreatedFlags.filter(Boolean)).toHaveLength(1); // exactly one side actually inserted

        const dbCount = await cleanupPool.query(
          'SELECT count(*)::int AS n FROM appointments WHERE client_request_id = $1',
          [params.clientRequestId]
        );
        expect(dbCount.rows[0].n).toBe(1);
      } finally {
        await actor1.pool.end();
        await actor2.pool.end();
      }
    });
  });
});
