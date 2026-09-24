import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function AuditLogs(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Audit Log Viewer"
      pageSubtitle="Read-only trail of appointment and availability changes."
      blockedTitle="No admin audit-log endpoint yet"
      blockedDescription="The audit_log table already exists and is already being written to by the database's trg_audit_appointment trigger (services/api/migrations/sql/0002_appointments_and_exclusion_constraint.sql, 0003_functions_and_triggers.sql) with entity_type, entity_id, action, actor_id, old_data, new_data, and created_at for every appointment insert/update. There is simply no HTTP route yet to read it — this page will render those exact rows, read-only, once one exists."
      neededEndpoint="GET /api/admin/audit-log (read-only)"
    />
  );
}
