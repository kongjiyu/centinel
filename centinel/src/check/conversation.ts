import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { getCheck, saveCheck, updateCheck } from './store';
import type { CheckDocument, CheckRecord } from './types';
import type { ConversationInput, ConversationReference, ConversationRequest } from './conversationTypes';

export type ProblemAttachment = { label: string; reference: ConversationReference };
type SavedCheckAttachment = Pick<CheckRecord, 'id' | 'projectId' | 'projectName' | 'title' | 'mode' | 'phase' | 'reviewId' | 'autoTestId' | 'createdAt' | 'updatedAt'> & { focus?: string };
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
const HISTORY_PAGE_SIZE = 10;
export function draftContentSignature(draft: ConversationDraft) {
  return JSON.stringify([draft.text, draft.mode, draft.checkIds, draft.problems, draft.documents ?? [], draft.sourceIds ?? [], draft.replyToTurnId]);
}
export { asksForProjectStatus, asksForUnscopedBrowserCheck, asksForUnscopedReview, conversationApproval, conversationQuestionOptions, isCodeReviewChoice, namedReviewScope, requestsFullCheck } from '../../../sidecar/src/conversation/intent';
export function eligibleReplySource(request: ConversationRequest, projectId: string, ownerId: string | null) {
  return request.projectId === projectId && request.ownerId === ownerId && request.state === 'completed'
    && typeof request.reply === 'string' && !!request.reply.trim() && request.reply.length <= 6000;
}
function replyText(request: ConversationRequest) {
  return (request.executionReply ?? request.reply ?? '').trim();
}
function isMarkdownReply(request: ConversationRequest) {
  return request.executionReply === undefined && request.replyFormat === 'markdown';
}
export function replyExcerpt(request: ConversationRequest) {
  const text = replyText(request);
  const plain = (isMarkdownReply(request) ? text.split(/\r?\n/, 1)[0]
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+\.)\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|\x60)(\S(?:.*?\S)?)\1/g, '$2') : text).replace(/\s+/g, ' ').trim();
  return plain.length > 136 ? plain.slice(0, 135).trimEnd() + '…' : plain;
}
export async function loadConversationReplySource(projectId: string, turnId: string, ownerId: string | null) {
  if (!ownerId || sessionStorage.getItem('centinel:supabase-user-id') !== ownerId || typeof api.conversationRequest !== 'function') return null;
  const saved = await api.conversationRequest(projectId, turnId);
  if (sessionStorage.getItem('centinel:supabase-user-id') !== ownerId || saved?.id !== turnId
    || !eligibleReplySource(saved, projectId, ownerId)) return null;
  return { excerpt: replyExcerpt(saved), full: replyText(saved), markdown: isMarkdownReply(saved) };
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
  const children = { ...(check.reviewId ? { reviewId: check.reviewId } : {}), ...(check.autoTestId ? { autoTestId: check.autoTestId } : {}) };
  if (!check.reviewId && !check.autoTestId) return children;
  const focus = check.focus?.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 240);
  return { ...children, checkId: check.id, ...(focus ? { checkFocus: focus } : {}) };
}

export function mentionedCheckCandidates(text: string, checks: CheckRecord[], previous?: ConversationRequest, previousCheck?: CheckRecord) {
  const target = /\b(that|this|the last|the latest|previous)\s+(?:saved\s+)?check\b/i.exec(text)?.[1].toLowerCase();
  const indirect = !target && /\bits\s+(?:objective|scope|findings|results?|verdict)\b/i.test(text);
  if (!target && !indirect) return [];
  const available = checks.filter(check => check.reviewId || check.autoTestId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (target === 'the last' || target === 'the latest') return available.slice(0, 1);
  if (previousCheck && available.some(check => check.id === previousCheck.id)) return [previousCheck];
  if (previous) {
    const references: ConversationReference[] = [...previous.input.references, { reviewId: previous.reviewId, autoTestId: previous.autoTestId }];
    const matches = available.filter(check => references.some(reference =>
      (reference.checkId && reference.checkId === check.id)
      || (!reference.findingId && !reference.testId
        && ((reference.reviewId && reference.reviewId === check.reviewId) || (reference.autoTestId && reference.autoTestId === check.autoTestId)))));
    if (matches.length === 1) return matches;
  }
  return indirect ? [] : available;
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
  const [recordState, setRecordState] = useState<{ scope: string; items: ConversationRequest[] }>(() => ({ scope, items: acknowledged.get(scope) ?? [] }));
  const [errorState, setErrorState] = useState<{ scope: string; value: string | null }>({ scope, value: null });
  const [directState, setDirectState] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
  const [loadedState, setLoadedState] = useState<{ scope: string; value: boolean }>({ scope, value: typeof api.conversationRequests !== 'function' });
  const [older, setOlder] = useState<{ scope: string; items: ConversationRequest[]; exhausted: boolean }>({ scope, items: [], exhausted: false });
  const [pageStatus, setPageStatus] = useState<{ scope: string; paging: boolean; error: boolean }>({ scope, paging: false, error: false });
  const [firstPageHasOlder, setFirstPageHasOlder] = useState<{ scope: string; value: boolean }>({ scope, value: false });
  const [retryVersion, setRetryVersion] = useState(0);
  const pagingKey = useRef<string | null>(null);
  const records = recordState.scope === scope ? recordState.items : acknowledged.get(scope) ?? [];
  const error = errorState.scope === scope ? errorState.value : null;
  const directlyRefreshed = directState.scope === scope ? directState.ids : [];
  const loaded = loadedState.scope === scope ? loadedState.value : typeof api.conversationRequests !== 'function';
  const paging = pageStatus.scope === scope && pageStatus.paging;
  const pageError = pageStatus.scope === scope && pageStatus.error;
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
      setRecordState({ scope, items: [...known.values()] });
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
            next = await api.conversationRequests(projectId, undefined, HISTORY_PAGE_SIZE);
            if (!active) return;
            delay = 2500;
            historyRetryAt = 0;
            setFirstPageHasOlder({ scope, value: next.length >= HISTORY_PAGE_SIZE });
          } catch {
            delay = Math.min(delay * 2, 30_000);
            historyRetryAt = Date.now() + delay;
          }
        }
        if (!active) return;
        if (historyRetryAt) {
          setErrorState({ scope, value: 'Conversation history is temporarily unavailable. Your draft and loaded messages are still here. Current requests can update separately.' });
          const results = await Promise.allSettled(activeRequests().slice(0, 3).map(record => recoverConversationRequest(projectId, record.id)));
          if (!active) return;
          next = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
          setDirectState({ scope, ids: next.map(record => record.id) });
          mergeKnown(next);
        } else {
          const unseen = (acknowledged.get(scope) ?? []).filter(item => !next.some(record => record.id === item.id && record.revision >= item.revision));
          if (unseen.length) acknowledged.set(scope, unseen);
          else acknowledged.delete(scope);
          next = next.map(record => {
            const previous = known.get(record.id);
            return previous && previous.revision > record.revision ? previous : record;
          });
          mergeKnown([...next, ...unseen]);
          setDirectState({ scope, ids: [] });
          setErrorState({ scope, value: null });
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
        if (active) setErrorState({ scope, value: 'Conversation status could not be refreshed. Your draft and loaded messages are still here.' });
      } finally {
        refreshing = false;
        if (active) {
          setLoadedState({ scope, value: true });
          const wait = historyRetryAt && !activeRequests().length ? Math.max(2500, historyRetryAt - Date.now()) : 2500;
          timer = setTimeout(refresh, wait);
        }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); requestListeners.delete(showAcknowledged); };
  }, [scope, projectId, projectName, retryVersion]);
  const olderItems = older.scope === scope ? older.items : [];
  const unique = new Map<string, ConversationRequest>();
  for (const record of [...olderItems, ...records]) {
    const previous = unique.get(record.id);
    if (!previous || previous.revision <= record.revision) unique.set(record.id, record);
  }
  const newestFirst = [...unique.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const canLoadOlder = firstPageHasOlder.scope === scope && firstPageHasOlder.value && (older.scope !== scope || !older.exhausted);
  const loadOlder = async () => {
    const cursor = newestFirst.at(-1);
    const requestKey = cursor ? `${scope}:${cursor.id}` : '';
    if (!cursor || !canLoadOlder || !api.conversationRequests || pagingKey.current === requestKey) return [];
    pagingKey.current = requestKey;
    setPageStatus({ scope, paging: true, error: false });
    try {
      const page = await api.conversationRequests(projectId, cursor.id, HISTORY_PAGE_SIZE);
      if (scope === projectKey(projectId)) {
        const merged = new Map(olderItems.map(item => [item.id, item]));
        for (const item of page) {
          const previous = merged.get(item.id);
          if (!previous || previous.revision <= item.revision) merged.set(item.id, item);
        }
        setOlder({ scope, items: [...merged.values()], exhausted: page.length < HISTORY_PAGE_SIZE });
        setPageStatus({ scope, paging: false, error: false });
        return page;
      }
      return [];
    } catch {
      if (scope === projectKey(projectId)) setPageStatus({ scope, paging: false, error: true });
      return [];
    } finally {
      if (pagingKey.current === requestKey) pagingKey.current = null;
      if (scope === projectKey(projectId)) setPageStatus(current => current.scope === scope ? { ...current, paging: false } : current);
    }
  };
  return { records: newestFirst, error, loaded, directlyRefreshed, canLoadOlder, loadOlder, paging, pageError,
    retryHistory: () => setRetryVersion(value => value + 1) };
}
