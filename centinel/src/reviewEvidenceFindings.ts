import { featureDisplayName, groupReviewFeatures } from './reviewFeatures';
import type { ReviewAnalysisMap } from './reviewHarness';
import type { EvidenceSufficiencyAssessment, Finding, ReviewSourceManifest, ReviewTraceabilitySnapshot, StaticSession } from './types';

/** Present saved assessment gaps alongside code findings without altering history. */
export function reviewEvidenceFindings(session: Pick<StaticSession, 'id' | 'projectId'>, assessment: EvidenceSufficiencyAssessment | null,
  sources: ReviewSourceManifest['artifacts'] = []): Finding[] {
  if (!assessment || assessment.reviewId !== session.id || assessment.projectId !== session.projectId) return [];
  return [...new Map(assessment.gaps.map(gap => [gap.id, gap])).values()].map(gap => {
    const filePath = gap.artifactId ? sources?.find(file => file.id === gap.artifactId)?.filePath ?? '' : '';
    return {
      id: `document-gap-${session.id}-${gap.id}`, projectId: session.projectId, sessionId: session.id,
      source: 'static', verifier: 'evidence_assessment', category: gap.code === 'traceability_mappings_incomplete' ? 'Traceability' : 'Review documents',
      severity: gap.severity === 'blocking' ? 'high' : 'medium', priority: gap.severity === 'blocking' ? 'High' : 'Medium',
      title: gap.title, description: gap.detail, recommendation: gap.remediation,
      evidenceText: `Document check saved at ${assessment.assessedAt}. ${gap.detail}`,
      evidenceGap: { assessmentId: assessment.id, code: gap.code }, status: 'new', confidence: 'high',
      requirementId: gap.requirementId, relatedSources: gap.references,
      createdAt: assessment.assessedAt, artifactId: gap.artifactId ?? null, filePath, lineNumber: null, fromRemarks: false,
    };
  });
}

export function mergeReviewFindings(findings: Finding[], gaps: Finding[]): Finding[] {
  return [...new Map([...gaps, ...findings].map(finding => [finding.id, finding])).values()];
}

/** Project the saved traceability state into evidence findings, keeping persisted findings immutable. */
export function reviewTraceabilityFindings(
  session: Pick<StaticSession, 'id' | 'projectId'>,
  snapshot: ReviewTraceabilitySnapshot | null,
  map: ReviewAnalysisMap | null | undefined,
  findings: Finding[],
): Finding[] {
  if (snapshot?.status !== 'available' || snapshot.sessionId !== session.id || snapshot.projectId !== session.projectId || !map) return [];
  const requirements = new Map(snapshot.records.map(record => [record.requirementId, record]));
  return groupReviewFeatures(map, findings, snapshot).flatMap(({ feature, operations }) => {
    const points = operations.flatMap(operation => operation.entryPoints);
    const artifacts = new Set(points.map(point => point.artifactId));
    const linked = new Set(findings.flatMap(finding => {
      const analysis = finding.location?.sourceLocator?.analysis;
      return finding.requirementId && analysis && operations.some(operation =>
        operation.id === analysis.featureId && operation.paths.some(path => path.id === analysis.pathId))
        ? [finding.requirementId] : [];
    }));
    const direct = [...linked].flatMap(id => requirements.get(id) ?? []);
    const missing = direct.length ? direct.some(record => record.state === 'missing')
      : !snapshot.records.some(record => record.sourceArtifactIds.some(id => artifacts.has(id)));
    if (!missing && direct.length && direct.every(record => record.state === 'complete'
      && (!record.evidenceStatus || record.evidenceStatus === 'verified')
      && record.sourceArtifactIds.some(id => artifacts.has(id)))) return [];
    const featureName = featureDisplayName(feature.label);
    const title = missing ? 'Missing requirement traceability' : 'Incomplete requirement traceability';
    const description = missing ? `${featureName} has no complete requirement link in the saved Review evidence.`
      : `${featureName} has partial or file-level requirement evidence. A verified feature-level link is needed.`;
    return [{
      id: `traceability-${session.id}-${feature.id}`, projectId: session.projectId, sessionId: session.id,
      source: 'static', verifier: 'evidence_assessment', category: 'Traceability', severity: 'medium', priority: 'Medium',
      title, description, evidenceText: description,
      recommendation: 'Confirm the requirement for this feature and link it to the reviewed implementation.',
      status: 'new', confidence: 'high', createdAt: snapshot.updatedAt ?? snapshot.capturedAt ?? '',
      artifactId: null, filePath: '', lineNumber: null, fromRemarks: false,
      evidenceGap: { assessmentId: session.id, code: missing ? 'feature_traceability_missing' : 'feature_traceability_incomplete' },
      affectedFeature: featureName,
      relatedSources: points.map(point => ({ ...point, relation: 'code' as const })),
      location: { domain: 'business', sourceLocator: { analysis: { featureId: feature.id, pathId: feature.paths[0]?.id ?? '', domain: 'business' } } },
    }];
  });
}
