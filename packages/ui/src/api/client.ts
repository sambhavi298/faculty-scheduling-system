import type { ApiErrorBody, ApiErrorCode, Session } from '../types';
import { ApiError } from '../types';

/**
 * Thin fetch wrapper for the real backend (services/api). Every call goes to
 * `/api/...` — in dev, each app's vite.config.ts proxies `/api` to
 * `http://localhost:3000` (the backend has no CORS middleware, so a direct
 * cross-origin browser call from a Vite dev server would be blocked; the
 * proxy keeps everything same-origin without touching backend code). In a
 * production build, this app must be served from the same origin as the API,
 * or behind a reverse proxy that forwards /api — see the migration report's
 * "Remaining backend dependencies" section.
 *
 * This file talks to the API surface exactly as services/api/src exposes it
 * today. It does not call, guess at, or stub any endpoint that isn't real.
 */

let currentSession: Session | null = null;

export function setApiSession(session: Session | null): void {
  currentSession = session;
}

export function getApiSession(): Session | null {
  return currentSession;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (currentSession) {
    headers.set('X-User-Id', currentSession.userId);
    headers.set('X-User-Role', currentSession.role);
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that the backend (services/api) is running and reachable.');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (shouldn't happen against this backend) — fall through with body=null.
    }
  }

  if (!res.ok) {
    const errBody = body as Partial<ApiErrorBody> | null;
    const code: ApiErrorCode = (errBody?.error as ApiErrorCode) ?? 'INTERNAL_ERROR';
    const message = errBody?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, code, message);
  }

  return body as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
};

/** GET /health — the one endpoint that needs no identity headers. */
export function checkHealth(): Promise<{ status: string }> {
  return apiClient.get('/health');
}
