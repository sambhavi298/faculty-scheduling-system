import express, { Application } from 'express';
import { AppointmentService } from './services/appointment.service';
import { createAppointmentController } from './controllers/appointment.controller';
import { createAppointmentRouter } from './routes/appointment.routes';
import { identify } from './middleware/identify.middleware';
import { errorHandler } from './middleware/error-handler.middleware';

/**
 * Builds the Express application. Deliberately separate from server.ts
 * (which owns the actual `listen()` call and the real PostgreSQL Pool) so
 * HTTP tests can exercise real routing/middleware/error-mapping behavior
 * with `supertest` against an in-memory app instance, wired to whatever
 * AppointmentService they construct (real Pool + real Repository in this
 * project's tests, per its "always test against real PostgreSQL, never
 * mock the database" convention — see tests/integration/*).
 */
export function createApp(service: AppointmentService): Application {
  const app = express();

  app.use(express.json());

  // Unauthenticated: basic liveness check, useful for deployment/health monitoring.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Every /api/* route requires a caller identity (see identify.middleware.ts
  // for why this is a temporary stand-in for real authentication).
  const controller = createAppointmentController(service);
  app.use('/api', identify, createAppointmentRouter(controller));

  // Must be registered last: Express identifies error-handling middleware by arity (4 params).
  app.use(errorHandler);

  return app;
}
