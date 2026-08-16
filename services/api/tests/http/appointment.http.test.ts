import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { Application } from 'express';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { createApp } from '../../src/app';

/**
 * HTTP-layer tests (Phase 2). These exercise the real Express app —
 * routing, the `identify`/`requireRole` middleware, Controllers, and
 * `errorHandler` — wired to a real AppointmentService backed by a real
 * PostgreSQL Pool, matching this project's existing convention (see
 * tests/integration/*) of never mocking the database. What's new here,
 * versus the Service-level integration tests, is proving the HTTP
 * boundary itself: status codes, header-based identity, and JSON shapes
 * match the Level 5 API Contract Table.
 *
 * Seed data (migrations/sql/seed_test_data.sql +
 * seed_availability_test_data.sql): students 100/101, faculty 200/201.
 * Faculty 200 is available Mon-Fri 09:00-17:00 with no teaching/leave
 * conflicts on Tuesdays, so 2026-08-25 (a Tuesday) is used as a safe slot
 * date throughout — it deliberately avoids the Monday 10:00-11:00 teaching
 * block and the 2026-08-31 leave day used by the availability tests.
 */

const STUDENT = { 'X-User-Id': '100', 'X-User-Role': 'STUDENT' };
const OTHER_STUDENT = { 'X-User-Id': '101', 'X-User-Role': 'STUDENT' };
const FACULTY = { 'X-User-Id': '200', 'X-User-Role': 'FACULTY' };
const OTHER_FACULTY = { 'X-User-Id': '201', 'X-User-Role': 'FACULTY' };

function slotBody(overrides: Partial<{ facultyId: string; slotStart: string; slotEnd: string; reason: string; clientRequestId: string }> = {}) {
  return {
    facultyId: '200',
    slotStart: '2026-08-25T14:00:00+05:30',
    slotEnd: '2026-08-25T14:30:00+05:30',
    reason: 'Doubt in assignment 2',
    ...overrides,
  };
}

describe('Appointment HTTP layer (integration — real Express app + real PostgreSQL)', () => {
  let pool: Pool;
  let app: Application;

  beforeAll(() => {
    pool = createPool();
    const repo = new AppointmentRepository(pool);
    const service = new AppointmentService(repo, new AppointmentStateMachine());
    app = createApp(service);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('GET /health', () => {
    it('responds 200 without any identity headers', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('identify middleware', () => {
    it('returns 401 when no identity headers are supplied', async () => {
      const res = await request(app).get('/api/appointments/mine');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when X-User-Role is not a recognized role', async () => {
      const res = await request(app)
        .get('/api/appointments/mine')
        .set('X-User-Id', '100')
        .set('X-User-Role', 'ADMIN');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/appointments', () => {
    it('returns 403 when a faculty member (not a student) attempts to request an appointment', async () => {
      const res = await request(app).post('/api/appointments').set(FACULTY).send(slotBody());
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('creates a PENDING appointment for a valid student request', async () => {
      const res = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.student_id).toBe('100');
      expect(res.body.faculty_id).toBe('200');
      expect(res.body.reason).toBe('Doubt in assignment 2');
    });

    it('returns 400 VALIDATION_ERROR when the reason is too short', async () => {
      const res = await request(app).post('/api/appointments').set(STUDENT).send(slotBody({ reason: 'Hi' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 409 SLOT_CONFLICT when a second student requests the same slot', async () => {
      const first = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());
      expect(first.status).toBe(201);

      const second = await request(app).post('/api/appointments').set(OTHER_STUDENT).send(slotBody());
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('SLOT_CONFLICT');
    });

    it('is idempotent: replaying the same clientRequestId returns the original appointment instead of creating a duplicate', async () => {
      // client_request_id is a UUID column (migrations/sql/0002) — must be a real UUID, not an arbitrary string.
      const body = slotBody({ clientRequestId: randomUUID() });

      const first = await request(app).post('/api/appointments').set(STUDENT).send(body);
      const second = await request(app).post('/api/appointments').set(STUDENT).send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const count = await pool.query('SELECT count(*) FROM appointments');
      expect(Number(count.rows[0].count)).toBe(1);
    });
  });

  describe('GET /api/appointments/mine', () => {
    it('returns only the requesting student\'s own appointments', async () => {
      await request(app).post('/api/appointments').set(STUDENT).send(slotBody());
      await request(app).post('/api/appointments').set(OTHER_STUDENT).send(
        slotBody({ slotStart: '2026-08-25T15:00:00+05:30', slotEnd: '2026-08-25T15:30:00+05:30' })
      );

      const res = await request(app).get('/api/appointments/mine').set(STUDENT);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].student_id).toBe('100');
    });

    it('returns 403 when a faculty member calls a student-only endpoint', async () => {
      const res = await request(app).get('/api/appointments/mine').set(FACULTY);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/appointments/pending', () => {
    it('returns only PENDING requests owned by the requesting faculty member', async () => {
      await request(app).post('/api/appointments').set(STUDENT).send(slotBody());

      const res = await request(app).get('/api/appointments/pending').set(FACULTY);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      // faculty_pending_requests (migrations/sql/0004_views.sql) has no `status`
      // column — the WHERE a.status = 'PENDING' clause already guarantees it,
      // so every row this view returns is implicitly PENDING by construction.
      expect(res.body[0].faculty_id).toBe('200');
      expect(res.body[0].reason).toBe('Doubt in assignment 2');
    });

    it('returns 403 when a student calls a faculty-only endpoint', async () => {
      const res = await request(app).get('/api/appointments/pending').set(STUDENT);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/appointments/:id/approve', () => {
    async function createPendingAppointment(): Promise<string> {
      const res = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());
      return res.body.id;
    }

    it('approves a PENDING appointment owned by this faculty member', async () => {
      const id = await createPendingAppointment();

      const res = await request(app).patch(`/api/appointments/${id}/approve`).set(FACULTY);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('is idempotent: approving an already-APPROVED appointment returns 200 again, not an error', async () => {
      const id = await createPendingAppointment();
      await request(app).patch(`/api/appointments/${id}/approve`).set(FACULTY);

      const res = await request(app).patch(`/api/appointments/${id}/approve`).set(FACULTY);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('returns 404 when a different faculty member (not the owner) attempts to approve', async () => {
      const id = await createPendingAppointment();

      const res = await request(app).patch(`/api/appointments/${id}/approve`).set(OTHER_FACULTY);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('returns 409 INVALID_TRANSITION when approving an already-REJECTED appointment', async () => {
      const id = await createPendingAppointment();
      await request(app).patch(`/api/appointments/${id}/reject`).set(FACULTY);

      const res = await request(app).patch(`/api/appointments/${id}/approve`).set(FACULTY);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_TRANSITION');
    });
  });

  describe('PATCH /api/appointments/:id/cancel', () => {
    it('allows the student who owns the appointment to cancel it', async () => {
      const created = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());

      const res = await request(app).patch(`/api/appointments/${created.body.id}/cancel`).set(STUDENT);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('returns 404 when the actor is neither the student nor the faculty member on the appointment', async () => {
      const created = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());

      const res = await request(app).patch(`/api/appointments/${created.body.id}/cancel`).set(OTHER_STUDENT);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/appointments/:id/complete and /missed', () => {
    it('returns 409 INVALID_TRANSITION when completing a still-PENDING appointment (must be approved first)', async () => {
      const created = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());

      const res = await request(app).patch(`/api/appointments/${created.body.id}/complete`).set(FACULTY);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_TRANSITION');
    });

    it('completes an APPROVED appointment, passing optional notes through', async () => {
      const created = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());
      await request(app).patch(`/api/appointments/${created.body.id}/approve`).set(FACULTY);

      const res = await request(app)
        .patch(`/api/appointments/${created.body.id}/complete`)
        .set(FACULTY)
        .send({ notes: 'Discussed the project scope' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.completion_notes).toBe('Discussed the project scope');
    });

    it('marks an APPROVED appointment as MISSED', async () => {
      const created = await request(app).post('/api/appointments').set(STUDENT).send(slotBody());
      await request(app).patch(`/api/appointments/${created.body.id}/approve`).set(FACULTY);

      const res = await request(app).patch(`/api/appointments/${created.body.id}/missed`).set(FACULTY);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('MISSED');
    });
  });
});
