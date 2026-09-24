import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';

/** Thin HTTP adapter over AuthService — the one controller whose route is deliberately NOT behind `identify` (see routes/auth.routes.ts and app.ts): logging in is how a caller gets an identity in the first place. */
export function createAuthController(service: AuthService) {
  return {
    /** POST /api/auth/login — unauthenticated. Body: {email, password}. */
    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { email, password } = req.body ?? {};
        const result = await service.login(email, password);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
