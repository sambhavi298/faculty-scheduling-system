import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { ApiError, Button, Field, Input, useSession } from '@faculty-scheduling/ui';
import { describeError } from '../utils/errors';

/** UNAUTHENTICATED from the shared error map reads as "session expired," which is right everywhere else but wrong on this screen — here it can only mean the email/password didn't match. */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    return 'Incorrect email or password.';
  }
  return describeError(err);
}

/**
 * Real login screen — POST /api/auth/login (services/api/src/routes/auth.routes.ts),
 * bcrypt-verified password, a real JWT stored for every subsequent request.
 */
export function Login(): React.ReactElement {
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="auth-card__brand-icon">
            <GraduationCap size={20} />
          </span>
          <div>
            <h1 className="auth-card__title">Student Portal</h1>
            <p className="auth-card__subtitle">Faculty Appointment Scheduling</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <Field label="Email" htmlFor="email" error={error || undefined}>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@srmist.edu.in"
              invalid={!!error}
              autoFocus
              autoComplete="username"
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>

          <Button type="submit" style={{ width: '100%' }} loading={submitting}>
            Log in
          </Button>
        </form>
      </div>
    </div>
  );
}
