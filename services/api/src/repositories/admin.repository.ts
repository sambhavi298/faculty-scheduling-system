import { Queryable } from '../db/queryable';
import { ValidationError } from '../errors/validation.error';

export interface DepartmentRow {
  id: number;
  name: string;
  code: string;
}

export interface BatchRow {
  id: number;
  department_id: number;
  name: string;
  academic_year: string;
}

export interface AdminFacultyRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  department_id: number;
  staff_code: string;
  office_location: string | null;
}

export interface AdminStudentRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  batch_id: number;
  roll_number: string;
}

export interface AuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
}

export interface DashboardCounts {
  total_students: number;
  total_faculty: number;
  total_departments: number;
  pending_appointments: number;
  approved_appointments: number;
  completed_appointments: number;
}

export interface FacultyStatsRow {
  faculty_id: string;
  full_name: string;
  completed_count: number;
  missed_count: number;
  rejected_count: number;
  cancelled_count: number;
  avg_response_minutes: number | null;
  total_requests: number;
}

export interface WorkloadReportRow {
  faculty_id: string;
  full_name: string;
  week_start: string;
  appointments_that_week: number;
  workload_rank: number;
  running_total_this_semester: number;
}

/**
 * The ONLY class permitted to execute admin-module SQL. One repository
 * covering several simple, closely-related entities (departments, batches,
 * faculty, students) rather than four near-identical near-empty
 * repositories — the same reasoning Level 5, Section 2 gives for NOT
 * building a generic `BaseRepository<T>`: these are genuinely simple,
 * single-table-shaped reads/writes, and a full repository-per-entity split
 * wouldn't pay for itself at this scale. AuditRepository's read-only
 * separation (Level 5, Interface Segregation) is preserved in spirit here —
 * every audit method in this class is a SELECT, nothing here ever writes to
 * audit_log (only triggers may, per migrations/sql grants).
 *
 * Deliberately NOT implemented: hard delete for any entity. The schema
 * (migrations/sql/0001) has no soft-delete/is_active column on departments,
 * batches, faculty, or students, and a hard DELETE here would either fail
 * against existing FK references (appointments, students, faculty) or
 * silently orphan history/audit rows that Level 1's auditability
 * requirement says must be preserved. Per this project's standing
 * "use the current schema only, never invent a column to make a feature
 * fit" rule, deactivation/deletion is left as a genuine follow-up decision
 * (would need a real migration) rather than worked around here.
 */
export class AdminRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Shared by every write method below: translates the two Postgres error
   * codes a malformed admin write can realistically hit —
   * `foreign_key_violation` (a referenced department/batch id doesn't
   * exist) and `unique_violation` (a duplicate email/department code/staff
   * code/roll number, each backed by a real UNIQUE constraint from
   * migrations/sql/0001) — into a typed ValidationError with a plain-English
   * message, rather than letting a raw Postgres error surface as an opaque
   * 500. Every other error still propagates unchanged.
   */
  private async runWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.code === '23503') {
        throw new ValidationError('The request references a department, batch, or user id that does not exist.');
      }
      if (err?.code === '23505') {
        throw new ValidationError('That email, code, staff code, or roll number is already in use.');
      }
      throw err;
    }
  }

  // ---- Departments ----

  async listDepartments(): Promise<DepartmentRow[]> {
    const result = await this.db.query<DepartmentRow>(`SELECT * FROM departments ORDER BY name`);
    return result.rows;
  }

  async createDepartment(name: string, code: string): Promise<DepartmentRow> {
    return this.runWrite(async () => {
      const result = await this.db.query<DepartmentRow>(
        `INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING *`,
        [name, code]
      );
      return result.rows[0];
    });
  }

  async updateDepartment(id: number, name: string | undefined, code: string | undefined): Promise<DepartmentRow | null> {
    return this.runWrite(async () => {
      const result = await this.db.query<DepartmentRow>(
        `UPDATE departments SET name = COALESCE($2, name), code = COALESCE($3, code) WHERE id = $1 RETURNING *`,
        [id, name ?? null, code ?? null]
      );
      return result.rows[0] ?? null;
    });
  }

  // ---- Batches ----

  async listBatches(departmentId?: number): Promise<BatchRow[]> {
    const result = await this.db.query<BatchRow>(
      `SELECT * FROM batches WHERE ($1::int IS NULL OR department_id = $1) ORDER BY academic_year DESC, name`,
      [departmentId ?? null]
    );
    return result.rows;
  }

  async createBatch(departmentId: number, name: string, academicYear: string): Promise<BatchRow> {
    return this.runWrite(async () => {
      const result = await this.db.query<BatchRow>(
        `INSERT INTO batches (department_id, name, academic_year) VALUES ($1, $2, $3) RETURNING *`,
        [departmentId, name, academicYear]
      );
      return result.rows[0];
    });
  }

  async updateBatch(id: number, name: string | undefined, academicYear: string | undefined): Promise<BatchRow | null> {
    return this.runWrite(async () => {
      const result = await this.db.query<BatchRow>(
        `UPDATE batches SET name = COALESCE($2, name), academic_year = COALESCE($3, academic_year) WHERE id = $1 RETURNING *`,
        [id, name ?? null, academicYear ?? null]
      );
      return result.rows[0] ?? null;
    });
  }

  // ---- Faculty ----

  async listFaculty(): Promise<AdminFacultyRow[]> {
    const result = await this.db.query<AdminFacultyRow>(
      `SELECT f.id, u.email, u.full_name, u.phone, f.department_id, f.staff_code, f.office_location
         FROM faculty f JOIN users u ON u.id = f.id
        ORDER BY u.full_name`
    );
    return result.rows;
  }

  /**
   * Creates the `users` row and the `faculty` row that must reference it in
   * ONE atomic statement — the same forced-CTE-dependency technique
   * FacultyAvailabilityRepository.replaceAvailability() uses, and for the
   * same reason: the `Queryable` interface (db/queryable.ts) exposes only
   * `query()`, deliberately not raw transaction control (a `pg.Pool`'s
   * `query()` calls do not share a connection across calls, so a manual
   * BEGIN/INSERT/INSERT/COMMIT sequence here would NOT be atomic — each
   * statement could be routed to a different pooled connection). A single
   * statement sidesteps that entirely: either both rows exist, or neither
   * does, with no separate transaction-management code needed anywhere in
   * this codebase, consistent with how book_appointment() achieves the same
   * property for appointment + audit writes.
   */
  async createFaculty(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone: string | null;
    departmentId: number;
    staffCode: string;
    officeLocation: string | null;
  }): Promise<AdminFacultyRow> {
    return this.runWrite(async () => {
      const result = await this.db.query<AdminFacultyRow>(
        `WITH new_user AS (
           INSERT INTO users (email, password_hash, full_name, phone, role)
           VALUES ($1, $2, $3, $4, 'FACULTY')
           RETURNING id, email, full_name, phone
         )
         INSERT INTO faculty (id, department_id, staff_code, office_location)
         SELECT id, $5, $6, $7 FROM new_user
         RETURNING id,
                   (SELECT email FROM new_user) AS email,
                   (SELECT full_name FROM new_user) AS full_name,
                   (SELECT phone FROM new_user) AS phone,
                   department_id, staff_code, office_location`,
        [input.email, input.passwordHash, input.fullName, input.phone, input.departmentId, input.staffCode, input.officeLocation]
      );
      return result.rows[0];
    });
  }

  /** Same atomic-CTE shape as createFaculty, for an UPDATE instead of an INSERT: the users row updates first, the faculty row's UPDATE is scoped to that same id via the CTE reference. */
  async updateFaculty(
    id: string,
    input: { fullName?: string; phone?: string | null; departmentId?: number; officeLocation?: string | null }
  ): Promise<AdminFacultyRow | null> {
    return this.runWrite(async () => {
      const result = await this.db.query<AdminFacultyRow>(
        `WITH updated_user AS (
           UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone)
            WHERE id = $1 AND role = 'FACULTY'
           RETURNING id, email, full_name, phone
         )
         UPDATE faculty
            SET department_id = COALESCE($4, department_id),
                office_location = COALESCE($5, office_location)
          WHERE id = (SELECT id FROM updated_user)
         RETURNING id,
                   (SELECT email FROM updated_user) AS email,
                   (SELECT full_name FROM updated_user) AS full_name,
                   (SELECT phone FROM updated_user) AS phone,
                   department_id, staff_code, office_location`,
        [id, input.fullName ?? null, input.phone ?? null, input.departmentId ?? null, input.officeLocation ?? null]
      );
      return result.rows[0] ?? null;
    });
  }

  // ---- Students ----

  async listStudents(batchId?: number): Promise<AdminStudentRow[]> {
    const result = await this.db.query<AdminStudentRow>(
      `SELECT s.id, u.email, u.full_name, u.phone, s.batch_id, s.roll_number
         FROM students s JOIN users u ON u.id = s.id
        WHERE ($1::int IS NULL OR s.batch_id = $1)
        ORDER BY u.full_name`,
      [batchId ?? null]
    );
    return result.rows;
  }

  async createStudent(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone: string | null;
    batchId: number;
    rollNumber: string;
  }): Promise<AdminStudentRow> {
    return this.runWrite(async () => {
      const result = await this.db.query<AdminStudentRow>(
        `WITH new_user AS (
           INSERT INTO users (email, password_hash, full_name, phone, role)
           VALUES ($1, $2, $3, $4, 'STUDENT')
           RETURNING id, email, full_name, phone
         )
         INSERT INTO students (id, batch_id, roll_number)
         SELECT id, $5, $6 FROM new_user
         RETURNING id,
                   (SELECT email FROM new_user) AS email,
                   (SELECT full_name FROM new_user) AS full_name,
                   (SELECT phone FROM new_user) AS phone,
                   batch_id, roll_number`,
        [input.email, input.passwordHash, input.fullName, input.phone, input.batchId, input.rollNumber]
      );
      return result.rows[0];
    });
  }

  async updateStudent(
    id: string,
    input: { fullName?: string; phone?: string | null; batchId?: number }
  ): Promise<AdminStudentRow | null> {
    return this.runWrite(async () => {
      const result = await this.db.query<AdminStudentRow>(
        `WITH updated_user AS (
           UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone)
            WHERE id = $1 AND role = 'STUDENT'
           RETURNING id, email, full_name, phone
         )
         UPDATE students SET batch_id = COALESCE($4, batch_id)
          WHERE id = (SELECT id FROM updated_user)
         RETURNING id,
                   (SELECT email FROM updated_user) AS email,
                   (SELECT full_name FROM updated_user) AS full_name,
                   (SELECT phone FROM updated_user) AS phone,
                   batch_id, roll_number`,
        [id, input.fullName ?? null, input.phone ?? null, input.batchId ?? null]
      );
      return result.rows[0] ?? null;
    });
  }

  // ---- Appointments (read-only — Level 3 Security Architecture: admin must never write an appointment directly) ----

  async listAppointments(filters: { status?: string; facultyId?: string; studentId?: string }, limit: number, offset: number) {
    const result = await this.db.query(
      `SELECT a.*, uf.full_name AS faculty_name, us.full_name AS student_name
         FROM appointments a
         JOIN faculty f ON f.id = a.faculty_id JOIN users uf ON uf.id = f.id
         JOIN students s ON s.id = a.student_id JOIN users us ON us.id = s.id
        WHERE ($1::appointment_status IS NULL OR a.status = $1)
          AND ($2::bigint IS NULL OR a.faculty_id = $2)
          AND ($3::bigint IS NULL OR a.student_id = $3)
        ORDER BY a.requested_at DESC
        LIMIT $4 OFFSET $5`,
      [filters.status ?? null, filters.facultyId ?? null, filters.studentId ?? null, limit, offset]
    );
    return result.rows;
  }

  // ---- Audit log (read-only — AuditRepository's role per Level 5, Section 2) ----

  async listAuditLog(filters: { entityType?: string; entityId?: string }, limit: number, offset: number): Promise<AuditLogRow[]> {
    const result = await this.db.query<AuditLogRow>(
      `SELECT * FROM audit_log
        WHERE ($1::text IS NULL OR entity_type = $1)
          AND ($2::bigint IS NULL OR entity_id = $2)
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4`,
      [filters.entityType ?? null, filters.entityId ?? null, limit, offset]
    );
    return result.rows;
  }

  // ---- Dashboard & reporting ----

  async getCounts(): Promise<DashboardCounts> {
    const result = await this.db.query<DashboardCounts>(
      `SELECT
         (SELECT COUNT(*) FROM students)::int AS total_students,
         (SELECT COUNT(*) FROM faculty)::int AS total_faculty,
         (SELECT COUNT(*) FROM departments)::int AS total_departments,
         (SELECT COUNT(*) FROM appointments WHERE status = 'PENDING')::int AS pending_appointments,
         (SELECT COUNT(*) FROM appointments WHERE status = 'APPROVED')::int AS approved_appointments,
         (SELECT COUNT(*) FROM appointments WHERE status = 'COMPLETED')::int AS completed_appointments`
    );
    return result.rows[0];
  }

  /**
   * `faculty_appointment_stats` (migrations/sql/0005) was designed to be
   * refreshed by an in-process scheduler (Level 2's chosen background-job
   * design) — that scheduler was explicitly out of scope for every prior
   * pass and still is here (no cron/scheduled-task infrastructure exists
   * anywhere in this codebase). Rather than silently leave the dashboard
   * reading a materialized view that has never once been refreshed since
   * `CREATE MATERIALIZED VIEW` (i.e., permanently empty), this refreshes
   * ON READ — every dashboard request pays a real recomputation cost
   * instead of the cost the materialized view exists to avoid. This is an
   * honest, deliberate simplification for this project's scope: it keeps
   * the dashboard correct rather than confidently wrong, at the cost of not
   * yet delivering the actual performance win Level 5's design intended.
   * A real background refresh job is the natural follow-up, not silently
   * pretended to already exist. `CONCURRENTLY` requires the unique index
   * already created alongside the view — reads are never blocked by this.
   */
  async refreshFacultyStats(): Promise<void> {
    await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_appointment_stats`);
  }

  async listFacultyStats(): Promise<FacultyStatsRow[]> {
    const result = await this.db.query<FacultyStatsRow>(`SELECT * FROM faculty_appointment_stats ORDER BY full_name`);
    return result.rows;
  }

  /**
   * Verbatim the window-function query Level 5, Section 6 specifies for
   * "Faculty workload ranking and running semester total, by week" —
   * `RANK()` for the per-week ranking and a running `SUM() OVER (...
   * ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` for the semester
   * running total, both needing per-row detail alongside aggregate context
   * simultaneously, which a plain GROUP BY cannot express (Level 5's own
   * justification for choosing window functions here over simpler SQL).
   */
  async getWorkloadReport(): Promise<WorkloadReportRow[]> {
    const result = await this.db.query<WorkloadReportRow>(
      `SELECT
          faculty_id, full_name, week_start, appointments_that_week,
          RANK() OVER (PARTITION BY week_start ORDER BY appointments_that_week DESC) AS workload_rank,
          SUM(appointments_that_week) OVER (
              PARTITION BY faculty_id ORDER BY week_start
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS running_total_this_semester
       FROM (
          SELECT f.id AS faculty_id, u.full_name,
                 date_trunc('week', lower(a.slot))::date AS week_start,
                 COUNT(*)::int AS appointments_that_week
          FROM appointments a
          JOIN faculty f ON f.id = a.faculty_id
          JOIN users u ON u.id = f.id
          WHERE a.status IN ('COMPLETED','APPROVED')
          GROUP BY f.id, u.full_name, date_trunc('week', lower(a.slot))
       ) weekly
       ORDER BY week_start, workload_rank`
    );
    return result.rows;
  }
}
