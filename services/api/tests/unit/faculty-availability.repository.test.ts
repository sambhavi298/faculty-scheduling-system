import {
  FacultyAvailabilityRepository,
  FacultyAvailabilityWindowRow,
  FacultyScheduleExceptionRow,
} from '../../src/repositories/faculty-availability.repository';
import { Queryable } from '../../src/db/queryable';
import { AvailabilityOverlapError } from '../../src/errors/availability-overlap.error';

function fakeDb(): jest.Mocked<Queryable> {
  return { query: jest.fn() };
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

describe('FacultyAvailabilityRepository (unit — mocked Queryable boundary)', () => {
  describe('facultyExists', () => {
    it('returns true when a row comes back', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '200' }], rowCount: 1 });
      const repo = new FacultyAvailabilityRepository(db);

      expect(await repo.facultyExists('200')).toBe(true);
      expect(db.query.mock.calls[0][1]).toEqual(['200']);
    });

    it('returns false when no row comes back', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new FacultyAvailabilityRepository(db);

      expect(await repo.facultyExists('999')).toBe(false);
    });
  });

  describe('replaceAvailability', () => {
    it('sends the faculty id and a snake_case JSON-stringified windows array (matching jsonb_to_recordset\'s column list, NOT the camelCase AvailabilityWindowInput shape) as the two parameters', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [windowRow()], rowCount: 1 });
      const repo = new FacultyAvailabilityRepository(db);
      const windows = [{ dayOfWeek: 2, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01', effectiveUntil: null }];

      await repo.replaceAvailability('200', windows);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/WITH deactivated AS/);
      expect(sql).toMatch(/UPDATE faculty_availability/);
      expect(sql).toMatch(/SET is_active = FALSE/);
      expect(sql).toMatch(/INSERT INTO faculty_availability/);
      expect(sql).toMatch(/jsonb_to_recordset/);
      expect(params![0]).toBe('200');
      expect(JSON.parse(params![1] as string)).toEqual([
        { day_of_week: 2, start_time: '09:00', end_time: '17:00', effective_from: '2026-08-01', effective_until: null },
      ]);
    });

    it('defaults effective_until to null when the input omits effectiveUntil entirely', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [windowRow()], rowCount: 1 });
      const repo = new FacultyAvailabilityRepository(db);

      await repo.replaceAvailability('200', [{ dayOfWeek: 2, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' }]);

      const params = db.query.mock.calls[0][1] as unknown[];
      expect(JSON.parse(params[1] as string)[0].effective_until).toBeNull();
    });

    it('normalizes a Date-typed effective_from/effective_until in the driver response back to YYYY-MM-DD strings', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({
        rows: [windowRow({ effective_from: new Date('2026-08-01T00:00:00.000Z') as unknown as string, effective_until: new Date('2026-12-31T00:00:00.000Z') as unknown as string })],
        rowCount: 1,
      });
      const repo = new FacultyAvailabilityRepository(db);

      const [result] = await repo.replaceAvailability('200', []);

      expect(result.effective_from).toBe('2026-08-01');
      expect(result.effective_until).toBe('2026-12-31');
    });

    it('returns the newly inserted rows', async () => {
      const db = fakeDb();
      const rows = [windowRow(), windowRow({ id: '2', day_of_week: 3 })];
      db.query.mockResolvedValueOnce({ rows, rowCount: 2 });
      const repo = new FacultyAvailabilityRepository(db);

      expect(await repo.replaceAvailability('200', [])).toEqual(rows);
    });

    it('translates a 23P01 exclusion-constraint violation into AvailabilityOverlapError', async () => {
      const db = fakeDb();
      db.query.mockRejectedValueOnce({ code: '23P01' });
      const repo = new FacultyAvailabilityRepository(db);

      await expect(repo.replaceAvailability('200', [])).rejects.toThrow(AvailabilityOverlapError);
    });

    it('rethrows any other error unchanged', async () => {
      const db = fakeDb();
      const dbError = new Error('connection lost');
      db.query.mockRejectedValueOnce(dbError);
      const repo = new FacultyAvailabilityRepository(db);

      await expect(repo.replaceAvailability('200', [])).rejects.toBe(dbError);
    });
  });

  describe('listActiveWindows', () => {
    it('filters to is_active and orders by day_of_week, start_time', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new FacultyAvailabilityRepository(db);

      await repo.listActiveWindows('200');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/WHERE faculty_id = \$1 AND is_active/);
      expect(sql).toMatch(/ORDER BY day_of_week, start_time/);
      expect(params).toEqual(['200']);
    });

    it('returns the rows unchanged when effective_until is already null', async () => {
      const db = fakeDb();
      const rows = [windowRow()];
      db.query.mockResolvedValueOnce({ rows, rowCount: 1 });
      const repo = new FacultyAvailabilityRepository(db);

      expect(await repo.listActiveWindows('200')).toEqual(rows);
    });

    it('normalizes a Date-typed effective_until to a YYYY-MM-DD string', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({
        rows: [windowRow({ effective_until: new Date('2026-12-31T00:00:00.000Z') as unknown as string })],
        rowCount: 1,
      });
      const repo = new FacultyAvailabilityRepository(db);

      const [result] = await repo.listActiveWindows('200');
      expect(result.effective_until).toBe('2026-12-31');
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
        reason: 'Conference',
        created_at: '2026-08-01T00:00:00.000Z',
        ...overrides,
      };
    }

    it('inserts with the six positional columns and returns the created row', async () => {
      const db = fakeDb();
      const row = exceptionRow();
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new FacultyAvailabilityRepository(db);

      const result = await repo.addException('200', { date: '2026-08-31', startTime: null, endTime: null, type: 'LEAVE', reason: 'Conference' });

      expect(result).toEqual(row);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO faculty_schedule_exceptions/);
      expect(params).toEqual(['200', '2026-08-31', null, null, 'LEAVE', 'Conference']);
    });

    it('defaults startTime/endTime/reason to null when omitted', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [exceptionRow()], rowCount: 1 });
      const repo = new FacultyAvailabilityRepository(db);

      await repo.addException('200', { date: '2026-08-31', type: 'LEAVE' });

      expect(db.query.mock.calls[0][1]).toEqual(['200', '2026-08-31', null, null, 'LEAVE', null]);
    });
  });
});
