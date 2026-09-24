import { Router } from 'express';
import { FacultyController } from '../controllers/faculty.controller';
import { requireRole } from '../middleware/identify.middleware';

/**
 * Routes for the Faculty Directory module. Both endpoints are read-only
 * lookups a student needs before requesting an appointment (browse/search
 * faculty, then check a specific faculty member's real available slots for a
 * date) — a faculty member may reasonably want the same two lookups (e.g. to
 * see a colleague's availability), so both are open to either role, the same
 * pattern PATCH /api/appointments/:id/cancel already uses for "either party
 * may do this."
 */
export function createFacultyRouter(controller: FacultyController): Router {
  const router = Router();

  router.get('/faculty', requireRole('STUDENT', 'FACULTY'), controller.listFaculty);
  router.get('/faculty/:id/availability', requireRole('STUDENT', 'FACULTY'), controller.getAvailability);

  return router;
}
