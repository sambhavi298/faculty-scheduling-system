import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { requireRole } from '../middleware/identify.middleware';

/**
 * The Admin & Reporting module — every route here is ADMIN-only. Appointment
 * and audit-log routes are deliberately GET-only: Level 3 Security
 * Architecture requires admin actions on appointments to go through the
 * same guarded transactional functions any other actor uses (there is no
 * admin-specific appointment write path anywhere in this codebase), and
 * audit_log is append-only by database grant (no role, including this
 * one's, can INSERT/UPDATE/DELETE it — migrations/sql, Level 5 Section 12).
 */
export function createAdminRouter(controller: AdminController): Router {
  const router = Router();

  router.get('/admin/departments', requireRole('ADMIN'), controller.listDepartments);
  router.post('/admin/departments', requireRole('ADMIN'), controller.createDepartment);
  router.patch('/admin/departments/:id', requireRole('ADMIN'), controller.updateDepartment);

  router.get('/admin/batches', requireRole('ADMIN'), controller.listBatches);
  router.post('/admin/batches', requireRole('ADMIN'), controller.createBatch);
  router.patch('/admin/batches/:id', requireRole('ADMIN'), controller.updateBatch);

  router.get('/admin/faculty', requireRole('ADMIN'), controller.listFaculty);
  router.post('/admin/faculty', requireRole('ADMIN'), controller.createFaculty);
  router.patch('/admin/faculty/:id', requireRole('ADMIN'), controller.updateFaculty);

  router.get('/admin/students', requireRole('ADMIN'), controller.listStudents);
  router.post('/admin/students', requireRole('ADMIN'), controller.createStudent);
  router.patch('/admin/students/:id', requireRole('ADMIN'), controller.updateStudent);

  router.get('/admin/appointments', requireRole('ADMIN'), controller.listAppointments);
  router.get('/admin/audit-log', requireRole('ADMIN'), controller.listAuditLog);
  router.get('/admin/dashboard', requireRole('ADMIN'), controller.getDashboard);
  router.get('/admin/reports/appointments-summary', requireRole('ADMIN'), controller.getWorkloadReport);

  return router;
}
