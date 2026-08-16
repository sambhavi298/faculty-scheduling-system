import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { TimeRange } from '../../src/domain/time-range';
import { NotFoundError } from '../../src/errors/not-found.error';

/**
 * Level 7 — Section 8: Security.
 *
 * HONEST SCOPE NOTE, read this first: as of the end of Level 6, this
 * codebase implements the repository and service layers only — there is no
 * HTTP/REST API, no authentication middleware, and no session/token layer
 * yet (that is planned for a later level). That means the following attack
 * classes genuinely CANNOT be exercised yet, and this file does not
 * pretend otherwise: JWT/session forgery or tampering, CSRF, rate
 * limiting/brute force, header/cookie manipulation, and transport-level
 * attacks (TLS stripping, etc.). Those require a real HTTP boundary to
 * attack and must be revisited once Level 8 (or whichever level adds the
 * API layer) exists — this is called out explicitly in the Break Report
 * rather than silently skipped.
 *
 * What CAN be genuinely attacked at this layer, and is covered below:
 *   - SQL injection through every user-controlled field the repository
 *     accepts (reason, student/faculty ids, the idempotency key)
 *   - Cross-student and cross-faculty unauthorized access/modification
 *   - Enumeration via error message/shape differences
 *   - Replay/hijack of another user's request via a guessed or reused
 *     idempotency key
 */

const STUDENT_A = '100';
const STUDENT_B = '101';
const FACULTY_A = '200';
const FACULTY_B = '201';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

describe('Level 7 — Security: SQL injection and access control (real PostgreSQL)', () => {
  let pool: Pool;
  let repo: AppointmentRepository;
  let service: AppointmentService;

  beforeAll(() => {
    pool = createPool();
    repo = new AppointmentRepository(pool);
    service = new AppointmentService(repo, new AppointmentStateMachine());
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  // ────────────────────────────── SQL INJECTION ──────────────────────────────

  describe('SQL injection', () => {
    const payloads = [
      "'; DROP TABLE appointments; --",
      "' OR '1'='1",
      "x'; DELETE FROM appointments WHERE '1'='1'; --",
      "1) UNION SELECT * FROM users; --",
      "Robert'); DROP TABLE students;--",
    ];

    it.each(payloads)(
      'the reason field accepts a classic SQL injection payload (%s) as inert literal text — every query is parameterized, so nothing is ever executed',
      async (payload) => {
        // Pad to satisfy the reason length CHECK constraint (5-1000 chars)
        // without altering the payload's meaning if it's on the short side.
        const reason = payload.length >= 5 ? payload : payload.padEnd(5, ' ');

        const { row } = await repo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY_A,
          slot: slot('2026-12-10T10:00:00+05:30', '2026-12-10T10:30:00+05:30'), reason,
        });

        // Stored verbatim as data, never interpreted as SQL.
        expect(row.reason).toBe(reason);

        // The proof that nothing executed: both tables the payloads target
        // still exist and still have exactly the rows we expect.
        const appointmentsStillThere = await pool.query('SELECT count(*)::int AS n FROM appointments');
        expect(appointmentsStillThere.rows[0].n).toBe(1);
        const usersStillThere = await pool.query('SELECT count(*)::int AS n FROM users');
        expect(usersStillThere.rows[0].n).toBeGreaterThan(0);
      }
    );

    it('a non-numeric, injection-shaped student id is rejected at the type layer (22P02) — never coerced, never used to bypass a numeric comparison', async () => {
      await expect(
        pool.query(`SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`, [
          "1 OR 1=1", FACULTY_A, '[2026-12-11T10:00:00+05:30,2026-12-11T10:30:00+05:30)', 'Injection via student id', null,
        ])
      ).rejects.toMatchObject({ code: '22P02' });
    });

    it('a non-numeric, injection-shaped faculty id is rejected at the type layer (22P02)', async () => {
      await expect(
        pool.query(`SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`, [
          STUDENT_A, "200; DROP TABLE faculty; --", '[2026-12-11T11:00:00+05:30,2026-12-11T11:30:00+05:30)', 'Injection via faculty id', null,
        ])
      ).rejects.toMatchObject({ code: '22P02' });
    });

    it('an injection-shaped clientRequestId is rejected at the type layer (22P02) — the idempotency key cannot be used as an injection or type-confusion vector', async () => {
      await expect(
        pool.query(`SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`, [
          STUDENT_A, FACULTY_A, '[2026-12-11T12:00:00+05:30,2026-12-11T12:30:00+05:30)', 'Injection via clientRequestId',
          "'; DROP TABLE appointments; --",
        ])
      ).rejects.toMatchObject({ code: '22P02' });

      const stillThere = await pool.query('SELECT count(*)::int AS n FROM appointments');
      expect(stillThere.rows[0].n).toBe(0); // the attempted insert never committed
    });
  });

  // ────────────────────────────── ACCESS CONTROL ──────────────────────────────

  describe('Unauthorized cross-student / cross-faculty access', () => {
    it('a student cannot cancel another student\'s appointment by supplying their own id as the actor', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY_A,
        slot: slot('2026-12-15T10:00:00+05:30', '2026-12-15T10:30:00+05:30'), reason: 'Belongs to student A only', // Tuesday, available
      });

      await expect(service.cancel(row.id, STUDENT_B)).rejects.toThrow(NotFoundError);

      const stillPending = await repo.findById(row.id);
      expect(stillPending!.status).toBe('PENDING'); // the unauthorized attempt had zero effect
    });

    it('faculty B cannot reject an appointment that belongs to faculty A', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY_A,
        slot: slot('2026-12-15T11:00:00+05:30', '2026-12-15T11:30:00+05:30'), reason: 'Belongs to faculty A only', // Tuesday, available
      });

      await expect(service.reject(row.id, FACULTY_B)).rejects.toThrow(NotFoundError);

      const stillPending = await repo.findById(row.id);
      expect(stillPending!.status).toBe('PENDING');
    });

    it('a student cannot read another student\'s appointment list — listForStudent is scoped strictly by id, never returns cross-student rows', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY_A,
        slot: slot('2026-12-15T12:00:00+05:30', '2026-12-15T12:30:00+05:30'), reason: 'Student A private appointment', // Tuesday, available
      });
      const studentBView = await repo.listForStudent(STUDENT_B);
      expect(studentBView).toEqual([]);
    });

    it('FIXED (was GAP): complete() and markMissed() now have a Service-layer ownership wrapper (Phase 1, Task 3) — an unauthorized attempt gets a typed NotFoundError, not a silent null', async () => {
      // Previously documented as a gap: the database-level guard
      // (`WHERE ... AND faculty_id = $2 AND status = 'APPROVED'`) always
      // correctly prevented faculty B from completing faculty A's
      // appointment — no unauthorized state change was ever possible — but
      // AppointmentService exposed no complete()/markMissed() wrapper, so a
      // caller using repo.complete() directly got a silent `null` instead
      // of a typed, auditable error, unlike approve/reject/cancel.
      // AppointmentService.complete()/markMissed() (src/services/
      // appointment.service.ts) now mirror approve()/reject() exactly:
      // findOwnedByFaculty() first, so an unauthorized attempt is now a
      // proper NotFoundError, indistinguishable from "doesn't exist" (see
      // the enumeration-resistance test just below, which now applies to
      // these two transitions as well).
      const booked = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY_A,
        slot: slot('2026-12-15T13:00:00+05:30', '2026-12-15T13:30:00+05:30'), reason: 'Complete-ownership gap test', // Tuesday, available
      });
      await repo.approve(booked.row.id, FACULTY_A);

      await expect(service.complete(booked.row.id, FACULTY_B, 'Faculty B trying to complete it')).rejects.toThrow(NotFoundError);

      const stillApproved = await repo.findById(booked.row.id);
      expect(stillApproved!.status).toBe('APPROVED'); // the data itself was always safe — now the error ergonomics match too

      // The repository method itself is unchanged and still used directly
      // elsewhere (e.g. by tests exercising the database guard in
      // isolation) — it still returns null on a non-match, by design; it's
      // the Service layer's job to translate that into NotFoundError, the
      // same division of responsibility approve/reject/cancel already had.
      const rawRepoCall = await repo.complete(booked.row.id, FACULTY_B, 'Direct repository call, bypassing the Service layer');
      expect(rawRepoCall).toBeNull();
    });

    it('enumeration resistance: a truly nonexistent appointment id and an appointment id that exists but belongs to someone else produce the IDENTICAL error type and message, so an attacker cannot distinguish "not found" from "not yours"', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY_A,
        slot: slot('2026-12-15T14:00:00+05:30', '2026-12-15T14:30:00+05:30'), reason: 'Enumeration resistance test', // Tuesday, available
      });

      let notFoundErr: Error | null = null;
      let notYoursErr: Error | null = null;
      try {
        await service.approve('999999999', FACULTY_A); // does not exist at all
      } catch (e) {
        notFoundErr = e as Error;
      }
      try {
        await service.approve(row.id, FACULTY_B); // exists, but belongs to a different faculty member
      } catch (e) {
        notYoursErr = e as Error;
      }

      expect(notFoundErr).toBeInstanceOf(NotFoundError);
      expect(notYoursErr).toBeInstanceOf(NotFoundError);
      expect(notFoundErr!.message).toBe(notYoursErr!.message);
    });
  });

  // ────────────────────────────── REPLAY / IDEMPOTENCY-KEY MISUSE ──────────────────────────────

  describe('Replay attack via idempotency key reuse', () => {
    it('an attacker reusing (guessing/observing) another student\'s clientRequestId cannot hijack or retrieve that student\'s appointment — the idempotency match is scoped per-student, so it is treated as a brand new booking instead', async () => {
      const sharedKey = randomUUID(); // e.g. leaked via a shared browser, a proxy log, or simple guessing of a low-entropy scheme
      const victim = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY_A,
        slot: slot('2026-12-16T10:00:00+05:30', '2026-12-16T10:30:00+05:30'), // Wednesday, available
        reason: 'Victim\'s real appointment', clientRequestId: sharedKey,
      });

      const attacker = await repo.bookAppointment({
        studentId: STUDENT_B, facultyId: FACULTY_A, // different student, different slot
        slot: slot('2026-12-16T14:00:00+05:30', '2026-12-16T14:30:00+05:30'), // Wednesday, available
        reason: 'Attacker replaying the victim\'s idempotency key', clientRequestId: sharedKey,
      });

      // The attacker got their OWN new row, not the victim's — reusing the
      // key did not grant access to someone else's data or let them
      // silently attach themselves to the victim's appointment.
      expect(attacker.wasNewlyCreated).toBe(true);
      expect(attacker.row.id).not.toBe(victim.row.id);
      expect(attacker.row.student_id).toBe(STUDENT_B);
      expect(attacker.row.reason).toBe('Attacker replaying the victim\'s idempotency key');

      // The victim's original row is completely untouched.
      const victimRow = await repo.findById(victim.row.id);
      expect(victimRow!.student_id).toBe(STUDENT_A);
      expect(victimRow!.reason).toBe('Victim\'s real appointment');
    });
  });
});
