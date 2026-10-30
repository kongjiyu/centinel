import crypto from 'node:crypto';
import path from 'node:path';
import type { Artifact } from '../artifacts.js';
import type { DynamicEvidence, DynamicSession } from '../dynamicSessions.js';
import type { Project } from '../projects.js';
import type { Requirement, RequirementMapping } from '../staticDomainTypes.js';
import type { ReviewDecisionRecord } from '../staticDomainTypes.js';
import type { ReviewSourceManifest, ReviewTraceabilitySnapshot } from '../review/evidenceTypes.js';
import { deriveRiskLevel } from '../riskPolicy.js';
import type { Finding, StaticSession } from '../staticDomainTypes.js';
import { canonicalJson, deepFreeze } from './canonical.js';
import { usageForReport, type ProjectReportFinding, type ProjectReportSnapshot, type ReportActionTrace, type ReportArtifact, type ReportCurrentFinding, type ReportCurrentFindings, type ReportDynamicEvidence, type ReportFindingCorrelation, type ReportProjectAssessment, type ReportRequirement, type ReportStandard, type SnapshotContext } from './types.js';
import type { TokenUsageSummary } from '../tokenUsage.js';

/** The report input seam; production supplies the bearer-scoped Supabase source. */
export type ReportSnapshotSource = {
  getProject(projectId: string): Promise<Project | null>;
  listStaticSessions(projectId: string): Promise<StaticSession[]>;
  listDynamicSessions(projectId: string): Promise<DynamicSession[]>;
  listDynamicEvidence(projectId: string, sessionId: string): Promise<DynamicEvidence[]>;
  listDynamicActions(projectId: string, sessionId: string): Promise<ReportActionTrace[]>;
  listAllFindings(projectId: string): Promise<Finding[]>;
  listStaticFindings(projectId: string, reviewId: string): Promise<Finding[]>;
  listArtifacts(projectId: string): Promise<Artifact[]>;
  listRequirements(projectId: string): Promise<Requirement[]>;
  getRequirementMappings(requirementId: string): Promise<RequirementMapping[]>;
  getProjectAssessment(projectId: string): Promise<ReportProjectAssessment>;
  /** Production report adapters return risk and inventory from one projection. */
  getProjectAssessmentWithCurrentFindings?(projectId: string): Promise<ReportProjectAssessment>;
  getReviewSourceManifest(projectId: string, reviewId: string): Promise<ReviewSourceManifest | null>;
  getReviewTraceabilitySnapshot(projectId: string, reviewId: string): Promise<ReviewTraceabilitySnapshot | null>;
  getCurrentDecision(projectId: string, reviewId: string): Promise<ReviewDecisionRecord | null>;
  getTokenUsageSummary(projectId: string, reviewId?: string): Promise<TokenUsageSummary>;
  listStandards?(projectId: string): Promise<ReportStandard[]>;
  getCorrelations?(projectId: string, reviewId: string): Promise<ReportFindingCorrelation[]>;
};

export const REPORT_GENERATOR_VERSION = 'project-report-v4';
const REPORT_TERMINAL_STATUSES = new Set([
  'success', 'failure', 'failed', 'blocked', 'cancelled',
  'completed', 'approved', 'pending_approval', 'changes_requested',
]);
const FINDING_STATUS_ORDER: Record<string, number> = {
  new: 0, carryover: 1, accepted: 2, dismissed: 3, fixed: 4,
};
const FINDING_SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

function reportDate(value: string): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

const REPORTABLE_DYNAMIC_EVIDENCE = new Set(['screenshot', 'action_trace', 'session_summary']);

function redactCredentials(value: unknown): string {
  return String(value ?? '')
    .replace(/((?:https?|wss?):\/\/)[^/@\s:]+(?::[^/@\s]*)?@/gi, '$1[redacted]@')
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|client[_-]?secret|secret|password|authorization|auth|signature|sig|jwt|code)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password)\s*([:=])\s*(?:Bearer\s+)?("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]');
}

function latestTerminal<T extends { status: string; updatedAt: string; createdAt: string }>(items: T[]): T | null {
  return [...items]
    .filter(item => REPORT_TERMINAL_STATUSES.has(item.status))
    .sort((a, b) => reportDate(b.updatedAt || b.createdAt) - reportDate(a.updatedAt || a.createdAt))[0] ?? null;
}

type ExecutionTimestampBasis = 'completed_at' | 'progress.completedAt' | 'created_at' | 'unavailable';

type ResolvedExecutionTimestamp = { value: string | null; milliseconds: number | null; basis: ExecutionTimestampBasis };

function validTimestamp(value: unknown): { value: string; milliseconds: number } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return { value: new Date(milliseconds).toISOString(), milliseconds };
}

function progressCompletedAt(progressJson: string): unknown {
  try {
    const progress: unknown = JSON.parse(progressJson);
    return progress && typeof progress === 'object' && !Array.isArray(progress)
      ? (progress as Record<string, unknown>).completedAt
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveExecutionTimestamp(session: StaticSession): ResolvedExecutionTimestamp {
  const dedicated = validTimestamp(session.completedAt);
  if (dedicated) return { ...dedicated, basis: 'completed_at' };
  const progress = validTimestamp(progressCompletedAt(session.progressJson));
  if (progress) return { ...progress, basis: 'progress.completedAt' };
  const created = validTimestamp(session.createdAt);
  if (created) return { ...created, basis: 'created_at' };
  return { value: null, milliseconds: null, basis: 'unavailable' };
}

function latestTerminalStatic(items: StaticSession[]): { session: StaticSession; timestamp: ResolvedExecutionTimestamp } | null {
  return items
    .filter(item => REPORT_TERMINAL_STATUSES.has(item.status))
    .map(session => ({ session, timestamp: resolveExecutionTimestamp(session) }))
    .sort((a, b) => {
      if (a.timestamp.milliseconds !== null && b.timestamp.milliseconds !== null
        && a.timestamp.milliseconds !== b.timestamp.milliseconds) {
        return b.timestamp.milliseconds - a.timestamp.milliseconds;
      }
      if (a.timestamp.milliseconds === null && b.timestamp.milliseconds !== null) return 1;
      if (a.timestamp.milliseconds !== null && b.timestamp.milliseconds === null) return -1;
      return a.session.id.localeCompare(b.session.id);
    })[0] ?? null;
}

function sortFindings<T extends Finding>(findings: T[]): Array<T & { riskLevel: ProjectReportFinding['riskLevel'] }> {
  return [...findings].map(finding => ({
    ...finding,
    riskLevel: deriveRiskLevel(finding.severity, finding.priority),
  })).sort((a, b) =>
    (a.riskLevel ? 0 : 1) - (b.riskLevel ? 0 : 1)
      || (FINDING_STATUS_ORDER[a.status] ?? 99) - (FINDING_STATUS_ORDER[b.status] ?? 99)
      || (FINDING_SEVERITY_ORDER[a.severity.toLowerCase()] ?? 99) - (FINDING_SEVERITY_ORDER[b.severity.toLowerCase()] ?? 99)
      || reportDate(b.createdAt) - reportDate(a.createdAt)
      || a.title.localeCompare(b.title)
      || a.id.localeCompare(b.id));
}

function relativeReportPath(project: Project, value: string | null | undefined): string {
  if (!value) return '';
  const candidate = path.isAbsolute(value) ? path.relative(project.workspacePath, value) : value;
  const relative = candidate.replace(/\\/g, '/');
  if (!relative || relative === '.') return path.basename(value);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return path.basename(value);
  return relative;
}

function reportArtifact(project: Project, artifact: Artifact): ReportArtifact {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    type: artifact.type,
    source: artifact.source,
    fileName: artifact.fileName,
    path: relativeReportPath(project, artifact.filePath || artifact.originalPath),
    contentHash: artifact.contentHash,
    createdAt: artifact.createdAt,
  };
}

function reportRequirement(requirement: Requirement, mappings: RequirementMapping[]): ReportRequirement {
  return { ...requirement, mappings: [...mappings].sort((a, b) => a.id.localeCompare(b.id)) };
}

function reportStandard(project: Project, artifact: Artifact): ReportStandard {
  return {
    artifactId: artifact.id,
    title: artifact.fileName,
    source: artifact.source,
    path: relativeReportPath(project, artifact.filePath || artifact.originalPath),
    contentHash: artifact.contentHash,
    version: null,
    structuredRulesStatus: 'unavailable',
    rules: [],
  };
}

function reportDynamicEvidence(project: Project, evidence: DynamicEvidence[]): ReportDynamicEvidence[] {
  return evidence.filter(item => REPORTABLE_DYNAMIC_EVIDENCE.has(item.type)).map(item => ({
    id: item.id,
    type: item.type,
    summary: redactCredentials(item.summary),
    path: redactCredentials(relativeReportPath(project, item.filePath)),
    createdAt: item.createdAt,
  }));
}

function withRelativeFindingPaths<T extends Finding>(project: Project, findings: T[]): T[] {
  return findings.map(finding => ({
    ...finding,
    filePath: relativeReportPath(project, finding.filePath),
  }));
}

function emptyOutputFiles(): ProjectReportSnapshot['metadata']['outputFiles'] {
  return { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' };
}

/** Capture mutable project data once; all renderers receive this frozen value. */
export async function buildProjectReportSnapshot(
  projectId: string,
  context: SnapshotContext,
): Promise<ProjectReportSnapshot> {
  const source = context.source;
  if (!source) throw new Error('An authenticated report snapshot source is required.');
  const project = await source.getProject(projectId);
  if (!project) throw new Error('Project not found');

  const reportId = context.reportId ?? crypto.randomUUID();
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const assessmentPromise = source.getProjectAssessmentWithCurrentFindings
    ? source.getProjectAssessmentWithCurrentFindings(projectId)
    : source.getProjectAssessment(projectId);
  const [staticSessions, dynamicSessions, rawFindings, rawArtifacts, rawRequirements, assessment, projectUsage] = await Promise.all([
    source.listStaticSessions(projectId),
    source.listDynamicSessions(projectId),
    // Project-wide inventory preserves historical states and their module.
    source.listAllFindings(projectId),
    source.listArtifacts(projectId),
    source.listRequirements(projectId),
    assessmentPromise,
    source.getTokenUsageSummary(projectId),
  ]);

  const artifacts = rawArtifacts.map(artifact => reportArtifact(project, artifact));
  const requirements = await Promise.all(rawRequirements.map(async requirement =>
    reportRequirement(requirement, await source.getRequirementMappings(requirement.id))));
  requirements.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const standards = source.listStandards
    ? (await source.listStandards(projectId)).sort((a, b) => a.title.localeCompare(b.title) || a.artifactId.localeCompare(b.artifactId))
    : rawArtifacts.filter(artifact => artifact.type === 'coding_standard')
      .map(artifact => reportStandard(project, artifact))
      .sort((a, b) => a.title.localeCompare(b.title) || a.artifactId.localeCompare(b.artifactId));

  const allFindings = sortFindings(withRelativeFindingPaths(project, rawFindings));
  const assessmentItems = sortFindings(assessment.riskItems);
  const currentFindingEnvelope: ReportCurrentFindings = assessment.currentFindings
    ? {
      ...assessment.currentFindings,
      items: sortFindings(withRelativeFindingPaths(project, assessment.currentFindings.items)),
    }
    : {
      status: 'unavailable',
      reason: 'This report source did not provide a reconciled current finding projection.',
      items: [],
    };
  const focused = context.reviewId ? staticSessions.find(item => item.id === context.reviewId) : null;
  if (context.reviewId && (!focused || !REPORT_TERMINAL_STATUSES.has(focused.status))) {
    throw new Error('Only a finished Review in this project can be exported as a Review report.');
  }
  const staticReviewSelection = focused ? { session: focused, timestamp: resolveExecutionTimestamp(focused) } : latestTerminalStatic(staticSessions);
  const review = staticReviewSelection?.session ?? null;
  let latestReview: ProjectReportSnapshot['latestReview'] = null;

  if (review) {
    const [reviewFindingsRaw, sourceManifest, traceability, decision, reviewUsage] = await Promise.all([
      source.listStaticFindings(projectId, review.id),
      source.getReviewSourceManifest(projectId, review.id),
      source.getReviewTraceabilitySnapshot(projectId, review.id),
      source.getCurrentDecision(projectId, review.id),
      source.getTokenUsageSummary(projectId, review.id),
    ]);
    const reviewFindings = sortFindings(withRelativeFindingPaths(project, reviewFindingsRaw));
    const correlations = source.getCorrelations ? await source.getCorrelations(projectId, review.id) : [];
    const recurringIds = new Set(correlations.filter(item => item.classification === 'recurring' || item.classification === 'carried_over').map(item => item.childFindingId).filter((value): value is string => Boolean(value)));
    latestReview = {
      status: 'available',
      session: {
        id: review.id,
        projectId: review.projectId,
        name: review.name,
        reviewType: review.reviewType,
        status: review.status,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        completedAt: review.completedAt ?? null,
        executionTimestamp: staticReviewSelection?.timestamp.value ?? null,
        executionTimestampBasis: staticReviewSelection?.timestamp.basis ?? 'unavailable',
        summary: review.finalSummary || null,
        failureReason: review.failureReason || null,
      },
      summary: review.finalSummary || null,
      findings: reviewFindings,
      reportedFindings: reviewFindings.filter(finding => finding.status !== 'carryover'),
      carryoverFindings: reviewFindings.filter(finding => finding.status === 'carryover'),
      // Local historical exports have no accepted cross-review classifier;
      // the Supabase source includes the immutable correlation snapshot.
      recurringFindings: correlations.length ? reviewFindings.filter(finding => recurringIds.has(finding.id)) : null,
      findingClassificationStatus: correlations.length ? 'available' : 'unavailable',
      correlations,
      sourceManifest: {
        status: sourceManifest?.status ?? 'unavailable',
        artifactCount: sourceManifest?.artifactCount ?? null,
        capturedAt: sourceManifest?.capturedAt ?? null,
        sources: sourceManifest?.sources ?? [],
      },
      traceability: {
        status: traceability?.status === 'available' && traceability.summary ? 'available' : 'unavailable',
        summary: traceability?.summary ?? null,
        records: traceability?.records ?? [],
        capturedAt: traceability?.capturedAt ?? null,
      },
      decision,
      modelUsage: usageForReport(reviewUsage, review.id),
    };
  }

  const dynamic = latestTerminal(dynamicSessions);
  let latestDynamicTest: ProjectReportSnapshot['latestDynamicTest'] = null;
  if (dynamic) {
    const [evidence, actions] = await Promise.all([
      source.listDynamicEvidence(projectId, dynamic.id),
      source.listDynamicActions(projectId, dynamic.id),
    ]);
    latestDynamicTest = {
      status: 'available',
      session: {
        id: dynamic.id,
        projectId: dynamic.projectId,
        name: dynamic.name,
        status: dynamic.status,
        targetUrl: redactCredentials(dynamic.targetUrl),
        goal: redactCredentials(dynamic.goal),
        missionType: dynamic.missionType,
        maxSteps: dynamic.maxSteps,
        createdAt: dynamic.createdAt,
        updatedAt: dynamic.updatedAt,
      },
      summary: dynamic.finalSummary ? redactCredentials(dynamic.finalSummary) : null,
      failureReason: dynamic.failureReason ? redactCredentials(dynamic.failureReason) : null,
      evidence: reportDynamicEvidence(project, evidence),
      actionTrace: actions.map(item => ({
        step: item.step,
        action: redactCredentials(item.action),
        target: redactCredentials(item.target),
        result: redactCredentials(item.result),
      })),
    };
  }

  const snapshot: ProjectReportSnapshot = {
    metadata: {
      schemaVersion: 'centinel-project-report-v1',
      reportId,
      generatedAt,
      actorId: context.actorId ?? null,
      generatorVersion: REPORT_GENERATOR_VERSION,
      riskPolicyVersion: assessment.policyVersion,
      ...(context.reviewId ? { reviewId: context.reviewId } : {}),
      ...(context.actorEmail ? { actorEmail: context.actorEmail } : {}),
      outputFiles: context.outputFiles ?? emptyOutputFiles(),
    },
    project,
    riskAssessment: {
      status: 'available',
      policyVersion: assessment.policyVersion,
      currentFindingCount: assessment.summary.critical + assessment.summary.high
        + assessment.summary.medium + assessment.summary.low + assessment.summary.unclassified,
      critical: assessment.summary.critical,
      high: assessment.summary.high,
      medium: assessment.summary.medium,
      low: assessment.summary.low,
      unclassified: assessment.summary.unclassified,
      // Use the same risk-assessment module as Project Detail; it returns the top five items.
      items: assessmentItems,
    },
    findings: allFindings,
    currentFindings: currentFindingEnvelope,
    sourceInventory: { status: 'available', artifactCount: artifacts.length, artifacts },
    requirements: { status: 'available', items: requirements },
    standards: { status: 'available', items: standards },
    latestReview,
    modelUsage: usageForReport(projectUsage, null),
    latestDynamicTest,
  };

  return deepFreeze(snapshot);
}

export { canonicalJson };
