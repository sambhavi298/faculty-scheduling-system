import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@faculty-scheduling/ui';
import { Login } from './Login';

/**
 * Same convention as the student/faculty Login tests. Also covers this
 * screen's one extra piece of real logic: `if (session) return <Navigate
 * ... />` — an already-logged-in admin hitting /login is redirected away,
 * rather than shown the form again.
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
      <SessionProvider storageKey="admin-session-test" allowedRoles={['ADMIN']}>
        <Login />
      </SessionProvider>
    </MemoryRouter>
  );
}

describe('Admin Login', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the login form when no session exists', () => {
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

  it('logs a real ADMIN account in and stores the session', async () => {
    mockFetchOnce(200, {
      token: 'fake.jwt.token',
      user: { id: '900', role: 'ADMIN', fullName: 'System Admin', email: 'admin@example.edu' },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'admin@example.edu');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('admin-session-test') ?? 'null');
      expect(stored).toMatchObject({ id: '900', role: 'ADMIN', email: 'admin@example.edu' });
    });
  });

  it('shows "Incorrect email or password" on a 401 UNAUTHENTICATED response, without storing a session', async () => {
    mockFetchOnce(401, { error: 'UNAUTHENTICATED', message: 'Invalid credentials' });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'admin@example.edu');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(localStorage.getItem('admin-session-test')).toBeNull();
  });

  it('rejects a real FACULTY account logging into the admin portal, without storing a session', async () => {
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
    expect(localStorage.getItem('admin-session-test')).toBeNull();
  });

  it('redirects away from the login screen entirely when a valid session already exists', () => {
    localStorage.setItem(
      'admin-session-test',
      JSON.stringify({ token: 't', id: '900', role: 'ADMIN', fullName: 'System Admin', email: 'admin@example.edu' })
    );
    renderLogin();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
