import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import {
  appointmentsApi,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  useSession,
  type AppointmentRow,
  type FacultyPendingRequestRow,
} from '@faculty-scheduling/ui';

const HISTORY_STATUSES = new Set(['COMPLETED', 'MISSED', 'REJECTED', 'CANCELLED', 'EXPIRED']);

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; pending: FacultyPendingRequestRow[]; all: AppointmentRow[] };

export function Dashboard(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.id;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    Promise.all([appointmentsApi.listPending(), appointmentsApi.listMineAsFaculty()])
      .then(([pending, all]) => setState({ status: 'ready', pending, all }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, [userId]);

  const upcomingCount = state.status === 'ready' ? state.all.filter((r) => r.status === 'APPROVED').length : 0;
  const historyCount = state.status === 'ready' ? state.all.filter((r) => HISTORY_STATUSES.has(r.status)).length : 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your appointment requests, at a glance."
        actions={
          <Link to="/pending" className="btn btn--primary">
            <ListChecks size={15} /> Review pending requests
          </Link>
        }
      />

      {state.status === 'loading' && <LoadingState label="Loading your requests…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <StatGrid>
          <StatCard
            label="Pending requests"
            value={state.pending.length}
            hint={state.pending.length > 0 ? 'Awaiting your decision' : 'Nothing waiting on you'}
          />
          <StatCard label="Upcoming" value={upcomingCount} hint="Approved appointments" />
          <StatCard label="History" value={historyCount} hint="Completed / missed / rejected / cancelled" />
        </StatGrid>
      )}
    </div>
  );
}
