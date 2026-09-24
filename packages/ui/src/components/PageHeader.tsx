import React from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }): React.ReactElement {
  return (
    <div className="stat-card">
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {hint && <span className="stat-card__hint">{hint}</span>}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="stat-grid">{children}</div>;
}

export function NoticeBanner({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }): React.ReactElement {
  return (
    <div className="notice-banner">
      {icon}
      <div>{children}</div>
    </div>
  );
}
