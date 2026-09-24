import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAdminSession } from '../session/AdminSessionContext';

/**
 * Gates every real admin route behind the local entry gate at `/login`.
 * There is no real authentication to check here (see AdminSessionContext) —
 * this only ensures the app has a display label before showing the shell.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  const { session } = useAdminSession();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
