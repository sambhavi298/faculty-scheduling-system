import { InvalidTransitionError } from '../errors/invalid-transition.error';

export type AppointmentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'MISSED'
  | 'EXPIRED';

/**
 * Pure domain object encoding the valid status transitions from
 * Level 5, Section 4. No I/O, no dependencies — mirrors the
 * enforce_appointment_transition() database trigger exactly, so the
 * application layer can reject an invalid transition fast, before ever
 * reaching the database (which remains the non-negotiable backstop).
 */
export class AppointmentStateMachine {
  private static readonly ALLOWED: Record<AppointmentStatus, AppointmentStatus[]> = {
    PENDING: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
    APPROVED: ['COMPLETED', 'CANCELLED', 'MISSED'],
    REJECTED: [],
    CANCELLED: [],
    COMPLETED: [],
    MISSED: [],
    EXPIRED: [],
  };

  canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
    if (from === to) {
      return true; // no-op update (e.g. setting completion_notes without changing status)
    }
    return AppointmentStateMachine.ALLOWED[from].includes(to);
  }

  assertValidTransition(from: AppointmentStatus, to: AppointmentStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidTransitionError(from, to);
    }
  }
}
