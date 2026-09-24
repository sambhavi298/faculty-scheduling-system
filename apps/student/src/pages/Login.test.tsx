import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@faculty-scheduling/ui';
import { Login } from './Login';

/**
 * Component test for the real login screen introduced this pass (real
 * POST /api/auth/login, real JWT session — see packages/ui/src/auth/
 * SessionProvider.tsx). Deliberately exercises the full real stack —
 * Login -> useSession -> authApi -> apiClient -> fetch — rather than
 * mocking SessionProvider or authApi: the only thing stubbed is the
 * network boundary itself (global fetch), with response bodies shaped
 * EXACTLY like services/api/src/controllers/auth.controller.ts's real
 * responses (confirmed against tests/http/auth.http.test.ts on the
 * backend). This is the same principle the backend tests apply against a
 * real database, translated to the frontend's own external boundary.
 */

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(body),
    } as Response)
  );
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <SessionProvider storageKey="student-session-test" allowedRoles={['STUDENT']}>
        <Login />
      </SessionProvider>
    </MemoryRouter>
  );
}

describe('Student Login', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the login form', () => {
    renderLogin();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('shows a validation message and never calls the API when submitted empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/enter your email and password/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls POST /api/auth/login with the entered credentials and stores the returned session on success', async () => {
    mockFetchOnce(200, {
      token: 'fake.jwt.token',
      user: { id: '100', role: 'STUDENT', fullName: 'Alice Student', email: 'alice@example.edu' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'alice@example.edu');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'alice@example.edu', password: 'Password123!' }),
        })
      );
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('student-session-test') ?? 'null');
      expect(stored).toMatchObject({ id: '100', role: 'STUDENT', email: 'alice@example.edu' });
    });
  });

  it('shows "Incorrect email or password" — not the generic session-expired copy — on a 401 UNAUTHENTICATED response', async () => {
    mockFetchOnce(401, { error: 'UNAUTHENTICATED', message: 'Invalid credentials' });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'alice@example.edu');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(localStorage.getItem('student-session-test')).toBeNull();
  });

  it('rejects a real FACULTY account logging into the student portal, without storing a session', async () => {
    mockFetchOnce(200, {
      token: 'fake.jwt.token',
      user: { id: '200', role: 'FACULTY', fullName: 'Prof. Rao', email: 'prof.rao@example.edu' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'prof.rao@example.edu');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/faculty account and can't sign in here/i)).toBeInTheDocument();
    expect(localStorage.getItem('student-session-test')).toBeNull();
  });
});
