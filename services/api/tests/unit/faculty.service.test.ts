import { FacultyService } from '../../src/services/faculty.service';
import { FacultyRepository, FacultyDirectoryRow, AvailableSlotRow } from '../../src/repositories/faculty.repository';
import { ValidationError } from '../../src/errors/validation.error';
import { NotFoundError } from '../../src/errors/not-found.error';

function fakeRepo(): jest.Mocked<Pick<FacultyRepository, 'listFaculty' | 'findById' | 'getAvailableSlots'>> {
  return {
    listFaculty: jest.fn(),
    findById: jest.fn(),
    getAvailableSlots: jest.fn(),
  };
}

function directoryRow(overrides: Partial<FacultyDirectoryRow> = {}): FacultyDirectoryRow {
  return { id: '200', name: 'Prof. Rao', department: 'Computer Science', ...overrides };
}

describe('FacultyService (unit — mocked FacultyRepository)', () => {
  describe('listFaculty', () => {
    it('passes undefined search through as null, and adds designation: null to every row', async () => {
      const repo = fakeRepo();
      repo.listFaculty.mockResolvedValueOnce([directoryRow()]);
      const service = new FacultyService(repo as unknown as FacultyRepository);

      const result = await service.listFaculty();

      expect(repo.listFaculty).toHaveBeenCalledWith(null);
      expect(result).toEqual([{ id: '200', name: 'Prof. Rao', department: 'Computer Science', designation: null }]);
    });

    it('trims a search term before passing it to the repository', async () => {
      const repo = fakeRepo();
      repo.listFaculty.mockResolvedValueOnce([]);
      const service = new FacultyService(repo as unknown as FacultyRepository);

      await service.listFaculty('  rao  ');

      expect(repo.listFaculty).toHaveBeenCalledWith('rao');
    });

    it('treats a whitespace-only search term as no search at all (passes null)', async () => {
      const repo = fakeRepo();
      repo.listFaculty.mockResolvedValueOnce([]);
      const service = new FacultyService(repo as unknown as FacultyRepository);

      await service.listFaculty('   ');

      expect(repo.listFaculty).toHaveBeenCalledWith(null);
    });

    it('returns an empty array when the repository finds nothing', async () => {
      const repo = fakeRepo();
      repo.listFaculty.mockResolvedValueOnce([]);
      const service = new FacultyService(repo as unknown as FacultyRepository);

      expect(await service.listFaculty('nobody')).toEqual([]);
    });
  });

  describe('getAvailability', () => {
    function fakeService() {
      const repo = fakeRepo();
      const service = new FacultyService(repo as unknown as FacultyRepository);
      return { repo, service };
    }

    it('rejects a non-numeric faculty id without ever querying the database', async () => {
      const { repo, service } = fakeService();

      await expect(service.getAvailability('not-a-number', '2026-08-25')).rejects.toThrow(ValidationError);

      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('rejects a missing date', async () => {
      const { repo, service } = fakeService();

      await expect(service.getAvailability('200', '')).rejects.toThrow(ValidationError);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('rejects a malformed date string', async () => {
      const { service } = fakeService();
      await expect(service.getAvailability('200', '25-08-2026')).rejects.toThrow(ValidationError);
    });

    it('rejects a syntactically-shaped but nonexistent calendar date (e.g. Feb 30)', async () => {
      const { service } = fakeService();
      await expect(service.getAvailability('200', '2026-02-30')).rejects.toThrow(ValidationError);
    });

    it('rejects a date with an out-of-range month that Date parsing itself reports as invalid (e.g. month 00)', async () => {
      // Distinct from the Feb-30 case above: '2026-02-30' parses to a valid
      // (rolled-over) Date object that the round-trip-format check then
      // rejects; '2026-00-01' fails to parse into a valid Date at all
      // (Date.getTime() is NaN), exercising the earlier isNaN guard in
      // isValidCalendarDate() specifically.
      const { service } = fakeService();
      await expect(service.getAvailability('200', '2026-00-01')).rejects.toThrow(ValidationError);
    });

    it('rejects a non-positive slotMinutes', async () => {
      const { service } = fakeService();
      await expect(service.getAvailability('200', '2026-08-25', 0)).rejects.toThrow(ValidationError);
      await expect(service.getAvailability('200', '2026-08-25', -15)).rejects.toThrow(ValidationError);
    });

    it('rejects a non-integer slotMinutes', async () => {
      const { service } = fakeService();
      await expect(service.getAvailability('200', '2026-08-25', 15.5)).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when the faculty id is well-formed but does not exist, without calling getAvailableSlots', async () => {
      const { repo, service } = fakeService();
      repo.findById.mockResolvedValueOnce(null);

      await expect(service.getAvailability('999', '2026-08-25')).rejects.toThrow(NotFoundError);

      expect(repo.getAvailableSlots).not.toHaveBeenCalled();
    });

    it('defaults slotMinutes to 30 when not provided', async () => {
      const { repo, service } = fakeService();
      repo.findById.mockResolvedValueOnce({ id: '200' });
      repo.getAvailableSlots.mockResolvedValueOnce([]);

      await service.getAvailability('200', '2026-08-25');

      expect(repo.getAvailableSlots).toHaveBeenCalledWith('200', '2026-08-25', 30);
    });

    it('passes an explicit slotMinutes through unchanged', async () => {
      const { repo, service } = fakeService();
      repo.findById.mockResolvedValueOnce({ id: '200' });
      repo.getAvailableSlots.mockResolvedValueOnce([]);

      await service.getAvailability('200', '2026-08-25', 15);

      expect(repo.getAvailableSlots).toHaveBeenCalledWith('200', '2026-08-25', 15);
    });

    it('converts the repository\'s Date objects into ISO strings', async () => {
      const { repo, service } = fakeService();
      repo.findById.mockResolvedValueOnce({ id: '200' });
      const rows: AvailableSlotRow[] = [
        { slot_start: new Date('2026-08-25T03:30:00.000Z'), slot_end: new Date('2026-08-25T04:00:00.000Z') },
      ];
      repo.getAvailableSlots.mockResolvedValueOnce(rows);

      const result = await service.getAvailability('200', '2026-08-25');

      expect(result).toEqual([
        { slot_start: '2026-08-25T03:30:00.000Z', slot_end: '2026-08-25T04:00:00.000Z' },
      ]);
    });

    it('returns an empty array when the faculty member has no open slots that day', async () => {
      const { repo, service } = fakeService();
      repo.findById.mockResolvedValueOnce({ id: '200' });
      repo.getAvailableSlots.mockResolvedValueOnce([]);

      expect(await service.getAvailability('200', '2026-08-31')).toEqual([]);
    });
  });
});
