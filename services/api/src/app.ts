import express, { Application, Router } from 'express';
import { AppointmentService } from './services/appointment.service';
import { FacultyService } from './services/faculty.service';
import { NotificationService } from './services/notification.service';
import { FacultyAvailabilityService } from './services/faculty-availability.service';
import { AuthService } from './services/auth.service';
import { AdminService } from './services/admin.service';
import { createAppointmentController } from './controllers/appointment.controller';
import { createFacultyController } from './controllers/faculty.controller';
import { createNotificationController } from './controllers/notification.controller';
import { createFacultyAvailabilityController } from './controllers/faculty-availability.controller';
import { createAuthController } from './controllers/auth.controller';
import { createAdminController } from './controllers/admin.controller';
import { createAppointmentRouter } from './routes/appointment.routes';
import { createFacultyRouter } from './routes/faculty.routes';
import { createNotificationRouter } from './routes/notification.routes';
import { createFacultyAvailabilityRouter } from './routes/faculty-availability.routes';
import { createAuthRouter } from './routes/auth.routes';
import { createAdminRouter } from './routes/admin.routes';
import { identify } from './middleware/identify.middleware';
import { corsMiddleware } from './middleware/cors.middleware';
import { errorHandler } from './middleware/error-handler.middleware';

/**
 * Builds the Express application. Deliberately separate from server.ts
 * (which owns the actual `listen()` call and the real PostgreSQL Pool) so
 * HTTP tests can exercise real routing/middleware/error-mapping behavior
 * with `supertest` against an in-memory app instance, wired to whatever
 * services they construct (real Pool + real Repositories in this project's
 * tests, per its "always test against real PostgreSQL, never mock the
 * database" convention — see tests/integration/*).
 *
 * Takes one service per module (AppointmentService, FacultyService) rather
 * than a single service, now that there are two feature modules. Both
 * routers are combined into a single sub-router mounted under `/api` with
 * `identify` applied exactly once — mounting `app.use('/api', identify, ...)`
 * separately per router would run `identify` a second time for any request
 * the first router doesn't match (Express falls through to the next
 * matching `/api` mount), which is harmless but wasteful; combining avoids
 * it entirely.
 */
export interface AppServices {
  appointmentService: AppointmentService;
  facultyService: FacultyService;
  notificationService: NotificationService;
  facultyAvailabilityService: FacultyAvailabilityService;
  authService: AuthService;
  adminService: AdminService;
}

/**
 * Takes one service per module now that there are six. `createApp` keeps a
 * single positional-args overload path deliberately closed off — every
 * caller (server.ts, every HTTP test) passes an `AppServices` object so
 * adding a seventh module later is an additive change to that interface,
 * not a breaking change to every call site's argument order.
 */
export function createApp(services: AppServices): Application {
  const app = express();

  // Registered first, before body parsing: a disallowed-origin preflight
  // should be rejected before any request body is even parsed.
  app.use(corsMiddleware);
  app.use(express.json());

  // Unauthenticated: basic liveness check, useful for deployment/health monitoring.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const appointmentController = createAppointmentController(services.appointmentService);
  const facultyController = createFacultyController(services.facultyService);
  const notificationController = createNotificationController(services.notificationService);
  const facultyAvailabilityController = createFacultyAvailabilityController(services.facultyAvailabilityService);
  const authController = createAuthController(services.authService);
  const adminController = createAdminController(services.adminService);

  // POST /api/auth/login is the one /api endpoint that must NOT require an
  // existing identity — logging in is how a caller GETS one. Mounted at
  // '/api' ahead of the `identify`-guarded router below; Express falls
  // through to the next matching '/api' mount for any path this router
  // doesn't handle (the same pattern already used to combine the
  // appointment/faculty routers onto one mount), so every other /api/* path
  // still reaches `identify` exactly once.
  app.use('/api', createAuthRouter(authController));

  const apiRouter = Router();
  apiRouter.use(createAppointmentRouter(appointmentController));
  apiRouter.use(createFacultyRouter(facultyController));
  apiRouter.use(createNotificationRouter(notificationController));
  apiRouter.use(createFacultyAvailabilityRouter(facultyAvailabilityController));
  apiRouter.use(createAdminRouter(adminController));

  // Every other /api/* route requires a caller identity — a verified JWT as
  // of the real-authentication pass (see identify.middleware.ts).
  app.use('/api', identify, apiRouter);

  // Must be registered last: Express identifies error-handling middleware by arity (4 params).
  app.use(errorHandler);

  return app;
}
