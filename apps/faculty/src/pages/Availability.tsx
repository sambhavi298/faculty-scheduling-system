import React from 'react';
import { BlockedFeature, PageHeader } from '@faculty-scheduling/ui';

export function Availability(): React.ReactElement {
  return (
    <div>
      <PageHeader title="Availability & Exceptions" subtitle="Manage your weekly hours and one-off exceptions." />

      <BlockedFeature
        title="Not built yet on the backend"
        description={
          "Faculty still cannot manage their own availability through any code path (see docs/IMPLEMENTATION_STATUS.md). " +
          "This page is intentionally left blocked rather than built against a fake weekly grid — once the backend " +
          "exposes the endpoints below, this screen will read and write real availability and one-off exceptions " +
          "(leave days, blocked periods) instead of showing this notice."
        }
        neededEndpoint="GET/PUT /api/faculty/availability, POST /api/faculty/availability/exceptions"
      />
    </div>
  );
}
