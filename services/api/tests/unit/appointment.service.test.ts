import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentRepository, AppointmentRow, BookAppointmentResult } from '../../src/repositories/appointment.repository';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { TimeRange } from '../../src/domain/time-range';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';
import { NotFoundError } from '../../src/errors/not-found.error';
import { InvalidTransitionError } from '../../src/errors/invalid-transition.error';
import { AlreadyProcessedError } from '../../src/errors/already-processed.error';
import { ValidationError } from '../../src/errors/validation.error';

function makeSlot() {
  return { start: new Date('2026-08-20T10:00:00+05:30'), end: new Date('2026-08-20T10:30:00+05:30') };
}

function row(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: '1',
    student_id: '100',
    faculty_id: '200',
    slot: '["2026-08-20T10:00:00+05:30","2026-08-20T10:30:00+05:30")',
    status: 'PENDING',
    reason: 'Doubt in assignment 2',
    client_request_id: null,
    requested_at: '2026-08-13T00:00:00+05:30',
    responded_at: null,
    responded_by: null,
    cancelled_by: null,
    completion_notes: null,
    created_at: '2026-08-13T00:00:00+05:30',
    updated_at: '2026-08-13T00:00:00+05:30',
    ...overrides,
  };
}

function fakeRepo(): jest.Mocked<Pick<AppointmentRepository,
  'bookAppointment' | 'findById' | 'approve' | 'reject' | 'cancel' | 'complete' | 'markMissed'>> {
  return {
    bookAppointment: jest.fn(),
    findById: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    cancel: jest.fn(),
    complete: jest.fn(),
    markMissed: jest.fn(),
  };
}

describe('AppointmentService (unit — mocked AppointmentRepository)', () => {
  describe('requestAppointment', () => {
    it('rejects a valid request and returns the created appointment, flagged as newly created', async () => {
      const repo = fakeRepo();
      const created = row();
      repo.bookAppointment.mockResolvedValueOnce({ row: created, wasNewlyCreated: true } as BookAppointmentResult);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.requestAppointment({
        studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt in assignment 2',
      });

      expect(result).toEqual({ appointment: created, wasNewlyCreated: true });
      expect(repo.bookAppointment).toHaveBeenCalledTimes(1);
      const call = repo.bookAppointment.mock.calls[0][0];
      expect(call.studentId).toBe('100');
      expect(call.facultyId).toBe('200');
      expect(call.reason).toBe('Doubt in assignment 2');
      expect(call.slot).toBeInstanceOf(TimeRange);
    });

    it('rejects with ValidationError before ever calling the repository when the reason is too short', async () => {
      const repo = fakeRepo();
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(
        service.requestAppointment({ studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Hi' })
      ).rejects.toThrow(ValidationError);
      expect(repo.bookAppointment).not.toHaveBeenCalled();
    });

    it('rejects with ValidationError when the reason is missing entirely', async () => {
      const repo = fakeRepo();
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(
        service.requestAppointment({
          studentId: '100', facultyId: '200', slot: makeSlot(), reason: undefined as unknown as string,
        })
      ).rejects.toThrow(ValidationError);
      expect(repo.bookAppointment).not.toHaveBeenCalled();
    });

    it('rejects with ValidationError before ever calling the repository when the reason is too long', async () => {
      const repo = fakeRepo();
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(
        service.requestAppointment({
          studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'x'.repeat(1001),
        })
      ).rejects.toThrow(ValidationError);
      expect(repo.bookAppointment).not.toHaveBeenCalled();
    });

    it('propagates SlotConflictError from the repository unchanged when the slot is already taken', async () => {
      const repo = fakeRepo();
      repo.bookAppointment.mockRejectedValueOnce(new SlotConflictError());
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(
        service.requestAppointment({ studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt in assignment 2' })
      ).rejects.toThrow(SlotConflictError);
    });

    it('returns wasNewlyCreated: false for a duplicate (idempotent replay) request, without creating a second row', async () => {
      const repo = fakeRepo();
      const existing = row({ client_request_id: 'abc-123' });
      repo.bookAppointment.mockResolvedValueOnce({ row: existing, wasNewlyCreated: false } as BookAppointmentResult);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.requestAppointment({
        studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt in assignment 2', clientRequestId: 'abc-123',
      });

      expect(result).toEqual({ appointment: existing, wasNewlyCreated: false });
    });
  });

  describe('approve', () => {
    it('approves a PENDING appointment owned by this faculty member', async () => {
      const repo = fakeRepo();
      const pending = row({ status: 'PENDING' });
      const approved = row({ status: 'APPROVED' });
      repo.findById.mockResolvedValueOnce(pending);
      repo.approve.mockResolvedValueOnce(approved);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.approve('1', '200');

      expect(result).toEqual(approved);
      expect(repo.approve).toHaveBeenCalledWith('1', '200');
    });

    it('throws NotFoundError when the appointment does not exist', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(null);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.approve('999', '200')).rejects.toThrow(NotFoundError);
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the appointment belongs to a different faculty member', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ faculty_id: '999' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.approve('1', '200')).rejects.toThrow(NotFoundError);
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it('is idempotent: approving an already-APPROVED appointment returns it as a no-op, without writing again', async () => {
      const repo = fakeRepo();
      const alreadyApproved = row({ status: 'APPROVED' });
      repo.findById.mockResolvedValueOnce(alreadyApproved);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.approve('1', '200');

      expect(result).toEqual(alreadyApproved);
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it('throws InvalidTransitionError when approving an appointment in a terminal state (e.g. REJECTED)', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'REJECTED' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.approve('1', '200')).rejects.toThrow(InvalidTransitionError);
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it('throws AlreadyProcessedError if the guarded update matches 0 rows despite passing the transition check (lost race)', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'PENDING' }));
      repo.approve.mockResolvedValueOnce(null);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.approve('1', '200')).rejects.toThrow(AlreadyProcessedError);
    });
  });

  describe('reject', () => {
    it('rejects a PENDING appointment owned by this faculty member', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'PENDING' }));
      const rejected = row({ status: 'REJECTED' });
      repo.reject.mockResolvedValueOnce(rejected);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.reject('1', '200');

      expect(result).toEqual(rejected);
    });

    it('throws InvalidTransitionError when rejecting an already-APPROVED appointment', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.reject('1', '200')).rejects.toThrow(InvalidTransitionError);
    });
  });

  describe('cancel', () => {
    it('allows the student who owns the appointment to cancel a PENDING appointment', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'PENDING', student_id: '100' }));
      const cancelled = row({ status: 'CANCELLED' });
      repo.cancel.mockResolvedValueOnce(cancelled);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.cancel('1', '100');

      expect(result).toEqual(cancelled);
      expect(repo.cancel).toHaveBeenCalledWith('1', '100');
    });

    it('allows the faculty member who owns the appointment to cancel an APPROVED appointment', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED', faculty_id: '200' }));
      const cancelled = row({ status: 'CANCELLED' });
      repo.cancel.mockResolvedValueOnce(cancelled);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.cancel('1', '200');

      expect(result).toEqual(cancelled);
    });

    it('throws NotFoundError when the actor is neither the student nor the faculty member on the appointment', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ student_id: '100', faculty_id: '200' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.cancel('1', '999')).rejects.toThrow(NotFoundError);
      expect(repo.cancel).not.toHaveBeenCalled();
    });

    it('is idempotent: cancelling an already-CANCELLED appointment returns it as a no-op', async () => {
      const repo = fakeRepo();
      const alreadyCancelled = row({ status: 'CANCELLED', student_id: '100' });
      repo.findById.mockResolvedValueOnce(alreadyCancelled);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.cancel('1', '100');

      expect(result).toEqual(alreadyCancelled);
      expect(repo.cancel).not.toHaveBeenCalled();
    });

    it('throws InvalidTransitionError when cancelling an appointment in a terminal state (e.g. COMPLETED)', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'COMPLETED', student_id: '100' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.cancel('1', '100')).rejects.toThrow(InvalidTransitionError);
      expect(repo.cancel).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('completes an APPROVED appointment owned by this faculty member, passing optional notes through', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED' }));
      const completed = row({ status: 'COMPLETED', completion_notes: 'Discussed the project scope' });
      repo.complete.mockResolvedValueOnce(completed);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.complete('1', '200', 'Discussed the project scope');

      expect(result).toEqual(completed);
      expect(repo.complete).toHaveBeenCalledWith('1', '200', 'Discussed the project scope');
    });

    it('throws NotFoundError when the appointment does not exist', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(null);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.complete('999', '200')).rejects.toThrow(NotFoundError);
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the appointment belongs to a different faculty member — never a silent null', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED', faculty_id: '999' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.complete('1', '200')).rejects.toThrow(NotFoundError);
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('is idempotent: completing an already-COMPLETED appointment returns it as a no-op, without writing again', async () => {
      const repo = fakeRepo();
      const alreadyCompleted = row({ status: 'COMPLETED' });
      repo.findById.mockResolvedValueOnce(alreadyCompleted);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.complete('1', '200');

      expect(result).toEqual(alreadyCompleted);
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('throws InvalidTransitionError when completing a still-PENDING appointment (must be APPROVED first)', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'PENDING' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.complete('1', '200')).rejects.toThrow(InvalidTransitionError);
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('throws AlreadyProcessedError if the guarded update matches 0 rows despite passing the transition check (lost race)', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED' }));
      repo.complete.mockResolvedValueOnce(null);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.complete('1', '200')).rejects.toThrow(AlreadyProcessedError);
    });
  });

  describe('markMissed', () => {
    it('marks an APPROVED appointment owned by this faculty member as MISSED', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED' }));
      const missed = row({ status: 'MISSED' });
      repo.markMissed.mockResolvedValueOnce(missed);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.markMissed('1', '200');

      expect(result).toEqual(missed);
      expect(repo.markMissed).toHaveBeenCalledWith('1', '200');
    });

    it('throws NotFoundError when the appointment belongs to a different faculty member — never a silent null', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED', faculty_id: '999' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.markMissed('1', '200')).rejects.toThrow(NotFoundError);
      expect(repo.markMissed).not.toHaveBeenCalled();
    });

    it('is idempotent: marking an already-MISSED appointment as missed again returns it as a no-op', async () => {
      const repo = fakeRepo();
      const alreadyMissed = row({ status: 'MISSED' });
      repo.findById.mockResolvedValueOnce(alreadyMissed);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      const result = await service.markMissed('1', '200');

      expect(result).toEqual(alreadyMissed);
      expect(repo.markMissed).not.toHaveBeenCalled();
    });

    it('throws InvalidTransitionError when marking a terminal-state appointment (e.g. CANCELLED) as missed', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'CANCELLED' }));
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.markMissed('1', '200')).rejects.toThrow(InvalidTransitionError);
      expect(repo.markMissed).not.toHaveBeenCalled();
    });

    it('throws AlreadyProcessedError if the guarded update matches 0 rows despite passing the transition check (lost race)', async () => {
      const repo = fakeRepo();
      repo.findById.mockResolvedValueOnce(row({ status: 'APPROVED' }));
      repo.markMissed.mockResolvedValueOnce(null);
      const service = new AppointmentService(repo as unknown as AppointmentRepository, new AppointmentStateMachine());

      await expect(service.markMissed('1', '200')).rejects.toThrow(AlreadyProcessedError);
    });
  });
});
