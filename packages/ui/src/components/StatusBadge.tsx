import React from 'react';
import { Clock, CheckCircle2, XCircle, Ban, CheckCheck, AlertTriangle, TimerOff } from 'lucide-react';
import type { AppointmentStatus } from '../types';

/**
 * Colors are CSS var() references into tokens/tokens.css, not literal hex —
 * this used to be its own hardcoded palette (visually the most prominent
 * colored element in every appointment list, and it silently didn't move
 * when the shared token palette was last changed, since nothing here read
 * a token). Wiring it to the same tokens every other component uses means
 * a future palette change only has to touch tokens.css.
 */
const CONFIG: Record<AppointmentStatus, { label: string; bg: string; fg: string; Icon: typeof Clock }> = {
  PENDING: { label: 'Pending', bg: 'var(--accent-warning-tint)', fg: 'var(--accent-warning)', Icon: Clock },
  APPROVED: { label: 'Approved', bg: 'var(--accent-success-tint)', fg: 'var(--accent-success)', Icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', bg: 'var(--accent-danger-tint)', fg: 'var(--accent-danger)', Icon: XCircle },
  CANCELLED: { label: 'Cancelled', bg: 'var(--bg-subtle)', fg: 'var(--text-secondary)', Icon: Ban },
  COMPLETED: { label: 'Completed', bg: 'var(--accent-success-tint)', fg: 'var(--accent-success)', Icon: CheckCheck },
  MISSED: { label: 'Missed', bg: 'var(--accent-danger-tint)', fg: 'var(--accent-danger)', Icon: AlertTriangle },
  EXPIRED: { label: 'Expired', bg: 'var(--bg-subtle)', fg: 'var(--text-secondary)', Icon: TimerOff },
};

export function StatusBadge({ status }: { status: AppointmentStatus }): React.ReactElement {
  const cfg = CONFIG[status];
  const Icon = cfg.Icon;
  return (
    <span className="status-badge" style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <Icon size={12} strokeWidth={2.5} />
      {cfg.label}
    </span>
  );
}
