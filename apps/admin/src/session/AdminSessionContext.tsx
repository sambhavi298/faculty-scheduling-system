import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * A tiny, LOCAL-ONLY session for the admin app.
 *
 * This is deliberately NOT the shared `@faculty-scheduling/ui` SessionProvider.
 * That one calls `setApiSession` and sends real `X-User-Id` / `X-User-Role`
 * headers to the backend (services/api/src/middleware/identify.middleware.ts),
 * which only recognizes `STUDENT` and `FACULTY` — there is no `ADMIN` role
 * server-side. Sending `X-User-Role: ADMIN` would just get every real call a
 * 401, which is correct-but-pointless to wire up when nothing real exists to
 * call for admin-scoped data anyway.
 *
 * So this context holds nothing but a display label, typed in at `/login`,
 * stored under its own `admin-session` localStorage key, and NEVER sent to
 * the backend as a header or otherwise. It exists purely so the app shell has
 * something to show in the header and something to gate routes on, until a
 * real ADMIN role and real admin endpoints exist.
 */

const STORAGE_KEY = 'admin-session';

export interface AdminSession {
  name: string;
}

interface AdminSessionContextValue {
  session: AdminSession | null;
  login: (name: string) => void;
  logout: () => void;
}

const AdminSessionContext = createContext<AdminSessionContextValue | undefined>(undefined);

function readStored(): AdminSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (parsed && typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      return { name: parsed.name };
    }
    return null;
  } catch {
    // localStorage can throw (private browsing, blocked storage, etc.) — treat as "no session".
    return null;
  }
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<AdminSession | null>(() => readStored());

  const login = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next: AdminSession = { name: trimmed };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures — the in-memory session still works for this tab.
    }
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionContextValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession must be used within an AdminSessionProvider');
  return ctx;
}
