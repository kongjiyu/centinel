import { useEffect } from 'react';
import { api } from '../api/client';
import { checkProblemSummary, buildCheckResult } from './result';
import { listChecks, updateCheck } from './store';

const SYNC_MS = 10_000;

/**
 * Keeps the sidebar honest for checks that finish while their page is closed:
 * reads the saved Review and Auto test states and records the outcome once.
 */
export function useBackgroundCheckSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const tick = async () => {
      for (const check of listChecks().filter(item => item.phase === 'running' && item.projectId)) {
        try {
          const [review, autoTest] = await Promise.all([
            check.reviewId ? api.getStaticSession(check.projectId!, check.reviewId) : Promise.resolve(null),
            check.autoTestId ? api.autoTest(check.projectId!, check.autoTestId) : Promise.resolve(null),
          ]);
          const partial = buildCheckResult({ check, review, findings: [], autoTest, requirements: [] });
          if (!partial.finished) continue;
          const findings = review && check.reviewId ? await api.listStaticFindings(check.projectId!, check.reviewId) : [];
          const result = buildCheckResult({ check, review, findings, autoTest, requirements: [] });
          if (active) updateCheck(check.id, { phase: 'done', ...checkProblemSummary(result), finishedAt: new Date().toISOString() });
        } catch {
          /* try again on the next pass */
        }
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, SYNC_MS);
    return () => { active = false; clearInterval(timer); };
  }, [enabled]);
}
