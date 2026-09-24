import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, ListChecks, CalendarClock, History as HistoryIcon, CalendarDays, UserCog } from 'lucide-react';
import { AppShell, type NavItem, useSession } from '@faculty-scheduling/ui';

// packages/ui's NavItem.icon / AppShell brandIcon are typed
// `React.ComponentType<{ size?: number | string }>`, matching lucide-react's
// real LucideProps exactly, so icons can be passed directly.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pending', label: 'Pending Requests', icon: ListChecks },
  { to: '/upcoming', label: 'Upcoming', icon: CalendarClock },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/availability', label: 'Availability', icon: CalendarDays },
];

const BrandIcon = UserCog;

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/pending': 'Pending Requests',
  '/upcoming': 'Upcoming Appointments',
  '/history': 'History',
  '/availability': 'Availability & Exceptions',
};

export function Layout(): React.ReactElement {
  const { session, logout } = useSession();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const headerTitle = TITLES[location.pathname] ?? 'Faculty Portal';
  const sessionLabel = session.displayName ? `${session.displayName} · #${session.userId}` : `Faculty #${session.userId}`;

  return (
    <AppShell
      appTitle="Faculty Portal"
      appSubtitle="Appointment Scheduling"
      navItems={NAV_ITEMS}
      headerTitle={headerTitle}
      sessionLabel={sessionLabel}
      onLogout={logout}
      brandIcon={BrandIcon}
    >
      <Outlet />
    </AppShell>
  );
}
