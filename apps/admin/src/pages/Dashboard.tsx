import React, { useEffect, useState } from 'react';
import { ErrorState, LoadingState, PageHeader, StatCard, StatGrid, Table, adminApi, type DashboardResponse } from '@faculty-scheduling/ui';

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: DashboardResponse };

/** GET /api/admin/dashboard — real counts plus faculty_appointment_stats (refreshed on read by the backend). */
export function Dashboard(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    adminApi
      .getDashboard()
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, []);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Aggregate stats across faculty, students, and appointments." />

      {state.status === 'loading' && <LoadingState label="Loading dashboard…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          <StatGrid>
            <StatCard label="Students" value={state.data.counts.total_students} />
            <StatCard label="Faculty" value={state.data.counts.total_faculty} />
            <StatCard label="Departments" value={state.data.counts.total_departments} />
            <StatCard label="Pending appointments" value={state.data.counts.pending_appointments} />
            <StatCard label="Approved appointments" value={state.data.counts.approved_appointments} />
            <StatCard label="Completed appointments" value={state.data.counts.completed_appointments} />
          </StatGrid>

          <h2 className="section-title" style={{ marginTop: '1.5rem' }}>
            Faculty appointment stats
          </h2>
          <Table>
            <thead>
              <tr>
                <th>Faculty</th>
                <th>Total requests</th>
                <th>Completed</th>
                <th>Missed</th>
                <th>Rejected</th>
                <th>Cancelled</th>
                <th>Avg. response (min)</th>
              </tr>
            </thead>
            <tbody>
              {state.data.facultyStats.map((row) => (
                <tr key={row.faculty_id}>
                  <td>{row.full_name}</td>
                  <td>{row.total_requests}</td>
                  <td>{row.completed_count}</td>
                  <td>{row.missed_count}</td>
                  <td>{row.rejected_count}</td>
                  <td>{row.cancelled_count}</td>
                  <td>{row.avg_response_minutes === null ? '—' : Math.round(row.avg_response_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
