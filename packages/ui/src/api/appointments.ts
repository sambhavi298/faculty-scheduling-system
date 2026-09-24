import { apiClient } from './client';
import type { AppointmentRow, CompleteAppointmentBody, FacultyPendingRequestRow, RequestAppointmentBody } from '../types';

/**
 * Every function here corresponds 1:1 to a real, already-implemented route in
 * services/api/src/routes/appointment.routes.ts. No other appointment
 * endpoint exists — do not add one here without it first existing in the
 * backend.
 */
export const appointmentsApi = {
  /** POST /api/appointments — Student only. */
  request: (body: RequestAppointmentBody): Promise<AppointmentRow> => apiClient.post('/api/appointments', body),

  /** GET /api/appointments/mine — Student only. */
  listMine: (): Promise<AppointmentRow[]> => apiClient.get('/api/appointments/mine'),

  /** GET /api/appointments/pending — Faculty only. Returns the faculty_pending_requests view's shape, not a raw AppointmentRow — see FacultyPendingRequestRow. */
  listPending: (): Promise<FacultyPendingRequestRow[]> => apiClient.get('/api/appointments/pending'),

  /** PATCH /api/appointments/:id/approve — Faculty, must own. */
  approve: (id: string): Promise<AppointmentRow> => apiClient.patch(`/api/appointments/${id}/approve`),

  /** PATCH /api/appointments/:id/reject — Faculty, must own. */
  reject: (id: string): Promise<AppointmentRow> => apiClient.patch(`/api/appointments/${id}/reject`),

  /** PATCH /api/appointments/:id/cancel — Student or faculty, must be a party to the appointment. */
  cancel: (id: string): Promise<AppointmentRow> => apiClient.patch(`/api/appointments/${id}/cancel`),

  /** PATCH /api/appointments/:id/complete — Faculty, must own. Optional notes. */
  complete: (id: string, body?: CompleteAppointmentBody): Promise<AppointmentRow> =>
    apiClient.patch(`/api/appointments/${id}/complete`, body),

  /** PATCH /api/appointments/:id/missed — Faculty, must own. */
  markMissed: (id: string): Promise<AppointmentRow> => apiClient.patch(`/api/appointments/${id}/missed`),
};
