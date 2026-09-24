import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '@faculty-scheduling/ui';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { PendingRequests } from './pages/PendingRequests';
import { UpcomingAppointments } from './pages/UpcomingAppointments';
import { History } from './pages/History';
import { Availability } from './pages/Availability';

function LoginRoute(): React.ReactElement {
  const { session } = useSession();
  if (session) return <Navigate to="/" replace />;
  return <Login />;
}

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pending" element={<PendingRequests />} />
        <Route path="upcoming" element={<UpcomingAppointments />} />
        <Route path="history" element={<History />} />
        <Route path="availability" element={<Availability />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
