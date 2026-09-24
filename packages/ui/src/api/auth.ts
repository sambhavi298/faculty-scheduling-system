import { apiClient } from './client';
import type { LoginResult } from '../types';

/**
 * Corresponds 1:1 to the one real route in
 * services/api/src/routes/auth.routes.ts — POST /api/auth/login, the one
 * endpoint deliberately mounted without `identify` (see that file's own
 * comment): a caller has no token yet, that's the whole point of this call.
 */
export const authApi = {
  /** POST /api/auth/login — unauthenticated. */
  login: (email: string, password: string): Promise<LoginResult> => apiClient.post('/api/auth/login', { email, password }),
};
