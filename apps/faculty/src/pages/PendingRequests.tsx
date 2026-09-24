import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  appointmentsApi,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  formatSlot,
  upsertCache,
  useSession,
  useToast,
  type FacultyPendingRequestRow,
} from '@faculty-scheduling/ui';
import { describeError } from '../lib/errorMessage';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: FacultyPendingRequestRow[] };

export function PendingRequests(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.userId;
  const { show } = useToast();

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [actingOnId, setActingOnId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [rejectTarget, setRejectTarget] = useState<FacultyPendingRequestRow | null>(null);

  function load(): void {
    setState({ status: 'loading' });
    appointmentsApi
      .listPending()
      .then((rows) => setState({ status: 'ready', rows }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, [userId]);

  function removeRow(id: string): void {
    setState((cur) => (cur.status === 'ready' ? { status: 'ready', rows: cur.rows.filter((r) => r.id !== id) } : cur));
  }

  async function handleApprove(row: FacultyPendingRequestRow): Promise<void> {
    setActingOnId(row.id);
    setRowErrors((prev) => ({ ...prev, [row.id]: '' }));
    try {
      const updated = await appointmentsApi.approve(row.id);
      upsertCache('faculty:upcoming', userId, updated);
      removeRow(row.id);
      show('Request approved.', 'success');
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [row.id]: describeError(error) }));
      show(describeError(error), 'error');
    } finally {
      setActingOnId(null);
    }
  }

  async function handleReject(row: FacultyPendingRequestRow): Promise<void> {
    setActingOnId(row.id);
    setRowErrors((prev) => ({ ...prev, [row.id]: '' }));
    try {
      await appointmentsApi.reject(row.id);
      removeRow(row.id);
      show('Request rejected.', 'success');
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [row.id]: describeError(error) }));
      show(describeError(error), 'error');
    } finally {
      setActingOnId(null);
      setRejectTarget(null);
    }
  }

  return (
    <div>
      <PageHeader title="Pending Requests" subtitle="Requests waiting for your decision, oldest first." />

      {state.status === 'loading' && <LoadingState label="Loading pending requests…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && state.rows.length === 0 && (
        <EmptyState title="No pending requests" description="New requests from students will show up here." />
      )}

      {state.status === 'ready' && state.rows.length > 0 && (
        <div className="request-list">
          {[...state.rows]
            .sort((a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime())
            .map((row) => (
              <Card key={row.id}>
                <div className="request-card__top">
                  <div>
                    <div className="request-card__who">
                      {row.student_name} <span className="text-muted mono">· {row.roll_number}</span>
                    </div>
                    <div className="request-card__slot">{formatSlot(row.slot)}</div>
                  </div>
                </div>

                <div className="request-card__reason-label">Reason</div>
                <div className="request-card__reason">{row.reason}</div>

                {rowErrors[row.id] && <div className="request-card__error">{rowErrors[row.id]}</div>}

                <div className="request-card__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actingOnId === row.id}
                    onClick={() => handleApprove(row)}
                  >
                    <Check size={14} /> Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={actingOnId === row.id}
                    onClick={() => setRejectTarget(row)}
                  >
                    <X size={14} /> Reject
                  </Button>
                </div>
              </Card>
            ))}
        </div>
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        title="Reject this request?"
        body={
          rejectTarget && (
            <p>
              Reject the request from {rejectTarget.student_name} for {formatSlot(rejectTarget.slot)}? The
              student will see this as rejected and will need to submit a new request.
            </p>
          )
        }
        confirmLabel="Reject request"
        danger
        loading={actingOnId === rejectTarget?.id}
        onConfirm={() => rejectTarget && handleReject(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
}
