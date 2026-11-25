import type { AutoTestEntry, AutoTestSession, AutoTestState, UnitTestSummary } from '../autotest/types';
import { plainReason } from './plainReason';
import { shortReviewIssueTitle } from '../components/ReviewIssues';
import { isActive as autoTestActive } from '../autotest/types';
import { effectiveFindingStatus } from '../findingStatus';
import { reviewCoverageGaps, unverifiedPartLocation, unverifiedPartReason } from '../reviewCoverage';
import { parseReviewProgress } from '../reviewViewModel';
import { deriveRiskLevelWithFallback, riskLevelRank, type RiskLevel } from '../riskPolicy';
import type { EvidenceSufficiencyAssessment, Finding, Requirement, StaticSession } from '../types';
import type { CheckRecord } from './types';

/**
 * Result model for one Check (DESIGN.md §4.3 and §5). Every value comes from the
 * saved Review, its findings, the Auto test session and project requirements.
 *
 * Evidence marks: `code` means a validated Review finding; `browser` means a saved
 * browser run whose own check failed. Linking a code finding to a browser run is
 * not built yet, so no problem carries both marks (DESIGN.md §14).
 */

export type EvidenceMark = 'code' | 'browser';

export type CheckProblem = {
  key: string;
  kind: 'code' | 'browser';
  title: string;
  location: string | null;
  risk: RiskLevel | null;
  marks: EvidenceMark[];
  /** What the code review saw. */
  codeSummary?: string;
  codeEvidence?: string;
  recommendation?: string;
  /** What the browser showed, one line per failed check. */
  browserChecks?: Array<{ expected: string; observed: string }>;
  aiExplanation?: string | null;
  findingId?: string;
  testId?: string;
  runId?: string;
  /** The saved browser test, so it can be run again from the conversation. */
  testRef?: { sessionId: string; testId: string; reusable: boolean };
  requirementRef?: string | null;
  needsCitationCheck?: boolean;
};

export type RequirementTally = { total: number; notMet: number; met: number; notChecked: number; notMetNames: string[]; metNames?: string[] };

export type PartState = 'not_requested' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled' | 'not_started';

/** The project's own unit tests: Vitest's report only, kept apart from browser problems. */
export type UnitTestsResult = { state: AutoTestState; line: string; failures: UnitTestSummary['failures']; failureTotal: number };

/** A browser test that did not finish, with its saved run so its steps can be opened (19 Nov 2026). */
/** unclear: it failed once and passed once on fresh copies, so it has no result (not a test that could not run). */
export type StuckTest = { key: string; text: string; runId: string; name: string; why: string; reason: string | null; kind?: string; unclear?: boolean };

export type CheckResult = {
  unitTests: UnitTestsResult | null;
  /** Browser tests that stopped or were unclear with saved timelines, shown in the browser gap section. */
  stuckTests: StuckTest[];
  codeState: PartState;
  browserState: PartState;
  proven: CheckProblem[];
  foundInCode: CheckProblem[];
  passedBrowserTests: number;
  browserTestCount: number;
  requirements: RequirementTally | null;
  notChecked: string[];
  /** Where each gap is shown (19 Nov 2026, no separate Not checked section): under Found in code, and with the browser tests. */
  codeGaps: string[];
  browserGaps: string[];
  /** Statements about how the browser tests work, recorded with the session. */
  notes: string[];
  verdict: string;
  verdictDetail: string | null;
  finished: boolean;
};

const OPEN_STATUSES = new Set<Finding['status']>(['new', 'accepted', 'carryover']);

export function reviewPartState(review: StaticSession | null | undefined, requested: boolean): PartState {
  if (!requested) return 'not_requested';
  if (!review) return 'not_started';
  if (['queued', 'prepared', 'running'].includes(review.status)) return 'running';
  if (review.status === 'blocked' && parseReviewProgress(review.progressJson)?.stage === 'provider_paused') return 'paused';
  if (review.status === 'cancelled') return 'cancelled';
  if (['failed', 'failure', 'blocked'].includes(review.status)) return 'failed';
  return 'done';
}

export function autoTestPartState(session: AutoTestSession | null | undefined, requested: boolean): PartState {
  if (!requested) return 'not_requested';
  if (!session) return 'not_started';
  if (autoTestActive(session)) return 'running';
  if (session.stage === 'cancelled') return 'cancelled';
  if (session.stage === 'failed') return 'failed';
  return 'done';
}

export const browserStartupFailed = (session: AutoTestSession | null | undefined) => session?.stage === 'failed' && !session.launch?.url
  && ['unsupported', 'unknown_recipe', 'tool_missing', 'install_failed', 'install_declined', 'exited', 'not_ready', 'launch_failed'].includes(session.error?.reason ?? '');

export const isTerminal = (state: PartState) => state !== 'running';

function findingLocation(finding: Finding): string | null {
  const path = finding.filePath || finding.location?.sourceLocator?.filePath || '';
  if (!path) return null;
  const line = finding.lineNumber ?? finding.location?.sourceLocator?.lineStart ?? null;
  return line ? `${path}:${line}` : path;
}

/** Rule findings store titles like "[rule-id] Sentence. More."; show the first sentence only. */
/** The same short title the Review page shows, so a problem reads alike on both screens. */
export function displayTitle(title: string): string {
  return shortReviewIssueTitle(title);
}

export function codeProblem(finding: Finding): CheckProblem {
  const risk = (finding.riskLevel?.toLowerCase() as RiskLevel | undefined) ?? deriveRiskLevelWithFallback(finding.severity, finding.priority);
  return {
    key: `finding:${finding.id}`,
    kind: 'code',
    title: displayTitle(finding.title),
    location: findingLocation(finding),
    risk: risk && ['critical', 'high', 'medium', 'low'].includes(risk) ? risk : null,
    marks: ['code'],
    codeSummary: finding.description || finding.title,
    codeEvidence: finding.evidenceText || finding.location?.sourceLocator?.excerpt || undefined,
    recommendation: finding.recommendation || undefined,
    findingId: finding.id,
    requirementRef: finding.requirementId ?? null,
    needsCitationCheck: finding.location?.sourceLocator?.citationEvidence?.verification === 'needs_verification',
  };
}

function describe(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** What a fixed full-check test saw, as Expected/Observed lines. Null for tests the AI wrote. */
function fixedTestChecks(test: AutoTestEntry): Array<{ expected: string; observed: string }> | null {
  if (test.kind === 'smoke' && test.smoke) return test.smoke.pages.filter(page => !page.ok).map(page => ({ expected: `${page.path} opens without errors.`, observed: page.problem ?? 'The page showed an error.' }));
  if (test.kind === 'usability' && test.usability?.failures.length) return test.usability.failures.map(failure => ({ expected: failure.expected, observed: failure.observed }));
  return null;
}

export function browserProblem(test: AutoTestEntry): CheckProblem {
  const fixed = fixedTestChecks(test);
  const failed = (test.checkResults ?? []).filter(result => result.verdict === 'failed');
  const checks = failed.map(result => {
    const definition = test.checks.find(check => check.id === result.checkId);
    const expected = definition?.description || describe(definition?.expected) || 'The check’s expected result.';
    // The runner's internal reason is not shown as page text; it is only a fallback.
    const raw = result.observed?.trim() ?? '';
    const observed = !raw || /^expected .* absent\.?$/i.test(raw) ? 'This was not shown on the page.' : raw;
    return { expected, observed };
  });
  const ref = test.sourceRefs[0];
  return {
    key: `test:${test.id}`,
    kind: 'browser',
    title: test.name,
    location: ref ? `${ref.path}:${ref.line}` : null,
    risk: null,
    marks: ['browser'],
    browserChecks: fixed?.length ? fixed : checks.length ? checks : [{ expected: test.goal, observed: test.reason?.trim() || 'The browser test failed.' }],
    aiExplanation: test.explanation ?? null,
    testId: test.id,
    runId: test.runId,
    requirementRef: test.requirementRef,
  };
}

const byRisk = (a: CheckProblem, b: CheckProblem) => riskLevelRank(a.risk) - riskLevelRank(b.risk) || a.title.localeCompare(b.title);

function normalizeRef(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/** Requirements are counted only from saved requirement records and saved test and finding links. */
export function tallyRequirements(requirements: Requirement[], tests: AutoTestEntry[], findings: Finding[]): RequirementTally | null {
  const failedRefs = new Set<string>();
  const passedRefs = new Set<string>();
  for (const test of tests) {
    if (!test.requirementRef) continue;
    const ref = normalizeRef(test.requirementRef);
    if (test.state === 'failed') failedRefs.add(ref);
    else if (test.state === 'passed') passedRefs.add(ref);
  }
  const findingRequirementIds = new Set(findings.map(finding => finding.requirementId).filter((id): id is string => !!id));
  if (requirements.length) {
    const matches = (requirement: Requirement, refs: Set<string>) => [...refs].some(ref =>
      ref === normalizeRef(requirement.id) || normalizeRef(requirement.title).startsWith(ref) || normalizeRef(requirement.title).includes(`${ref}:`) || normalizeRef(requirement.title).includes(`(${ref})`));
    let notMet = 0; let met = 0; const notMetNames: string[] = []; const metNames: string[] = [];
    for (const requirement of requirements) {
      if (findingRequirementIds.has(requirement.id) || matches(requirement, failedRefs)) { notMet++; notMetNames.push(requirement.title); }
      else if (matches(requirement, passedRefs)) { met++; metNames.push(requirement.title); }
    }
    return { total: requirements.length, notMet, met, notChecked: requirements.length - notMet - met, notMetNames, metNames };
  }
  // Without saved requirement records, count only the requirement IDs the browser tests named.
  const all = new Set([...failedRefs, ...passedRefs]);
  if (!all.size) return null;
  const notMetNames = [...failedRefs].map(ref => ref.toUpperCase());
  const metNames = [...passedRefs].filter(ref => !failedRefs.has(ref)).map(ref => ref.toUpperCase());
  return { total: all.size, notMet: failedRefs.size, met: metNames.length, notChecked: 0, notMetNames, metNames };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function buildCheckResult(input: {
  check: CheckRecord;
  review: StaticSession | null;
  findings: Finding[];
  autoTest: AutoTestSession | null;
  requirements: Requirement[];
  evidenceAssessment?: EvidenceSufficiencyAssessment | null;
}): CheckResult {
  const { check, review, findings, autoTest, requirements } = input;
  const codeState = check.reviewId ? reviewPartState(review, true) : check.mode === 'browser' ? 'not_requested' : (check.phase === 'failed' ? 'failed' : 'not_started');
  const browserState = check.autoTestId ? browserStartupFailed(autoTest) ? 'paused' : autoTestPartState(autoTest, true) : check.mode === 'code' ? 'not_requested' : 'not_started';
  const open = findings.filter(finding => OPEN_STATUSES.has(effectiveFindingStatus(finding)));
  const foundInCode = open.map(codeProblem).sort(byRisk);
  const allTests = autoTest?.tests ?? [];
  const unitEntry = allTests.find(test => test.kind === 'unit') ?? null;
  const tests = allTests.filter(test => test.kind !== 'unit');
  const unitTests = unitEntry ? unitTestsResult(unitEntry) : null;
  const proven = tests.filter(test => test.state === 'failed').map(test => ({ ...browserProblem(test), ...(autoTest ? { testRef: { sessionId: autoTest.id, testId: test.id, reusable: !test.kind && Array.isArray(test.controls) && test.checks.length > 0 } } : {}) }));
  const passedBrowserTests = tests.filter(test => test.state === 'passed').length;

  const codeGaps: string[] = check.notes.filter(note => !/^Browser tests/i.test(note));
  const browserGaps: string[] = check.notes.filter(note => /^Browser tests/i.test(note));
  if (review && codeState === 'failed') codeGaps.push(`The code review stopped before it finished${review.failureReason ? `: ${review.failureReason}` : '.'}`);
  if (codeState === 'cancelled') codeGaps.push('The code review was stopped.');
  if (codeState === 'paused') codeGaps.push('The code review is paused because the AI provider reached a limit. Resume it from Details.');
  // Parts the review could not confirm ("Completed with gaps") are explained under How this was tested,
  // not shown beside the problems (25 Nov 2026, user request). They still count as unchecked on the card.
  const reviewLimits: string[] = [];
  if (review) {
    const gaps = reviewCoverageGaps(review);
    for (const part of gaps?.parts ?? []) reviewLimits.push(`${unverifiedPartLocation(part)}: ${unverifiedPartReason(part)}`);
    if (gaps && gaps.total > gaps.parts.length) reviewLimits.push(`${gaps.total - gaps.parts.length} more parts of the code could not be fully checked.`);
  }
  for (const gap of input.evidenceAssessment?.gaps ?? []) {
    if (gap.code === 'pdf_visual_content_unverified') codeGaps.push(gap.detail);
  }
  if (autoTest?.error && (browserState === 'failed' || browserState === 'paused')) browserGaps.push(`Browser tests ${browserState === 'paused' ? 'paused' : 'stopped'}: ${autoTest.error.message}`);
  if (browserState === 'cancelled') browserGaps.push('The browser tests were stopped.');
  for (const test of autoTest?.dropped ?? []) browserGaps.push(`Proposed browser test “${test.name}”: ${test.reason}`);
  const unitGaps: string[] = [];
  // A project without unit tests is not a gap; tests Centinel could not run are.
  if (unitEntry && ['blocked', 'not_tested'].includes(unitEntry.state) && unitEntry.unit?.present !== false) unitGaps.push(`Unit tests did not run: ${unitEntry.unit?.reason ?? unitEntry.reason ?? 'they could not start.'}`);
  // Exploration (19 Nov 2026): a gap only when it left controls it was allowed to press untried.
  const explorations = tests.filter(test => test.kind === 'exploratory' && test.exploration).map(test => test.exploration!);
  const explorationNotes: string[] = [];
  if (explorations.length) {
    const sum = (key: 'screens' | 'actions' | 'untried') => explorations.reduce((total, item) => total + item[key], 0);
    const outOfScope = Math.max(0, ...explorations.map(item => item.outOfScope ?? 0));
    const who = explorations.length === 1 ? 'The exploratory test' : `${explorations.length} exploratory runs`;
    const reached = `${who} reached ${plural(sum('screens'), 'screen')} and pressed ${plural(sum('actions'), 'control')}${explorations.length > 1 ? ' in total' : ''}.`;
    const skipped = outOfScope ? ` ${plural(outOfScope, 'control')} that need${outOfScope === 1 ? 's' : ''} typing or would order, pay, delete or send ${outOfScope === 1 ? 'is' : 'are'} never pressed by exploration.` : '';
    // Records saved before 19 Nov 2026 count a control once per screen, without separating controls exploration may not press.
    const legacy = explorations.some(item => item.seen === undefined);
    const untriedText = `${plural(sum('untried'), 'control')} it was allowed to press ${sum('untried') === 1 ? 'was' : 'were'} not tried.`;
    // An older record's count repeats controls on every screen, so it cannot show a real gap; it is a note only.
    if (sum('untried') && legacy) explorationNotes.push(`${reached} This check was saved before ORIN counted each control once, so it cannot say whether any control was left unpressed.`);
    else if (sum('untried')) browserGaps.push(`${reached} ${untriedText}${skipped}`);
    else explorationNotes.push(`${reached} It tried every control it was allowed to press.${skipped}`);
  }
  const stuckTests: StuckTest[] = [];
  for (const test of tests) {
    if (['blocked', 'not_tested', 'uncertain', 'cancelled'].includes(test.state)) {
      const why = test.state === 'uncertain' ? 'the result was unclear' : test.state === 'blocked' ? 'it could not run' : 'it did not run';
      const again = test.firstAttempt ? ', also when run a second time' : '';
      const reason = plainReason(test.reason);
      const text = `Browser test “${test.name}”: ${why}${again}${reason ? ` (${reason.replace(/\.$/, '')})` : ''}.`;
      if (test.runId) stuckTests.push({ key: `test:${test.id}`, text, runId: test.runId, name: test.name, why: `${why[0].toUpperCase()}${why.slice(1)}${again}`, reason, ...(test.kind ? { kind: test.kind } : {}), ...(test.state === 'uncertain' ? { unclear: true } : {}) });
      else browserGaps.push(text);
    }
  }

  const notChecked = [...codeGaps, ...reviewLimits, ...browserGaps, ...unitGaps];
  const finished = isTerminal(codeState) && isTerminal(browserState) && check.phase !== 'preparing';
  const total = proven.length + foundInCode.length;
  // Review limits alone are explained under How this was tested, not beside a part.
  const shownGaps = codeGaps.length + browserGaps.length + unitGaps.length + stuckTests.length > 0;
  const LIMITS_ONLY = 'Part of the code review could not be confirmed. How this was tested, at the bottom, says which.';
  let verdict: string;
  let verdictDetail: string | null = null;
  if (check.phase === 'failed') {
    verdict = 'The check could not start.';
    verdictDetail = check.error ?? null;
  } else if (!finished) {
    verdict = total ? `${plural(total, 'problem')} found so far.` : 'Checking…';
  } else if ([codeState, browserState].every(state => ['failed', 'cancelled', 'not_requested', 'not_started', 'paused'].includes(state)) && !total) {
    verdict = codeState === 'paused' || browserState === 'paused' ? 'The check is paused.' : codeState === 'cancelled' || browserState === 'cancelled' ? 'The check was stopped.' : 'The check stopped before it finished.';
    verdictDetail = 'Nothing was found before it ended. See what was not checked below.';
  } else if (!total) {
    verdict = notChecked.length ? 'The check finished with gaps.' : 'No problems found.';
    const parts = [codeState === 'done' ? 'the code' : null, browserState === 'done' ? plural(tests.length, 'browser test') : null].filter(Boolean);
    verdictDetail = notChecked.length ? (shownGaps ? 'Some parts were not checked. They are listed below.' : LIMITS_ONLY) : parts.length ? `ORIN checked ${parts.join(' and ')}.` : null;
  } else if (proven.length) {
    verdict = `${plural(total, 'problem')} found. ${proven.length} proven in the browser.`;
  } else {
    verdict = `${plural(total, 'problem')} found in the code.`;
  }
  if (finished && (notChecked.length || stuckTests.length) && check.phase !== 'failed') verdictDetail = verdictDetail ?? (shownGaps ? 'Some parts could not be checked. Each is shown with its part below.' : LIMITS_ONLY);

  return {
    unitTests,
    stuckTests,
    codeState,
    browserState,
    proven,
    foundInCode,
    passedBrowserTests,
    browserTestCount: tests.length,
    requirements: tallyRequirements(requirements, tests, open),
    notChecked,
    codeGaps,
    browserGaps,
    notes: [
      ...(reviewLimits.length ? ['The code review finished with gaps: some of what the AI proposed could not be confirmed against the exact source lines, so it is not listed as a problem.', ...reviewLimits] : []),
      ...(autoTest?.summary?.limitations ?? []),
      ...explorationNotes,
      ...(() => {
        const rerun = tests.filter(test => test.firstAttempt && test.firstAttempt.state !== 'failed' && !['blocked', 'not_tested', 'cancelled'].includes(test.state)).length;
        const confirmed = tests.filter(test => test.firstAttempt?.state === 'failed' && test.state === 'failed').length;
        return [
          ...(rerun ? [`${plural(rerun, 'browser test')} could not run the first time and ${rerun === 1 ? 'was' : 'were'} run again on a fresh copy of the app; ${rerun === 1 ? 'its' : 'their'} result comes from the second run.`] : []),
          ...(confirmed ? [`Every browser problem is run a second time on a fresh copy of the app before it is listed; ${plural(confirmed, 'problem')} failed both times.`] : []),
        ];
      })(),
    ],
    verdict,
    verdictDetail,
    finished,
  };
}

export function unitTestsResult(entry: AutoTestEntry): UnitTestsResult {
  const unit = entry.unit;
  const counts = unit?.counts;
  const skipped = counts?.skipped ? `, ${counts.skipped} skipped` : '';
  const line = entry.state === 'running' || entry.state === 'queued' ? 'Running the project\u2019s unit tests…'
    : counts && ['passed', 'failed'].includes(entry.state) ? `${counts.passed} of ${counts.total} unit tests passed${skipped}${counts.failed ? `, ${counts.failed} failed` : ''}.`
    : entry.state === 'cancelled' ? 'The unit tests were stopped.'
    : entry.state === 'failed' ? 'Some unit test files could not run.'
    : unit?.present === false ? 'This project has no unit tests.'
    : unit?.reason ? `The unit tests did not run: ${unit.reason}` : 'The unit tests did not run.';
  return { state: entry.state, line, failures: unit?.failures ?? [], failureTotal: Math.max(counts?.failed ?? 0, unit?.failures.length ?? 0) };
}

/** Cached presentation only; historical records without a known risk remain neutral. */
export function checkProblemSummary(result: CheckResult) {
  const problems = [...result.proven, ...result.foundInCode];
  const problemRisk = problems.reduce<RiskLevel | undefined>((highest, { risk }) =>
    risk && (!highest || riskLevelRank(risk) < riskLevelRank(highest)) ? risk : highest, undefined);
  return { problemCount: problems.length, problemRisk, highProblemCount: problems.filter(problem => problem.risk === 'high').length };
}

export const hasCoverageGaps = (result: CheckResult) => result.notChecked.length > 0 ||
  [result.codeState, result.browserState].some(state => state === 'cancelled' || state === 'failed' || state === 'paused');
