/**
 * Client-side mirror of the backend's own reason-length rule
 * (services/api/src/errors/validation.error.ts via AppointmentService —
 * reason must be 5-1000 characters). This exists so the form can fail fast
 * and show a specific message before round-tripping to the server — it is
 * NOT a replacement for the backend's own validation, which still runs and
 * is still the source of truth (see utils/errors.ts for the VALIDATION_ERROR
 * mapping that handles the case where these ever drift apart).
 */
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 1000;

export function validateReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN_LENGTH) {
    return `Reason must be at least ${REASON_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    return `Reason must be ${REASON_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}
