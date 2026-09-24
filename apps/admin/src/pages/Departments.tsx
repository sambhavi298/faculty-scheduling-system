import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function Departments(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Departments"
      pageSubtitle="Manage the departments that faculty and batches belong to."
      blockedTitle="No admin department endpoints yet"
      blockedDescription="The schema already has a departments table (services/api/migrations/sql/0001_extensions_and_core_tables.sql — id, name, code) that faculty and batches reference, but no admin-facing CRUD routes exist yet to manage it over HTTP."
      neededEndpoint="GET / POST / PATCH / DELETE /api/admin/departments"
    />
  );
}
