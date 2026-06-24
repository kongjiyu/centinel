import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/staticSessions.js', () => ({
  listAllFindings: vi.fn().mockResolvedValue([]),
  listStaticSessions: vi.fn().mockResolvedValue([]),
  listReviewArtifacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/requirements.js', () => ({
  listRequirements: vi.fn().mockResolvedValue([]),
  getRequirementMappings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/artifacts.js', () => ({
  listArtifacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/repoIndex.js', () => ({
  getIndexedFiles: vi.fn().mockResolvedValue([]),
  getDependencyCounts: vi.fn().mockResolvedValue({}),
}));

import { buildQualityDashboard } from '../../src/qualityDashboard';
import { listAllFindings, listStaticSessions } from '../../src/staticSessions';
import { listRequirements, getRequirementMappings } from '../../src/requirements';
import { listArtifacts } from '../../src/artifacts';
import { getIndexedFiles } from '../../src/repoIndex';

describe('qualityDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildQualityDashboard', () => {
    it('should return valid empty dashboard for project with no data', async () => {
      const dashboard = await buildQualityDashboard('proj-1');

      expect(dashboard.overview).toBeDefined();
      expect(dashboard.overview.totalFindings).toBe(0);
      expect(dashboard.overview.releaseReadinessScore).toBe(100);
      expect(dashboard.overview.releaseReadinessStatus).toBe('ready');
      expect(dashboard.criticalIssues).toEqual([]);
      expect(dashboard.traceability).toEqual([]);
      expect(dashboard.developerQueue).toEqual([]);
    });

    it('should reduce readiness score for critical findings', async () => {
      vi.mocked(listAllFindings).mockResolvedValue([
        {
          id: 'f1', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'critical', title: 'Critical Bug', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'potential_bug',
          evidenceText: '', recommendation: 'fix it', confidence: 'high', fromRemarks: false,
        },
        {
          id: 'f2', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'critical', title: 'Another Critical', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'security_concern',
          evidenceText: '', recommendation: 'fix', confidence: 'high', fromRemarks: false,
        },
      ] as any);

      const dashboard = await buildQualityDashboard('proj-1');

      // 100 - min(2*25, 50) = 100 - 50 = 50
      expect(dashboard.overview.releaseReadinessScore).toBe(50);
      expect(dashboard.overview.releaseReadinessStatus).toBe('blocked');
      expect(dashboard.overview.riskLevel).toBe('critical');
      expect(dashboard.criticalIssues).toHaveLength(2);
    });

    it('should reduce readiness score for high findings', async () => {
      vi.mocked(listAllFindings).mockResolvedValue([
        {
          id: 'f1', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'high', title: 'High Bug', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: 'fix', confidence: 'medium', fromRemarks: false,
        },
        {
          id: 'f2', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'high', title: 'Another High', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: 'fix', confidence: 'medium', fromRemarks: false,
        },
        {
          id: 'f3', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'high', title: 'Third High', description: 'test',
          status: 'new', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: 'fix', confidence: 'medium', fromRemarks: false,
        },
      ] as any);

      const dashboard = await buildQualityDashboard('proj-1');

      // 100 - min(3*10, 30) = 100 - 30 = 70
      expect(dashboard.overview.releaseReadinessScore).toBe(70);
      expect(dashboard.overview.releaseReadinessStatus).toBe('caution');
      expect(dashboard.overview.riskLevel).toBe('high');
    });

    it('should not count fixed or dismissed findings as blockers', async () => {
      vi.mocked(listAllFindings).mockResolvedValue([
        {
          id: 'f1', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'critical', title: 'Fixed Critical', description: 'test',
          status: 'fixed', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: '', confidence: 'high', fromRemarks: false,
        },
        {
          id: 'f2', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'high', title: 'Dismissed High', description: 'test',
          status: 'dismissed', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: '', confidence: 'high', fromRemarks: false,
        },
      ] as any);

      const dashboard = await buildQualityDashboard('proj-1');

      expect(dashboard.overview.releaseReadinessScore).toBe(100);
      expect(dashboard.overview.releaseReadinessStatus).toBe('ready');
      expect(dashboard.criticalIssues).toHaveLength(0);
    });

    it('should compute requirement coverage correctly', async () => {
      vi.mocked(listRequirements).mockResolvedValue([
        { id: 'r1', projectId: 'proj-1', title: 'Req 1', description: '', category: '', priority: '', createdAt: '' },
        { id: 'r2', projectId: 'proj-1', title: 'Req 2', description: '', category: '', priority: '', createdAt: '' },
        { id: 'r3', projectId: 'proj-1', title: 'Req 3', description: '', category: '', priority: '', createdAt: '' },
      ] as any);

      vi.mocked(getRequirementMappings).mockImplementation(async (reqId: string) => {
        if (reqId === 'r1') return [{ id: 'm1', requirementId: 'r1', fileId: 'f1', symbolId: null, coverageStatus: 'implemented', confidence: 0.9 }];
        if (reqId === 'r2') return [{ id: 'm2', requirementId: 'r2', fileId: 'f2', symbolId: null, coverageStatus: 'partial', confidence: 0.5 }];
        return [];
      });

      const dashboard = await buildQualityDashboard('proj-1');

      expect(dashboard.overview.totalRequirements).toBe(3);
      expect(dashboard.overview.mappedRequirements).toBe(2);
      expect(dashboard.overview.unmappedRequirements).toBe(1);
      expect(dashboard.overview.requirementCoveragePct).toBe(67);
    });

    it('should sort developer queue by priority', async () => {
      vi.mocked(listAllFindings).mockResolvedValue([
        {
          id: 'f1', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'low', title: 'Low Issue', description: '',
          status: 'new', createdAt: '', artifactId: null, category: 'style',
          evidenceText: '', recommendation: '', confidence: 'low', fromRemarks: false,
        },
        {
          id: 'f2', projectId: 'proj-1', sessionId: null, source: 'static',
          severity: 'critical', title: 'Critical Issue', description: '',
          status: 'new', createdAt: '', artifactId: null, category: 'bug',
          evidenceText: '', recommendation: '', confidence: 'high', fromRemarks: false,
        },
      ] as any);

      const dashboard = await buildQualityDashboard('proj-1');

      expect(dashboard.developerQueue[0].title).toBe('Critical Issue');
      expect(dashboard.developerQueue[1].title).toBe('Low Issue');
    });

    it('should identify requirements needing tests', async () => {
      vi.mocked(listRequirements).mockResolvedValue([
        { id: 'r1', projectId: 'proj-1', title: 'Req 1', description: '', category: '', priority: '', createdAt: '' },
        { id: 'r2', projectId: 'proj-1', title: 'Req 2', description: '', category: '', priority: '', createdAt: '' },
      ] as any);

      // Only r1 has mappings
      vi.mocked(getRequirementMappings).mockImplementation(async (reqId: string) => {
        if (reqId === 'r1') return [{ id: 'm1', requirementId: 'r1', fileId: 'f1', symbolId: null, coverageStatus: 'implemented', confidence: 0.9 }];
        return [];
      });

      const dashboard = await buildQualityDashboard('proj-1');

      expect(dashboard.qaValidation.requirementsNeedingTests).toBe(1);
      expect(dashboard.qaValidation.requirementsWithTests).toBe(1);
    });
  });
});
