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
 * HTTP-layer tests for POST /api/auth/login — the one /api endpoint
 * deliberately mounted WITHOUT the `identify` middleware (see app.ts,
 * auth.routes.ts): logging in is how a caller gets an identity in the first
 * place. Real Express app + real PostgreSQL, same convention as every other
 * *.http.test.ts in this project.
 *
 * Seed data (migrations/sql/seed_test_data.sql): every seeded user's
 * password is 'Password123!' (real pgcrypto bcrypt hash — migrations/sql/0009).
 */
describe('POST /api/auth/login (integration — real Express app + real PostgreSQL)', () => {
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

  it('returns 200 with a real, verifiable token and user details for a correct student login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@example.edu', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: '100', role: 'STUDENT', fullName: 'Alice Student', email: 'alice@example.edu' });
    const decoded = jwt.verify(res.body.token, getJwtSecret()) as { sub: string; role: string };
    expect(decoded.sub).toBe('100');
    expect(decoded.role).toBe('STUDENT');
  });

  it('logs in a faculty member', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'prof.rao@example.edu', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('FACULTY');
    expect(res.body.user.id).toBe('200');
  });

  it('logs in the admin', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@example.edu', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user.id).toBe('900');
  });

  it('login is case-insensitive on email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ALICE@EXAMPLE.EDU', password: 'Password123!' });
    expect(res.status).toBe(200);
  });

  it('returns 401 UNAUTHENTICATED for a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@example.edu', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('returns 401 UNAUTHENTICATED for a nonexistent email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.edu', password: 'Password123!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHENTICATED');
  });

  it('returns 400 VALIDATION_ERROR when email is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'Password123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@example.edu' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('requires no Authorization header at all (this endpoint is unauthenticated)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .unset('Authorization')
      .send({ email: 'alice@example.edu', password: 'Password123!' });
    expect(res.status).toBe(200);
  });

  it("the returned token is genuinely usable on a real protected endpoint (GET /api/faculty)", async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'alice@example.edu', password: 'Password123!' });
    const res = await request(app).get('/api/faculty').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
  });
});
