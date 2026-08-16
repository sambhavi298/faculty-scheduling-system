import { AppointmentRepository, AppointmentRow } from '../repositories/appointment.repository';
import { AppointmentStateMachine, AppointmentStatus } from '../domain/appointment-state-machine';
import { TimeRange } from '../domain/time-range';
import { NotFoundError } from '../errors/not-found.error';
import { AlreadyProcessedError } from '../errors/already-processed.error';
import { ValidationError } from '../errors/validation.error';

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
  constructor(
    private readonly repo: AppointmentRepository,
    private readonly stateMachine: AppointmentStateMachine
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

    return { appointment: row, wasNewlyCreated };
  }

  async approve(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'APPROVED', () => this.repo.approve(id, facultyId));
  }

  async reject(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'REJECTED', () => this.repo.reject(id, facultyId));
  }

  async cancel(id: string, actorId: string): Promise<AppointmentRow> {
    const existing = await this.repo.findById(id);
    if (!existing || (existing.student_id !== actorId && existing.faculty_id !== actorId)) {
      throw new NotFoundError();
    }
    return this.applyGuardedTransition(existing, 'CANCELLED', () => this.repo.cancel(id, actorId));
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
    return this.applyGuardedTransition(existing, 'COMPLETED', () => this.repo.complete(id, facultyId, notes));
  }

  async markMissed(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.findOwnedByFaculty(id, facultyId);
    return this.applyGuardedTransition(existing, 'MISSED', () => this.repo.markMissed(id, facultyId));
  }

  /** Shared by approve/reject/cancel: idempotent no-op, then state-machine check, then guarded write. */
  private async applyGuardedTransition(
    existing: AppointmentRow,
    target: AppointmentStatus,
    write: () => Promise<AppointmentRow | null>
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
    return updated;
  }

  private async findOwnedByFaculty(id: string, facultyId: string): Promise<AppointmentRow> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.faculty_id !== facultyId) {
      throw new NotFoundError();
    }
    return existing;
  }
}
