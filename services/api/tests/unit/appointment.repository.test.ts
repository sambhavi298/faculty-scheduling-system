import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';
import { Queryable } from '../../src/db/queryable';

function makeSlot() {
  return TimeRange.create(new Date('2026-08-20T10:00:00+05:30'), new Date('2026-08-20T10:30:00+05:30'));
}

function fakeDb(): jest.Mocked<Queryable> {
  return { query: jest.fn() };
}

describe('AppointmentRepository (unit — mocked Queryable boundary)', () => {
  describe('bookAppointment', () => {
    it('calls book_appointment() with positional parameters and returns the created row, flagged as newly created', async () => {
      const db = fakeDb();
      const row = { id: '1', status: 'PENDING' };
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const repo = new AppointmentRepository(db);
      const result = await repo.bookAppointment({
        studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt in assignment 2',
      });

      expect(result).toEqual({ row, wasNewlyCreated: true });
      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/book_appointment\(\$1,\$2,\$3,\$4,\$5\)/);
      expect(params).toEqual(['100', '200', makeSlot().toPgRangeLiteral(), 'Doubt in assignment 2', null]);
    });

    it('passes clientRequestId through as the 5th parameter when provided', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      await repo.bookAppointment({
        studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt in assignment 2',
        clientRequestId: 'abc-123',
      });

      expect(db.query.mock.calls[0][1]).toEqual(['100', '200', makeSlot().toPgRangeLiteral(), 'Doubt in assignment 2', 'abc-123']);
    });

    it('maps a Postgres exclusion_violation (23P01) to SlotConflictError', async () => {
      const db = fakeDb();
      db.query.mockRejectedValueOnce({ code: '23P01', message: 'conflicting key value' });
      const repo = new AppointmentRepository(db);

      await expect(
        repo.bookAppointment({ studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt' })
      ).rejects.toThrow(SlotConflictError);
    });

    it('on a duplicate client_request_id (23505 on appointments_idem_uq), returns the ORIGINAL row flagged as NOT newly created', async () => {
      const db = fakeDb();
      const existingRow = { id: '1', status: 'PENDING', client_request_id: 'abc-123' };
      db.query
        .mockRejectedValueOnce({ code: '23505', constraint: 'appointments_idem_uq' })
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 });

      const repo = new AppointmentRepository(db);
      const result = await repo.bookAppointment({
        studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt', clientRequestId: 'abc-123',
      });

      expect(result).toEqual({ row: existingRow, wasNewlyCreated: false });
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[1][0]).toMatch(/SELECT \* FROM appointments/);
      expect(db.query.mock.calls[1][1]).toEqual(['100', 'abc-123']);
    });

    it('on a duplicate client_request_id that fails with a deadlock (40P01) instead of 23P01/23505, still returns the ORIGINAL row flagged as NOT newly created — a genuinely concurrent duplicate request must not surface as a hard failure just because it resolved via a different SQLSTATE', async () => {
      const db = fakeDb();
      const existingRow = { id: '1', status: 'PENDING', client_request_id: 'xyz-789' };
      db.query
        .mockRejectedValueOnce({ code: '40P01', message: 'deadlock detected' })
        .mockResolvedValueOnce({ rows: [existingRow], rowCount: 1 });

      const repo = new AppointmentRepository(db);
      const result = await repo.bookAppointment({
        studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt', clientRequestId: 'xyz-789',
      });

      expect(result).toEqual({ row: existingRow, wasNewlyCreated: false });
    });

    it('maps a Postgres deadlock (40P01) to SlotConflictError when there is no clientRequestId to check for an idempotent replay — the other legitimate outcome of two concurrent inserts racing for the same GiST index page, discovered under repeated real-concurrency testing (see double-booking.test.ts)', async () => {
      const db = fakeDb();
      db.query.mockRejectedValueOnce({ code: '40P01', message: 'deadlock detected' });
      const repo = new AppointmentRepository(db);

      await expect(
        repo.bookAppointment({ studentId: '100', facultyId: '200', slot: makeSlot(), reason: 'Doubt' })
      ).rejects.toThrow(SlotConflictError);
    });

    it('rethrows an unrecognized database error unchanged (never swallows an unknown failure)', async () => {
      const db = fakeDb();
      const dbError = { code: '23503', message: 'foreign key violation' };
      db.query.mockRejectedValueOnce(dbError);
      const repo = new AppointmentRepository(db);

      await expect(
        repo.bookAppointment({ studentId: '999', facultyId: '200', slot: makeSlot(), reason: 'Doubt' })
      ).rejects.toBe(dbError);
    });
  });

  describe('guarded status transitions (approve/reject/cancel/complete/markMissed)', () => {
    it('approve() returns the updated row when exactly one row matches the guard', async () => {
      const db = fakeDb();
      const row = { id: '1', status: 'APPROVED' };
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      const result = await repo.approve('1', '200');

      expect(result).toEqual(row);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/UPDATE appointments/);
      expect(sql).toMatch(/status = 'PENDING'/);
      expect(params).toEqual(['1', '200']);
    });

    it('approve() returns null (not an exception) when zero rows match — caller decides why', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AppointmentRepository(db);

      const result = await repo.approve('1', '200');

      expect(result).toBeNull();
    });

    it('reject() targets REJECTED and guards on PENDING + faculty ownership', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1', status: 'REJECTED' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      await repo.reject('1', '200');

      const sql = db.query.mock.calls[0][0];
      expect(sql).toMatch(/'REJECTED'/);
      expect(sql).toMatch(/status = 'PENDING'/);
    });

    it('cancel() guards on (student OR faculty) ownership and PENDING/APPROVED', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1', status: 'CANCELLED' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      await repo.cancel('1', '100');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/student_id = \$2 OR faculty_id = \$2/);
      expect(sql).toMatch(/status IN \('PENDING','APPROVED'\)/);
      expect(params).toEqual(['1', '100']);
    });

    it('complete() guards on APPROVED + faculty ownership and accepts optional notes', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1', status: 'COMPLETED' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      await repo.complete('1', '200', 'Discussed thesis outline');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/status = 'APPROVED'/);
      expect(params).toEqual(['1', '200', 'Discussed thesis outline']);
    });

    it('markMissed() guards on APPROVED + faculty ownership', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1', status: 'MISSED' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      await repo.markMissed('1', '200');

      const sql = db.query.mock.calls[0][0];
      expect(sql).toMatch(/'MISSED'/);
    });
  });

  describe('reads', () => {
    it('findById() returns the row when found', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      expect(await repo.findById('1')).toEqual({ id: '1' });
    });

    it('findById() returns null when not found', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AppointmentRepository(db);

      expect(await repo.findById('999')).toBeNull();
    });

    it('listForStudent() returns all matching rows', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }], rowCount: 2 });
      const repo = new AppointmentRepository(db);

      const rows = await repo.listForStudent('100');
      expect(rows).toHaveLength(2);
      expect(db.query.mock.calls[0][1]).toEqual(['100']);
    });

    it('listPendingForFaculty() returns all matching rows', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: '1' }], rowCount: 1 });
      const repo = new AppointmentRepository(db);

      const rows = await repo.listPendingForFaculty('200');
      expect(rows).toHaveLength(1);
      expect(db.query.mock.calls[0][1]).toEqual(['200']);
    });
  });
});
