import { harnessStepState, type HarnessEvent, type ReviewHarnessTrace } from './reviewHarness';
import { normalizeReviewStages, parseReviewProgress, reviewLifecycleState, reviewObjective } from './reviewViewModel';
import { reviewFailureMessage } from './utils/userFacingError';
import { featureDisplayName } from './reviewFeatures';
import { groupFindings } from './findingGroups';
import type { EvidenceSufficiencyAssessment, Finding, ReviewDecisionRecord, ReviewTraceabilitySnapshot, StaticSession } from './types';

export type ReviewAspect = 'Security' | 'Business rules' | 'Technical' | 'Human error';
export type FindingLink = { id: string; label: string; aspect: ReviewAspect; filePath?: string; lineNumber?: number; memberIds?: string[] };
export type NarrativeStage = { id: string; title: string; state: string; focus?: string; goal?: string; next: string; outcome: string; recap?: string; duration: string; findings: FindingLink[]; checks?: string[]; files?: string[]; features?: Array<{ id: string; summary: string; path?: string; line?: number }> };
export type ReviewNarrative = {
  objectives: string[]; stages: NarrativeStage[]; unassignedFindings: FindingLink[];
  summary: { outcome: string; blockers: string[]; next: string };
  timing: { duration: string; endedAt: string | null };
  detailedHistoryAvailable: boolean;
  reviewedSourceCount?: number;
  /** Queued or running: missing history means not started yet, not lost. */
  active?: boolean;
};

export const REVIEW_WORKFLOW_STAGES = [
  { id: 'freezing_sources', title: 'Check the documents', focus: 'Selected file versions and confirmed requirements.', goal: 'Record what this Review can assess and where evidence is missing.' },
  { id: 'indexing_context', title: 'Understand the change', focus: 'Relevant code, its dependencies, and the agreed rules.', goal: 'Gather the context needed to check the selected implementation.' },
  { id: 'deterministic_analysis', title: 'Check for common issues', focus: 'Known security and code quality patterns.', goal: 'Record potential issues with supporting locations.' },
  { id: 'model_analysis', title: 'Review the behaviour', focus: 'How the selected code behaves against the available requirements and rules.', goal: 'Identify behaviour gaps and record what remains unverified.' },
  { id: 'persisting_evidence', title: 'Prepare the findings', focus: 'Finding references, coverage, and related earlier issues.', goal: 'Save the results and evidence for human review.' },
];

const publicChecks: Record<string, { focus: string; result: string }> = {
  select_sources: { focus: 'Select the files within the Review scope.', result: 'The source selection was recorded.' },
  freeze_manifest: { focus: 'Freeze the selected inputs so evidence can be reopened later.', result: 'The source snapshot was saved.' },
  read_source: { focus: 'Read the selected files from the saved source.', result: 'Source content was read.' },
  load_grounding: { focus: 'Load confirmed requirements and coding rules for comparison.', result: 'The available rules and requirements were loaded.' },
  index_sources: { focus: 'Prepare source search for the selected files.', result: 'Source search preparation finished.' },
  retrieve_context: { focus: 'Gather relevant source and rules for the behaviour checks.', result: 'The context search finished.' },
  run_rules: { focus: 'Check the code against built-in rules.', result: 'The rule checks finished.' },
  map_feature_paths: { focus: 'Identify supported paths through the selected features.', result: 'The feature path map was prepared.' },
  run_model: { focus: 'Assess a batch of selected behaviour or source files.', result: 'The batch returned an assessment for validation.' },
  validate_response: { focus: 'Check the assessment against the expected format.', result: 'The response format check finished.' },
  validate_source_evidence: { focus: 'Compare cited locations against the frozen source.', result: 'The source reference check finished.' },
  challenge_support: { focus: 'Check whether the cited evidence supports a proposed finding.', result: 'The evidence support check finished.' },
  save_findings: { focus: 'Save findings with their reviewed evidence.', result: 'The findings write finished.' },
  correlate_findings: { focus: 'Compare current findings against earlier project observations.', result: 'The comparison finished.' },
};

function describeChecks(events: HarnessEvent[], steps: string[], terminal: boolean) {
  return steps.flatMap(step => {
    const description = publicChecks[step];
    if (!description) return [];
    const status = harnessStepState(events, step, terminal);
    const result = status === 'Completed' ? description.result
      : status === 'In progress' ? 'This check is in progress.' : 'This check did not complete.';
    return [`${description.focus} ${result}`];
  });
}

function stageNext(state: string, hasFindings: boolean, missingRequirements = false): string {
  if (missingRequirements && state === 'Completed') return 'Confirm the relevant requirements before a follow-up Review.';
  if (hasFindings) return 'Inspect the saved findings below.';
  if (state === 'In progress' || state === 'Not started') return 'No action needed while the Review runs.';
  if (state === 'Completed') return 'No action needed for this stage.';
  return 'Check the Review status above for the next step.';
}

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
/**
 * No recorded step can run silently for longer than the 30-minute maximum AI
 * generation deadline, so a longer gap between events means the Review was not
 * running (for example, the computer was off until lease recovery resumed it).
 */
export const REVIEW_IDLE_GAP_MS = 35 * 60 * 1000;

/**
 * Active run time: wall-clock between recorded step boundaries (so nested or
 * parallel steps are not added twice), excluding idle gaps longer than
 * REVIEW_IDLE_GAP_MS.
 */
export function executionTiming(events: HarnessEvent[], active: boolean, now: number) {
  const points: number[] = []; const ends: number[] = [];
  for (const event of events) {
    const time = timestamp(event.createdAt);
    if (time == null || !event.event.startsWith('harness_step_')) continue;
    points.push(time);
    if (event.event !== 'harness_step_started') {
      ends.push(time);
      const duration = event.detail?.durationMs;
      if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) points.push(time - duration);
    }
  }
  const end = active ? now : ends.length ? Math.max(...ends) : null;
  if (!points.length || end == null) return { ms: null, end: null };
  const sorted = [...points.filter(point => point <= end), end].sort((a, b) => a - b);
  let ms = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap <= REVIEW_IDLE_GAP_MS) ms += gap;
  }
  return { ms, end: !active ? new Date(end).toISOString() : null };
}
export function reviewAspect(category: string): ReviewAspect {
  if (/personnel|human.error|usability|user.experience/i.test(category)) return 'Human error';
  if (/secur|secret|auth|credential|injection|privacy/i.test(category)) return 'Security';
  if (/business|requirement|traceability|approval|policy|document/i.test(category)) return 'Business rules';
  return 'Technical';
}
function findingLink(finding: Finding): FindingLink {
  const label = finding.evidenceGap ? finding.title
    : /^\[cq-deep-nesting\]/.test(finding.title) ? 'Code is difficult to follow'
      : /^\[secrets-/.test(finding.title) ? 'Possible exposed credential' : plainReviewText(finding.title);
  return {
    id: finding.id, label, aspect: reviewAspect(finding.category),
    ...(finding.filePath ? { filePath: finding.filePath } : {}),
    ...(typeof finding.lineNumber === 'number' && finding.lineNumber > 0 ? { lineNumber: finding.lineNumber } : {}),
  };
}
export function buildReviewNarrative(input: {
  session: StaticSession; trace?: ReviewHarnessTrace | null; findings: Finding[];
  findingsError?: string | null; findingsLoading?: boolean; assessment?: EvidenceSufficiencyAssessment | null;
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
  const comparisonEvent = [...events].reverse().find(event => event.event === 'harness_step_completed' && event.detail?.step === 'correlate_findings');
  const comparisonOutput = comparisonEvent?.detail?.output as { checkedProjectHistory?: boolean; counts?: Record<string, unknown> | null; ambiguousCount?: unknown } | undefined;
  let comparisonSummary = '';
  if (comparisonOutput?.checkedProjectHistory === true) {
    const counts = comparisonOutput.counts;
    const keys = ['new', 'recurring', 'regressed', 'resolved', 'carried_over'];
    if (counts && keys.every(key => Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0)) {
      comparisonSummary = `I compared the findings with earlier reviews: ${counts.new} new, ${Number(counts.recurring) + Number(counts.regressed)} reported again, ${counts.resolved} not reproduced after comparable source changes, and ${counts.carried_over} still need verification.`;
      if (Number.isSafeInteger(comparisonOutput.ambiguousCount) && Number(comparisonOutput.ambiguousCount) > 0) comparisonSummary += ` ${comparisonOutput.ambiguousCount} uncertain matches need your review.`;
    } else if (counts === null) comparisonSummary = 'No earlier completed review was suitable for comparison. Existing unverified findings remain open.';
  }
  const stageOf = (finding: Finding): string | null => {
    if (finding.evidenceGap) return 'freezing_sources';
    if (finding.verifier === 'deterministic') return 'deterministic_analysis';
    if (finding.verifier === 'model') return 'model_analysis';
    return null;
  };
  const groupedFindings = groupFindings(findings).map(group => {
    const finding = group.representative;
    const link = findingLink(finding);
    return {
      stage: stageOf(finding),
      link: {
        ...link,
        label: group.title === finding.title ? link.label : group.title,
        ...(group.members.length > 1 ? { memberIds: group.members.map(member => member.id) } : {}),
      },
    };
  });
  const stages: NarrativeStage[] = detailedHistoryAvailable ? REVIEW_WORKFLOW_STAGES.map(stage => {
    const related = events.filter(event => event.stage === stage.id);
    const steps = unique(related.map(event => text(event.detail?.step)));
    const outcomes = steps.map(step => harnessStepState(related, step, !active));
    let status = outcomes.includes('Failed') ? 'Failed' : outcomes.includes('Cancelled') ? 'Cancelled'
      : outcomes.includes('Interrupted') ? 'Interrupted' : outcomes.includes('In progress') ? 'In progress'
        : outcomes.length ? 'Completed' : findings.some(finding => stageOf(finding) === stage.id) ? 'Not recorded' : active ? 'Not started' : 'Not reached';
    if (active && status === 'Completed' && progress?.stage === stage.id && !progress.completedStages?.includes(stage.id)) status = 'In progress';
    if (active && stage.id === 'freezing_sources' && status === 'Completed' && !related.some(event => event.event === 'harness_step_completed' && event.detail?.step === 'save_assessment')) status = 'In progress';
    if (stage.id === 'model_analysis' && incompleteModel && status === 'Completed') status = 'Incomplete';
    const completed = status === 'Completed';
    let outcome = completed || status === 'In progress' || status === 'Not started' ? ''
      : status === 'Not recorded' ? 'Saved findings are available, but the checks for this part were not recorded.'
        : status === 'Not reached' ? 'The review ended before this part was reached.'
        : 'I couldn’t finish this part. The review needs attention before continuing.';
    if (stage.id === 'freezing_sources') {
      const reads = new Map<string, HarnessEvent>();
      for (const event of related.filter(event => event.event === 'harness_step_completed' && event.detail?.step === 'read_source')) reads.set(text(event.detail?.executionId) || event.createdAt, event);
      if (completed && reads.size) outcome = `I could read ${reads.size} selected file${reads.size === 1 ? '' : 's'}.`;
      if (completed && requirementCount === 0) outcome = `${outcome} I couldn’t confirm the business requirements, so that part of the review is limited.`.trim();
    }
    if (stage.id === 'model_analysis' && incompleteModel) outcome = 'The behaviour review is incomplete. The earlier checks are still available, but they don’t replace this part.';
    const batchStarts = related.filter(event => event.event === 'harness_step_started' && event.detail?.step === 'run_model');
    const submittedFeatureIds = new Set(batchStarts.flatMap(event => {
      const input = event.detail?.input as { featureIds?: unknown } | undefined;
      return Array.isArray(input?.featureIds) ? input.featureIds.filter(id => typeof id === 'string') : [];
    }));
    const features = stage.id === 'model_analysis' && trace?.review.id === session.id
      ? (trace.analysisMap?.features ?? []).flatMap(feature => {
        const assessed = feature.assessments.filter(item => item.status === 'assessed');
        const location = feature.entryPoints[0];
        const name = featureDisplayName(feature.label);
        if (!assessed.length) {
          if (!submittedFeatureIds.has(feature.id)) return [];
          const paths = feature.paths.map(path => ({
            id: path.id, path: path.evidence[0]?.filePath, line: path.evidence[0]?.lineNumber,
            summary: `The behaviour check for ${name} includes “${path.label}”. Its assessment is pending validation.`,
          }));
          return paths.length ? paths : [{ id: feature.id, path: location?.filePath, line: location?.lineNumber,
            summary: `The behaviour check for ${name} has started. Its assessment is pending validation.` }];
        }
        return assessed.map(assessment => ({
          id: `${feature.id}:${assessment.domain}`, path: location?.filePath, line: location?.lineNumber,
          summary: `${name} · ${reviewAspect(assessment.domain)}. ${plainReviewText(assessment.summary)}`,
        }));
      }) : [];
    if (completed && features.length && !outcome) outcome = `Recorded ${features.length} domain assessments across the selected features. The results and their supporting evidence went to the findings stage.`;
    if (stage.id === 'persisting_evidence' && completed) outcome = comparisonSummary || 'The findings are ready for you to inspect in Findings.';
    const stageFindings = groupedFindings.filter(finding => finding.stage === stage.id).map(finding => finding.link);
    const files = stage.id === 'freezing_sources' ? unique(related.filter(event => event.detail?.step === 'read_source')
      .map(event => {
        const input = event.detail?.input as { filePath?: unknown; fileName?: unknown } | undefined;
        return text(input?.filePath) || text(input?.fileName);
      })) : [];
    const completedRecap: Record<string, string> = {
      freezing_sources: 'The source check established which files and requirements could support the Review.',
      indexing_context: 'Using the selected sources, the Review gathered the code and rules needed for the checks that followed.',
      deterministic_analysis: `The built-in checks recorded ${stageFindings.length} potential issue${stageFindings.length === 1 ? '' : 's'}. The behaviour review then examined the selected code paths.`,
      model_analysis: 'The behaviour review assessed the selected paths against the available requirements and rules.',
      persisting_evidence: 'The final stage gathered the recorded evidence and prepared the findings for review.',
    };
    const next = stageNext(status, stageFindings.length > 0, stage.id === 'freezing_sources' && requirementCount === 0);
    const recap = completed ? [completedRecap[stage.id], outcome, stageFindings.length > 0 || (stage.id === 'freezing_sources' && requirementCount === 0) ? next : ''].filter(Boolean).join(' ') : outcome || next;
    return { ...stage, state: status, outcome, recap, next,
      checks: describeChecks(related, steps, !active), files, features,
      duration: formatReviewDuration(executionTiming(related, status === 'In progress', now).ms), findings: stageFindings };
  }) : REVIEW_WORKFLOW_STAGES.some(stage => stage.id === progress?.stage || progress?.completedStages?.includes(stage.id))
    ? REVIEW_WORKFLOW_STAGES.map(stage => {
      const state = progress?.completedStages?.includes(stage.id) ? 'Completed'
        : active ? stage.id === progress?.stage ? 'In progress' : 'Not started' : 'Not recorded';
      return { ...stage, state, next: stageNext(state, false, stage.id === 'freezing_sources' && requirementCount === 0), outcome: '', duration: 'Not recorded', findings: [] };
    })
    : normalizeReviewStages(progress).filter(stage => stage.id !== 'legacy').map(stage => {
      const state = stage.status === 'done' ? 'Completed' : stage.status === 'active' ? 'In progress' : stage.status === 'failed' ? 'Failed' : 'Not started';
      return {
        id: stage.id, title: stage.label, state, next: stageNext(state, false),
        outcome: stage.summary ? plainReviewText(stage.summary) : 'The saved review has no further explanation for this part.', duration: 'Not recorded', findings: [],
      };
    });

  const blockers: string[] = [];
  if (session.failureReason) blockers.push(reviewFailureMessage(session.failureReason));
  if (incompleteModel) blockers.push('The behaviour review could not be completed.');
  const analysis = trace?.analysisMap;
  if (analysis && analysis.status !== 'assessed') blockers.push('Some checks across security, business rules, technical behaviour, and human error are unverified.');
  if (analysis && (analysis.coverage.unsupportedArtifacts.length || analysis.coverage.unresolvedEdgeCount)) blockers.push('Some source formats or runtime paths are outside the recorded code map. Verify the relevant flows before relying on full coverage.');
  if (findingsError) blockers.push('I couldn’t load the findings. Reopen this review before making a decision.');
  if (assessment) blockers.push(...assessment.gaps.map(gap => plainReviewText(`${gap.title}. ${gap.remediation}`)));
  if (!detailedHistoryAvailable) blockers.push('The detailed activity history is unavailable, so I can’t confirm every check that ran.');
  const open = findings.filter(finding => !['dismissed', 'fixed'].includes(finding.status)).length;
  const totals = findingsError ? 'The finding count is unavailable.' : input.findingsLoading ? 'The findings are still loading.' : `There ${findings.length === 1 ? 'is' : 'are'} ${findings.length} finding${findings.length === 1 ? '' : 's'} for this review; ${open} still need${open === 1 ? 's' : ''} attention.`;
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
            : 'Check the findings and document gaps before deciding whether to approve the Review.';
  const timing = executionTiming(events, active && state !== 'Queued', now);
  const legacyStart = timestamp(progress?.startedAt);
  const legacyEnd = active ? now : timestamp(progress?.updatedAt);
  const durationMs = timing.ms ?? (legacyStart != null && legacyEnd != null && legacyEnd >= legacyStart ? legacyEnd - legacyStart : null);
  return {
    objectives: objectivePoints(reviewObjective(session)).map(plainReviewText), stages, detailedHistoryAvailable, active,
    reviewedSourceCount: detailedHistoryAvailable ? new Set(events.filter(event => event.event === 'harness_step_completed' && event.detail?.step === 'read_source')
      .map(event => text((event.detail?.input as { artifactId?: unknown } | undefined)?.artifactId) || text(event.detail?.executionId) || event.createdAt)).size : undefined,
    unassignedFindings: groupedFindings.filter(finding => !detailedHistoryAvailable || !finding.stage).map(finding => finding.link),
    timing: { duration: formatReviewDuration(durationMs), endedAt: active ? null : timing.end ?? (legacyStart != null ? progress?.updatedAt ?? null : null) },
    summary: { outcome: comparisonSummary ? `${outcome} ${comparisonSummary}` : outcome, blockers: unique(blockers), next },
  };
}
