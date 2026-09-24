import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function Faculty(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Faculty Management"
      pageSubtitle="Create, view, update, and remove faculty profiles."
      blockedTitle="No admin faculty endpoints yet"
      blockedDescription="services/api has a faculty table and faculty ownership checks inside the appointment flow, but no admin-facing CRUD routes to list, create, edit, or deactivate faculty records, and no ADMIN role to call them as. This page will list real faculty and let an admin manage them the moment those routes exist."
      neededEndpoint="GET / POST / PATCH / DELETE /api/admin/faculty"
    />
  );
}
