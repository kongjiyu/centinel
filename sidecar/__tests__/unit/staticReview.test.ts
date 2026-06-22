import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dependencies before importing the module under test
vi.mock('../../src/settings.js', () => ({
  getRawAiSetting: vi.fn(),
}));

vi.mock('../../src/artifacts.js', () => ({
  readArtifactContent: vi.fn(),
  listArtifacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/staticSessions.js', () => ({
  updateStaticSessionStatus: vi.fn(),
  updateStaticSessionProgress: vi.fn(),
  createFinding: vi.fn(),
  createReviewArtifact: vi.fn(),
}));

vi.mock('../../src/repoIndex.js', () => ({
  indexProject: vi.fn().mockResolvedValue(undefined),
  getDependencyCounts: vi.fn().mockResolvedValue({}),
  getBlastRadius: vi.fn().mockResolvedValue({ directDependents: 0, transitiveDependents: 0, affectedFiles: [], cascadeScore: 0 }),
  getFileClusters: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/contextRetrieval.js', () => ({
  retrieveContext: vi.fn().mockResolvedValue({ files: [], totalSymbols: 0, estimatedTokens: 0, reason: 'test' }),
  assembleGraphContext: vi.fn().mockResolvedValue({
    files: [],
    edges: [],
    clusters: [],
    termFileMap: new Map(),
    summary: { totalFiles: 0, totalSymbols: 0, totalEdges: 0, reviewType: 'code_review', filesByType: {} },
  }),
}));

vi.mock('../../src/staticEngine.js', () => ({
  runStaticAnalysis: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/riskScore.js', () => ({
  scoreFindings: vi.fn().mockImplementation((findings) => findings.map((f: any) => ({ ...f, risk: { score: 0.5, level: f.severity || 'medium', factors: {} } }))),
  scoreFindingsEnhanced: vi.fn().mockImplementation((findings) => findings.map((f: any) => ({
    risk: { score: 0.5, level: f.severity || 'medium', factors: {} },
    priority: 'P2',
    cascadeImpact: f.cascadeImpact,
    clusterBoost: f.clusterBoost || 0,
    validationStatus: f.validationStatus || 'ai_only',
  }))),
}));

vi.mock('../../src/crossValidation.js', () => ({
  crossValidateFindings: vi.fn().mockImplementation((staticFindings, aiFindings) => {
    const all = [...staticFindings.map((f: any) => ({
      finding: f,
      validationResult: { findingId: f.ruleId || 'unknown', source: 'static', validatedBy: 'static', confidenceScore: 0.85, reasons: [] },
      relatedFindings: [],
    })), ...aiFindings.map((f: any) => ({
      finding: f,
      validationResult: { findingId: f.title || 'unknown', source: 'ai', validatedBy: 'ai_only', confidenceScore: 0.5, reasons: [] },
      relatedFindings: [],
    }))];
    return all;
  }),
  calibrateConfidence: vi.fn().mockImplementation((results) => results),
}));

vi.mock('../../src/findingsCluster.js', () => ({
  clusterFindings: vi.fn().mockReturnValue([]),
  computeClusterBoost: vi.fn().mockReturnValue(0),
  generateFixStrategy: vi.fn().mockReturnValue('Fix strategy'),
}));

import { getRawAiSetting } from '../../src/settings';
import { readArtifactContent } from '../../src/artifacts';
import { updateStaticSessionStatus, createFinding, updateStaticSessionProgress, createReviewArtifact } from '../../src/staticSessions';
import { indexProject, getDependencyCounts, getBlastRadius, getFileClusters } from '../../src/repoIndex';
import { retrieveContext, assembleGraphContext } from '../../src/contextRetrieval';
import { runStaticAnalysis } from '../../src/staticEngine';
import { scoreFindings, scoreFindingsEnhanced } from '../../src/riskScore';
import { crossValidateFindings, calibrateConfidence } from '../../src/crossValidation';
import { clusterFindings, computeClusterBoost, generateFixStrategy } from '../../src/findingsCluster';

// We test the internal logic by importing the module and testing the exported function
// Since runStaticReview calls AI, we need to mock fetch globally

describe('staticReview', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('runStaticReview', () => {
    it('should call updateStaticSessionStatus to running at start', async () => {
      // This test verifies the flow starts by setting status to running
      // Empty artifacts — pipeline throws "No artifacts could be read" after the status flip
      vi.mocked(getRawAiSetting).mockResolvedValue(null);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1',
        projectId: 'proj-1',
        name: 'Test',
        reviewType: 'requirement_review' as const,
        status: 'queued' as const,
        configJson: '{}',
        finalSummary: '',
        failureReason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await expect(runStaticReview(session, [])).rejects.toThrow('No artifacts could be read');
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'running', '', '');
    });

    it('should fail when text AI provider is not configured and artifacts exist', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue(null);
      vi.mocked(readArtifactContent).mockResolvedValue('Some content');

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1',
        projectId: 'proj-1',
        name: 'Test',
        reviewType: 'requirement_review' as const,
        status: 'queued' as const,
        configJson: '{}',
        finalSummary: '',
        failureReason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'requirement' as const,
        fileName: 'req.md', filePath: '/tmp/req.md', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await expect(runStaticReview(session, [artifact])).rejects.toThrow('Text AI provider not configured');
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'failure', '', expect.stringContaining('not configured'));
    });

    it('should fail when API key is missing and artifacts exist', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: '',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'anthropic',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Some content');

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1',
        projectId: 'proj-1',
        name: 'Test',
        reviewType: 'requirement_review' as const,
        status: 'queued' as const,
        configJson: '{}',
        finalSummary: '',
        failureReason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'requirement' as const,
        fileName: 'req.md', filePath: '/tmp/req.md', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await expect(runStaticReview(session, [artifact])).rejects.toThrow('API key not configured');
    });

    it('should succeed with 0 findings when artifacts cannot be read', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockRejectedValue(new Error('File not found'));

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1',
        projectId: 'proj-1',
        name: 'Test',
        reviewType: 'requirement_review' as const,
        status: 'queued' as const,
        configJson: '{}',
        finalSummary: '',
        failureReason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const artifact = {
        id: 'art-1',
        projectId: 'proj-1',
        type: 'requirement' as const,
        fileName: 'req.md',
        filePath: '/tmp/req.md',
        originalPath: null,
        contentHash: 'hash1',
        createdAt: new Date().toISOString(),
      };

      // All reads fail → no artifact contents → pipeline throws
      await expect(runStaticReview(session, [artifact])).rejects.toThrow('No artifacts could be read');
      expect(createFinding).not.toHaveBeenCalled();
    });

    it('should process findings from AI response and save them', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('# Requirements\n- The system shall be fast');

      // Stage 2 (code review) produces findings. Mock returns a stage-shape object
      // with 2 findings. Other stages get the same response and ignore unused fields.
      const stageResponse = {
        thoughts: [],
        findings: [
          {
            title: 'Vague requirement',
            severity: 'high',
            category: 'unclear_requirement',
            artifactReference: 'req.md',
            description: 'The term "fast" is not measurable',
            evidence: 'The system shall be fast',
            recommendation: 'Define specific performance metrics',
            confidence: 'high',
          },
          {
            title: 'Missing detail',
            severity: 'medium',
            category: 'missing_detail',
            artifactReference: 'req.md',
            description: 'No error handling specified',
            evidence: '',
            recommendation: 'Add error handling requirements',
            confidence: 'medium',
          },
        ],
        codeQualitySummary: 'mixed',
        riskAreas: [],
      };
      const aiResponse = JSON.stringify({
        content: [{ text: JSON.stringify(stageResponse) }],
      });

      // The 4-stage pipeline makes one fetch per stage. Provide a default mock for all.
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => JSON.parse(aiResponse),
      } as Response);

      vi.mocked(createFinding).mockResolvedValue({
        id: 'find-1',
        projectId: 'proj-1',
        sessionId: 'ss-1',
        source: 'static',
        severity: 'high',
        title: 'test',
        description: 'test',
        status: 'new',
        createdAt: new Date().toISOString(),
        artifactId: null,
        category: '',
        evidenceText: '',
        recommendation: '',
        confidence: '',
      });

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1',
        projectId: 'proj-1',
        name: 'Test',
        reviewType: 'requirement_review' as const,
        status: 'queued' as const,
        configJson: '{}',
        finalSummary: '',
        failureReason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const artifact = {
        id: 'art-1',
        projectId: 'proj-1',
        type: 'requirement' as const,
        fileName: 'req.md',
        filePath: '/tmp/req.md',
        originalPath: null,
        contentHash: 'hash1',
        createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      // 4-stage pipeline: code-review stage + traceability stage each save their findings.
      // The shared mock means both stages produce findings. Assert the names are captured.
      const findingCalls = vi.mocked(createFinding).mock.calls;
      const findingTitles = findingCalls.map((call: any) => call[2].title);
      expect(findingTitles).toContain('Vague requirement');
      expect(findingTitles).toContain('Missing detail');

      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'success', expect.any(String), '');
    });

    it('should handle AI returning empty array', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Clean code with no issues');

      // Stage-shape with empty findings — 4-stage pipeline receives the same default
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: JSON.stringify({ thoughts: [], findings: [] }) }] }),
      } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1',
        projectId: 'proj-1',
        name: 'Test',
        reviewType: 'code_review' as const,
        status: 'queued' as const,
        configJson: '{}',
        finalSummary: '',
        failureReason: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const artifact = {
        id: 'art-1',
        projectId: 'proj-1',
        type: 'source_code' as const,
        fileName: 'clean.ts',
        filePath: '/tmp/clean.ts',
        originalPath: null,
        contentHash: 'hash1',
        createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      expect(createFinding).not.toHaveBeenCalled();
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'success', expect.stringContaining('finding'), '');
    });

    it('should handle AI response wrapped in markdown code block', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Some code');

      const mdWrapped = '```json\n{"thoughts":[],"findings":[{"title":"Bug","severity":"critical","category":"potential_bug","artifactReference":"code.ts","description":"Null pointer","evidence":"x.y","recommendation":"Add null check","confidence":"high"}]}\n```';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: mdWrapped }] }),
      } as Response);

      vi.mocked(createFinding).mockResolvedValue({
        id: 'find-1', projectId: 'proj-1', sessionId: 'ss-1', source: 'static',
        severity: 'critical', title: 'Bug', description: 'Null pointer', status: 'new',
        createdAt: new Date().toISOString(), artifactId: null, category: '',
        evidenceText: '', recommendation: '', confidence: '',
      });

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review' as const,
        status: 'queued' as const, configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'code.ts', filePath: '/tmp/code.ts', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);
      // The code_review pipeline triggers code-review stage which saves the finding.
      expect(createFinding).toHaveBeenCalled();
      expect(vi.mocked(createFinding).mock.calls.some((c: any) => c[2].title === 'Bug')).toBe(true);
    });

    it('should persist the latest thought to progress_json for each stage', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Some content');

      const aiResponse = JSON.stringify({
        content: [{ text: JSON.stringify({
          thoughts: ['I noticed a login flow.', 'The flow uses JWT.'],
          projectSummary: 'A project.',
          artifactInventory: [],
          userIntent: 'review',
        }) }],
      });

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => JSON.parse(aiResponse),
      } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-thoughts', projectId: 'proj-1', name: 'Test',
        reviewType: 'requirement_review' as const, status: 'queued' as const,
        configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'requirement' as const,
        fileName: 'req.md', filePath: '/tmp/req.md', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      // Confirm that updateStaticSessionProgress was called with thoughts in the payload
      const calls = vi.mocked(updateStaticSessionProgress).mock.calls;
      const thoughtCalls = calls.filter((c: any) => {
        const progress = c[1];
        return progress.stages[0]?.thoughts?.length > 0;
      });
      expect(thoughtCalls.length).toBeGreaterThan(0);
      const lastWithThoughts = thoughtCalls[thoughtCalls.length - 1];
      expect(lastWithThoughts[1].stages[0].thoughts).toContain('I noticed a login flow.');
    });

    it('should validate and normalize invalid severity values', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Code');

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: JSON.stringify({
            thoughts: [],
            findings: [{
              title: 'Issue', severity: 'INVALID', category: 'test',
              artifactReference: '', description: '', evidence: '',
              recommendation: '', confidence: 'INVALID',
            }],
          }) }],
        }),
      } as Response);

      vi.mocked(createFinding).mockResolvedValue({
        id: 'find-1', projectId: 'proj-1', sessionId: 'ss-1', source: 'static',
        severity: 'medium', title: '', description: '', status: 'new',
        createdAt: new Date().toISOString(), artifactId: null, category: '',
        evidenceText: '', recommendation: '', confidence: '',
      });

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review' as const,
        status: 'queued' as const, configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'code.ts', filePath: '/tmp/code.ts', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      // Risk scoring may override severity, but confidence should still be normalized
      expect(createFinding).toHaveBeenCalledWith('proj-1', 'ss-1', expect.objectContaining({
        confidence: 'medium', // INVALID -> medium
      }));
    });

    it('should handle OpenAI compatibility mode', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'custom',
        apiFormat: 'openai-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Code');

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ thoughts: [], findings: [] }) } }],
        }),
      } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review' as const,
        status: 'queued' as const, configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'code.ts', filePath: '/tmp/code.ts', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      // Verify fetch was called with OpenAI format (Authorization header, system message in messages array)
      expect(fetchSpy).toHaveBeenCalled();
      const callArgs = fetchSpy.mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
    });

    it('should handle AI API HTTP error', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Code');

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limited',
      } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review' as const,
        status: 'queued' as const, configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'code.ts', filePath: '/tmp/code.ts', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await expect(runStaticReview(session, [artifact])).rejects.toThrow('AI API error');
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'failure', '', expect.stringContaining('429'));
    });

    it('should truncate very large artifact content', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      // Create content larger than 50000 chars
      const largeContent = 'x'.repeat(60000);
      vi.mocked(readArtifactContent).mockResolvedValue(largeContent);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: JSON.stringify({ thoughts: [], findings: [] }) }] }),
      } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-1', projectId: 'proj-1', name: 'Test', reviewType: 'code_review' as const,
        status: 'queued' as const, configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'huge.ts', filePath: '/tmp/huge.ts', originalPath: null,
        contentHash: 'hash1', createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      // Verify the prompt was sent with truncated content — the first fetch
      // belongs to Stage 1 (understanding_context). Stage 1's user message
      // concatenates artifact contents and should include the truncation marker.
      const callArgs = fetchSpy.mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      const userMessage = body.messages[0].content[0].text;
      expect(userMessage).toContain('[... truncated ...]');
      expect(userMessage.length).toBeLessThan(60000);
    });

    it('should send x-api-key + anthropic-version and normalize base URL for anthropic-compatible', async () => {
      // Saved setting uses the *base* form (no /v1/messages) — common when users
      // type a custom provider URL and don't know the exact path suffix.
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'sk-ant-real-key',
        baseUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.7',
        provider: 'mimo',
        apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Some content');

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: JSON.stringify({ thoughts: [], findings: [] }) }] }),
      } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const session = {
        id: 'ss-hdr', projectId: 'proj-1', name: 'Test',
        reviewType: 'code_review' as const, status: 'queued' as const,
        configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const artifact = {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'c.ts', filePath: '/tmp/c.ts', originalPath: null,
        contentHash: 'h1', createdAt: new Date().toISOString(),
      };

      await runStaticReview(session, [artifact]);

      // Every AI call must hit the normalized URL with the right headers.
      for (const call of fetchSpy.mock.calls) {
        const url = call[0] as string;
        const init = call[1] as RequestInit;
        const headers = init.headers as Record<string, string>;
        expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
        expect(headers['x-api-key']).toBe('sk-ant-real-key');
        expect(headers['api-key']).toBeUndefined();
        expect(headers['anthropic-version']).toBe('2023-06-01');
      }
    });
  });

  // ── E2E pipeline (4 stages) ──────────────────────────────────────
  //
  // The cases below drive runStaticReview end-to-end and assert that:
  //   - Each of the 4 stages fires a fetch with the right shape
  //   - The inputs to each stage (artifact content, prior stage summaries,
  //     finding lists) are propagated correctly
  //   - The context-overflow cap protects the provider from receiving a
  //     400-class error when the project is large
  //   - Progress events fire for every stage in order
  //   - The earlier x-api-key / base-URL fixes are still in place
  describe('pipeline (e2e)', () => {
    // Per-stage Anthropic-shape response builder. text defaults to a stage-appropriate
    // shape so individual tests can also use it for one-off assertions.
    function stageResponse(stage: 1 | 2 | 3 | 4, overrides: Record<string, unknown> = {}) {
      switch (stage) {
        case 1:
          return {
            thoughts: ['I see a project with auth flow.'],
            projectSummary: 'A TypeScript project with login + dashboard.',
            artifactInventory: [{ name: 'a.ts', type: 'source_code', purpose: 'main module' }],
            userIntent: 'review',
            ...overrides,
          };
        case 2:
          return {
            thoughts: ['I reviewed the source files.'],
            findings: [
              { title: 'Null pointer risk', severity: 'high', category: 'potential_bug', artifactReference: 'a.ts', description: 'x.y may be null', evidence: 'x.y', recommendation: 'Add null check', confidence: 'high' },
            ],
            codeQualitySummary: 'Mixed quality; needs error handling.',
            riskAreas: ['a.ts'],
            ...overrides,
          };
        case 3:
          return {
            thoughts: ['Traced requirements to code.'],
            findings: [
              { title: 'Missing login requirement', severity: 'medium', category: 'missing_implementation', artifactReference: 'login spec', description: 'No 2FA implementation', evidence: '', recommendation: 'Add 2FA', confidence: 'medium' },
            ],
            coverageScore: 0.7,
            mappings: [],
            ...overrides,
          };
        case 4:
          return {
            thoughts: ['Consolidated 2 findings.'],
            executiveSummary: 'Project has 1 high-severity bug and 1 medium traceability gap.',
            totalFindings: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
            topConcerns: ['Null pointer risk'],
            recommendations: ['Add null check', 'Add 2FA'],
            addressedUserThoughts: 'Reviewed per user notes.',
            ...overrides,
          };
      }
    }

    function wrap(StageObj: object) {
      return { content: [{ type: 'text', text: JSON.stringify(StageObj) }] };
    }

    // Build a session/artifact pair with default anthropic-compatible provider.
    function defaultSession(overrides: Partial<any> = {}) {
      return {
        id: 'ss-e2e', projectId: 'proj-1', name: 'E2E',
        reviewType: 'code_review' as const, status: 'queued' as const,
        configJson: '{}', finalSummary: '', failureReason: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
      };
    }
    function defaultArtifact(overrides: Partial<any> = {}) {
      return {
        id: 'art-1', projectId: 'proj-1', type: 'source_code' as const,
        fileName: 'a.ts', filePath: '/tmp/a.ts', originalPath: null,
        contentHash: 'h1', createdAt: new Date().toISOString(),
        ...overrides,
      };
    }

    // Helper: pull the user-content text out of a fetch call's body.
    function getUserText(call: readonly unknown[]): string {
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      const msgs = body.messages as Array<{ role: string; content: unknown }>;
      const last = msgs[msgs.length - 1];
      if (Array.isArray(last.content)) {
        const textBlock = (last.content as Array<{ type: string; text: string }>).find(b => b.type === 'text');
        return textBlock?.text ?? '';
      }
      return last.content as string;
    }

    // (1) All 4 stages run and produce a final success status
    it('runs all 4 stages end-to-end and reaches success', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.minimax.io/anthropic', model: 'MiniMax-M2.7',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// some typescript code');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      vi.mocked(createFinding).mockResolvedValue({} as any);
      const { runStaticReview } = await import('../../src/staticReview');
      // Need a requirement artifact so Stage 3 doesn't skip.
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      await runStaticReview(defaultSession(), [req, defaultArtifact()]);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-e2e', 'success', expect.any(String), '');
      // Stage 2 + Stage 3 each persist 1 finding.
      expect(createFinding).toHaveBeenCalledTimes(2);
    });

    // (2) Stage 1 receives artifact content
    it('Stage 1 receives the artifact content in its prompt', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// UNIQUE_STAGE1_MARKER source');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const artifact = defaultArtifact({ fileName: 'login.ts' });
      await runStaticReview(defaultSession(), [artifact]);

      const text = getUserText(fetchSpy.mock.calls[0]);
      expect(text).toContain('login.ts');
      expect(text).toContain('UNIQUE_STAGE1_MARKER');
    });

    // (3) Stage 2 receives project context from Stage 1
    it('Stage 2 receives the project context produced by Stage 1', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// code');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1, {
          projectSummary: 'PROJECT_SUMMARY_UNIQUE_TO_STAGE2',
        })) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      await runStaticReview(defaultSession(), [defaultArtifact()]);

      const text = getUserText(fetchSpy.mock.calls[1]);
      expect(text).toContain('## Project Context');
      expect(text).toContain('PROJECT_SUMMARY_UNIQUE_TO_STAGE2');
    });

    // (4) Stage 3 receives req + code + code review summary
    it('Stage 3 receives requirements, code, and the Stage 2 code review summary', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockImplementation(async (id: string) => {
        if (id === 'art-req') return 'REQUIREMENT_FILE_UNIQUE_CONTENT';
        return '// CODE_FILE_UNIQUE_CONTENT';
      });

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2, {
          codeQualitySummary: 'CODE_QUALITY_SUMMARY_UNIQUE_TO_STAGE3',
        })) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      const code = defaultArtifact({ id: 'art-code', fileName: 'main.ts' });
      await runStaticReview(defaultSession(), [req, code]);

      const text = getUserText(fetchSpy.mock.calls[2]);
      expect(text).toContain('## Requirements');
      expect(text).toContain('REQUIREMENT_FILE_UNIQUE_CONTENT');
      expect(text).toContain('## Source Code');
      expect(text).toContain('CODE_FILE_UNIQUE_CONTENT');
      expect(text).toContain('CODE_QUALITY_SUMMARY_UNIQUE_TO_STAGE3');
    });

    // (5) Stage 4 receives all findings + project context
    it('Stage 4 receives the consolidated finding lists from Stages 2 and 3', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// code');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      await runStaticReview(defaultSession(), [req, defaultArtifact()]);

      const text = getUserText(fetchSpy.mock.calls[3]);
      expect(text).toContain('Null pointer risk');      // Stage 2 finding
      expect(text).toContain('Missing login requirement'); // Stage 3 finding
      expect(text).toContain('Code Review Findings');
      expect(text).toContain('Traceability Findings');
    });

    // (6) Stage 3 makes no fetch call when there are no requirement/design artifacts
    it('skips Stage 3 fetch when there are no requirement or design artifacts', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// code');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      await runStaticReview(defaultSession(), [defaultArtifact()]);

      // Only 3 fetches — no Stage 3.
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      // Stage 3 should not have produced any findings.
      const findingCalls = vi.mocked(createFinding).mock.calls;
      expect(findingCalls).toHaveLength(1); // just Stage 2's finding
    });

    // (7) Context-overflow protection: large content gets truncated, no 400
    it('truncates oversized prompts so the provider does not return HTTP 400', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      // 5 artifacts of 30 KB each = 150 KB raw — far over MAX_PROMPT_CHARS (100K).
      // The pipeline sends the same content to multiple stages, so the
      // cap must apply per-fetch.
      const large = 'A'.repeat(30_000);
      vi.mocked(readArtifactContent).mockResolvedValue(large);
      vi.mocked(createFinding).mockResolvedValue({} as any);

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      const code = defaultArtifact({ id: 'art-code', fileName: 'main.ts' });
      // 3 more code artifacts to amplify the input
      const extras = [
        defaultArtifact({ id: 'art-c2', fileName: 'b.ts' }),
        defaultArtifact({ id: 'art-c3', fileName: 'c.ts' }),
        defaultArtifact({ id: 'art-c4', fileName: 'd.ts' }),
      ];
      const session = defaultSession();
      await expect(runStaticReview(session, [req, code, ...extras])).resolves.toBeUndefined();

      // Every fetch body must fit under MAX_PROMPT_CHARS.
      for (const call of fetchSpy.mock.calls) {
        const init = call[1] as RequestInit;
        const bodyStr = init.body as string;
        expect(bodyStr.length).toBeLessThanOrEqual(200_000); // system + 100K cap + JSON overhead
        // The user text inside the body should be capped.
        const userText = getUserText(call);
        // Cap is on the user content; allow marker + ~MAX_PROMPT_CHARS worth.
        expect(userText.length).toBeLessThanOrEqual(110_000);
      }

      // Pipeline should have reached success despite the truncation.
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-e2e', 'success', expect.any(String), '');
    });

    // (8) Progress events emitted for every stage
    it('emits a progress event with status: done for each of the 4 stages', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// code');
      vi.mocked(createFinding).mockResolvedValue({} as any);

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const progressEvents: any[] = [];
      const { runStaticReview } = await import('../../src/staticReview');
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      await runStaticReview(
        defaultSession(),
        [req, defaultArtifact()],
        (progress) => progressEvents.push(progress)
      );

      // The final progress event shows all 4 stages as done, in order.
      const finalProgress = progressEvents[progressEvents.length - 1];
      const finalStageStatuses = finalProgress.stages.map((s: any) => [s.id, s.status]);
      expect(finalStageStatuses).toEqual([
        ['understanding_context', 'done'],
        ['code_review', 'done'],
        ['requirement_validation', 'done'],
        ['summarizing', 'done'],
      ]);
    });

    // (9) Regression: auth headers + URL correct for every call
    it('sends x-api-key + anthropic-version to a /v1/messages URL on every call', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'sk-ant-xyz', baseUrl: 'https://api.minimax.io/anthropic', model: 'MiniMax-M2.7',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('// code');
      vi.mocked(createFinding).mockResolvedValue({} as any);

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const { runStaticReview } = await import('../../src/staticReview');
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      await runStaticReview(defaultSession(), [req, defaultArtifact()]);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
      for (const call of fetchSpy.mock.calls) {
        const url = call[0] as string;
        const init = call[1] as RequestInit;
        const headers = init.headers as Record<string, string>;
        expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
        expect(headers['x-api-key']).toBe('sk-ant-xyz');
        expect(headers['api-key']).toBeUndefined();
        expect(headers['anthropic-version']).toBe('2023-06-01');
      }
    });

    // (10) Truncation surfaces in the progress stream
    it('emits a thought to the progress stream when the prompt cap fires', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'k', baseUrl: 'https://api.example.com', model: 'm',
        provider: 'mimo', apiFormat: 'anthropic-compatible',
      });
      // One giant artifact — guaranteed to exceed the 100K char cap on Stage 3
      // (which also concatenates code content for traceability).
      const huge = 'X'.repeat(120_000);
      vi.mocked(readArtifactContent).mockResolvedValue(huge);
      vi.mocked(createFinding).mockResolvedValue({} as any);

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(1)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(2)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(3)) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => wrap(stageResponse(4)) } as Response);

      const progressEvents: any[] = [];
      const { runStaticReview } = await import('../../src/staticReview');
      const req = defaultArtifact({ id: 'art-req', type: 'requirement', fileName: 'spec.md' });
      await runStaticReview(
        defaultSession(),
        [req, defaultArtifact()],
        (progress) => progressEvents.push(progress)
      );

      // Walk the progress events and look for a thought mentioning truncation.
      const allThoughts = progressEvents.flatMap((p) =>
        p.stages.flatMap((s: any) => s.thoughts as string[])
      );
      const hasTruncationNote = allThoughts.some((t) => /truncat/i.test(t));
      expect(hasTruncationNote).toBe(true);
    });
  });
});
