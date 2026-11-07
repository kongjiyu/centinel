/**
 * Behaviour parity for the frontend-owned copies of pure sidecar Dynamic helpers.
 * Production frontend code uses only the local copies; this test-only file runs both
 * implementations over the same inputs so a sidecar change that is not mirrored fails here.
 */
import { describe, expect, it } from 'vitest';
import * as sidecarContext from '../../../sidecar/src/dynamic/context';
import * as sidecarCoverage from '../../../sidecar/src/dynamic/coverage';
import * as sidecarRegression from '../../../sidecar/src/dynamic/regression';
import * as sidecarStub from '../../../sidecar/src/dynamic/testing/staticContextStub';
import * as sidecarFileTypes from '../../../sidecar/src/dynamic/browser/fileTypes';
import * as sidecarBudget from '../../../sidecar/src/dynamic/budgetLimits';
import * as context from './context';
import * as coverage from './coverage';
import * as regression from './regression';
import * as stub from './staticContextStub';
import * as limits from './limits';
import type { CheckDefinition, DynamicRun, StaticContextFixture } from './contracts';

const outcome = (fn: () => unknown) => {
  try {
    return { value: fn() };
  } catch (error) {
    return { error: (error as Error).message, status: (error as { status?: number }).status };
  }
};
const fixture = (scenario: stub.StubScenario = 'normal') => stub.createStaticContextFixture('project-a', scenario);
const mutate = (change: (value: any) => void) => {
  const value = structuredClone(fixture()) as any;
  change(value);
  return value;
};
const contextInputs: unknown[] = [
  null,
  undefined,
  ...stub.STUB_SCENARIOS.map((scenario) => fixture(scenario)),
  'text',
  [],
  mutate((value) => (value.projectId = 'project-b')),
  mutate((value) => (value.schemaVersion = 2)),
  mutate((value) => (value.provenance = 'live')),
  mutate((value) => (value.approvalState = 'maybe')),
  mutate((value) => (value.sources[0].currency = 'fresh')),
  mutate((value) => value.sources.push(structuredClone(value.sources[0]))),
  mutate((value) => (value.requirements[0].sourceId = 'missing')),
  mutate((value) => (value.requirements[0].revision = 0)),
  mutate((value) => value.requirements.push(structuredClone(value.requirements[0]))),
  mutate((value) => (value.risks[0].requirementId = 'missing')),
  mutate((value) => (value.conflicts = [{ requirementId: 'missing', description: 'x' }])),
  mutate((value) => (value.target.repository = 'ftp://example.com/repo')),
  mutate((value) => (value.target.repository = 'https://user:pass@example.com/repo')),
  mutate((value) => (value.target.commit = 'abc')),
  mutate((value) => (value.target.deploymentVersion = '1.0')),
  mutate((value) => (value.reviewId = '')),
  mutate((value) => (value.limitations = ['x'.repeat(4001)])),
  mutate((value) => (value.extra = 'ignored metadata')),
  mutate((value) => {
    value.provenance = 'review-snapshot';
    value.target.repository = null;
    value.target.commit = null;
  }),
  mutate((value) => (value.target.repository = null)),
];

const check = (id: string, criterionId: string, required = true): CheckDefinition => ({
  id,
  criterionId,
  description: id,
  required,
  kind: 'visible_text',
  expected: 'Ok',
});
const proof = (id: string) => ({
  id,
  kind: 'screenshot' as const,
  sha256: 'a'.repeat(64),
  availability: 'local' as const,
  capturedAt: '2026-11-01T00:00:00Z',
});
const result = (checkId: string, criterionId: string, verdict: 'passed' | 'failed' | 'uncertain', evidenceIds = ['shot']) => ({
  checkId,
  criterionId,
  verdict,
  observed: 'observed',
  reason: 'reason',
  evidenceIds,
  checkedAt: '2026-11-01T00:00:00Z',
});
const baseRun = (patch: Partial<DynamicRun> = {}, revisionPatch: Partial<DynamicRun['revision']> = {}): DynamicRun => ({
  id: 'run',
  projectId: 'project-a',
  missionId: 'mission',
  idempotencyKey: 'key',
  createdBy: 'actor',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  state: 'completed',
  verdict: 'passed',
  reason: null,
  checks: [],
  evidence: [proof('shot')],
  legacySessionId: null,
  revision: {
    id: 'revision',
    missionId: 'mission',
    projectId: 'project-a',
    revision: 1,
    createdBy: 'actor',
    createdAt: '2026-11-01T00:00:00Z',
    name: 'Test',
    goal: 'Goal',
    targetUrl: 'http://localhost:3000',
    maxSteps: 5,
    context: fixture() as StaticContextFixture,
    contextAcknowledged: true,
    checks: [check('sign-in', 'MOCK-RWA-AUTH-01-C1'), check('advisory', 'MOCK-RWA-AUTH-01-C2', false)],
    ...revisionPatch,
  },
  ...patch,
});
const runs: DynamicRun[] = [
  baseRun({}, { context: null }),
  baseRun({ checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'passed')] }),
  baseRun({ checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'failed')] }),
  baseRun({ checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'passed', ['missing'])] }),
  baseRun({ checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'passed')], evidence: [proof('shot'), proof('shot')] }),
  baseRun({ state: 'blocked', reason: 'No approved controls.' }),
  baseRun({ state: 'interrupted' }),
  baseRun({ state: 'running' }),
  baseRun({}, { context: fixture('unapproved') as StaticContextFixture, contextAcknowledged: false }),
  baseRun({}, { context: fixture('incomplete') as StaticContextFixture }),
  baseRun({}, { criterionExclusions: [{ criterionId: 'MOCK-RWA-PAYMENT-01-C1', reason: 'Out of scope' }] }),
  baseRun({}, { criterionExclusions: [{ criterionId: 'MOCK-RWA-AUTH-01-C1', reason: 'Conflicts with a check' }] }),
  baseRun({}, { checks: [check('unknown', 'NOT-A-CRITERION')] }),
  baseRun({}, { context: { ...(fixture() as StaticContextFixture), projectId: 'project-b' } }),
];

describe('frontend Dynamic helper copies', () => {
  it('use the sidecar limits', () => {
    expect(limits.MAX_UPLOAD_BYTES).toBe(sidecarFileTypes.MAX_UPLOAD_BYTES);
    expect(limits.MAX_DOWNLOAD_BYTES).toBe(sidecarFileTypes.MAX_DOWNLOAD_BYTES);
    expect(limits.DEFAULT_EXECUTION_BUDGET).toEqual(sidecarBudget.DEFAULT_EXECUTION_BUDGET);
    expect(Object.isFrozen(limits.DEFAULT_EXECUTION_BUDGET)).toBe(true);
  });

  it('build the same development context fixtures', async () => {
    expect(stub.STUB_SCENARIOS).toEqual(sidecarStub.STUB_SCENARIOS);
    for (const scenario of stub.STUB_SCENARIOS) {
      expect(stub.createStaticContextFixture('project-a', scenario)).toEqual(
        sidecarStub.createStaticContextFixture('project-a', scenario),
      );
      expect(await stub.createStaticContextStub(scenario).load('project-a')).toEqual(
        await sidecarStub.createStaticContextStub(scenario).load('project-a'),
      );
    }
    expect(outcome(() => stub.createStaticContextFixture(' '))).toEqual(
      outcome(() => sidecarStub.createStaticContextFixture(' ')),
    );
    expect(outcome(() => stub.createStaticContextFixture('p', 'other' as never))).toEqual(
      outcome(() => sidecarStub.createStaticContextFixture('p', 'other' as never)),
    );
  });

  it('validate incoming context identically, including the error message and status', () => {
    for (const input of contextInputs) {
      const local = outcome(() => context.validateIncomingContext(input, 'project-a'));
      expect(local).toEqual(outcome(() => sidecarContext.validateIncomingContext(input, 'project-a')));
      const value = 'value' in local ? (local.value as StaticContextFixture | null) : null;
      expect(context.contextNeedsAcknowledgment(value)).toBe(sidecarContext.contextNeedsAcknowledgment(value));
    }
  });

  it('validate criterion exclusions identically', () => {
    const value = fixture() as StaticContextFixture;
    const checks = [check('sign-in', 'MOCK-RWA-AUTH-01-C1')];
    const inputs: unknown[] = [
      undefined,
      [],
      [{ criterionId: 'MOCK-RWA-PAYMENT-01-C1', reason: ' Not in this release ' }],
      [{ criterionId: 'MOCK-RWA-AUTH-01-C1', reason: 'Has a check' }],
      [{ criterionId: 'unknown', reason: 'Absent' }],
      [
        { criterionId: 'MOCK-RWA-PAYMENT-01-C1', reason: 'One' },
        { criterionId: 'MOCK-RWA-PAYMENT-01-C1', reason: 'Two' },
      ],
      [{ criterionId: 'MOCK-RWA-PAYMENT-01-C1', reason: '' }],
      'not a list',
    ];
    for (const input of inputs)
      for (const supplied of [value, null])
        expect(outcome(() => context.validateCriterionExclusions(input, supplied, checks))).toEqual(
          outcome(() => sidecarContext.validateCriterionExclusions(input, supplied, checks)),
        );
  });

  it('calculate the same historical coverage', () => {
    for (const run of runs) expect(coverage.calculateRunCoverage(run)).toEqual(sidecarCoverage.calculateRunCoverage(run));
  });

  it('compare regressions identically', () => {
    const baseline = baseRun({ id: 'baseline', checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'failed')] });
    const frozen = sidecarRegression.freezeRegressionBaseline(baseline);
    expect(regression.freezeRegressionBaseline(baseline)).toEqual(frozen);
    const environment = {
      id: 'env',
      projectId: 'project-a',
      version: 2,
      updatedBy: 'actor',
      updatedAt: '',
      name: 'Local',
      targetUrl: 'http://localhost:4000',
      allowedOrigins: ['http://localhost:4000'],
      viewport: { width: 1280, height: 800 },
      accountRole: 'tester',
      requiredVariables: [],
      startupInstructions: '',
      targetVersion: '1.2',
      variableNames: [],
      preflight: [],
      checkedAt: '',
    };
    const cases: DynamicRun[] = [
      baseRun(),
      baseRun({ regression: frozen, checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'passed')] }),
      baseRun({ regression: frozen, createdBy: 'other', environment }),
      baseRun({ regression: frozen, checks: [result('sign-in', 'MOCK-RWA-AUTH-01-C1', 'passed', [])] }),
      baseRun({ regression: { ...frozen, checks: [] }, executionVersions: { observer: 2, planner: 2, policy: 2, executor: 2, checker: 3 } }),
    ];
    for (const run of cases) expect(regression.compareRegression(run)).toEqual(sidecarRegression.compareRegression(run));
  });
});
