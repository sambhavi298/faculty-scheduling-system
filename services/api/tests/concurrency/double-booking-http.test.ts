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
 * THE flagship demo, but through the real HTTP surface rather than the
 * repository layer directly.
 *
 * tests/concurrency/double-booking.test.ts already proves the exclusion
 * constraint closes the classic "two students, one slot" race at the
 * AppointmentRepository level — two independent pg.Pool connections racing
 * bookAppointment() directly. That is the right place to prove the DATABASE
 * mechanism works. But it is one layer below what actually happens when two
 * real students use the real product: two separate HTTP requests, each
 * carrying its own JWT, hitting the real Express app — `identify`/
 * `requireRole` middleware, AppointmentController, AppointmentService,
 * AppointmentRepository, then the database — at the same time. Nothing
 * about that path is exercised by the repository-level test: a bug in the
 * Controller's response mapping, in how Express/supertest's own connection
 * handling interacts with concurrent in-flight requests, or in anything
 * between the HTTP boundary and the repository call would not be caught by
 * that test alone. This file closes that specific gap — it is the same
 * property (double booking is impossible), proven one layer further out,
 * through `supertest` against the real app the way a real browser's two
 * concurrent fetch() calls would exercise it.
 *
 * `bearer()` mirrors every other HTTP test file's convention: sign a real
 * JWT with the same secret identify.middleware.ts verifies against, so the
 * real verification code path runs on every request.
 */

function bearer(id: string, role: 'STUDENT' | 'FACULTY' | 'ADMIN'): { Authorization: string } {
  const token = jwt.sign({ sub: id, role }, getJwtSecret(), { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

const FACULTY_ID = '200'; // Prof. Rao — Mon-Fri 09:00-17:00, no conflicts on a Tuesday
const STUDENT_IDS = ['100', '101']; // only two real students are seeded — reused across a wider concurrent field below

function studentBearer(n: number): { Authorization: string } {
  // Cycles through the two real seeded student ids so this can fire more
  // than two concurrent requests (a stronger demonstration than a bare
  // two-way race) without inventing accounts that don't exist in the seed
  // data. Different students racing for the same slot is the scenario that
  // matters here — which two (or more) of them collide is incidental.
  return bearer(STUDENT_IDS[n % STUDENT_IDS.length], 'STUDENT');
}

describe('Double booking under real concurrency, through the real HTTP API (concurrency — real Express app + real PostgreSQL)', () => {
  let pool: Pool;
  let app: Application;

  beforeAll(() => {
    pool = createPool();
    const appointmentRepo = new AppointmentRepository(pool);
    const notificationService = new NotificationService(new NotificationRepository(pool));
    const appointmentService = new AppointmentService(appointmentRepo, new AppointmentStateMachine(), notificationService);
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

  it('two real HTTP POST /api/appointments requests for the identical slot, fired concurrently: exactly one 201, exactly one 409 SLOT_CONFLICT', async () => {
    const body = {
      facultyId: FACULTY_ID,
      slotStart: '2026-09-08T10:00:00+05:30', // Tuesday
      slotEnd: '2026-09-08T10:30:00+05:30',
      reason: 'HTTP-level concurrency test — identical slot',
    };

    // Both requests are started before either is awaited — genuinely
    // in-flight at the same time, exactly like two browsers submitting the
    // same form at once, not a sequential await-then-await.
    const attemptA = request(app).post('/api/appointments').set(studentBearer(0)).send(body);
    const attemptB = request(app).post('/api/appointments').set(studentBearer(1)).send(body);

    const [resA, resB] = await Promise.all([attemptA, attemptB]);
    const statuses = [resA.status, resB.status].sort();

    expect(statuses).toEqual([201, 409]);
    const loser = resA.status === 409 ? resA : resB;
    expect(loser.body.error).toBe('SLOT_CONFLICT');

    // The database is the source of truth, not the two HTTP responses: no
    // matter which request physically reached Postgres microseconds first,
    // exactly one row exists.
    const dbCheck = await pool.query(
      `SELECT student_id, status FROM appointments WHERE faculty_id = $1`,
      [FACULTY_ID]
    );
    expect(dbCheck.rows).toHaveLength(1);
    expect(dbCheck.rows[0].status).toBe('PENDING');
    expect(STUDENT_IDS).toContain(dbCheck.rows[0].student_id);
  });

  it('a wider field — five concurrent HTTP requests for the same slot — still yields exactly one winner', async () => {
    const body = {
      facultyId: FACULTY_ID,
      slotStart: '2026-09-08T11:00:00+05:30', // Tuesday, a different slot from the test above
      slotEnd: '2026-09-08T11:30:00+05:30',
      reason: 'HTTP-level concurrency test — five-way race',
    };

    const attempts = Array.from({ length: 5 }, (_, n) =>
      request(app).post('/api/appointments').set(studentBearer(n)).send(body)
    );
    const results = await Promise.all(attempts);

    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    for (const conflict of conflicts) {
      expect(conflict.body.error).toBe('SLOT_CONFLICT');
    }

    const dbCheck = await pool.query(
      `SELECT count(*)::int AS n FROM appointments WHERE faculty_id = $1 AND status = 'PENDING'`,
      [FACULTY_ID]
    );
    expect(dbCheck.rows[0].n).toBe(1);
  });

  it('two concurrent requests for genuinely overlapping (not identical) slots also yield exactly one winner', async () => {
    const attemptA = request(app).post('/api/appointments').set(studentBearer(0)).send({
      facultyId: FACULTY_ID,
      slotStart: '2026-09-15T14:00:00+05:30', // Tuesday
      slotEnd: '2026-09-15T14:30:00+05:30',
      reason: 'HTTP-level concurrency test — overlap A',
    });
    const attemptB = request(app).post('/api/appointments').set(studentBearer(1)).send({
      facultyId: FACULTY_ID,
      slotStart: '2026-09-15T14:15:00+05:30', // overlaps A's slot, not identical
      slotEnd: '2026-09-15T14:45:00+05:30',
      reason: 'HTTP-level concurrency test — overlap B',
    });

    const [resA, resB] = await Promise.all([attemptA, attemptB]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
