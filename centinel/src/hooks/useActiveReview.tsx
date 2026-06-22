import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import type { Finding, ReviewProgress, StaticSession } from '../types';
import {
  ActiveReviewContext,
  type ActiveReviewSnapshot,
  type ActiveReviewState,
  type ActiveReviewControls,
} from '../context/ActiveReviewContext';

const POLL_INTERVAL_MS = 1000;
const AUTO_DISMISS_MS = 5 * 60 * 1000; // 5 min after success
const FAILURE_DISMISS_MS = 30 * 1000;  // 30s after failure/cancelled
const MAX_CONSECUTIVE_FAILURES = 3;

function emptyProgress(): ReviewProgress {
  return {
    currentStage: 'understanding_context',
    stages: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadSnapshot(session: StaticSession, projectName: string): Promise<ActiveReviewSnapshot> {
  let progress: ReviewProgress = emptyProgress();
  try {
    if (session.progressJson && session.progressJson !== '{}') {
      progress = JSON.parse(session.progressJson);
    }
  } catch {
    progress = emptyProgress();
  }

  let findings: Finding[] = [];
  if (session.status === 'success') {
    try { findings = await api.listStaticFindings(session.projectId, session.id); } catch {}
  }

  return {
    id: session.id,
    projectId: session.projectId,
    projectName,
    name: session.name,
    reviewType: session.reviewType,
    status: session.status,
    progress,
    findings,
    finalSummary: session.finalSummary,
    failureReason: session.failureReason,
    createdAt: session.createdAt,
  };
}

export function useActiveReview() {
  const [state, setState] = useState<ActiveReviewState | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const completedAtRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);
  const projectNamesRef = useRef<Map<string, string>>(new Map());
  const stateRef = useRef<ActiveReviewState | null>(state);
  stateRef.current = state;

  const controls: ActiveReviewControls = {
    setExpanded: (expanded) => setState(prev => prev ? { ...prev, expanded } : prev),
    setDismissed: (dismissed) => setState(prev => prev ? { ...prev, dismissed } : prev),
    retry: () => { setConnectionLost(false); setRetryTick(t => t + 1); },
  };

  const runOnce = useCallback(async (): Promise<{ ok: boolean; active: StaticSession[] }> => {
    try {
      const active = await api.listActiveStaticSessions();
      return { ok: true, active };
    } catch {
      return { ok: false, active: [] };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    let consecutiveFailures = 0;

    const handleResult = async (ok: boolean, active: StaticSession[]) => {
      if (cancelled) return;
      if (!ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) setConnectionLost(true);
        return;
      }
      consecutiveFailures = 0;
      setConnectionLost(false);

      if (active.length > 0) {
        const session = active[0];
        lastSessionIdRef.current = session.id;
        completedAtRef.current = null;

        let projectName = projectNamesRef.current.get(session.projectId) ?? '';
        if (!projectName) {
          try {
            const projects = await api.projects();
            for (const p of projects) projectNamesRef.current.set(p.id, p.name);
            projectName = projectNamesRef.current.get(session.projectId) ?? '';
          } catch {}
        }

        const snapshot = await loadSnapshot(session, projectName);
        if (cancelled) return;
        setState(prev => ({
          session: snapshot,
          expanded: prev?.session.id === session.id ? prev.expanded : false,
          completedAt: prev?.session.id === session.id ? prev.completedAt : null,
          dismissed: prev?.session.id === session.id ? prev.dismissed : false,
          connectionLost: false,
        }));
        return;
      }

      const id = lastSessionIdRef.current;
      const current = stateRef.current;
      if (id && current && (current.session.id === id) && (current.session.status === 'running' || current.session.status === 'queued')) {
        let promoted: StaticSession | null = null;
        try {
          const projects = await api.projects();
          for (const p of projects) {
            try {
              const s = await api.getStaticSession(p.id, id);
              if (s) { promoted = s; break; }
            } catch {}
          }
        } catch {}

        if (promoted && (promoted.status === 'success' || promoted.status === 'failure' || promoted.status === 'cancelled')) {
          if (!completedAtRef.current) completedAtRef.current = new Date().toISOString();
          const projectName = projectNamesRef.current.get(promoted.projectId) ?? '';
          const snapshot = await loadSnapshot(promoted, projectName);
          if (cancelled) return;
          setState(prev => prev ? {
            ...prev,
            session: snapshot,
            completedAt: prev.completedAt ?? completedAtRef.current,
          } : null);
          return;
        }
      }

      if (current?.completedAt) {
        const elapsed = Date.now() - new Date(current.completedAt).getTime();
        const limit = current.session.status === 'success' ? AUTO_DISMISS_MS : FAILURE_DISMISS_MS;
        if (elapsed >= limit) {
          completedAtRef.current = null;
          lastSessionIdRef.current = null;
          setState(null);
        }
      }
    };

    void (async () => {
      const { ok, active } = await runOnce();
      await handleResult(ok, active);
    })();

    intervalId = window.setInterval(async () => {
      const { ok, active } = await runOnce();
      await handleResult(ok, active);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [retryTick, runOnce]);

  const surfaced: ActiveReviewState | null = state && connectionLost
    ? { ...state, connectionLost: true }
    : state;

  return { state: surfaced, controls };
}

export function ActiveReviewProvider({ children }: { children: ReactNode }) {
  const { state, controls } = useActiveReview();
  return (
    <ActiveReviewContext.Provider value={{ state, controls }}>
      {children}
    </ActiveReviewContext.Provider>
  );
}
