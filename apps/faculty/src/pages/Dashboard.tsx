import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import {
  appointmentsApi,
  ErrorState,
  LoadingState,
  NoticeBanner,
  PageHeader,
  StatCard,
  StatGrid,
  readCache,
  useSession,
  type FacultyPendingRequestRow,
} from '@faculty-scheduling/ui';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: FacultyPendingRequestRow[] };

export function Dashboard(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.userId;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);

  function load(): void {
    setState({ status: 'loading' });
    appointmentsApi
      .listPending()
      .then((rows) => setState({ status: 'ready', rows }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, [userId]);

  useEffect(() => {
    setUpcomingCount(readCache('faculty:upcoming', userId).length);
    setHistoryCount(readCache('faculty:history', userId).length);
  }, [userId, state.status]);

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
        <>
          <StatGrid>
            <StatCard
              label="Pending requests"
              value={state.rows.length}
              hint={state.rows.length > 0 ? 'Awaiting your decision' : 'Nothing waiting on you'}
            />
            <StatCard label="Upcoming (this device)" value={upcomingCount} hint="Approved appointments cached locally" />
            <StatCard label="History (this device)" value={historyCount} hint="Completed / missed / rejected / cancelled" />
          </StatGrid>

          <NoticeBanner>
            The "Upcoming" and "History" counts above come from a local, per-device cache, not from the server —
            see the notice on those pages for why. The "Pending requests" count is always live from the server.
          </NoticeBanner>
        </>
      )}
    </div>
  );
}
