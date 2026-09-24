import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { requireRole } from '../middleware/identify.middleware';

/** A user's own in-app notifications (Level 5, Section 2: NotificationService). Open to every role — a notification is scoped by recipient_id at the repository layer, not by role. */
export function createNotificationRouter(controller: NotificationController): Router {
  const router = Router();

  router.get('/notifications/mine', requireRole('STUDENT', 'FACULTY', 'ADMIN'), controller.listMine);
  router.patch('/notifications/:id/read', requireRole('STUDENT', 'FACULTY', 'ADMIN'), controller.markRead);

  return router;
}
