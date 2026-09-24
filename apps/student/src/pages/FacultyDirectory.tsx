import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Table,
  facultyApi,
} from '@faculty-scheduling/ui';
import type { FacultyDirectoryRow } from '@faculty-scheduling/ui';
import { useAppointments } from '../state/AppointmentsContext';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: FacultyDirectoryRow[] };

/**
 * Backed by the real GET /api/faculty endpoint (services/api/src/routes/faculty.routes.ts).
 * `designation` is rendered as "—" when null — the backend is honest that no
 * designation column exists yet (see FacultyDirectoryRow's own comment in
 * @faculty-scheduling/ui) rather than inventing a title, so this page stays
 * honest too instead of hiding the gap.
 */
export function FacultyDirectory(): React.ReactElement {
  const { appointments, loading: appointmentsLoading, error: appointmentsError } = useAppointments();
  const [search, setSearch] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Bumped by the "Try again" button to force a refetch of the SAME search
  // term — setSearch(same value) alone wouldn't change React state (Object.is
  // bails out), so the effect below needs a second, independent dependency.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((cur) => (cur.status === 'ready' ? cur : { status: 'loading' }));
    const handle = setTimeout(() => {
      facultyApi
        .list(search)
        .then((rows) => {
          if (!cancelled) setState({ status: 'ready', rows });
        })
        .catch((error: unknown) => {
          if (!cancelled) setState({ status: 'error', error });
        });
    }, 250); // small debounce so every keystroke doesn't fire a request

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, retryToken]);

  const contacted = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      counts.set(a.faculty_id, (counts.get(a.faculty_id) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [appointments]);

  return (
    <>
      <PageHeader title="Faculty Directory" subtitle="Search and browse faculty, then request an appointment." />

      <Card padded style={{ marginBottom: '1.5rem' }}>
        <Field label="Search by name" htmlFor="facultySearch" hint="Leave blank to see every faculty member.">
          <Input
            id="facultySearch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Rao"
          />
        </Field>

        {state.status === 'loading' && <LoadingState label="Loading faculty…" />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={() => setRetryToken((n) => n + 1)} />}
        {state.status === 'ready' && state.rows.length === 0 && (
          <EmptyState
            title={search.trim() ? 'No faculty match that search' : 'No faculty found'}
            description={search.trim() ? 'Try a different name.' : undefined}
          />
        )}
        {state.status === 'ready' && state.rows.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.department}</td>
                  <td>{f.designation ?? '—'}</td>
                  <td>
                    <Link to={`/request?facultyId=${encodeURIComponent(f.id)}`}>
                      <Button variant="secondary" size="sm">
                        Request appointment
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card padded>
        <div className="row gap-sm" style={{ marginBottom: '0.9rem' }}>
          <Users size={16} />
          <h2 style={{ margin: 0, fontSize: '0.98rem' }}>Faculty you&apos;ve been in contact with</h2>
        </div>

        {appointmentsLoading && (
          <p className="text-secondary" style={{ fontSize: '0.88rem' }}>
            Loading your appointment history…
          </p>
        )}
        {!!appointmentsError && (
          <p className="field__error" style={{ fontSize: '0.85rem' }}>
            Couldn&apos;t load your appointment history right now.
          </p>
        )}
        {!appointmentsLoading && !appointmentsError && contacted.length === 0 && (
          <p className="text-secondary" style={{ fontSize: '0.88rem' }}>
            You have no appointment history yet. Search the directory above to request your first appointment.
          </p>
        )}
        {contacted.length > 0 && (
          <div>
            {contacted.map(([facultyId, count]) => (
              <div key={facultyId} className="recent-item" style={{ cursor: 'default' }}>
                <span>
                  Faculty {facultyId}{' '}
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                    · {count} appointment{count === 1 ? '' : 's'}
                  </span>
                </span>
                <Link to={`/request?facultyId=${encodeURIComponent(facultyId)}`}>
                  <Button variant="secondary" size="sm">
                    Request appointment
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
