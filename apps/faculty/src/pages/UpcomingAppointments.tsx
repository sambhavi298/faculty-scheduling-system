import React, { useEffect, useState } from 'react';
import { CheckCheck, AlertTriangle, Ban, MonitorSmartphone } from 'lucide-react';
import {
  appointmentsApi,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  NoticeBanner,
  PageHeader,
  Textarea,
  formatSlot,
  readCache,
  removeFromCache,
  upsertCache,
  useSession,
  useToast,
  type AppointmentRow,
} from '@faculty-scheduling/ui';
import { describeError } from '../lib/errorMessage';

type DialogKind = 'complete' | 'missed' | 'cancel';
interface DialogState {
  kind: DialogKind;
  row: AppointmentRow;
}

export function UpcomingAppointments(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.userId;
  const { show } = useToast();

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    setRows(readCache('faculty:upcoming', userId));
  }

  useEffect(refresh, [userId]);

  function openDialog(kind: DialogKind, row: AppointmentRow): void {
    setNotes('');
    setError(null);
    setDialog({ kind, row });
  }

  function moveToHistory(row: AppointmentRow): void {
    removeFromCache('faculty:upcoming', userId, row.id);
    upsertCache('faculty:history', userId, row);
    refresh();
  }

  async function handleConfirm(): Promise<void> {
    if (!dialog) return;
    const { kind, row } = dialog;
    setBusy(true);
    setError(null);
    try {
      let updated: AppointmentRow;
      if (kind === 'complete') {
        updated = await appointmentsApi.complete(row.id, notes.trim() ? { notes: notes.trim() } : undefined);
      } else if (kind === 'missed') {
        updated = await appointmentsApi.markMissed(row.id);
      } else {
        updated = await appointmentsApi.cancel(row.id);
      }
      moveToHistory(updated);
      show(
        kind === 'complete' ? 'Marked as completed.' : kind === 'missed' ? 'Marked as missed.' : 'Appointment cancelled.',
        'success'
      );
      setDialog(null);
    } catch (err) {
      setError(describeError(err));
      show(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const aStart = a.slot.match(/[[(]"?([^",]+)/)?.[1];
    const bStart = b.slot.match(/[[(]"?([^",]+)/)?.[1];
    return new Date(aStart ?? a.updated_at).getTime() - new Date(bStart ?? b.updated_at).getTime();
  });

  return (
    <div>
      <PageHeader title="Upcoming Appointments" subtitle="Approved appointments you can mark complete, missed, or cancel." />

      <NoticeBanner icon={<MonitorSmartphone size={16} />}>
        This list only shows appointments <strong>this device</strong> has seen — the backend doesn't yet have an
        endpoint that lists all of a faculty member's non-pending appointments. Every row here is real data from an
        action you (or this device) actually performed; it will be incomplete if you use another device or browser,
        or if you cleared site data.
      </NoticeBanner>

      {rows.length === 0 && (
        <EmptyState
          title="No upcoming appointments yet"
          description="Approve a pending request to see it here, or check another device where you approved one."
        />
      )}

      {rows.length > 0 && (
        <div className="request-list">
          {sorted.map((row) => (
            <Card key={row.id}>
              <div className="request-card__top">
                <div>
                  <div className="request-card__who">Student #{row.student_id}</div>
                  <div className="request-card__slot">{formatSlot(row.slot)}</div>
                </div>
              </div>

              <div className="request-card__reason-label">Reason</div>
              <div className="request-card__reason">{row.reason}</div>

              <div className="request-card__actions">
                <Button variant="primary" size="sm" onClick={() => openDialog('complete', row)}>
                  <CheckCheck size={14} /> Mark complete
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openDialog('missed', row)}>
                  <AlertTriangle size={14} /> Mark missed
                </Button>
                <Button variant="danger" size="sm" onClick={() => openDialog('cancel', row)}>
                  <Ban size={14} /> Cancel
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={dialog !== null}
        title={
          dialog?.kind === 'complete'
            ? 'Mark appointment complete?'
            : dialog?.kind === 'missed'
            ? 'Mark appointment missed?'
            : 'Cancel this appointment?'
        }
        body={
          dialog && (
            <div>
              <p style={{ marginBottom: dialog.kind === 'complete' ? 12 : 0 }}>
                Student #{dialog.row.student_id} · {formatSlot(dialog.row.slot)}
              </p>
              {dialog.kind === 'complete' && (
                <div className="field">
                  <label className="field__label" htmlFor="completion-notes">
                    Completion notes (optional)
                  </label>
                  <Textarea
                    id="completion-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What was discussed, any follow-up needed…"
                  />
                </div>
              )}
              {error && <div className="request-card__error" style={{ marginTop: 10 }}>{error}</div>}
            </div>
          )
        }
        confirmLabel={dialog?.kind === 'complete' ? 'Mark complete' : dialog?.kind === 'missed' ? 'Mark missed' : 'Cancel appointment'}
        danger={dialog?.kind !== 'complete'}
        loading={busy}
        onConfirm={handleConfirm}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
