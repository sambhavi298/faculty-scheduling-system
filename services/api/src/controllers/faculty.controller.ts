import { Request, Response, NextFunction } from 'express';
import { FacultyService } from '../services/faculty.service';
import { ValidationError } from '../errors/validation.error';

/**
 * Same reasoning as appointment.controller.ts's idParam(): Express types a
 * route param as `string | string[]` in general (path-to-regexp allows
 * repeating params), even though this route only ever declares a plain
 * `:id`. Narrowed explicitly rather than cast.
 */
function facultyIdParam(req: Request): string {
  const { id } = req.params;
  if (typeof id !== 'string') {
    throw new ValidationError('faculty id must be a single path segment');
  }
  return id;
}

/** A query string value that Express may hand back as string | string[] | ParsedQs | ParsedQs[] | undefined — this route only ever expects a plain string, so anything else is treated as absent/invalid rather than guessed at. */
function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Thin HTTP adapter over FacultyService, same shape and responsibilities as
 * appointment.controller.ts's createAppointmentController: read the
 * request, call the one Service method that does the real work, send a
 * response or call next(err). No business rules or SQL live here.
 */
export function createFacultyController(service: FacultyService) {
  return {
    /** GET /api/faculty — any authenticated caller (student or faculty). Optional ?search= filters by name. */
    async listFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.listFaculty(queryString(req, 'search'));
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/faculty/:id/availability — any authenticated caller. Requires ?date=YYYY-MM-DD; optional ?slotMinutes=. */
    async getAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const facultyId = facultyIdParam(req);
        const date = queryString(req, 'date') ?? '';
        const slotMinutesRaw = queryString(req, 'slotMinutes');

        let slotMinutes: number | undefined;
        if (slotMinutesRaw !== undefined) {
          const parsed = Number(slotMinutesRaw);
          // Deliberately NOT validated further here (e.g. "is it a positive
          // integer?") — that's FacultyService.getAvailability()'s job, same
          // as every other validation rule in this codebase. A non-numeric
          // string becomes NaN, which the Service's Number.isInteger() check
          // rejects with the same ValidationError as any other bad value.
          slotMinutes = parsed;
        }

        const rows = await service.getAvailability(facultyId, date, slotMinutes);
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/faculty/me/stats — FACULTY only, always the caller's own row (req.user!.id), never a path param. */
    async getOwnStats(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.getOwnStats(req.user!.id);
        res.status(200).json(row);
      } catch (err) {
        next(err);
      }
    },
  };
}

export type FacultyController = ReturnType<typeof createFacultyController>;
