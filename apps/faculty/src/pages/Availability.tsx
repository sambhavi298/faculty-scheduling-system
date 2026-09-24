import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  NoticeBanner,
  PageHeader,
  Select,
  Table,
  facultyAvailabilityApi,
  useToast,
  type AvailabilityWindowInput,
  type ExceptionType,
  type FacultyScheduleExceptionRow,
} from '@faculty-scheduling/ui';
import { describeError } from '../lib/errorMessage';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EXCEPTION_TYPES: ExceptionType[] = ['LEAVE', 'MEETING', 'BLOCK', 'EXTRA_AVAILABLE'];

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready' };

interface DraftWindow extends AvailabilityWindowInput {
  key: string;
}

let nextKey = 1;

function toDraft(w: AvailabilityWindowInput): DraftWindow {
  return { ...w, key: String(nextKey++) };
}

/**
 * PUT /api/faculty/availability, GET /api/faculty/availability (own),
 * POST /api/faculty/availability/exceptions — real, since these were added
 * this pass (services/api/src/routes/faculty-availability.routes.ts). The
 * PUT is a full REPLACE, not a patch, so this screen loads the caller's
 * current windows first and edits that same set locally before submitting
 * it back whole — never a blind overwrite.
 */
export function Availability(): React.ReactElement {
  const { show } = useToast();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [windows, setWindows] = useState<DraftWindow[]>([]);
  const [saving, setSaving] = useState(false);

  const [newDay, setNewDay] = useState('1');
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('17:00');
  const [newFrom, setNewFrom] = useState('');
  const [newUntil, setNewUntil] = useState('');

  const [exceptions, setExceptions] = useState<FacultyScheduleExceptionRow[]>([]);
  const [excDate, setExcDate] = useState('');
  const [excType, setExcType] = useState<ExceptionType>('LEAVE');
  const [excStart, setExcStart] = useState('');
  const [excEnd, setExcEnd] = useState('');
  const [excReason, setExcReason] = useState('');
  const [excSubmitting, setExcSubmitting] = useState(false);
  const [excError, setExcError] = useState<string | null>(null);

  function load(): void {
    setState({ status: 'loading' });
    facultyAvailabilityApi
      .listOwn()
      .then((rows) => {
        setWindows(
          rows.map((r) =>
            toDraft({
              dayOfWeek: r.day_of_week,
              startTime: r.start_time,
              endTime: r.end_time,
              effectiveFrom: r.effective_from,
              effectiveUntil: r.effective_until,
            })
          )
        );
        setState({ status: 'ready' });
      })
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setNewFrom((cur) => cur || today);
    setExcDate((cur) => cur || today);
  }, []);

  function addWindow(): void {
    if (!newFrom) {
      show('effectiveFrom is required.', 'error');
      return;
    }
    setWindows((cur) => [
      ...cur,
      toDraft({
        dayOfWeek: Number(newDay),
        startTime: newStart,
        endTime: newEnd,
        effectiveFrom: newFrom,
        effectiveUntil: newUntil || null,
      }),
    ]);
  }

  function removeWindow(key: string): void {
    setWindows((cur) => cur.filter((w) => w.key !== key));
  }

  async function saveAvailability(): Promise<void> {
    setSaving(true);
    try {
      const saved = await facultyAvailabilityApi.replaceAvailability(
        windows.map(({ key, ...w }) => w) // eslint-disable-line @typescript-eslint/no-unused-vars
      );
      setWindows(
        saved.map((r) =>
          toDraft({
            dayOfWeek: r.day_of_week,
            startTime: r.start_time,
            endTime: r.end_time,
            effectiveFrom: r.effective_from,
            effectiveUntil: r.effective_until,
          })
        )
      );
      show('Availability saved.', 'success');
    } catch (err) {
      show(describeError(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function submitException(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setExcError(null);
    if (!excDate) {
      setExcError('Date is required.');
      return;
    }
    setExcSubmitting(true);
    try {
      const row = await facultyAvailabilityApi.addException({
        date: excDate,
        type: excType,
        startTime: excStart || undefined,
        endTime: excEnd || undefined,
        reason: excReason.trim() || undefined,
      });
      setExceptions((cur) => [row, ...cur]);
      setExcStart('');
      setExcEnd('');
      setExcReason('');
      show('Exception added.', 'success');
    } catch (err) {
      const message = describeError(err);
      setExcError(message);
      show(message, 'error');
    } finally {
      setExcSubmitting(false);
    }
  }

  const sortedWindows = [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

  return (
    <div>
      <PageHeader title="Availability & Exceptions" subtitle="Manage your weekly hours and one-off exceptions." />

      {state.status === 'loading' && <LoadingState label="Loading your availability…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          <Card style={{ marginBottom: '1.25rem' }}>
            <h2 className="section-title">Weekly hours</h2>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '-0.4rem', marginBottom: '1rem' }}>
              Saving replaces your ENTIRE declared availability with exactly the rows below — add or remove rows, then save.
            </p>

            <div className="row gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
              <Field label="Day" htmlFor="new-day">
                <Select id="new-day" value={newDay} onChange={(e) => setNewDay(e.target.value)}>
                  {DAY_LABELS.map((label, i) => (
                    <option key={i} value={i}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start time" htmlFor="new-start">
                <Input id="new-start" type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </Field>
              <Field label="End time" htmlFor="new-end">
                <Input id="new-end" type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </Field>
              <Field label="Effective from" htmlFor="new-from">
                <Input id="new-from" type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
              </Field>
              <Field label="Effective until (optional)" htmlFor="new-until">
                <Input id="new-until" type="date" value={newUntil} onChange={(e) => setNewUntil(e.target.value)} />
              </Field>
              <Button type="button" variant="secondary" onClick={addWindow}>
                <Plus size={14} /> Add row
              </Button>
            </div>

            {sortedWindows.length === 0 ? (
              <p className="text-muted">No availability windows declared yet — add one above, then save.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Effective from</th>
                    <th>Effective until</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedWindows.map((w) => (
                    <tr key={w.key}>
                      <td>{DAY_LABELS[w.dayOfWeek]}</td>
                      <td>{w.startTime}</td>
                      <td>{w.endTime}</td>
                      <td>{w.effectiveFrom}</td>
                      <td>{w.effectiveUntil ?? '—'}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => removeWindow(w.key)}>
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            <div style={{ marginTop: '1rem' }}>
              <Button onClick={saveAvailability} loading={saving}>
                <Save size={14} /> Save availability
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="section-title">Add an exception</h2>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '-0.4rem', marginBottom: '1rem' }}>
              Leave, a meeting, a blocked period, or extra one-off availability — omit the times for a whole-day exception.
            </p>

            <NoticeBanner>
              This app can add exceptions, but the backend has no endpoint yet to list them back — exceptions you add this
              session appear below; earlier ones (or ones added from another device) aren't shown here.
            </NoticeBanner>

            <form onSubmit={submitException} className="row gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '1rem' }}>
              <Field label="Date" htmlFor="exc-date" error={excError ?? undefined}>
                <Input id="exc-date" type="date" value={excDate} onChange={(e) => setExcDate(e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="exc-type">
                <Select id="exc-type" value={excType} onChange={(e) => setExcType(e.target.value as ExceptionType)}>
                  {EXCEPTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start time (optional)" htmlFor="exc-start">
                <Input id="exc-start" type="time" value={excStart} onChange={(e) => setExcStart(e.target.value)} />
              </Field>
              <Field label="End time (optional)" htmlFor="exc-end">
                <Input id="exc-end" type="time" value={excEnd} onChange={(e) => setExcEnd(e.target.value)} />
              </Field>
              <Field label="Reason (optional)" htmlFor="exc-reason">
                <Input id="exc-reason" value={excReason} onChange={(e) => setExcReason(e.target.value)} placeholder="Conference travel" />
              </Field>
              <Button type="submit" loading={excSubmitting}>
                <Plus size={14} /> Add exception
              </Button>
            </form>

            {exceptions.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Time</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((exc) => (
                    <tr key={exc.id}>
                      <td>{exc.exception_date}</td>
                      <td>{exc.exception_type}</td>
                      <td>{exc.start_time && exc.end_time ? `${exc.start_time} – ${exc.end_time}` : 'Whole day'}</td>
                      <td>{exc.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
