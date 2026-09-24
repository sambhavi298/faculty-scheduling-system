import React from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { CalendarPlus, GraduationCap, LayoutDashboard, ListChecks, Users } from 'lucide-react';
import type { NavItem } from '@faculty-scheduling/ui';
import { AppShell, useSession } from '@faculty-scheduling/ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { RequestAppointment } from './pages/RequestAppointment';
import { MyAppointments } from './pages/MyAppointments';
import { AppointmentDetail } from './pages/AppointmentDetail';
import { FacultyDirectory } from './pages/FacultyDirectory';
import { AppointmentsProvider } from './state/AppointmentsContext';

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/request', label: 'Request Appointment', icon: CalendarPlus },
  { to: '/appointments', label: 'My Appointments', icon: ListChecks },
  { to: '/faculty', label: 'Faculty Directory', icon: Users },
];

function AuthenticatedLayout(): React.ReactElement {
  const { session, logout } = useSession();
  const navigate = useNavigate();

  function handleLogout(): void {
    logout();
    navigate('/login', { replace: true });
  }

  const sessionLabel = session?.displayName ? `${session.displayName} (${session.userId})` : `Student ${session?.userId ?? ''}`;

  return (
    <AppShell
      appTitle="Student Portal"
      appSubtitle="Appointment Scheduling"
      navItems={NAV_ITEMS}
      headerTitle="Faculty Appointment Scheduling"
      sessionLabel={sessionLabel}
      onLogout={handleLogout}
      brandIcon={GraduationCap}
    >
      <Outlet />
    </AppShell>
  );
}

/** Redirects to /login when there's no session, otherwise mounts the shared appointments store once for every authenticated screen. */
function RequireAuth(): React.ReactElement {
  const { session } = useSession();
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AppointmentsProvider>
      <AuthenticatedLayout />
    </AppointmentsProvider>
  );
}

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/request" element={<RequestAppointment />} />
        <Route path="/appointments" element={<MyAppointments />} />
        <Route path="/appointments/:id" element={<AppointmentDetail />} />
        <Route path="/faculty" element={<FacultyDirectory />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
