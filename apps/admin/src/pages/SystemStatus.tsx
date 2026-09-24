import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ServerCrash } from 'lucide-react';
import { PageHeader, Card, LoadingState, ErrorState, checkHealth, ApiError } from '@faculty-scheduling/ui';

type CheckState =
  | { phase: 'loading' }
  | { phase: 'ok'; body: { status: string }; checkedAt: Date }
  | { phase: 'error'; error: unknown; checkedAt: Date };

/**
 * The one page in this app that calls something real: the backend's
 * unauthenticated GET /health (services/api/src/app.ts). Everything else in
 * the admin app has no real endpoint to call — this one does, so this is the
 * one honest, real thing an admin can see today.
 */
export function SystemStatus(): React.ReactElement {
  const [state, setState] = useState<CheckState>({ phase: 'loading' });

  const runCheck = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const body = await checkHealth();
      setState({ phase: 'ok', body, checkedAt: new Date() });
    } catch (error) {
      setState({ phase: 'error', error, checkedAt: new Date() });
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return (
    <>
      <PageHeader
        title="System Status"
        subtitle="Live reachability of the backend's GET /health endpoint — the only endpoint this app calls for real."
      />
      <Card>
        {state.phase === 'loading' && <LoadingState label="Checking backend connectivity…" />}

        {state.phase === 'error' && (
          <div>
            <div className="row gap-sm" style={{ marginBottom: '0.75rem' }}>
              <ServerCrash size={18} style={{ color: 'var(--accent-danger)' }} />
              <strong style={{ color: 'var(--text-primary)' }}>Backend unreachable</strong>
            </div>
            <ErrorState error={state.error} onRetry={() => void runCheck()} />
            {state.error instanceof ApiError && (
              <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                Error code: <span className="mono">{state.error.code}</span>
              </p>
            )}
          </div>
        )}

        {state.phase === 'ok' && (
          <div className="stack gap-md">
            <div className="row gap-sm">
              <CheckCircle2 size={18} style={{ color: 'var(--accent-success)' }} />
              <strong style={{ color: 'var(--text-primary)' }}>Backend reachable</strong>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              <code className="mono">GET /health</code> responded successfully at {state.checkedAt.toLocaleTimeString()}.
            </p>
            <div>
              <div className="field__label" style={{ marginBottom: '0.35rem' }}>
                Raw response
              </div>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem 0.9rem',
                  fontSize: '0.82rem',
                  color: 'var(--text-primary)',
                }}
              >
                {JSON.stringify(state.body, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
