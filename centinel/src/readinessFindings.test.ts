import { describe, expect, it } from 'vitest';
import type { ProjectReadinessStatus } from './types';
import { projectReadinessFindings } from './readinessFindings';

const status: ProjectReadinessStatus = {
  projectId: 'project-1', requestId: 'request-1', status: 'completed', trigger: 'manual',
  requestedAt: '2026-10-19T10:00:00.000Z', startedAt: '2026-10-19T10:00:02.000Z', completedAt: '2026-10-19T10:00:08.000Z',
  error: null, stale: false,
  snapshot: {
    id: 'assessment-1', projectId: 'project-1', sourceFingerprint: 'source-1', assessedAt: '2026-10-19T10:00:08.000Z',
    categories: [],
    findings: [
      {
        id: 'requirements-clarity', category: 'requirements', title: 'Clarify the acceptance criteria',
        description: 'The expected outcome is not verifiable.', recommendation: 'Add an observable pass condition.',
        severity: 'blocking', references: [
          { artifactId: 'artifact-1', path: 'requirements.md', excerpt: 'The feature should work well.' },
          { artifactId: 'artifact-2', path: 'overview.md', excerpt: 'Several users asked for it.' },
        ],
      },
      {
        id: 'standards-policy', category: 'standards', title: 'Define a coding standard',
        description: 'No applicable coding rules are documented.', recommendation: 'Document rules and how they are checked.',
        severity: 'warning', references: [],
      },
    ],
  },
};

describe('projectReadinessFindings', () => {
  it('maps the current snapshot gaps to immutable, evidence-backed project findings', () => {
    const [requirements, standards] = projectReadinessFindings(status);

    expect(requirements).toMatchObject({
      id: 'readiness-assessment-1-requirements-clarity', projectId: 'project-1', sessionId: null,
      verifier: 'readiness', category: 'Readiness · Requirement specification', source: 'static',
      severity: 'high', priority: 'High', status: 'new',
      evidenceGap: { assessmentId: 'assessment-1', code: 'requirements-clarity' },
      artifactId: 'artifact-1', filePath: 'requirements.md',
      evidenceText: 'Source: requirements.md\nThe feature should work well.\n\nSource: overview.md\nSeveral users asked for it.',
    });
    expect(requirements.evidenceText).not.toContain('No location');
    expect(standards).toMatchObject({
      verifier: 'readiness', category: 'Readiness · Coding standards', severity: 'medium', priority: 'Medium',
      filePath: '', artifactId: null, evidenceText: '',
      evidenceGap: { assessmentId: 'assessment-1', code: 'standards-policy' },
    });
  });

  it('hides gaps from an outdated snapshot until the current assessment completes', () => {
    expect(projectReadinessFindings({ ...status, stale: true })).toEqual([]);
    expect(projectReadinessFindings({ ...status, snapshot: null })).toEqual([]);
  });
});
