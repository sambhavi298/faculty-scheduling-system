import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, UserRole } from '../types';
import { setApiSession } from '../api/client';

interface SessionContextValue {
  session: Session | null;
  /** Logs in against the real (temporary) identity scheme: whatever id/role is
   * given here is sent verbatim as X-User-Id / X-User-Role on every request
   * from now on. There is no password and no server-side verification —
   * that's the backend's current, documented state
   * (services/api/src/middleware/identify.middleware.ts), not something this
   * frontend can fake its way past. */
  login: (userId: string, role: UserRole, displayName?: string) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function readStored(storageKey: string): Session | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (parsed && typeof parsed.userId === 'string' && (parsed.role === 'STUDENT' || parsed.role === 'FACULTY')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** One provider per app, each with its own storageKey, so a student session and a faculty session never bleed into each other even if opened in the same browser. */
export function SessionProvider({
  storageKey,
  children,
}: {
  storageKey: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [session, setSession] = useState<Session | null>(() => readStored(storageKey));

  useEffect(() => {
    setApiSession(session);
  }, [session]);

  const login = useCallback(
    (userId: string, role: UserRole, displayName?: string) => {
      const next: Session = { userId: userId.trim(), role, displayName: displayName?.trim() || undefined };
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSession(next);
    },
    [storageKey]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(storageKey);
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
