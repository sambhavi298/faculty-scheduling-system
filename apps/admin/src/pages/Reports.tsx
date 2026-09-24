import React, { useEffect, useState } from 'react';
import { ErrorState, LoadingState, PageHeader, Table, adminApi, type WorkloadReportRow } from '@faculty-scheduling/ui';

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; rows: WorkloadReportRow[] };

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * GET /api/admin/reports/appointments-summary — the RANK()/running-SUM()
 * window-function query (services/api/src/repositories/admin.repository.ts
 * getWorkloadReport): faculty workload ranked within each week, plus a
 * running total across the semester. This is genuinely the one screen in
 * this app a plain GROUP BY couldn't produce — see that method's own
 * comment.
 */
export function Reports(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    adminApi
      .getWorkloadReport()
      .then((rows) => setState({ status: 'ready', rows }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, []);

  const rows = state.status === 'ready' ? state.rows : [];

  return (
    <div>
      <PageHeader title="Reports & Statistics" subtitle="Faculty workload, ranked by week, with a running semester total." />

      {state.status === 'loading' && <LoadingState label="Loading report…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && rows.length === 0 && (
        <p className="text-muted">No completed or approved appointments yet — this report is based on those two statuses.</p>
      )}

      {state.status === 'ready' && rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Faculty</th>
              <th>Appointments that week</th>
              <th>Rank that week</th>
              <th>Running total (semester)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.faculty_id}-${row.week_start}-${i}`}>
                <td>{dateFmt.format(new Date(row.week_start))}</td>
                <td>{row.full_name}</td>
                <td>{row.appointments_that_week}</td>
                <td>#{row.workload_rank}</td>
                <td>{row.running_total_this_semester}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
