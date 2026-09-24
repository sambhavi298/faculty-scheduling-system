import { apiClient } from './client';
import type { AvailableSlot, FacultyDirectoryRow } from '../types';

/**
 * Every function here corresponds 1:1 to a real, already-implemented route in
 * services/api/src/routes/faculty.routes.ts. No other faculty endpoint
 * exists — do not add one here without it first existing in the backend
 * (same rule appointments.ts follows for the appointment module).
 */
export const facultyApi = {
  /** GET /api/faculty — either role. Optional case-insensitive name search. */
  list: (search?: string): Promise<FacultyDirectoryRow[]> => {
    const trimmed = search?.trim();
    const query = trimmed ? `?search=${encodeURIComponent(trimmed)}` : '';
    return apiClient.get(`/api/faculty${query}`);
  },

  /** GET /api/faculty/:id/availability — either role. `date` must be YYYY-MM-DD; slotMinutes defaults to 30 server-side if omitted. */
  getAvailability: (facultyId: string, date: string, slotMinutes?: number): Promise<AvailableSlot[]> => {
    const params = new URLSearchParams({ date });
    if (slotMinutes) params.set('slotMinutes', String(slotMinutes));
    return apiClient.get(`/api/faculty/${encodeURIComponent(facultyId)}/availability?${params.toString()}`);
  },
};
