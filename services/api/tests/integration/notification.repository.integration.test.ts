import { Pool } from 'pg';
import { createPool } from '../../src/db/client';
import { NotificationRepository } from '../../src/repositories/notification.repository';

/**
 * Integration tests — exercise NotificationRepository against a REAL
 * PostgreSQL instance, same convention as
 * tests/integration/faculty.repository.integration.test.ts.
 *
 * recipient_id has a real FK to users(id) (ON DELETE CASCADE),
 * appointment_id a real (nullable) FK to appointments(id) (ON DELETE SET
 * NULL) — seeded students 100/101 and faculty 200/201 are used as real
 * recipients throughout.
 */
const STUDENT_A = '100';
const STUDENT_B = '101';

describe('NotificationRepository (integration — real PostgreSQL)', () => {
  let pool: Pool;
  let repo: NotificationRepository;

  beforeAll(() => {
    pool = createPool();
    repo = new NotificationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE appointments, audit_log, notifications RESTART IDENTITY CASCADE');
  });

  describe('insert', () => {
    it('persists a real row with a null appointment_id', async () => {
      const row = await repo.insert(STUDENT_A, null, 'APPOINTMENT_APPROVED', 'Your appointment request was approved.');

      expect(row.id).toBeDefined();
      expect(row.recipient_id).toBe(STUDENT_A);
      expect(row.appointment_id).toBeNull();
      expect(row.is_read).toBe(false);
      expect(row.created_at).toBeDefined();
    });

    it('rejects a recipient_id that does not reference a real user', async () => {
      await expect(repo.insert('999999', null, 'APPOINTMENT_APPROVED', 'msg')).rejects.toThrow();
    });
  });

  describe('listForUser', () => {
    it('returns only the given recipient\'s notifications, most recent first', async () => {
      await repo.insert(STUDENT_A, null, 'APPOINTMENT_APPROVED', 'first');
      await repo.insert(STUDENT_B, null, 'APPOINTMENT_APPROVED', 'not mine');
      await repo.insert(STUDENT_A, null, 'APPOINTMENT_REJECTED', 'second');

      const rows = await repo.listForUser(STUDENT_A);

      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.recipient_id === STUDENT_A)).toBe(true);
      expect(rows[0].message).toBe('second'); // most recent first
      expect(rows[1].message).toBe('first');
    });

    it('respects a custom limit', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.insert(STUDENT_A, null, 'APPOINTMENT_APPROVED', `msg-${i}`);
      }

      const rows = await repo.listForUser(STUDENT_A, 2);
      expect(rows).toHaveLength(2);
    });

    it('returns an empty array for a user with no notifications', async () => {
      expect(await repo.listForUser(STUDENT_B)).toEqual([]);
    });
  });

  describe('listUnreadForUser', () => {
    it('excludes notifications already marked read', async () => {
      const first = await repo.insert(STUDENT_A, null, 'APPOINTMENT_APPROVED', 'read-me');
      await repo.insert(STUDENT_A, null, 'APPOINTMENT_REJECTED', 'still-unread');
      await repo.markRead(first.id, STUDENT_A);

      const rows = await repo.listUnreadForUser(STUDENT_A);

      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('still-unread');
    });
  });

  describe('markRead', () => {
    it('marks a real owned notification as read', async () => {
      const created = await repo.insert(STUDENT_A, null, 'APPOINTMENT_APPROVED', 'msg');

      const updated = await repo.markRead(created.id, STUDENT_A);

      expect(updated).not.toBeNull();
      expect(updated!.is_read).toBe(true);
    });

    it('returns null and does NOT mark it read when another user attempts it (ownership guard)', async () => {
      const created = await repo.insert(STUDENT_A, null, 'APPOINTMENT_APPROVED', 'msg');

      const result = await repo.markRead(created.id, STUDENT_B);
      expect(result).toBeNull();

      const stillUnread = await repo.listUnreadForUser(STUDENT_A);
      expect(stillUnread.some((r) => r.id === created.id)).toBe(true);
    });

    it('returns null for a nonexistent notification id', async () => {
      expect(await repo.markRead('999999', STUDENT_A)).toBeNull();
    });
  });
});
