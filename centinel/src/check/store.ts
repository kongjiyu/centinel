import { useSyncExternalStore } from 'react';
import type { CheckRecord } from './types';

/**
 * Device-local list of checks per account. It stores only IDs, names and the
 * state of the preparation step; never source text, findings or secrets.
 */
const PREFIX = 'centinel:checks:';
const MAX_CHECKS = 50;
const listeners = new Set<() => void>();
let accountKey = `${PREFIX}local`;
let cache: CheckRecord[] | null = null;

function read(): CheckRecord[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(accountKey);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function isRecord(value: unknown): value is CheckRecord {
  return !!value && typeof value === 'object' && typeof (value as CheckRecord).id === 'string' && typeof (value as CheckRecord).projectName === 'string';
}

function write(next: CheckRecord[]) {
  cache = next.slice(0, MAX_CHECKS);
  try { window.localStorage.setItem(accountKey, JSON.stringify(cache)); } catch { /* storage is optional */ }
  listeners.forEach(listener => listener());
}

export function setCheckAccount(accountId: string | null) {
  const next = `${PREFIX}${accountId ?? 'local'}`;
  if (next === accountKey) return;
  accountKey = next;
  cache = null;
  // Called while App renders; notify subscribers after the render.
  queueMicrotask(() => listeners.forEach(listener => listener()));
}

export function listChecks(): CheckRecord[] {
  return read();
}

export function getCheck(id: string): CheckRecord | undefined {
  return read().find(check => check.id === id);
}

export function saveCheck(check: CheckRecord) {
  const others = read().filter(item => item.id !== check.id);
  write([check, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export function updateCheck(id: string, patch: Partial<CheckRecord>) {
  const current = getCheck(id);
  if (!current) return;
  saveCheck({ ...current, ...patch, updatedAt: new Date().toISOString() });
}

export function removeCheck(id: string) {
  write(read().filter(check => check.id !== id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === accountKey) { cache = null; listener(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useChecks(): CheckRecord[] {
  return useSyncExternalStore(subscribe, read, read);
}

export function useCheck(id: string): CheckRecord | undefined {
  const checks = useChecks();
  return checks.find(check => check.id === id);
}

/** Test helper. */
export function resetCheckStore() {
  cache = null;
  accountKey = `${PREFIX}local`;
  try { window.localStorage.clear(); } catch { /* ignore */ }
}
