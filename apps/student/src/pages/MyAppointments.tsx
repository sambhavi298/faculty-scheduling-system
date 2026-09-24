import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  Table,
  canTransition,
  formatSlot,
} from '@faculty-scheduling/ui';
import type { AppointmentRow, AppointmentStatus } from '@faculty-scheduling/ui';
import { useAppointments } from '../state/AppointmentsContext';
import { useCancelAppointment } from '../hooks/useCancelAppointment';

const STATUS_FILTERS: Array<'ALL' | AppointmentStatus> = [
  'ALL',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'MISSED',
  'EXPIRED',
];

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function MyAppointments(): React.ReactElement {
  const { appointments, loading, error, refetch } = useAppointments();
  const { cancel, cancellingId } = useCancelAppointment();
  const [filter, setFilter] = useState<'ALL' | AppointmentStatus>('ALL');
  const [pendingCancel, setPendingCancel] = useState<AppointmentRow | null>(null);

  if (loading) return <LoadingState label="Loading your appointments…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const filtered = filter === 'ALL' ? appointments : appointments.filter((a) => a.status === filter);

  async function confirmCancel(): Promise<void> {
    if (!pendingCancel) return;
    await cancel(pendingCancel.id);
    setPendingCancel(null);
  }

  return (
    <>
      <PageHeader title="My Appointments" subtitle="Every appointment you've requested, across all statuses." />

      {appointments.length > 0 && (
        <div className="filter-chips">
          {STATUS_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`filter-chip${filter === value ? ' active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
      )}

      {appointments.length === 0 ? (
        <Card padded>
          <EmptyState
            title="You haven't requested any appointments yet — get started"
            description="Find a faculty member's ID and request your first appointment."
            action={
              <Link to="/request">
                <Button variant="secondary" size="sm">
                  Request an appointment
                </Button>
              </Link>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card padded>
          <EmptyState title="No appointments with this status" description="Try a different filter above." />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Faculty</th>
              <th>Slot</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const cancellable = canTransition(a.status, 'CANCELLED');
              return (
                <tr key={a.id}>
                  <td>Faculty {a.faculty_id}</td>
                  <td>{formatSlot(a.slot)}</td>
                  <td>{truncate(a.reason)}</td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td>
                    <div className="table__actions">
                      <Link to={`/appointments/${a.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                      {cancellable && (
                        <Button
                          variant="danger"
                          size="sm"
                          loading={cancellingId === a.id}
                          onClick={() => setPendingCancel(a)}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={!!pendingCancel}
        title="Cancel this appointment?"
        body={
          pendingCancel
            ? `This will cancel your ${pendingCancel.status.toLowerCase()} appointment with faculty ${pendingCancel.faculty_id} for ${formatSlot(pendingCancel.slot)}. This can't be undone.`
            : null
        }
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        danger
        loading={!!pendingCancel && cancellingId === pendingCancel.id}
        onConfirm={confirmCancel}
        onCancel={() => setPendingCancel(null)}
      />
    </>
  );
}
