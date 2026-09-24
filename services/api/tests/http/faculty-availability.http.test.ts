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
 * HTTP-layer tests for the write side of the Faculty Availability module
 * (PUT /api/faculty/availability, POST /api/faculty/availability/exceptions)
 * — real Express app + real PostgreSQL.
 *
 * Uses its own throwaway faculty fixture (id 9002), NOT the seeded 200/201,
 * for the same reason as faculty-availability.repository.integration.test.ts:
 * replacing availability is destructive to whatever set already exists, and
 * other test files assert against Prof. Rao's/Prof. Iyer's specific seeded
 * windows.
 */
function bearer(id: string, role: 'STUDENT' | 'FACULTY' | 'ADMIN'): { Authorization: string } {
  const token = jwt.sign({ sub: id, role }, getJwtSecret(), { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

const TEST_FACULTY_ID = '9002';
const FACULTY = bearer(TEST_FACULTY_ID, 'FACULTY');
const STUDENT = bearer('100', 'STUDENT');

describe('Faculty Availability write HTTP layer (integration — real Express app + real PostgreSQL)', () => {
  let pool: Pool;
  let app: Application;

  beforeAll(async () => {
    pool = createPool();
    const notificationService = new NotificationService(new NotificationRepository(pool));
    const appointmentService = new AppointmentService(new AppointmentRepository(pool), new AppointmentStateMachine(), notificationService);
    const facultyService = new FacultyService(new FacultyRepository(pool));
    const facultyAvailabilityService = new FacultyAvailabilityService(new FacultyAvailabilityRepository(pool));
    const authService = new AuthService(new AuthRepository(pool), getJwtSecret());
    const adminService = new AdminService(new AdminRepository(pool));
    app = createApp({ appointmentService, facultyService, notificationService, facultyAvailabilityService, authService, adminService });

    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, 'test.fixture.9002@example.edu', 'x', 'Test Fixture Faculty', 'FACULTY')`,
      [TEST_FACULTY_ID]
    );
    await pool.query(`INSERT INTO faculty (id, department_id, staff_code) VALUES ($1, 1, 'TEST-9002')`, [TEST_FACULTY_ID]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_FACULTY_ID]);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM faculty_availability WHERE faculty_id = $1', [TEST_FACULTY_ID]);
    await pool.query('DELETE FROM faculty_schedule_exceptions WHERE faculty_id = $1', [TEST_FACULTY_ID]);
  });

  describe('PUT /api/faculty/availability', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).put('/api/faculty/availability').send([]);
      expect(res.status).toBe(401);
    });

    it('returns 403 for a STUDENT caller', async () => {
      const res = await request(app).put('/api/faculty/availability').set(STUDENT).send([]);
      expect(res.status).toBe(403);
    });

    it('replaces the CALLER\'s own availability with the submitted set', async () => {
      const res = await request(app)
        .put('/api/faculty/availability')
        .set(FACULTY)
        .send([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' }]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].faculty_id).toBe(TEST_FACULTY_ID);
    });

    it('never touches another faculty member\'s availability (acts on req.user.id, never a body id)', async () => {
      // Read-only sanity check against Prof. Rao's (200) real seeded
      // availability BEFORE and AFTER replacing the fixture faculty's (9002)
      // — deliberately never calls PUT with OTHER_FACULTY's token, since
      // that would destructively clear Prof. Rao's seeded windows that
      // other test files (faculty.http.test.ts, faculty.repository.
      // integration.test.ts) depend on.
      const before = await request(app).get('/api/faculty/200/availability?date=2026-08-25').set(STUDENT);

      await request(app)
        .put('/api/faculty/availability')
        .set(FACULTY)
        .send([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' }]);

      const after = await request(app).get('/api/faculty/200/availability?date=2026-08-25').set(STUDENT);
      expect(after.body).toEqual(before.body);
    });

    it('returns 400 VALIDATION_ERROR for a non-array body', async () => {
      const res = await request(app).put('/api/faculty/availability').set(FACULTY).send({ not: 'an array' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR for an invalid window (endTime before startTime)', async () => {
      const res = await request(app)
        .put('/api/faculty/availability')
        .set(FACULTY)
        .send([{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00', effectiveFrom: '2026-08-01' }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 409 AVAILABILITY_OVERLAP for two overlapping windows in the same submission', async () => {
      const res = await request(app)
        .put('/api/faculty/availability')
        .set(FACULTY)
        .send([
          { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-08-01' },
          { dayOfWeek: 1, startTime: '11:00', endTime: '14:00', effectiveFrom: '2026-08-01' },
        ]);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('AVAILABILITY_OVERLAP');
    });

    it('replacing twice leaves only the second set active', async () => {
      await request(app)
        .put('/api/faculty/availability')
        .set(FACULTY)
        .send([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' }]);

      const second = await request(app)
        .put('/api/faculty/availability')
        .set(FACULTY)
        .send([{ dayOfWeek: 3, startTime: '10:00', endTime: '14:00', effectiveFrom: '2026-08-01' }]);

      expect(second.status).toBe(200);
      expect(second.body).toHaveLength(1);
      expect(second.body[0].day_of_week).toBe(3);
    });
  });

  describe('POST /api/faculty/availability/exceptions', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).post('/api/faculty/availability/exceptions').send({ date: '2026-08-31', type: 'LEAVE' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for a STUDENT caller', async () => {
      const res = await request(app)
        .post('/api/faculty/availability/exceptions')
        .set(STUDENT)
        .send({ date: '2026-08-31', type: 'LEAVE' });
      expect(res.status).toBe(403);
    });

    it('creates a real whole-day exception for the caller', async () => {
      const res = await request(app)
        .post('/api/faculty/availability/exceptions')
        .set(FACULTY)
        .send({ date: '2026-08-31', type: 'LEAVE', reason: 'Conference' });

      expect(res.status).toBe(201);
      expect(res.body.faculty_id).toBe(TEST_FACULTY_ID);
      expect(res.body.exception_type).toBe('LEAVE');
      expect(res.body.reason).toBe('Conference');
    });

    it('returns 400 VALIDATION_ERROR for an invalid exception type', async () => {
      const res = await request(app)
        .post('/api/faculty/availability/exceptions')
        .set(FACULTY)
        .send({ date: '2026-08-31', type: 'VACATION' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR for a missing date', async () => {
      const res = await request(app).post('/api/faculty/availability/exceptions').set(FACULTY).send({ type: 'LEAVE' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
