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
    ]);
    // A stuck test with a saved run is kept with that run, so its steps can be opened.
    expect(result.stuckTests).toEqual([{ key: 'test:t3', text: 'Browser test “Login”: it could not run (no sign-in form).', runId: 'run-1', name: 'Login', why: 'It could not run', reason: 'no sign-in form' }]);
    // Each gap belongs to its part: the skipped files and the review gap go with the code.
    expect(result.codeGaps).toEqual(result.notChecked);
    expect(result.browserGaps).toEqual([]);
    expect(result.verdictDetail).toBe('Some parts could not be checked. Each is shown with its part below.');
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

describe('fixed full-check tests', () => {
  it('turns failing smoke pages and usability rules into browser problems', () => {
    const smoke = test({ id: 's', kind: 'smoke', name: 'Pages open without errors', state: 'failed', checks: [], checkResults: undefined,
      smoke: { pages: [{ path: '/', status: 200, ok: true, problem: null }, { path: '/orders', status: 500, ok: false, problem: 'The page answered with HTTP 500.' }] } });
    const usability = test({ id: 'u', kind: 'usability', name: 'Usability of the first page', state: 'failed', checks: [], checkResults: undefined,
      usability: { sampled: 8, uncertain: 1, limitations: [], failures: [{ rule: 'labels', expected: 'Every control has a name.', observed: '2 controls have no label or name.', count: 2 }] } });
    expect(browserProblem(smoke).browserChecks).toEqual([{ expected: '/orders opens without errors.', observed: 'The page answered with HTTP 500.' }]);
    expect(browserProblem(usability).browserChecks).toEqual([{ expected: 'Every control has a name.', observed: '2 controls have no label or name.' }]);
    const result = buildCheckResult({ check: check({ autoTestId: 'a', mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([smoke, usability]) });
    expect(result.proven.map(problem => problem.title)).toEqual(['Pages open without errors', 'Usability of the first page']);
    expect(result.proven.every(problem => problem.testRef?.reusable === false)).toBe(true);
  });

  it('says how far the exploration got and what it did not try', () => {
    const explore = test({ id: 'e', kind: 'exploratory', name: 'Explore the app', state: 'passed', exploration: { screens: 4, actions: 6, untried: 9, truncated: false } });
    const result = buildCheckResult({ check: check({ autoTestId: 'a', mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([explore]) });
    expect(result.notChecked).toContain('The exploratory test reached 4 screens and pressed 6 controls. 9 controls it saw on the screens it reached were not pressed.');
    const complete = test({ id: 'e2', kind: 'exploratory', name: 'Explore the app', state: 'passed', exploration: { screens: 5, actions: 5, untried: 0, outOfScope: 4, truncated: false } });
    const done = buildCheckResult({ check: check({ autoTestId: 'a', mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([complete]) });
    expect(done.notChecked).toEqual([]);
    expect(done.notes).toContain('The exploratory test reached 5 screens and pressed 5 controls. It tried every control it was allowed to press. 4 controls that need typing or would order, pay, delete or send are never pressed by exploration.');
  });
});

describe('project unit tests in a check', () => {
  const unit = (patch: Partial<AutoTestEntry>) => test({ id: 'unit', kind: 'unit', name: 'Project unit tests', checks: [], checkResults: undefined, sourceRefs: [], requirementRef: null, ...patch });
  it('keeps unit results apart from browser problems and counts', () => {
    const failed = unit({ state: 'failed', unit: { outcome: 'failed', script: 'test:unit', framework: 'Vitest 3.2.4', reason: '', counts: { total: 54, passed: 43, failed: 1, skipped: 10 }, failures: [{ file: 'src/a.test.ts', name: 'adds', message: 'expected 2 to be 3' }] } });
    const browser = test({ state: 'passed' });
    const result = buildCheckResult({ check: check({ mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([browser, failed]) });
    expect(result.proven).toEqual([]);
    expect(result.browserTestCount).toBe(1);
    expect(result.unitTests).toEqual({ state: 'failed', line: '43 of 54 unit tests passed, 10 skipped, 1 failed.', failures: [{ file: 'src/a.test.ts', name: 'adds', message: 'expected 2 to be 3' }], failureTotal: 1 });
  });

  it('says why unit tests did not run', () => {
    const skipped = unit({ state: 'not_tested', unit: { outcome: 'unsupported', script: null, framework: null, counts: null, failures: [], reason: "The project's tests use Jest. Centinel can only run a plain Vitest script for now." } });
    const result = buildCheckResult({ check: check({ mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([skipped]) });
    expect(result.unitTests?.line).toBe("The unit tests did not run: The project's tests use Jest. Centinel can only run a plain Vitest script for now.");
    expect(result.notChecked).toContain("Unit tests did not run: The project's tests use Jest. Centinel can only run a plain Vitest script for now.");
  });
});

describe('what counts as not checked', () => {
  it('does not list a project without unit tests as a gap, but does list tests Centinel cannot run', () => {
    const unit = (present: boolean, reason: string) => test({ id: 'u', kind: 'unit', name: 'Project unit tests', state: 'not_tested', checks: [], checkResults: undefined, sourceRefs: [],
      unit: { outcome: 'unsupported', script: null, framework: null, counts: null, failures: [], reason, present } });
    const none = buildCheckResult({ check: check({ mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([unit(false, 'The project has no unit tests.')]) });
    expect(none.notChecked).toEqual([]);
    expect(none.unitTests?.line).toBe('This project has no unit tests.');
    const jest = buildCheckResult({ check: check({ mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([unit(true, "The project's tests use Jest. Centinel can only run a plain Vitest script for now.")]) });
    expect(jest.notChecked).toEqual(["Unit tests did not run: The project's tests use Jest. Centinel can only run a plain Vitest script for now."]);
  });
});

describe('reruns and several explorations', () => {
  it('says when a test was run a second time and adds up the explorations', () => {
    const rerun = test({ id: 'r1', name: 'Discount', state: 'passed', firstAttempt: { runId: 'run-0', reason: 'control already activated' } });
    const stuck = test({ id: 'r2', name: 'Totals', state: 'blocked', reason: 'target must be unique', firstAttempt: { runId: 'run-9', reason: 'x' } });
    const explore = (id: string, screens: number, actions: number, untried: number) => test({ id, kind: 'exploratory', name: `Explore ${id}`, state: 'passed', exploration: { screens, actions, untried, truncated: false, seen: 10, outOfScope: 0 } });
    const result = buildCheckResult({ check: check({ mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([rerun, stuck, explore('a', 3, 5, 4), explore('b', 2, 6, 0)]) });
    expect(result.notes).toContain('1 browser test could not run the first time and was run again on a fresh copy of the app; its result comes from the second run.');
    expect(result.stuckTests[0].text).toBe('Browser test “Totals”: it could not run, also when run a second time (Centinel could not tell which control the AI meant, so it did not press it).');
    expect(result.notChecked).toContain('2 exploratory runs reached 5 screens and pressed 11 controls in total. 4 controls it was allowed to press were not tried.');
  });
});

describe('confirmed browser problems', () => {
  it('lists a failure only once a second run confirmed it, and a one-off failure as unclear', () => {
    const confirmed = test({ id: 'c1', name: 'Wrong email', state: 'failed', firstAttempt: { runId: 'run-0', reason: null, state: 'failed' } });
    const flaky = test({ id: 'c2', name: 'Totals', state: 'uncertain', reason: 'It failed once and passed once on fresh copies of the app, so it is not counted as a problem.', firstAttempt: { runId: 'run-8', reason: null, state: 'failed' } });
    const result = buildCheckResult({ check: check({ mode: 'browser' }), review: null, findings: [], requirements: [], autoTest: session([confirmed, flaky]) });
    expect(result.proven.map(problem => problem.title)).toEqual(['Wrong email']);
    expect(result.notes).toContain('Every browser problem is run a second time on a fresh copy of the app before it is listed; 1 problem failed both times.');
    expect(result.stuckTests[0].text).toContain('the result was unclear, also when run a second time (It failed once and passed once');
  });
});
