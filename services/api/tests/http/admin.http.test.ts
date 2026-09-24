import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { Application } from 'express';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { FacultyRepository } from '../../src/repositories/faculty.repository';
import { FacultyService } from '../../src/services/faculty.service';
import { NotificationRepository } from '../../src/repositories/notification.repository';
import { NotificationService } from '../../src/services/notification.service';
import { FacultyAvailabilityRepository } from '../../src/repositories/faculty-availability.repository';
import { FacultyAvailabilityService } from '../../src/services/faculty-availability.service';
import { AuthRepository } from '../../src/repositories/auth.repository';
import { AuthService } from '../../src/services/auth.service';
import { AdminRepository } from '../../src/repositories/admin.repository';
import { AdminService } from '../../src/services/admin.service';
import { getJwtSecret } from '../../src/auth/jwt-secret';
import { createApp } from '../../src/app';

/**
 * HTTP-layer tests for the Admin & Reporting module — real Express app +
 * real PostgreSQL, same convention as every other *.http.test.ts.
 *
 * Every department/batch/faculty/student this file creates uses an
 * '...-http-test'/'ADMHTTP...' naming convention and is deleted in
 * afterEach, same cleanup technique as
 * tests/integration/admin.repository.integration.test.ts (AdminRepository
 * has no delete methods by design — this is test-only SQL against the test
 * database, not a production path).
 */
function bearer(id: string, role: 'STUDENT' | 'FACULTY' | 'ADMIN'): { Authorization: string } {
  const token = jwt.sign({ sub: id, role }, getJwtSecret(), { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

const ADMIN = bearer('900', 'ADMIN');
const STUDENT = bearer('100', 'STUDENT');
const FACULTY = bearer('200', 'FACULTY');

describe('Admin HTTP layer (integration — real Express app + real PostgreSQL)', () => {
  let pool: Pool;
  let app: Application;

  beforeAll(() => {
    pool = createPool();
    const notificationService = new NotificationService(new NotificationRepository(pool));
    const appointmentService = new AppointmentService(new AppointmentRepository(pool), new AppointmentStateMachine(), notificationService);
    const facultyService = new FacultyService(new FacultyRepository(pool));
    const facultyAvailabilityService = new FacultyAvailabilityService(new FacultyAvailabilityRepository(pool));
    const authService = new AuthService(new AuthRepository(pool), getJwtSecret());
    const adminService = new AdminService(new AdminRepository(pool));
    app = createApp({ appointmentService, facultyService, notificationService, facultyAvailabilityService, authService, adminService });
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM users WHERE email LIKE '%@admin-http-test.example.edu'`);
    await pool.query(`DELETE FROM batches WHERE name LIKE 'AdminHttpTest%'`);
    await pool.query(`DELETE FROM departments WHERE code LIKE 'ADMHTTP%'`);
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  describe('role gating — every /api/admin/* route is ADMIN-only', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/api/admin/departments');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a STUDENT caller', async () => {
      const res = await request(app).get('/api/admin/departments').set(STUDENT);
      expect(res.status).toBe(403);
    });

    it('returns 403 for a FACULTY caller', async () => {
      const res = await request(app).get('/api/admin/dashboard').set(FACULTY);
      expect(res.status).toBe(403);
    });
  });

  describe('Departments', () => {
    it('creates and lists a real department', async () => {
      const create = await request(app).post('/api/admin/departments').set(ADMIN).send({ name: 'Admin HTTP Dept', code: 'ADMHTTP1' });
      expect(create.status).toBe(201);

      const list = await request(app).get('/api/admin/departments').set(ADMIN);
      expect(list.status).toBe(200);
      expect(list.body.some((d: any) => d.code === 'ADMHTTP1')).toBe(true);
    });

    it('returns 400 VALIDATION_ERROR for a missing name', async () => {
      const res = await request(app).post('/api/admin/departments').set(ADMIN).send({ code: 'ADMHTTP2' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('updates a real department', async () => {
      const create = await request(app).post('/api/admin/departments').set(ADMIN).send({ name: 'Admin HTTP Dept', code: 'ADMHTTP1' });

      const update = await request(app).patch(`/api/admin/departments/${create.body.id}`).set(ADMIN).send({ name: 'Renamed' });
      expect(update.status).toBe(200);
      expect(update.body.name).toBe('Renamed');
    });
  });

  describe('Batches', () => {
    it('creates a real batch referencing a real department', async () => {
      const dept = await request(app).post('/api/admin/departments').set(ADMIN).send({ name: 'Admin HTTP Dept', code: 'ADMHTTP1' });

      const batch = await request(app)
        .post('/api/admin/batches')
        .set(ADMIN)
        .send({ departmentId: dept.body.id, name: 'AdminHttpTest Batch 1', academicYear: '2026-2027' });

      expect(batch.status).toBe(201);
      expect(batch.body.department_id).toBe(dept.body.id);
    });
  });

  describe('Faculty', () => {
    it('creates a real faculty account and returns a one-time temporary password', async () => {
      const dept = await request(app).post('/api/admin/departments').set(ADMIN).send({ name: 'Admin HTTP Dept', code: 'ADMHTTP1' });

      const res = await request(app).post('/api/admin/faculty').set(ADMIN).send({
        email: 'new.faculty@admin-http-test.example.edu',
        fullName: 'New Faculty',
        departmentId: dept.body.id,
        staffCode: 'ADMHTTP-F1',
      });

      expect(res.status).toBe(201);
      expect(res.body.account.email).toBe('new.faculty@admin-http-test.example.edu');
      expect(typeof res.body.temporaryPassword).toBe('string');
      expect(res.body.temporaryPassword.length).toBeGreaterThan(0);
    });

    it('the returned temporary password genuinely logs in via POST /api/auth/login', async () => {
      const dept = await request(app).post('/api/admin/departments').set(ADMIN).send({ name: 'Admin HTTP Dept', code: 'ADMHTTP1' });
      const created = await request(app).post('/api/admin/faculty').set(ADMIN).send({
        email: 'login.check@admin-http-test.example.edu',
        fullName: 'Login Check',
        departmentId: dept.body.id,
        staffCode: 'ADMHTTP-F2',
      });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'login.check@admin-http-test.example.edu', password: created.body.temporaryPassword });

      expect(login.status).toBe(200);
      expect(login.body.user.role).toBe('FACULTY');
    });

    it('returns 400 VALIDATION_ERROR for a malformed email', async () => {
      const res = await request(app).post('/api/admin/faculty').set(ADMIN).send({
        email: 'not-an-email', fullName: 'X', departmentId: 1, staffCode: 'ADMHTTP-BAD',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('Students', () => {
    it('creates a real student account with a one-time temporary password', async () => {
      const res = await request(app).post('/api/admin/students').set(ADMIN).send({
        email: 'new.student@admin-http-test.example.edu', fullName: 'New Student', batchId: 1, rollNumber: 'ADMHTTP-R1',
      });

      expect(res.status).toBe(201);
      expect(res.body.account.roll_number).toBe('ADMHTTP-R1');
      expect(typeof res.body.temporaryPassword).toBe('string');
    });
  });

  describe('Appointments (read-only)', () => {
    it('lists a real booked appointment', async () => {
      const bookRes = await request(app).post('/api/appointments').set(STUDENT).send({
        facultyId: '200',
        slotStart: '2026-08-25T14:00:00+05:30',
        slotEnd: '2026-08-25T14:30:00+05:30',
        reason: 'Admin HTTP test booking',
      });
      expect(bookRes.status).toBe(201);

      const res = await request(app).get('/api/admin/appointments?status=PENDING').set(ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('returns 400 VALIDATION_ERROR for an invalid status filter', async () => {
      const res = await request(app).get('/api/admin/appointments?status=BOGUS').set(ADMIN);
      expect(res.status).toBe(400);
    });
  });

  describe('Audit log (read-only)', () => {
    it('reflects a real audit_log entry after booking', async () => {
      await request(app).post('/api/appointments').set(STUDENT).send({
        facultyId: '200',
        slotStart: '2026-08-25T14:00:00+05:30',
        slotEnd: '2026-08-25T14:30:00+05:30',
        reason: 'Admin HTTP audit log test',
      });

      const res = await request(app).get('/api/admin/audit-log?entityType=appointment').set(ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('Dashboard & reporting', () => {
    it('GET /api/admin/dashboard returns real counts and refreshed faculty stats', async () => {
      const res = await request(app).get('/api/admin/dashboard').set(ADMIN);

      expect(res.status).toBe(200);
      expect(typeof res.body.counts.total_faculty).toBe('number');
      expect(Array.isArray(res.body.facultyStats)).toBe(true);
    });

    it('GET /api/admin/reports/appointments-summary returns the workload report', async () => {
      const res = await request(app).get('/api/admin/reports/appointments-summary').set(ADMIN);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
