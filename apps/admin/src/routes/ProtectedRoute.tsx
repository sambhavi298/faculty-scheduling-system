import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@faculty-scheduling/ui';

/** Gates every real admin route behind a real ADMIN-only session (see main.tsx's SessionProvider allowedRoles=['ADMIN']). */
export function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  const { session } = useSession();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
