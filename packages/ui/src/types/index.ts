/**
 * Types mirrored EXACTLY from the real backend (services/api/src), field for
 * field — never invented. Sources:
 *   - services/api/src/repositories/appointment.repository.ts (AppointmentRow)
 *   - services/api/src/domain/appointment-state-machine.ts (AppointmentStatus)
 *   - services/api/src/middleware/identify.middleware.ts (UserRole)
 *   - services/api/tests/http/appointment.http.test.ts (exact JSON shapes,
 *     confirmed against a real running Express app + real PostgreSQL)
 *
 * If the backend's shape ever changes, update this file to match it — never
 * the other way around. This package has no authority over the contract.
 */

export type AppointmentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'MISSED'
  | 'EXPIRED';

export type UserRole = 'STUDENT' | 'FACULTY';

/** Exact shape of a row returned by every appointment endpoint (services/api/src/repositories/appointment.repository.ts AppointmentRow). */
export interface AppointmentRow {
  id: string;
  student_id: string;
  faculty_id: string;
  slot: string;
  status: AppointmentStatus;
  reason: string;
  client_request_id: string | null;
  requested_at: string;
  responded_at: string | null;
  responded_by: string | null;
  cancelled_by: string | null;
  completion_notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Exact shape of a row returned by GET /api/appointments/pending. This is
 * NOT an AppointmentRow — AppointmentService.listPendingForFaculty() selects
 * from the `faculty_pending_requests` VIEW (services/api/migrations/sql/0004_views.sql),
 * not the `appointments` table directly, so the shape genuinely differs: it
 * adds `student_name`/`roll_number` (joined from `students`/`users`) but
 * omits everything AppointmentRow has beyond what the view selects —
 * `status` (every row here is implicitly PENDING by construction — see the
 * view's WHERE clause — but the field itself isn't in the SELECT list),
 * `client_request_id`, `responded_at`, `responded_by`, `cancelled_by`,
 * `completion_notes`, `created_at`, `updated_at`. Confirmed against a real
 * running instance of this endpoint, not just the SQL — verified the exact
 * JSON keys returned. Treating this as an AppointmentRow (as an earlier pass
 * of this codebase briefly did) type-checks but silently drops the two real
 * fields the view actually provides and risks a runtime crash if any code
 * later assumes `.status`/`.completion_notes`/etc. exist on it.
 */
export interface FacultyPendingRequestRow {
  id: string;
  faculty_id: string;
  student_id: string;
  student_name: string;
  roll_number: string;
  slot: string;
  reason: string;
  requested_at: string;
}

/** Body for POST /api/appointments (services/api/src/controllers/appointment.controller.ts requestAppointment). */
export interface RequestAppointmentBody {
  facultyId: string;
  slotStart: string; // ISO 8601
  slotEnd: string; // ISO 8601
  reason: string;
  clientRequestId?: string;
}

/** Body for PATCH /api/appointments/:id/complete (the only PATCH endpoint that accepts a body). */
export interface CompleteAppointmentBody {
  notes?: string;
}

/** Every domain error code the backend's errorHandler middleware can send (services/api/src/middleware/error-handler.middleware.ts), plus the two the identify/requireRole middleware send directly. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR' // 400
  | 'UNAUTHENTICATED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404
  | 'SLOT_CONFLICT' // 409
  | 'FACULTY_UNAVAILABLE' // 409
  | 'ALREADY_PROCESSED' // 409
  | 'INVALID_TRANSITION' // 409
  | 'INTERNAL_ERROR' // 500
  | 'NETWORK_ERROR'; // client-side: request never reached the server

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
}

/** Thrown by the shared API client for every non-2xx response, or a network failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The identity the frontend holds locally and sends as X-User-Id / X-User-Role (services/api/src/middleware/identify.middleware.ts — a temporary stand-in for real authentication, not a security boundary this frontend can strengthen on its own). */
export interface Session {
  userId: string;
  role: UserRole;
  /** Display-only label the person typed at login; never sent to the backend. */
  displayName?: string;
}

/** The valid status transition table, mirrored exactly from services/api/src/domain/appointment-state-machine.ts so the UI can fail fast/disable actions consistently with what the database will actually allow — never as a replacement for the backend's own guard. */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  APPROVED: ['COMPLETED', 'CANCELLED', 'MISSED'],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
  MISSED: [],
  EXPIRED: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Exact shape of a row returned by GET /api/faculty
 * (services/api/src/services/faculty.service.ts FacultyListItem).
 * `designation` is honestly `null`, always, for now — the backend schema
 * (services/api/migrations/sql/0001_extensions_and_core_tables.sql) has no
 * designation column anywhere (not on `faculty`, not on `users`), and this
 * project's rule is to never fabricate data to fill a requested field. The
 * field is present so this type is stable if a real column is added later
 * (a migration Sambhavi would add on the database side, not something this
 * frontend can invent) — it is not omitted, just honestly empty.
 */
export interface FacultyDirectoryRow {
  id: string;
  name: string;
  department: string;
  designation: string | null;
}

/**
 * Exact shape of a row returned by GET /api/faculty/:id/availability
 * (services/api/src/services/faculty.service.ts AvailableSlot). Backed by
 * the real get_available_slots() database function
 * (services/api/migrations/sql/0005_availability_function_and_materialized_view.sql),
 * which already excludes teaching schedule, leave/meeting/block exceptions,
 * and any existing PENDING/APPROVED appointment for that faculty member —
 * every slot this type describes is genuinely bookable right now, not a
 * theoretical opening.
 */
export interface AvailableSlot {
  slot_start: string; // ISO 8601
  slot_end: string; // ISO 8601
}
