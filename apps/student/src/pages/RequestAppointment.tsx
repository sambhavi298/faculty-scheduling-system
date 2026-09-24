import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
  appointmentsApi,
  facultyApi,
  useToast,
} from '@faculty-scheduling/ui';
import type { AppointmentRow, AvailableSlot, FacultyDirectoryRow } from '@faculty-scheduling/ui';
import { useAppointments } from '../state/AppointmentsContext';
import { describeError } from '../utils/errors';
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH, validateReason } from '../utils/validation';

interface FormErrors {
  facultyId?: string;
  slot?: string;
  reason?: string;
}

type FacultyListState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; rows: FacultyDirectoryRow[] };

type SlotsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; slots: AvailableSlot[] };

function todayDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Now backed by the real GET /api/faculty (faculty picker) and GET
 * /api/faculty/:id/availability (real bookable slots for the chosen date) —
 * services/api/src/routes/faculty.routes.ts. Picking a faculty member and a
 * date shows the SAME slots get_available_slots() computes (teaching
 * schedule, leave/meeting/block exceptions, and existing appointments all
 * already excluded), so every slot offered here is genuinely bookable; the
 * only way POST /api/appointments can still reject it is if someone else
 * takes the exact same slot in the few seconds between loading this list and
 * submitting — the same real concurrency guarantee this project's backend
 * is built around, not something this page can or should try to prevent
 * client-side.
 */
export function RequestAppointment(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const { appointments, upsert } = useAppointments();
  const { show } = useToast();

  const [facultyState, setFacultyState] = useState<FacultyListState>({ status: 'loading' });
  const [facultyRetryToken, setFacultyRetryToken] = useState(0);
  const [facultyId, setFacultyId] = useState(searchParams.get('facultyId') ?? '');
  const [dateInput, setDateInput] = useState(todayDateInputValue());
  const [slotsState, setSlotsState] = useState<SlotsState>({ status: 'idle' });
  // Bumped by the slot picker's "Try again" button — see the equivalent
  // retryToken note in FacultyDirectory.tsx for why setDateInput(same value)
  // alone wouldn't retrigger the effect below.
  const [slotsRetryToken, setSlotsRetryToken] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<AppointmentRow | null>(null);

  // Keyed on the exact values of the last attempt: retrying the SAME
  // submission (e.g. after a network error, clicking submit again with
  // nothing changed) reuses the same clientRequestId, so a retry can't
  // double-book; changing faculty/slot/reason before retrying counts as a
  // new attempt and gets a fresh id.
  const attemptRef = useRef<{ key: string; id: string } | null>(null);

  const recentFacultyIds = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const a of appointments) {
      if (!seen.has(a.faculty_id)) {
        seen.add(a.faculty_id);
        order.push(a.faculty_id);
      }
    }
    return order;
  }, [appointments]);

  useEffect(() => {
    let cancelled = false;
    setFacultyState({ status: 'loading' });
    facultyApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setFacultyState({ status: 'ready', rows });
        // If the query-param facultyId isn't a real, known faculty id, don't
        // silently keep an invalid value selected — fall back to the first
        // real option so the Select's value is always something submittable.
        setFacultyId((cur) => (rows.some((r) => r.id === cur) ? cur : (rows[0]?.id ?? '')));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFacultyState({ status: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [facultyRetryToken]);

  useEffect(() => {
    setSelectedSlot(null);
    if (!facultyId || !dateInput) {
      setSlotsState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setSlotsState({ status: 'loading' });
    facultyApi
      .getAvailability(facultyId, dateInput)
      .then((slots) => {
        if (!cancelled) setSlotsState({ status: 'ready', slots });
      })
      .catch((error: unknown) => {
        if (!cancelled) setSlotsState({ status: 'error', error });
      });
    return () => {
      cancelled = true;
    };
  }, [facultyId, dateInput, slotsRetryToken]);

  function getClientRequestId(): string {
    const key = JSON.stringify([facultyId, selectedSlot?.slot_start, selectedSlot?.slot_end, reason.trim()]);
    if (attemptRef.current && attemptRef.current.key === key) {
      return attemptRef.current.id;
    }
    const id = crypto.randomUUID();
    attemptRef.current = { key, id };
    return id;
  }

  function validate(): boolean {
    const next: FormErrors = {};
    if (!facultyId) next.facultyId = 'Choose a faculty member.';
    if (!selectedSlot) next.slot = 'Choose an available time slot.';
    const reasonError = validateReason(reason);
    if (reasonError) next.reason = reasonError;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    if (!validate() || !selectedSlot) return;

    setSubmitting(true);
    try {
      const row = await appointmentsApi.request({
        facultyId,
        slotStart: selectedSlot.slot_start,
        slotEnd: selectedSlot.slot_end,
        reason: reason.trim(),
        clientRequestId: getClientRequestId(),
      });
      upsert(row);
      setCreated(row);
      show('Appointment request sent.', 'success');
    } catch (err) {
      setSubmitError(describeError(err));
      // The slot this attempt targeted may no longer be free (someone else
      // took it, or it fell outside availability) — refetch so the picker
      // reflects reality instead of still offering a slot that just failed.
      if (facultyId && dateInput) {
        facultyApi
          .getAvailability(facultyId, dateInput)
          .then((slots) => setSlotsState({ status: 'ready', slots }))
          .catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <Card padded>
        <div className="success-block">
          <div className="success-icon">
            <CheckCircle2 size={26} />
          </div>
          <h2 style={{ margin: '0 0 0.4rem' }}>Request sent</h2>
          <p className="text-secondary" style={{ margin: '0 0 1.5rem' }}>
            Your request is now <strong>PENDING</strong> — the faculty member needs to approve it before it&apos;s
            confirmed.
          </p>
          <div className="row gap-sm" style={{ justifyContent: 'center' }}>
            <Link to={`/appointments/${created.id}`}>
              <Button>View this appointment</Button>
            </Link>
            <Link to="/appointments">
              <Button variant="secondary">My appointments</Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Request appointment" subtitle="Pick a faculty member, a date, and a real open slot." />

      <Card padded>
        <form onSubmit={handleSubmit} noValidate>
          {facultyState.status === 'loading' && <LoadingState label="Loading faculty…" />}
          {facultyState.status === 'error' && (
            <ErrorState error={facultyState.error} onRetry={() => setFacultyRetryToken((n) => n + 1)} />
          )}

          {facultyState.status === 'ready' && (
            <>
              <Field label="Faculty member" htmlFor="facultyId" error={errors.facultyId}>
                <Select id="facultyId" value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
                  {facultyState.rows.length === 0 && <option value="">No faculty available</option>}
                  {facultyState.rows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} — {f.department}
                    </option>
                  ))}
                </Select>
              </Field>

              {recentFacultyIds.length > 0 && (
                <div style={{ marginTop: '-0.6rem', marginBottom: '1.1rem' }}>
                  <span className="field__hint">Recently contacted faculty:</span>
                  <div className="quick-picks">
                    {recentFacultyIds.map((id) => {
                      const match = facultyState.rows.find((f) => f.id === id);
                      return (
                        <button key={id} type="button" className="quick-pick-chip" onClick={() => setFacultyId(id)}>
                          {match ? match.name : `Faculty ${id}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <Field label="Date" htmlFor="date">
                <Input
                  id="date"
                  type="date"
                  min={todayDateInputValue()}
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                />
              </Field>

              <Field label="Available time slots" htmlFor="slotPicker" error={errors.slot}>
                <div id="slotPicker">
                  {slotsState.status === 'idle' && (
                    <p className="field__hint">Choose a faculty member and date to see real open slots.</p>
                  )}
                  {slotsState.status === 'loading' && <LoadingState label="Checking real availability…" />}
                  {slotsState.status === 'error' && (
                    <ErrorState error={slotsState.error} onRetry={() => setSlotsRetryToken((n) => n + 1)} />
                  )}
                  {slotsState.status === 'ready' && slotsState.slots.length === 0 && (
                    <p className="field__hint">
                      No open slots on this date — try another date, or a different faculty member.
                    </p>
                  )}
                  {slotsState.status === 'ready' && slotsState.slots.length > 0 && (
                    <div className="quick-picks">
                      {slotsState.slots.map((slot) => {
                        const active = selectedSlot?.slot_start === slot.slot_start;
                        return (
                          <button
                            key={slot.slot_start}
                            type="button"
                            className={`filter-chip${active ? ' active' : ''}`}
                            onClick={() => setSelectedSlot(slot)}
                          >
                            {timeFmt.format(new Date(slot.slot_start))} – {timeFmt.format(new Date(slot.slot_end))}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Field>
            </>
          )}

          <Field
            label="Reason for appointment"
            htmlFor="reason"
            error={errors.reason}
            hint={
              errors.reason
                ? undefined
                : `Briefly explain what you'd like to discuss (${REASON_MIN_LENGTH}-${REASON_MAX_LENGTH} characters).`
            }
          >
            <Textarea
              id="reason"
              rows={5}
              maxLength={REASON_MAX_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              invalid={!!errors.reason}
              placeholder="e.g. I'd like to discuss my project proposal for..."
            />
          </Field>
          <div className="char-count">
            {reason.trim().length}/{REASON_MAX_LENGTH}
          </div>

          {submitError && (
            <p className="field__error" style={{ marginBottom: '1rem' }}>
              {submitError}
            </p>
          )}

          <Button type="submit" loading={submitting} disabled={facultyState.status !== 'ready'}>
            Send request
          </Button>
        </form>
      </Card>
    </>
  );
}
