import React from 'react';
import { BlockedPage } from '../components/BlockedPage';

export function Students(): React.ReactElement {
  return (
    <BlockedPage
      pageTitle="Student Management"
      pageSubtitle="Create, view, update, and remove student records and batch assignments."
      blockedTitle="No admin student endpoints yet"
      blockedDescription="services/api has a students table (with batch_id and roll_number), but no admin-facing CRUD routes to list, create, edit, or remove student records. This page will list real students and let an admin manage them once those routes exist."
      neededEndpoint="GET / POST / PATCH / DELETE /api/admin/students"
    />
  );
}
