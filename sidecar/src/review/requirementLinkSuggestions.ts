import type { Artifact } from '../artifacts.js';
import type { ReviewAnalysisMap } from './featurePathAnalysis.js';
import type { ConfirmedRequirement } from './grounding.js';
import { needsCitationVerification } from './evidenceCandidates.js';
import type { StaticFindingInput } from './types.js';

/**
 * Suggested requirement links (user-approved, 5 November 2026).
 *
 * After a Review, Centinel proposes requirement -> file/symbol mappings using
 * only deterministic evidence already validated by the Review:
 *   1. a validated finding that references a confirmed requirement;
 *   2. a validated finding whose locations cite the requirement's own lines;
 *   3. a validated (assessed) feature assessment citing the requirement lines.
 * The target is the code file (and operation label) that evidence cites.
 *
 * Suggestions are stored as unconfirmed `requirement_mappings` rows with
 * `coverage_status = 'suggested'`. They never count for traceability until a
 * person confirms them; a rejected suggestion keeps `suggestion_rejected` so
 * the same link is not proposed again.
 */

export const SUGGESTED_MAPPING_STATUS = 'suggested';
export const REJECTED_SUGGESTION_STATUS = 'suggestion_rejected';
/** Coverage recorded when a person confirms a suggested link. */
export const CONFIRMED_SUGGESTION_STATUS = 'unknown';
const UNCONFIRMED_STATUSES = new Set([SUGGESTED_MAPPING_STATUS, REJECTED_SUGGESTION_STATUS]);

/** Only confirmed (human-entered or human-confirmed) mappings count for traceability. */
export function isConfirmedMappingStatus(coverageStatus: string | null | undefined): boolean {
  return !UNCONFIRMED_STATUSES.has((coverageStatus ?? '').trim().toLowerCase());
}

export type RequirementLinkBasis = 'finding_requirement_reference' | 'finding_cites_requirement' | 'assessment_cites_requirement';

export type RequirementLinkSuggestion = {
  requirementId: string;
  artifactId: string;
  symbolId: string | null;
  confidence: number;
  basis: RequirementLinkBasis;
};

const BASIS_CONFIDENCE: Record<RequirementLinkBasis, number> = {
  finding_requirement_reference: 0.8,
  finding_cites_requirement: 0.7,
  assessment_cites_requirement: 0.6,
};
export const MAX_SUGGESTIONS_PER_REQUIREMENT = 5;
export const MAX_SUGGESTIONS_PER_REVIEW = 50;
const MAX_SYMBOL = 200;

type Location = { artifactId?: string | null; filePath: string; lineNumber: number | null };

function isCodeArtifact(artifact: Artifact | undefined): artifact is Artifact {
  return Boolean(artifact) && !['requirement', 'design', 'coding_standard'].includes(artifact!.type);
}

function citesRequirement(location: Location, requirement: ConfirmedRequirement, artifacts: Map<string, Artifact>): boolean {
  const locator = requirement.sourceLocator;
  if (!locator?.artifactId || location.lineNumber == null) return false;
  const sameArtifact = location.artifactId ? location.artifactId === locator.artifactId
    : location.filePath === (artifacts.get(locator.artifactId)?.filePath ?? locator.filePath);
  if (!sameArtifact || typeof locator.lineStart !== 'number') return false;
  const end = typeof locator.lineEnd === 'number' && locator.lineEnd >= locator.lineStart ? locator.lineEnd : locator.lineStart;
  return location.lineNumber >= locator.lineStart && location.lineNumber <= end;
}

function clipSymbol(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MAX_SYMBOL) : null;
}

export function suggestRequirementLinks(input: {
  requirements: ConfirmedRequirement[];
  artifacts: Artifact[];
  findings: StaticFindingInput[];
  analysisMap?: ReviewAnalysisMap | null;
}): RequirementLinkSuggestion[] {
  const artifacts = new Map(input.artifacts.map(item => [item.id, item]));
  const artifactByPath = new Map(input.artifacts.map(item => [item.filePath, item]));
  const features = new Map((input.analysisMap?.features ?? []).map(item => [item.id, item]));
  const byKey = new Map<string, RequirementLinkSuggestion>();
  const add = (requirement: ConfirmedRequirement, artifactId: string | null | undefined, filePath: string, symbol: string | null, basis: RequirementLinkBasis) => {
    const artifact = artifactId ? artifacts.get(artifactId) : artifactByPath.get(filePath);
    if (!isCodeArtifact(artifact) || artifact.id === requirement.sourceLocator?.artifactId) return;
    const symbolId = clipSymbol(symbol);
    const key = [requirement.id, artifact.id, symbolId ?? ''].join('\u0000');
    const confidence = BASIS_CONFIDENCE[basis];
    const existing = byKey.get(key);
    if (!existing || existing.confidence < confidence) byKey.set(key, { requirementId: requirement.id, artifactId: artifact.id, symbolId, confidence, basis });
  };
  const featureLabel = (finding: StaticFindingInput): string | null => {
    const analysis = finding.sourceLocator?.analysis as { featureId?: unknown } | undefined;
    return typeof analysis?.featureId === 'string' ? features.get(analysis.featureId)?.label ?? null : null;
  };

  const validated = input.findings.filter(finding => !needsCitationVerification(finding));
  for (const requirement of input.requirements) {
    for (const finding of validated) {
      const primary: Location = { artifactId: finding.artifactId, filePath: finding.filePath, lineNumber: finding.lineNumber };
      const locations: Location[] = [primary, ...(finding.relatedLocations ?? [])];
      const codeLocations = locations.filter(location => !citesRequirement(location, requirement, artifacts));
      if (finding.requirementId === requirement.id) {
        for (const location of codeLocations) add(requirement, location.artifactId, location.filePath, location === primary ? featureLabel(finding) : null, 'finding_requirement_reference');
      } else if (codeLocations.length < locations.length) {
        for (const location of codeLocations) add(requirement, location.artifactId, location.filePath, location === primary ? featureLabel(finding) : null, 'finding_cites_requirement');
      }
    }
    for (const feature of features.values()) {
      const cited = feature.assessments.some(assessment => assessment.status === 'assessed'
        && assessment.evidence.some(reference => citesRequirement(reference, requirement, artifacts)));
      if (!cited) continue;
      for (const entry of feature.entryPoints) add(requirement, entry.artifactId, entry.filePath, feature.label, 'assessment_cites_requirement');
    }
  }

  const perRequirement = new Map<string, number>();
  return [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence || a.requirementId.localeCompare(b.requirementId)
      || a.artifactId.localeCompare(b.artifactId) || (a.symbolId ?? '').localeCompare(b.symbolId ?? ''))
    .filter(item => {
      const count = perRequirement.get(item.requirementId) ?? 0;
      if (count >= MAX_SUGGESTIONS_PER_REQUIREMENT) return false;
      perRequirement.set(item.requirementId, count + 1);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS_PER_REVIEW);
}
