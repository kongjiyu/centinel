import type { Finding, ProjectReadinessStatus, ReadinessGap } from './types';

const CATEGORY_LABELS: Record<ReadinessGap['category'], string> = {
  repository: 'Repository',
  requirements: 'Requirement specification',
  design: 'Design documentation',
  standards: 'Coding standards',
};

/** Show only gaps from the current saved readiness snapshot in Project Findings. */
export function projectReadinessFindings(status: ProjectReadinessStatus | null): Finding[] {
  const snapshot = status?.snapshot;
  if (!snapshot || status.stale) return [];

  return snapshot.findings.map(gap => mapReadinessGap(snapshot.id, snapshot.assessedAt, status.projectId, gap));
}

function mapReadinessGap(assessmentId: string, assessedAt: string, projectId: string, gap: ReadinessGap): Finding {
  const firstReference = gap.references[0] ?? null;
  const evidenceText = gap.references.map(reference => `Source: ${reference.path}${reference.sourceVersion ? `\nVersion: ${reference.sourceVersion}` : ''}\n${reference.excerpt}`).join('\n\n');
  const blocking = gap.severity === 'blocking';

  return {
    id: `readiness-${assessmentId}-${gap.id}`,
    projectId,
    sessionId: null,
    source: 'static',
    verifier: 'readiness',
    evidenceGap: { assessmentId, code: gap.id },
    severity: blocking ? 'high' : 'medium',
    priority: blocking ? 'High' : 'Medium',
    title: gap.title,
    description: gap.description,
    recommendation: gap.recommendation,
    evidenceText,
    status: 'new',
    confidence: 'high',
    createdAt: assessedAt,
    updatedAt: assessedAt,
    artifactId: firstReference?.artifactId ?? null,
    relatedSources: gap.references.map(reference => ({ artifactId: reference.artifactId, filePath: reference.path, sourceVersion: reference.sourceVersion,
      excerpt: reference.excerpt, relation: gap.category === 'repository' ? 'code' : gap.category === 'requirements' ? 'requirement' : 'document' })),
    category: `Readiness · ${CATEGORY_LABELS[gap.category]}`,
    fromRemarks: false,
    filePath: firstReference?.path ?? '',
    lineNumber: null,
  };
}
