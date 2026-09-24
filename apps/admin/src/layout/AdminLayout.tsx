import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Building2,
  CalendarClock,
  ShieldAlert,
  FileBarChart2,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { AppShell, type NavItem } from '@faculty-scheduling/ui';
import { useAdminSession } from '../session/AdminSessionContext';

// packages/ui's NavItem.icon / AppShell brandIcon are typed
// `React.ComponentType<{ size?: number | string }>`, matching lucide-react's
// real LucideProps exactly, so icons can be passed directly.
export const ADMIN_NAV_ITEMS: (NavItem & { headerTitle: string })[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, headerTitle: 'Dashboard' },
  { to: '/faculty', label: 'Faculty', icon: Users, headerTitle: 'Faculty Management' },
  { to: '/students', label: 'Students', icon: GraduationCap, headerTitle: 'Student Management' },
  { to: '/departments', label: 'Departments', icon: Building2, headerTitle: 'Departments' },
  {
    to: '/appointments',
    label: 'Appointments',
    icon: CalendarClock,
    headerTitle: 'Appointments Oversight',
  },
  { to: '/audit-logs', label: 'Audit Logs', icon: ShieldAlert, headerTitle: 'Audit Log Viewer' },
  { to: '/reports', label: 'Reports', icon: FileBarChart2, headerTitle: 'Reports & Statistics' },
  { to: '/system-status', label: 'System Status', icon: Activity, headerTitle: 'System Status' },
];

const BrandIcon = ShieldCheck;

export function AdminLayout(): React.ReactElement {
  const { session, logout } = useAdminSession();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = (): void => {
    logout();
    navigate('/login', { replace: true });
  };

  const current =
    ADMIN_NAV_ITEMS.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))) ??
    ADMIN_NAV_ITEMS[0];

  return (
    <AppShell
      appTitle="Admin Portal"
      appSubtitle="Faculty Appointment Scheduling"
      navItems={ADMIN_NAV_ITEMS}
      headerTitle={current.headerTitle}
      sessionLabel={session?.name ?? 'Admin'}
      onLogout={handleLogout}
      brandIcon={BrandIcon}
    >
      <Outlet />
    </AppShell>
  );
}
