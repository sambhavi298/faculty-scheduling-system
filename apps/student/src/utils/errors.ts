import type { ApiErrorCode } from '@faculty-scheduling/ui';
import { ApiError } from '@faculty-scheduling/ui';

/**
 * Maps every ApiErrorCode the shared client can throw
 * (packages/ui/src/types/index.ts ApiErrorCode) to specific, human-readable
 * copy for this app, instead of surfacing a raw error code to the student.
 */
const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  SLOT_CONFLICT: 'That time slot has already been booked by another student. Please choose a different time.',
  FACULTY_UNAVAILABLE:
    "This faculty member isn't available during the selected time — it may fall outside their teaching hours, or during a meeting, leave, or blocked period. Please pick another slot.",
  ALREADY_PROCESSED: 'This appointment has already been responded to and can no longer be changed this way.',
  INVALID_TRANSITION: "This appointment is no longer in a state that allows that action — it may already be cancelled, completed, or missed.",
  NOT_FOUND: "That appointment couldn't be found, or you don't have access to it.",
  FORBIDDEN: "You don't have permission to do that.",
  UNAUTHENTICATED: 'Your session has expired. Please log in again.',
};

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return MESSAGES[err.code] ?? err.message ?? 'Something went wrong. Please try again.';
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
