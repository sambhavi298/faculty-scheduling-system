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
 * HTTP-layer tests for the Faculty Directory module, same convention as
 * tests/http/appointment.http.test.ts: real Express app (routing, identify/
 * requireRole middleware — now verifying real JWTs, not trusting
 * X-User-Id/X-User-Role headers —, Controller, errorHandler) wired to a real
 * FacultyService backed by a real PostgreSQL Pool — never mocked.
 *
 * `bearer()` signs a real JWT with the SAME secret identify.middleware.ts
 * verifies against (getJwtSecret()), exercising the real verification code
 * path exactly as a token from POST /api/auth/login would.
 *
 * Seed data: same as appointment.http.test.ts — students 100/101, faculty
 * 200 (Prof. Rao, Computer Science, available Mon-Fri 09:00-17:00 IST with
 * a Monday 10:00-11:00 teaching block and full-day leave on 2026-08-31) and
 * 201 (Prof. Iyer, Computer Science, no declared availability at all).
 * 2026-08-25 is a Tuesday with no conflicts for Prof. Rao.
 */

function bearer(id: string, role: 'STUDENT' | 'FACULTY' | 'ADMIN'): { Authorization: string } {
  const token = jwt.sign({ sub: id, role }, getJwtSecret(), { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

const STUDENT = bearer('100', 'STUDENT');
const FACULTY = bearer('200', 'FACULTY');
const OTHER_FACULTY = bearer('201', 'FACULTY');

describe('Faculty Directory HTTP layer (integration — real Express app + real PostgreSQL)', () => {
  let pool: Pool;
  let app: Application;

  beforeAll(() => {
    pool = createPool();
    const appointmentRepo = new AppointmentRepository(pool);
    const notificationService = new NotificationService(new NotificationRepository(pool));
    const appointmentService = new AppointmentService(appointmentRepo, new AppointmentStateMachine(), notificationService);
    const facultyRepo = new FacultyRepository(pool);
    const facultyService = new FacultyService(facultyRepo);
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

  describe('GET /api/faculty', () => {
    it('returns 401 without identity headers', async () => {
      const res = await request(app).get('/api/faculty');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('returns every faculty member for a STUDENT caller, with id/name/department/designation', async () => {
      const res = await request(app).get('/api/faculty').set(STUDENT);

      expect(res.status).toBe(200);
      const rao = res.body.find((f: any) => f.id === '200');
      expect(rao).toEqual({ id: '200', name: 'Prof. Rao', department: 'Computer Science', designation: null });
    });

    it('also allows a FACULTY caller (not student-only)', async () => {
      const res = await request(app).get('/api/faculty').set(FACULTY);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('filters by ?search= (case-insensitive)', async () => {
      const res = await request(app).get('/api/faculty?search=iyer').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Prof. Iyer');
    });

    it('returns an empty array when the search matches nobody', async () => {
      const res = await request(app).get('/api/faculty?search=nobody-has-this-name').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/faculty/me/stats', () => {
    it('returns 401 without identity headers', async () => {
      const res = await request(app).get('/api/faculty/me/stats');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('returns 403 for a STUDENT caller (faculty-only endpoint)', async () => {
      const res = await request(app).get('/api/faculty/me/stats').set(STUDENT);
      expect(res.status).toBe(403);
    });

    it('returns zero counts (not an error) for a faculty member with no appointments at all', async () => {
      const res = await request(app).get('/api/faculty/me/stats').set(OTHER_FACULTY); // Prof. Iyer, no seeded appointments
      expect(res.status).toBe(200);
      expect(res.body.faculty_id).toBe('201');
      expect(Number(res.body.total_requests)).toBe(0);
      expect(Number(res.body.completed_count)).toBe(0);
    });

    it('reflects a real booking for the caller, and never the other faculty member\'s numbers', async () => {
      const book = await request(app).post('/api/appointments').set(STUDENT).send({
        facultyId: '200',
        slotStart: '2026-08-25T14:00:00+05:30',
        slotEnd: '2026-08-25T14:30:00+05:30',
        reason: 'Stats endpoint test booking',
      });
      expect(book.status).toBe(201);

      const rao = await request(app).get('/api/faculty/me/stats').set(FACULTY);
      expect(rao.status).toBe(200);
      expect(rao.body.faculty_id).toBe('200');
      expect(Number(rao.body.total_requests)).toBeGreaterThanOrEqual(1);

      // The SAME booking must never show up under Prof. Iyer's own stats —
      // this is a self-service endpoint, always scoped to req.user!.id.
      const iyer = await request(app).get('/api/faculty/me/stats').set(OTHER_FACULTY);
      expect(iyer.status).toBe(200);
      expect(Number(iyer.body.total_requests)).toBe(0);
    });
  });

  describe('GET /api/faculty/:id/availability', () => {
    it('returns 401 without identity headers', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-08-25');
      expect(res.status).toBe(401);
    });

    it('returns 400 VALIDATION_ERROR when ?date= is missing', async () => {
      const res = await request(app).get('/api/faculty/200/availability').set(STUDENT);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR for a malformed date', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=25-08-2026').set(STUDENT);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR for a nonexistent calendar date (e.g. Feb 30)', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-02-30').set(STUDENT);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR for a non-numeric faculty id', async () => {
      const res = await request(app).get('/api/faculty/not-a-number/availability?date=2026-08-25').set(STUDENT);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 404 NOT_FOUND for a well-formed but nonexistent faculty id', async () => {
      const res = await request(app).get('/api/faculty/999999/availability?date=2026-08-25').set(STUDENT);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('returns real open slots for an unblocked weekday, as [{slot_start, slot_end}] ISO strings', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-08-25').set(STUDENT);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toEqual({
        slot_start: expect.any(String),
        slot_end: expect.any(String),
      });
      expect(new Date(res.body[0].slot_start).toISOString()).toBe(res.body[0].slot_start);
    });

    it('excludes the Monday 10:00-11:00 teaching block from the returned slots', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-08-24').set(STUDENT);
      expect(res.status).toBe(200);

      const blockStart = new Date('2026-08-24T04:30:00.000Z').getTime();
      const blockEnd = new Date('2026-08-24T05:30:00.000Z').getTime();
      for (const slot of res.body) {
        const start = new Date(slot.slot_start).getTime();
        const end = new Date(slot.slot_end).getTime();
        expect(start < blockEnd && blockStart < end).toBe(false);
      }
    });

    it('returns an empty array on a full-day leave date', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-08-31').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns an empty array for a faculty member with no declared availability', async () => {
      const res = await request(app).get('/api/faculty/201/availability?date=2026-08-25').set(STUDENT);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('excludes a slot that now has a real booked appointment against it', async () => {
      const before = await request(app).get('/api/faculty/200/availability?date=2026-08-25').set(STUDENT);
      const wasOpen = before.body.some((s: any) => s.slot_start === '2026-08-25T03:30:00.000Z');
      expect(wasOpen).toBe(true); // sanity: 09:00-09:30 IST open before booking

      const bookRes = await request(app).post('/api/appointments').set(STUDENT).send({
        facultyId: '200',
        slotStart: '2026-08-25T14:00:00+05:30',
        slotEnd: '2026-08-25T14:30:00+05:30',
        reason: 'Taking this slot for the availability test',
      });
      expect(bookRes.status).toBe(201);

      const after = await request(app).get('/api/faculty/200/availability?date=2026-08-25').set(STUDENT);
      const stillOpen = after.body.some((s: any) => s.slot_start === '2026-08-25T08:30:00.000Z'); // 14:00 IST = 08:30 UTC
      expect(stillOpen).toBe(false);
    });

    it('respects an explicit ?slotMinutes=', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-08-25&slotMinutes=60').set(STUDENT);
      expect(res.status).toBe(200);
      for (const slot of res.body) {
        const durationMs = new Date(slot.slot_end).getTime() - new Date(slot.slot_start).getTime();
        expect(durationMs).toBe(60 * 60 * 1000);
      }
    });

    it('returns 400 VALIDATION_ERROR for a non-positive slotMinutes', async () => {
      const res = await request(app).get('/api/faculty/200/availability?date=2026-08-25&slotMinutes=0').set(STUDENT);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
