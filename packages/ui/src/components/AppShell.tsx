import React from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut, GraduationCap } from 'lucide-react';
import { Button } from './Button';

export interface NavItem {
  to: string;
  label: string;
  // `size` is typed `number | string` (not just `number`) because that's how
  // lucide-react's own icon components declare it — narrowing it to `number`
  // here makes every real lucide icon structurally incompatible with this
  // slot (TS compares the generated `propTypes` field too) and breaks the
  // build for any consumer. Type-only widening, no runtime effect.
  icon: React.ComponentType<{ size?: number | string }>;
  end?: boolean;
}

interface AppShellProps {
  appTitle: string;
  appSubtitle: string;
  navItems: NavItem[];
  headerTitle: string;
  sessionLabel: string;
  onLogout: () => void;
  brandIcon?: React.ComponentType<{ size?: number | string }>;
  children: React.ReactNode;
}

export function AppShell({
  appTitle,
  appSubtitle,
  navItems,
  headerTitle,
  sessionLabel,
  onLogout,
  brandIcon: BrandIcon = GraduationCap,
  children,
}: AppShellProps): React.ReactElement {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <span className="app-sidebar__brand-icon">
            <BrandIcon size={17} />
          </span>
          <span>
            <div className="app-sidebar__brand-title">{appTitle}</div>
            <div className="app-sidebar__brand-subtitle">{appSubtitle}</div>
          </span>
        </div>
        <nav className="app-sidebar__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `app-sidebar__link${isActive ? ' active' : ''}`}
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar__footer">
          <Button variant="ghost" size="sm" onClick={onLogout} style={{ color: 'var(--sidebar-text)', width: '100%', justifyContent: 'flex-start' }}>
            <LogOut size={15} /> Log out
          </Button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <span className="app-header__title">{headerTitle}</span>
          <span className="app-header__session">
            <span className="session-pill">{sessionLabel}</span>
          </span>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
