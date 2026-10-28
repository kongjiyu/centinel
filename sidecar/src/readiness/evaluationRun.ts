import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { READINESS_BENCHMARK_VERSION } from './fixtures/index.js';
import { READINESS_POLICY_VERSION } from './policy.js';
import { createReadinessEvaluationReport, type ReadinessCaseEvaluation } from './evaluation.js';
import type { ReadinessEvaluationFixture } from './fixtures/types.js';

/** Local fictional-corpus evidence only. Never persists project data or auth. */
export async function createReadinessEvaluationRun(
  outputRoot: string,
  fixtures: readonly ReadinessEvaluationFixture[],
  model: string,
) {
  await fs.mkdir(outputRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(outputRoot, 'run-'));
  const corpus = JSON.stringify(fixtures);
  const plannedFixtureIds = fixtures.map(item => item.id);
  const metadata = {
    mode: 'live-codex-fixtures', benchmarkVersion: READINESS_BENCHMARK_VERSION,
    policyVersion: READINESS_POLICY_VERSION, model,
    corpusHash: createHash('sha256').update(corpus).digest('hex'),
    selectedFixtureIds: plannedFixtureIds,
  };
  await fs.writeFile(path.join(directory, 'corpus.json'), corpus, { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' });
  const save = async (cases: readonly ReadinessCaseEvaluation[]) => {
    const report = {
      ...metadata,
      completedCorpus: cases.length === fixtures.length,
      ...createReadinessEvaluationReport(cases, new Date().toISOString(), plannedFixtureIds),
    };
    const temporary = path.join(directory, 'report.tmp');
    await fs.writeFile(temporary, JSON.stringify(report, null, 2));
    await fs.rename(temporary, path.join(directory, 'report.json'));
    return report;
  };
  await save([]);
  return { directory, metadata, save };
}
