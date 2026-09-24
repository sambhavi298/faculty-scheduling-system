import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  formatSlot,
} from '@faculty-scheduling/ui';
import { useAppointments } from '../state/AppointmentsContext';

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function Dashboard(): React.ReactElement {
  const { appointments, loading, error, refetch } = useAppointments();

  if (loading) {
    return <LoadingState label="Loading your dashboard…" />;
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const pending = appointments.filter((a) => a.status === 'PENDING').length;
  const upcoming = appointments.filter((a) => a.status === 'APPROVED').length;
  const completed = appointments.filter((a) => a.status === 'COMPLETED').length;
  const recent = appointments.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="A summary of the appointments you've requested."
        actions={
          <Link to="/request">
            <Button>
              <CalendarPlus size={15} /> Request appointment
            </Button>
          </Link>
        }
      />

      <StatGrid>
        <StatCard label="Pending" value={pending} hint="Awaiting faculty response" />
        <StatCard label="Upcoming" value={upcoming} hint="Approved, not yet done" />
        <StatCard label="Completed" value={completed} hint="Finished appointments" />
      </StatGrid>

      <Card padded>
        <h2 style={{ margin: '0 0 0.9rem', fontSize: '1rem' }}>Recent activity</h2>
        {appointments.length === 0 ? (
          <EmptyState
            title="You haven't requested any appointments yet"
            description="Get started by requesting time with a faculty member."
            action={
              <Link to="/request">
                <Button variant="secondary" size="sm">
                  Request an appointment
                </Button>
              </Link>
            }
          />
        ) : (
          <div>
            {recent.map((a) => (
              <Link key={a.id} to={`/appointments/${a.id}`} className="recent-item">
                <span className="stack gap-xs">
                  <strong style={{ fontSize: '0.88rem' }}>{formatSlot(a.slot)}</strong>
                  <span className="recent-item__reason">{truncate(a.reason)}</span>
                </span>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
