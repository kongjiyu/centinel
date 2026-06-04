import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dependencies before importing the module under test
vi.mock('../../src/settings.js', () => ({
  getRawAiSetting: vi.fn(),
}));

vi.mock('../../src/artifacts.js', () => ({
  readArtifactContent: vi.fn(),
}));

vi.mock('../../src/staticSessions.js', () => ({
  updateStaticSessionStatus: vi.fn(),
  updateStaticSessionProgress: vi.fn(),
  createFinding: vi.fn(),
  createReviewArtifact: vi.fn(),
}));

import { getRawAiSetting } from '../../src/settings';
import { readArtifactContent } from '../../src/artifacts';
import { updateStaticSessionStatus, createFinding, updateStaticSessionProgress, createReviewArtifact } from '../../src/staticSessions';

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
      // We'll mock a failure to avoid needing a full AI response
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

      await expect(runStaticReview(session, [])).rejects.toThrow();
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'running', '', '');
    });

    it('should fail when text AI provider is not configured', async () => {
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

    it('should fail when API key is missing', async () => {
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

    it('should fail when no artifacts can be read', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'anthropic',
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

      await expect(runStaticReview(session, [artifact])).rejects.toThrow('No artifacts could be read');
    });

    it('should process findings from AI response and save them', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'anthropic',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('# Requirements\n- The system shall be fast');

      const findingsJson = JSON.stringify([
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
      ]);
      const aiResponse = JSON.stringify({
        content: [{ text: findingsJson }],
      });

      fetchSpy.mockResolvedValueOnce({
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

      expect(createFinding).toHaveBeenCalledTimes(2);
      expect(createFinding).toHaveBeenCalledWith('proj-1', 'ss-1', {
        severity: 'high',
        title: 'Vague requirement',
        description: 'The term "fast" is not measurable',
        category: 'unclear_requirement',
        evidenceText: 'The system shall be fast',
        recommendation: 'Define specific performance metrics',
        confidence: 'high',
        artifactId: 'req.md',
        fromRemarks: false,
      });
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'success', expect.stringContaining('2 finding'), '');
    });

    it('should handle AI returning empty array', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'anthropic',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Clean code with no issues');

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: '[]' }] }),
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
      expect(updateStaticSessionStatus).toHaveBeenCalledWith('ss-1', 'success', expect.stringContaining('0 finding'), '');
    });

    it('should handle AI response wrapped in markdown code block', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'anthropic',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Some code');

      const mdWrapped = '```json\n[{"title":"Bug","severity":"critical","category":"potential_bug","artifactReference":"code.ts","description":"Null pointer","evidence":"x.y","recommendation":"Add null check","confidence":"high"}]\n```';
      fetchSpy.mockResolvedValueOnce({
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
      expect(createFinding).toHaveBeenCalledTimes(1);
    });

    it('should validate and normalize invalid severity values', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'anthropic',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Code');

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: JSON.stringify([{
            title: 'Issue', severity: 'INVALID', category: 'test',
            artifactReference: '', description: '', evidence: '',
            recommendation: '', confidence: 'INVALID',
          }]) }],
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

      expect(createFinding).toHaveBeenCalledWith('proj-1', 'ss-1', expect.objectContaining({
        severity: 'medium',  // INVALID -> medium
        confidence: 'medium', // INVALID -> medium
      }));
    });

    it('should handle OpenAI compatibility mode', async () => {
      vi.mocked(getRawAiSetting).mockResolvedValue({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        model: 'test-model',
        compatibilityMode: 'openai',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Code');

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '[]' } }],
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
        compatibilityMode: 'anthropic',
      });
      vi.mocked(readArtifactContent).mockResolvedValue('Code');

      fetchSpy.mockResolvedValueOnce({
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
        compatibilityMode: 'anthropic',
      });
      // Create content larger than 50000 chars
      const largeContent = 'x'.repeat(60000);
      vi.mocked(readArtifactContent).mockResolvedValue(largeContent);

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: '[]' }] }),
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

      // Verify the prompt was sent with truncated content
      const callArgs = fetchSpy.mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      const userMessage = body.messages[0].content[0].text;
      expect(userMessage).toContain('[... truncated ...]');
      expect(userMessage.length).toBeLessThan(60000);
    });
  });
});
