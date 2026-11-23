import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { AutoTestSession } from '../autotest/types';
import type { Finding, Requirement, StaticSession } from '../types';
import { buildCheckResult, type CheckResult } from './result';
import type { CheckRecord } from './types';

/**
 * The project's latest result for the "What Centinel knows" panel, read from the
 * service (not this device's check list), so every member and device sees the same.
 * Code problems come from the latest code review; browser proof from the latest
 * full Auto test (conversation requests are excluded). Nothing is estimated.
 */
export type LatestResult = {
  review: StaticSession | null;
  autoTest: AutoTestSession | null;
  result: CheckResult | null;
  requirements: Requirement[];
  /** The latest code review's saved findings, for the expanded panel's detail. */
  findings: Finding[];
  at: string | null;
  loading: boolean;
  /** Reads the review and requirements again, after the panel changes them. */
  reload(): void;
};

const ACTIVE_REVIEW = new Set(['queued', 'prepared', 'running']);

export function isFullCheckSession(session: AutoTestSession) {
  return !session.request && session.planning !== false;
}

export function pickLatestReview(reviews: StaticSession[]): StaticSession | null {
  const sorted = [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted.find(review => !ACTIVE_REVIEW.has(review.status)) ?? sorted[0] ?? null;
}

export function pickLatestFullAutoTest(sessions: AutoTestSession[]): AutoTestSession | null {
  return [...sessions].filter(isFullCheckSession).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function latestResultFrom(input: { review: StaticSession | null; findings: Finding[]; autoTest: AutoTestSession | null; requirements: Requirement[] }): CheckResult | null {
  const { review, autoTest } = input;
  if (!review && !autoTest) return null;
  const at = [review?.createdAt, autoTest?.createdAt].filter((value): value is string => !!value).sort()[0];
  const check: CheckRecord = {
    id: 'latest', createdAt: at, updatedAt: at, projectName: '', documents: [], focus: '', notes: [],
    mode: review && autoTest ? 'both' : review ? 'code' : 'browser', phase: 'running',
    ...(review ? { reviewId: review.id } : {}), ...(autoTest ? { autoTestId: autoTest.id } : {}),
  };
  return buildCheckResult({ check, review, findings: input.findings, autoTest, requirements: input.requirements });
}

export function useLatestResult(projectId: string, autoSessions: AutoTestSession[]): LatestResult {
  const [review, setReview] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [reviews, reqs] = await Promise.all([
          api.listStaticSessions(projectId, { summary: true }),
          typeof api.listRequirements === 'function' ? api.listRequirements(projectId).catch(() => [] as Requirement[]) : Promise.resolve([] as Requirement[]),
        ]);
        if (!active) return;
        const latest = pickLatestReview(reviews);
        setReview(latest);
        setRequirements(reqs);
        setFindings(latest && !ACTIVE_REVIEW.has(latest.status) ? await api.listStaticFindings(projectId, latest.id).catch(() => []) : []);
      } catch {
        if (active) setReview(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [projectId, version]);

  const autoTest = useMemo(() => pickLatestFullAutoTest(autoSessions), [autoSessions]);
  const result = useMemo(() => latestResultFrom({ review, findings, autoTest, requirements }), [review, findings, autoTest, requirements]);
  const at = [review?.createdAt, autoTest?.createdAt].filter((value): value is string => !!value).sort().reverse()[0] ?? null;
  return { review, autoTest, result, requirements, findings, at, loading, reload };
}
