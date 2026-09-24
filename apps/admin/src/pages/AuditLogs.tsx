import React, { useEffect, useState } from 'react';
import { Card, ErrorState, Field, Input, LoadingState, PageHeader, Table, adminApi, type AuditLogRow } from '@faculty-scheduling/ui';

const PAGE_SIZE = 25;

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; rows: AuditLogRow[] };

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** GET /api/admin/audit-log — read-only. Backed by audit_log, written only by the database's own trigger (append-only by grant — no role, including ADMIN, can write it over HTTP). */
export function AuditLogs(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);

  function load(): void {
    setState({ status: 'loading' });
    adminApi
      .listAuditLog({ entityType: entityType.trim() || undefined, entityId: entityId.trim() || undefined, page, pageSize: PAGE_SIZE })
      .then((rows) => setState({ status: 'ready', rows }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }

  useEffect(load, [entityType, entityId, page]);

  const rows = state.status === 'ready' ? state.rows : [];

  return (
    <div>
      <PageHeader title="Audit Log Viewer" subtitle="Read-only trail of appointment and availability changes." />

      <Card style={{ marginBottom: '1.25rem' }}>
        <div className="row gap-sm" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Entity type" htmlFor="filter-entity-type" hint="e.g. appointment">
            <Input
              id="filter-entity-type"
              value={entityType}
              onChange={(e) => {
                setPage(1);
                setEntityType(e.target.value);
              }}
              placeholder="appointment"
            />
          </Field>
          <Field label="Entity ID" htmlFor="filter-entity-id">
            <Input
              id="filter-entity-id"
              value={entityId}
              onChange={(e) => {
                setPage(1);
                setEntityId(e.target.value);
              }}
              placeholder="e.g. 42"
            />
          </Field>
        </div>
      </Card>

      {state.status === 'loading' && <LoadingState label="Loading audit log…" />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={load} />}

      {state.status === 'ready' && (
        <>
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Entity</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Old</th>
                <th>New</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    {row.entity_type} <span className="text-muted mono">#{row.entity_id}</span>
                  </td>
                  <td className="mono">{row.action}</td>
                  <td>{row.actor_id ?? '—'}</td>
                  <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={formatJson(row.old_data)}>
                    {formatJson(row.old_data)}
                  </td>
                  <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={formatJson(row.new_data)}>
                    {formatJson(row.new_data)}
                  </td>
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
