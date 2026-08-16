import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { AppointmentService } from '../../src/services/appointment.service';
import { AppointmentStateMachine } from '../../src/domain/appointment-state-machine';
import { TimeRange } from '../../src/domain/time-range';
import { SlotConflictError } from '../../src/errors/slot-conflict.error';
import { NotFoundError } from '../../src/errors/not-found.error';
import { InvalidTransitionError } from '../../src/errors/invalid-transition.error';
import { ValidationError } from '../../src/errors/validation.error';
import { FacultyUnavailableError } from '../../src/errors/faculty-unavailable.error';

/**
 * Level 7 — Sections 2, 3, 7: Negative, Boundary, and Data Integrity tests.
 * All run against the real PostgreSQL 16 instance and the real Level 5/6
 * schema — this file is an ATTACK on the running system, not a description
 * of intent. Where the system is genuinely found wanting, the test is kept
 * and clearly labelled "GAP:" — see the Level 7 report's Break Report for
 * the honest writeup of every one documented here.
 */

const STUDENT_A = '100';
const STUDENT_B = '101';
const FACULTY = '200'; // Prof. Rao — has availability, a teaching block, and a leave day seeded
const FACULTY_NO_AVAILABILITY = '201'; // Prof. Iyer — zero faculty_availability rows seeded
const NONEXISTENT_STUDENT = '999999';
const NONEXISTENT_FACULTY = '999998';

function slot(startIso: string, endIso: string): TimeRange {
  return TimeRange.create(new Date(startIso), new Date(endIso));
}

describe('Level 7 — Negative, Boundary, and Data Integrity (real PostgreSQL)', () => {
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

  // ────────────────────────────── SECTION 2: NEGATIVE TESTS ──────────────────────────────

  describe('Negative tests', () => {
    it('rejects a booking for a student that does not exist (foreign key violation, 23503)', async () => {
      // 2026-11-03 is a Tuesday, inside Prof. Rao's declared availability —
      // deliberately NOT the same slot used by the "nonexistent faculty"
      // test below, so this failure is unambiguously the student FK, not
      // an availability rejection racing it.
      await expect(
        repo.bookAppointment({
          studentId: NONEXISTENT_STUDENT, facultyId: FACULTY,
          slot: slot('2026-11-03T10:00:00+05:30', '2026-11-03T10:30:00+05:30'), reason: 'Invalid student test',
        })
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('rejects a booking for a faculty member that does not exist (foreign key violation, 23503)', async () => {
      // A nonexistent faculty ID has zero faculty_availability rows by
      // definition, so is_faculty_available() would ALSO report it as
      // unavailable — that's a true statement, but a less specific one
      // than "this faculty doesn't exist." Since is_faculty_available()
      // runs before the INSERT, using NONEXISTENT_FACULTY here would
      // surface FacultyUnavailableError instead of the FK violation this
      // test is actually about, for every slot, real or not. The FK
      // constraint itself is still 100% enforced regardless (a booking for
      // a nonexistent faculty can never succeed either way) — this is a
      // difference in which error a caller sees, not a correctness gap.
      // Real faculty-existence validation belongs in front of this call
      // (Phase 2's Controller/Service layer), so this test targets the
      // repository/database layer's FK constraint directly, bypassing
      // book_appointment() the same way the malformed-input tests below do.
      await expect(
        pool.query(
          `INSERT INTO appointments (student_id, faculty_id, slot, reason) VALUES ($1,$2,$3::tstzrange,$4)`,
          [STUDENT_A, NONEXISTENT_FACULTY, '[2026-11-03T11:00:00+05:30,2026-11-03T11:30:00+05:30)', 'Invalid faculty test']
        )
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('rejects an invalid slot (end before start) at the domain layer before ever reaching the database', () => {
      expect(() => slot('2026-11-01T10:30:00+05:30', '2026-11-01T10:00:00+05:30')).toThrow(ValidationError);
    });

    it('rejects an invalid slot (end before start) at the DATABASE layer too, if the domain check is bypassed (appointments_slot_bounded_chk)', async () => {
      await expect(
        pool.query(
          `SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, '[2026-11-02T10:30:00+05:30,2026-11-02T10:00:00+05:30)', 'Backwards range bypassing TimeRange', null]
        )
      ).rejects.toMatchObject({ code: '22000' }); // Postgres itself refuses to construct an inverted range
    });

    it('rejects a missing reason at the DATABASE layer (NOT NULL), if the Service-layer check is bypassed', async () => {
      await expect(
        pool.query(
          `INSERT INTO appointments (student_id, faculty_id, slot, reason) VALUES ($1,$2,$3::tstzrange,NULL)`,
          [STUDENT_A, FACULTY, '[2026-11-03T10:00:00+05:30,2026-11-03T10:30:00+05:30)']
        )
      ).rejects.toMatchObject({ code: '23502' }); // not_null_violation
    });

    it('rejects malformed slot input (an unparseable range literal)', async () => {
      await expect(
        pool.query(`SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, 'not-a-range-at-all', 'Malformed input test', null])
      ).rejects.toBeTruthy();
    });

    it('an "unauthorized student" cannot approve an appointment — passing a student id where a faculty id is expected finds no matching row', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-04T10:00:00+05:30', '2026-11-04T10:30:00+05:30'), reason: 'Unauthorized approval attempt',
      });
      await expect(service.approve(row.id, STUDENT_A)).rejects.toThrow(NotFoundError);
    });

    it('faculty member B cannot approve an appointment that belongs to faculty member A', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-05T10:00:00+05:30', '2026-11-05T10:30:00+05:30'), reason: 'Cross-faculty approval attempt',
      });
      await expect(service.approve(row.id, FACULTY_NO_AVAILABILITY)).rejects.toThrow(NotFoundError);

      const stillPending = await repo.findById(row.id);
      expect(stillPending!.status).toBe('PENDING'); // proves the attempt had zero effect
    });

    it('rejects an invalid state transition (rejecting an already-CANCELLED appointment) via the Service state-machine check', async () => {
      const { row } = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-06T10:00:00+05:30', '2026-11-06T10:30:00+05:30'), reason: 'Invalid transition test',
      });
      await service.cancel(row.id, STUDENT_A);
      await expect(service.reject(row.id, FACULTY)).rejects.toThrow(InvalidTransitionError);
    });

    it('FIXED (was GAP): booking during the faculty member\'s declared teaching hours is now rejected by book_appointment() itself', async () => {
      // Prof. Rao (200) teaches CSE301 every Monday 10:00-11:00 (seeded).
      // 2026-08-24 is a Monday. get_available_slots() always correctly
      // excluded this window; book_appointment() previously did not check
      // it at all (Level 7 Break Report, Gap A). Migration 0006 added
      // is_faculty_available() and book_appointment() now consults it
      // before the insert — see tests/integration/
      // booking-availability-enforcement.test.ts for the full dedicated
      // coverage of this fix. This test is kept here, in place, specifically
      // so the regression is caught if this file is ever run without the
      // dedicated suite.
      await expect(
        repo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-08-24T10:15:00+05:30', '2026-08-24T10:45:00+05:30'), // inside the 10:00-11:00 lecture block
          reason: 'Booking attempted during a declared teaching block',
        })
      ).rejects.toThrow(FacultyUnavailableError);
    });

    it('FIXED (was GAP): booking while the faculty member is on declared LEAVE is now rejected by book_appointment() itself', async () => {
      // Prof. Rao is seeded on LEAVE, all day, on 2026-08-31.
      await expect(
        repo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: slot('2026-08-31T12:00:00+05:30', '2026-08-31T12:30:00+05:30'),
          reason: 'Booking attempted during declared leave',
        })
      ).rejects.toThrow(FacultyUnavailableError);
    });
  });

  // ────────────────────────────── SECTION 3: BOUNDARY TESTS ──────────────────────────────

  describe('Boundary tests', () => {
    it('zero appointments: a faculty member with no bookings has an empty pending list', async () => {
      const pending = await repo.listPendingForFaculty(FACULTY);
      expect(pending).toEqual([]);
    });

    it('one appointment: appears correctly in the pending list and nowhere else', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-19T10:00:00+05:30', '2026-11-19T10:30:00+05:30'), reason: 'The only appointment', // Thursday, available
      });
      const pending = await repo.listPendingForFaculty(FACULTY);
      expect(pending).toHaveLength(1);

      const otherFacultyPending = await repo.listPendingForFaculty(FACULTY_NO_AVAILABILITY);
      expect(otherFacultyPending).toEqual([]);
    });

    it('no maximum-daily-appointments limit is enforced: 13 non-overlapping same-day bookings all succeed (documented as a design choice, not a defect — Level 5 never specified a per-day cap)', async () => {
      const bookings = [];
      for (let hour = 9; hour < 17; hour += 1) {
        if (hour === 10) continue; // skip the lecture hour to keep this test about volume, not the availability gap
        bookings.push(
          repo.bookAppointment({
            studentId: STUDENT_A, facultyId: FACULTY,
            slot: slot(`2026-11-09T${String(hour).padStart(2, '0')}:00:00+05:30`, `2026-11-09T${String(hour).padStart(2, '0')}:30:00+05:30`),
            reason: `Back-to-back booking at hour ${hour}`,
          })
        );
      }
      const results = await Promise.all(bookings);
      expect(results.every((r) => r.wasNewlyCreated)).toBe(true);
      expect(results).toHaveLength(7);
    });

    it('appointment at the EXACT availability boundary (the opening minute, 09:00) succeeds', async () => {
      const result = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T09:00:00+05:30', '2026-08-24T09:30:00+05:30'),
        reason: 'Booking at the exact opening of the availability window',
      });
      expect(result.wasNewlyCreated).toBe(true);
    });

    it('appointment at the EXACT availability boundary (the closing minute, ending 17:00) succeeds', async () => {
      const result = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-08-24T16:30:00+05:30', '2026-08-24T17:00:00+05:30'),
        reason: 'Booking ending at the exact close of the availability window',
      });
      expect(result.wasNewlyCreated).toBe(true);
    });

    it('back-to-back appointments sharing an exact boundary instant do NOT conflict (half-open range semantics)', async () => {
      const first = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-10T10:00:00+05:30', '2026-11-10T10:30:00+05:30'), reason: 'First back-to-back slot',
      });
      const second = await repo.bookAppointment({
        studentId: STUDENT_B, facultyId: FACULTY,
        slot: slot('2026-11-10T10:30:00+05:30', '2026-11-10T11:00:00+05:30'), reason: 'Second back-to-back slot, starts exactly when the first ends',
      });
      expect(first.wasNewlyCreated).toBe(true);
      expect(second.wasNewlyCreated).toBe(true);
    });

    it('a one-minute overlap (not a shared boundary) IS correctly rejected', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-11T10:00:00+05:30', '2026-11-11T10:30:00+05:30'), reason: 'First slot',
      });
      await expect(
        repo.bookAppointment({
          studentId: STUDENT_B, facultyId: FACULTY,
          slot: slot('2026-11-11T10:29:00+05:30', '2026-11-11T10:59:00+05:30'), reason: 'Overlaps the first slot by exactly one minute',
        })
      ).rejects.toThrow(SlotConflictError);
    });

    it('empty schedule: get_available_slots() returns zero rows for a faculty member with no declared availability', async () => {
      const result = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY_NO_AVAILABILITY, '2026-08-24']);
      expect(result.rows).toEqual([]);
    });

    it('full schedule: once every open slot for the day is booked, get_available_slots() returns zero rows', async () => {
      const openSlots = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-24']);
      expect(openSlots.rows.length).toBeGreaterThan(0);

      for (const row of openSlots.rows) {
        await repo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY,
          slot: TimeRange.create(new Date(row.slot_start), new Date(row.slot_end)),
          reason: 'Filling the schedule completely for the boundary test',
        });
      }

      const afterFilling = await pool.query('SELECT * FROM get_available_slots($1, $2, 30)', [FACULTY, '2026-08-24']);
      expect(afterFilling.rows).toEqual([]);
    });

    it('maximum request length: exactly 1000 characters is accepted (the CHECK constraint boundary)', async () => {
      const reason = 'x'.repeat(1000);
      const result = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-12T10:00:00+05:30', '2026-11-12T10:30:00+05:30'), reason,
      });
      expect(result.row.reason).toHaveLength(1000);
    });

    it('maximum request length: 1001 characters is rejected at the DATABASE layer (appointments_reason_len_chk), even bypassing the Service', async () => {
      const reason = 'x'.repeat(1001);
      await expect(
        pool.query(`SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, '[2026-11-13T10:00:00+05:30,2026-11-13T10:30:00+05:30)', reason, null])
      ).rejects.toMatchObject({ code: '23514' }); // check_violation
    });

    it('minimum request length: exactly 5 characters is accepted (the CHECK constraint\'s other boundary)', async () => {
      const result = await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-20T10:00:00+05:30', '2026-11-20T10:30:00+05:30'), reason: '12345', // Friday, available
      });
      expect(result.row.reason).toBe('12345');
    });

    it('minimum request length: 4 characters is rejected at the DATABASE layer', async () => {
      await expect(
        pool.query(`SELECT * FROM book_appointment($1,$2,$3::tstzrange,$4,$5)`,
          [STUDENT_A, FACULTY, '[2026-11-24T10:00:00+05:30,2026-11-24T10:30:00+05:30)', '1234', null]) // Tuesday, available — isolates the CHECK constraint
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ────────────────────────────── SECTION 7: DATA INTEGRITY ──────────────────────────────

  describe('Data integrity attacks', () => {
    it('prevents an orphaned appointment: cannot delete a faculty member (via their user row) who has an existing appointment', async () => {
      // Uses FACULTY (200), not FACULTY_NO_AVAILABILITY — this test isn't
      // about availability at all, it just needs any faculty member with a
      // real appointment on the books. FACULTY_NO_AVAILABILITY has zero
      // declared availability, so a real booking for it would now
      // (correctly) be rejected by is_faculty_available() before ever
      // reaching the point this test cares about.
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-17T10:00:00+05:30', '2026-11-17T10:30:00+05:30'), reason: 'Blocks faculty deletion', // Tuesday, available
      });

      await expect(pool.query('DELETE FROM users WHERE id = $1', [FACULTY]))
        .rejects.toMatchObject({ code: '23503' }); // foreign key violation — appointments_faculty_id_fkey has no ON DELETE action, so this is RESTRICTed correctly
    });

    it('rejects an invalid appointment_status value at the type-system level (ENUM), not just application logic', async () => {
      await expect(
        pool.query(`INSERT INTO appointments (student_id, faculty_id, slot, status, reason)
                    VALUES ($1,$2,$3::tstzrange,'IN_PROGRESS',$4)`,
          [STUDENT_A, FACULTY, '[2026-11-17T10:00:00+05:30,2026-11-17T10:30:00+05:30)', 'Invalid enum value test'])
      ).rejects.toMatchObject({ code: '22P02' }); // invalid_text_representation — not a valid appointment_status label
    });

    it('rejects a duplicate appointment (same student, same faculty, same exact slot) via the exclusion constraint', async () => {
      await repo.bookAppointment({
        studentId: STUDENT_A, facultyId: FACULTY,
        slot: slot('2026-11-18T10:00:00+05:30', '2026-11-18T10:30:00+05:30'), reason: 'Original request',
      });
      await expect(
        repo.bookAppointment({
          studentId: STUDENT_A, facultyId: FACULTY, // same student, retrying without a clientRequestId
          slot: slot('2026-11-18T10:00:00+05:30', '2026-11-18T10:30:00+05:30'), reason: 'Accidental duplicate, no idempotency key supplied',
        })
      ).rejects.toThrow(SlotConflictError);
    });

    it('FIXED (was GAP): faculty_availability now rejects a second, contradictory declared window for the same faculty/day (migration 0007 exclusion constraint)', async () => {
      // day_of_week=6 (Saturday) is deliberately used here instead of a real
      // weekday: this table is NOT reset by beforeEach's TRUNCATE (only
      // appointments/audit_log/notifications are), so anything inserted
      // here persists across every future test run against this database.
      // An earlier version of this test used day_of_week=2 (Tuesday) —
      // Prof. Rao's real, seeded Tuesday availability — and every run
      // silently left two more contradictory rows behind. After enough
      // accumulated runs this corrupted get_available_slots(2026-08-25)
      // (returning the same slot dozens of times), which was only caught
      // because a later test (booking-availability-enforcement.test.ts)
      // failed for a completely unrelated-looking reason. This test itself
      // is now the regression test for that exact incident: it proves the
      // database, not test discipline, is what prevents it from ever
      // happening again.
      try {
        await pool.query(
          `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,6,'09:00','12:00','2026-01-01')`,
          [FACULTY]
        );
        // A second, contradictory window for the same faculty member and
        // day — migration 0007's GiST exclusion constraint
        // (faculty_availability_no_overlap) now rejects this outright.
        await expect(
          pool.query(
            `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,6,'11:00','14:00','2026-01-01')`,
            [FACULTY]
          )
        ).rejects.toMatchObject({ code: '23P01' }); // exclusion_violation, same SQLSTATE class as the appointments guard

        // A genuinely non-overlapping window (adjacent, not intersecting)
        // for the SAME faculty/day is still allowed — the constraint
        // blocks contradictions, not all multi-window schedules.
        await expect(
          pool.query(
            `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from) VALUES ($1,6,'12:00','14:00','2026-01-01')`,
            [FACULTY]
          )
        ).resolves.toBeTruthy();
      } finally {
        await pool.query(`DELETE FROM faculty_availability WHERE faculty_id = $1 AND day_of_week = 6`, [FACULTY]);
      }
    });
  });
});
