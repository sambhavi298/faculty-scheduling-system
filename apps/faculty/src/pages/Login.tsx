import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { ApiError, Button, Card, Field, Input, useSession } from '@faculty-scheduling/ui';
import { describeError } from '../lib/errorMessage';

/** UNAUTHENTICATED reads as "session expired" everywhere else in this app — here it can only mean the email/password didn't match. */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
    return 'Incorrect email or password.';
  }
  return describeError(err);
}

export function Login(): React.ReactElement {
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
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

        <form onSubmit={handleSubmit}>
          <Field label="Email" htmlFor="email" error={error ?? undefined}>
            <Input
              id="email"
              name="email"
              type="email"
              autoFocus
              placeholder="you@srmist.edu.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
