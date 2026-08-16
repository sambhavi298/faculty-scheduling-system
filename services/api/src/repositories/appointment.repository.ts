import { Queryable } from '../db/queryable';
import { TimeRange } from '../domain/time-range';
import { AppointmentStatus } from '../domain/appointment-state-machine';
import { SlotConflictError } from '../errors/slot-conflict.error';
import { FacultyUnavailableError } from '../errors/faculty-unavailable.error';

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

interface BookAppointmentParams {
  studentId: string;
  facultyId: string;
  slot: TimeRange;
  reason: string;
  clientRequestId?: string;
}

/**
 * wasNewlyCreated distinguishes a genuinely new booking from an idempotent
 * replay of an existing one (Level 5, Section 11 — same clientRequestId
 * returns the original row rather than creating a duplicate). The Service
 * layer needs this to decide whether to fire a "request received"
 * notification — a replay must not notify a second time.
 */
export interface BookAppointmentResult {
  row: AppointmentRow;
  wasNewlyCreated: boolean;
}

/**
 * The ONLY class in this codebase permitted to execute appointment SQL
 * (Level 5, Section 1). Every write here goes through a single guarded
 * statement per Level 5, Section 8 — the database's exclusion constraint
 * and enforce_appointment_transition trigger remain the actual source of
 * correctness; this class only translates results/errors for the Service
 * layer, it does not re-implement any business rule itself.
 */
export class AppointmentRepository {
  constructor(private readonly db: Queryable) {}

  async bookAppointment(params: BookAppointmentParams): Promise<BookAppointmentResult> {
    try {
      const result = await this.db.query<AppointmentRow>(
        `SELECT * FROM book_appointment($1,$2,$3,$4,$5)`,
        [params.studentId, params.facultyId, params.slot.toPgRangeLiteral(), params.reason, params.clientRequestId ?? null]
      );
      return { row: result.rows[0], wasNewlyCreated: true };
    } catch (err: any) {
      // Discovered against the real database (not visible from mocked unit
      // tests): a retried request with the same faculty/slot AND the same
      // client_request_id violates BOTH the exclusion constraint (same
      // faculty, overlapping slot) and appointments_idem_uq (same student,
      // same client_request_id) at once — and Postgres can report either
      // SQLSTATE. So an idempotent replay must be checked for on EITHER
      // conflict code, not only on 23505; only if no such match exists is
      // this a genuine conflict. 40P01 (deadlock_detected) belongs in this
      // same check for the same reason: discovered under repeated
      // real-concurrency testing, two truly concurrent calls carrying the
      // SAME clientRequestId (a genuine network-level duplicate — a
      // double-tap, a retrying proxy) can resolve via a deadlock exactly as
      // easily as via 23P01/23505. Without 40P01 here, that side would
      // incorrectly fall through to a hard SlotConflictError below instead
      // of being recognized as a duplicate of the request its sibling call
      // just committed.
      if ((err?.code === '23P01' || err?.code === '23505' || err?.code === '40P01') && params.clientRequestId) {
        const existing = await this.db.query<AppointmentRow>(
          `SELECT * FROM appointments WHERE student_id = $1 AND client_request_id = $2`,
          [params.studentId, params.clientRequestId]
        );
        if (existing.rows[0]) {
          return { row: existing.rows[0], wasNewlyCreated: false };
        }
      }
      if (err?.code === '23P01') {
        throw new SlotConflictError();
      }
      // Discovered under real repeated-concurrency testing (not visible
      // from a single run, or from mocked unit tests): two genuinely
      // concurrent bookAppointment() calls for the same faculty/overlapping
      // slot do not always resolve via one request cleanly blocking and
      // then failing the exclusion constraint (23P01) once the other
      // commits. Occasionally, both inserts attempt to lock the same GiST
      // index page in opposite order, and PostgreSQL's own deadlock
      // detector kills one of the two transactions to break the cycle —
      // SQLSTATE 40P01 (deadlock_detected). This is not corruption or a
      // partial write; it is the same real-world outcome as 23P01 (this
      // specific attempt lost the race for the slot), just reached via a
      // different, equally legitimate PostgreSQL mechanism. A caller has no
      // reason to treat it differently, so it is mapped the same way.
      if (err?.code === '40P01') {
        throw new SlotConflictError();
      }
      // AV001 is a custom SQLSTATE raised by book_appointment() itself
      // (migration 0006) when is_faculty_available() rejects the slot —
      // outside a declared availability window, or during a teaching/
      // leave/blocked period. Deliberately a distinct code from 23P01: an
      // availability rejection and an appointment-conflict rejection are
      // different failure reasons and callers may want to react
      // differently (e.g. suggest other slots vs. suggest a different time
      // near the one just tried).
      if (err?.code === 'AV001') {
        throw new FacultyUnavailableError();
      }
      throw err;
    }
  }

  /** Shared shape for every guarded status transition (Level 5, Section 8). */
  private async guardedUpdate(
    sql: string,
    params: unknown[]
  ): Promise<AppointmentRow | null> {
    const result = await this.db.query<AppointmentRow>(sql, params);
    return result.rows[0] ?? null;
  }

  approve(id: string, facultyId: string): Promise<AppointmentRow | null> {
    return this.guardedUpdate(
      `UPDATE appointments
         SET status = 'APPROVED', responded_at = now(), responded_by = $2
       WHERE id = $1 AND faculty_id = $2 AND status = 'PENDING'
       RETURNING *`,
      [id, facultyId]
    );
  }

  reject(id: string, facultyId: string): Promise<AppointmentRow | null> {
    return this.guardedUpdate(
      `UPDATE appointments
         SET status = 'REJECTED', responded_at = now(), responded_by = $2
       WHERE id = $1 AND faculty_id = $2 AND status = 'PENDING'
       RETURNING *`,
      [id, facultyId]
    );
  }

  cancel(id: string, actorId: string): Promise<AppointmentRow | null> {
    return this.guardedUpdate(
      `UPDATE appointments
         SET status = 'CANCELLED', cancelled_by = $2
       WHERE id = $1 AND (student_id = $2 OR faculty_id = $2) AND status IN ('PENDING','APPROVED')
       RETURNING *`,
      [id, actorId]
    );
  }

  complete(id: string, facultyId: string, notes?: string): Promise<AppointmentRow | null> {
    return this.guardedUpdate(
      `UPDATE appointments
         SET status = 'COMPLETED', completion_notes = $3
       WHERE id = $1 AND faculty_id = $2 AND status = 'APPROVED'
       RETURNING *`,
      [id, facultyId, notes ?? null]
    );
  }

  markMissed(id: string, facultyId: string): Promise<AppointmentRow | null> {
    return this.guardedUpdate(
      `UPDATE appointments
         SET status = 'MISSED'
       WHERE id = $1 AND faculty_id = $2 AND status = 'APPROVED'
       RETURNING *`,
      [id, facultyId]
    );
  }

  async findById(id: string): Promise<AppointmentRow | null> {
    const result = await this.db.query<AppointmentRow>(`SELECT * FROM appointments WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async listForStudent(studentId: string): Promise<AppointmentRow[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointments WHERE student_id = $1 ORDER BY requested_at DESC`,
      [studentId]
    );
    return result.rows;
  }

  async listPendingForFaculty(facultyId: string): Promise<AppointmentRow[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM faculty_pending_requests WHERE faculty_id = $1`,
      [facultyId]
    );
    return result.rows;
  }
}
