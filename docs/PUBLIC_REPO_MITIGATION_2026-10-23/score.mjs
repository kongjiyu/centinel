import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from '../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.mjs';

// Reuse the frozen gold and fixed denominators; never rewrite baseline scores.
export function scoreMitigation(runDirectory, adjudication) {
  const result = score(runDirectory, adjudication);
  const events = fs.readdirSync(runDirectory).filter(file => /^\d{4}-.+\.json$/.test(file)).sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(runDirectory, file), 'utf8')));
  const diagnostics = result.cases.map(item => {
    const readiness = events.filter(event => event.instanceId === item.instanceId && event.kind === 'readiness-result').at(-1)?.data;
    const value = readiness?.status === 'completed' && !readiness.stale ? readiness.snapshot?.validationDiagnostics : null;
    const checks = value?.categories.flatMap(category => category.checks) ?? [];
    return { instanceId: item.instanceId, available: !!value, batchCount: value?.batchCount ?? null,
      rawPresence: value?.categories.map(category => ({ category: category.category, presence: category.rawPresence })) ?? [],
      rawLocalPasses: checks.reduce((sum, check) => sum + check.rawStatusCounts.pass, 0),
      effectivePasses: checks.filter(check => check.effectiveStatus === 'pass').length,
      effectiveUnknown: checks.filter(check => check.effectiveStatus === 'unknown').length,
      criterionCount: checks.length };
  });
  return { ...result, readinessDiagnostics: diagnostics,
    readinessPartialAssertions: adjudication.readinessAssertions ?? [],
    semanticAccuracyEligible: result.cases.every(item => item.eligible),
    caveats: result.caveats.filter(value => !value.includes('No raw Readiness'))
      .concat('Sanitized raw/effective Readiness diagnostics are available only for newly completed runs.',
        'Capacity-blocked and unattempted cases do not establish model semantic accuracy; fixed end-to-end recall remains disclosed.',
        'The Readiness gold contains seven partial assertions per case, not a complete criterion-level truth set.') };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Provide run directory and independently adjudicated claims.');
  console.log(JSON.stringify(scoreMitigation(process.argv[2], JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))), null, 2));
}
