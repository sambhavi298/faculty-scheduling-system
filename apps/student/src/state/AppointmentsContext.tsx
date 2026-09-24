import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppointmentRow } from '@faculty-scheduling/ui';
import { appointmentsApi } from '@faculty-scheduling/ui';

/**
 * A single in-memory copy of the student's own appointments
 * (GET /api/appointments/mine — the only listing endpoint that exists for
 * students), shared across every screen inside RequireAuth.
 *
 * This exists because several screens need the SAME already-fetched rows
 * rather than each issuing their own request:
 *  - the appointment detail view has no GET-by-id endpoint to call, so it
 *    must find the row in a list that was already fetched;
 *  - the request form's "recently contacted faculty" quick-pick and the
 *    faculty directory's "faculty you've been in contact with" list are both
 *    derived from these same real rows, not a second fetch or invented data.
 *
 * `upsert` lets a mutation response (POST /appointments, PATCH .../cancel)
 * update this shared list in place without a full refetch.
 */
interface AppointmentsContextValue {
  appointments: AppointmentRow[];
  loading: boolean;
  error: unknown;
  refetch: () => Promise<void>;
  upsert: (row: AppointmentRow) => void;
}

const AppointmentsContext = createContext<AppointmentsContextValue | undefined>(undefined);

export function AppointmentsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const rows = await appointmentsApi.listMine();
      setAppointments(rows);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upsert = useCallback((row: AppointmentRow) => {
    setAppointments((current) => {
      const idx = current.findIndex((r) => r.id === row.id);
      if (idx === -1) return [row, ...current];
      const next = current.slice();
      next[idx] = row;
      return next;
    });
  }, []);

  const value = useMemo<AppointmentsContextValue>(
    () => ({ appointments, loading, error, refetch: load, upsert }),
    [appointments, loading, error, load, upsert]
  );

  return <AppointmentsContext.Provider value={value}>{children}</AppointmentsContext.Provider>;
}

export function useAppointments(): AppointmentsContextValue {
  const ctx = useContext(AppointmentsContext);
  if (!ctx) throw new Error('useAppointments must be used within an AppointmentsProvider');
  return ctx;
}
