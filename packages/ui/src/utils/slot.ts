/**
 * The backend stores `slot` as a PostgreSQL TSTZRANGE (migrations/sql/0002)
 * and services/api/src/db/client.ts registers no custom type parser for it,
 * so `pg` returns it to the HTTP layer, and therefore to us, as the raw
 * Postgres range literal text, e.g.:
 *   ["2026-08-25 08:30:00+00","2026-08-25 09:00:00+00")
 * This parses that literal — nothing invented, just reading the format
 * AppointmentRepository actually produces (see TimeRange.toPgRangeLiteral(),
 * which writes '[' + start + ',' + end + ')').
 */
export interface ParsedSlot {
  start: Date;
  end: Date;
}

export function parseSlot(raw: string): ParsedSlot | null {
  const match = raw.match(/^[[(]"?([^",]+)"?,"?([^"),]+)"?[\])]$/);
  if (!match) return null;
  const start = new Date(match[1]);
  const end = new Date(match[2]);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatSlot(raw: string): string {
  const parsed = parseSlot(raw);
  if (!parsed) return raw;
  const sameDay = parsed.start.toDateString() === parsed.end.toDateString();
  if (sameDay) {
    return `${dateFmt.format(parsed.start)} · ${timeFmt.format(parsed.start)} – ${timeFmt.format(parsed.end)}`;
  }
  return `${dateFmt.format(parsed.start)} ${timeFmt.format(parsed.start)} → ${dateFmt.format(parsed.end)} ${timeFmt.format(parsed.end)}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

/**
 * Same display style as formatSlot(), for an AvailableSlot
 * ({ slot_start, slot_end }) — two separate ISO timestamps, not a Postgres
 * range literal. GET /api/faculty/:id/availability returns real TIMESTAMPTZ
 * columns (get_available_slots()), which the backend already converts to
 * ISO strings (services/api/src/services/faculty.service.ts), unlike
 * appointments.slot which needs parseSlot() above.
 */
export function formatSlotRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return `${startIso} – ${endIso}`;
  return `${timeFmt.format(start)} – ${timeFmt.format(end)}`;
}

/** Converts a `datetime-local` input value (no timezone) into a real ISO string in the browser's local timezone, matching what TimeRange.create() on the backend expects (any parseable Date). */
export function localInputToIso(value: string): string {
  const d = new Date(value);
  return d.toISOString();
}
