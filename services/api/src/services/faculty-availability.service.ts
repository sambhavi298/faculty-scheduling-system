import {
  FacultyAvailabilityRepository,
  FacultyAvailabilityWindowRow,
  FacultyScheduleExceptionRow,
} from '../repositories/faculty-availability.repository';
import { ValidationError } from '../errors/validation.error';
import { NotFoundError } from '../errors/not-found.error';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
const EXCEPTION_TYPES: ReadonlySet<string> = new Set(['LEAVE', 'MEETING', 'BLOCK', 'EXTRA_AVAILABLE']);

/** Same round-trip technique as FacultyService.isValidCalendarDate() — catches a syntactically-shaped but nonexistent date (e.g. 2026-02-30) that the JS Date constructor would otherwise silently roll over instead of rejecting. */
function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_PATTERN.test(dateStr)) return false;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === dateStr;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export interface AvailabilityWindowRequest {
  dayOfWeek: unknown;
  startTime: unknown;
  endTime: unknown;
  effectiveFrom: unknown;
  effectiveUntil?: unknown;
}

export interface ExceptionRequest {
  date: unknown;
  startTime?: unknown;
  endTime?: unknown;
  type: unknown;
  reason?: unknown;
}

/**
 * Orchestrates the write side of the Faculty Availability module (Level 5:
 * "FacultyAvailabilityService ... ownership/validation"). `facultyId` is
 * always the AUTHENTICATED caller's own id (Controller passes req.user.id,
 * never a path/body-supplied id) — per the API contract table, both
 * endpoints are "own availability only," so there is no separate ownership
 * CHECK to perform here beyond that the caller genuinely is a faculty
 * member at all, which `requireRole('FACULTY')` at the route layer already
 * guarantees before this class ever runs. What this class DOES own: HTTP-
 * shaped input validation before anything reaches SQL (Level 5's
 * database-first split — validation here is a fast, specific 400 instead of
 * a raw type-cast error reaching the database), and translating the
 * database's overlap-constraint rejection into a typed error the Controller
 * already knows how to map.
 */
export class FacultyAvailabilityService {
  constructor(private readonly repo: FacultyAvailabilityRepository) {}

  async replaceAvailability(facultyId: string, windowsInput: unknown): Promise<FacultyAvailabilityWindowRow[]> {
    if (!(await this.repo.facultyExists(facultyId))) {
      throw new NotFoundError('No faculty member exists with that id.');
    }
    if (!Array.isArray(windowsInput)) {
      throw new ValidationError('request body must be an array of availability windows');
    }

    const windows = windowsInput.map((raw, index) => this.validateWindow(raw as AvailabilityWindowRequest, index));

    return this.repo.replaceAvailability(facultyId, windows);
  }

  async addException(facultyId: string, input: ExceptionRequest): Promise<FacultyScheduleExceptionRow> {
    if (!(await this.repo.facultyExists(facultyId))) {
      throw new NotFoundError('No faculty member exists with that id.');
    }

    const date = input.date;
    if (typeof date !== 'string' || !isValidCalendarDate(date)) {
      throw new ValidationError('date is required and must be a valid calendar date (YYYY-MM-DD)');
    }

    const type = input.type;
    if (typeof type !== 'string' || !EXCEPTION_TYPES.has(type)) {
      throw new ValidationError(`type must be one of: ${Array.from(EXCEPTION_TYPES).join(', ')}`);
    }

    const startTime = this.optionalTime(input.startTime, 'startTime');
    const endTime = this.optionalTime(input.endTime, 'endTime');
    // Mirrors faculty_exception_time_chk (migrations/sql/0001): either both
    // times are absent (whole-day exception) or both are present with
    // end > start — never just one of the two.
    if ((startTime === null) !== (endTime === null)) {
      throw new ValidationError('startTime and endTime must either both be provided or both be omitted (whole-day exception)');
    }
    if (startTime !== null && endTime !== null && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new ValidationError('endTime must be after startTime');
    }

    const reason = input.reason;
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      throw new ValidationError('reason must be a string if provided');
    }

    return this.repo.addException(facultyId, {
      date,
      startTime,
      endTime,
      type,
      reason: (reason as string | null | undefined) ?? null,
    });
  }

  private validateWindow(raw: AvailabilityWindowRequest, index: number): {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
  } {
    const at = `windows[${index}]`;

    const dayOfWeek = raw?.dayOfWeek;
    if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new ValidationError(`${at}.dayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday)`);
    }

    const startTime = this.requiredTime(raw?.startTime, `${at}.startTime`);
    const endTime = this.requiredTime(raw?.endTime, `${at}.endTime`);
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new ValidationError(`${at}.endTime must be after ${at}.startTime`);
    }

    const effectiveFrom = raw?.effectiveFrom;
    if (typeof effectiveFrom !== 'string' || !isValidCalendarDate(effectiveFrom)) {
      throw new ValidationError(`${at}.effectiveFrom is required and must be a valid calendar date (YYYY-MM-DD)`);
    }

    const effectiveUntilRaw = raw?.effectiveUntil;
    let effectiveUntil: string | null = null;
    if (effectiveUntilRaw !== undefined && effectiveUntilRaw !== null) {
      if (typeof effectiveUntilRaw !== 'string' || !isValidCalendarDate(effectiveUntilRaw)) {
        throw new ValidationError(`${at}.effectiveUntil must be a valid calendar date (YYYY-MM-DD) if provided`);
      }
      if (effectiveUntilRaw < effectiveFrom) {
        throw new ValidationError(`${at}.effectiveUntil must not be before ${at}.effectiveFrom`);
      }
      effectiveUntil = effectiveUntilRaw;
    }

    return { dayOfWeek, startTime, endTime, effectiveFrom, effectiveUntil };
  }

  private requiredTime(value: unknown, label: string): string {
    if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
      throw new ValidationError(`${label} is required and must be a valid time (HH:MM or HH:MM:SS)`);
    }
    return value;
  }

  private optionalTime(value: unknown, label: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return this.requiredTime(value, label);
  }
}
