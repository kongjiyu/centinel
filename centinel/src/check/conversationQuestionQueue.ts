import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { readPrefs } from './projectPrefs';
import type { ConversationQuestion, ConversationRequest } from './conversationTypes';
import type { Project, Screen } from '../types';

type PendingQuestion = { request: ConversationRequest; question: ConversationQuestion };
type TimerState = { key: string; initialDeadline: number; countdownDeadline?: number; cancelled: boolean; submitted: boolean; updatedAt: number };
type Countdown = { projectId: string; deadlineAt: number; progress: number };
const TIMER_STORAGE_PREFIX = 'centinel:conversation-question-timers:';
const MAX_TIMER_RECORDS = 100;

function questionFor(request: ConversationRequest): ConversationQuestion | undefined {
  if (!request.pendingQuestionId) return undefined;
  return request.questions?.find(question => question.id === request.pendingQuestionId && !question.answer);
}

function timerKey(item: PendingQuestion, accountId?: string | null) {
  return `${accountId ?? ''}:${item.request.projectId}:${item.request.id}:${item.question.id}`;
}

function readTimerStates(accountId?: string | null): Map<string, TimerState> {
  if (!accountId) return new Map<string, TimerState>();
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_PREFIX + accountId);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const states = new Map<string, TimerState>();
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const state = value as Partial<TimerState>;
      if (state.key !== key || !Number.isFinite(state.initialDeadline) || typeof state.cancelled !== 'boolean'
        || typeof state.submitted !== 'boolean' || !Number.isFinite(state.updatedAt)
        || state.countdownDeadline !== undefined && !Number.isFinite(state.countdownDeadline)) continue;
      states.set(key, state as TimerState);
    }
    return states;
  } catch { return new Map(); }
}

function writeTimerStates(accountId: string | null | undefined, states: Map<string, TimerState>) {
  if (!accountId) return;
  try {
    const bounded = [...states.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_TIMER_RECORDS);
    if (!bounded.length) localStorage.removeItem(TIMER_STORAGE_PREFIX + accountId);
    else localStorage.setItem(TIMER_STORAGE_PREFIX + accountId, JSON.stringify(Object.fromEntries(bounded.map(state => [state.key, state]))));
  } catch { /* local timer persistence is optional */ }
}

function persistTimerState(accountId: string | null | undefined, state: TimerState) {
  const states = readTimerStates(accountId);
  states.set(state.key, state);
  writeTimerStates(accountId, states);
}

function pruneTimerStates(accountId: string | null | undefined, activeKeys: Set<string>) {
  if (!accountId) return;
  const states = readTimerStates(accountId);
  for (const key of states.keys()) if (!activeKeys.has(key)) states.delete(key);
  writeTimerStates(accountId, states);
}

function currentWindowIsActive(projectId: string, enabled: boolean, screen: Screen) {
  if (!enabled || screen.name !== 'project' || screen.projectId !== projectId || typeof document === 'undefined') return false;
  return document.visibilityState !== 'hidden' && (typeof document.hasFocus !== 'function' || document.hasFocus());
}

export function useConversationQuestionQueue(projects: Project[], screen: Screen, enabled: boolean, accountId?: string | null) {
  const [records, setRecords] = useState<ConversationRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [countdown, setCountdown] = useState<Countdown>();
  const timerRef = useRef<TimerState | null>(null);
  const queueRef = useRef<PendingQuestion[]>([]);
  const screenRef = useRef(screen);
  const enabledRef = useRef(enabled);
  screenRef.current = screen;
  enabledRef.current = enabled;

  const projectIds = useMemo(() => projects.map(project => project.id), [projects]);
  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      setLoaded(false);
      timerRef.current = null;
      setCountdown(undefined);
      return;
    }
    let active = true;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 2500;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        if (!projectIds.length) {
          setLoaded(true);
          return;
        }
        const batches: string[][] = [];
        for (let index = 0; index < projectIds.length; index += 100) batches.push(projectIds.slice(index, index + 100));
        const pages = await Promise.all(batches.map(batch => api.pendingConversationQuestions(batch)));
        if (!active) return;
        const incoming = new Map(pages.flat().map(record => [record.id, record]));
        const synchronized = [...incoming.values()];
        setRecords(current => synchronized.map(record => {
          const old = current.find(item => item.id === record.id);
          return old && old.revision > record.revision ? old : record;
        }));
        const activeKeys = new Set(synchronized.flatMap(record => {
          const question = questionFor(record);
          return question ? [timerKey({ request: record, question }, accountId)] : [];
        }));
        pruneTimerStates(accountId, activeKeys);
        delay = 2500;
        setLoaded(true);
      } catch {
        delay = Math.min(delay * 2, 30_000);
        setLoaded(true);
      } finally {
        running = false;
        if (active) timer = setTimeout(refresh, delay);
      }
    };
    setLoaded(false);
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [accountId, enabled, projectIds]);

  const queue = useMemo(() => records.filter(request => !!accountId && request.ownerId === accountId).flatMap(request => {
    const question = questionFor(request);
    return question ? [{ request, question }] : [];
  }).sort((left, right) => left.question.createdAt.localeCompare(right.question.createdAt)
    || left.request.createdAt.localeCompare(right.request.createdAt) || left.request.id.localeCompare(right.request.id)), [accountId, records]);
  queueRef.current = queue;
  const head = queue[0];
  const headKey = head ? timerKey(head, accountId) : undefined;

  useEffect(() => {
    if (!head || !headKey) {
      timerRef.current = null;
      setCountdown(undefined);
      return;
    }
    if (timerRef.current?.key !== headKey) {
      const existing = readTimerStates(accountId).get(headKey);
      const state = existing ?? { key: headKey, initialDeadline: Date.now() + 5_000, cancelled: false, submitted: false, updatedAt: Date.now() };
      timerRef.current = state;
      persistTimerState(accountId, state);
      setCountdown(undefined);
    }
  }, [accountId, headKey]);

  const acceptUpdatedRequest = useCallback((updated: ConversationRequest) => {
    setRecords(current => {
      const next = current.filter(item => item.id !== updated.id);
      if (questionFor(updated)) next.push(updated);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const updateTimer = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      const activeHead = queueRef.current[0];
      if (!activeHead) { setCountdown(undefined); return; }
      const key = timerKey(activeHead, accountId);
      let state = timerRef.current;
      if (!state || state.key !== key) {
        state = readTimerStates(accountId).get(key) ?? { key, initialDeadline: timestamp + 5_000, cancelled: false, submitted: false, updatedAt: timestamp };
        timerRef.current = state;
        persistTimerState(accountId, state);
      }
      const inProject = currentWindowIsActive(activeHead.request.projectId, enabledRef.current, screenRef.current);
      if (state.countdownDeadline !== undefined && !state.cancelled && !state.submitted
        && timestamp >= state.countdownDeadline && activeHead.question.options.length) {
        state.submitted = true;
        state.updatedAt = timestamp;
        persistTimerState(accountId, state);
        setCountdown(undefined);
        void api.answerConversationQuestion(activeHead.request.projectId, activeHead.request.id, {
          revision: activeHead.request.revision,
          questionId: activeHead.question.id,
          answer: { kind: 'option', selectedOption: 0 },
          automatic: true,
          askFirst: readPrefs(activeHead.request.projectId).mode === 'ask',
        }).then(acceptUpdatedRequest).catch(() => undefined);
      } else if (state.countdownDeadline !== undefined && inProject && !state.submitted) {
        state.countdownDeadline = undefined;
        state.cancelled = true;
        state.updatedAt = timestamp;
        persistTimerState(accountId, state);
      } else if (!state.cancelled && state.countdownDeadline === undefined && activeHead.question.options.length
        && timestamp >= state.initialDeadline && !inProject) {
        state.countdownDeadline = timestamp + 10_000;
        state.updatedAt = timestamp;
        persistTimerState(accountId, state);
      }
      if (state.countdownDeadline !== undefined) {
        const remaining = Math.max(0, state.countdownDeadline - timestamp);
        if (state.submitted) setCountdown(undefined);
        else setCountdown({ projectId: activeHead.request.projectId, deadlineAt: state.countdownDeadline, progress: Math.min(1, remaining / 10_000) });
      } else setCountdown(undefined);
    };
    const timer = setInterval(updateTimer, 200);
    window.addEventListener('focus', updateTimer);
    window.addEventListener('blur', updateTimer);
    document.addEventListener('visibilitychange', updateTimer);
    updateTimer();
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', updateTimer);
      window.removeEventListener('blur', updateTimer);
      document.removeEventListener('visibilitychange', updateTimer);
    };
  }, [accountId, enabled, acceptUpdatedRequest]);

  const pendingProjects = useMemo(() => new Set(queue.map(item => item.request.projectId)), [queue]);
  const activeCountdown = countdown && head && countdown.projectId === head.request.projectId ? countdown : undefined;
  return {
    loaded,
    head,
    pendingProjects,
    countdown: activeCountdown,
    secondsRemaining: activeCountdown ? Math.max(0, Math.ceil((activeCountdown.deadlineAt - now) / 1000)) : undefined,
    acceptUpdatedRequest,
  };
}
