import type { RiskLevel } from './riskPolicy.js';
import type { TraceabilitySummary } from './review/evidenceTypes.js';

/** Shared report/risk-facing static records. Persistence adapters map into these shapes. */
export type StaticSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'blocked' | 'cancelled';

export type ReviewType =
  | 'requirement_review'
  | 'code_review'
  | 'requirement_to_code_traceability'
  | 'cross_artifact_consistency';

export type StaticSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  configJson: string;
  progressJson: string;
  remarks: string;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
  baseRef: string;
  headRef: string;
  changedFilesJson: string;
  parentSessionId: string;
  reviewDiffJson: string;
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  priority: string | null;
  riskLevel?: string | null;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed' | 'carryover';
  createdAt: string;
  artifactId: string | null;
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  fromRemarks: boolean;
  filePath: string;
  lineNumber: number | null;
};

export type Requirement = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  createdAt: string;
};

export type RequirementMapping = {
  id: string;
  requirementId: string;
  fileId: string | null;
  symbolId: string | null;
  coverageStatus: string;
  confidence: number;
};

export type ReviewDecision = 'approved' | 'changes_requested' | 'commented';

export type ReviewDecisionAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
};

export type ReviewDecisionRecord = {
  id: string;
  sessionId: string;
  projectId: string;
  decision: ReviewDecision;
  comment: string;
  reviewer: string;
  createdAt: string;
  attachments: ReviewDecisionAttachment[];
};

export type ProjectAssessment = {
  projectId: string;
  status: 'available';
  policyVersion: string;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    classified: number;
    unclassified: number;
  };
  riskItems: Array<Finding & { riskLevel: RiskLevel }>;
  traceability: {
    status: 'available' | 'unavailable';
    reviewId: string | null;
    summary: TraceabilitySummary | null;
  };
};
