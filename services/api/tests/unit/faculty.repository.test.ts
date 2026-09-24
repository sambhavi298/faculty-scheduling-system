import { FacultyRepository } from '../../src/repositories/faculty.repository';
import { Queryable } from '../../src/db/queryable';

function fakeDb(): jest.Mocked<Queryable> {
  return { query: jest.fn() };
}

describe('FacultyRepository (unit — mocked Queryable boundary)', () => {
  describe('listFaculty', () => {
    it('passes null through when no search term is given, and returns all rows', async () => {
      const db = fakeDb();
      const rows = [
        { id: '200', name: 'Prof. Rao', department: 'Computer Science' },
        { id: '201', name: 'Prof. Iyer', department: 'Computer Science' },
      ];
      db.query.mockResolvedValueOnce({ rows, rowCount: 2 });
      const repo = new FacultyRepository(db);

      const result = await repo.listFaculty(null);

      expect(result).toEqual(rows);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/FROM faculty f/);
      expect(sql).toMatch(/JOIN users u ON u\.id = f\.id/);
      expect(sql).toMatch(/JOIN departments d ON d\.id = f\.department_id/);
      expect(sql).toMatch(/ILIKE/);
      expect(params).toEqual([null]);
    });

    it('passes a trimmed search term through as the sole parameter', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new FacultyRepository(db);

      await repo.listFaculty('rao');

      expect(db.query.mock.calls[0][1]).toEqual(['rao']);
    });

    it('returns an empty array when nothing matches', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new FacultyRepository(db);

      expect(await repo.listFaculty('nobody-matches-this')).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns the row when the faculty id exists', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '200' }], rowCount: 1 });
      const repo = new FacultyRepository(db);

      const result = await repo.findById('200');

      expect(result).toEqual({ id: '200' });
      expect(db.query.mock.calls[0][1]).toEqual(['200']);
    });

    it('returns null when the faculty id does not exist', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new FacultyRepository(db);

      expect(await repo.findById('999')).toBeNull();
    });
  });

  describe('getAvailableSlots', () => {
    it('calls get_available_slots() with (facultyId, date, slotMinutes) and returns its rows unchanged', async () => {
      const rows = [
        { slot_start: new Date('2026-08-25T03:30:00.000Z'), slot_end: new Date('2026-08-25T04:00:00.000Z') },
      ];
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows, rowCount: 1 });
      const repo = new FacultyRepository(db);

      const result = await repo.getAvailableSlots('200', '2026-08-25', 30);

      expect(result).toEqual(rows);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/get_available_slots\(\$1, \$2, \$3\)/);
      expect(params).toEqual(['200', '2026-08-25', 30]);
    });

    it('returns an empty array when the faculty member has no open slots that day', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new FacultyRepository(db);

      expect(await repo.getAvailableSlots('200', '2026-08-31', 30)).toEqual([]);
    });
  });
});
