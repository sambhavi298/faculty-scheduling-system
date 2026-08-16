import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../errors/validation.error';
import { NotFoundError } from '../errors/not-found.error';
import { SlotConflictError } from '../errors/slot-conflict.error';
import { FacultyUnavailableError } from '../errors/faculty-unavailable.error';
import { AlreadyProcessedError } from '../errors/already-processed.error';
import { InvalidTransitionError } from '../errors/invalid-transition.error';

/**
 * Central mapping from domain errors (thrown by AppointmentService /
 * AppointmentRepository) to HTTP status codes, per the Level 5 API
 * Contract Table. Controllers never inspect error types themselves — they
 * call `next(err)` and let this run last. Express recognizes this as
 * error-handling middleware purely by arity (4 declared parameters), so
 * `next` must stay in the signature even though this handler never calls it.
 *
 * This is the one place HTTP status codes are decided for domain errors —
 * keeping that decision out of the Controllers is what keeps them thin.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    return;
  }
  if (err instanceof SlotConflictError) {
    res.status(409).json({ error: 'SLOT_CONFLICT', message: err.message });
    return;
  }
  if (err instanceof FacultyUnavailableError) {
    res.status(409).json({ error: 'FACULTY_UNAVAILABLE', message: err.message });
    return;
  }
  if (err instanceof AlreadyProcessedError) {
    res.status(409).json({ error: 'ALREADY_PROCESSED', message: err.message });
    return;
  }
  if (err instanceof InvalidTransitionError) {
    res.status(409).json({ error: 'INVALID_TRANSITION', message: err.message });
    return;
  }

  // Unknown/unexpected error — never leak internals (stack traces, SQL, etc.) to the client.
  // eslint-disable-next-line no-console
  console.error('Unhandled error in request pipeline:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
}
