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
  // Registered ahead of '/faculty/:id/availability' on principle (an exact
  // literal segment before a param route), though the two paths don't
  // actually collide today ('/faculty/me/stats' has no '/availability'
  // suffix) — keeps this file safe against that changing later.
  router.get('/faculty/me/stats', requireRole('FACULTY'), controller.getOwnStats);
  router.get('/faculty/:id/availability', requireRole('STUDENT', 'FACULTY'), controller.getAvailability);

  return router;
}
