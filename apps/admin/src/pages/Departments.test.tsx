import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider, ToastProvider } from '@faculty-scheduling/ui';
import { Departments } from './Departments';

/**
 * Covers the admin Departments/Batches page — the two real GET list calls
 * on load, and the "create department" form's real POST, including the
 * ValidationError message surfaced from a duplicate-code 400 the same way
 * a real adminApi.createDepartment() rejection would (see
 * services/api/src/repositories/admin.repository.ts's runWrite() — a
 * 23505 unique_violation becomes a plain-English ValidationError message).
 */

const DEPARTMENTS = [{ id: 1, name: 'Computer Science', code: 'CSE' }];
const BATCHES = [{ id: 10, department_id: 1, name: 'Batch 1', academic_year: '2026-2027' }];

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) } as Response;
}

function renderDepartmentsAsAdmin() {
  localStorage.setItem(
    'admin-session-test',
    JSON.stringify({ token: 't', id: '900', role: 'ADMIN', fullName: 'System Admin', email: 'admin@example.edu' })
  );
  return render(
    <SessionProvider storageKey="admin-session-test" allowedRoles={['ADMIN']}>
      <ToastProvider>
        <Departments />
      </ToastProvider>
    </SessionProvider>
  );
}

describe('Admin Departments', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads and renders both the department and batch lists from the two real GET endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/admin/departments')) return jsonResponse(200, DEPARTMENTS);
        if (url.startsWith('/api/admin/batches')) return jsonResponse(200, BATCHES);
        throw new Error(`Unexpected fetch in test: ${url}`);
      })
    );
    renderDepartmentsAsAdmin();

    // 'Computer Science' itself appears twice once loaded (the departments
    // table row AND the batch-department <select> option), so the unique
    // 'CSE' code is what this waits on — findByText on ambiguous text
    // throws "multiple elements found" rather than resolving.
    expect(await screen.findByText('CSE')).toBeInTheDocument();
    expect(screen.getAllByText('Computer Science').length).toBeGreaterThan(0);
    expect(screen.getByText('Batch 1')).toBeInTheDocument();
    expect(screen.getByText('2026-2027')).toBeInTheDocument();
  });

  it('submits POST /api/admin/departments with the entered name/code and refreshes the list on success', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url === '/api/admin/departments') {
        const created = { id: 2, name: 'Electronics', code: 'ECE' };
        return jsonResponse(201, created);
      }
      if (url.startsWith('/api/admin/departments')) {
        // Second GET (post-create refresh) returns the new department too.
        return jsonResponse(200, fetchMock.mock.calls.some((c) => c[1]?.method === 'POST') ? [...DEPARTMENTS, { id: 2, name: 'Electronics', code: 'ECE' }] : DEPARTMENTS);
      }
      if (url.startsWith('/api/admin/batches')) return jsonResponse(200, BATCHES);
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderDepartmentsAsAdmin();

    await screen.findByText('CSE'); // wait for initial load

    await user.type(screen.getByLabelText('Name'), 'Electronics');
    await user.type(screen.getByLabelText('Code'), 'ECE');
    await user.click(screen.getByRole('button', { name: /add department/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/departments',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Electronics', code: 'ECE' }) })
      );
    });
    expect(await screen.findByText('ECE')).toBeInTheDocument(); // unique to the table; 'Electronics' also appears in the batch dropdown once reloaded
  });

  it('shows a real validation error inline when creating a department with a duplicate code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url === '/api/admin/departments') {
          return jsonResponse(400, { error: 'VALIDATION_ERROR', message: 'That email, code, staff code, or roll number is already in use.' });
        }
        if (url.startsWith('/api/admin/departments')) return jsonResponse(200, DEPARTMENTS);
        if (url.startsWith('/api/admin/batches')) return jsonResponse(200, BATCHES);
        throw new Error(`Unexpected fetch in test: ${url}`);
      })
    );

    const user = userEvent.setup();
    renderDepartmentsAsAdmin();
    await screen.findByText('CSE');

    await user.type(screen.getByLabelText('Name'), 'Computer Science');
    await user.type(screen.getByLabelText('Code'), 'CSE');
    await user.click(screen.getByRole('button', { name: /add department/i }));

    // Surfaces twice by design (an inline field error AND a toast — see
    // Departments.tsx's handleCreateDepartment), so this waits for at
    // least one match rather than the unique element findByText requires.
    await waitFor(() => {
      expect(screen.getAllByText(/already in use/i).length).toBeGreaterThan(0);
    });
  });
});
