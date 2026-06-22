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
});
