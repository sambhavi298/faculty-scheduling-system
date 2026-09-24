import React, { useEffect, useState } from 'react';
import {
  appointmentsApi,
  facultyApi,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Table,
  formatDateTime,
  formatSlot,
  useSession,
  type AppointmentRow,
  type FacultyStatsRow,
} from '@faculty-scheduling/ui';

const HISTORY_STATUSES = new Set(['COMPLETED', 'MISSED', 'REJECTED', 'CANCELLED', 'EXPIRED']);

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: AppointmentRow[] };

/**
 * Stats section is loaded independently of the history list below (own
 * load/error state, own effect) rather than bundled into the same
 * LoadState: GET /api/appointments/mine-as-faculty and GET
 * /api/faculty/me/stats are two unrelated real endpoints, and one failing
 * shouldn't block the other from rendering — a faculty member should still
 * see their appointment history even on the one call-out that the stats
 * endpoint is temporarily unavailable, and vice versa.
 */
type StatsState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; stats: FacultyStatsRow };

/** GET /api/appointments/mine-as-faculty, filtered client-side to the non-active statuses; GET /api/faculty/me/stats for the summary row above it — both real, server-side, every device. */
export function History(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.id;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [statsState, setStatsState] = useState<StatsState>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    appointmentsApi
      .listMineAsFaculty()
      .then((rows) => setState({ status: 'ready', rows: rows.filter((r) => HISTORY_STATUSES.has(r.status)) }))
      .catch((err: unknown) => setState({ status: 'error', error: err }));
  }

  function loadStats(): void {
    setStatsState({ status: 'loading' });
    facultyApi
      .getOwnStats()
      .then((stats) => setStatsState({ status: 'ready', stats }))
      .catch((err: unknown) => setStatsState({ status: 'error', error: err }));
  }

  useEffect(load, [userId]);
  useEffect(loadStats, [userId]);

  const rows = state.status === 'ready' ? state.rows : [];
  const sorted = [...rows].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div>
      <PageHeader title="History" subtitle="Completed, missed, rejected, and cancelled appointments." />

      {statsState.status === 'loading' && <LoadingState label="Loading stats…" />}
      {statsState.status === 'error' && <ErrorState error={statsState.error} onRetry={loadStats} />}
      {statsState.status === 'ready' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <StatGrid>
            <StatCard label="Total requests" value={statsState.stats.total_requests} />
            <StatCard label="Completed" value={statsState.stats.completed_count} />
            <StatCard label="Missed" value={statsState.stats.missed_count} />
            <StatCard label="Rejected" value={statsState.stats.rejected_count} />
            <StatCard label="Cancelled" value={statsState.stats.cancelled_count} />
            <StatCard
              label="Avg. response (min)"
              value={statsState.stats.avg_response_minutes === null ? '—' : Math.round(statsState.stats.avg_response_minutes)}
            />
          </StatGrid>
        </div>
      )}

      {state.status === 'loading' && <LoadingState label="Loading history…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && sorted.length === 0 && (
        <EmptyState
          title="No history yet"
          description="Once an appointment is completed, marked missed, rejected, or cancelled, it will appear here."
        />
      )}

      {state.status === 'ready' && sorted.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Slot</th>
              <th>Status</th>
              <th>Last updated</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id}>
                <td>#{row.student_id}</td>
                <td>{formatSlot(row.slot)}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>{formatDateTime(row.updated_at)}</td>
                <td>{row.completion_notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
