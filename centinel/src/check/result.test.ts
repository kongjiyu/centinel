import { describe, expect, it } from 'vitest';
import type { AutoTestEntry, AutoTestSession } from '../autotest/types';
import type { Finding, Requirement, StaticSession } from '../types';
import { browserProblem, buildCheckResult, codeProblem, displayTitle, tallyRequirements } from './result';
import type { CheckRecord } from './types';

const check = (patch: Partial<CheckRecord> = {}): CheckRecord => ({
  id: 'c1', createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', projectId: 'p1', projectName: 'sample-shop',
  documents: [], focus: '', mode: 'both', phase: 'running', reviewId: 'r1', autoTestId: 'a1', notes: [], ...patch,
});

const review = (patch: Partial<StaticSession> = {}): StaticSession => ({
  id: 'r1', projectId: 'p1', name: 'Check', reviewType: 'full' as StaticSession['reviewType'], status: 'completed' as StaticSession['status'], configJson: '{}', progressJson: '{}',
  remarks: '', finalSummary: '', failureReason: '', createdAt: '', updatedAt: '', baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '', ...patch,
});

const finding = (patch: Partial<Finding> = {}): Finding => ({
  id: 'f1', projectId: 'p1', sessionId: 'r1', source: 'static', severity: 'high', priority: 'high', riskLevel: 'critical', title: 'Orders open without sign-in',
  description: 'The route never checks the user.', status: 'new', createdAt: '', artifactId: null, category: 'security', evidenceText: 'return orders', recommendation: 'Check the user.',
  confidence: 'high', fromRemarks: false, filePath: 'server.js', lineNumber: 76, ...patch,
});

const test = (patch: Partial<AutoTestEntry> = {}): AutoTestEntry => ({
  id: 't1', name: 'Unknown email uses the generic error', goal: 'Generic error', rationale: '', requirementRef: 'REQ-1', sourceRefs: [{ path: 'server.js', line: 43 }],
  checks: [{ id: 'k1', criterionId: 'REQ-1', description: 'The generic message is shown.', required: true, kind: 'visible_text' }], startPath: '/', state: 'failed',
  checkResults: [{ checkId: 'k1', criterionId: 'REQ-1', verdict: 'failed', observed: 'Expected visible text absent.', reason: 'missing', evidenceIds: [] }],
  explanation: 'The handler returns a specific message.', runId: 'run-1', ...patch,
});

const session = (tests: AutoTestEntry[], patch: Partial<AutoTestSession> = {}): AutoTestSession => ({
  schemaVersion: 1, id: 'a1', projectId: 'p1', ownerId: 'o', folder: '/x', createdAt: '', updatedAt: '', stage: 'completed', error: null, repository: null, launch: null,
  exploration: null, lanes: [], laneLimit: 3, laneNote: null, tests, dropped: [], summary: { passed: 0, failed: 0, uncertain: 0, blocked: 0, notTested: 0, limitations: ['Only the journeys listed were tested.'] }, ...patch,
});

describe('check result', () => {
  it('groups browser-proven and code problems, counts only open findings, and writes the verdict', () => {
    const result = buildCheckResult({
      check: check(),
      review: review(),
      findings: [finding(), finding({ id: 'f2', status: 'dismissed', title: 'Dismissed' }), finding({ id: 'f3', riskLevel: 'low', title: 'Debug output' })],
      autoTest: session([test(), test({ id: 't2', name: 'Checkout passes', state: 'passed', checkResults: [] })]),
      requirements: [],
    });
    expect(result.finished).toBe(true);
    expect(result.proven.map(problem => problem.title)).toEqual(['Unknown email uses the generic error']);
    expect(result.foundInCode.map(problem => problem.title)).toEqual(['Orders open without sign-in', 'Debug output']);
    expect(result.verdict).toBe('3 problems found. 1 proven in the browser.');
    expect(result.passedBrowserTests).toBe(1);
    expect(result.notes).toEqual(['Only the journeys listed were tested.']);
    expect(result.notChecked).toEqual([]);
  });

  it('never gives a code problem the Browser mark, because the link is not built', () => {
    expect(codeProblem(finding()).marks).toEqual(['code']);
    expect(browserProblem(test()).marks).toEqual(['browser']);
  });

  it('replaces the runner note with plain words and keeps real page text', () => {
    expect(browserProblem(test()).browserChecks).toEqual([{ expected: 'The generic message is shown.', observed: 'This was not shown on the page.' }]);
    const shown = browserProblem(test({ checkResults: [{ checkId: 'k1', criterionId: 'REQ-1', verdict: 'failed', observed: 'No account uses this email.', reason: '', evidenceIds: [] }] }));
    expect(shown.browserChecks?.[0].observed).toBe('No account uses this email.');
  });

  it('shows the first sentence of a rule finding title without its rule id', () => {
    expect(displayTitle('[secrets-api-key] Possible hardcoded credential in "password". Verify whether it is sensitive.')).toBe('Possible hardcoded credential in "password"');
    expect(displayTitle('Order Ownership Bypass')).toBe('Order Ownership Bypass');
  });

  it('says no problems only after both parts finished, and names what was checked', () => {
    const result = buildCheckResult({ check: check(), review: review(), findings: [], autoTest: session([test({ state: 'passed', checkResults: [] })]), requirements: [] });
    expect(result.verdict).toBe('No problems found.');
    expect(result.verdictDetail).toBe('Centinel checked the code and 1 browser test.');
  });

  it('is not finished while a part is running', () => {
    const result = buildCheckResult({ check: check(), review: review({ status: 'running' as StaticSession['status'] }), findings: [], autoTest: session([]), requirements: [] });
    expect(result.finished).toBe(false);
    expect(result.verdict).toBe('Checking…');
  });

  it('lists what was not checked: stopped parts, unclear tests and review gaps', () => {
    const progressJson = JSON.stringify({ coverage: 'partial', unverifiedParts: [{ reason: 'model_timeout', files: ['src/big.js'], features: [] }] });
    const result = buildCheckResult({
      check: check({ notes: ['3 files in the folder were skipped (unsupported type or too large).'] }),
      review: review({ progressJson }),
      findings: [finding()],
      autoTest: session([test({ id: 't3', name: 'Login', state: 'blocked', reason: 'no sign-in form' })]),
      requirements: [],
    });
    expect(result.notChecked).toEqual([
      '3 files in the folder were skipped (unsupported type or too large).',
      'src/big.js: The AI did not answer within the time limit.',
      'Browser test “Login”: it could not run (no sign-in form).',
    ]);
    expect(result.verdictDetail).toBe('Some parts were not checked. They are listed below.');
  });

  it('reports a check that could not start', () => {
    const result = buildCheckResult({ check: check({ phase: 'failed', reviewId: undefined, autoTestId: undefined, error: 'No readable files were found.' }), review: null, findings: [], autoTest: null, requirements: [] });
    expect(result.verdict).toBe('The check could not start.');
    expect(result.verdictDetail).toBe('No readable files were found.');
  });

  it('marks parts that were not requested', () => {
    const result = buildCheckResult({ check: check({ mode: 'code', autoTestId: undefined }), review: review(), findings: [], autoTest: null, requirements: [] });
    expect(result.browserState).toBe('not_requested');
    expect(result.verdictDetail).toBe('Centinel checked the code.');
  });
});

describe('requirement tally', () => {
  const requirement = (id: string, title: string): Requirement => ({ id, projectId: 'p1', title, description: '', category: '', priority: '', createdAt: '' });

  it('counts not met from failed tests and linked findings, met from passing tests, and the rest as not checked', () => {
    const tally = tallyRequirements(
      [requirement('u1', 'REQ-1: Generic sign-in error'), requirement('u2', 'REQ-2: Totals'), requirement('u3', 'REQ-3: Orders are private')],
      [test(), test({ id: 't2', requirementRef: 'REQ-2', state: 'passed' })],
      [finding({ requirementId: 'u3' })],
    );
    expect(tally).toEqual({ total: 3, notMet: 2, met: 1, notChecked: 0, notMetNames: ['REQ-1: Generic sign-in error', 'REQ-3: Orders are private'], metNames: ['REQ-2: Totals'] });
  });

  it('falls back to the requirement IDs the tests named, and returns null with none', () => {
    expect(tallyRequirements([], [test()], [])).toEqual({ total: 1, notMet: 1, met: 0, notChecked: 0, notMetNames: ['REQ-1'], metNames: [] });
    expect(tallyRequirements([], [test({ requirementRef: null })], [])).toBeNull();
  });
});
