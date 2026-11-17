import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import type { CheckRecord } from '../../check/types';

export function rankMentionChecks(checks: CheckRecord[], limit = 5) {
  return [...checks].sort((a, b) => (b.problemCount ?? -1) - (a.problemCount ?? -1)
    || (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt)).slice(0, limit);
}

export function rankMentionProjects(projects: Project[], checks: CheckRecord[], query: string, limit = 5, includeUnchecked = false) {
  const latest = new Map<string, string>();
  for (const check of checks) {
    if (!check.projectId || check.phase !== 'done') continue;
    const date = check.finishedAt ?? check.createdAt;
    if (date > (latest.get(check.projectId) ?? '')) latest.set(check.projectId, date);
  }
  return projects.filter(project => query ? project.name.toLowerCase().includes(query) : includeUnchecked || latest.has(project.id))
    .sort((a, b) => (latest.get(b.id) ?? '').localeCompare(latest.get(a.id) ?? '')).slice(0, limit);
}

/** Keep typing focus in the textarea while the menu has an active action. */
export function useMentionSelection(menu: { current: HTMLElement | null }, query: string | undefined) {
  const [index, setIndex] = useState(0);
  const buttons = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    if (query === undefined) return;
    const items = buttons();
    const selected = items[index] ?? items[0];
    items.forEach(item => item.toggleAttribute('data-mention-active', item === selected));
    if (index) selected?.scrollIntoView?.({ block: 'nearest' });
    return () => items.forEach(item => item.removeAttribute('data-mention-active'));
  });
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query === undefined || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
    const items = buttons();
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return false;
    event.preventDefault();
    event.stopPropagation();
    const current = index < items.length ? index : 0;
    if (event.key === 'Enter') items[current].click();
    else setIndex((current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    return true;
  };
}
