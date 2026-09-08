import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Project } from '../types';

/** Local-only preference key. Pins are deliberately not part of the sidecar API. */
export const PINNED_PROJECTS_STORAGE_KEY = 'centinel:pinned-project-ids';

const listeners = new Set<() => void>();
let cachedStorageValue: string | null | undefined;
let cachedSnapshot: string[] = [];
let inMemoryOnly = false;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  } catch {
    return [];
  }
}

function readSnapshot(): string[] {
  if (inMemoryOnly) return cachedSnapshot;
  let current: string | null = null;
  try {
    current = storage()?.getItem(PINNED_PROJECTS_STORAGE_KEY) ?? null;
  } catch {
    inMemoryOnly = true;
    return cachedSnapshot;
  }
  if (current === cachedStorageValue) return cachedSnapshot;
  cachedStorageValue = current;
  cachedSnapshot = parseIds(current);
  return cachedSnapshot;
}

function notify() {
  listeners.forEach(listener => listener());
}

function writeSnapshot(ids: string[]) {
  const normalized = Array.from(new Set(ids.filter(id => typeof id === 'string' && id.trim().length > 0)));
  const next = JSON.stringify(normalized);
  const localStorage = storage();
  try {
    if (!localStorage) inMemoryOnly = true;
    else {
      localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, next);
      inMemoryOnly = false;
    }
  } catch {
    // Private browsing and restricted webviews can deny localStorage. The
    // in-memory snapshot still makes the current session usable.
    inMemoryOnly = true;
  }
  cachedStorageValue = inMemoryOnly ? null : next;
  cachedSnapshot = normalized;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === 'undefined') return () => { listeners.delete(listener); };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== PINNED_PROJECTS_STORAGE_KEY && event.key !== null) return;
    inMemoryOnly = false;
    cachedStorageValue = undefined;
    readSnapshot();
    notify();
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

function getServerSnapshot() {
  return [] as string[];
}

/**
 * Read and mutate the user's local pinned-project preference.
 *
 * The store is shared between hook instances because AppShell and the
 * Projects directory both need to react immediately to a pin change made in
 * the same webview. IDs are ordered by the user's pin action, not by project
 * update time.
 */
export function usePinnedProjects(projects: Project[]) {
  const storedIds = useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
  const validIds = useMemo(
    () => storedIds.filter(id => projects.some(project => project.id === id)),
    [projects, storedIds],
  );

  useEffect(() => {
    if (validIds.length !== storedIds.length || validIds.some((id, index) => id !== storedIds[index])) {
      writeSnapshot(validIds);
    }
  }, [storedIds, validIds]);

  const isPinned = useCallback((projectId: string) => validIds.includes(projectId), [validIds]);
  const togglePin = useCallback((projectId: string) => {
    const current = readSnapshot();
    writeSnapshot(current.includes(projectId)
      ? current.filter(id => id !== projectId)
      : [...current, projectId]);
  }, []);

  const pinnedProjects = useMemo(() => validIds
    .map(id => projects.find(project => project.id === id))
    .filter((project): project is Project => Boolean(project)), [projects, validIds]);

  return { pinnedIds: validIds, pinnedProjects, isPinned, togglePin };
}
