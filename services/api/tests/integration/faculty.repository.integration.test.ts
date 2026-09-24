import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { FacultyRepository } from '../../src/repositories/faculty.repository';
import { AppointmentRepository } from '../../src/repositories/appointment.repository';
import { TimeRange } from '../../src/domain/time-range';

/**
 * Integration tests — exercise FacultyRepository against a REAL PostgreSQL
 * instance running the actual schema (migrations 0001-0008), not a mock,
 * same convention as tests/integration/appointment.repository.integration.test.ts.
 *
 * Seed data:
 *   - migrations/sql/seed_test_data.sql: faculty 200 (Prof. Rao, Computer
 *     Science), faculty 201 (Prof. Iyer, Computer Science).
 *   - migrations/sql/seed_availability_test_data.sql: Prof. Rao (200) is
 *     open Mon-Fri 09:00-17:00, teaches CSE301 every Monday 10:00-11:00
 *     (blocked even though inside the open window), and is on full-day
 *     LEAVE on 2026-08-31. Prof. Iyer (201) deliberately has ZERO
 *     faculty_availability rows — used elsewhere in this test suite as "the
 *     faculty member with no declared availability."
 *   - 2026-08-24 is a Monday, 2026-08-25 is a Tuesday (day_of_week=2, no
 *     teaching/leave conflicts), 2026-08-31 is Prof. Rao's leave day.
 */

const FACULTY_RAO = '200';
const FACULTY_IYER = '201';
const STUDENT_A = '100';

describe('FacultyRepository (integration — real PostgreSQL)', () => {
  let pool: Pool;
  let repo: FacultyRepository;
  let appointmentRepo: AppointmentRepository;

  beforeAll(() => {
    pool = createPool();
    repo = new FacultyRepository(pool);
    appointmentRepo = new AppointmentRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  describe('listFaculty', () => {
    it('returns every seeded faculty member, joined to their real name and department, when no search is given', async () => {
      const rows = await repo.listFaculty(null);

      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(FACULTY_RAO)).toEqual({ id: FACULTY_RAO, name: 'Prof. Rao', department: 'Computer Science' });
      expect(byId.get(FACULTY_IYER)).toEqual({ id: FACULTY_IYER, name: 'Prof. Iyer', department: 'Computer Science' });
    });

    it('filters by a case-insensitive substring match on name', async () => {
      const rows = await repo.listFaculty('rao');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(FACULTY_RAO);

      const upper = await repo.listFaculty('RAO');
      expect(upper).toHaveLength(1);
      expect(upper[0].id).toBe(FACULTY_RAO);
    });

    it('returns an empty array when the search matches nobody', async () => {
      const rows = await repo.listFaculty('there-is-no-faculty-named-this');
      expect(rows).toEqual([]);
    });

    it('returns results ordered by name', async () => {
      const rows = await repo.listFaculty(null);
      const names = rows.map((r) => r.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe('findById', () => {
    it('returns the row for a real faculty id', async () => {
      expect(await repo.findById(FACULTY_RAO)).toEqual({ id: FACULTY_RAO });
    });

    it('returns null for a well-formed but nonexistent faculty id', async () => {
      expect(await repo.findById('999999')).toBeNull();
    });
  });

  describe('getAvailableSlots', () => {
    it("returns real open slots within Prof. Rao's declared 09:00-17:00 window on an unblocked weekday", async () => {
      const rows = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-25', 30); // Tuesday — no teaching block, no leave

      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.slot_start).toBeInstanceOf(Date);
        expect(r.slot_end).toBeInstanceOf(Date);
        expect(r.slot_end.getTime()).toBeGreaterThan(r.slot_start.getTime());
      }
      // First slot opens at 09:00 IST, last slot ends by 17:00 IST.
      const first = rows[0];
      const last = rows[rows.length - 1];
      expect(first.slot_start.toISOString()).toBe('2026-08-25T03:30:00.000Z'); // 09:00 IST = 03:30 UTC
      expect(last.slot_end.getTime()).toBeLessThanOrEqual(new Date('2026-08-25T11:30:00.000Z').getTime()); // 17:00 IST = 11:30 UTC
    });

    it("excludes the 10:00-11:00 teaching block on a Monday, even though it's inside the open availability window", async () => {
      const rows = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-24', 30); // Monday — CSE301 10:00-11:00 IST

      const blockStart = new Date('2026-08-24T04:30:00.000Z').getTime(); // 10:00 IST
      const blockEnd = new Date('2026-08-24T05:30:00.000Z').getTime(); // 11:00 IST
      for (const r of rows) {
        const overlapsBlock = r.slot_start.getTime() < blockEnd && blockStart < r.slot_end.getTime();
        expect(overlapsBlock).toBe(false);
      }
      expect(rows.length).toBeGreaterThan(0); // the rest of the day is still open
    });

    it('returns no slots at all on a day the faculty member is on full-day leave', async () => {
      const rows = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-31', 30);
      expect(rows).toEqual([]);
    });

    it('returns no slots for a faculty member with no declared availability at all', async () => {
      const rows = await repo.getAvailableSlots(FACULTY_IYER, '2026-08-25', 30);
      expect(rows).toEqual([]);
    });

    it('excludes a slot that already has a real PENDING/APPROVED appointment booked against it', async () => {
      const before = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-25', 30);
      const nineToNineThirty = before.find(
        (r) => r.slot_start.toISOString() === '2026-08-25T03:30:00.000Z'
      );
      expect(nineToNineThirty).toBeDefined(); // sanity: open before booking

      await appointmentRepo.bookAppointment({
        studentId: STUDENT_A,
        facultyId: FACULTY_RAO,
        slot: TimeRange.create(new Date('2026-08-25T09:00:00+05:30'), new Date('2026-08-25T09:30:00+05:30')),
        reason: 'Taking this slot so getAvailableSlots must exclude it',
      });

      const after = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-25', 30);
      const stillThere = after.some((r) => r.slot_start.toISOString() === '2026-08-25T03:30:00.000Z');
      expect(stillThere).toBe(false);
      // The rest of the day's slots are unaffected by one booking.
      expect(after.length).toBe(before.length - 1);
    });

    it('respects a custom slotMinutes, changing how many candidate slots a window produces', async () => {
      const thirty = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-25', 30);
      const sixty = await repo.getAvailableSlots(FACULTY_RAO, '2026-08-25', 60);
      expect(sixty.length).toBeLessThan(thirty.length);
      for (const r of sixty) {
        expect(r.slot_end.getTime() - r.slot_start.getTime()).toBe(60 * 60 * 1000);
      }
    });
  });
});
