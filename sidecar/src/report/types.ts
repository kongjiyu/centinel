import type { Artifact } from '../artifacts.js';
import type { DynamicEvidence, DynamicSession } from '../dynamicSessions.js';
import type { Finding, StaticSession } from '../staticDomainTypes.js';
import type { Requirement, RequirementMapping } from '../staticDomainTypes.js';
import type { ReviewDecisionRecord } from '../staticDomainTypes.js';
import type { ReviewSourceManifest, ReviewTraceabilitySnapshot } from '../review/evidenceTypes.js';
import type { Project } from '../projects.js';
import type { RiskLevel } from '../riskPolicy.js';
import type { TokenUsageSummary } from '../tokenUsage.js';
import type { ProjectFindingHistoryEntry, ProjectFindingResolutionEvidence } from '../review/findingReconciliation.js';
import type { ProjectAssessment } from '../staticDomainTypes.js';

export type ProjectReportFinding = Finding & { riskLevel: RiskLevel | null };

export type ReportCurrentFinding = ProjectReportFinding & {
  /** State saved on the canonical root occurrence before reconciliation. */
  persistedStatus: Finding['status'];
  /** Shared project presentation state, including server-validated resolution. */
  effectiveStatus: Finding['status'];
  /** User-facing disposition; derived resolution is represented explicitly. */
  effectiveDisposition: Finding['status'] | 'resolved';
  latestOccurrence: { findingId: string; reviewId: string | null; classification: 'recurring' | 'regressed' } | null;
  lineageReferences: Array<Pick<ProjectFindingHistoryEntry, 'findingId' | 'reviewId' | 'classification'>>;
  resolutionEvidence: ProjectFindingResolutionEvidence | null;
};

export type ReportCurrentFindings = {
  status: 'available' | 'unavailable';
  reason: string | null;
  items: ReportCurrentFinding[];
};

export type ReportProjectAssessment = ProjectAssessment & {
  /** Optional for legacy snapshot sources; production reports provide it. */
  currentFindings?: ReportCurrentFindings;
};

export type ReportMetadata = {
  schemaVersion: 'centinel-project-report-v1';
  reportId: string;
  generatedAt: string;
  actorId: string | null;
  generatorVersion: string;
  riskPolicyVersion: string;
  /** Set when this export focuses on one Review instead of the latest one. */
  reviewId?: string;
  /** Display identity of the exporting account; actorId remains the stable reference. */
  actorEmail?: string | null;
  outputFiles: {
    json: string;
    markdown: string;
    pdf: string;
  };
};

export type ReportArtifact = Pick<Artifact, 'id' | 'projectId' | 'type' | 'source' | 'fileName' | 'contentHash' | 'createdAt'> & {
  path: string;
};

export type ReportRequirement = Requirement & { mappings: RequirementMapping[] };

export type ReportStandard = {
  artifactId: string;
  /** Supabase project_standards identity when this is a structured standard. */
  standardId?: string;
  code?: string;
  title: string;
  source: string;
  path: string;
  contentHash: string;
  version: string | null;
  structuredRulesStatus: 'available' | 'unavailable';
  rules?: ReportStandardRule[];
};

export type ReportStandardRule = {
  id: string;
  stableKey: string;
  title: string;
  statement: string;
  category: string;
  severity: string;
  recommendation: string;
  sourceArtifactId: string;
  sourceLocator: Record<string, unknown>;
  sourceVersion: string;
  standardVersion: string;
  enabled: boolean;
};

export type ReportFindingCorrelation = {
  id: string;
  parentReviewId: string;
  childReviewId: string;
  parentFindingId: string | null;
  childFindingId: string | null;
  classification: 'new' | 'recurring' | 'carried_over' | 'resolved' | 'regressed' | string;
  method: 'stable_id' | 'fingerprint' | 'heuristic' | 'unmatched' | string;
  score: number;
  stableFingerprint: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type ReportUsage = {
  status: 'available' | 'unavailable';
  reason: string | null;
  reviewSessionId: string | null;
  totals: null | {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    calls: number;
  };
  byModel: Array<{
    provider: string;
    apiFormat: string;
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    calls: number;
  }>;
};

export type ReportTraceability = {
  status: 'available' | 'unavailable';
  summary: ReviewTraceabilitySnapshot['summary'];
  records: ReviewTraceabilitySnapshot['records'];
  capturedAt: string | null;
};

export type ReportSourceManifest = {
  status: 'available' | 'incomplete' | 'unavailable';
  artifactCount: number | null;
  capturedAt: string | null;
  sources: ReviewSourceManifest['sources'];
};

/** Explicitly whitelisted lifecycle fields; progress thoughts/config are excluded. */
export type ReportReviewSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: StaticSession['reviewType'];
  status: StaticSession['status'];
  createdAt: string;
  updatedAt: string;
  /** Persisted completed_at value, if the backing row has one. */
  completedAt?: string | null;
  /** Execution timestamp chosen from dedicated completion, frozen progress, or creation fallback. */
  executionTimestamp?: string | null;
  executionTimestampBasis?: 'completed_at' | 'progress.completedAt' | 'created_at' | 'unavailable';
  summary: string | null;
  failureReason: string | null;
};

/** User-facing Dynamic summary only; runtime internals are not exported. */
export type ReportDynamicSession = {
  id: string;
  projectId: string;
  name: string;
  status: DynamicSession['status'];
  targetUrl: string;
  goal: string;
  missionType: DynamicSession['missionType'];
  maxSteps: number;
  createdAt: string;
  updatedAt: string;
};

export type ReportActionTrace = {
  step: number;
  action: string;
  target: string;
  result: string;
};

export type ReportDynamicEvidence = Pick<DynamicEvidence, 'id' | 'type' | 'summary' | 'createdAt'> & {
  path: string | null;
};

export type ProjectReportSnapshot = {
  metadata: ReportMetadata;
  project: Project;
  riskAssessment: {
    status: 'available';
    policyVersion: string;
    currentFindingCount: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    unclassified: number;
    items: ProjectReportFinding[];
  };
  /** Complete finding inventory, including current and historical states. */
  findings: ProjectReportFinding[];
  /** Reconciled current issues; absent only in legacy saved report JSON. */
  currentFindings?: ReportCurrentFindings;
  sourceInventory: {
    status: 'available';
    artifactCount: number;
    artifacts: ReportArtifact[];
  };
  requirements: {
    status: 'available';
    items: ReportRequirement[];
  };
  standards: {
    status: 'available';
    items: ReportStandard[];
  };
  latestReview: null | {
    status: 'available';
    session: ReportReviewSession;
    summary: string | null;
    findings: ProjectReportFinding[];
    reportedFindings: ProjectReportFinding[];
    carryoverFindings: ProjectReportFinding[];
    recurringFindings: ProjectReportFinding[] | null;
    findingClassificationStatus: 'available' | 'unavailable';
    correlations?: ReportFindingCorrelation[];
    sourceManifest: ReportSourceManifest;
    traceability: ReportTraceability;
    decision: ReviewDecisionRecord | null;
    modelUsage: ReportUsage;
  };
  modelUsage: ReportUsage;
  latestDynamicTest: null | {
    status: 'available';
    session: ReportDynamicSession;
    summary: string | null;
    failureReason: string | null;
    evidence: ReportDynamicEvidence[];
    actionTrace: ReportActionTrace[];
  };
};

export type ProjectReportRenderings = {
  json: string;
  markdown: string;
  pdf: Buffer;
};

export type ReportChecksums = {
  snapshot: string;
  markdown: string;
  pdf: string;
  package: string;
};

export type ProjectReportExportResult = {
  reportId: string;
  generatedAt: string;
  generatorVersion: string;
  riskPolicyVersion: string;
  expiresAt: string | null;
  storage: 'private-supabase';
  downloads: {
    json: string | null;
    markdown: string | null;
    pdf: string | null;
  };
  markdown: string;
  checksums: ReportChecksums;
};

export type SnapshotContext = {
  reportId?: string;
  actorId?: string | null;
  generatedAt?: string;
  outputFiles?: ReportMetadata['outputFiles'];
  /** Report this Review rather than the latest terminal Review. */
  reviewId?: string;
  actorEmail?: string | null;
  /** The caller must explicitly supply a bearer-scoped or test snapshot source. */
  source: import('./snapshot.js').ReportSnapshotSource;
};

export function usageForReport(summary: TokenUsageSummary, reviewSessionId: string | null): ReportUsage {
  if (!summary.totals.calls) {
    return {
      status: 'unavailable',
      reason: 'No model-usage records are available for this scope.',
      reviewSessionId,
      totals: null,
      byModel: [],
    };
  }
  return {
    status: 'available',
    reason: null,
    reviewSessionId,
    totals: { ...summary.totals },
    byModel: summary.byGroup.map(group => ({
      provider: group.provider,
      apiFormat: group.apiFormat,
      model: group.model,
      input: group.totalInput,
      output: group.totalOutput,
      cacheRead: group.totalCacheRead,
      cacheCreation: group.totalCacheCreation,
      calls: group.totalCalls,
    })),
  };
}
