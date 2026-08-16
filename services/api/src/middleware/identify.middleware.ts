import { Request, Response, NextFunction } from 'express';

export type UserRole = 'STUDENT' | 'FACULTY';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>(['STUDENT', 'FACULTY']);

/**
 * TEMPORARY stand-in for real authentication.
 *
 * `docs/IMPLEMENTATION_STATUS.md` lists Authentication as "Not started" —
 * this HTTP layer is being built before that work. Rather than block Phase
 * 2 on Phase 3, this middleware reads caller identity from headers
 * (`X-User-Id`, `X-User-Role`) supplied directly by the client, with NO
 * cryptographic verification that the caller actually is who they claim.
 *
 * This is a deliberate, narrow scope decision, not a security regression:
 * AppointmentService's ownership checks (`findOwnedByFaculty`, the
 * student/faculty check in `cancel()`) already trusted a caller-supplied id
 * "on faith" before this Controller layer existed — this middleware doesn't
 * make that trust boundary any weaker, it just gives every Controller a
 * single, consistent place to read `req.user` from, and turns "no identity
 * supplied at all" into a clean 401 instead of `undefined` reaching the
 * Service layer.
 *
 * When real authentication (session or token based) is built, only this
 * file's *implementation* needs to change — verify the credential, look up
 * the real user, and populate `req.user` from that instead of from raw
 * headers. Every Controller downstream depends only on `req.user` existing
 * and having `{ id, role }` on it, never on how it got there.
 */
export function identify(req: Request, res: Response, next: NextFunction): void {
  const id = req.header('X-User-Id');
  const role = req.header('X-User-Role');

  if (!id || !role) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'X-User-Id and X-User-Role headers are required (temporary stand-in for authentication — see identify.middleware.ts).',
    });
    return;
  }

  if (!VALID_ROLES.has(role)) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: `X-User-Role must be one of: ${Array.from(VALID_ROLES).join(', ')}`,
    });
    return;
  }

  req.user = { id, role: role as UserRole };
  next();
}

/** Route-level authorization: the endpoint's contract (Level 5 API Contract Table) restricts it to one or more roles. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `This endpoint requires role: ${roles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}
