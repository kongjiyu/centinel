import type { Screen } from '../types';

/**
 * Screen <-> URL hash mapping so Back/Forward, reload and copied links keep the
 * current page. Only hashes starting with "#/" are routes; any other hash (for
 * example an OAuth callback fragment or an in-page anchor) is left untouched.
 */

const SCREEN_NAMES = new Set<Screen['name']>([
  'dashboard', 'projects', 'project-detail', 'review-entry', 'review-activity', 'dynamic-testing',
  'dynamic-session', 'evidence-browser', 'requirements', 'review-playground', 'settings', 'help', 'profile',
]);

/** One-shot entry actions must not repeat when a page is reloaded or revisited. */
const TRANSIENT_KEYS = new Set(['initialCreate', 'initialAction']);

export function screenToHash(screen: Screen): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(screen)) {
    if (key === 'name' || value === undefined || value === null || TRANSIENT_KEYS.has(key)) continue;
    params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const query = params.toString();
  return `#/${screen.name}${query ? `?${query}` : ''}`;
}

export function isRouteHash(hash: string): boolean {
  return hash.startsWith('#/');
}

export function hashToScreen(hash: string): Screen | null {
  if (!isRouteHash(hash)) return null;
  const [path, query = ''] = hash.slice(2).split('?', 2);
  const name = decodeURIComponent(path) as Screen['name'];
  if (!SCREEN_NAMES.has(name)) return null;
  const screen: Record<string, unknown> = { name };
  for (const [key, raw] of new URLSearchParams(query)) {
    if (TRANSIENT_KEYS.has(key)) continue;
    if (raw === 'true' || raw === 'false') screen[key] = raw === 'true';
    else if (raw.startsWith('{')) {
      try { screen[key] = JSON.parse(raw); } catch { return null; }
    } else screen[key] = raw;
  }
  const needsProject = ['project-detail', 'review-activity', 'dynamic-session', 'evidence-browser', 'requirements'].includes(name);
  if (needsProject && typeof screen.projectId !== 'string') return null;
  if ((name === 'review-activity' || name === 'dynamic-session') && typeof screen.sessionId !== 'string') return null;
  return screen as Screen;
}
