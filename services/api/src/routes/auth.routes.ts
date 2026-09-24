import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

/** Deliberately mounted WITHOUT `identify` (see app.ts) — the one /api endpoint that must be reachable with no existing identity. */
export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  router.post('/auth/login', controller.login);

  return router;
}
