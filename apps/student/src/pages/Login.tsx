import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { ApiError, Button, Field, Input, consumeSessionExpiredNotice, useSession } from '@faculty-scheduling/ui';
import { describeError } from '../utils/errors';

/** UNAUTHENTICATED from the shared error map reads as "session expired," which is right everywhere else but wrong on this screen — here it can only mean the registration number/password didn't match. */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    return 'Incorrect registration number or password.';
  }
  return describeError(err);
}

/**
 * Real login screen — POST /api/auth/login (services/api/src/routes/auth.routes.ts),
 * bcrypt-verified password, a real JWT stored for every subsequent request.
 * Students sign in with their registration (roll) number, not email — see
 * services/api/src/repositories/auth.repository.ts's `findByIdentifier`.
 */
export function Login(): React.ReactElement {
  const { login } = useSession();
  const navigate = useNavigate();
  const [regNumber, setRegNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice] = useState(() => (consumeSessionExpiredNotice() ? 'Your session expired. Please log in again.' : ''));

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!regNumber.trim() || !password) {
      setError('Enter your registration number and password to continue.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await login(regNumber.trim(), password);
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

        {notice && (
          <p role="status" style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Field label="Registration Number" htmlFor="regNumber" error={error || undefined}>
            <Input
              id="regNumber"
              type="text"
              value={regNumber}
              onChange={(e) => setRegNumber(e.target.value)}
              placeholder="e.g. CSE2026-001"
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
