import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';
import { Button, Field, Input } from '@faculty-scheduling/ui';
import { useAdminSession } from '../session/AdminSessionContext';

interface LocationState {
  from?: { pathname: string };
}

/**
 * The honest local entry gate for the admin app.
 *
 * This is NOT a login — there is nothing to authenticate against. The
 * backend's identify middleware (services/api/src/middleware/identify.middleware.ts)
 * only recognizes STUDENT and FACULTY; there is no ADMIN role at all. Typing
 * a name here only stores a display label in this browser's localStorage so
 * the app shell has something to show in its header — it is never sent to
 * the backend as any header or credential.
 */
export function Login(): React.ReactElement {
  const { session, login } = useAdminSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');

  if (session) {
    const state = location.state as LocationState | null;
    const redirectTo = state?.from?.pathname ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!name.trim()) return;
    login(name);
    navigate('/', { replace: true });
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="auth-card__brand-icon">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h1 className="auth-card__title">Admin Portal</h1>
            <p className="auth-card__subtitle">Faculty Appointment Scheduling</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="Admin name / label" htmlFor="admin-name" hint="Shown in the app header only — not a real account.">
            <Input
              id="admin-name"
              name="admin-name"
              autoFocus
              placeholder="e.g. Izhaan"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>

          <Button type="submit" style={{ width: '100%' }} disabled={!name.trim()}>
            Continue <ArrowRight size={16} />
          </Button>
        </form>

        <div className="auth-card__notice">
          <div className="row gap-sm" style={{ alignItems: 'flex-start' }}>
            <AlertTriangle size={15} style={{ color: 'var(--accent-warning)', flexShrink: 0, marginTop: '0.15rem' }} />
            <span>
              The backend doesn&apos;t yet support an admin role or any admin endpoints — this is a local-only label so
              the app has something to display in the header, not a real login. Nothing you type here is sent to the
              server.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
