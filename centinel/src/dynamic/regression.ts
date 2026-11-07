/**
 * Frontend-owned copy of the sidecar `dynamic/regression.ts` (pure, dependency-free).
 * `dynamicRuntimeParity.test.ts` checks it behaves identically to the sidecar original.
 */
import type { CheckResult, CheckVerdict, DynamicRun, EvidenceReference, RegressionBaseline } from './contracts';
export type { RegressionBaseline };
export type RegressionComparison = {
  conditionChanges: string[];
  limitations: string[];
  checks: Array<{
    checkId: string;
    description: string;
    before: CheckVerdict;
    after: CheckVerdict;
    change: 'still_passed' | 'now_passed' | 'still_failed' | 'new_failure' | 'inconclusive';
  }>;
};
export function freezeRegressionBaseline(run: DynamicRun): RegressionBaseline {
  return {
    schemaVersion: 1,
    runId: run.id,
    revisionId: run.revision.id,
    createdAt: run.createdAt,
    createdBy: run.createdBy,
    verdict: run.verdict,
    ...(run.executionVersions ? { executionVersions: structuredClone(run.executionVersions) } : {}),
    ...(run.actionPolicy ? { actionPolicy: structuredClone(run.actionPolicy) } : {}),
    ...(run.executionBudget ? { executionBudget: structuredClone(run.executionBudget) } : {}),
    targetUrl: run.environment?.targetUrl ?? run.revision.targetUrl,
    environment: run.environment ? structuredClone(run.environment) : null,
    checks: structuredClone(run.checks),
    evidence: structuredClone(run.evidence),
  };
}
/** Compare the pinned checks, not a current/latest edited definition. A later
 * pass is an observation change, never automatic finding resolution. */
export function compareRegression(run: DynamicRun): RegressionComparison | null {
  const baseline = run.regression;
  if (!baseline) return null;
  const changes: string[] = [];
  const env = run.environment ?? null;
  for (const field of [
    'id',
    'version',
    'targetVersion',
    'targetUrl',
    'accountRole',
    'viewport',
    'allowedOrigins',
    'sessionReference',
    'sessionSnapshot',
    'variableNames',
    'dataResourceKey',
    'actionPolicy',
    'budgets',
  ] as const)
    if (JSON.stringify(baseline.environment?.[field]) !== JSON.stringify(env?.[field]))
      changes.push('Environment ' + field + ' changed.');
  for (const field of ['executionVersions', 'actionPolicy', 'executionBudget'] as const)
    if (JSON.stringify(baseline[field]) !== JSON.stringify(run[field]))
      changes.push('Recorded ' + field + ' changed or unavailable.');
  if (baseline.createdBy !== run.createdBy) changes.push('Executing actor changed.');
  if (baseline.targetUrl !== (env?.targetUrl ?? run.revision.targetUrl))
    changes.push('Executed website address changed.');
  const verdict = (
    results: CheckResult[],
    evidence: EvidenceReference[],
    id: string,
    criterion: string,
  ): CheckVerdict => {
    const rows = results.filter((row) => row.checkId === id && row.criterionId === criterion);
    if (rows.length !== 1) return 'not_tested';
    const row = rows[0];
    if (
      ['passed', 'failed'].includes(row.verdict) &&
      (!row.evidenceIds.length ||
        row.evidenceIds.some(
          (ref) => evidence.filter((item) => item.id === ref && /^[a-f0-9]{64}$/.test(item.sha256)).length !== 1,
        ))
    )
      return 'uncertain';
    return row.verdict;
  };
  return {
    conditionChanges: changes,
    limitations: [
      'Private variable values, browser session contents and test-data contents are not compared.',
      'Target versions are recorded profile declarations; matching metadata does not prove identical runtime state.',
      'A later pass does not erase baseline evidence or resolve an earlier finding.',
    ],
    checks: run.revision.checks.map((check) => {
      const before = verdict(baseline.checks, baseline.evidence, check.id, check.criterionId);
      const after = verdict(run.checks, run.evidence, check.id, check.criterionId);
      return {
        checkId: check.id,
        description: check.description,
        before,
        after,
        change:
          before === 'passed' && after === 'passed'
            ? 'still_passed'
            : before === 'failed' && after === 'passed'
              ? 'now_passed'
              : before === 'failed' && after === 'failed'
                ? 'still_failed'
                : before === 'passed' && after === 'failed'
                  ? 'new_failure'
                  : 'inconclusive',
      };
    }),
  };
}
