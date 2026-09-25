import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@faculty-scheduling/ui';
import { Login } from './Login';

/**
 * Same convention as apps/student/src/pages/Login.test.tsx: the real
 * Login -> useSession -> authApi -> apiClient stack runs unmocked, with
 * only the network boundary (global fetch) stubbed, response bodies
 * shaped exactly like the real backend's.
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
      <SessionProvider storageKey="faculty-session-test" allowedRoles={['FACULTY']}>
        <Login />
      </SessionProvider>
    </MemoryRouter>
  );
}

describe('Faculty Login', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the login form', () => {
    renderLogin();
    expect(screen.getByLabelText('Staff Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('shows a validation message and never calls the API when submitted empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/enter your staff code and password/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs a real FACULTY account in and stores the session', async () => {
    mockFetchOnce(200, {
      token: 'fake.jwt.token',
      user: { id: '200', role: 'FACULTY', fullName: 'Prof. Rao', email: 'prof.rao@example.edu' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Staff Code'), 'CSE-F01');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('faculty-session-test') ?? 'null');
      expect(stored).toMatchObject({ id: '200', role: 'FACULTY', email: 'prof.rao@example.edu' });
    });
  });

  it('shows "Incorrect staff code or password" on a 401 UNAUTHENTICATED response, without storing a session', async () => {
    mockFetchOnce(401, { error: 'UNAUTHENTICATED', message: 'Invalid credentials' });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Staff Code'), 'CSE-F01');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText('Incorrect staff code or password.')).toBeInTheDocument();
    expect(localStorage.getItem('faculty-session-test')).toBeNull();
  });

  it('rejects a real STUDENT account logging into the faculty portal, without storing a session', async () => {
    mockFetchOnce(200, {
      token: 'fake.jwt.token',
      user: { id: '100', role: 'STUDENT', fullName: 'Alice Student', email: 'alice@example.edu' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Staff Code'), 'CSE2026-001');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/student account and can't sign in here/i)).toBeInTheDocument();
    expect(localStorage.getItem('faculty-session-test')).toBeNull();
  });
});
