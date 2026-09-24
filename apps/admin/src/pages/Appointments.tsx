import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function Appointments(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Appointments Oversight"
      pageSubtitle="Read-only visibility into every appointment across all students and faculty."
      blockedTitle="No admin appointment-oversight endpoint yet"
      blockedDescription="The existing appointment routes (services/api/src/routes/appointment.routes.ts) are scoped to the calling student or faculty member — there is no admin-wide listing endpoint. When one is built, it must stay strictly read-only for admins: approving, rejecting, cancelling, completing, or marking an appointment missed is a decision that belongs to the student or faculty member involved, never to an administrator."
      neededEndpoint="GET /api/admin/appointments (read-only)"
    />
  );
}
