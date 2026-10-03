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
};

export type TraceabilitySummary = {
  complete: number;
  incomplete: number;
  missing: number;
  attention: number;
};

export type ReviewTraceabilitySnapshot = {
  sessionId: string;
  projectId: string;
  status: 'available' | 'unavailable';
  records: ReviewTraceabilityRecord[];
  summary: TraceabilitySummary | null;
  capturedAt: string;
  updatedAt: string;
};
