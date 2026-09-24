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
}
