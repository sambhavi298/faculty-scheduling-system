import type { AppointmentRow } from '../types';

/**
 * A small, honestly-labeled local cache of REAL appointment rows this
 * browser has actually received from the backend (via GET /pending or a
 * mutation response). It exists only because the backend has no endpoint
 * today that lists a faculty member's APPROVED/COMPLETED/MISSED/REJECTED
 * appointments (only PENDING, via GET /api/appointments/pending) — see
 * docs/IMPLEMENTATION_STATUS.md and the migration report's "Remaining
 * backend dependencies" section, where the missing endpoint is filed.
 *
 * This is NOT mock data: every row stored here is a real API response.
 * It's a client-side cache filling a real listing-endpoint gap, scoped to
 * one browser/device and cleared on logout. The UI must always label it as
 * such so nobody mistakes it for a complete, cross-device list.
 */
function storageKey(namespace: string, userId: string): string {
  return `faculty-scheduling:${namespace}:${userId}`;
}

export function readCache(namespace: string, userId: string): AppointmentRow[] {
  try {
    const raw = localStorage.getItem(storageKey(namespace, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppointmentRow[]) : [];
  } catch {
    return [];
  }
}

export function upsertCache(namespace: string, userId: string, row: AppointmentRow): void {
  const existing = readCache(namespace, userId);
  const next = [row, ...existing.filter((r) => r.id !== row.id)];
  try {
    localStorage.setItem(storageKey(namespace, userId), JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, quota) — cache is best-effort only.
  }
}

export function removeFromCache(namespace: string, userId: string, id: string): void {
  const existing = readCache(namespace, userId);
  try {
    localStorage.setItem(storageKey(namespace, userId), JSON.stringify(existing.filter((r) => r.id !== id)));
  } catch {
    // best-effort
  }
}

export function clearCache(namespace: string, userId: string): void {
  try {
    localStorage.removeItem(storageKey(namespace, userId));
  } catch {
    // best-effort
  }
}
