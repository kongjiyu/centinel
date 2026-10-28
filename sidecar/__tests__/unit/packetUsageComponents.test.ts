import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { StaticReviewOrchestratorService } from '../../src/review/orchestrator.js';
import { deriveReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { sanitizeReviewRequestUsageContext } from '../../src/review/usageContext.js';
import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';

describe('packet request character diagnostics', () => {
  it('measures the actual source and graph separately without claiming provider tokens', async () => {
    const content = 'export function pay() { return true; }\n';
    const artifact: Artifact = {
      id: 'payment', projectId: 'p', versionId: 'frozen-v1',
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      type: 'source_code', source: 'repository', fileName: 'pay.ts', filePath: 'src/pay.ts',
      originalPath: null, createdAt: '2026-10-25T00:00:00Z',
    };
    const sources = [{ artifact, content, lineStart: 1, lineEnd: 2 }];
    const map = deriveReviewAnalysisMap(sources);
    const runner = new StaticReviewOrchestratorService({ repository: new InMemoryStaticReviewRepository() }) as any;
    const request = await runner.buildModelRequest(
      { id: 'r', projectId: 'p', reviewType: 'code_review', config: {} },
      null, [], new AbortController().signal, sources, [], [], null, map, [],
    );
    expect(request.usageContext.components.sourceCharacters).toBe(content.length);
    const promptGraph = request.prompt.split('Provisional feature/path map (bounded syntax evidence; coverage limits apply):\n')[1].split('\n\nFrozen artifact content:')[0];
    expect(request.usageContext.components.graphCharacters).toBe(promptGraph.length);
    expect(readPromptAnalysisMap(request).features[0].entryPoints).toEqual(map.features[0]!.entryPoints);
    expect(JSON.parse(promptGraph).features[0].pendingDomains).toHaveLength(4);
    expect(request.usageContext.components.retrievalCharacters).toBeGreaterThan(0);
    expect(request.usageContext.components.authorityCharacters).toBeGreaterThan(0);
    const measured = sanitizeReviewRequestUsageContext(runner.requestUsageContext(request, 'initial_analysis', [], content.length));
    expect(measured?.components?.promptCharacters).toBe(request.prompt.length);
    expect(measured?.components?.systemCharacters).toBe(request.systemPrompt.length);
    expect(measured?.components?.schemaCharacters).toBe(JSON.stringify(request.outputSchema).length);
    expect(measured?.estimation?.method).toBe('characters_divided_by_2');
    expect(measured).not.toHaveProperty('inputTokens');
    expect(JSON.stringify(measured)).not.toContain(content);

    // Support requests supply a different prompt and must clear initial-analysis
    // component diagnostics before measuring their own evidence packet.
    const support = { ...request, prompt: 'support-only', usageContext: undefined };
    const supportMeasured = runner.requestUsageContext(support, 'semantic_support', [], content.length);
    expect(supportMeasured.components).not.toHaveProperty('graphCharacters');
    expect(supportMeasured.components).not.toHaveProperty('retrievalCharacters');
    expect(supportMeasured.components.promptCharacters).toBe('support-only'.length);
  });
});
