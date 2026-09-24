import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function Dashboard(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Dashboard"
      pageSubtitle="Aggregate stats across faculty, students, and appointments."
      blockedTitle="No admin dashboard data yet"
      blockedDescription="There is no admin-scoped reporting endpoint on the backend today, and no ADMIN role to authenticate one with. Every number on a dashboard like this would have to be invented, so this page shows nothing until a real endpoint exists. See System Status for the one genuinely real signal this app can show right now."
      neededEndpoint="GET /api/admin/dashboard"
    />
  );
}
