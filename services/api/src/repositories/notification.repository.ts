import { Queryable } from '../db/queryable';

export interface NotificationRow {
  id: string;
  recipient_id: string;
  appointment_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

/**
 * Ordinary CRUD over `notifications` (migrations/sql/0002) — no exotic SQL
 * needed here, matching Level 5 Section 2's classification of
 * NotificationRepository as plain ORM-shaped usage (unlike
 * AppointmentRepository, which wraps a stored function). Every write here is
 * a single-row INSERT/UPDATE against a table with no constraints beyond
 * ordinary foreign keys, so there is nothing for the database layer to
 * guard here the way the exclusion constraint guards appointments.
 */
export class NotificationRepository {
  constructor(private readonly db: Queryable) {}

  async insert(recipientId: string, appointmentId: string | null, type: string, message: string): Promise<NotificationRow> {
    const result = await this.db.query<NotificationRow>(
      `INSERT INTO notifications (recipient_id, appointment_id, type, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [recipientId, appointmentId, type, message]
    );
    return result.rows[0];
  }

  /** All of a user's notifications, most recent first — backs GET /api/notifications/mine. Uses `notifications_unread_idx` for the common unread-first-page case even though this reads both read and unread, since (recipient_id, is_read) is still a useful leading-column match. */
  async listForUser(recipientId: string, limit = 50): Promise<NotificationRow[]> {
    const result = await this.db.query<NotificationRow>(
      `SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [recipientId, limit]
    );
    return result.rows;
  }

  async listUnreadForUser(recipientId: string): Promise<NotificationRow[]> {
    const result = await this.db.query<NotificationRow>(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND is_read = FALSE ORDER BY created_at DESC`,
      [recipientId]
    );
    return result.rows;
  }

  /** Guarded by recipient ownership in the WHERE clause — the same "guard in SQL, not a separate check-then-write" shape AppointmentRepository's guardedUpdate uses, so a caller can never mark someone else's notification read even via a direct repository call. */
  async markRead(id: string, recipientId: string): Promise<NotificationRow | null> {
    const result = await this.db.query<NotificationRow>(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND recipient_id = $2 RETURNING *`,
      [id, recipientId]
    );
    return result.rows[0] ?? null;
  }
}
