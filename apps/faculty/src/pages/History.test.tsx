import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '@faculty-scheduling/ui';
import { History } from './History';

/**
 * Covers this pass's rebuild of the History page: the real
 * GET /api/appointments/mine-as-faculty call (filtered client-side to the
 * non-active statuses) AND the new stats section this session added,
 * backed by the new GET /api/faculty/me/stats endpoint
 * (services/api/src/routes/faculty.routes.ts). The two are loaded by
 * independent effects with independent load state, so this also verifies
 * one failing doesn't block the other from rendering.
 */

const STATS_BODY = {
  faculty_id: '200',
  full_name: 'Prof. Rao',
  completed_count: 3,
  missed_count: 1,
  rejected_count: 2,
  cancelled_count: 0,
  avg_response_minutes: 15.5,
  total_requests: 6,
};

const HISTORY_ROWS = [
  {
    id: '1',
    student_id: '100',
    faculty_id: '200',
    slot: '[2026-01-05T09:00:00+05:30,2026-01-05T09:30:00+05:30)',
    status: 'COMPLETED',
    reason: 'Doubt in assignment',
    client_request_id: null,
    requested_at: '2026-01-01T00:00:00Z',
    responded_at: '2026-01-01T00:00:00Z',
    responded_by: '200',
    cancelled_by: null,
    completion_notes: 'Resolved',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-05T09:35:00Z',
  },
  {
    id: '2',
    student_id: '101',
    faculty_id: '200',
    slot: '[2026-01-06T10:00:00+05:30,2026-01-06T10:30:00+05:30)',
    status: 'PENDING', // must be filtered OUT of the history list client-side
    reason: 'Project discussion',
    client_request_id: null,
    requested_at: '2026-01-02T00:00:00Z',
    responded_at: null,
    responded_by: null,
    cancelled_by: null,
    completion_notes: null,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

function jsonResponse(body: unknown): Response {
  return { status: 200, ok: true, text: async () => JSON.stringify(body) } as Response;
}

function mockFetchRouter(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/faculty/me/stats')) return jsonResponse(STATS_BODY);
      if (url.startsWith('/api/appointments/mine-as-faculty')) return jsonResponse(HISTORY_ROWS);
      throw new Error(`Unexpected fetch in test: ${url}`);
    })
  );
}

function renderHistoryAsLoggedInFaculty() {
  localStorage.setItem(
    'faculty-session-test',
    JSON.stringify({ token: 't', id: '200', role: 'FACULTY', fullName: 'Prof. Rao', email: 'prof.rao@example.edu' })
  );
  return render(
    <SessionProvider storageKey="faculty-session-test" allowedRoles={['FACULTY']}>
      <History />
    </SessionProvider>
  );
}

describe('Faculty History', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the stats section from GET /api/faculty/me/stats', async () => {
    mockFetchRouter();
    renderHistoryAsLoggedInFaculty();

    expect(await screen.findByText('6')).toBeInTheDocument(); // total_requests
    expect(screen.getByText('3')).toBeInTheDocument(); // completed_count
    expect(screen.getByText('Total requests')).toBeInTheDocument();
  });

  it('renders only the non-active-status rows from GET /api/appointments/mine-as-faculty, excluding PENDING', async () => {
    mockFetchRouter();
    renderHistoryAsLoggedInFaculty();

    await waitFor(() => expect(screen.getByText('Resolved')).toBeInTheDocument());
    // The PENDING row's own reason text must never appear in the rendered history table.
    expect(screen.queryByText('Project discussion')).not.toBeInTheDocument();
  });

  it('shows an error state with retry for the history list when the endpoint fails, independent of the stats section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/faculty/me/stats')) return jsonResponse(STATS_BODY);
        if (url.startsWith('/api/appointments/mine-as-faculty')) {
          return { status: 500, ok: false, text: async () => JSON.stringify({ error: 'INTERNAL_ERROR', message: 'boom' }) } as Response;
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      })
    );
    renderHistoryAsLoggedInFaculty();

    // Stats still render even though the history list failed.
    expect(await screen.findByText('Total requests')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
