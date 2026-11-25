import type { CaptureReviewTraceabilityInput } from './types.js';
import type { ConfirmedRequirement, StandardRule } from './grounding.js';
import type { ReviewTraceabilityMapping, ReviewTraceabilityMetadata, ReviewTraceabilityRecord, ReviewTraceabilitySnapshot, TraceabilityEvidenceStatus } from './evidenceTypes.js';
import { summarizeTraceability } from './traceabilitySummary.js';
import { isConfirmedMappingStatus } from './requirementLinkSuggestions.js';

export type FrozenMappingInput = {
  id: string; artifactId: string | null; fileId: string | null; symbolId: string | null;
  coverageStatus: string; confidence: number | null; mappingVersionId: string | null; mappingContentHash: string | null;
};

function normalizedHash(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/^sha256:/i, '').toLowerCase();
}

export async function buildFrozenTraceability(reviewId: string, projectId: string, input: CaptureReviewTraceabilityInput,
  requirements: ConfirmedRequirement[], enabledStandardRules: StandardRule[],
  mappingsFor: (requirement: string, signal?: AbortSignal) => Promise<FrozenMappingInput[]>, capturedAt: string): Promise<ReviewTraceabilitySnapshot> {
  const { signal } = input;
  const selectedRequirementSet = input.scope.requirementIds?.length ? new Set(input.scope.requirementIds) : null;
  const selectedRequirements = requirements.filter(item => !selectedRequirementSet || selectedRequirementSet.has(item.id));
  const requirementsById = new Map(selectedRequirements.map(item => [item.id, item]));
  const explicitRequirementIds = input.scope.requirementIds?.length ? [...input.scope.requirementIds] : null;
  const selectedRequirementIds = explicitRequirementIds ?? selectedRequirements.map(item => item.id);
  const explicitArtifactIds = input.scope.artifactIds?.length ? [...input.scope.artifactIds] : null;
  const selectedArtifactIds = explicitArtifactIds ?? input.artifacts.map(item => item.id);
  const artifactsById = new Map(input.artifacts.map(item => [item.id, item]));
  const unavailableArtifactIds = new Set(input.unavailableArtifactIds ?? []);
  const records: ReviewTraceabilityRecord[] = [];

  for (const requirementId of selectedRequirementIds) {
    signal?.throwIfAborted();
    const requirement = requirementsById.get(requirementId);
    if (!requirement) {
      records.push({
        requirementId, title: '', description: '', category: '', state: 'incomplete',
        mappingIds: [], sourceArtifactIds: [], sourceSymbolIds: [], confidence: null,
        capturedAt, evidenceStatus: 'unavailable', evidenceReason: 'selected_requirement_unavailable_at_capture', mappings: [],
      });
      continue;
    }

    const rows = await mappingsFor(requirement.id, signal);
    const mappings: ReviewTraceabilityMapping[] = [];
    for (const row of rows) {
      // Suggested or rejected links are not traceability evidence.
      if (!isConfirmedMappingStatus(row.coverageStatus)) continue;
      const artifactId = row.artifactId;
      const fileId = row.fileId;
      const targetArtifactId = artifactId ?? fileId;
      // An explicit artifact scope excludes known mappings to other files.
      if (explicitArtifactIds && targetArtifactId && !explicitArtifactIds.includes(targetArtifactId)) continue;
      const targetConflict = Boolean(artifactId && fileId && artifactId !== fileId);
      const target = targetArtifactId ? artifactsById.get(targetArtifactId) : undefined;
      const mappingVersionId = row.mappingVersionId;
      const mappingContentHash = row.mappingContentHash;
      let evidenceStatus: TraceabilityEvidenceStatus = 'unavailable';
      let evidenceReason: string | null = null;
      if (targetConflict) evidenceReason = 'mapping_target_identity_conflict';
      else if (!targetArtifactId) evidenceReason = 'mapping_target_missing';
      else if (!target) evidenceReason = 'target_not_in_reviewed_scope';
      else if (unavailableArtifactIds.has(target.id)) evidenceReason = 'reviewed_target_unreadable';
      else if (!target.versionId && !target.contentHash) evidenceReason = 'reviewed_target_version_missing';
      else if (!mappingVersionId && !mappingContentHash) evidenceReason = 'mapping_version_proof_missing';
      else {
        const versionMatches = !mappingVersionId || (target.versionId != null && mappingVersionId === target.versionId);
        const hashMatches = !mappingContentHash || normalizedHash(mappingContentHash) === normalizedHash(target.contentHash);
        if (!versionMatches || !hashMatches) {
          evidenceStatus = 'stale';
          evidenceReason = 'mapping_version_does_not_match_reviewed_source';
        } else {
          evidenceStatus = 'verified';
        }
      }
      mappings.push({
        id: row.id,
        targetArtifactId,
        targetSymbolId: row.symbolId,
        coverageStatus: row.coverageStatus.trim().toLowerCase(),
        confidence: row.confidence,
        mappingVersionId,
        mappingContentHash,
        reviewedVersionId: target?.versionId ?? null,
        reviewedContentHash: target?.contentHash ?? null,
        evidenceStatus,
        evidenceReason,
      });
    }
    const complete = mappings.length > 0 && mappings.every(item => item.evidenceStatus === 'verified'
      && /^(complete|covered|verified|full|pass|passed|fully[_ -]?covered)$/.test(item.coverageStatus));
    const state: ReviewTraceabilityRecord['state'] = mappings.length === 0 ? 'missing' : complete ? 'complete' : 'incomplete';
    const confidenceValues = mappings.map(item => item.confidence).filter((value): value is number => value !== null && Number.isFinite(value));
    const unavailable = mappings.find(item => item.evidenceStatus !== 'verified');
    records.push({
      requirementId: requirement.id,
      title: requirement.title,
      description: requirement.description,
      category: requirement.category,
      state,
      mappingIds: mappings.map(item => item.id),
      sourceArtifactIds: Array.from(new Set(mappings.flatMap(item => item.targetArtifactId ? [item.targetArtifactId] : []))),
      sourceSymbolIds: Array.from(new Set(mappings.flatMap(item => item.targetSymbolId ? [item.targetSymbolId] : []))),
      confidence: confidenceValues.length ? Math.min(...confidenceValues) : null,
      capturedAt,
      ...(unavailable ? { evidenceStatus: unavailable.evidenceStatus, evidenceReason: unavailable.evidenceReason } : { evidenceStatus: 'verified' as const }),
      mappings,
    });
  }

  const summary = summarizeTraceability(records);
  summary.unavailable = records.filter(item => item.evidenceStatus === 'stale' || item.evidenceStatus === 'unavailable').length;
  const metadata: ReviewTraceabilityMetadata = {
    snapshotVersion: 2,
    sourceManifestId: input.sourceManifestId,
    inclusionBasis: {
      requirementSelection: explicitRequirementIds ? 'explicit' : 'project',
      artifactSelection: explicitArtifactIds ? 'explicit' : 'full_manifest',
      selectedRequirementIds,
      selectedArtifactIds,
      sourceManifestId: input.sourceManifestId,
    },
    grounding: structuredClone({ confirmedRequirements: selectedRequirements, enabledStandardRules }),
    unavailableReason: null,
  };
  return { sessionId: reviewId, projectId, status: 'available', records, summary, capturedAt, updatedAt: capturedAt, metadata };
}
