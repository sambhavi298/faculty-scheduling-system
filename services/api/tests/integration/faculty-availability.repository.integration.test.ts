import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { FacultyAvailabilityRepository } from '../../src/repositories/faculty-availability.repository';
import { AvailabilityOverlapError } from '../../src/errors/availability-overlap.error';

/**
 * Integration tests — exercise FacultyAvailabilityRepository against a REAL
 * PostgreSQL instance, same convention as
 * tests/integration/faculty.repository.integration.test.ts.
 *
 * Deliberately does NOT touch the seeded faculty 200/201 (Prof. Rao / Prof.
 * Iyer) — several other integration and HTTP test files (faculty.repository.
 * integration.test.ts, faculty.http.test.ts, appointment.*.test.ts) assert
 * against their specific seeded availability windows, and replaceAvailability
 * deactivates a faculty member's ENTIRE availability set as a side effect.
 * Instead this creates its own throwaway faculty fixture (a real users +
 * faculty row, id 9001, department 1 which seed_test_data.sql already
 * creates) in beforeAll and deletes it in afterAll — the delete cascades
 * through faculty_availability/faculty_schedule_exceptions via their real
 * ON DELETE CASCADE foreign keys (migrations/sql/0001/0007), so no manual
 * child cleanup is needed.
 */
const TEST_FACULTY_ID = '9001';

describe('FacultyAvailabilityRepository (integration — real PostgreSQL)', () => {
  let pool: Pool;
  let repo: FacultyAvailabilityRepository;

  beforeAll(async () => {
    pool = createPool();
    repo = new FacultyAvailabilityRepository(pool);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, 'test.fixture.9001@example.edu', 'x', 'Test Fixture Faculty', 'FACULTY')`,
      [TEST_FACULTY_ID]
    );
    await pool.query(`INSERT INTO faculty (id, department_id, staff_code) VALUES ($1, 1, 'TEST-9001')`, [TEST_FACULTY_ID]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_FACULTY_ID]);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM faculty_availability WHERE faculty_id = $1', [TEST_FACULTY_ID]);
    await pool.query('DELETE FROM faculty_schedule_exceptions WHERE faculty_id = $1', [TEST_FACULTY_ID]);
  });

  describe('facultyExists', () => {
    it('returns true for the real fixture faculty id', async () => {
      expect(await repo.facultyExists(TEST_FACULTY_ID)).toBe(true);
    });

    it('returns false for a nonexistent id', async () => {
      expect(await repo.facultyExists('999999')).toBe(false);
    });
  });

  describe('replaceAvailability', () => {
    it('inserts a fresh set of active windows for a faculty member with none yet', async () => {
      const rows = await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].is_active).toBe(true);
      expect(rows[0].day_of_week).toBe(1);

      const active = await repo.listActiveWindows(TEST_FACULTY_ID);
      expect(active).toHaveLength(1);
    });

    it('deactivates the previous set and replaces it atomically — only the new set is active afterward', async () => {
      await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' },
      ]);

      const secondSet = await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 3, startTime: '10:00', endTime: '14:00', effectiveFrom: '2026-08-01' },
      ]);

      expect(secondSet).toHaveLength(1);
      expect(secondSet[0].day_of_week).toBe(3);

      const active = await repo.listActiveWindows(TEST_FACULTY_ID);
      expect(active).toHaveLength(1);
      expect(active[0].day_of_week).toBe(3);
    });

    it('an empty array clears all active availability', async () => {
      await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' },
      ]);

      const result = await repo.replaceAvailability(TEST_FACULTY_ID, []);

      expect(result).toEqual([]);
      expect(await repo.listActiveWindows(TEST_FACULTY_ID)).toEqual([]);
    });

    it('throws AvailabilityOverlapError (from the real faculty_availability_no_overlap exclusion constraint) for two overlapping windows submitted together', async () => {
      await expect(
        repo.replaceAvailability(TEST_FACULTY_ID, [
          { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-08-01' },
          { dayOfWeek: 1, startTime: '11:00', endTime: '14:00', effectiveFrom: '2026-08-01' },
        ])
      ).rejects.toThrow(AvailabilityOverlapError);
    });

    it('allows two non-overlapping windows on the same day', async () => {
      const rows = await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-08-01' },
        { dayOfWeek: 1, startTime: '13:00', endTime: '17:00', effectiveFrom: '2026-08-01' },
      ]);
      expect(rows).toHaveLength(2);
    });

    it('allows the same time window on different days', async () => {
      const rows = await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' },
        { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01' },
      ]);
      expect(rows).toHaveLength(2);
    });

    it('does not consider disjoint effective-date ranges an overlap even on the same day/time', async () => {
      const rows = await repo.replaceAvailability(TEST_FACULTY_ID, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-08-01', effectiveUntil: '2026-08-31' },
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-09-01' },
      ]);
      expect(rows).toHaveLength(2);
    });
  });

  describe('addException', () => {
    it('persists a real whole-day LEAVE exception', async () => {
      const row = await repo.addException(TEST_FACULTY_ID, { date: '2026-08-31', type: 'LEAVE', reason: 'Conference' });

      expect(row.faculty_id).toBe(TEST_FACULTY_ID);
      expect(row.exception_date).toBe('2026-08-31');
      expect(row.exception_type).toBe('LEAVE');
      expect(row.start_time).toBeNull();
      expect(row.reason).toBe('Conference');
    });

    it('persists a real partial-day MEETING exception', async () => {
      const row = await repo.addException(TEST_FACULTY_ID, { date: '2026-08-25', type: 'MEETING', startTime: '10:00', endTime: '11:00' });

      expect(row.start_time).toBe('10:00:00');
      expect(row.end_time).toBe('11:00:00');
    });

    it('allows multiple exceptions on different dates without conflict (no exclusion constraint on this table)', async () => {
      await repo.addException(TEST_FACULTY_ID, { date: '2026-08-25', type: 'LEAVE' });
      await repo.addException(TEST_FACULTY_ID, { date: '2026-08-26', type: 'LEAVE' });

      const count = await pool.query('SELECT count(*) FROM faculty_schedule_exceptions WHERE faculty_id = $1', [TEST_FACULTY_ID]);
      expect(Number(count.rows[0].count)).toBe(2);
    });
  });
});
