import { effectiveFindingStatus } from './findingStatus';
import { priorityRank } from './riskPolicy';
import type { ReviewAnalysisMap } from './reviewHarness';
import type { EvidenceSufficiencyAssessment, Finding, ReviewSourceManifest, ReviewTraceabilitySnapshot } from './types';

/** Presentation of saved evidence only. A completed run is not a readiness proof. */
export function reviewHandover(input: {
  findings: Finding[]; findingsError: string | null; state: string; executionStatus?: string; modelStatus?: string; evidenceReady?: boolean;
  manifest: ReviewSourceManifest | null; traceability: ReviewTraceabilitySnapshot | null;
  assessment: EvidenceSufficiencyAssessment | null; map?: ReviewAnalysisMap | null;
}) {
  const rank = (item: Finding) => ({ critical: 0, high: 1, medium: 2, low: 3 }[item.severity.toLowerCase()] ?? 4);
  const open = input.findings.filter(item => !['fixed', 'dismissed'].includes(effectiveFindingStatus(item)))
    .sort((a, b) => rank(a) - rank(b) || priorityRank(a.priority) - priorityRank(b.priority) || (a.filePath ?? '').localeCompare(b.filePath ?? '') || (a.title ?? '').localeCompare(b.title ?? '') || a.id.localeCompare(b.id));
  const uncertain = (item: Finding) => Boolean(item.evidenceGap)
    || item.location?.sourceLocator?.citationEvidence?.verification === 'needs_verification'
    || !['deterministic', 'model'].includes(item.verifier ?? '') || !item.evidenceText?.trim();
  const blockers = open.filter(item => !uncertain(item) && /^(critical|high)$/i.test(item.severity));
  const risks = open.filter(item => !uncertain(item) && !blockers.includes(item));
  const gaps = open.filter(uncertain);
  const reasons: string[] = [];
  if (input.evidenceReady === false) reasons.push('Some saved evidence is still loading or unavailable.');
  if (input.findingsError) reasons.push('Findings could not be loaded.');
  if (!['Completed', 'Need Approval'].includes(input.state)
    || (input.executionStatus && !['success', 'completed', 'pending_approval', 'approved', 'changes_requested'].includes(input.executionStatus))
    || (input.modelStatus && input.modelStatus !== 'succeeded')) reasons.push('The review has not completed its assessment.');
  if (input.manifest?.status !== 'available' || !input.manifest.artifacts?.length
    || input.manifest.artifacts.some(item => !item.artifactVersionId || !item.contentHash)) reasons.push('Exact saved source coverage is incomplete.');
  if (!input.assessment || input.assessment.readiness !== 'ready' || input.assessment.gaps.length || input.assessment.contradictions.length) reasons.push('Document and requirement evidence needs confirmation.');
  const trace = input.traceability;
  if (trace?.status !== 'available' || !trace.records.length || trace.records.some(item => item.state !== 'complete' || item.evidenceStatus !== 'verified')) reasons.push('Requirement coverage is not fully verified.');
  const map = input.map;
  if (!map || map.status !== 'assessed' || !map.features.length || map.coverage.unsupportedArtifacts.length
    || map.coverage.unresolvedEdgeCount || map.coverage.limitations.length
    || map.features.some(feature => feature.unresolved.length || feature.assessments.length !== 4 || feature.assessments.some(row => row.status !== 'assessed')))
    reasons.push('Feature or runtime coverage has unverified boundaries.');
  if (gaps.length) reasons.push(`${gaps.length} finding${gaps.length === 1 ? '' : 's'} need evidence verification.`);
  return { blockers, risks, gaps, reasons, recommendation: blockers.length ? 'Changes needed' : reasons.length ? 'Insufficient evidence' : 'Ready within scope' };
}
