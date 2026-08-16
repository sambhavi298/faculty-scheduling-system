import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';

/**
 * Integration tests — exercise AppointmentRepository against a REAL
 * PostgreSQL instance running the actual Level 5 schema (migrations
 * 0001-0004), not a mock. This is what proves the repository's SQL is
 * correct and that the database's own guarantees (the exclusion
 * constraint, the transition-guard trigger) actually hold — the unit
 * tests only prove the repository *calls* the right SQL, they cannot
 * prove the SQL or the schema itself is correct.
 *
 * Seed data (migrations/sql/seed_test_data.sql): student 100 (Alice),
 * student 101 (Bob), faculty 200 (Prof Rao), faculty 201 (Prof Iyer).
 */

const STUDENT_A = '100';
const STUDENT_B = '101';
const FACULTY = '200';
const OTHER_FACULTY = '201';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

describe('AppointmentRepository (integration — real PostgreSQL)', () => {
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
  });

  describe('bookAppointment', () => {
    it('creates a real PENDING row via the book_appointment() database function', async () => {
      const result = await repo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY,
        slot: slot('2026-09-01T10:00:00+05:30', '2026-09-01T10:30:00+05:30'),
        reason: 'Doubt about assignment 3',
      });

      expect(result.wasNewlyCreated).toBe(true);
      expect(result.row.id).toBeDefined();
      expect(result.row.status).toBe('PENDING');
      expect(result.row.student_id).toBe(STUDENT_A);
      expect(result.row.faculty_id).toBe(FACULTY);
    });

    it('records an audit_log entry in the same transaction as the insert (trg_audit_appointment)', async () => {
      const result = await repo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY,
        slot: slot('2026-09-01T11:00:00+05:30', '2026-09-01T11:30:00+05:30'),
        reason: 'Project discussion',
      });

      const audit = await pool.query(
        `SELECT action FROM audit_log WHERE entity_type = 'appointment' AND entity_id = $1`,
        [result.row.id]
      );
      expect(audit.rows).toEqual([{ action: 'INSERT' }]);
    });

    it('throws a real SlotConflictError (SQLSTATE 23P01) when a second overlapping request is made for the same faculty member', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY,
        slot: slot('2026-09-02T10:00:00+05:30', '2026-09-02T10:30:00+05:30'),
        reason: 'First request for this slot',
      });

      await expect(
        repo.bookAppointment({
          studentId: STUDENT_B,
          facultyId: FACULTY,
          slot: slot('2026-09-02T10:15:00+05:30', '2026-09-02T10:45:00+05:30'), // overlaps, not identical
          reason: 'Second, conflicting request',
        })
      ).rejects.toThrow(SlotConflictError);
    });

    it('does NOT conflict with a non-overlapping slot for the same faculty member', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY,
        slot: slot('2026-09-03T10:00:00+05:30', '2026-09-03T10:30:00+05:30'),
        reason: 'First request',
      });

      const second = await repo.bookAppointment({
        studentId: STUDENT_B,
        facultyId: FACULTY,
        slot: slot('2026-09-03T11:00:00+05:30', '2026-09-03T11:30:00+05:30'), // does not overlap
        reason: 'Second, non-conflicting request',
      });

      expect(second.wasNewlyCreated).toBe(true);
    });

    it('does NOT conflict with an overlapping slot for a DIFFERENT faculty member', async () => {
      // OTHER_FACULTY (201) has zero faculty_availability rows in the base
      // seed fixture (it's deliberately used elsewhere as "the faculty
      // member with no declared availability" for boundary tests). Since
      // migration 0006, book_appointment() now enforces availability, so a
      // real booking for 201 needs its own, test-scoped availability
      // window — otherwise this test would be proving nothing about
      // faculty-scoping and everything about the availability gate instead.
      await pool.query(
        `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until)
         VALUES ($1, 5, '09:00', '17:00', '2026-09-04', '2026-09-04')`, // 2026-09-04 is a Friday (day_of_week=5), scoped to this one date only
        [OTHER_FACULTY]
      );
      try {
        await repo.bookAppointment({
          studentId: STUDENT_A,
          facultyId: FACULTY,
          slot: slot('2026-09-04T10:00:00+05:30', '2026-09-04T10:30:00+05:30'),
          reason: 'Request with Prof Rao',
        });

        const second = await repo.bookAppointment({
          studentId: STUDENT_B,
          facultyId: OTHER_FACULTY,
          slot: slot('2026-09-04T10:00:00+05:30', '2026-09-04T10:30:00+05:30'), // same time, different faculty
          reason: 'Request with Prof Iyer, same time slot',
        });

        expect(second.wasNewlyCreated).toBe(true);
      } finally {
        await pool.query(
          `DELETE FROM faculty_availability WHERE faculty_id = $1 AND effective_from = '2026-09-04'`,
          [OTHER_FACULTY]
        );
      }
    });

    it('replays an identical (clientRequestId) retry as the ORIGINAL row instead of creating a duplicate (real 23505 on appointments_idem_uq)', async () => {
      const clientRequestId = '11111111-1111-1111-1111-111111111111';
      const first = await repo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY,
        slot: slot('2026-09-08T10:00:00+05:30', '2026-09-08T10:30:00+05:30'), // Tuesday — within Prof Rao's Mon-Fri availability
        reason: 'Original request',
        clientRequestId,
      });

      const retry = await repo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY,
        slot: slot('2026-09-08T10:00:00+05:30', '2026-09-08T10:30:00+05:30'),
        reason: 'Original request',
        clientRequestId,
      });

      expect(retry.wasNewlyCreated).toBe(false);
      expect(retry.row.id).toBe(first.row.id);

      const count = await pool.query('SELECT count(*)::int AS n FROM appointments');
      expect(count.rows[0].n).toBe(1); // proves no duplicate row was created
    });

    it('rejects a reason shorter than the database CHECK constraint allows', async () => {
      await expect(
        repo.bookAppointment({
          studentId: STUDENT_A,
          facultyId: FACULTY,
          slot: slot('2026-09-09T10:00:00+05:30', '2026-09-09T10:30:00+05:30'), // Wednesday — available, so the CHECK constraint is the ONLY thing this can fail on
          reason: 'Hi', // violates appointments_reason_len_chk (>= 5 chars) — DB is the backstop even if the Service layer's own check were bypassed
        })
      ).rejects.toMatchObject({ code: '23514' }); // check_violation
    });
  });

  describe('guarded status transitions against the real trigger and guarded UPDATE', () => {
    async function bookPending(overrides: { studentId?: string; facultyId?: string } = {}) {
      const result = await repo.bookAppointment({
        studentId: overrides.studentId ?? STUDENT_A,
        facultyId: overrides.facultyId ?? FACULTY,
        slot: slot('2026-09-10T10:00:00+05:30', '2026-09-10T10:30:00+05:30'),
        reason: 'Doubt about the concurrency section',
      });
      return result.row;
    }

    it('approve() transitions PENDING -> APPROVED for real, setting responded_at and responded_by', async () => {
      const pending = await bookPending();
      const approved = await repo.approve(pending.id, FACULTY);

      expect(approved).not.toBeNull();
      expect(approved!.status).toBe('APPROVED');
      expect(approved!.responded_by).toBe(FACULTY);
      expect(approved!.responded_at).not.toBeNull();
    });

    it('approve() matches zero rows (returns null) when a different faculty member attempts it', async () => {
      const pending = await bookPending();
      const result = await repo.approve(pending.id, OTHER_FACULTY);
      expect(result).toBeNull();
    });

    it('reject() transitions PENDING -> REJECTED for real', async () => {
      const pending = await bookPending();
      const rejected = await repo.reject(pending.id, FACULTY);
      expect(rejected!.status).toBe('REJECTED');
    });

    it('cancel() allows the student to cancel their own PENDING appointment', async () => {
      const pending = await bookPending();
      const cancelled = await repo.cancel(pending.id, STUDENT_A);
      expect(cancelled!.status).toBe('CANCELLED');
      expect(cancelled!.cancelled_by).toBe(STUDENT_A);
    });

    it('the trigger backstop rejects an invalid transition even when it bypasses the repository entirely (direct SQL, e.g. an admin script)', async () => {
      const pending = await bookPending();
      await repo.reject(pending.id, FACULTY); // now REJECTED — a terminal state

      // Simulate a caller that bypasses AppointmentRepository/AppointmentService completely
      // and issues a raw UPDATE directly, with no WHERE-clause status guard at all.
      await expect(
        pool.query(`UPDATE appointments SET status = 'APPROVED' WHERE id = $1`, [pending.id])
      ).rejects.toMatchObject({
        message: expect.stringContaining('INVALID_TRANSITION'),
      });
    });

    it('an appointment leaving the active exclusion set (e.g. cancelled) frees the slot for a new booking', async () => {
      const pending = await bookPending({ studentId: STUDENT_A });
      await repo.cancel(pending.id, STUDENT_A);

      // Same faculty, same exact slot — must now succeed, because the
      // exclusion constraint only applies to PENDING/APPROVED rows.
      const second = await repo.bookAppointment({
        studentId: STUDENT_B,
        facultyId: FACULTY,
        slot: slot('2026-09-10T10:00:00+05:30', '2026-09-10T10:30:00+05:30'),
        reason: 'Booking the now-freed slot',
      });
      expect(second.wasNewlyCreated).toBe(true);
    });
  });

  describe('reads', () => {
    it('listPendingForFaculty() reads from the faculty_pending_requests view', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-09-11T09:00:00+05:30', '2026-09-11T09:30:00+05:30'), reason: 'Pending request one',
      });
      const approvedOne = await repo.bookAppointment({
        studentId: STUDENT_B, facultyId: FACULTY,
        slot: slot('2026-09-11T10:00:00+05:30', '2026-09-11T10:30:00+05:30'), reason: 'Will be approved',
      });
      await repo.approve(approvedOne.row.id, FACULTY);

      const pending = await repo.listPendingForFaculty(FACULTY);
      expect(pending).toHaveLength(1); // the approved one must not appear
      expect(pending[0].reason).toBe('Pending request one');
    });
  });
});
