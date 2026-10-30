import type { EvidenceArtifact } from './evidenceSufficiency.js';
import { deriveReviewAnalysisMap, type ReviewAnalysisMap } from './featurePathAnalysis.js';
import { planAssessmentBatches, type AssessmentBatch } from './assessmentBatches.js';
import { ModelProviderError } from './retry.js';

export type PreparedAssessmentPlan = {
  map: ReviewAnalysisMap;
  batches: AssessmentBatch[];
  /** Diagnostic only: never substitute this map for the text assessment map. */
  syntaxMap?: ReviewAnalysisMap;
};

/** A context-capability fallback retains every source; it cannot repair bad evidence. */
export function prepareAssessmentPlan(map: ReviewAnalysisMap, evidence: EvidenceArtifact[]): PreparedAssessmentPlan {
  try { return { map, batches: planAssessmentBatches(map, evidence) }; }
  catch (cause) {
    if (!(cause instanceof ModelProviderError) || cause.code !== 'context_limit') throw cause;
    const unsupported = (map.coverage.unsupportedExecutableArtifacts ?? 0) - (map.coverage.plainTextLogicArtifactCount ?? 0);
    if (unsupported > 0 || map.coverage.featureInventoryTruncated || map.coverage.selectedModuleGraphTruncated
      || (map.coverage.exportExpansionTruncatedCount ?? 0) > 0
      || evidence.some(item => typeof item.content !== 'string' || item.state && item.state !== 'available')) throw cause;
    const plainTextArtifactIds = new Set(evidence.filter(item => /\.(?:[cm]?js|jsx|tsx?)$/i.test(item.artifact.fileName))
      .map(item => item.artifact.id));
    if (!plainTextArtifactIds.size) throw cause;
    const textMap = deriveReviewAnalysisMap(evidence, { plainTextArtifactIds });
    if (textMap.coverage.featureInventoryTruncated || textMap.coverage.selectedModuleGraphTruncated
      || (textMap.coverage.exportExpansionTruncatedCount ?? 0) > 0
      || (textMap.coverage.unsupportedExecutableArtifacts ?? 0) > (textMap.coverage.plainTextLogicArtifactCount ?? 0)) throw cause;
    textMap.coverage.assessmentMode = 'plain_text_context_fallback';
    const syntaxFeatureCount = map.features.filter(feature => feature.analysisKind !== 'plain_text_logic').length;
    textMap.coverage.syntaxFeatureCount = syntaxFeatureCount;
    textMap.coverage.limitations.push(`The original syntax map contains ${syntaxFeatureCount} operations, retained separately as diagnostics. The complete operation assessment exceeds the bounded source or request-count plan; this Review assesses complete selected-source text units instead, without mapped-operation, dependency or runtime coverage proof.`);
    return { map: textMap, batches: planAssessmentBatches(textMap, evidence), syntaxMap: map };
  }
}
