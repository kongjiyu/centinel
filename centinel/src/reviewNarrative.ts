import { harnessStepState, type HarnessEvent, type ReviewHarnessTrace } from './reviewHarness';
import { normalizeReviewStages, parseReviewProgress, reviewLifecycleState, reviewObjective } from './reviewViewModel';
import { reviewFailureMessage } from './utils/userFacingError';
import type { EvidenceSufficiencyAssessment, Finding, ReviewDecisionRecord, ReviewTraceabilitySnapshot, StaticSession } from './types';

export type ReviewAspect = 'Security' | 'Business rules' | 'Technical';
export type FindingLink = { id: string; label: string; aspect: ReviewAspect };
export type NarrativeStage = { id: string; title: string; state: string; purpose: string; outcome: string; duration: string; findings: FindingLink[] };
export type ReviewNarrative = {
  objectives: string[]; stages: NarrativeStage[]; unassignedFindings: FindingLink[];
  summary: { outcome: string; blockers: string[]; next: string };
  timing: { duration: string; completedAt: string | null };
  detailedHistoryAvailable: boolean;
};

const STAGES = [
  { id: 'freezing_sources', title: 'Check the documents', plan: 'I’ll start with the files and business requirements, so I know what this review can cover.', past: 'I started with the files and business requirements to establish what this review could cover.' },
  { id: 'indexing_context', title: 'Understand the change', plan: 'Next, I’ll bring together the relevant parts of the files and the agreed rules.', past: 'I brought together the relevant parts of the files and the agreed rules before checking the implementation.' },
  { id: 'deterministic_analysis', title: 'Check for common issues', plan: 'I’ll look for common security and code quality issues first.', past: 'I checked for common security and code quality issues first.' },
  { id: 'model_analysis', title: 'Review the behaviour', plan: 'Then I’ll compare the implementation with the available requirements and look for behaviour that may need attention.', past: 'I compared the implementation with the available requirements and looked for behaviour that may need attention.' },
  { id: 'persisting_evidence', title: 'Prepare the findings', plan: 'Finally, I’ll check the references and bring the findings together for your review.', past: 'I checked the references and brought the findings together for your review.' },
];

export function objectivePoints(value: string | null): string[] {
  if (!value?.trim()) return [];
  return value.split(/\r?\n/).flatMap(line => line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(item => item.trim()).filter(Boolean));
}

/** Simplify presentation only; the objective dialog retains the original instructions. */
export function plainReviewText(value: string): string {
  return value
    .replace(/\bat (?:frozen )?revision [a-f0-9]{7,40}\b/gi, 'at the selected version')
    .replace(/\bfrozen revision\b/gi, 'selected version')
    .replace(/\bin acceptance_requirements\.md\b/gi, 'in the acceptance criteria')
    .replace(/\bintegration cassette/gi, 'integration test examples')
    .replace(/persistence\/cursor atomicity/gi, 'saving data and updating progress together')
    .replace(/persistence and cursor atomicity/gi, 'saving data and updating progress together')
    .replace(/prompt\/parser consistency/gi, 'agreement between the instructions and the implementation')
    .replace(/\bparser\b(?!\.)/gi, 'input handling')
    .replace(/\bprompt\b(?!\.)/gi, 'instructions')
    .replace(/\bmalformed\b/gi, 'invalid')
    .replace(/ordinary uppercase details/gi, 'capital letters in the original text')
    .replace(/before persistence/gi, 'before saving data')
    .replace(/evidence-backed (?:actionable )?defects/gi, 'issues supported by evidence')
    .replace(/Distinguish code inspection from runtime verification/gi, 'Make clear which conclusions come from reading the code and which were checked by running it')
    .replace(/\btraceability\b/gi, 'requirement coverage')
    .replace(/\btriage\b/gi, 'review').replace(/\bremediation\b/gi, 'fixing')
    .replace(/\bfrozen sources\b/gi, 'selected files');
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function timestamp(value: unknown): number | null { const result = Date.parse(text(value)); return Number.isFinite(result) ? result : null; }
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
export function formatReviewDuration(ms: number | null): string {
  if (ms == null || ms < 0) return 'Not recorded';
  if (ms < 1000) return 'Less than 1s';
  const seconds = Math.floor(ms / 1000);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`
    : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
/** Wall-clock boundaries avoid adding nested/parallel step durations twice. */
function executionTiming(events: HarnessEvent[], active: boolean, now: number) {
  const starts: number[] = []; const ends: number[] = [];
  for (const event of events) {
    const time = timestamp(event.createdAt);
    if (time == null || !event.event.startsWith('harness_step_')) continue;
    if (event.event === 'harness_step_started') starts.push(time);
    else {
      ends.push(time);
      const duration = event.detail?.durationMs;
      if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) starts.push(time - duration);
    }
  }
  const start = starts.length ? Math.min(...starts) : null;
  const end = active ? now : ends.length ? Math.max(...ends) : null;
  return { ms: start != null && end != null && end >= start ? end - start : null, end: !active && end != null ? new Date(end).toISOString() : null };
}
export function reviewAspect(category: string): ReviewAspect {
  if (/secur|secret|auth|credential|injection|privacy/i.test(category)) return 'Security';
  if (/business|requirement|traceability|approval|policy|document/i.test(category)) return 'Business rules';
  return 'Technical';
}
function findingLink(finding: Finding): FindingLink {
  const label = finding.evidenceGap ? finding.title
    : /^\[cq-deep-nesting\]/.test(finding.title) ? 'Code is difficult to follow'
      : /^\[secrets-/.test(finding.title) ? 'Possible exposed credential' : plainReviewText(finding.title);
  return { id: finding.id, label, aspect: reviewAspect(finding.category) };
}
export function buildReviewNarrative(input: {
  session: StaticSession; trace?: ReviewHarnessTrace | null; findings: Finding[];
  findingsError?: string | null; assessment?: EvidenceSufficiencyAssessment | null;
  traceability?: ReviewTraceabilitySnapshot | null; decision?: ReviewDecisionRecord | null; now?: number;
}): ReviewNarrative {
  const { session, findings, findingsError, assessment, traceability } = input;
  const trace = input.trace?.review.id === session.id ? input.trace : null;
  const decision = input.decision ?? session.currentDecision ?? null;
  const state = reviewLifecycleState(session, decision);
  const active = state === 'Queued' || state === 'In progress';
  const now = input.now ?? Date.now();
  const events = trace?.events.filter(event => event.reviewId === session.id) ?? [];
  const detailedHistoryAvailable = events.some(event => event.event.startsWith('harness_step_'));
  const progress = parseReviewProgress(session.progressJson);
  const grounding = events.find(event => event.event === 'harness_step_completed' && event.detail?.step === 'load_grounding');
  const groundingOutput = grounding?.detail?.output as Record<string, unknown> | undefined;
  const requirementCount = groundingOutput?.confirmedRequirements ?? assessment?.confirmedRequirementCount
    ?? (traceability?.status === 'available' ? traceability.records.length : null);
  const incompleteModel = ['failed', 'partial'].includes(trace?.review.modelStatus ?? '');
  const stageOf = (finding: Finding): string | null => {
    if (finding.evidenceGap) return 'freezing_sources';
    if (finding.verifier === 'deterministic') return 'deterministic_analysis';
    if (finding.verifier === 'model') return 'model_analysis';
    return null;
  };
  const stages: NarrativeStage[] = detailedHistoryAvailable ? STAGES.map(stage => {
    const related = events.filter(event => event.stage === stage.id);
    const steps = unique(related.map(event => text(event.detail?.step)));
    const outcomes = steps.map(step => harnessStepState(related, step, !active));
    let status = outcomes.includes('Failed') ? 'Failed' : outcomes.includes('Cancelled') ? 'Cancelled'
      : outcomes.includes('Interrupted') ? 'Interrupted' : outcomes.includes('In progress') ? 'In progress'
        : outcomes.length ? 'Completed' : findings.some(finding => stageOf(finding) === stage.id) ? 'Not recorded' : active ? 'Not started' : 'Not reached';
    if (stage.id === 'model_analysis' && incompleteModel && status === 'Completed') status = 'Incomplete';
    const completed = status === 'Completed';
    let outcome = completed ? '' : status === 'In progress' ? 'I’m working through this part now.'
      : status === 'Not recorded' ? 'Saved findings are available, but the checks for this part were not recorded.'
        : status === 'Not started' ? 'This part is waiting for the earlier checks.' : status === 'Not reached' ? 'The review ended before this part was reached.'
        : 'I couldn’t finish this part. The review needs attention before continuing.';
    if (stage.id === 'freezing_sources') {
      const reads = new Map<string, HarnessEvent>();
      for (const event of related.filter(event => event.event === 'harness_step_completed' && event.detail?.step === 'read_source')) reads.set(text(event.detail?.executionId) || event.createdAt, event);
      if (completed && reads.size) outcome = `I could read ${reads.size} selected file${reads.size === 1 ? '' : 's'}.`;
      if (requirementCount === 0) outcome += ' I couldn’t confirm the business requirements, so that part of the review is limited.';
    }
    if (stage.id === 'model_analysis' && incompleteModel) outcome = 'The behaviour review is incomplete. The earlier checks are still available, but they don’t replace this part.';
    if (stage.id === 'persisting_evidence' && completed) outcome = 'The findings are ready for you to inspect in Findings.';
    return { id: stage.id, title: stage.title, state: status, purpose: completed ? stage.past : ['In progress', 'Not started'].includes(status) ? stage.plan : '', outcome,
      duration: formatReviewDuration(executionTiming(related, status === 'In progress', now).ms), findings: findings.filter(finding => stageOf(finding) === stage.id).map(findingLink) };
  }) : normalizeReviewStages(progress).filter(stage => stage.id !== 'legacy').map(stage => ({
    id: stage.id, title: stage.label, state: stage.status === 'done' ? 'Completed' : stage.status === 'active' ? 'In progress' : stage.status === 'failed' ? 'Failed' : 'Not started',
    purpose: '', outcome: stage.summary ? plainReviewText(stage.summary) : 'The saved review has no further explanation for this part.', duration: 'Not recorded', findings: [],
  }));

  const blockers: string[] = [];
  if (session.failureReason) blockers.push(reviewFailureMessage(session.failureReason));
  if (incompleteModel) blockers.push('The behaviour review could not be completed.');
  if (findingsError) blockers.push('I couldn’t load the findings. Reopen this review before making a decision.');
  if (assessment) blockers.push(...assessment.gaps.map(gap => plainReviewText(`${gap.title}. ${gap.remediation}`)));
  if (requirementCount === 0) blockers.push(findings.some(finding => finding.evidenceGap) ? 'The business requirements need confirmation. This is listed in Findings.' : 'The business requirements need confirmation before their behaviour can be checked.');
  if (!detailedHistoryAvailable) blockers.push('The detailed activity history is unavailable, so I can’t confirm every check that ran.');
  const open = findings.filter(finding => !['dismissed', 'fixed'].includes(finding.status)).length;
  const totals = findingsError ? 'The finding count is unavailable.' : `There ${findings.length === 1 ? 'is' : 'are'} ${findings.length} finding${findings.length === 1 ? '' : 's'} for this review; ${open} still need${open === 1 ? 's' : ''} attention.`;
  const outcome = active ? 'I’m still reviewing the files. The results may change as the remaining checks finish.'
    : state === 'Paused' ? `I paused the review because the Model Provider blocked the request. ${totals}`
    : state === 'Failed' ? `I couldn’t finish the review. ${totals}` : state === 'Blocked' ? `I need better supporting information before this review can continue. ${totals}`
      : state === 'Cancelled' ? 'The review was stopped. The completed checks are still available.'
        : `${incompleteModel ? 'I could only complete part of the review.' : 'I’ve finished the review.'} ${totals} ${state === 'Completed' ? 'You approved this review.' : decision?.decision === 'changes_requested' ? 'You requested changes.' : 'It is waiting for your decision.'}`;
  const next = active ? 'Wait for the remaining checks, or stop the review if you need to change its scope.'
    : state === 'Paused' ? 'Check the provider limit or billing issue above, then retry manually. Automatic retries are stopped.'
    : state === 'Failed' || state === 'Blocked' ? 'Address the issue listed above, then retry the review.'
      : state === 'Cancelled' ? 'Check what you want reviewed, then retry when you’re ready.'
        : state === 'Completed' ? 'Follow up on any open findings. Approving a review does not fix them.'
          : decision?.decision === 'changes_requested' ? 'Address the requested changes, then start the revised review.'
            : 'Open the findings, check the concerns and document gaps, then approve the review or request changes.';
  const timing = executionTiming(events, active && state !== 'Queued', now);
  const legacyStart = timestamp(progress?.startedAt);
  const legacyEnd = active ? now : timestamp(progress?.updatedAt);
  const durationMs = timing.ms ?? (legacyStart != null && legacyEnd != null && legacyEnd >= legacyStart ? legacyEnd - legacyStart : null);
  return {
    objectives: objectivePoints(reviewObjective(session)).map(plainReviewText), stages, detailedHistoryAvailable,
    unassignedFindings: findings.filter(finding => !detailedHistoryAvailable || !stageOf(finding)).map(findingLink),
    timing: { duration: formatReviewDuration(durationMs), completedAt: active ? null : timing.end ?? (legacyStart != null ? progress?.updatedAt ?? null : null) },
    summary: { outcome, blockers: unique(blockers), next },
  };
}
