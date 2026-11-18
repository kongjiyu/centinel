import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getCheck, saveCheck, updateCheck } from './store';
import type { CheckDocument, CheckRecord } from './types';
import type { ConversationReference, ConversationRequest } from './conversationTypes';

export type ProblemAttachment = { label: string; reference: ConversationReference };
export type ConversationDraft = { text: string; checkIds: string[]; problems: ProblemAttachment[]; requestId?: string; requestSignature?: string; mode?: 'code' | 'browser' | 'both'; documents?: CheckDocument[]; sourceIds?: string[] };
const projectKey = (projectId: string) => sessionStorage.getItem('centinel:supabase-user-id') + ':' + projectId;
const key = (projectId: string, checkId = '') => 'centinel:conversation-draft:' + projectKey(projectId) + (checkId ? ':check:' + checkId : '');
export function draftContentSignature(draft: ConversationDraft) {
  return JSON.stringify([draft.text, draft.mode, draft.checkIds, draft.problems, draft.documents ?? [], draft.sourceIds ?? []]);
}
export function readConversationDraft(projectId: string, checkId?: string): ConversationDraft {
  try { return JSON.parse(sessionStorage.getItem(key(projectId, checkId)) ?? 'null') ?? { text: '', checkIds: [], problems: [] }; }
  catch { return { text: '', checkIds: [], problems: [] }; }
}
export function writeConversationDraft(projectId: string, value: ConversationDraft, checkId?: string) {
  try { sessionStorage.setItem(key(projectId, checkId), JSON.stringify(value)); } catch { /* the active composer retains its state */ }
}
export function attachConversationCheck(check: CheckRecord) {
  if (!check.projectId) return;
  const draft = readConversationDraft(check.projectId, check.id);
  if (draft.checkIds.includes(check.id)) return;
  writeConversationDraft(check.projectId, { ...draft, checkIds: [...draft.checkIds, check.id] }, check.id);
}
export function checkReference(check: CheckRecord): ConversationReference {
  return { ...(check.reviewId ? { reviewId: check.reviewId } : {}), ...(check.autoTestId ? { autoTestId: check.autoTestId } : {}) };
}
// Bridge the acknowledged POST and the first history poll, keyed by account and project.
const acknowledged = new Map<string, ConversationRequest[]>();
const requestListeners = new Set<(scope: string) => void>();
export function rememberAcknowledgedRequest(projectId: string, request: ConversationRequest) {
  const scope = projectKey(projectId);
  acknowledged.set(scope, [...(acknowledged.get(scope) ?? []).filter(item => item.id !== request.id), request].slice(-50));
  requestListeners.forEach(listener => listener(scope));
}
export function useConversationRequests(projectId: string, projectName: string) {
  const scope = projectKey(projectId);
  const [records, setRecords] = useState<ConversationRequest[]>(() => acknowledged.get(scope) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(typeof api.conversationRequests !== 'function');
  useEffect(() => {
    if (typeof api.conversationRequests !== 'function') return;
    let active = true;
    const showAcknowledged = (changed: string) => {
      if (changed !== scope) return;
      setRecords(current => [...current, ...(acknowledged.get(scope) ?? []).filter(item => !current.some(record => record.id === item.id))]);
    };
    requestListeners.add(showAcknowledged);
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api.conversationRequests(projectId);
        if (!active) return;
        const unseen = (acknowledged.get(scope) ?? []).filter(item => !next.some(record => record.id === item.id));
        if (unseen.length) acknowledged.set(scope, unseen);
        else acknowledged.delete(scope);
        setRecords([...next, ...unseen]); setError(null);
        for (const record of next) {
          if ((!record.reviewId && !record.autoTestId) || getCheck('request-' + record.id)) continue;
          const checkId = 'request-' + record.id;
          saveCheck({ id: checkId, projectId, projectName,
            createdAt: record.createdAt, updatedAt: record.updatedAt, focus: record.input.text, mode: record.action === 'code' ? 'code' : 'browser',
            phase: 'running', notes: [], documents: [], reviewId: record.reviewId, autoTestId: record.autoTestId });
          if (typeof api.generateCheckTitle === 'function') {
            void api.generateCheckTitle(projectId, { focus: record.input.text, mode: record.action === 'code' ? 'code' : 'browser', documents: [] })
              .then(({ title }) => { if (title) updateCheck(checkId, { title }); }).catch(() => undefined);
          }
        }
      } catch { if (active) setError('The conversation could not be refreshed. Your draft is saved.'); }
      if (active) { setLoaded(true); timer = setTimeout(refresh, 2500); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); requestListeners.delete(showAcknowledged); };
  }, [scope, projectId, projectName]);
  return { records, error, loaded };
}
