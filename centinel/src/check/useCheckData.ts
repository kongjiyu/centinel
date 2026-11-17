import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AutoTestSession } from '../autotest/types';
import type { ReviewHarnessTrace } from '../reviewHarness';
import type { Finding, Requirement, StaticSession } from '../types';
import { checkProblemSummary, buildCheckResult, isTerminal, type CheckResult } from './result';
import { reviewLiveView, type ReviewLiveView } from './live';
import { updateCheck } from './store';
import type { CheckRecord } from './types';

export type CheckData = {
  review: StaticSession | null;
  findings: Finding[];
  trace: ReviewHarnessTrace | null;
  autoTest: AutoTestSession | null;
  requirements: Requirement[];
  result: CheckResult;
  live: ReviewLiveView;
  loadError: string | null;
};

const REVIEW_POLL_MS = 3000;
const BROWSER_POLL_MS = 2000;

/** Polls the saved records behind one check until both parts reach a final state. */
export function useCheckData(check: CheckRecord | undefined): CheckData | null {
  const [review, setReview] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [trace, setTrace] = useState<ReviewHarnessTrace | null>(null);
  const [autoTest, setAutoTest] = useState<AutoTestSession | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const projectId = check?.projectId;
  const reviewId = check?.reviewId;
  const autoTestId = check?.autoTestId;
  const findingsLoadedFor = useRef<string | null>(null);

  useEffect(() => { setReview(null); setFindings([]); setTrace(null); findingsLoadedFor.current = null; }, [reviewId]);
  useEffect(() => { setAutoTest(null); }, [autoTestId]);

  useEffect(() => {
    if (!projectId || !reviewId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const session = await api.getStaticSession(projectId, reviewId);
        if (!active) return;
        setReview(session);
        setLoadError(null);
        const running = ['queued', 'prepared', 'running'].includes(session.status);
        if (running) {
          const nextTrace = await api.getReviewHarness(projectId, reviewId).catch(() => null);
          if (active && nextTrace) setTrace(nextTrace);
        } else if (findingsLoadedFor.current !== `${reviewId}:${session.status}`) {
          const [nextFindings, nextTrace] = await Promise.all([
            api.listStaticFindings(projectId, reviewId),
            api.getReviewHarness(projectId, reviewId).catch(() => null),
          ]);
          if (!active) return;
          setFindings(nextFindings);
          if (nextTrace) setTrace(nextTrace);
          findingsLoadedFor.current = `${reviewId}:${session.status}`;
        }
        if (running && active) timer = setTimeout(tick, REVIEW_POLL_MS);
      } catch {
        if (!active) return;
        setLoadError('Centinel could not refresh this check. It will keep trying.');
        timer = setTimeout(tick, REVIEW_POLL_MS * 2);
      }
    };
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [projectId, reviewId]);

  useEffect(() => {
    if (!projectId || !autoTestId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const session = await api.autoTest(projectId, autoTestId);
        if (!active) return;
        setAutoTest(session);
        if (['reading', 'starting', 'exploring', 'planning', 'testing', 'summarizing'].includes(session.stage)) timer = setTimeout(tick, BROWSER_POLL_MS);
      } catch {
        if (active) timer = setTimeout(tick, BROWSER_POLL_MS * 3);
      }
    };
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [projectId, autoTestId]);

  useEffect(() => {
    if (!projectId || typeof api.listRequirements !== 'function') return;
    let active = true;
    api.listRequirements(projectId).then(items => { if (active) setRequirements(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [projectId, review?.status, autoTest?.stage]);

  const result = useMemo(() => check ? buildCheckResult({ check, review, findings, autoTest, requirements }) : null, [check, review, findings, autoTest, requirements]);
  const live = useMemo(() => reviewLiveView(review, trace), [review, trace]);

  // Record the outcome once so the sidebar can show it without loading every check.
  const reviewReady = !reviewId || !!review;
  const browserReady = !autoTestId || !!autoTest;
  useEffect(() => {
    if (!check || !result || !['running', 'done'].includes(check.phase) || !reviewReady || !browserReady) return;
    if (!result.finished || !isTerminal(result.codeState) || !isTerminal(result.browserState)) return;
    if (reviewId && review && !['queued', 'prepared', 'running'].includes(review.status) && findingsLoadedFor.current === null) return;
    const summary = checkProblemSummary(result);
    if (check.phase === 'done') {
      if (!check.problemRisk && summary.problemRisk && check.problemCount === summary.problemCount) {
        updateCheck(check.id, { problemRisk: summary.problemRisk });
      }
      return;
    }
    updateCheck(check.id, { phase: 'done', ...summary, finishedAt: new Date().toISOString() });
  }, [check, result, reviewReady, browserReady, reviewId, review]);

  if (!check || !result) return null;
  return { review, findings, trace, autoTest, requirements, result, live, loadError };
}
