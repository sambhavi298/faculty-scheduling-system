import React, { useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import {
  EmptyState,
  NoticeBanner,
  PageHeader,
  StatusBadge,
  Table,
  formatDateTime,
  formatSlot,
  readCache,
  useSession,
  type AppointmentRow,
} from '@faculty-scheduling/ui';

export function History(): React.ReactElement {
  const { session } = useSession();
  const userId = session!.userId;
  const [rows, setRows] = useState<AppointmentRow[]>([]);

  useEffect(() => {
    setRows(readCache('faculty:history', userId));
  }, [userId]);

  const sorted = [...rows].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  return (
    <div>
      <PageHeader title="History" subtitle="Completed, missed, rejected, and cancelled appointments." />

      <NoticeBanner icon={<MonitorSmartphone size={16} />}>
        This list only shows appointments <strong>this device</strong> has seen — the backend doesn't yet have an
        endpoint that lists all of a faculty member's non-pending appointments. Every row here is real data from an
        action you (or this device) actually performed; it will be incomplete if you use another device or browser,
        or if you cleared site data.
      </NoticeBanner>

      {sorted.length === 0 && (
        <EmptyState
          title="No history yet on this device"
          description="Once you complete, mark missed, reject, or cancel an appointment on this device, it will appear here."
        />
      )}

      {sorted.length > 0 && (
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
