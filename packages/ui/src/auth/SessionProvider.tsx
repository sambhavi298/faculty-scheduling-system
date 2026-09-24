import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Session, UserRole } from '../types';
import { authApi } from '../api/auth';
import { setApiSession } from '../api/client';

interface SessionContextValue {
  session: Session | null;
  /**
   * Logs in against the real backend (POST /api/auth/login —
   * services/api/src/services/auth.service.ts): bcrypt-verified password,
   * a real 12h JWT returned and stored. Throws (does not store a session)
   * when the credentials are wrong, or when the account's role isn't one
   * this app accepts — e.g. a real FACULTY account trying to log into the
   * student portal — so a student session and a faculty session never mix
   * in the same browser tab, the same guarantee the old per-app storageKey
   * scheme gave when there was no real role to check.
   */
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function isSession(value: unknown): value is Session {
  const s = value as Partial<Session> | null;
  return (
    !!s &&
    typeof s.token === 'string' &&
    typeof s.id === 'string' &&
    typeof s.fullName === 'string' &&
    typeof s.email === 'string' &&
    (s.role === 'STUDENT' || s.role === 'FACULTY' || s.role === 'ADMIN')
  );
}

function readStored(storageKey: string, allowedRoles: UserRole[]): Session | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isSession(parsed) && allowedRoles.includes(parsed.role)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** One provider per app, each with its own storageKey and its own allowed role(s), so a student session and a faculty/admin session never bleed into each other even if opened in the same browser. */
export function SessionProvider({
  storageKey,
  allowedRoles,
  children,
}: {
  storageKey: string;
  /** Which real backend role(s) this app's login accepts. Defaults to STUDENT for backward compatibility with existing callers. */
  allowedRoles?: UserRole[];
  children: React.ReactNode;
}): React.ReactElement {
  const roles = useMemo(() => allowedRoles ?? (['STUDENT'] as UserRole[]), [allowedRoles]);
  const [session, setSession] = useState<Session | null>(() => readStored(storageKey, roles));

  // Keep the shared API client's identity (the bearer token) in sync with
  // this provider's session SYNCHRONOUSLY, during render — not via
  // useEffect. See the long-standing comment this replaces: React commits
  // effects bottom-up, so a descendant's own useEffect (e.g. a Dashboard
  // page loading its data on mount) can fire before an ancestor provider's
  // useEffect would. Calling setApiSession here, in the render body,
  // guarantees the module-level session api/client.ts reads is correct
  // before any child of this provider renders or mounts, since React
  // renders top-down and only runs effects after the whole tree has
  // committed. This line only writes a plain module variable — safe to run
  // on every render, including React StrictMode's extra dev-mode passes.
  setApiSession(session);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const result = await authApi.login(email, password);
      if (!roles.includes(result.user.role)) {
        throw new Error(
          `This account is a ${result.user.role.toLowerCase()} account and can't sign in here. Use the correct portal for this account.`
        );
      }
      const next: Session = {
        token: result.token,
        id: result.user.id,
        role: result.user.role,
        fullName: result.user.fullName,
        email: result.user.email,
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // localStorage unavailable (private mode, quota) — the in-memory session still works for this tab.
      }
      setSession(next);
    },
    [storageKey, roles]
  );

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // best-effort
    }
    setSession(null);
  }, [storageKey]);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
