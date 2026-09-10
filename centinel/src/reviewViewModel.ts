import type {
  Finding,
  ReviewDecisionRecord,
  ReviewProgress,
  ReviewStageId,
  ReviewStageProgress,
  StaticSession,
} from './types';

/**
 * The Review screen intentionally has a smaller, honest view model than the
 * service payload.  It keeps lifecycle labels, capability gates, and safe
 * activity presentation in one place so individual screens do not infer
 * capabilities from a missing field.
 */
export type ReviewLifecycleState =
  | 'In progress'
  | 'Pending to Review'
  | 'Completed'
  | 'Blocked'
  | 'Cancelled'
  | 'Failed';

export type ReviewCapabilities = {
  canResolveSnapshot: false;
  canAssignReviewer: false;
  hasStructuredTraceability: false;
  hasRiskDimensions: false;
  hasFindingAdjudication: false;
};

export type SafeActivityDetails = {
  activity: string[];
  evidence: string[];
  assessment?: string;
  outcome?: string;
};

export type ReviewActivityStage = {
  id: ReviewStageId | string;
  label: string;
  status: ReviewStageProgress['status'] | 'pending';
  summary?: string;
  updatedAt?: string;
  details: SafeActivityDetails;
};

export type ReviewActivityViewModel = {
  state: ReviewLifecycleState;
  targetLabel: string;
  objective: string | null;
  capabilities: ReviewCapabilities;
  stages: ReviewActivityStage[];
  findings: Finding[];
  decisions: ReviewDecisionRecord[];
  currentDecision: ReviewDecisionRecord | null;
};

const CAPABILITIES: ReviewCapabilities = {
  canResolveSnapshot: false,
  canAssignReviewer: false,
  hasStructuredTraceability: false,
  hasRiskDimensions: false,
  hasFindingAdjudication: false,
};

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Source readiness check',
  code_review: 'Facts gathering',
  requirement_validation: 'Connecting facts',
  summarizing: 'Reviewing',
  risk_assessment: 'Risk assessment',
  awaiting_approval: 'Awaiting review',
};

export function parseReviewConfig(session: StaticSession): Record<string, unknown> {
  try {
    const parsed = JSON.parse(session.configJson || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseReviewProgress(value: string | ReviewProgress | null | undefined): ReviewProgress | null {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as ReviewProgress : null;
  } catch {
    return null;
  }
}

export function reviewLifecycleState(
  session: StaticSession,
  currentDecision: ReviewDecisionRecord | null = session.currentDecision ?? null,
): ReviewLifecycleState {
  if (currentDecision?.decision === 'approved') return 'Completed';
  if (session.status === 'running' || session.status === 'queued') return 'In progress';
  if (session.status === 'blocked') return 'Blocked';
  if (session.status === 'failure') return 'Failed';
  if (session.status === 'cancelled') return 'Cancelled';
  // A rejected/commented activity is still the same activity and must not be
  // described as automatically reprocessing. It remains available for review.
  return 'Pending to Review';
}

export function reviewTargetLabel(session: StaticSession): string {
  if (session.baseRef && session.headRef) return `${session.baseRef} → ${session.headRef}`;
  if (session.headRef) return session.headRef;
  if (session.baseRef) return session.baseRef;
  return 'Full project scope';
}

export function reviewObjective(session: StaticSession): string | null {
  const config = parseReviewConfig(session);
  const instructions = typeof config.instructions === 'string' ? config.instructions.trim() : '';
  if (instructions) return instructions;
  const remarks = session.remarks.trim();
  return remarks || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim());
}

function readDetails(stage: ReviewStageProgress): SafeActivityDetails {
  // Older payloads only have `thoughts`. They are treated as auditable
  // activity strings; they are never presented as private chain-of-thought.
  const raw = stage as unknown as Record<string, unknown>;
  const evidence = stringArray(raw.evidence ?? raw.evidenceExamined ?? raw.sources);
  const assessment = typeof raw.assessment === 'string' && raw.assessment.trim()
    ? raw.assessment.trim()
    : undefined;
  const outcome = typeof raw.outcome === 'string' && raw.outcome.trim()
    ? raw.outcome.trim()
    : undefined;
  return {
    activity: stringArray(stage.thoughts),
    evidence,
    assessment,
    outcome,
  };
}

function safeStageSummary(stage: ReviewStageProgress): string | undefined {
  if (stage.status === 'failed') return `${STAGE_LABELS[stage.id] ?? stage.label} needs attention.`;
  if (typeof stage.summary === 'string' && stage.summary.trim()) return stage.summary.trim();
  if (stage.status === 'active') return `${STAGE_LABELS[stage.id] ?? stage.label} is in progress.`;
  if (stage.status === 'done') return `${STAGE_LABELS[stage.id] ?? stage.label} completed.`;
  return undefined;
}

export function normalizeReviewStages(progress: ReviewProgress | null): ReviewActivityStage[] {
  if (!progress) return [];
  if (!Array.isArray(progress.stages)) {
    const legacy = progress as unknown as { stage?: string; message?: string };
    return [{
      id: 'legacy',
      label: legacy.stage || 'Review activity',
      status: 'pending',
      summary: legacy.message,
      updatedAt: progress.updatedAt,
      details: { activity: [], evidence: [] },
    }];
  }
  return progress.stages.map(stage => ({
    id: stage.id,
    label: STAGE_LABELS[stage.id] ?? stage.label,
    status: stage.status,
    summary: safeStageSummary(stage),
    updatedAt: progress.updatedAt,
    details: readDetails(stage),
  }));
}

export function createReviewActivityViewModel(
  session: StaticSession,
  findings: Finding[] = [],
  decisions: ReviewDecisionRecord[] = [],
  currentDecision: ReviewDecisionRecord | null = session.currentDecision ?? decisions[0] ?? null,
): ReviewActivityViewModel {
  return {
    state: reviewLifecycleState(session, currentDecision),
    targetLabel: reviewTargetLabel(session),
    objective: reviewObjective(session),
    capabilities: CAPABILITIES,
    stages: normalizeReviewStages(parseReviewProgress(session.progressJson)),
    findings,
    decisions,
    currentDecision,
  };
}

export function formatReviewTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : null;
}

export function truncateReviewSourceName(value: string, maxLength = 15): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function findingStatusLabel(status: Finding['status']): string {
  const labels: Record<Finding['status'], string> = {
    new: 'New',
    accepted: 'Accepted',
    dismissed: 'Dismissed',
    fixed: 'Fixed',
    carryover: 'Carryover',
  };
  return labels[status] ?? status;
}
