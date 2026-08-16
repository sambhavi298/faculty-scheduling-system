import { Request, Response, NextFunction } from 'express';
import { AppointmentService } from '../services/appointment.service';
import { ValidationError } from '../errors/validation.error';

/**
 * Express 5's ParamsDictionary types a route param as `string | string[]`
 * (path-to-regexp allows repeating params like `:id+`). This route only
 * ever declares a plain `:id`, so a real request always yields a single
 * string — but the type doesn't know that. Rather than silently casting,
 * this narrows explicitly and fails with a clear 400 in the (practically
 * unreachable, but type-honest) case where it isn't a plain string.
 */
function idParam(req: Request): string {
  const { id } = req.params;
  if (typeof id !== 'string') {
    throw new ValidationError('appointment id must be a single path segment');
  }
  return id;
}

/**
 * Thin HTTP adapter over AppointmentService. Per the architecture (README
 * "Architecture overview" and Level 5): Controllers own HTTP concerns only
 * — reading the request, choosing the status code, shaping the response —
 * never SQL, never business rules. Every rule enforced here (ownership,
 * idempotency, state transitions, availability) already lives in
 * AppointmentService/AppointmentRepository/the database; this layer only
 * translates between HTTP and that existing, already-tested code.
 *
 * Every handler follows the same shape: pull inputs out of the request
 * (including `req.user`, populated by the `identify` middleware), call the
 * one Service method that does the real work, and either send a response or
 * call `next(err)` so `errorHandler` can decide the status code. No
 * try/catch branches on error *type* ever belong here — that would be
 * business logic leaking into the Controller.
 */
export function createAppointmentController(service: AppointmentService) {
  return {
    /** POST /api/appointments — Student only (Level 5, Section 11). */
    async requestAppointment(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { facultyId, slotStart, slotEnd, reason, clientRequestId } = req.body ?? {};
        const result = await service.requestAppointment({
          studentId: req.user!.id,
          facultyId,
          slot: { start: new Date(slotStart), end: new Date(slotEnd) },
          reason,
          clientRequestId,
        });
        res.status(201).json(result.appointment);
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/appointments/mine — Student only. */
    async listMine(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.listForStudent(req.user!.id);
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/appointments/pending — Faculty only. */
    async listPending(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.listPendingForFaculty(req.user!.id);
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/appointments/:id/approve — Faculty, must own. */
    async approve(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.approve(idParam(req), req.user!.id);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/appointments/:id/reject — Faculty, must own. */
    async reject(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.reject(idParam(req), req.user!.id);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/appointments/:id/cancel — Student or faculty, must be a party to the appointment. */
    async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.cancel(idParam(req), req.user!.id);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/appointments/:id/complete — Faculty, must own. */
    async complete(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { notes } = req.body ?? {};
        const row = await service.complete(idParam(req), req.user!.id, notes);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/appointments/:id/missed — Faculty (or a future system scheduler). */
    async markMissed(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.markMissed(idParam(req), req.user!.id);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },
  };
}

export type AppointmentController = ReturnType<typeof createAppointmentController>;
