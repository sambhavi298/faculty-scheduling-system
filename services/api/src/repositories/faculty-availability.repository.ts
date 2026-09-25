import { Queryable } from '../db/queryable';
import { AvailabilityOverlapError } from '../errors/availability-overlap.error';

/**
 * node-pg has no custom type parser registered anywhere in this codebase
 * (db/client.ts), so a `date` column comes back as a JS `Date` object, not
 * the `'YYYY-MM-DD'` string these row interfaces declare — the same gap
 * FacultyService.getAvailability() already closes for `timestamptz` columns
 * by converting to ISO strings before a row ever leaves the Repository/
 * Service boundary (Level 5's "never leak a raw driver type to a caller").
 *
 * That `Date` object is NOT midnight UTC, despite what an earlier version of
 * this comment claimed — pg-types' default DATE parser builds it via
 * `new Date(year, month, day)`, the LOCAL-timezone constructor, not UTC.
 * Reading it back out with `.toISOString()` (always UTC) silently rolls the
 * date back a day whenever the host's local timezone is ahead of UTC —
 * which IST (UTC+5:30) always is. This surfaced as a real, reproducible test
 * failure (`addException` persisting '2026-08-31' but reading back
 * '2026-08-30') despite the database itself being correctly pinned to
 * Asia/Kolkata (migration 0008) — a JS Date round-trip bug, not a database
 * timezone bug. Reading the Date back out with the same LOCAL getters
 * (getFullYear/getMonth/getDate) it was constructed from round-trips
 * correctly regardless of the host machine's timezone. Applied here for
 * every `date` column this repository returns (effective_from/
 * effective_until/exception_date).
 */
function toDateString(value: unknown): string {
  if (!(value instanceof Date)) {
    return value as string;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface FacultyAvailabilityWindowRow {
  id: string;
  faculty_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until: string | null;
  is_active: boolean;
}

export interface AvailabilityWindowInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

export interface FacultyScheduleExceptionRow {
  id: string;
  faculty_id: string;
  exception_date: string;
  start_time: string | null;
  end_time: string | null;
  exception_type: string;
  reason: string | null;
  created_at: string;
}

export interface ExceptionInput {
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  type: string;
  reason?: string | null;
}

/**
 * The ONLY class permitted to execute faculty_availability/
 * faculty_schedule_exceptions WRITE SQL (Level 5, Section 1) — the write-side
 * counterpart to FacultyRepository's read-only availability lookup. Closes
 * the last piece of docs/GITHUB_ISSUES.md's "Faculty availability HTTP
 * endpoints" dependency: get_available_slots()/is_faculty_available()
 * (migrations 0005/0006) and the overlap-protection exclusion constraint
 * (migration 0007) already existed at the database level; this class is the
 * first application code that writes through them.
 */
export class FacultyAvailabilityRepository {
  constructor(private readonly db: Queryable) {}

  async facultyExists(facultyId: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(`SELECT id FROM faculty WHERE id = $1`, [facultyId]);
    return result.rows.length > 0;
  }

  /**
   * Replaces a faculty member's ENTIRE declared availability set in one
   * atomic statement, matching the PUT-replace semantics of Level 5's API
   * contract table. Implemented as a single data-modifying CTE chain rather
   * than "loop in application code, deleting then inserting row by row":
   *
   *   1. `deactivated`: soft-deactivates every currently-active window for
   *      this faculty member (is_active = FALSE, never a hard DELETE — this
   *      preserves history the same way appointments never hard-deletes a
   *      row, just changes its status).
   *   2. The INSERT then expands the submitted JSON array via
   *      `jsonb_to_recordset` and writes the new set as newly-active rows.
   *
   * The INSERT's WHERE clause references `(SELECT count(*) FROM deactivated)`
   * purely to create a real data dependency — PostgreSQL does not guarantee
   * an execution order between sibling CTEs that don't reference each
   * other's output, and migration 0007's exclusion constraint (WHERE
   * is_active) would incorrectly see the OLD rows as still active if the
   * INSERT could execute before the UPDATE commits within the same
   * statement. This forced-dependency pattern is what makes "deactivate,
   * then insert" atomic and ordered within one round trip, instead of two
   * separate statements that would leave a window (however brief) where a
   * concurrent read sees neither the old nor the new set correctly, or
   * where a crash between the two statements leaves the faculty member with
   * zero declared availability.
   */
  async replaceAvailability(facultyId: string, windows: AvailabilityWindowInput[]): Promise<FacultyAvailabilityWindowRow[]> {
    try {
      // jsonb_to_recordset()'s column list below (day_of_week, start_time, ...)
      // matches JSON object keys by exact name — it does not know about
      // AvailabilityWindowInput's camelCase field names, so the JSON payload
      // sent to Postgres must be built with the same snake_case keys as the
      // table itself, not JSON.stringify(windows) directly (that would leave
      // every column but faculty_id NULL — jsonb_to_recordset silently skips
      // keys it doesn't recognize rather than erroring).
      const payload = windows.map((w) => ({
        day_of_week: w.dayOfWeek,
        start_time: w.startTime,
        end_time: w.endTime,
        effective_from: w.effectiveFrom,
        effective_until: w.effectiveUntil ?? null,
      }));
      const result = await this.db.query<FacultyAvailabilityWindowRow>(
        `WITH deactivated AS (
           UPDATE faculty_availability
              SET is_active = FALSE
            WHERE faculty_id = $1 AND is_active
           RETURNING id
         )
         INSERT INTO faculty_availability
                (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until, is_active)
         SELECT $1, x.day_of_week, x.start_time, x.end_time, x.effective_from, x.effective_until, TRUE
           FROM jsonb_to_recordset($2::jsonb)
                  AS x(day_of_week SMALLINT, start_time TIME, end_time TIME, effective_from DATE, effective_until DATE)
          WHERE (SELECT count(*) FROM deactivated) >= 0
         RETURNING *`,
        [facultyId, JSON.stringify(payload)]
      );
      return result.rows.map((row) => ({
        ...row,
        effective_from: toDateString(row.effective_from),
        effective_until: row.effective_until === null ? null : toDateString(row.effective_until),
      }));
    } catch (err: any) {
      // Migration 0007's faculty_availability_no_overlap exclusion
      // constraint: two submitted windows (or a submitted window and one
      // that somehow survived deactivation) genuinely overlap in time, on
      // the same day, within an overlapping effective-date range.
      if (err?.code === '23P01') {
        throw new AvailabilityOverlapError();
      }
      throw err;
    }
  }

  async listActiveWindows(facultyId: string): Promise<FacultyAvailabilityWindowRow[]> {
    const result = await this.db.query<FacultyAvailabilityWindowRow>(
      `SELECT * FROM faculty_availability WHERE faculty_id = $1 AND is_active ORDER BY day_of_week, start_time`,
      [facultyId]
    );
    return result.rows.map((row) => ({
      ...row,
      effective_from: toDateString(row.effective_from),
      effective_until: row.effective_until === null ? null : toDateString(row.effective_until),
    }));
  }

  /**
   * Ad hoc exceptions are genuinely additive (Level 5, Section 11: "Not
   * idempotent; low-risk enough that no idempotency key is required" — a
   * duplicate leave/meeting/block entry is harmless, not a correctness bug,
   * unlike a double-booked appointment) — a plain INSERT, no exclusion
   * constraint exists on this table and none is needed.
   */
  async addException(facultyId: string, input: ExceptionInput): Promise<FacultyScheduleExceptionRow> {
    const result = await this.db.query<FacultyScheduleExceptionRow>(
      `INSERT INTO faculty_schedule_exceptions (faculty_id, exception_date, start_time, end_time, exception_type, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [facultyId, input.date, input.startTime ?? null, input.endTime ?? null, input.type, input.reason ?? null]
    );
    const row = result.rows[0];
    return { ...row, exception_date: toDateString(row.exception_date) };
  }
}
