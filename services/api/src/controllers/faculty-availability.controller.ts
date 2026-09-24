import { Request, Response, NextFunction } from 'express';
import { FacultyAvailabilityService } from '../services/faculty-availability.service';

/** Thin HTTP adapter — same shape as every other controller in this codebase. Both endpoints act on the AUTHENTICATED caller's own faculty id (req.user!.id), never a path or body id, matching the "own availability only" scope in the Level 5 API contract table. */
export function createFacultyAvailabilityController(service: FacultyAvailabilityService) {
  return {
    /** PUT /api/faculty/availability — Faculty only. Body: an array of {dayOfWeek, startTime, endTime, effectiveFrom, effectiveUntil?}, replacing the caller's ENTIRE declared availability set. */
    async replaceAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.replaceAvailability(req.user!.id, req.body);
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** POST /api/faculty/availability/exceptions — Faculty only. Body: {date, startTime?, endTime?, type, reason?}. */
    async addException(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const row = await service.addException(req.user!.id, req.body ?? {});
        res.status(201).json(row);
      } catch (err) {
        next(err);
      }
    },
  };
}

export type FacultyAvailabilityController = ReturnType<typeof createFacultyAvailabilityController>;
