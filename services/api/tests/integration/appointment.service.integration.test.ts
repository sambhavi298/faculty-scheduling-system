import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { TimeRange } from '../../src/domain/time-range';
import { NotFoundError } from '../../src/errors/not-found.error';
import { InvalidTransitionError } from '../../src/errors/invalid-transition.error';

/**
 * Post-Level-7 development, Phase 1 Task 3: dedicated integration coverage
 * for AppointmentService.complete()/markMissed() (documented Gap 3).
 *
 * The unit tests (tests/unit/appointment.service.test.ts) prove the Service
 * layer calls the right repository methods with a mocked repository — they
 * cannot prove the ownership check and the guarded database UPDATE actually
 * agree with each other against a REAL faculty_id column, a real
 * enforce_appointment_transition trigger, and a real database default for
 * status ('APPROVED' required before either transition is legal at the SQL
 * level too). This file proves that end-to-end.
 */

const STUDENT_A = '100';
const FACULTY = '200';
const OTHER_FACULTY = '201';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

describe('AppointmentService.complete()/markMissed() (integration — real PostgreSQL)', () => {
  let pool: Pool;
  let repo: AppointmentRepository;
  let service: AppointmentService;

  beforeAll(() => {
    pool = createPool();
    repo = new AppointmentRepository(pool);
    service = new AppointmentService(repo, new AppointmentStateMachine());
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  async function bookApproved(overrides: { slotStart?: string; slotEnd?: string } = {}) {
    const { row } = await repo.bookAppointment({
      studentId: STUDENT_A, facultyId: FACULTY,
      slot: slot(overrides.slotStart ?? '2026-08-24T09:00:00+05:30', overrides.slotEnd ?? '2026-08-24T09:30:00+05:30'), // Monday, before the 10:00 teaching block
      reason: 'Doubt about the concurrency section',
    });
    const approved = await repo.approve(row.id, FACULTY);
    return approved!;
  }

  describe('complete', () => {
    it('completes an APPROVED appointment owned by this faculty member, recording completion_notes', async () => {
      const approved = await bookApproved();
      const completed = await service.complete(approved.id, FACULTY, 'Resolved the doubt, no follow-up needed');

      expect(completed.status).toBe('COMPLETED');
      expect(completed.completion_notes).toBe('Resolved the doubt, no follow-up needed');

      const persisted = await repo.findById(approved.id);
      expect(persisted!.status).toBe('COMPLETED');
    });

    it('throws NotFoundError — not a silent null — when a different faculty member attempts it', async () => {
      const approved = await bookApproved();

      await expect(service.complete(approved.id, OTHER_FACULTY)).rejects.toThrow(NotFoundError);

      const stillApproved = await repo.findById(approved.id);
      expect(stillApproved!.status).toBe('APPROVED'); // the unauthorized attempt had zero effect
    });

    it('throws InvalidTransitionError when the appointment is still PENDING (the real enforce_appointment_transition trigger and the state machine agree)', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-25T09:00:00+05:30', '2026-08-25T09:30:00+05:30'), reason: 'Still pending, not yet approved',
      });

      await expect(service.complete(row.id, FACULTY)).rejects.toThrow(InvalidTransitionError);

      const stillPending = await repo.findById(row.id);
      expect(stillPending!.status).toBe('PENDING');
    });

    it('is idempotent against the real database: completing an already-COMPLETED appointment returns it as a no-op', async () => {
      const approved = await bookApproved();
      const first = await service.complete(approved.id, FACULTY, 'First completion');
      const second = await service.complete(approved.id, FACULTY, 'Attempted second completion');

      expect(second.status).toBe('COMPLETED');
      expect(second.completion_notes).toBe(first.completion_notes); // no-op — the second call's notes were never written
    });
  });

  describe('markMissed', () => {
    it('marks an APPROVED appointment owned by this faculty member as MISSED', async () => {
      const approved = await bookApproved({ slotStart: '2026-08-24T11:00:00+05:30', slotEnd: '2026-08-24T11:30:00+05:30' });
      const missed = await service.markMissed(approved.id, FACULTY);

      expect(missed.status).toBe('MISSED');
      const persisted = await repo.findById(approved.id);
      expect(persisted!.status).toBe('MISSED');
    });

    it('throws NotFoundError — not a silent null — when a different faculty member attempts it', async () => {
      const approved = await bookApproved({ slotStart: '2026-08-24T12:00:00+05:30', slotEnd: '2026-08-24T12:30:00+05:30' });

      await expect(service.markMissed(approved.id, OTHER_FACULTY)).rejects.toThrow(NotFoundError);

      const stillApproved = await repo.findById(approved.id);
      expect(stillApproved!.status).toBe('APPROVED');
    });

    it('throws InvalidTransitionError for a terminal-state appointment (e.g. already CANCELLED)', async () => {
      const approved = await bookApproved({ slotStart: '2026-08-24T13:00:00+05:30', slotEnd: '2026-08-24T13:30:00+05:30' });
      await repo.cancel(approved.id, STUDENT_A);

      await expect(service.markMissed(approved.id, FACULTY)).rejects.toThrow(InvalidTransitionError);
    });

    it('the trigger backstop still applies: a raw UPDATE attempting PENDING -> MISSED directly (bypassing complete()/approve() entirely) is rejected', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T14:00:00+05:30', '2026-08-24T14:30:00+05:30'), reason: 'Never approved before the raw UPDATE',
      });

      await expect(
        pool.query(`UPDATE appointments SET status = 'MISSED' WHERE id = $1`, [row.id])
      ).rejects.toMatchObject({ message: expect.stringContaining('INVALID_TRANSITION') });
    });
  });
});
