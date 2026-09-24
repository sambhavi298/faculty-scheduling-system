import { AppointmentRepository, AppointmentRow } from '../repositories/appointment.repository';
import { AppointmentStateMachine, AppointmentStatus } from '../domain/appointment-state-machine';
import { TimeRange } from '../domain/time-range';
import { NotFoundError } from '../errors/not-found.error';
import { AlreadyProcessedError } from '../errors/already-processed.error';
import { ValidationError } from '../errors/validation.error';
import { NotificationService, NotificationType } from './notification.service';

const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 1000;

interface SlotInput {
  start: Date;
  end: Date;
}

interface RequestAppointmentParams {
  studentId: string;
  facultyId: string;
  slot: SlotInput;
  reason: string;
  clientRequestId?: string;
}

export interface RequestAppointmentResult {
  appointment: AppointmentRow;
  wasNewlyCreated: boolean;
}

/**
 * Orchestrates the appointment lifecycle (Level 5, Section 2). This class
 * owns workflow/policy rules that are NOT data-integrity rules — ownership
 * checks, idempotent no-ops, and running AppointmentStateMachine before
 * attempting a write — per the Level 2/5 database-first split. The actual
 * data-integrity guarantees (no overlapping bookings, no invalid status
 * writes) remain enforced in the database regardless of what happens here;
 * this class fails fast on the same rules for a better error message and a
 * wasted round trip avoided, it does not replace the database's guarantee.
 */
export class AppointmentService {
  /**
   * `notifications` is deliberately optional. Every existing call site that
   * constructs this class with just (repo, stateMachine) keeps working
   * unchanged — notifications are additive, best-effort behavior (Level 5,
   * Section 1: "triggering the (deliberately non-atomic) notification step
   * after a successful write"), never a precondition for the appointment
   * action itself succeeding. server.ts wires a real NotificationService in
   * production; tests that aren't about notifications simply omit it.
   */
  constructor(
    private readonly repo: AppointmentRepository,
    private readonly stateMachine: AppointmentStateMachine,
    private readonly notifications?: NotificationService
  ) {}

  async requestAppointment(params: RequestAppointmentParams): Promise<RequestAppointmentResult> {
    const reason = params.reason?.trim() ?? '';
    if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
      throw new ValidationError(
        `reason must be between ${MIN_REASON_LENGTH} and ${MAX_REASON_LENGTH} characters`
      );
    }

    const slot = TimeRange.create(params.slot.start, params.slot.end);

    const { row, wasNewlyCreated } = await this.repo.bookAppointment({
      studentId: params.studentId,
      facultyId: params.facultyId,
      slot,
      reason,
      clientRequestId: params.clientRequestId,
    });

    // Only a genuinely new booking should notify the faculty member — an
    // idempotent replay of an already-known request (wasNewlyCreated: false)
    // must not notify a second time (Level 5, Section 11's idempotency
    // contract applies to side effects too, not just the row returned).
    if (wasNewlyCreated) {
      this.notifyBestEffort(row.faculty_id, 'APPOINTMENT_REQUESTED', { appointmentId: row.id, reason: row.reason });
    }

    return { appointment: row, wasNewlyCreated };
  }

  async approve(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'APPROVED', () => this.repo.approve(id, facultyId), (updated) =>
      this.notifyBestEffort(updated.student_id, 'APPOINTMENT_APPROVED', { appointmentId: updated.id })
    );
  }

  async reject(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'REJECTED', () => this.repo.reject(id, facultyId), (updated) =>
      this.notifyBestEffort(updated.student_id, 'APPOINTMENT_REJECTED', { appointmentId: updated.id })
    );
  }

  async cancel(id: string, actorId: string): Promise<AppointmentRow> {
    const existing = await this.repo.findById(id);
    if (!existing || (existing.student_id !== actorId && existing.faculty_id !== actorId)) {
      throw new NotFoundError();
    }
    // Notify whichever party did NOT do the cancelling — the actor already
    // knows they just cancelled it.
    const otherParty = actorId === existing.student_id ? existing.faculty_id : existing.student_id;
    return this.applyGuardedTransition(existing, 'CANCELLED', () => this.repo.cancel(id, actorId), (updated) =>
      this.notifyBestEffort(otherParty, 'APPOINTMENT_CANCELLED', { appointmentId: updated.id })
    );
  }

  /**
   * Closes documented Gap 3: AppointmentRepository.complete()/markMissed()
   * already existed and were already correctly guarded at the database
   * level (faculty ownership + status = 'APPROVED' in the WHERE clause —
   * see the repository), but nothing at the Service layer wrapped them the
   * way approve/reject/cancel are wrapped. A caller invoking the repository
   * methods directly got a silent `null` on an unauthorized or invalid
   * attempt instead of a typed, auditable NotFoundError/InvalidTransitionError
   * — inconsistent with the other three transitions, and an easy thing for
   * a future HTTP layer to get wrong (documented in the Level 7 security
   * tests as the "complete()/markMissed() ownership gap"). These two
   * methods mirror approve()/reject() exactly: faculty-only ownership via
   * findOwnedByFaculty, then the same guarded-transition path.
   */
  async complete(id: string, facultyId: string, notes?: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'COMPLETED', () => this.repo.complete(id, facultyId, notes), (updated) =>
      this.notifyBestEffort(updated.student_id, 'APPOINTMENT_COMPLETED', { appointmentId: updated.id })
    );
  }

  async markMissed(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'MISSED', () => this.repo.markMissed(id, facultyId), (updated) =>
      this.notifyBestEffort(updated.student_id, 'APPOINTMENT_MISSED', { appointmentId: updated.id })
    );
  }

  /**
   * Thin passthroughs for the two read-only listing endpoints (Level 5,
   * Section 11: `GET /api/appointments/mine`, `GET /api/appointments/pending`).
   * There is no business rule to enforce here — a student may always see
   * their own appointments, a faculty member their own pending requests —
   * so this is intentionally a one-line delegation to the Repository. It
   * exists on the Service (rather than having the Controller call the
   * Repository directly) purely to keep the Controller -> Service ->
   * Repository layering from the architecture diagram uniform across every
   * endpoint, not because there's hidden logic here.
   */
  async listForStudent(studentId: string): Promise<AppointmentRow[]> {
    return this.repo.listForStudent(studentId);
  }

  async listPendingForFaculty(facultyId: string): Promise<AppointmentRow[]> {
    return this.repo.listPendingForFaculty(facultyId);
  }

  /**
   * Backs `GET /api/appointments/mine-as-faculty` — closes the documented
   * gap (docs/GITHUB_ISSUES.md, "Upcoming appointments"/"Appointment
   * history") that `listPendingForFaculty` only ever returns PENDING rows,
   * so a faculty member had no real way to see their own
   * APPROVED/COMPLETED/MISSED/REJECTED/CANCELLED history without a
   * device-local cache. `statusFilter` is validated against the real
   * AppointmentStatus enum here (not left to the database to reject) so an
   * unrecognized value fails fast with a clear 400 rather than silently
   * returning zero rows or a raw SQL error.
   */
  async listAllForFaculty(facultyId: string, statusFilter?: string): Promise<AppointmentRow[]> {
    if (statusFilter !== undefined && !AppointmentService.VALID_STATUSES.has(statusFilter as AppointmentStatus)) {
      throw new ValidationError(`status must be one of: ${Array.from(AppointmentService.VALID_STATUSES).join(', ')}`);
    }
    return this.repo.listAllForFaculty(facultyId, statusFilter as AppointmentStatus | undefined);
  }

  private static readonly VALID_STATUSES: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'COMPLETED',
    'MISSED',
    'EXPIRED',
  ]);

  /** Shared by approve/reject/cancel/complete/markMissed: idempotent no-op, then state-machine check, then guarded write, then (only on a real transition) a best-effort notification. */
  private async applyGuardedTransition(
    existing: AppointmentRow,
    target: AppointmentStatus,
    write: () => Promise<AppointmentRow | null>,
    afterTransition?: (updated: AppointmentRow) => void
  ): Promise<AppointmentRow> {
    if (existing.status === target) {
      return existing; // idempotent no-op — see Level 5, Section 11 API contract
    }

    this.stateMachine.assertValidTransition(existing.status, target);

    const updated = await write();
    if (!updated) {
      // The state-machine check passed against the row we just read, but the
      // guarded UPDATE matched zero rows — status changed underneath us
      // between the read and the write. The database's guard is what
      // actually caught this; we just report it clearly.
      throw new AlreadyProcessedError();
    }
    if (afterTransition) {
      afterTransition(updated);
    }
    return updated;
  }

  private async findOwnedByFaculty(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.faculty_id !== facultyId) {
      throw new NotFoundError();
    }
    return existing;
  }

  /**
   * Notification dispatch is deliberately fire-and-forget from the caller's
   * perspective (Level 5, Section 1: a separate, non-atomic step after a
   * successful write) — not awaited by any transition method above, and any
   * failure is swallowed here rather than propagated, because a failed
   * notification write must never turn an already-successful appointment
   * action into an error response. `notifications` being unset (most unit
   * tests) is itself the common case, not an error condition.
   */
  private notifyBestEffort(recipientId: string, type: NotificationType, payload: { appointmentId: string; reason?: string }): void {
    if (!this.notifications) {
      return;
    }
    this.notifications.notify(recipientId, type, payload).catch(() => {
      // Best-effort — see method doc comment above.
    });
  }
}
