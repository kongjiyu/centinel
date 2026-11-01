import type { RiskLevel } from '../riskPolicy.js';
import type { ProjectReportFinding, ProjectReportSnapshot, ReportCurrentFinding } from './types.js';

/**
 * Plain-language reading of a report snapshot for non-technical readers.
 * Every value is derived from the snapshot; nothing is estimated or invented.
 * The PDF and Markdown renderers share it so both tell the same story.
 */

export type SummaryTone = 'critical' | 'warning' | 'good' | 'neutral';

export type SummaryIssue = {
  id: string;
  title: string;
  riskLevel: RiskLevel | null;
  origin: 'Code review' | 'Browser test';
  whatIsWrong: string | null;
  howToFix: string | null;
  location: string | null;
};

export type ReportSummary = {
  tone: SummaryTone;
  headline: string;
  explanation: string;
  openIssues: number;
  seriousIssues: number;
  riskCounts: Record<RiskLevel | 'unclassified', number>;
  codeReview: { label: string; tone: SummaryTone; detail: string };
  browserTest: { label: string; tone: SummaryTone; detail: string };
  requirements: null | { complete: number; incomplete: number; missing: number };
  topIssues: SummaryIssue[];
  remainingIssues: number;
  nextSteps: string[];
};

export const RISK_ORDER: Array<RiskLevel | 'unclassified'> = ['critical', 'high', 'medium', 'low', 'unclassified'];

export const RISK_LABELS: Record<RiskLevel | 'unclassified', string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unclassified: 'Not rated',
};

export const RISK_MEANINGS: Record<RiskLevel, string> = {
  critical: 'Could cause a security breach, data loss or a broken core feature. Fix before release.',
  high: 'Likely to break an important feature or expose data. Fix before release.',
  medium: 'Causes problems in some situations. Plan a fix soon.',
  low: 'Minor issue or cleanup. Fix when convenient.',
};

const CLOSED = new Set(['fixed', 'dismissed', 'resolved']);

function clip(text: string | null | undefined, max: number): string | null {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

function plural(count: number, one: string, many = one + 's'): string {
  return count + ' ' + (count === 1 ? one : many);
}

function riskRank(level: RiskLevel | null): number {
  return level ? RISK_ORDER.indexOf(level) : RISK_ORDER.length;
}

/** Pattern-rule findings ("[rule-id] ...") are prompts to verify, so explained issues come first at the same risk. */
function isRuleCheck(finding: ProjectReportFinding): boolean {
  return /^\[[\w.-]+\]/.test(finding.title);
}

/** The same issue can be open from more than one Review; show it once in the summary. */
function distinctIssues<T extends ProjectReportFinding>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = [item.title.trim().toLowerCase(), item.filePath, item.lineNumber ?? ''].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function origin(finding: ProjectReportFinding): SummaryIssue['origin'] {
  return finding.source === 'dynamic' ? 'Browser test' : 'Code review';
}

function openFindings(snapshot: ProjectReportSnapshot): Array<ProjectReportFinding | ReportCurrentFinding> {
  if (snapshot.currentFindings?.status === 'available') {
    return snapshot.currentFindings.items.filter(item => !CLOSED.has(item.effectiveDisposition));
  }
  return snapshot.riskAssessment.items.filter(item => !CLOSED.has(item.status));
}

function codeReviewStatus(snapshot: ProjectReportSnapshot): ReportSummary['codeReview'] {
  const review = snapshot.latestReview;
  if (!review) return { label: 'Not run', tone: 'neutral', detail: 'No code review has finished for this project yet.' };
  const files = review.sourceManifest.artifactCount;
  const checked = files === null ? 'Checked your project sources' : 'Checked ' + plural(files, 'file');
  const decision = review.decision?.decision;
  if (decision === 'approved') return { label: 'Approved', tone: 'good', detail: checked + ' and a reviewer approved the result.' };
  if (decision === 'changes_requested') return { label: 'Changes requested', tone: 'warning', detail: checked + '. A reviewer asked for changes.' };
  // Supabase rows carry the full Review lifecycle (pending_approval, approved, ...), wider than the legacy type.
  switch (String(review.session.status)) {
    case 'success':
    case 'pending_approval': return { label: 'Needs approval', tone: 'neutral', detail: checked + '. It is waiting for someone to approve it.' };
    case 'completed':
    case 'approved': return { label: 'Approved', tone: 'good', detail: checked + ' and a reviewer approved the result.' };
    case 'changes_requested': return { label: 'Changes requested', tone: 'warning', detail: checked + '. A reviewer asked for changes.' };
    case 'failed':
    case 'failure': return { label: 'Failed', tone: 'critical', detail: 'The review could not finish' + (review.session.failureReason ? ': ' + clip(review.session.failureReason, 140) : '.') };
    case 'blocked': return { label: 'Paused', tone: 'warning', detail: 'The review stopped before finishing and needs attention.' };
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral', detail: 'The latest review was cancelled before it finished.' };
    default: return { label: 'In progress', tone: 'neutral', detail: 'The latest review has not finished yet.' };
  }
}

function browserTestStatus(snapshot: ProjectReportSnapshot): ReportSummary['browserTest'] {
  const test = snapshot.latestDynamicTest;
  if (!test) return { label: 'Not run', tone: 'neutral', detail: 'No browser test has finished for this project yet.' };
  const steps = test.actionTrace.length;
  const failed = test.actionTrace.filter(step => /fail/i.test(step.result)).length;
  const counted = steps ? ' Recorded ' + plural(steps, 'step') + (failed ? ', ' + failed + ' failed.' : '.') : '';
  switch (test.session.status) {
    case 'success': return { label: 'Passed', tone: 'good', detail: 'The website did what the test expected.' + counted };
    case 'failure': return { label: 'Failed', tone: 'critical', detail: (clip(test.failureReason, 160) ?? 'The website did not behave as expected.') + counted };
    case 'blocked': return { label: 'Could not finish', tone: 'warning', detail: (clip(test.failureReason, 160) ?? 'The browser test stopped before reaching a result.') + counted };
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral', detail: 'The latest browser test was cancelled.' };
    default: return { label: 'In progress', tone: 'neutral', detail: 'The latest browser test has not finished yet.' };
  }
}

export function summarizeReport(snapshot: ProjectReportSnapshot): ReportSummary {
  const open = openFindings(snapshot);
  const riskCounts: ReportSummary['riskCounts'] = { critical: 0, high: 0, medium: 0, low: 0, unclassified: 0 };
  open.forEach(item => { riskCounts[item.riskLevel ?? 'unclassified'] += 1; });
  const seriousIssues = riskCounts.critical + riskCounts.high;
  const codeReview = codeReviewStatus(snapshot);
  const browserTest = browserTestStatus(snapshot);
  const traceability = snapshot.latestReview?.traceability;
  const requirements = traceability?.status === 'available' && traceability.summary
    ? { complete: traceability.summary.complete, incomplete: traceability.summary.incomplete, missing: traceability.summary.missing }
    : null;

  const sorted = distinctIssues([...open].sort((a, b) => riskRank(a.riskLevel) - riskRank(b.riskLevel)
    || Number(isRuleCheck(a)) - Number(isRuleCheck(b)) || a.title.localeCompare(b.title)));
  const topIssues: SummaryIssue[] = sorted.slice(0, 5).map(item => ({
    id: item.id,
    title: item.title,
    riskLevel: item.riskLevel,
    origin: origin(item),
    whatIsWrong: clip(item.description, 420),
    howToFix: clip(item.recommendation, 320),
    location: item.filePath ? item.filePath + (item.lineNumber ? ':' + item.lineNumber : '') : null,
  }));

  let tone: SummaryTone;
  let headline: string;
  let explanation: string;
  const nothingRan = !snapshot.latestReview && !snapshot.latestDynamicTest;
  if (seriousIssues > 0) {
    tone = 'critical';
    headline = 'Fix before release';
    explanation = 'Centinel found ' + plural(seriousIssues, 'serious issue') + ' (critical or high risk) that ' + (seriousIssues === 1 ? 'is' : 'are') + ' still open.';
  } else if (nothingRan) {
    tone = 'neutral';
    headline = 'Not checked yet';
    explanation = 'No code review or browser test has finished, so there is no result to report yet.';
  } else if (open.length > 0 || codeReview.tone === 'critical' || codeReview.tone === 'warning' || browserTest.tone === 'critical' || browserTest.tone === 'warning') {
    tone = 'warning';
    headline = 'Needs attention';
    const reasons: string[] = [];
    if (open.length) reasons.push('There ' + (open.length === 1 ? 'is ' : 'are ') + plural(open.length, 'open issue') + ' to look at.');
    if (browserTest.tone === 'critical') reasons.push('The latest browser test failed.');
    else if (browserTest.tone === 'warning') reasons.push('The latest browser test could not finish.');
    if (codeReview.tone === 'critical') reasons.push('The latest code review failed.');
    else if (codeReview.tone === 'warning') reasons.push('The latest code review needs follow-up.');
    explanation = 'No serious issues are open. ' + reasons.join(' ');
  } else {
    tone = 'good';
    headline = 'Looking good';
    explanation = 'No open issues were found in the latest checks.';
  }

  const nextSteps: string[] = [];
  for (const issue of topIssues.filter(item => item.riskLevel === 'critical' || item.riskLevel === 'high').slice(0, 2)) {
    nextSteps.push('Fix "' + clip(issue.title, 90) + '"' + (issue.howToFix ? ': ' + clip(issue.howToFix, 150) : '.'));
  }
  if (browserTest.tone === 'critical' || browserTest.tone === 'warning') {
    nextSteps.push('Look at why the browser test "' + clip(snapshot.latestDynamicTest?.session.name, 70) + '" did not pass, fix it, then run it again.');
  }
  if (codeReview.tone === 'critical') nextSteps.push('Run the code review again after checking why it failed.');
  if (!snapshot.latestReview) nextSteps.push('Run a code review so Centinel can check your source files.');
  if (!snapshot.latestDynamicTest) nextSteps.push('Run a browser test so Centinel can check your website in a real browser.');
  if (['success', 'pending_approval'].includes(snapshot.latestReview?.session.status ?? '') && !snapshot.latestReview?.decision) nextSteps.push('Open the latest code review and approve it or request changes.');
  if (requirements && requirements.missing > 0) nextSteps.push('Link ' + plural(requirements.missing, 'requirement') + ' to the code that implements ' + (requirements.missing === 1 ? 'it' : 'them') + ', so Centinel can check coverage.');
  if (nextSteps.length < 3 && open.length > seriousIssues) nextSteps.push('Work through the ' + plural(open.length - seriousIssues, 'remaining medium or low issue') + ' listed below.');
  if (!nextSteps.length) nextSteps.push('Run a new review and browser test after your next change to keep this result up to date.');

  return {
    tone, headline, explanation,
    openIssues: open.length,
    seriousIssues,
    riskCounts,
    codeReview,
    browserTest,
    requirements,
    topIssues,
    remainingIssues: Math.max(0, sorted.length - topIssues.length),
    nextSteps: nextSteps.slice(0, 3),
  };
}

/** Human-readable UTC timestamp, e.g. "1 Nov 2026, 07:31 UTC". */
export function friendlyDate(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return parsed.getUTCDate() + ' ' + months[parsed.getUTCMonth()] + ' ' + parsed.getUTCFullYear()
    + ', ' + pad(parsed.getUTCHours()) + ':' + pad(parsed.getUTCMinutes()) + ' UTC';
}
