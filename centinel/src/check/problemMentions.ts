import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { codeProblem } from './result';
import type { CheckRecord } from './types';
import type { ProblemAttachment } from './conversation';
import { effectiveFindingStatus } from '../findingStatus';

export function useProblemMentions(projectId: string | undefined, checks: CheckRecord[], open: boolean) {
  const [problems, setProblems] = useState<ProblemAttachment[]>([]);
  const [error, setError] = useState(false);
  const identity = checks.filter(check => check.projectId === projectId).slice(0, 8).map(check => [check.id, check.reviewId, check.autoTestId].join(':')).join('|');
  useEffect(() => {
    if (!open || !projectId) return;
    let active = true;
    const selected = checks.filter(check => check.projectId === projectId).slice(0, 8);
    void Promise.all(selected.map(async check => {
      const items: ProblemAttachment[] = [];
      if (check.reviewId) {
        const findings = await api.listStaticFindings(projectId, check.reviewId);
        for (const finding of findings.filter(item => ['new', 'accepted', 'carryover'].includes(effectiveFindingStatus(item)))) {
          items.push({ label: codeProblem(finding).title, reference: { reviewId: check.reviewId, findingId: finding.id } });
        }
      }
      if (check.autoTestId) {
        const session = await api.autoTest(projectId, check.autoTestId);
        for (const test of session.tests.filter(item => item.state === 'failed')) {
          items.push({ label: test.name, reference: { autoTestId: session.id, testId: test.id } });
        }
      }
      return items;
    })).then(result => { if (active) { setProblems(result.flat()); setError(false); } })
      .catch(() => { if (active) { setProblems([]); setError(true); } });
    return () => { active = false; };
  }, [projectId, identity, open]);
  return { problems, error };
}
