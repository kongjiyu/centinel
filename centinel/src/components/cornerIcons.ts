import { createLucideIcon } from 'lucide-react';

/**
 * Two-corner glyphs for the project side panel (user-chosen, 14 Nov 2026):
 * corners pointing out to fill the screen, corners pointing in to return.
 * Drawn on lucide's 24-unit grid so they size and align like every other icon.
 */
export const CornersOut = createLucideIcon('corners-out', [
  ['path', { d: 'M14 4h6v6', key: 'tr' }],
  ['path', { d: 'M4 14v6h6', key: 'bl' }],
]);

export const CornersIn = createLucideIcon('corners-in', [
  ['path', { d: 'M20 10h-6V4', key: 'tr' }],
  ['path', { d: 'M10 20v-6H4', key: 'bl' }],
]);
