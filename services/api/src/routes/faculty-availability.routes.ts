import { Router } from 'express';
import { FacultyAvailabilityController } from '../controllers/faculty-availability.controller';
import { requireRole } from '../middleware/identify.middleware';

/** The write side of the Faculty Availability module — Level 5 API contract table. Both "own availability only," so FACULTY-only (unlike the read-side faculty.routes.ts, which any authenticated role may call). */
export function createFacultyAvailabilityRouter(controller: FacultyAvailabilityController): Router {
  const router = Router();

  router.put('/faculty/availability', requireRole('FACULTY'), controller.replaceAvailability);
  router.post('/faculty/availability/exceptions', requireRole('FACULTY'), controller.addException);

  return router;
}
