import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { ApiError, Button, Card, Field, Input, consumeSessionExpiredNotice, useSession } from '@faculty-scheduling/ui';
import { describeError } from '../lib/errorMessage';

/** UNAUTHENTICATED reads as "session expired" everywhere else in this app — here it can only mean the staff code/password didn't match. */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    return 'Incorrect staff code or password.';
  }
  return describeError(err);
}

/** Faculty sign in with their staff code, not email — see services/api/src/repositories/auth.repository.ts's `findByIdentifier`. */
export function Login(): React.ReactElement {
  const { login } = useSession();
  const navigate = useNavigate();
  const [staffCode, setStaffCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice] = useState(() => (consumeSessionExpiredNotice() ? 'Your session expired. Please log in again.' : ''));

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!staffCode.trim() || !password) {
      setError('Enter your staff code and password to continue.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(staffCode.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <Card className="login-card">
        <div className="login-card__brand">
          <span className="login-card__brand-icon">
            <UserCog size={22} />
          </span>
          <div>
            <div className="login-card__brand-title">Faculty Portal</div>
            <div className="login-card__brand-subtitle">Faculty Appointment Scheduling</div>
          </div>
        </div>

        {notice && (
          <p role="status" style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <Field label="Staff Code" htmlFor="staffCode" error={error ?? undefined}>
            <Input
              id="staffCode"
              name="staffCode"
              type="text"
              autoFocus
              placeholder="e.g. CSE-F01"
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value)}
              invalid={Boolean(error)}
              autoComplete="username"
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>

          <Button type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} loading={submitting}>
            Log in
          </Button>
        </form>
      </Card>
    </div>
  );
}
