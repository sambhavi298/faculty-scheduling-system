import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthRepository } from '../repositories/auth.repository';
import { UnauthenticatedError } from '../errors/unauthenticated.error';
import { ValidationError } from '../errors/validation.error';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    role: 'STUDENT' | 'FACULTY' | 'ADMIN';
    fullName: string;
    email: string;
  };
}

export interface JwtPayload {
  sub: string;
  role: 'STUDENT' | 'FACULTY' | 'ADMIN';
}

const TOKEN_TTL = '12h';

/**
 * Level 2's chosen authentication design, implemented: "self-issued JWT
 * with role claims (student/faculty/admin), passwords hashed with bcrypt."
 * This is the real replacement for identify.middleware.ts's temporary
 * X-User-Id/X-User-Role header-trust stand-in — see that file's own comment
 * ("only this file's implementation needs to change") for why every
 * downstream Controller needed zero changes to adopt this.
 *
 * Deliberately NOT a server-side session table: a JWT is stateless by
 * design (Level 2's stated reason — "works cleanly with a decoupled SPA
 * frontend" — plus it needs no session-store infrastructure this project
 * has no other reason to stand up). The trade-off this accepts, honestly:
 * a token cannot be revoked before it expires (e.g. on logout, this
 * project's logout is client-side-only — it discards the token, it does
 * not invalidate it server-side). TOKEN_TTL is kept short (12h) specifically
 * to bound that exposure without requiring a revocation store.
 */
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly jwtSecret: string
  ) {}

  async login(email: unknown, password: unknown): Promise<LoginResult> {
    if (typeof email !== 'string' || !email.trim()) {
      throw new ValidationError('email is required');
    }
    if (typeof password !== 'string' || !password) {
      throw new ValidationError('password is required');
    }

    const user = await this.repo.findByEmail(email.trim());
    // Deliberately the SAME error for "no such user" and "wrong password" —
    // a different message for each would let an attacker enumerate which
    // emails have accounts.
    if (!user) {
      throw new UnauthenticatedError();
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      throw new UnauthenticatedError();
    }

    const payload: JwtPayload = { sub: user.id, role: user.role };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: TOKEN_TTL });

    return {
      token,
      user: { id: user.id, role: user.role, fullName: user.full_name, email: user.email },
    };
  }
}
