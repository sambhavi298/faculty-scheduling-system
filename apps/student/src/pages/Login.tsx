import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { Button, Field, Input, useSession } from '@faculty-scheduling/ui';

/**
 * Dev-login screen. There is no password and no server-side verification —
 * services/api/src/middleware/identify.middleware.ts trusts whatever
 * X-User-Id / X-User-Role this app sends, so this form is honestly labelled
 * as a temporary identity scheme, not a real login.
 */
export function Login(): React.ReactElement {
  const { login } = useSession();
  const navigate = useNavigate();
  const [studentId, setStudentId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const trimmed = studentId.trim();
    if (!trimmed) {
      setError('Enter your student ID to continue.');
      return;
    }
    setError('');
    login(trimmed, 'STUDENT', displayName);
    navigate('/', { replace: true });
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
          <Field
            label="Student ID"
            htmlFor="studentId"
            error={error || undefined}
            hint={error ? undefined : 'Whatever ID your faculty knows you by, e.g. your roll number.'}
          >
            <Input
              id="studentId"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. 100"
              invalid={!!error}
              autoFocus
            />
          </Field>

          <Field label="Display name (optional)" htmlFor="displayName" hint="Shown only to you in this browser — never sent to the server.">
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Priya"
            />
          </Field>

          <Button type="submit" style={{ width: '100%' }}>
            Continue
          </Button>
        </form>

        <p className="auth-card__notice">
          This is a temporary, unverified identity scheme used during development — there is no password, and the
          backend trusts whatever ID and role this form sends as-is. It is not a real login.
        </p>
      </div>
    </div>
  );
}
