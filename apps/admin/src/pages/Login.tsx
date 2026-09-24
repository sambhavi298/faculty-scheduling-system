import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { ApiError, Button, Field, Input, useSession } from '@faculty-scheduling/ui';

interface LocationState {
  from?: { pathname: string };
}

function describeLoginError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    return 'Incorrect email or password.';
  }
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Real login — POST /api/auth/login. Only an account with role ADMIN is accepted here (see main.tsx's SessionProvider allowedRoles=['ADMIN']); any other real account is rejected with a clear message rather than silently granted admin access. */
export function Login(): React.ReactElement {
  const { session, login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    const state = location.state as LocationState | null;
    const redirectTo = state?.from?.pathname ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setSubmitting(false);
    }
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
          <Field label="Email" htmlFor="admin-email" error={error ?? undefined}>
            <Input
              id="admin-email"
              name="admin-email"
              type="email"
              autoFocus
              placeholder="admin@srmist.edu.in"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(error)}
              autoComplete="username"
            />
          </Field>

          <Field label="Password" htmlFor="admin-password">
            <Input
              id="admin-password"
              name="admin-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>

          <Button type="submit" style={{ width: '100%' }} loading={submitting}>
            Log in <ArrowRight size={16} />
          </Button>
        </form>
      </div>
    </div>
  );
}
