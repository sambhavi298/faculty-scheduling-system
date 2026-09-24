import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AdminRepository } from '../../src/repositories/admin.repository';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';
import { ValidationError } from '../../src/errors/validation.error';

/**
 * Integration tests — exercise AdminRepository against a REAL PostgreSQL
 * instance, same convention as tests/integration/faculty.repository.
 * integration.test.ts.
 *
 * Every department/batch/faculty/student this file creates uses a
 * '...-test'/'ADMTEST...' naming convention and is deleted in afterEach —
 * AdminRepository deliberately has no delete methods of its own (see its own
 * class comment: no soft-delete column exists on this schema), so cleanup
 * here uses plain SQL directly against the test database, which is a normal
 * test-hygiene technique, not a production code path. Deleting the `users`
 * row cascades to its `faculty`/`students` row (ON DELETE CASCADE,
 * migrations/sql/0001).
 */
const FACULTY_RAO = '200';
const STUDENT_A = '100';

describe('AdminRepository (integration — real PostgreSQL)', () => {
  let pool: Pool;
  let repo: AdminRepository;
  let appointmentRepo: AppointmentRepository;

  beforeAll(() => {
    pool = createPool();
    repo = new AdminRepository(pool);
    appointmentRepo = new AppointmentRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM users WHERE email LIKE '%@admin-test.example.edu'`);
    await pool.query(`DELETE FROM batches WHERE name LIKE 'AdminTest%'`);
    await pool.query(`DELETE FROM departments WHERE code LIKE 'ADMTEST%'`);
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  describe('Departments', () => {
    it('creates and lists a real department', async () => {
      const created = await repo.createDepartment('Admin Test Dept', 'ADMTEST1');
      expect(created.id).toBeDefined();

      const all = await repo.listDepartments();
      expect(all.some((d) => d.code === 'ADMTEST1')).toBe(true);
    });

    it('rejects a duplicate department code with ValidationError (real UNIQUE constraint)', async () => {
      await repo.createDepartment('Admin Test Dept', 'ADMTEST1');
      await expect(repo.createDepartment('Another Name', 'ADMTEST1')).rejects.toThrow(ValidationError);
    });

    it('updates a real department, leaving omitted fields unchanged', async () => {
      const created = await repo.createDepartment('Admin Test Dept', 'ADMTEST1');

      const updated = await repo.updateDepartment(created.id, 'Renamed Dept', undefined);

      expect(updated!.name).toBe('Renamed Dept');
      expect(updated!.code).toBe('ADMTEST1');
    });

    it('returns null when updating a nonexistent department', async () => {
      expect(await repo.updateDepartment(999999, 'X', undefined)).toBeNull();
    });
  });

  describe('Batches', () => {
    it('creates a real batch referencing a real department', async () => {
      const dept = await repo.createDepartment('Admin Test Dept', 'ADMTEST1');

      const batch = await repo.createBatch(dept.id, 'AdminTest Batch 1', '2026-2027');

      expect(batch.department_id).toBe(dept.id);
      const listed = await repo.listBatches(dept.id);
      expect(listed).toHaveLength(1);
    });

    it('rejects a batch referencing a nonexistent department with ValidationError (real FK constraint)', async () => {
      await expect(repo.createBatch(999999, 'AdminTest Batch X', '2026-2027')).rejects.toThrow(ValidationError);
    });

    it('updates a real batch, leaving omitted fields unchanged', async () => {
      const dept = await repo.createDepartment('Admin Test Dept', 'ADMTEST1');
      const batch = await repo.createBatch(dept.id, 'AdminTest Batch 1', '2026-2027');

      const updated = await repo.updateBatch(batch.id, 'AdminTest Batch Renamed', undefined);

      expect(updated!.name).toBe('AdminTest Batch Renamed');
      expect(updated!.academic_year).toBe('2026-2027');
    });

    it('returns null when updating a nonexistent batch', async () => {
      expect(await repo.updateBatch(999999, 'X', undefined)).toBeNull();
    });

    it('updates only academicYear, leaving name unchanged', async () => {
      const dept = await repo.createDepartment('Admin Test Dept', 'ADMTEST1');
      const batch = await repo.createBatch(dept.id, 'AdminTest Batch 1', '2026-2027');

      const updated = await repo.updateBatch(batch.id, undefined, '2027-2028');

      expect(updated!.name).toBe('AdminTest Batch 1');
      expect(updated!.academic_year).toBe('2027-2028');
    });
  });

  describe('Faculty', () => {
    it('creates a real faculty member atomically (users + faculty row in one statement)', async () => {
      const created = await repo.createFaculty({
        email: 'new.faculty@admin-test.example.edu',
        passwordHash: 'irrelevant-hash-for-this-test',
        fullName: 'New Faculty',
        phone: null,
        departmentId: 1,
        staffCode: 'ADMTEST-F1',
        officeLocation: null,
      });

      expect(created.email).toBe('new.faculty@admin-test.example.edu');
      const userRow = await pool.query('SELECT role FROM users WHERE id = $1', [created.id]);
      expect(userRow.rows[0].role).toBe('FACULTY');

      const listed = await repo.listFaculty();
      expect(listed.some((f) => f.id === created.id)).toBe(true);
    });

    it('rejects a duplicate email with ValidationError', async () => {
      await repo.createFaculty({
        email: 'dup@admin-test.example.edu', passwordHash: 'x', fullName: 'A', phone: null, departmentId: 1, staffCode: 'ADMTEST-F2', officeLocation: null,
      });

      await expect(
        repo.createFaculty({ email: 'dup@admin-test.example.edu', passwordHash: 'x', fullName: 'B', phone: null, departmentId: 1, staffCode: 'ADMTEST-F3', officeLocation: null })
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a nonexistent departmentId with ValidationError', async () => {
      await expect(
        repo.createFaculty({ email: 'x@admin-test.example.edu', passwordHash: 'x', fullName: 'X', phone: null, departmentId: 999999, staffCode: 'ADMTEST-F4', officeLocation: null })
      ).rejects.toThrow(ValidationError);
    });

    it('updates a real faculty member and leaves the seeded ones untouched', async () => {
      const created = await repo.createFaculty({
        email: 'update.me@admin-test.example.edu', passwordHash: 'x', fullName: 'Original Name', phone: null, departmentId: 1, staffCode: 'ADMTEST-F5', officeLocation: null,
      });

      const updated = await repo.updateFaculty(created.id, { fullName: 'Updated Name' });

      expect(updated!.full_name).toBe('Updated Name');
      const raoStillIntact = await repo.listFaculty();
      expect(raoStillIntact.find((f) => f.id === FACULTY_RAO)?.full_name).toBe('Prof. Rao');
    });
  });

  describe('Students', () => {
    it('creates a real student atomically (users + students row in one statement)', async () => {
      const created = await repo.createStudent({
        email: 'new.student@admin-test.example.edu', passwordHash: 'x', fullName: 'New Student', phone: null, batchId: 1, rollNumber: 'ADMTEST-R1',
      });

      expect(created.email).toBe('new.student@admin-test.example.edu');
      const userRow = await pool.query('SELECT role FROM users WHERE id = $1', [created.id]);
      expect(userRow.rows[0].role).toBe('STUDENT');
    });

    it('rejects a nonexistent batchId with ValidationError', async () => {
      await expect(
        repo.createStudent({ email: 'x@admin-test.example.edu', passwordHash: 'x', fullName: 'X', phone: null, batchId: 999999, rollNumber: 'ADMTEST-R2' })
      ).rejects.toThrow(ValidationError);
    });

    it('lists every real seeded student when no batchId filter is given', async () => {
      const rows = await repo.listStudents();
      expect(rows.some((s) => s.id === STUDENT_A)).toBe(true);
    });

    it('filters listStudents by a real batchId', async () => {
      const rows = await repo.listStudents(1);
      expect(rows.every((s) => s.batch_id === 1)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('updates a real student, leaving omitted fields unchanged', async () => {
      const created = await repo.createStudent({
        email: 'update.me@admin-test.example.edu', passwordHash: 'x', fullName: 'Original Name', phone: null, batchId: 1, rollNumber: 'ADMTEST-R3',
      });

      const updated = await repo.updateStudent(created.id, { fullName: 'Updated Name' });

      expect(updated!.full_name).toBe('Updated Name');
      expect(updated!.roll_number).toBe('ADMTEST-R3');
    });

    it('returns null when updating a nonexistent student', async () => {
      expect(await repo.updateStudent('999999', { fullName: 'X' })).toBeNull();
    });
  });

  describe('Appointments (read-only)', () => {
    it('lists a real booked appointment, joined to real faculty/student names', async () => {
      await appointmentRepo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY_RAO,
        slot: TimeRange.create(new Date('2026-08-25T09:00:00+05:30'), new Date('2026-08-25T09:30:00+05:30')),
        reason: 'Admin repository integration test',
      });

      const rows = await repo.listAppointments({ status: 'PENDING' }, 25, 0);

      expect(rows.length).toBeGreaterThan(0);
      const row = rows[0] as any;
      expect(row.faculty_name).toBe('Prof. Rao');
      expect(row.student_name).toBe('Alice Student');
    });

    it('filters by facultyId', async () => {
      await appointmentRepo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY_RAO,
        slot: TimeRange.create(new Date('2026-08-25T09:00:00+05:30'), new Date('2026-08-25T09:30:00+05:30')),
        reason: 'Admin repository integration test',
      });

      const rows = await repo.listAppointments({ facultyId: '201' }, 25, 0);
      expect(rows).toEqual([]);
    });
  });

  describe('Audit log (read-only)', () => {
    it('reflects a real audit_log row written by the appointment-booking trigger', async () => {
      await appointmentRepo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY_RAO,
        slot: TimeRange.create(new Date('2026-08-25T09:00:00+05:30'), new Date('2026-08-25T09:30:00+05:30')),
        reason: 'Admin repository audit log test',
      });

      const rows = await repo.listAuditLog({ entityType: 'appointment' }, 25, 0);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('filters by a real entityId', async () => {
      const { row } = await appointmentRepo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY_RAO,
        slot: TimeRange.create(new Date('2026-08-25T09:00:00+05:30'), new Date('2026-08-25T09:30:00+05:30')),
        reason: 'Admin repository audit log entityId test',
      });

      const rows = await repo.listAuditLog({ entityId: row.id }, 25, 0);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.entity_id === row.id)).toBe(true);
    });
  });

  describe('Dashboard & reporting', () => {
    it('getCounts reflects a real pending appointment', async () => {
      await appointmentRepo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY_RAO,
        slot: TimeRange.create(new Date('2026-08-25T09:00:00+05:30'), new Date('2026-08-25T09:30:00+05:30')),
        reason: 'Admin repository dashboard test',
      });

      const counts = await repo.getCounts();
      expect(counts.pending_appointments).toBe(1);
      expect(counts.total_faculty).toBeGreaterThanOrEqual(2);
      expect(counts.total_students).toBeGreaterThanOrEqual(2);
    });

    it('refreshFacultyStats + listFacultyStats run against the real materialized view without error', async () => {
      await repo.refreshFacultyStats();
      const stats = await repo.listFacultyStats();
      expect(Array.isArray(stats)).toBe(true);
    });

    it('getWorkloadReport runs the real window-function query without error', async () => {
      const rows = await repo.getWorkloadReport();
      expect(Array.isArray(rows)).toBe(true);
    });
  });
});
