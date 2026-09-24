import { Router } from 'express';
import { AppointmentController } from '../controllers/appointment.controller';
import { requireRole } from '../middleware/identify.middleware';

/**
 * Routes for the Appointment Management module — Level 5 API Contract
 * Table. Every endpoint here is backed by an already-implemented,
 * already-tested AppointmentService method; this file only wires HTTP
 * verb + path + role restriction to the matching Controller handler.
 *
 * `GET /api/faculty` and `GET /api/faculty/:id/availability` (Faculty
 * Directory module — read-only browse/search + real availability lookup)
 * now exist too, in routes/faculty.routes.ts, combined onto the same
 * `/api` mount in app.ts. Still deliberately NOT included: `PUT
 * /api/faculty/availability`, `POST /api/faculty/availability/exceptions`
 * (faculty editing their OWN availability) and any admin/reporting
 * endpoints — those need write-side Repository/Service work and an ADMIN
 * role that don't exist yet, unlike the read-only availability computation
 * this module reuses as-is from get_available_slots() (migrations/sql/0005).
 */
export function createAppointmentRouter(controller: AppointmentController): Router {
  const router = Router();

  router.post('/appointments', requireRole('STUDENT'), controller.requestAppointment);
  router.get('/appointments/mine', requireRole('STUDENT'), controller.listMine);
  router.get('/appointments/pending', requireRole('FACULTY'), controller.listPending);
  router.get('/appointments/mine-as-faculty', requireRole('FACULTY'), controller.listMineAsFaculty);
  router.patch('/appointments/:id/approve', requireRole('FACULTY'), controller.approve);
  router.patch('/appointments/:id/reject', requireRole('FACULTY'), controller.reject);
  router.patch('/appointments/:id/cancel', requireRole('STUDENT', 'FACULTY'), controller.cancel);
  router.patch('/appointments/:id/complete', requireRole('FACULTY'), controller.complete);
  router.patch('/appointments/:id/missed', requireRole('FACULTY'), controller.markMissed);

  return router;
}
