import { ValidationError } from '../errors/validation.error';

/**
 * Value object wrapping a start/end pair. Validates end > start exactly once,
 * so AvailabilityService and AppointmentService never duplicate that check
 * (Level 5, Section 2).
 */
export class TimeRange {
  private constructor(public readonly start: Date, public readonly end: Date) {}

  static create(start: Date, end: Date): TimeRange {
    if (!(start instanceof Date) || isNaN(start.getTime())) {
      throw new ValidationError('slot start must be a valid date/time');
    }
    if (!(end instanceof Date) || isNaN(end.getTime())) {
      throw new ValidationError('slot end must be a valid date/time');
    }
    if (end.getTime() <= start.getTime()) {
      throw new ValidationError('slot end must be after slot start');
    }
    return new TimeRange(start, end);
  }

  overlaps(other: TimeRange): boolean {
    return this.start < other.end && other.start < this.end;
  }

  /** Postgres tstzrange literal, e.g. '["2026-08-20T10:00:00Z","2026-08-20T10:30:00Z")' */
  toPgRangeLiteral(): string {
    return `[${this.start.toISOString()},${this.end.toISOString()})`;
  }
}
