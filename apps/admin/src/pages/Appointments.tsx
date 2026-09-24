import React, { useEffect, useState } from 'react';
import {
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  adminApi,
  formatSlot,
  type AdminAppointmentRow,
  type AppointmentStatus,
} from '@faculty-scheduling/ui';

const STATUSES: AppointmentStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'MISSED', 'EXPIRED'];
const PAGE_SIZE = 25;

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; rows: AdminAppointmentRow[] };

/**
 * GET /api/admin/appointments — read-only, on purpose (see this route's own
 * comment in services/api/src/routes/admin.routes.ts): an admin can see
 * every appointment across every student and faculty member, but approving,
 * rejecting, cancelling, completing, or marking one missed stays a decision
 * for the student or faculty member involved. No action buttons here.
 */
export function Appointments(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [status, setStatus] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [page, setPage] = useState(1);

  function load(): void {
    setState({ status: 'loading' });
    adminApi
      .listAppointments({
        status: status || undefined,
        facultyId: facultyId.trim() || undefined,
        studentId: studentId.trim() || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((rows) => setState({ status: 'ready', rows }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, [status, facultyId, studentId, page]);

  const rows = state.status === 'ready' ? state.rows : [];

  return (
    <div>
      <PageHeader title="Appointments Oversight" subtitle="Read-only visibility into every appointment across all students and faculty." />

      <Card style={{ marginBottom: '1.25rem' }}>
        <div className="row gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Status" htmlFor="filter-status">
            <Select
              id="filter-status"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Faculty ID" htmlFor="filter-faculty">
            <Input
              id="filter-faculty"
              value={facultyId}
              onChange={(e) => {
                setPage(1);
                setFacultyId(e.target.value);
              }}
              placeholder="e.g. 200"
            />
          </Field>
          <Field label="Student ID" htmlFor="filter-student">
            <Input
              id="filter-student"
              value={studentId}
              onChange={(e) => {
                setPage(1);
                setStudentId(e.target.value);
              }}
              placeholder="e.g. 100"
            />
          </Field>
        </div>
      </Card>

      {state.status === 'loading' && <LoadingState label="Loading appointments…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          <Table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Faculty</th>
                <th>Slot</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.student_name}</td>
                  <td>{row.faculty_name}</td>
                  <td>{formatSlot(row.slot)}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>{row.reason}</td>
                  <td>{new Date(row.requested_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="row gap-sm" style={{ marginTop: '1rem', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span className="text-muted" style={{ fontSize: '0.85rem' }}>
              Page {page}
            </span>
            <button className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <button className="btn btn--secondary btn--sm" disabled={rows.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
