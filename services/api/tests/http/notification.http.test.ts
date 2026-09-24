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
 * HTTP-layer tests for the Notification module (GET /api/notifications/mine,
 * PATCH /api/notifications/:id/read) — real Express app + real PostgreSQL,
 * same convention as every other *.http.test.ts.
 *
 * Notifications are only ever created as a real side effect of a real
 * appointment lifecycle event (AppointmentService.notifyBestEffort) — never
 * fabricated here — so these tests drive the real POST /api/appointments and
 * PATCH /api/appointments/:id/approve endpoints to generate them.
 */
function bearer(id: string, role: 'STUDENT' | 'FACULTY' | 'ADMIN'): { Authorization: string } {
  const token = jwt.sign({ sub: id, role }, getJwtSecret(), { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

const STUDENT = bearer('100', 'STUDENT');
const OTHER_STUDENT = bearer('101', 'STUDENT');
const FACULTY = bearer('200', 'FACULTY');

describe('Notification HTTP layer (integration — real Express app + real PostgreSQL)', () => {
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

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function bookAppointment() {
    return request(app).post('/api/appointments').set(STUDENT).send({
      facultyId: '200',
      slotStart: '2026-08-25T14:00:00+05:30',
      slotEnd: '2026-08-25T14:30:00+05:30',
      reason: 'Doubt in assignment 2',
    });
  }

  describe('GET /api/notifications/mine', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/api/notifications/mine');
      expect(res.status).toBe(401);
    });

    it('returns an empty array when the caller has no notifications', async () => {
      const res = await request(app).get('/api/notifications/mine').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('a faculty member receives an APPOINTMENT_REQUESTED notification when a student books', async () => {
      const bookRes = await bookAppointment();
      expect(bookRes.status).toBe(201);

      const res = await request(app).get('/api/notifications/mine').set(FACULTY);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].type).toBe('APPOINTMENT_REQUESTED');
      expect(res.body[0].message).toMatch(/Doubt in assignment 2/);
      expect(res.body[0].is_read).toBe(false);
    });

    it('the booking student does NOT receive a notification for their own request', async () => {
      await bookAppointment();

      const res = await request(app).get('/api/notifications/mine').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('a student receives an APPOINTMENT_APPROVED notification when faculty approves', async () => {
      const bookRes = await bookAppointment();
      const id = bookRes.body.id;

      const approveRes = await request(app).patch(`/api/appointments/${id}/approve`).set(FACULTY);
      expect(approveRes.status).toBe(200);

      const res = await request(app).get('/api/notifications/mine').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].type).toBe('APPOINTMENT_APPROVED');
    });

    it('only returns the caller\'s own notifications, never another user\'s', async () => {
      await bookAppointment();

      const res = await request(app).get('/api/notifications/mine').set(OTHER_STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).patch('/api/notifications/1/read');
      expect(res.status).toBe(401);
    });

    it('marks the caller\'s own notification as read', async () => {
      await bookAppointment();
      const mine = await request(app).get('/api/notifications/mine').set(FACULTY);
      const notificationId = mine.body[0].id;

      const res = await request(app).patch(`/api/notifications/${notificationId}/read`).set(FACULTY);

      expect(res.status).toBe(200);
      expect(res.body.is_read).toBe(true);
    });

    it('returns 404 NOT_FOUND when attempting to mark someone else\'s notification as read', async () => {
      await bookAppointment();
      const mine = await request(app).get('/api/notifications/mine').set(FACULTY);
      const notificationId = mine.body[0].id;

      // STUDENT (100) does not own this FACULTY (200) notification.
      const res = await request(app).patch(`/api/notifications/${notificationId}/read`).set(STUDENT);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('returns 404 NOT_FOUND for a nonexistent notification id', async () => {
      const res = await request(app).patch('/api/notifications/999999/read').set(STUDENT);
      expect(res.status).toBe(404);
    });
  });
});
