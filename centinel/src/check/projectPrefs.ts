import { useSyncExternalStore } from 'react';

/**
 * Per-project conversation preferences on this device (DESIGN.md §4.4, §4.5):
 * the permission mode and conversation notes
 * (mode changes, the test-account reminder), and whether the side panel is open. Test definitions themselves stay in
 * the saved Auto test sessions; this keeps only references.
 */
export type PermissionMode = 'ask' | 'auto' | 'bypass';
export type ConversationNote = { id: string; at: string; text: string };
export type ProjectPrefs = { mode: PermissionMode; notes: ConversationNote[]; accountReminderShown: boolean; sideOpen: boolean };

const PREFIX = 'centinel:project-prefs:';
const EMPTY: ProjectPrefs = { mode: 'auto', notes: [], accountReminderShown: false, sideOpen: false };
const listeners = new Set<() => void>();
const cache = new Map<string, ProjectPrefs>();

export const MODE_LABEL: Record<PermissionMode, string> = { ask: 'Ask first', auto: 'Auto', bypass: 'Bypass' };

export function readPrefs(projectId: string): ProjectPrefs {
  const cached = cache.get(projectId);
  if (cached) return cached;
  let value = EMPTY;
  try {
    const raw = window.localStorage.getItem(PREFIX + projectId);
    const parsed = raw ? JSON.parse(raw) as Partial<ProjectPrefs> : {};
    value = {
      mode: parsed.mode === 'ask' || parsed.mode === 'bypass' ? parsed.mode : 'auto',
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter(item => item && typeof item.text === 'string').slice(-100) : [],
      accountReminderShown: parsed.accountReminderShown === true,
      sideOpen: parsed.sideOpen === true,
    };
  } catch { /* storage is optional */ }
  cache.set(projectId, value);
  return value;
}

export function updatePrefs(projectId: string, change: (current: ProjectPrefs) => ProjectPrefs) {
  const next = change(readPrefs(projectId));
  cache.set(projectId, next);
  try { window.localStorage.setItem(PREFIX + projectId, JSON.stringify(next)); } catch { /* storage is optional */ }
  listeners.forEach(listener => listener());
}

const noteId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export function addNote(projectId: string, text: string) {
  updatePrefs(projectId, current => ({ ...current, notes: [...current.notes, { id: noteId(), at: new Date().toISOString(), text }].slice(-100) }));
}

export function setMode(projectId: string, mode: PermissionMode) {
  if (readPrefs(projectId).mode === mode) return;
  updatePrefs(projectId, current => ({ ...current, mode }));
  addNote(projectId, `Permission mode changed to ${MODE_LABEL[mode]}.`);
}

/** Whether the project side panel shows the whole project (true) or only the latest check. */
export function setSideOpen(projectId: string, open: boolean) {
  updatePrefs(projectId, current => ({ ...current, sideOpen: open }));
}

/** A message that probably contains an account and password (shown once per project). */
export function looksLikeAccount(text: string) {
  return /\S+@\S+\.\S+/.test(text) && /(password|passwd|pwd|密码|\/\s*\S+|:\s*\S+)/i.test(text);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useProjectPrefs(projectId: string): ProjectPrefs {
  return useSyncExternalStore(subscribe, () => readPrefs(projectId), () => readPrefs(projectId));
}

/** Test helper. */
export function resetProjectPrefs() {
  cache.clear();
}
