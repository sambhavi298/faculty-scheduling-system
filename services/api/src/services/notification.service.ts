import { NotificationRepository, NotificationRow } from '../repositories/notification.repository';
import { NotFoundError } from '../errors/not-found.error';

export type NotificationType =
  | 'APPOINTMENT_REQUESTED'
  | 'APPOINTMENT_APPROVED'
  | 'APPOINTMENT_REJECTED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_COMPLETED'
  | 'APPOINTMENT_MISSED';

export interface NotifyPayload {
  appointmentId: string;
  actorName?: string;
  slotStart?: string;
  reason?: string;
}

/**
 * Formats a human-readable message per notification type. A `type ->
 * formatter` map, per Level 5 Section 10's Strategy pattern choice: adding a
 * new notification type means adding a new map entry, never editing
 * NotificationService's or AppointmentService's control flow (Open/Closed,
 * Level 5 Section 9) — the alternative (a switch statement inside notify())
 * was explicitly rejected there for exactly this reason.
 */
const FORMATTERS: Record<NotificationType, (payload: NotifyPayload) => string> = {
  APPOINTMENT_REQUESTED: (p) => `New appointment request${p.actorName ? ` from ${p.actorName}` : ''}${p.reason ? `: "${p.reason}"` : ''}.`,
  APPOINTMENT_APPROVED: () => `Your appointment request was approved.`,
  APPOINTMENT_REJECTED: () => `Your appointment request was rejected.`,
  APPOINTMENT_CANCELLED: (p) => `An appointment was cancelled${p.actorName ? ` by ${p.actorName}` : ''}.`,
  APPOINTMENT_COMPLETED: () => `Your appointment was marked completed.`,
  APPOINTMENT_MISSED: () => `Your appointment was marked missed.`,
};

/**
 * Level 5, Section 2: "Creates and reads in-app notifications." In-app
 * records only (Level 2's chosen scope — no email/SMS/WebSocket), populated
 * exclusively from real appointment lifecycle events; nothing here
 * fabricates a notification a user didn't actually earn from a real action.
 */
export class NotificationService {
  constructor(private readonly repo: NotificationRepository) {}

  async notify(recipientId: string, type: NotificationType, payload: NotifyPayload): Promise<NotificationRow> {
    const message = FORMATTERS[type](payload);
    return this.repo.insert(recipientId, payload.appointmentId, type, message);
  }

  async listMine(userId: string): Promise<NotificationRow[]> {
    return this.repo.listForUser(userId);
  }

  async listUnread(userId: string): Promise<NotificationRow[]> {
    return this.repo.listUnreadForUser(userId);
  }

  async markRead(id: string, userId: string): Promise<NotificationRow> {
    const updated = await this.repo.markRead(id, userId);
    if (!updated) {
      throw new NotFoundError();
    }
    return updated;
  }
}
