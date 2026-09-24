import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service';
import { ValidationError } from '../errors/validation.error';

function notificationIdParam(req: Request): string {
  const { id } = req.params;
  if (typeof id !== 'string') {
    throw new ValidationError('notification id must be a single path segment');
  }
  return id;
}

/** Thin HTTP adapter over NotificationService — same shape as every other controller in this codebase. */
export function createNotificationController(service: NotificationService) {
  return {
    /** GET /api/notifications/mine — any authenticated user, their own notifications only. */
    async listMine(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.listMine(req.user!.id);
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/notifications/:id/read — any authenticated user, must own the notification. */
    async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.markRead(notificationIdParam(req), req.user!.id);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },
  };
}

export type NotificationController = ReturnType<typeof createNotificationController>;
