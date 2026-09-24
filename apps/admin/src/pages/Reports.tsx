import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function Reports(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Reports & Statistics"
      pageSubtitle="Aggregate appointment and availability analytics."
      blockedTitle="No admin reporting endpoint yet"
      blockedDescription="Analytical reporting (appointment volume, approval rates, no-show rates, faculty load, and similar) needs a dedicated aggregation endpoint that doesn't exist yet, and no ADMIN role to call it as. Explicitly not supported in this pass — this page shows no charts or numbers, fabricated or otherwise, until that endpoint is real."
      neededEndpoint="GET /api/admin/reports/appointments-summary"
    />
  );
}
