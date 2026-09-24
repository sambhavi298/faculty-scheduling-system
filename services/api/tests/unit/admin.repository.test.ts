import { AdminRepository } from '../../src/repositories/admin.repository';
import { Queryable } from '../../src/db/queryable';
import { ValidationError } from '../../src/errors/validation.error';

function fakeDb(): jest.Mocked<Queryable> {
  return { query: jest.fn() };
}

describe('AdminRepository (unit — mocked Queryable boundary)', () => {
  describe('runWrite error translation (exercised via createDepartment)', () => {
    it('translates a 23503 foreign-key violation into ValidationError', async () => {
      const db = fakeDb();
      db.query.mockRejectedValueOnce({ code: '23503' });
      const repo = new AdminRepository(db);

      await expect(repo.createDepartment('CS', 'CSE')).rejects.toThrow(ValidationError);
    });

    it('translates a 23505 unique violation into ValidationError', async () => {
      const db = fakeDb();
      db.query.mockRejectedValueOnce({ code: '23505' });
      const repo = new AdminRepository(db);

      await expect(repo.createDepartment('CS', 'CSE')).rejects.toThrow(ValidationError);
    });

    it('rethrows any other error unchanged', async () => {
      const db = fakeDb();
      const dbError = new Error('connection lost');
      db.query.mockRejectedValueOnce(dbError);
      const repo = new AdminRepository(db);

      await expect(repo.createDepartment('CS', 'CSE')).rejects.toBe(dbError);
    });
  });

  describe('Departments', () => {
    it('listDepartments orders by name', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.listDepartments();
      expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY name/);
    });

    it('createDepartment inserts with (name, code) and returns the created row', async () => {
      const db = fakeDb();
      const row = { id: 1, name: 'Computer Science', code: 'CSE' };
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AdminRepository(db);

      const result = await repo.createDepartment('Computer Science', 'CSE');

      expect(result).toEqual(row);
      expect(db.query.mock.calls[0][1]).toEqual(['Computer Science', 'CSE']);
    });

    it('updateDepartment uses COALESCE so undefined fields keep their existing value, and returns null when no row matched', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      const result = await repo.updateDepartment(999, undefined, undefined);

      expect(result).toBeNull();
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/COALESCE\(\$2, name\)/);
      expect(params).toEqual([999, null, null]);
    });
  });

  describe('Batches', () => {
    it('listBatches passes a null departmentId filter when none is given', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.listBatches();
      expect(db.query.mock.calls[0][1]).toEqual([null]);
    });

    it('listBatches filters by a given departmentId', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.listBatches(1);
      expect(db.query.mock.calls[0][1]).toEqual([1]);
    });

    it('createBatch inserts (departmentId, name, academicYear)', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      const repo = new AdminRepository(db);

      await repo.createBatch(1, 'CSE Batch 2', '2026-2027');
      expect(db.query.mock.calls[0][1]).toEqual([1, 'CSE Batch 2', '2026-2027']);
    });
  });

  describe('Faculty', () => {
    it('createFaculty runs a single atomic statement creating both the users row and the faculty row', async () => {
      const db = fakeDb();
      const row = { id: '210', email: 'new.faculty@example.edu', full_name: 'New Faculty', phone: null, department_id: 1, staff_code: 'CSE-F10', office_location: null };
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AdminRepository(db);

      const result = await repo.createFaculty({
        email: 'new.faculty@example.edu',
        passwordHash: 'hashed',
        fullName: 'New Faculty',
        phone: null,
        departmentId: 1,
        staffCode: 'CSE-F10',
        officeLocation: null,
      });

      expect(result).toEqual(row);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/WITH new_user AS/);
      expect(sql).toMatch(/INSERT INTO users/);
      expect(sql).toMatch(/INSERT INTO faculty/);
      expect(params).toEqual(['new.faculty@example.edu', 'hashed', 'New Faculty', null, 1, 'CSE-F10', null]);
    });

    it('updateFaculty scopes the users UPDATE to role = FACULTY and returns null when no row matched', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      const result = await repo.updateFaculty('999', {});
      expect(result).toBeNull();
      expect(db.query.mock.calls[0][0]).toMatch(/AND role = 'FACULTY'/);
    });
  });

  describe('Students', () => {
    it('createStudent runs a single atomic statement creating both the users row and the students row', async () => {
      const db = fakeDb();
      const row = { id: '110', email: 'new.student@example.edu', full_name: 'New Student', phone: null, batch_id: 1, roll_number: 'CSE2026-999' };
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new AdminRepository(db);

      const result = await repo.createStudent({
        email: 'new.student@example.edu',
        passwordHash: 'hashed',
        fullName: 'New Student',
        phone: null,
        batchId: 1,
        rollNumber: 'CSE2026-999',
      });

      expect(result).toEqual(row);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/WITH new_user AS/);
      expect(sql).toMatch(/INSERT INTO students/);
      expect(params).toEqual(['new.student@example.edu', 'hashed', 'New Student', null, 1, 'CSE2026-999']);
    });

    it('updateStudent scopes the users UPDATE to role = STUDENT and returns null when no row matched', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      const result = await repo.updateStudent('999', {});
      expect(result).toBeNull();
      expect(db.query.mock.calls[0][0]).toMatch(/AND role = 'STUDENT'/);
    });
  });

  describe('listAppointments (read-only)', () => {
    it('passes status/facultyId/studentId filters and limit/offset through as positional parameters', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.listAppointments({ status: 'PENDING', facultyId: '200', studentId: '100' }, 25, 0);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/FROM appointments a/);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
      expect(params).toEqual(['PENDING', '200', '100', 25, 0]);
    });
  });

  describe('listAuditLog (read-only)', () => {
    it('passes entityType/entityId filters and limit/offset through', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.listAuditLog({ entityType: 'appointment', entityId: '5000' }, 10, 0);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/FROM audit_log/);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
      expect(params).toEqual(['appointment', '5000', 10, 0]);
    });
  });

  describe('Dashboard & reporting', () => {
    it('getCounts issues a single aggregate query', async () => {
      const db = fakeDb();
      const counts = {
        total_students: 2, total_faculty: 2, total_departments: 1,
        pending_appointments: 0, approved_appointments: 0, completed_appointments: 0,
      };
      db.query.mockResolvedValueOnce({ rows: [counts], rowCount: 1 });
      const repo = new AdminRepository(db);

      expect(await repo.getCounts()).toEqual(counts);
    });

    it('refreshFacultyStats issues REFRESH MATERIALIZED VIEW CONCURRENTLY', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.refreshFacultyStats();
      expect(db.query.mock.calls[0][0]).toMatch(/REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats/);
    });

    it('listFacultyStats orders by full_name', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.listFacultyStats();
      expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY full_name/);
    });

    it('getWorkloadReport uses RANK() OVER and a running SUM() OVER window function (Level 5 Section 6)', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new AdminRepository(db);

      await repo.getWorkloadReport();
      const sql = db.query.mock.calls[0][0];
      expect(sql).toMatch(/RANK\(\) OVER \(PARTITION BY week_start/);
      expect(sql).toMatch(/SUM\(appointments_that_week\) OVER/);
      expect(sql).toMatch(/ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/);
    });
  });
});
