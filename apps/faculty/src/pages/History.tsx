import React, { useEffect, useState } from 'react';
import {
  appointmentsApi,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  Table,
  formatDateTime,
  formatSlot,
  useSession,
  type AppointmentRow,
} from '@faculty-scheduling/ui';

const HISTORY_STATUSES = new Set(['COMPLETED', 'MISSED', 'REJECTED', 'CANCELLED', 'EXPIRED']);

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: AppointmentRow[] };

/** GET /api/appointments/mine-as-faculty, filtered client-side to the non-active statuses — real, server-side, every device. */
export function History(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.id;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    appointmentsApi
      .listMineAsFaculty()
      .then((rows) => setState({ status: 'ready', rows: rows.filter((r) => HISTORY_STATUSES.has(r.status)) }))
      .catch((err: unknown) => setState({ status: 'error', error: err }));
  }

  useEffect(load, [userId]);

  const rows = state.status === 'ready' ? state.rows : [];
  const sorted = [...rows].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div>
      <PageHeader title="History" subtitle="Completed, missed, rejected, and cancelled appointments." />

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
