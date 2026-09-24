import { FacultyRepository, FacultyOwnStatsRow } from '../repositories/faculty.repository';
import { NotFoundError } from '../errors/not-found.error';
import { ValidationError } from '../errors/validation.error';

const DEFAULT_SLOT_MINUTES = 30;
const FACULTY_ID_PATTERN = /^\d+$/; // faculty.id is BIGINT (migrations/sql/0001) — a valid id is digits only
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Response shape for one row of GET /api/faculty. `designation` is always
 * `null` today — see the long comment on FacultyDirectoryRow in
 * faculty.repository.ts for why: there is no designation column anywhere in
 * the schema, and this project's rule is to never fabricate data to fill a
 * requested field. The field is still present in every response (rather than
 * omitted) so the frontend contract is stable and doesn't need to
 * special-case its absence — it's honestly empty, not missing.
 */
export interface FacultyListItem {
  id: string;
  name: string;
  department: string;
  designation: string | null;
}

/** Response shape for one row of GET /api/faculty/:id/availability. ISO 8601 strings — see getAvailability() for why the Service converts the Date objects the driver returns into strings here rather than leaving that to Express's implicit JSON serialization. */
export interface AvailableSlot {
  slot_start: string;
  slot_end: string;
}

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_PATTERN.test(dateStr)) return false;
  // Reject a syntactically-shaped but nonexistent date (e.g. 2026-02-30) —
  // the JS Date constructor silently normalizes it (rolls over into March)
  // rather than throwing, so a round-trip-format check is the only way to
  // catch that. get_available_slots() would otherwise silently compute
  // slots for the rolled-over date instead of rejecting the request.
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === dateStr;
}

/**
 * Orchestrates the Faculty Directory module (Controller -> Service ->
 * Repository, same layering AppointmentService uses). Per the project's
 * database-first philosophy: the actual availability computation lives in
 * the database (get_available_slots(), migrations/sql/0005) — this class
 * only validates HTTP-shaped input before it reaches SQL (a malformed date
 * or a non-numeric id should fail fast with a clear 400, not a raw
 * PostgreSQL type-cast error surfacing as an opaque 500) and translates an
 * unknown faculty id into a proper NotFoundError. It does not re-implement
 * or duplicate any part of the availability rules themselves.
 */
export class FacultyService {
  constructor(private readonly repo: FacultyRepository) {}

  async listFaculty(search?: string): Promise<FacultyListItem[]> {
    const trimmed = search?.trim();
    const rows = await this.repo.listFaculty(trimmed ? trimmed : null);
    return rows.map((row) => ({ ...row, designation: null }));
  }

  async getAvailability(facultyId: string, date: string, slotMinutes?: number): Promise<AvailableSlot[]> {
    if (!FACULTY_ID_PATTERN.test(facultyId)) {
      throw new ValidationError('faculty id must be numeric');
    }
    if (!date || !isValidCalendarDate(date)) {
      throw new ValidationError('date query parameter is required and must be a valid calendar date (YYYY-MM-DD)');
    }
    const resolvedSlotMinutes = slotMinutes ?? DEFAULT_SLOT_MINUTES;
    if (!Number.isInteger(resolvedSlotMinutes) || resolvedSlotMinutes <= 0) {
      throw new ValidationError('slotMinutes must be a positive integer');
    }

    const faculty = await this.repo.findById(facultyId);
    if (!faculty) {
      throw new NotFoundError('No faculty member exists with that id.');
    }

    const rows = await this.repo.getAvailableSlots(facultyId, date, resolvedSlotMinutes);
    // get_available_slots() returns real TIMESTAMPTZ columns, which `pg`
    // parses into JS Date objects by default (unlike appointments.slot, a
    // TSTZRANGE with no registered parser — see utils/slot.ts on the
    // frontend). Converting to ISO strings here, explicitly, keeps the
    // Service's return type stable and directly testable (a unit test can
    // assert on a string without depending on Express's implicit
    // Date -> JSON serialization), rather than leaving that conversion to
    // happen implicitly at the HTTP boundary.
    return rows.map((row) => ({
      slot_start: row.slot_start.toISOString(),
      slot_end: row.slot_end.toISOString(),
    }));
  }

  /**
   * GET /api/faculty/me/stats — a faculty member's own workload summary.
   * Added so the faculty frontend's "Appointment history" stats section
   * (previously unbuilt for lack of any faculty-facing stats endpoint —
   * GET /api/admin/dashboard's facultyStats is ADMIN-only, and rightly so:
   * one faculty member has no business reading another's numbers) has a
   * real, narrowly-scoped endpoint to call: this refreshes and reads
   * exactly one row of `faculty_appointment_stats`, never any other faculty
   * member's. `facultyId` here always comes from the verified JWT's `sub`
   * claim (req.user!.id in the Controller), never a caller-supplied path
   * param — there is no `:id` in this route on purpose, so there is no
   * "am I allowed to see this other faculty member's stats" check to get
   * wrong in the first place.
   */
  async getOwnStats(facultyId: string): Promise<FacultyOwnStatsRow> {
    await this.repo.refreshStats();
    const row = await this.repo.getOwnStats(facultyId);
    if (!row) {
      throw new NotFoundError('No faculty member exists with that id.');
    }
    return row;
  }
}
