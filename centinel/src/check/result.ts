import type { AutoTestEntry, AutoTestSession } from '../autotest/types';
import { shortReviewIssueTitle } from '../components/ReviewIssues';
import { isActive as autoTestActive } from '../autotest/types';
import { effectiveFindingStatus } from '../findingStatus';
import { reviewCoverageGaps, unverifiedPartLocation, unverifiedPartReason } from '../reviewCoverage';
import { parseReviewProgress } from '../reviewViewModel';
import { deriveRiskLevelWithFallback, riskLevelRank, type RiskLevel } from '../riskPolicy';
import type { Finding, Requirement, StaticSession } from '../types';
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
  runId?: string;
  requirementRef?: string | null;
  needsCitationCheck?: boolean;
};

export type RequirementTally = { total: number; notMet: number; met: number; notChecked: number; notMetNames: string[]; metNames?: string[] };

export type PartState = 'not_requested' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled' | 'not_started';

export type CheckResult = {
  codeState: PartState;
  browserState: PartState;
  proven: CheckProblem[];
  foundInCode: CheckProblem[];
  passedBrowserTests: number;
  browserTestCount: number;
  requirements: RequirementTally | null;
  notChecked: string[];
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

export function browserProblem(test: AutoTestEntry): CheckProblem {
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
    browserChecks: checks.length ? checks : [{ expected: test.goal, observed: test.reason?.trim() || 'The browser test failed.' }],
    aiExplanation: test.explanation ?? null,
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
}): CheckResult {
  const { check, review, findings, autoTest, requirements } = input;
  const codeState = check.reviewId ? reviewPartState(review, true) : check.mode === 'browser' ? 'not_requested' : (check.phase === 'failed' ? 'failed' : 'not_started');
  const browserState = check.autoTestId ? autoTestPartState(autoTest, true) : check.mode === 'code' ? 'not_requested' : 'not_started';
  const open = findings.filter(finding => OPEN_STATUSES.has(effectiveFindingStatus(finding)));
  const foundInCode = open.map(codeProblem).sort(byRisk);
  const tests = autoTest?.tests ?? [];
  const proven = tests.filter(test => test.state === 'failed').map(browserProblem);
  const passedBrowserTests = tests.filter(test => test.state === 'passed').length;

  const notChecked: string[] = [...check.notes];
  if (review && codeState === 'failed') notChecked.push(`The code review stopped before it finished${review.failureReason ? `: ${review.failureReason}` : '.'}`);
  if (codeState === 'cancelled') notChecked.push('The code review was stopped.');
  if (codeState === 'paused') notChecked.push('The code review is paused because the AI provider reached a limit. Resume it from Details.');
  if (review) {
    const gaps = reviewCoverageGaps(review);
    for (const part of gaps?.parts ?? []) notChecked.push(`${unverifiedPartLocation(part)}: ${unverifiedPartReason(part)}`);
    if (gaps && gaps.total > gaps.parts.length) notChecked.push(`${gaps.total - gaps.parts.length} more parts of the code could not be fully checked.`);
  }
  if (autoTest?.error && browserState === 'failed') notChecked.push(`Browser tests stopped: ${autoTest.error.message}`);
  if (browserState === 'cancelled') notChecked.push('The browser tests were stopped.');
  for (const test of tests) {
    if (['blocked', 'not_tested', 'uncertain', 'cancelled'].includes(test.state)) {
      const why = test.state === 'uncertain' ? 'the result was unclear' : test.state === 'blocked' ? 'it could not run' : 'it did not run';
      notChecked.push(`Browser test “${test.name}”: ${why}${test.reason ? ` (${test.reason})` : ''}.`);
    }
  }

  const finished = isTerminal(codeState) && isTerminal(browserState) && check.phase !== 'preparing';
  const total = proven.length + foundInCode.length;
  let verdict: string;
  let verdictDetail: string | null = null;
  if (check.phase === 'failed') {
    verdict = 'The check could not start.';
    verdictDetail = check.error ?? null;
  } else if (!finished) {
    verdict = total ? `${plural(total, 'problem')} found so far.` : 'Checking…';
  } else if ([codeState, browserState].every(state => ['failed', 'cancelled', 'not_requested', 'not_started', 'paused'].includes(state)) && !total) {
    verdict = codeState === 'paused' ? 'The check is paused.' : codeState === 'cancelled' || browserState === 'cancelled' ? 'The check was stopped.' : 'The check stopped before it finished.';
    verdictDetail = 'Nothing was found before it ended. See what was not checked below.';
  } else if (!total) {
    verdict = 'No problems found.';
    const parts = [codeState === 'done' ? 'the code' : null, browserState === 'done' ? plural(tests.length, 'browser test') : null].filter(Boolean);
    verdictDetail = parts.length ? `ORIN checked ${parts.join(' and ')}.` : null;
  } else if (proven.length) {
    verdict = `${plural(total, 'problem')} found. ${proven.length} proven in the browser.`;
  } else {
    verdict = `${plural(total, 'problem')} found in the code.`;
  }
  if (finished && notChecked.length && check.phase !== 'failed') verdictDetail = verdictDetail ?? 'Some parts were not checked. They are listed below.';

  return {
    codeState,
    browserState,
    proven,
    foundInCode,
    passedBrowserTests,
    browserTestCount: tests.length,
    requirements: tallyRequirements(requirements, tests, open),
    notChecked,
    notes: autoTest?.summary?.limitations ?? [],
    verdict,
    verdictDetail,
    finished,
  };
}

/** Cached presentation only; historical records without a known risk remain neutral. */
export function checkProblemSummary(result: CheckResult) {
  const problems = [...result.proven, ...result.foundInCode];
  const problemRisk = problems.reduce<RiskLevel | undefined>((highest, { risk }) =>
    risk && (!highest || riskLevelRank(risk) < riskLevelRank(highest)) ? risk : highest, undefined);
  return { problemCount: problems.length, problemRisk, highProblemCount: problems.filter(problem => problem.risk === 'high').length };
}
