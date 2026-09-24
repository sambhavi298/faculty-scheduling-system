import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../auth/jwt-secret';

export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN';

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

const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>(['STUDENT', 'FACULTY', 'ADMIN']);

interface DecodedToken {
  sub?: unknown;
  role?: unknown;
}

/**
 * Real authentication, replacing the temporary X-User-Id/X-User-Role
 * header-trust stand-in this file used to be. Exactly as promised in this
 * file's own previous comment ("only this file's implementation needs to
 * change") — every downstream Controller still reads only `req.user.{id,
 * role}` and needed zero changes to adopt this.
 *
 * The caller's identity now comes from a verified JWT (`Authorization:
 * Bearer <token>`), issued by AuthService.login() (Level 2's chosen design:
 * self-issued JWT with role claims, bcrypt-hashed passwords). A missing,
 * malformed, expired, or wrong-signature token all collapse to the same
 * clean 401 — a client has no way to distinguish WHY a token was rejected
 * from the response alone, which is the correct behavior for an auth
 * boundary (revealing "expired" vs. "wrong signature" vs. "not even a
 * JWT" would leak information useful to an attacker for no benefit to a
 * legitimate client, who should simply log in again either way).
 */
export function identify(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'An Authorization: Bearer <token> header is required. Obtain a token from POST /api/auth/login.',
    });
    return;
  }

  let decoded: DecodedToken;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as DecodedToken;
  } catch {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'The provided token is invalid or expired. Obtain a new token from POST /api/auth/login.',
    });
    return;
  }

  const id = decoded.sub;
  const role = decoded.role;
  if (typeof id !== 'string' || typeof role !== 'string' || !VALID_ROLES.has(role)) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'The provided token does not carry a valid identity.',
    });
    return;
  }

  req.user = { id, role: role as UserRole };
  next();
}

/** Route-level authorization: the endpoint's contract (Level 5 API Contract Table) restricts it to one or more roles. Unchanged by the move to real authentication — it only ever reads req.user, never how req.user was populated. */
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
