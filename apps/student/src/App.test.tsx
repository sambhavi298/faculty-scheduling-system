import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider, ToastProvider } from '@faculty-scheduling/ui';
import { App } from './App';

/**
 * Regression test for a real bug found by manual end-to-end testing: a
 * stale session object sitting in localStorage (shape-valid, but the JWT
 * itself has since been rejected by the backend — past its 12h TTL, or the
 * server restarted with a different JWT_SECRET) used to let RequireAuth
 * mount the full authenticated shell anyway, because it only ever checked
 * "is there a session-shaped object in storage," never whether the token
 * is still good. Every widget inside then failed with a raw
 * "UNAUTHENTICATED" error shown inline, and nothing redirected back to
 * /login — from the outside this reads exactly as "the dashboard opens
 * without logging in."
 *
 * Fixed centrally in packages/ui (api/client.ts + auth/SessionProvider.tsx):
 * a 401 response to a request that DID carry a bearer token now clears the
 * session and notifies SessionProvider, so the existing route guard
 * (RequireAuth here; Layout/ProtectedRoute in the other two apps, all
 * sharing this same mechanism) picks that up and redirects on the very
 * next render — no per-app duplication needed.
 */

const STALE_SESSION = {
  token: 'stale.jwt.token',
  id: '100',
  role: 'STUDENT',
  fullName: 'Alice Student',
  email: 'alice@example.edu',
};

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider storageKey="student-session-test-app" allowedRoles={['STUDENT']}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </MemoryRouter>
  );
}

describe('App — stale/rejected session handling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redirects to /login and clears the stored session when a stale token is rejected with 401', async () => {
    localStorage.setItem('student-session-test-app', JSON.stringify(STALE_SESSION));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        text: async () =>
          JSON.stringify({ error: 'UNAUTHENTICATED', message: 'The provided token is invalid or expired.' }),
      } as Response)
    );

    renderApp();

    // The stale session initially passes the route guard's shape check —
    // it's the dashboard's own GET /api/appointments/mine call that
    // surfaces the dead token and triggers the redirect.
    await waitFor(() => {
      expect(screen.getByLabelText('Registration Number')).toBeInTheDocument();
    });
    expect(screen.getByText(/your session expired/i)).toBeInTheDocument();
    expect(localStorage.getItem('student-session-test-app')).toBeNull();
  });

  it('shows the login form immediately, with no stale-session notice, when there was never a session', async () => {
    renderApp();
    expect(await screen.findByLabelText('Registration Number')).toBeInTheDocument();
    expect(screen.queryByText(/your session expired/i)).not.toBeInTheDocument();
  });
});
