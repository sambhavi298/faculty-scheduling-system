import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { Button, Card, Field, Input, useSession } from '@faculty-scheduling/ui';

export function Login(): React.ReactElement {
  const { login } = useSession();
  const navigate = useNavigate();
  const [facultyId, setFacultyId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const trimmedId = facultyId.trim();
    if (!trimmedId) {
      setError('Enter a faculty ID to continue.');
      return;
    }
    setError(null);
    login(trimmedId, 'FACULTY', displayName);
    navigate('/', { replace: true });
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

        <p className="login-card__notice">
          This is a temporary, unverified identity scheme for the project's current build — there is no
          password, and the backend does not yet check that this ID really belongs to you
          (<code>services/api/src/middleware/identify.middleware.ts</code>). Whatever ID you enter is sent as
          <code>X-User-Id</code> on every request and treated as your identity.
        </p>

        <form onSubmit={handleSubmit}>
          <Field label="Faculty ID" htmlFor="facultyId" hint="e.g. 200 — must match a seeded faculty id in the database." error={error ?? undefined}>
            <Input
              id="facultyId"
              name="facultyId"
              autoFocus
              placeholder="200"
              value={facultyId}
              onChange={(e) => setFacultyId(e.target.value)}
              invalid={Boolean(error)}
            />
          </Field>

          <Field label="Display name (optional)" htmlFor="displayName" hint="Shown only in this browser — never sent to the backend.">
            <Input
              id="displayName"
              name="displayName"
              placeholder="Prof. K. Rao"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>

          <Button type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
