import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getCheck, saveCheck, updateCheck } from './store';
import type { CheckDocument, CheckRecord } from './types';
import type { ConversationInput, ConversationReference, ConversationRequest } from './conversationTypes';

export type ProblemAttachment = { label: string; reference: ConversationReference };
type SavedCheckAttachment = Pick<CheckRecord, 'id' | 'projectId' | 'projectName' | 'title' | 'mode' | 'phase' | 'reviewId' | 'autoTestId' | 'createdAt' | 'updatedAt'>;
export type ConversationDraft = {
  text: string;
  checkIds: string[];
  checks?: SavedCheckAttachment[];
  problems: ProblemAttachment[];
  requestId?: string;
  requestSignature?: string;
  submittedDraft?: string;
  mode?: CheckRecord['mode'];
  documents?: CheckDocument[];
  sourceIds?: string[];
  replyToTurnId?: string;
};
const projectKey = (projectId: string) => sessionStorage.getItem('centinel:supabase-user-id') + ':' + projectId;
const key = (projectId: string, checkId = '') => 'centinel:conversation-draft:' + projectKey(projectId) + (checkId ? ':check:' + checkId : '');
export function draftContentSignature(draft: ConversationDraft) {
  return JSON.stringify([draft.text, draft.mode, draft.checkIds, draft.problems, draft.documents ?? [], draft.sourceIds ?? [], draft.replyToTurnId]);
}
export { asksForUnscopedReview, conversationApproval, conversationQuestionOptions, isCodeReviewChoice, namedReviewScope, requestsCheckExecution } from '../../../sidecar/src/conversation/intent';
export function eligibleReplySource(request: ConversationRequest, projectId: string, ownerId: string | null) {
  return request.projectId === projectId && request.ownerId === ownerId && request.state === 'completed'
    && typeof request.reply === 'string' && !!request.reply.trim() && request.reply.length <= 6000;
}
export function replyExcerpt(request: ConversationRequest) {
  const plain = (request.reply ?? '').trim()
    .replace(/^#{1,6}\s+/gm, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return plain.length > 136 ? plain.slice(0, 135).trimEnd() + '…' : plain;
}
export function readConversationDraft(projectId: string, checkId?: string): ConversationDraft {
  try {
    const draftKey = key(projectId, checkId);
    return JSON.parse(sessionStorage.getItem(draftKey) ?? localStorage.getItem(draftKey) ?? 'null') ?? { text: '', checkIds: [], problems: [] };
  }
  catch { return { text: '', checkIds: [], problems: [] }; }
}
export function writeConversationDraft(projectId: string, value: ConversationDraft, checkId?: string) {
  const draftKey = key(projectId, checkId);
  const encoded = JSON.stringify(value);
  try { localStorage.setItem(draftKey, encoded); sessionStorage.removeItem(draftKey); }
  catch { try { sessionStorage.setItem(draftKey, encoded); } catch { /* the active composer retains its state */ } }
}
export async function recoverConversationRequest(projectId: string, id: string) {
  if (typeof api.conversationRequest !== 'function') return null;
  try {
    const saved = await api.conversationRequest(projectId, id);
    if (saved?.id !== id || saved.projectId !== projectId) throw new Error('The local service returned an incomplete saved request. Your draft is saved.');
    return saved;
  }
  catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404 && error.message === 'Conversation request unavailable.') return null;
    throw error;
  }
}
export async function sendConversationDraft(projectId: string, input: Omit<ConversationInput, 'id'>, draftId?: string) {
  const scope = projectKey(projectId);
  const current = readConversationDraft(projectId, draftId);
  const requestSignature = JSON.stringify({ focus: input.text, mode: input.mode, permission: input.permission,
    references: input.references, replyToTurnId: input.replyToTurnId ?? null });
  if (current.requestId) {
    const recovered = await recoverConversationRequest(projectId, current.requestId);
    if (recovered) return recovered;
  }
  if (scope !== projectKey(projectId)) throw new Error('Sign in again to send this draft.');
  const id = current.requestSignature === requestSignature && current.requestId ? current.requestId : crypto.randomUUID();
  writeConversationDraft(projectId, { ...readConversationDraft(projectId, draftId), requestId: id, requestSignature,
    submittedDraft: draftContentSignature(current) }, draftId);
  const accepted = await api.sendConversationRequest(projectId, { id, ...input });
  if (accepted?.id !== id || accepted.projectId !== projectId) throw new Error('The local service did not acknowledge the send. Your draft is saved.');
  return accepted;
}
export function acknowledgeConversationDraft(projectId: string, record: ConversationRequest, draftId?: string) {
  rememberAcknowledgedRequest(projectId, record);
  const latest = readConversationDraft(projectId, draftId);
  if (latest.requestId !== record.id) return false;
  const sameDraft = latest.submittedDraft === draftContentSignature(latest);
  writeConversationDraft(projectId, sameDraft ? { text: '', checkIds: [], problems: [], mode: latest.mode }
    : { ...latest, requestId: undefined, requestSignature: undefined, submittedDraft: undefined }, draftId);
  return sameDraft;
}
export function attachConversationCheck(check: CheckRecord, explain = false) {
  if (!check.projectId) return;
  const draft = readConversationDraft(check.projectId, check.id);
  const checkIds = draft.checkIds.includes(check.id) ? draft.checkIds : [...draft.checkIds, check.id];
  const text = explain && !draft.text.trim() ? 'Explain the attached check.' : draft.text;
  if (checkIds === draft.checkIds && text === draft.text) return;
  writeConversationDraft(check.projectId, { ...draft, checkIds, text }, check.id);
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
  const [directlyRefreshed, setDirectlyRefreshed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(typeof api.conversationRequests !== 'function');
  useEffect(() => {
    if (typeof api.conversationRequests !== 'function') return;
    let active = true;
    let known = new Map((acknowledged.get(scope) ?? []).map(record => [record.id, record]));
    let timer: ReturnType<typeof setTimeout>;
    let delay = 2500;
    let historyRetryAt = 0;
    let refreshing = false;
    const mergeKnown = (items: ConversationRequest[]) => {
      for (const item of items) {
        if ((known.get(item.id)?.revision ?? -1) <= item.revision) known.set(item.id, item);
      }
      setRecords([...known.values()]);
    };
    const showAcknowledged = (changed: string) => {
      if (changed !== scope) return;
      mergeKnown(acknowledged.get(scope) ?? []);
      if (historyRetryAt && !refreshing) { clearTimeout(timer); void refresh(); }
    };
    requestListeners.add(showAcknowledged);
    const activeRequests = () => {
      const owner = sessionStorage.getItem('centinel:supabase-user-id');
      return [...known.values()].filter(record => record.ownerId === owner && ['accepted', 'planning', 'awaiting_permission', 'running'].includes(record.state))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    };
    const refresh = async () => {
      refreshing = true;
      try {
        let next: ConversationRequest[] = [];
        if (Date.now() >= historyRetryAt) {
          try {
            next = await api.conversationRequests(projectId);
            if (!active) return;
            delay = 2500;
            historyRetryAt = 0;
          } catch {
            delay = Math.min(delay * 2, 30_000);
            historyRetryAt = Date.now() + delay;
          }
        }
        if (!active) return;
        if (historyRetryAt) {
          setError('Conversation history is temporarily unavailable. Your draft and loaded messages are still here. Current requests can update separately.');
          const results = await Promise.allSettled(activeRequests().slice(0, 3).map(record => recoverConversationRequest(projectId, record.id)));
          if (!active) return;
          next = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
          setDirectlyRefreshed(next.map(record => record.id));
          mergeKnown(next);
        } else {
          const unseen = (acknowledged.get(scope) ?? []).filter(item => !next.some(record => record.id === item.id && record.revision >= item.revision));
          if (unseen.length) acknowledged.set(scope, unseen);
          else acknowledged.delete(scope);
          next = next.map(record => {
            const previous = known.get(record.id);
            return previous && previous.revision > record.revision ? previous : record;
          });
          known = new Map(next.map(record => [record.id, record]));
          mergeKnown(unseen);
          setDirectlyRefreshed([]);
          setError(null);
        }
        for (const record of next) {
          if (!record.reviewId && !record.autoTestId) continue;
          const checkId = 'request-' + record.id;
          const existing = getCheck(checkId);
          const mode = record.action === 'code' ? 'code' : 'browser';
          const requestedMode = record.fallbackReason ? 'both' : undefined;
          if (existing) {
            if (existing.mode !== mode || existing.reviewId !== record.reviewId || existing.autoTestId !== record.autoTestId || existing.requestedMode !== requestedMode) {
              updateCheck(checkId, { mode, requestedMode, reviewId: record.reviewId, autoTestId: record.autoTestId,
                ...(record.reviewId && existing.reviewId !== record.reviewId ? { phase: 'running', finishedAt: undefined } : {}) });
            }
            continue;
          }
          saveCheck({ id: checkId, projectId, projectName,
            createdAt: record.createdAt, updatedAt: record.updatedAt, focus: record.input.text, mode, requestedMode,
            phase: 'running', notes: [], documents: [], reviewId: record.reviewId, autoTestId: record.autoTestId });
          if (typeof api.generateCheckTitle === 'function') {
            void api.generateCheckTitle(projectId, { focus: record.input.text, mode: record.action === 'code' ? 'code' : 'browser', documents: [] })
              .then(({ title }) => { if (title) updateCheck(checkId, { title }); }).catch(() => undefined);
          }
        }
      } catch {
        if (active) setError('Conversation status could not be refreshed. Your draft and loaded messages are still here.');
      } finally {
        refreshing = false;
        if (active) {
          setLoaded(true);
          const wait = historyRetryAt && !activeRequests().length ? Math.max(2500, historyRetryAt - Date.now()) : 2500;
          timer = setTimeout(refresh, wait);
        }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); requestListeners.delete(showAcknowledged); };
  }, [scope, projectId, projectName]);
  return { records, error, loaded, directlyRefreshed };
}
