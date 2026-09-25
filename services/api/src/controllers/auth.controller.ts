import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';

/** Thin HTTP adapter over AuthService — the one controller whose route is deliberately NOT behind `identify` (see routes/auth.routes.ts and app.ts): logging in is how a caller gets an identity in the first place. */
export function createAuthController(service: AuthService) {
  return {
    /**
     * POST /api/auth/login — unauthenticated. Body: {identifier, password}.
     * `identifier` is a registration number (STUDENT), staff code (FACULTY),
     * or email (ADMIN) — see AuthService.login. `email` is still accepted as
     * an alias for `identifier` here (not just for back-compat convenience —
     * the whole pre-existing test suite posts `{ email, password }`, and
     * AuthRepository.findByIdentifier already resolves an email-shaped value
     * correctly, so this keeps every existing test's login setup valid with
     * zero changes while still adding roll-number/staff-code login for real
     * traffic).
     */
    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const body = req.body ?? {};
        const identifier = body.identifier ?? body.email;
        const { password } = body;
        const result = await service.login(identifier, password);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
