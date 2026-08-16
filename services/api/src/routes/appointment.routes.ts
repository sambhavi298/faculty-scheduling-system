import { Router } from 'express';
import { AppointmentController } from '../controllers/appointment.controller';
import { requireRole } from '../middleware/identify.middleware';

/**
 * Routes for the Appointment Management module — Level 5 API Contract
 * Table. Every endpoint here is backed by an already-implemented,
 * already-tested AppointmentService method; this file only wires HTTP
 * verb + path + role restriction to the matching Controller handler.
 *
 * Deliberately NOT included in this pass: `GET /api/faculty/:facultyId/availability`,
 * `PUT /api/faculty/availability`, `POST /api/faculty/availability/exceptions`
 * (Faculty Availability module) and any admin/reporting endpoints. Those
 * need a FacultyAvailabilityRepository/Service that doesn't exist yet
 * (`docs/IMPLEMENTATION_STATUS.md`: "Availability ... No application-layer
 * Repository/Service yet") — building routes against nothing would mean
 * inventing behavior instead of wrapping tested code, which is the opposite
 * of what this Phase 2 pass is for.
 */
export function createAppointmentRouter(controller: AppointmentController): Router {
  const router = Router();

  router.post('/appointments', requireRole('STUDENT'), controller.requestAppointment);
  router.get('/appointments/mine', requireRole('STUDENT'), controller.listMine);
  router.get('/appointments/pending', requireRole('FACULTY'), controller.listPending);
  router.patch('/appointments/:id/approve', requireRole('FACULTY'), controller.approve);
  router.patch('/appointments/:id/reject', requireRole('FACULTY'), controller.reject);
  router.patch('/appointments/:id/cancel', requireRole('STUDENT', 'FACULTY'), controller.cancel);
  router.patch('/appointments/:id/complete', requireRole('FACULTY'), controller.complete);
  router.patch('/appointments/:id/missed', requireRole('FACULTY'), controller.markMissed);

  return router;
}
