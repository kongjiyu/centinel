const prefix = (projectId: string) => 'centinel:project-position:' + sessionStorage.getItem('centinel:supabase-user-id') + ':' + projectId;
const returning = new Set<string>();

export function rememberProjectPosition(projectId: string, element: Element | null) {
  const pane = element?.closest<HTMLElement>('.ck-detail-content');
  const thread = pane?.querySelector<HTMLElement>('.pc-thread');
  if (!pane) return;
  try { sessionStorage.setItem(prefix(projectId), JSON.stringify({ pane: pane.scrollTop, thread: thread?.scrollTop ?? 0 })); } catch { /* optional navigation state */ }
}
export function rememberConversationReturn(projectId: string) { returning.add(prefix(projectId)); }
export function restoreProjectPosition(projectId: string, element: Element | null) {
  const pane = element?.closest<HTMLElement>('.ck-detail-content');
  if (!pane) return false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(prefix(projectId)) ?? 'null');
    if (!saved || !Number.isFinite(saved.pane) || !Number.isFinite(saved.thread)) return false;
    pane.scrollTop = saved.pane;
    const thread = pane.querySelector<HTMLElement>('.pc-thread');
    if (thread) thread.scrollTop = saved.thread;
    sessionStorage.removeItem(prefix(projectId));
    return true;
  } catch { return false; }
}
export function consumeConversationReturn(projectId: string) {
  const key = prefix(projectId);
  const value = returning.has(key);
  returning.delete(key);
  return value;
}
