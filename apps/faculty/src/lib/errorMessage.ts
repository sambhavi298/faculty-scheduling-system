import { ApiError, type ApiErrorCode } from '@faculty-scheduling/ui';

/**
 * Maps a raw ApiError (or unknown thrown value) to a specific,
 * human-readable message for this app's actions. Falls back to the
 * server's own message when the code isn't one we have special copy for.
 */
const CODE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  UNAUTHENTICATED: 'Your session looks invalid. Please log in again.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "This appointment isn't yours, or no longer exists.",
  ALREADY_PROCESSED: 'This request has already been processed.',
  INVALID_TRANSITION: "This appointment is no longer in a state that allows that action — someone may have already acted on it.",
  VALIDATION_ERROR: 'Some of the information provided was invalid.',
  NETWORK_ERROR: 'Could not reach the server. Check that the backend is running and try again.',
  INTERNAL_ERROR: 'Something went wrong on the server. Please try again.',
};

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return CODE_MESSAGES[err.code] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
