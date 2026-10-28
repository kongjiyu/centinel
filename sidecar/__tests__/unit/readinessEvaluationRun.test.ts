import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadinessEvaluationRun } from '../../src/readiness/evaluationRun.js';
import { READINESS_EVALUATION_FIXTURES, runReadinessEvaluation } from '../../src/readiness/evaluation.js';
import { READINESS_BENCHMARK_VERSION } from '../../src/readiness/fixtures/index.js';
import { READINESS_POLICY_VERSION } from '../../src/readiness/policy.js';
import { ModelProviderError } from '../../src/review/retry.js';

const temporaryRoots: string[] = [];
afterEach(async () => {
  // Only exact temporary directories created by these tests are removed.
  await Promise.all(temporaryRoots.splice(0).map(directory => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('centinel-readiness-evaluation-')) {
      throw new Error('Refusing cleanup outside the test temporary directory');
    }
    return fs.rm(resolved, { recursive: true, force: true });
  }));
});

describe('readiness evaluation run evidence', () => {
  it('freezes distinct run provenance without overwriting previous reports', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-readiness-evaluation-'));
    temporaryRoots.push(root);
    const historicPath = path.join(root, 'live-codex-results.json');
    await fs.writeFile(historicPath, 'immutable historical report');
    const fixtures = READINESS_EVALUATION_FIXTURES.slice(0, 2);
    const first = await createReadinessEvaluationRun(root, fixtures, 'mock-model');
    const originalReport = await fs.readFile(path.join(first.directory, 'report.json'), 'utf8');
    const second = await createReadinessEvaluationRun(root, fixtures, 'mock-model');
    expect(first.directory).not.toBe(second.directory);
    expect(await fs.readFile(historicPath, 'utf8')).toBe('immutable historical report');
    expect(await fs.readFile(path.join(first.directory, 'report.json'), 'utf8')).toBe(originalReport);
    const frozen = await fs.readFile(path.join(first.directory, 'corpus.json'), 'utf8');
    expect(JSON.parse(frozen)).toEqual(fixtures);
    expect(first.metadata).toMatchObject({
      benchmarkVersion: READINESS_BENCHMARK_VERSION, policyVersion: READINESS_POLICY_VERSION,
      model: 'mock-model', corpusHash: createHash('sha256').update(frozen).digest('hex'),
    });
    expect(JSON.parse(originalReport)).toMatchObject({ assessedCaseCount: 0, unattemptedCaseCount: 2, accepted: false, completedCorpus: false });
  });

  it('persists incremental blocked results with the full planned denominator and no provider body', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-readiness-evaluation-'));
    temporaryRoots.push(root);
    const fixtures = READINESS_EVALUATION_FIXTURES.slice(0, 2);
    const run = await createReadinessEvaluationRun(root, fixtures, 'mock-model');
    const evaluated = await runReadinessEvaluation({ analyze: async () => { throw new ModelProviderError('private provider body', { code: 'rate_limited', retryable: false }); } }, fixtures);
    await run.save(evaluated.cases);
    // Replacing this run's incremental report is supported on Windows too.
    await run.save(evaluated.cases);
    const saved = await fs.readFile(path.join(run.directory, 'report.json'), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({
      completedCorpus: false, accepted: false, fixtureCount: 1, assessedCaseCount: 0,
      executionErrorCaseCount: 1, mismatchedCaseCount: 0, unattemptedCaseCount: 1,
      totals: { criterionMismatches: 0, invalidBasis: 0, executionErrors: 1 },
    });
    expect(saved).not.toContain('private provider body');
    expect(await fs.readFile(path.join(run.directory, 'corpus.json'), 'utf8')).toBe(JSON.stringify(fixtures));
  });
});
