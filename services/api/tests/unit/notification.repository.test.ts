import { NotificationRepository, NotificationRow } from '../../src/repositories/notification.repository';
import { Queryable } from '../../src/db/queryable';

function fakeDb(): jest.Mocked<Queryable> {
  return { query: jest.fn() };
}

function notificationRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: '1',
    recipient_id: '100',
    appointment_id: '5000',
    type: 'APPOINTMENT_APPROVED',
    message: 'Your appointment request was approved.',
    is_read: false,
    created_at: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationRepository (unit — mocked Queryable boundary)', () => {
  describe('insert', () => {
    it('inserts with the four positional columns and returns the created row', async () => {
      const db = fakeDb();
      const row = notificationRow();
      db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
      const repo = new NotificationRepository(db);

      const result = await repo.insert('100', '5000', 'APPOINTMENT_APPROVED', 'Your appointment request was approved.');

      expect(result).toEqual(row);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO notifications/);
      expect(sql).toMatch(/RETURNING \*/);
      expect(params).toEqual(['100', '5000', 'APPOINTMENT_APPROVED', 'Your appointment request was approved.']);
    });

    it('allows a null appointmentId', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [notificationRow({ appointment_id: null })], rowCount: 1 });
      const repo = new NotificationRepository(db);

      await repo.insert('100', null, 'APPOINTMENT_APPROVED', 'msg');

      expect(db.query.mock.calls[0][1]).toEqual(['100', null, 'APPOINTMENT_APPROVED', 'msg']);
    });
  });

  describe('listForUser', () => {
    it('defaults limit to 50 and orders by created_at DESC', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new NotificationRepository(db);

      await repo.listForUser('100');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/WHERE recipient_id = \$1/);
      expect(sql).toMatch(/ORDER BY created_at DESC/);
      expect(sql).toMatch(/LIMIT \$2/);
      expect(params).toEqual(['100', 50]);
    });

    it('passes a custom limit through', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new NotificationRepository(db);

      await repo.listForUser('100', 5);

      expect(db.query.mock.calls[0][1]).toEqual(['100', 5]);
    });

    it('returns the rows unchanged', async () => {
      const db = fakeDb();
      const rows = [notificationRow(), notificationRow({ id: '2' })];
      db.query.mockResolvedValueOnce({ rows, rowCount: 2 });
      const repo = new NotificationRepository(db);

      expect(await repo.listForUser('100')).toEqual(rows);
    });
  });

  describe('listUnreadForUser', () => {
    it('filters to is_read = FALSE for the given recipient', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new NotificationRepository(db);

      await repo.listUnreadForUser('100');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/recipient_id = \$1 AND is_read = FALSE/);
      expect(params).toEqual(['100']);
    });
  });

  describe('markRead', () => {
    it('guards by BOTH id and recipient_id in the WHERE clause', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [notificationRow({ is_read: true })], rowCount: 1 });
      const repo = new NotificationRepository(db);

      await repo.markRead('1', '100');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/UPDATE notifications SET is_read = TRUE/);
      expect(sql).toMatch(/WHERE id = \$1 AND recipient_id = \$2/);
      expect(params).toEqual(['1', '100']);
    });

    it('returns null when no row matched (wrong id, or not owned by this recipient)', async () => {
      const db = fakeDb();
      db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new NotificationRepository(db);

      expect(await repo.markRead('999', '100')).toBeNull();
    });
  });
});
