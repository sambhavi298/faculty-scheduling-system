import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service';
import { ValidationError } from '../errors/validation.error';

function idParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a single path segment`);
  }
  return value;
}

function queryValue(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Thin HTTP adapter over AdminService, same shape/responsibilities as every
 * other controller in this codebase. Every route this serves is gated by
 * `requireRole('ADMIN')` (routes/admin.routes.ts) — this controller itself
 * enforces no authorization, matching how every other controller leaves
 * that entirely to the route layer.
 */
export function createAdminController(service: AdminService) {
  return {
    async listDepartments(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.listDepartments());
      } catch (err) {
        next(err);
      }
    },
    async createDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(201).json(await service.createDepartment(req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },
    async updateDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.updateDepartment(idParam(req), req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },

    async listBatches(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.listBatches(queryValue(req, 'departmentId')));
      } catch (err) {
        next(err);
      }
    },
    async createBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(201).json(await service.createBatch(req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },
    async updateBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.updateBatch(idParam(req), req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },

    async listFaculty(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.listFaculty());
      } catch (err) {
        next(err);
      }
    },
    async createFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(201).json(await service.createFaculty(req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },
    async updateFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.updateFaculty(idParam(req), req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },

    async listStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.listStudents(queryValue(req, 'batchId')));
      } catch (err) {
        next(err);
      }
    },
    async createStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(201).json(await service.createStudent(req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },
    async updateStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.updateStudent(idParam(req), req.body ?? {}));
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/admin/appointments — read-only. */
    async listAppointments(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.listAppointments({
          status: queryValue(req, 'status'),
          facultyId: queryValue(req, 'facultyId'),
          studentId: queryValue(req, 'studentId'),
          page: queryValue(req, 'page'),
          pageSize: queryValue(req, 'pageSize'),
        });
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/admin/audit-log — read-only. */
    async listAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rows = await service.listAuditLog({
          entityType: queryValue(req, 'entityType'),
          entityId: queryValue(req, 'entityId'),
          page: queryValue(req, 'page'),
          pageSize: queryValue(req, 'pageSize'),
        });
        res.status(200).json(rows);
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/admin/dashboard */
    async getDashboard(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.getDashboard());
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/admin/reports/appointments-summary */
    async getWorkloadReport(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        res.status(200).json(await service.getWorkloadReport());
      } catch (err) {
        next(err);
      }
    },
  };
}

export type AdminController = ReturnType<typeof createAdminController>;
