import type { Artifact } from '../artifacts.js';

export type ReadinessCategory = 'repository' | 'requirements' | 'design' | 'standards';
export type ReadinessState = 'missing' | 'incomplete' | 'completed';
export type ReadinessFailureCode = 'assessment_paused' | 'not_configured' | 'secret_unavailable' | 'codex_not_connected' | 'rate_limited' | 'quota_exhausted' | 'credits_exhausted' | 'billing_required' | 'context_limit' | 'malformed_response' | 'timeout' | 'persistence' | 'source_changes' | 'assessment_failed';
export type ReadinessReference = { artifactId: string; path: string; excerpt: string; sourceVersion?: string; contentHash?: string };
export type ReadinessGap = { id: string; category: ReadinessCategory; title: string; description: string; recommendation: string; severity: 'warning' | 'blocking'; references: ReadinessReference[] };
export type ReadinessCriterionResult = { id: string; status: 'pass' | 'gap' | 'unknown'; basis: string; references: ReadinessReference[] };
export type ReadinessCategoryResult = { id: ReadinessCategory; label: string; state: ReadinessState; sourceCount: number; checksPassed: number; checksTotal: number; gapIds: string[]; criteria?: ReadinessCriterionResult[] };
export const READINESS_VALIDATION_REASON_CODES = [
  'response_shape_invalid',
  'presence_invalid',
  'presence_unknown',
  'source_inventory_invalid',
  'classification_basis_invalid',
  'classification_evidence_invalid',
  'presence_check_conflict',
  'missing_semantics_invalid',
  'basis_invalid',
  'citation_array_invalid',
  'citation_row_invalid',
  'citation_source_unknown',
  'citation_excerpt_invalid',
  'citation_excerpt_too_long',
  'citation_not_exact',
  'citation_whole_source',
  'citation_sensitive',
  'evidence_insufficient_distinct',
  'scope_shape_invalid',
  'scope_row_invalid',
  'scope_label_invalid',
  'scope_item_citation_invalid',
  'scope_coverage_citation_invalid',
  'scope_coverage_evidence_missing',
  'scope_status_invalid',
  'scope_duplicate_merged',
  'scope_duplicate_status_conflict',
  'scope_inventory_empty',
  'cross_batch_not_run',
  'cross_batch_candidate_payload_exceeded',
  'cross_batch_response_shape_invalid',
  'cross_batch_model_unknown',
  'cross_batch_status_invalid',
  'cross_batch_basis_invalid',
  'cross_batch_evidence_invalid',
  'cross_batch_candidate_mismatch',
  'cross_batch_evidence_insufficient',
  'cross_batch_batch_coverage_incomplete',
  'batch_status_conflict',
] as const;
export type ReadinessValidationReasonCode = typeof READINESS_VALIDATION_REASON_CODES[number];
export type ReadinessValidationReasonCounts = Partial<Record<ReadinessValidationReasonCode, number>>;
export type ReadinessValidationDiagnostics = {
  // .1 snapshots predate reasonCounts and remain valid historical evidence.
  schemaVersion: 'readiness-validation-2026-10-23.1' | 'readiness-validation-2026-10-23.2' | 'readiness-validation-2026-10-23.3';
  batchCount: number;
  categories: Array<{
    category: Exclude<ReadinessCategory, 'repository'>;
    rawPresence: 'present' | 'missing' | 'unknown' | 'invalid';
    sourceInventoryValid: boolean;
    classificationBasisValid: boolean;
    classificationEvidenceValid: boolean;
    scopeCoverageValid: boolean;
    shapeValid: boolean;
    missingSemanticsValid: boolean;
    crossBatchComparison: 'not_required' | 'pass' | 'gap' | 'unknown' | 'not_run';
    reasonCounts?: ReadinessValidationReasonCounts;
    checks: Array<{
      id: string;
      rawStatusCounts: { pass: number; gap: number; unknown: number; invalid: number };
      effectiveStatus: 'pass' | 'gap' | 'unknown';
      basisValid: boolean;
      evidenceValid: boolean;
      reasonCounts?: ReadinessValidationReasonCounts;
    }>;
  }>;
};
export type ReadinessAssessment = { id: string; projectId: string; sourceFingerprint: string; assessedAt: string; categories: ReadinessCategoryResult[]; findings: ReadinessGap[]; policyVersion?: string; validationDiagnostics?: ReadinessValidationDiagnostics };
export type ReadinessStatus = { projectId: string; requestId: string | null; status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'paused'; trigger: string | null; requestedAt: string | null; startedAt: string | null; completedAt: string | null; error: string | null; errorCode?: ReadinessFailureCode | null; snapshot: ReadinessAssessment | null; stale: boolean };
export type ReadinessSourceIssue = 'authorization_required' | 'sync_failed' | 'partial_import' | 'unsupported_format' | 'content_unavailable' | 'content_changed' | 'version_missing';
export type ReadinessArtifact = { artifact: Artifact; content: string | null; error?: string; unavailableReason?: ReadinessSourceIssue };
export type ReadinessInput = { projectId: string; description: string; artifacts: ReadinessArtifact[]; sourceFingerprint: string };
