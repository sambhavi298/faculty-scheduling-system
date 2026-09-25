import { apiClient } from './client';
import type { LoginResult } from '../types';

/**
 * Corresponds 1:1 to the one real route in
 * services/api/src/routes/auth.routes.ts — POST /api/auth/login, the one
 * endpoint deliberately mounted without `identify` (see that file's own
 * comment): a caller has no token yet, that's the whole point of this call.
 */
export const authApi = {
  /**
   * POST /api/auth/login — unauthenticated. `identifier` is a STUDENT's
   * registration (roll) number, a FACULTY member's staff code, or an
   * ADMIN's email — see services/api/src/repositories/auth.repository.ts's
   * `findByIdentifier` for how one value resolves against all three.
   */
  login: (identifier: string, password: string): Promise<LoginResult> =>
    apiClient.post('/api/auth/login', { identifier, password }),
};
