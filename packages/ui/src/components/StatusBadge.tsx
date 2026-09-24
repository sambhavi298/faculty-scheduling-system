import React from 'react';
import { Clock, CheckCircle2, XCircle, Ban, CheckCheck, AlertTriangle, TimerOff } from 'lucide-react';
import type { AppointmentStatus } from '../types';

const CONFIG: Record<AppointmentStatus, { label: string; bg: string; fg: string; Icon: typeof Clock }> = {
  PENDING: { label: 'Pending', bg: '#fbeee0', fg: '#b65c00', Icon: Clock },
  APPROVED: { label: 'Approved', bg: '#e7f4ec', fg: '#1f8a4c', Icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', bg: '#fbeaea', fg: '#b3261e', Icon: XCircle },
  CANCELLED: { label: 'Cancelled', bg: '#f1f5f9', fg: '#5b6b8c', Icon: Ban },
  COMPLETED: { label: 'Completed', bg: '#e7f4ec', fg: '#1f8a4c', Icon: CheckCheck },
  MISSED: { label: 'Missed', bg: '#fbeaea', fg: '#b3261e', Icon: AlertTriangle },
  EXPIRED: { label: 'Expired', bg: '#f1f5f9', fg: '#5b6b8c', Icon: TimerOff },
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
