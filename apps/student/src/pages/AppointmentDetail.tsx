import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  canTransition,
  formatDateTime,
  formatSlot,
} from '@faculty-scheduling/ui';
import { useAppointments } from '../state/AppointmentsContext';
import { useCancelAppointment } from '../hooks/useCancelAppointment';

/**
 * No GET-by-id endpoint exists (services/api only lists /mine and
 * /pending), so this is a view over a row already present in the shared
 * in-memory appointments list, not a separate API call. If the id isn't in
 * that list — e.g. a stale deep link — this shows an honest "not found in
 * your loaded appointments" state with a refresh action, never an error.
 */
export function AppointmentDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { appointments, loading, error, refetch } = useAppointments();
  const { cancel, cancellingId } = useCancelAppointment();
  const [confirming, setConfirming] = useState(false);

  if (loading) return <LoadingState label="Loading your appointments…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const appointment = appointments.find((a) => a.id === id);

  if (!appointment) {
    return (
      <>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/appointments')} style={{ marginBottom: '1rem' }}>
          <ArrowLeft size={14} /> Back to my appointments
        </button>
        <PageHeader title="Appointment" />
        <Card padded>
          <EmptyState
            title="Not found in your loaded appointments"
            description="This appointment isn't in the list this page already has loaded. It may be out of date, or the link may be wrong — try refreshing."
            action={
              <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                Refresh
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const cancellable = canTransition(appointment.status, 'CANCELLED');

  async function confirmCancel(): Promise<void> {
    await cancel(appointment!.id);
    setConfirming(false);
  }

  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/appointments')} style={{ marginBottom: '1rem' }}>
        <ArrowLeft size={14} /> Back to my appointments
      </button>

      <PageHeader
        title={`Appointment with Faculty ${appointment.faculty_id}`}
        subtitle={formatSlot(appointment.slot)}
        actions={<StatusBadge status={appointment.status} />}
      />

      <Card padded>
        <dl className="detail-grid">
          <div className="detail-grid__item">
            <dt>Requested</dt>
            <dd>{formatDateTime(appointment.requested_at)}</dd>
          </div>
          <div className="detail-grid__item">
            <dt>Responded</dt>
            <dd>{formatDateTime(appointment.responded_at)}</dd>
          </div>
          <div className="detail-grid__item">
            <dt>Responded by</dt>
            <dd>{appointment.responded_by ?? '—'}</dd>
          </div>
          <div className="detail-grid__item">
            <dt>Cancelled by</dt>
            <dd>{appointment.cancelled_by ?? '—'}</dd>
          </div>
        </dl>

        <div className="field__label" style={{ marginBottom: '0.4rem' }}>
          Reason
        </div>
        <p className="reason-block">{appointment.reason}</p>

        {appointment.completion_notes && (
          <>
            <div className="field__label" style={{ margin: '1rem 0 0.4rem' }}>
              Completion notes
            </div>
            <p className="reason-block">{appointment.completion_notes}</p>
          </>
        )}

        {cancellable && (
          <div style={{ marginTop: '1.5rem' }}>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Cancel appointment
            </Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Cancel this appointment?"
        body={`This will cancel your appointment with faculty ${appointment.faculty_id} for ${formatSlot(appointment.slot)}. This can't be undone.`}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        danger
        loading={cancellingId === appointment.id}
        onConfirm={confirmCancel}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
