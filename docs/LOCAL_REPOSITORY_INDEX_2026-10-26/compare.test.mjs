import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareRuns } from './compare.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/axios-52-file-baseline.json', import.meta.url), 'utf8'));

function passingCandidate() {
  const run = structuredClone(baseline);
  run.label = 'synthetic test candidate; not a live result';
  run.execution.reviewId = '11111111-1111-4111-8111-111111111111';
  run.execution.status = 'completed';
  run.execution.modelStatus = 'succeeded';
  run.freeze.model.authority = 'codex';
  run.freeze.model.reasoningEffort = 'high';
  run.retrieval = {
    mode: 'cold_build',
    packageVersion: '0.38.1',
    strategyVersion: 'local-index-v1',
    sourceManifestSha256: '669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64',
    compatibilityVerified: true,
    embeddingModel: 'synthetic-embedding-model',
    embeddingDimensions: 1024,
  };
  run.usage.review.requests = { total: 10, successful: 10, failed: 0, unknownUsage: 0 };
  run.usage.review.reported = {
    inputTokens: 300000,
    outputTokens: 30000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  run.usage.embedding = {
    status: 'complete',
    documentRequests: 100,
    queryRequests: 10,
    unknownRequests: 0,
    documentTokens: 50000,
    queryTokens: 5000,
  };
  run.coverage.retrieval = {
    packetRequests: 10,
    sourceAppearances: 70,
    uniqueFiles: 30,
    uniqueChunks: 80,
    contextCharacters: 21000,
    goldSupportRanges: { numerator: 3, denominator: 3 },
  };
  run.adjudication.predictions = {
    model: { true: 16, false: 1, unknown: 0, unadjudicated: 0 },
    deterministic: { true: 2, false: 1, unknown: 0, unadjudicated: 0 },
    aggregate: { true: 18, false: 2, unknown: 0, unadjudicated: 0 },
  };
  run.adjudication.references = { valid: 100, total: 100 };
  run.adjudication.gold.issues[0] = {
    id: 'node-timeout-custom-message',
    eligible: true,
    status: 'hit',
    hitOccurrences: 1,
    expectedOccurrences: 1,
    severity: 'unrated',
    sourceBackedExplanation: false,
  };
  run.adjudication.gold.severityInventory = { status: 'unavailable' };
  return run;
}

test('baseline fixture preserves the old 52-file, 20-call run as unaccepted', () => {
  const result = compareRuns(baseline, passingCandidate());

  assert.equal(result.baseline.runId, '4cf606de-7bc7-482d-aee2-8df0f3cbdb97');
  assert.equal(result.baseline.usage.review.totalTokens, 973421);
  assert.equal(result.baseline.usage.review.calls, 20);
  assert.deepEqual(result.baseline.precision, {
    tp: 25,
    fp: 1,
    unknown: 5,
    unadjudicated: 0,
    resolvedPrecision: 25 / 26,
    conservativePrecision: 25 / 31,
    optimisticPrecision: 30 / 31,
    totalUniquePredictions: 31,
  });
  assert.equal(result.baseline.gold.issueRecall, 0);
  assert.equal(result.baseline.semanticStatus, 'fail');
  assert.equal(result.candidate.semanticStatus, 'pass');
  assert.equal(result.scope.fullFiveProjectAcceptance, 'not-assessed: this comparison covers Axios only');
});

test('partial or failed execution cannot pass and cannot claim a token reduction', () => {
  const candidate = passingCandidate();
  candidate.execution.status = 'partial';

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.semanticStatus, 'fail');
  assert.equal(result.candidate.gates.execution.status, 'fail');
  assert.equal(result.comparison.tokenAccounting.rawDeltaCandidateMinusBaseline, null);
  assert.equal(result.comparison.tokenAccounting.descriptiveReductionPercent, null);
  assert.equal(result.comparison.semanticComparison.comparisonStatus, 'descriptive-only');
});

test('unknown adjudication blocks semantic pass without treating unknown claims as negatives', () => {
  const candidate = passingCandidate();
  candidate.adjudication.status = 'unknown';
  candidate.adjudication.predictions.aggregate.unknown = 1;

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.semanticStatus, 'unknown');
  assert.equal(result.candidate.gates.adjudicationPrecision.status, 'unknown');
  assert.equal(result.candidate.precision.unknown, 1);
  assert.equal(result.candidate.precision.conservativePrecision, 18 / 21);
});

test('a completed adjudication with unresolved predictions still fails the semantic gate', () => {
  const candidate = passingCandidate();
  candidate.adjudication.predictions.aggregate.unknown = 1;

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.gates.adjudicationPrecision.status, 'fail');
  assert.equal(result.candidate.precision.unknown, 1);
  assert.equal(result.candidate.semanticStatus, 'fail');
});

test('undefined precision fails rather than becoming zero or one hundred percent', () => {
  const candidate = passingCandidate();
  candidate.adjudication.predictions.aggregate = { true: 0, false: 0, unknown: 0, unadjudicated: 0 };

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.precision.resolvedPrecision, null);
  assert.equal(result.candidate.gates.adjudicationPrecision.status, 'fail');
  assert.equal(result.candidate.semanticStatus, 'fail');
});

test('complete gold capture can pass the bounded case while severity inventory remains unavailable', () => {
  const candidate = passingCandidate();
  const result = compareRuns(baseline, candidate);

  assert.equal(result.candidate.gates.registeredGold.status, 'pass');
  assert.equal(result.candidate.gold.issueHits, 1);
  assert.equal(result.candidate.gold.occurrenceHits, 1);
  assert.equal(result.candidate.gold.highCritical.status, 'unavailable');
  assert.equal(result.candidate.semanticStatus, 'pass');
  assert.match(result.scope.wholeSystemHighCriticalRecall, /not-assessed/);
});

test('model, policy and unavailable baseline settings are explicit confounds', () => {
  const candidate = passingCandidate();
  candidate.freeze.model.model = 'gpt-6.1-sol';
  candidate.freeze.policyVersion = 'review-next-policy';

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.semanticStatus, 'pass');
  assert.equal(result.comparison.attribution, 'descriptive-confounded');
  assert.ok(result.comparison.confounds.some(item => item.dimension === 'model'));
  assert.ok(result.comparison.confounds.some(item => item.dimension === 'policyVersion'));
  assert.ok(result.comparison.confounds.some(item => item.dimension === 'reasoningEffort' && item.status === 'unavailable'));
  assert.equal(result.comparison.tokenAccounting.reductionAttributableToIndexing, false);
  assert.equal(result.comparison.semanticComparison.comparisonStatus, 'descriptive-only');
  assert.notEqual(result.comparison.tokenAccounting.descriptiveReductionPercent, null);
});

test('unknown or partial usage never becomes zero and disables the token delta', () => {
  const candidate = passingCandidate();
  candidate.usage.review.status = 'partial';
  candidate.usage.review.requests.unknownUsage = 1;
  candidate.usage.review.reported.inputTokens = null;

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.semanticStatus, 'pass');
  assert.equal(result.candidate.usage.review.totalTokens, null);
  assert.equal(result.candidate.usage.combinedProviderTokens, null);
  assert.equal(result.comparison.tokenAccounting.status, 'unknown-or-partial');
  assert.equal(result.comparison.tokenAccounting.rawDeltaCandidateMinusBaseline, null);
  assert.equal(result.comparison.semanticComparison.comparisonStatus, 'descriptive-only');
});

test('unknown context coverage leaves the retrieval comparison partial', () => {
  const candidate = passingCandidate();
  candidate.coverage.retrieval.contextCharacters = null;
  candidate.coverage.retrieval.uniqueChunks = null;

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.semanticStatus, 'pass');
  assert.equal(result.comparison.contextCoverage.status, 'partial');
  assert.equal(result.comparison.semanticComparison.comparisonStatus, 'descriptive-only');
  assert.equal(result.comparison.tokenAccounting.reductionAttributableToIndexing, false);
});

test('supported-claim coverage is reported without adding a threshold to the frozen gates', () => {
  const candidate = passingCandidate();
  candidate.coverage.featureDomains.supportedPairs = null;

  const result = compareRuns(baseline, candidate);
  assert.equal(result.candidate.coverage.domains.supportedClaimCoverage, null);
  assert.equal(result.candidate.gates.coverage.status, 'pass');
  assert.equal(result.candidate.semanticStatus, 'pass');
});

test('missing or incompatible index provenance cannot pass the candidate gate', () => {
  const missing = passingCandidate();
  delete missing.retrieval.strategyVersion;
  const missingResult = compareRuns(baseline, missing);
  assert.equal(missingResult.candidate.gates.retrievalIntervention.status, 'unknown');
  assert.equal(missingResult.candidate.semanticStatus, 'unknown');

  const incompatible = passingCandidate();
  incompatible.retrieval.sourceManifestSha256 = '0'.repeat(64);
  const incompatibleResult = compareRuns(baseline, incompatible);
  assert.equal(incompatibleResult.candidate.gates.retrievalIntervention.status, 'fail');
  assert.equal(incompatibleResult.candidate.semanticStatus, 'fail');
});

test('malformed provenance and usage annotations are normalized without echoing free text', () => {
  const candidate = passingCandidate();
  candidate.execution.status = 'completed\nAPI_KEY=must-not-appear';
  candidate.execution.workflowStatus = 'token=sensitive';
  candidate.freeze.model.model = 'model name with private text';
  candidate.freeze.policyVersion = 'policy/private-text';
  candidate.usage.review.stages = {
    model_analysis: { calls: 2, inputTokens: 3, outputTokens: 4, totalTokens: 7, basis: 'secret prompt content' },
    'source body': { note: 'should be ignored' },
  };
  candidate.usage.estimates = { inputCharacters: 4, outputCharacters: 5, note: 'private prompt' };
  candidate.adjudication.gold.issues[0].severity = 'secret severity label';

  const serialized = JSON.stringify(compareRuns(baseline, candidate));
  assert.doesNotMatch(serialized, /API_KEY|token=sensitive|private text|secret prompt|private prompt|secret severity|should be ignored/);
});

test('inconsistent counters are rejected instead of producing impossible ratios', () => {
  const candidate = passingCandidate();
  candidate.adjudication.references = { valid: 101, total: 100 };
  assert.throws(() => compareRuns(baseline, candidate), /valid cannot exceed total/);
});
