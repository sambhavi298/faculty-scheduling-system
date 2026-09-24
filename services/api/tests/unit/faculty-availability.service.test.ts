import { FacultyAvailabilityService } from '../../src/services/faculty-availability.service';
import {
  FacultyAvailabilityRepository,
  FacultyAvailabilityWindowRow,
  FacultyScheduleExceptionRow,
} from '../../src/repositories/faculty-availability.repository';
import { ValidationError } from '../../src/errors/validation.error';
import { NotFoundError } from '../../src/errors/not-found.error';

function fakeRepo(): jest.Mocked<Pick<FacultyAvailabilityRepository, 'facultyExists' | 'replaceAvailability' | 'listActiveWindows' | 'addException'>> {
  return {
    facultyExists: jest.fn(),
    replaceAvailability: jest.fn(),
    listActiveWindows: jest.fn(),
    addException: jest.fn(),
  };
}

function windowRow(overrides: Partial<FacultyAvailabilityWindowRow> = {}): FacultyAvailabilityWindowRow {
  return {
    id: '1',
    faculty_id: '200',
    day_of_week: 2,
    start_time: '09:00:00',
    end_time: '17:00:00',
    effective_from: '2026-08-01',
    effective_until: null,
    is_active: true,
    ...overrides,
  };
}

function validWindow(overrides: Record<string, unknown> = {}) {
  return { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01', ...overrides };
}

describe('FacultyAvailabilityService (unit — mocked FacultyAvailabilityRepository)', () => {
  function fakeService() {
    const repo = fakeRepo();
    const service = new FacultyAvailabilityService(repo as unknown as FacultyAvailabilityRepository);
    return { repo, service };
  }

  describe('listActiveWindows', () => {
    it('passes through the repository result unchanged', async () => {
      const { repo, service } = fakeService();
      const rows = [windowRow(), windowRow({ id: '2', day_of_week: 4 })];
      repo.listActiveWindows.mockResolvedValueOnce(rows);

      const result = await service.listActiveWindows('200');

      expect(result).toEqual(rows);
      expect(repo.listActiveWindows).toHaveBeenCalledWith('200');
    });
  });

  describe('replaceAvailability', () => {
    it('throws NotFoundError when the faculty id does not exist, without ever calling replaceAvailability', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(false);

      await expect(service.replaceAvailability('999', [validWindow()])).rejects.toThrow(NotFoundError);
      expect(repo.replaceAvailability).not.toHaveBeenCalled();
    });

    it('rejects a non-array body', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.replaceAvailability('200', { not: 'an array' })).rejects.toThrow(ValidationError);
    });

    it('accepts an empty array (clears all availability)', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);
      repo.replaceAvailability.mockResolvedValueOnce([]);

      const result = await service.replaceAvailability('200', []);

      expect(result).toEqual([]);
      expect(repo.replaceAvailability).toHaveBeenCalledWith('200', []);
    });

    it('passes through a valid window with all fields normalized', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);
      repo.replaceAvailability.mockResolvedValueOnce([windowRow()]);

      await service.replaceAvailability('200', [validWindow({ effectiveUntil: '2026-12-31' })]);

      expect(repo.replaceAvailability).toHaveBeenCalledWith('200', [
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01', effectiveUntil: '2026-12-31' },
      ]);
    });

    it('defaults effectiveUntil to null when omitted', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);
      repo.replaceAvailability.mockResolvedValueOnce([windowRow()]);

      await service.replaceAvailability('200', [validWindow()]);

      expect(repo.replaceAvailability.mock.calls[0][1][0].effectiveUntil).toBeNull();
    });

    describe('per-window validation', () => {
      async function expectRejects(overrides: Record<string, unknown>) {
        const { repo, service } = fakeService();
        repo.facultyExists.mockResolvedValueOnce(true);
        await expect(service.replaceAvailability('200', [validWindow(overrides)])).rejects.toThrow(ValidationError);
      }

      it('rejects a non-integer dayOfWeek', () => expectRejects({ dayOfWeek: 2.5 }));
      it('rejects a dayOfWeek below 0', () => expectRejects({ dayOfWeek: -1 }));
      it('rejects a dayOfWeek above 6', () => expectRejects({ dayOfWeek: 7 }));
      it('rejects a missing dayOfWeek', () => expectRejects({ dayOfWeek: undefined }));
      it('rejects a missing startTime', () => expectRejects({ startTime: undefined }));
      it('rejects a malformed startTime', () => expectRejects({ startTime: '9am' }));
      it('rejects a missing endTime', () => expectRejects({ endTime: undefined }));
      it('rejects endTime not after startTime (equal)', () => expectRejects({ startTime: '09:00', endTime: '09:00' }));
      it('rejects endTime before startTime', () => expectRejects({ startTime: '17:00', endTime: '09:00' }));
      it('rejects a missing effectiveFrom', () => expectRejects({ effectiveFrom: undefined }));
      it('rejects a malformed effectiveFrom', () => expectRejects({ effectiveFrom: '01-08-2026' }));
      it('rejects a nonexistent calendar date for effectiveFrom (Feb 30)', () => expectRejects({ effectiveFrom: '2026-02-30' }));
      it('rejects an effectiveFrom with an out-of-range month that Date parsing itself reports as invalid (month 00)', () =>
        expectRejects({ effectiveFrom: '2026-00-01' }));
      it('rejects a malformed effectiveUntil', () => expectRejects({ effectiveUntil: 'not-a-date' }));
      it('rejects effectiveUntil before effectiveFrom', () =>
        expectRejects({ effectiveFrom: '2026-08-01', effectiveUntil: '2026-07-01' }));

      it('accepts a time with seconds (HH:MM:SS)', async () => {
        const { repo, service } = fakeService();
        repo.facultyExists.mockResolvedValueOnce(true);
        repo.replaceAvailability.mockResolvedValueOnce([windowRow()]);

        await service.replaceAvailability('200', [validWindow({ startTime: '09:00:00', endTime: '17:00:00' })]);

        expect(repo.replaceAvailability).toHaveBeenCalled();
      });

      it('reports the offending index in the error message for a multi-window submission', async () => {
        const { repo, service } = fakeService();
        repo.facultyExists.mockResolvedValueOnce(true);

        await expect(service.replaceAvailability('200', [validWindow(), validWindow({ dayOfWeek: 9 })])).rejects.toThrow(
          /windows\[1\]/
        );
      });
    });
  });

  describe('addException', () => {
    function exceptionRow(overrides: Partial<FacultyScheduleExceptionRow> = {}): FacultyScheduleExceptionRow {
      return {
        id: '1',
        faculty_id: '200',
        exception_date: '2026-08-31',
        start_time: null,
        end_time: null,
        exception_type: 'LEAVE',
        reason: null,
        created_at: '2026-08-01T00:00:00.000Z',
        ...overrides,
      };
    }

    it('throws NotFoundError when the faculty id does not exist', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(false);

      await expect(service.addException('999', { date: '2026-08-31', type: 'LEAVE' })).rejects.toThrow(NotFoundError);
      expect(repo.addException).not.toHaveBeenCalled();
    });

    it('rejects a missing date', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.addException('200', { type: 'LEAVE' } as any)).rejects.toThrow(ValidationError);
    });

    it('rejects a malformed date', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.addException('200', { date: '31-08-2026', type: 'LEAVE' } as any)).rejects.toThrow(ValidationError);
    });

    it('rejects an invalid type', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.addException('200', { date: '2026-08-31', type: 'VACATION' } as any)).rejects.toThrow(ValidationError);
    });

    it('accepts every declared exception type', async () => {
      for (const type of ['LEAVE', 'MEETING', 'BLOCK', 'EXTRA_AVAILABLE']) {
        const { repo, service } = fakeService();
        repo.facultyExists.mockResolvedValueOnce(true);
        repo.addException.mockResolvedValueOnce(exceptionRow({ exception_type: type }));

        await service.addException('200', { date: '2026-08-31', type });
        expect(repo.addException).toHaveBeenCalled();
      }
    });

    it('rejects startTime without endTime (only one of the pair)', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.addException('200', { date: '2026-08-31', type: 'BLOCK', startTime: '10:00' } as any)).rejects.toThrow(
        ValidationError
      );
    });

    it('rejects endTime without startTime (only one of the pair)', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.addException('200', { date: '2026-08-31', type: 'BLOCK', endTime: '11:00' } as any)).rejects.toThrow(
        ValidationError
      );
    });

    it('rejects endTime not after startTime', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(
        service.addException('200', { date: '2026-08-31', type: 'BLOCK', startTime: '11:00', endTime: '10:00' } as any)
      ).rejects.toThrow(ValidationError);
    });

    it('accepts a whole-day exception with no start/end time', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);
      repo.addException.mockResolvedValueOnce(exceptionRow());

      await service.addException('200', { date: '2026-08-31', type: 'LEAVE' });

      expect(repo.addException).toHaveBeenCalledWith('200', { date: '2026-08-31', startTime: null, endTime: null, type: 'LEAVE', reason: null });
    });

    it('accepts a partial-day exception with both times', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);
      repo.addException.mockResolvedValueOnce(exceptionRow({ start_time: '10:00', end_time: '11:00', exception_type: 'MEETING' }));

      await service.addException('200', { date: '2026-08-25', type: 'MEETING', startTime: '10:00', endTime: '11:00' });

      expect(repo.addException).toHaveBeenCalledWith('200', {
        date: '2026-08-25',
        startTime: '10:00',
        endTime: '11:00',
        type: 'MEETING',
        reason: null,
      });
    });

    it('rejects a non-string reason', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);

      await expect(service.addException('200', { date: '2026-08-31', type: 'LEAVE', reason: 42 } as any)).rejects.toThrow(
        ValidationError
      );
    });

    it('passes a valid reason through', async () => {
      const { repo, service } = fakeService();
      repo.facultyExists.mockResolvedValueOnce(true);
      repo.addException.mockResolvedValueOnce(exceptionRow({ reason: 'Conference' }));

      await service.addException('200', { date: '2026-08-31', type: 'LEAVE', reason: 'Conference' });

      expect(repo.addException).toHaveBeenCalledWith('200', {
        date: '2026-08-31',
        startTime: null,
        endTime: null,
        type: 'LEAVE',
        reason: 'Conference',
      });
    });
  });
});
