import { apiClient } from './client';
import type { AvailabilityWindowInput, ExceptionInput, FacultyAvailabilityWindowRow, FacultyScheduleExceptionRow } from '../types';

/**
 * Corresponds 1:1 to services/api/src/routes/faculty-availability.routes.ts
 * — the write side of the Faculty Availability module. Both endpoints act
 * on the AUTHENTICATED caller's own availability (Faculty-only, enforced
 * server-side) — there is no facultyId parameter anywhere here.
 */
export const facultyAvailabilityApi = {
  /** GET /api/faculty/availability — Faculty only. Lists the caller's own currently-active declared windows. */
  listOwn: (): Promise<FacultyAvailabilityWindowRow[]> => apiClient.get('/api/faculty/availability'),

  /** PUT /api/faculty/availability — Faculty only. Replaces the caller's ENTIRE declared availability set. */
  replaceAvailability: (windows: AvailabilityWindowInput[]): Promise<FacultyAvailabilityWindowRow[]> =>
    apiClient.put('/api/faculty/availability', windows),

  /** POST /api/faculty/availability/exceptions — Faculty only. Adds one leave/meeting/block/extra-availability entry. */
  addException: (input: ExceptionInput): Promise<FacultyScheduleExceptionRow> =>
    apiClient.post('/api/faculty/availability/exceptions', input),
};
