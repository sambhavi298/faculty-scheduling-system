import { Queryable } from '../db/queryable';

/**
 * Row shape for GET /api/faculty (Controller -> Service -> Repository, same
 * layering as AppointmentRepository). Every field here is a real column or a
 * real join, never invented:
 *   - id           faculty.id
 *   - name         users.full_name (joined via faculty.id -> users.id)
 *   - department   departments.name (joined via faculty.department_id)
 *
 * `designation` is deliberately NOT part of this row. The schema
 * (migrations/sql/0001_extensions_and_core_tables.sql) has no designation
 * column anywhere — not on `faculty`, not on `users`. Per this project's
 * standing "use the current schema only, never invent data" rule (the same
 * rule that produced the honest-blocked-state pattern in the frontend), this
 * repository does not fabricate one. FacultyService adds `designation: null`
 * to the HTTP response shape (see faculty.service.ts) so the response still
 * has the field the frontend contract expects, but it is honestly null
 * rather than a made-up string — a migration adding a real column is a
 * follow-up decision for Sambhavi, not something to guess at here.
 */
export interface FacultyDirectoryRow {
  id: string;
  name: string;
  department: string;
}

/** Row shape for GET /api/faculty/:id/availability — one open, bookable slot. */
export interface AvailableSlotRow {
  slot_start: Date;
  slot_end: Date;
}

/**
 * Row shape for GET /api/faculty/me/stats — the caller's own row from
 * `faculty_appointment_stats` (migrations/sql/0005). Structurally identical
 * to AdminRepository's FacultyStatsRow (same materialized view, same
 * columns) but defined separately here rather than imported: this
 * repository's contract is "the one class permitted to run faculty-facing
 * SQL," so it owns its own row types the same way AdminRepository owns
 * theirs, rather than the two admin/faculty modules reaching into each
 * other's files for a type.
 */
export interface FacultyOwnStatsRow {
  faculty_id: string;
  full_name: string;
  completed_count: number;
  missed_count: number;
  rejected_count: number;
  cancelled_count: number;
  avg_response_minutes: number | null;
  total_requests: number;
}

/**
 * The ONLY class in this codebase permitted to execute faculty-directory and
 * faculty-availability SQL, mirroring AppointmentRepository's role for the
 * appointment domain (Level 5, Section 1). Every read here is a straight
 * SELECT against existing tables/functions — no new schema objects, no new
 * business rules: get_available_slots() (migrations/sql/0005) already IS the
 * authoritative "what's actually bookable" computation (teaching schedule,
 * leave/meeting/block exceptions, and existing PENDING/APPROVED appointments
 * all excluded — see that migration's own comment), so this repository reuses
 * it rather than re-deriving availability logic in application code.
 */
export class FacultyRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Lists all faculty, optionally filtered by a case-insensitive substring
   * match on name. A single parameterized query handles both the
   * "search provided" and "no search" cases (`$1::text IS NULL OR ...`)
   * rather than branching to build different SQL strings — keeps this fully
   * parameterized, matching the rest of the codebase's style.
   */
  async listFaculty(search: string | null): Promise<FacultyDirectoryRow[]> {
    const result = await this.db.query<FacultyDirectoryRow>(
      `SELECT f.id, u.full_name AS name, d.name AS department
         FROM faculty f
         JOIN users u ON u.id = f.id
         JOIN departments d ON d.id = f.department_id
        WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%')
        ORDER BY u.full_name`,
      [search]
    );
    return result.rows;
  }

  /** Existence check only — used by FacultyService to return a clean 404 for an unknown faculty id before querying availability. */
  async findById(facultyId: string): Promise<{ id: string } | null> {
    const result = await this.db.query<{ id: string }>(`SELECT f.id FROM faculty f WHERE f.id = $1`, [facultyId]);
    return result.rows[0] ?? null;
  }

  /**
   * Delegates entirely to get_available_slots() (migrations/sql/0005) — the
   * same function book_appointment() itself is proven to agree with (see
   * tests/integration/booking-availability-enforcement.test.ts: "every slot
   * get_available_slots() reports as open ... is ALSO accepted by
   * book_appointment()"). This repository does not re-implement any part of
   * that computation; it only calls it and returns the rows.
   */
  async getAvailableSlots(facultyId: string, date: string, slotMinutes: number): Promise<AvailableSlotRow[]> {
    const result = await this.db.query<AvailableSlotRow>(
      `SELECT slot_start, slot_end FROM get_available_slots($1, $2, $3)`,
      [facultyId, date, slotMinutes]
    );
    return result.rows;
  }

  /**
   * Refreshes `faculty_appointment_stats` before every read of it, exactly
   * mirroring AdminRepository.refreshFacultyStats()'s own reasoning: no
   * background-refresh scheduler exists anywhere in this codebase (still
   * out of scope), so refreshing on read is what keeps this honestly
   * correct rather than confidently stale. `CONCURRENTLY` never blocks
   * concurrent reads — it needs the unique index the view already has
   * (migrations/sql/0005).
   */
  async refreshStats(): Promise<void> {
    await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats`);
  }

  /**
   * One faculty member's own row from the stats view — the self-service
   * counterpart to AdminRepository.listFacultyStats(), scoped to a single
   * `faculty_id` rather than every faculty member. The view is built with a
   * LEFT JOIN from `faculty`/`users` (see migrations/sql/0005 and the
   * "correctly reports zero requests" test in
   * tests/advanced-sql/advanced-sql-features.test.ts), so every real
   * faculty id has a row even with zero appointments — `null` here means
   * the id itself doesn't exist, which FacultyService turns into a 404.
   */
  async getOwnStats(facultyId: string): Promise<FacultyOwnStatsRow | null> {
    const result = await this.db.query<FacultyOwnStatsRow>(
      `SELECT * FROM faculty_appointment_stats WHERE faculty_id = $1`,
      [facultyId]
    );
    return result.rows[0] ?? null;
  }
}
