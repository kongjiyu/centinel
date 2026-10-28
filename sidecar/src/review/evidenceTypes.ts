import type { ConfirmedRequirement, StandardRule } from './grounding.js';

export type ReviewSourceKind = 'repository' | 'directory' | 'document' | 'drive';

export type ReviewSourceManifestItem = {
  id: string;
  sessionId: string;
  sourceId: string;
  sourceKind: ReviewSourceKind;
  label: string;
  artifactIds: string[];
  filesReviewed: number;
  contentHashes: string[];
  capturedAt: string;
};

export type ReviewSourceManifest = {
  sessionId: string;
  projectId: string;
  status: 'available' | 'unavailable' | 'incomplete';
  capturedAt: string;
  updatedAt: string;
  sources: ReviewSourceManifestItem[];
  artifactCount: number | null;
};

export type TraceabilityState = 'complete' | 'incomplete' | 'missing';

export type TraceabilityEvidenceStatus = 'verified' | 'stale' | 'unavailable';

export type TraceabilityInclusionBasis = {
  requirementSelection: 'explicit' | 'project';
  artifactSelection: 'explicit' | 'full_manifest';
  selectedRequirementIds: string[];
  selectedArtifactIds: string[];
  sourceManifestId: string | null;
};

/** Mapping provenance captured with the Review. A complete coverage label is
 * insufficient unless the target and the mapping's explicit version proof
 * identify the exact reviewed artifact version. */
export type ReviewTraceabilityMapping = {
  id: string;
  targetArtifactId: string | null;
  targetSymbolId: string | null;
  coverageStatus: string;
  confidence: number | null;
  mappingVersionId: string | null;
  mappingContentHash: string | null;
  reviewedVersionId: string | null;
  reviewedContentHash: string | null;
  evidenceStatus: TraceabilityEvidenceStatus;
  evidenceReason: string | null;
};

export type FrozenReviewGrounding = {
  confirmedRequirements: ConfirmedRequirement[];
  enabledStandardRules: StandardRule[];
};

export type ReviewTraceabilityMetadata = {
  snapshotVersion: 2;
  sourceManifestId: string | null;
  inclusionBasis: TraceabilityInclusionBasis | null;
  grounding: FrozenReviewGrounding | null;
  unavailableReason: string | null;
};

export type ReviewTraceabilityRecord = {
  requirementId: string;
  title: string;
  description: string;
  category: string;
  state: TraceabilityState;
  mappingIds: string[];
  sourceArtifactIds: string[];
  sourceSymbolIds?: string[];
  confidence: number | null;
  capturedAt: string;
  /** Present on versioned snapshots. Historical records without these fields
   * stay readable and do not gain inferred version proof. */
  evidenceStatus?: TraceabilityEvidenceStatus;
  evidenceReason?: string | null;
  mappings?: ReviewTraceabilityMapping[];
};

export type TraceabilitySummary = {
  complete: number;
  incomplete: number;
  missing: number;
  attention: number;
  unavailable?: number;
};

export type ReviewTraceabilitySnapshot = {
  sessionId: string;
  projectId: string;
  status: 'available' | 'unavailable';
  records: ReviewTraceabilityRecord[];
  summary: TraceabilitySummary | null;
  capturedAt: string;
  updatedAt: string;
  metadata?: ReviewTraceabilityMetadata | null;
};
