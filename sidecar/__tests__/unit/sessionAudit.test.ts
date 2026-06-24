import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/staticSessions.js', () => ({
  getStaticSession: vi.fn(),
  listStaticFindings: vi.fn().mockResolvedValue([]),
  listReviewArtifacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/requirements.js', () => ({
  listRequirements: vi.fn().mockResolvedValue([]),
  getRequirementMappings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/repoIndex.js', () => ({
  getIndexedFiles: vi.fn().mockResolvedValue([]),
}));

import { buildSessionAuditReport } from '../../src/sessionAudit';
import { getStaticSession, listStaticFindings, listReviewArtifacts } from '../../src/staticSessions';
import { listRequirements, getRequirementMappings } from '../../src/requirements';
import { getIndexedFiles } from '../../src/repoIndex';

describe('sessionAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSessionAuditReport', () => {
    it('should return null for non-existent session', async () => {
      vi.mocked(getStaticSession).mockResolvedValue(null);
      const report = await buildSessionAuditReport('proj-1', 'non-existent');
      expect(report).toBeNull();
    });

    it('should return empty-safe data for successful session with no findings', async () => {
      vi.mocked(getStaticSession).mockResolvedValue({
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review',
        status: 'success', configJson: '{}', progressJson: '{}', remarks: '',
        finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
      });

      const report = await buildSessionAuditReport('proj-1', 'ss-1');

      expect(report).not.toBeNull();
      expect(report!.verdict.status).toBe('pass');
      expect(report!.verdict.score).toBe(100);
      expect(report!.issueCounts.total).toBe(0);
      expect(report!.criticalFindings).toHaveLength(0);
    });

    it('should compute verdict correctly for critical findings', async () => {
      vi.mocked(getStaticSession).mockResolvedValue({
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review',
        status: 'success', configJson: '{}', progressJson: '{}', remarks: '',
        finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
      });

      vi.mocked(listStaticFindings).mockResolvedValue([
        {
          id: 'f1', projectId: 'proj-1', sessionId: 'ss-1', source: 'static',
          severity: 'critical', title: 'Critical Bug', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: '', confidence: 'high', fromRemarks: false,
        },
        {
          id: 'f2', projectId: 'proj-1', sessionId: 'ss-1', source: 'static',
          severity: 'critical', title: 'Another Critical', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'security',
          evidenceText: '', recommendation: '', confidence: 'high', fromRemarks: false,
        },
      ] as any);

      const report = await buildSessionAuditReport('proj-1', 'ss-1');

      expect(report!.verdict.status).toBe('blocked');
      expect(report!.verdict.score).toBe(50); // 100 - min(2*25, 50) = 50
      expect(report!.criticalFindings).toHaveLength(2);
      expect(report!.issueCounts.critical).toBe(2);
    });

    it('should not count fixed findings as blockers', async () => {
      vi.mocked(getStaticSession).mockResolvedValue({
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review',
        status: 'success', configJson: '{}', progressJson: '{}', remarks: '',
        finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
      });

      vi.mocked(listStaticFindings).mockResolvedValue([
        {
          id: 'f1', projectId: 'proj-1', sessionId: 'ss-1', source: 'static',
          severity: 'critical', title: 'Fixed Critical', description: 'test',
          status: 'fixed', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: '', confidence: 'high', fromRemarks: false,
        },
      ] as any);

      const report = await buildSessionAuditReport('proj-1', 'ss-1');

      expect(report!.verdict.status).toBe('pass');
      expect(report!.verdict.score).toBe(100);
      expect(report!.criticalFindings).toHaveLength(0);
    });

    it('should resolve mapped file paths in traceability', async () => {
      vi.mocked(getStaticSession).mockResolvedValue({
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'requirement_review',
        status: 'success', configJson: '{}', progressJson: '{}', remarks: '',
        finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
      });

      vi.mocked(listRequirements).mockResolvedValue([
        { id: 'r1', projectId: 'proj-1', title: 'Login Feature', description: 'User login', category: 'feature', priority: 'high', createdAt: '' },
      ] as any);

      vi.mocked(getRequirementMappings).mockResolvedValue([
        { id: 'm1', requirementId: 'r1', fileId: 'file-1', symbolId: null, coverageStatus: 'implemented', confidence: 0.9 },
      ] as any);

      vi.mocked(getIndexedFiles).mockResolvedValue([
        { id: 'file-1', projectId: 'proj-1', filePath: '/src/auth/login.ts', parentPath: '/src/auth', fileType: 'source_code', language: 'typescript', fileSize: 1000, symbolCount: 5, indexedAt: '' },
      ] as any);

      const report = await buildSessionAuditReport('proj-1', 'ss-1');

      expect(report!.traceability).toHaveLength(1);
      expect(report!.traceability[0].mappedFiles).toContain('/src/auth/login.ts');
      expect(report!.traceability[0].implementationStatus).toBe('implemented');
      expect(report!.traceability[0].confidence).toBe(0.9);
    });

    it('should treat low-confidence mappings as unclear', async () => {
      vi.mocked(getStaticSession).mockResolvedValue({
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'requirement_review',
        status: 'success', configJson: '{}', progressJson: '{}', remarks: '',
        finalSummary: '', failureReason: '', createdAt: '', updatedAt: '',
      });

      vi.mocked(listRequirements).mockResolvedValue([
        { id: 'r1', projectId: 'proj-1', title: 'Feature', description: '', category: '', priority: '', createdAt: '' },
      ] as any);

      vi.mocked(getRequirementMappings).mockResolvedValue([
        { id: 'm1', requirementId: 'r1', fileId: null, symbolId: null, coverageStatus: 'unknown', confidence: 0.3 },
      ] as any);

      const report = await buildSessionAuditReport('proj-1', 'ss-1');

      expect(report!.traceability[0].implementationStatus).toBe('unclear');
    });
  });
});
