import { useCallback, useState } from 'react';
import type { AppointmentRow } from '@faculty-scheduling/ui';
import { appointmentsApi, useToast } from '@faculty-scheduling/ui';
import { useAppointments } from '../state/AppointmentsContext';
import { describeError } from '../utils/errors';

/**
 * Shared cancel flow (PATCH /api/appointments/:id/cancel) used by both the
 * My Appointments list and the appointment detail view, so the confirm →
 * call → update-in-place → toast sequence exists in exactly one place.
 */
export function useCancelAppointment(): {
  cancel: (id: string) => Promise<AppointmentRow | null>;
  cancellingId: string | null;
} {
  const { upsert } = useAppointments();
  const { show } = useToast();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const cancel = useCallback(
    async (id: string): Promise<AppointmentRow | null> => {
      setCancellingId(id);
      try {
        const row = await appointmentsApi.cancel(id);
        upsert(row);
        show('Appointment cancelled.', 'success');
        return row;
      } catch (err) {
        show(describeError(err), 'error');
        return null;
      } finally {
        setCancellingId(null);
      }
    },
    [upsert, show]
  );

  return { cancel, cancellingId };
}
