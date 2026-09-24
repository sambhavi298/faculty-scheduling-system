import React from 'react';
import { Inbox, AlertOctagon, RefreshCcw, Construction } from 'lucide-react';
import { Button } from './Button';
import { ApiError } from '../types';

export function LoadingState({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <div className="spinner" />
      <span className="state-block__desc">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="state-block">
      <div className="state-block__icon" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
        <Inbox size={22} />
      </div>
      <div className="state-block__title">{title}</div>
      {description && <div className="state-block__desc">{description}</div>}
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): React.ReactElement {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.';
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <div className="state-block">
      <div className="state-block__icon" style={{ background: 'var(--accent-danger-tint)', color: 'var(--accent-danger)' }}>
        <AlertOctagon size={22} />
      </div>
      <div className="state-block__title">Couldn't load this</div>
      <div className="state-block__desc">
        {message}
        {code ? <span className="text-muted"> ({code})</span> : null}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCcw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}

/**
 * The honest "not built yet" state for any screen/feature whose backend
 * endpoint doesn't exist in services/api today. Used instead of mock data or
 * invented behavior — see the migration report for the full list of what
 * each of these is waiting on.
 */
export function BlockedFeature({
  title,
  description,
  neededEndpoint,
}: {
  title: string;
  description: string;
  neededEndpoint?: string;
}): React.ReactElement {
  return (
    <div className="blocked-feature">
      <div className="blocked-feature__icon">
        <Construction size={22} />
      </div>
      <div className="blocked-feature__title">{title}</div>
      <div className="blocked-feature__desc">{description}</div>
      {neededEndpoint && <code className="blocked-feature__endpoint">{neededEndpoint}</code>}
    </div>
  );
}
