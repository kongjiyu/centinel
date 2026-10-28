import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import type { StaticModelRequest } from '../../src/review/types.js';
import { ModelProviderError } from '../../src/review/retry.js';

describe('exact source packets in the production orchestrator', () => {
  it.each([false, true])('continues across all 52 frozen files after uncertain evidence (capacity stop: %s)', async capacityStop => {
    const sources = Array.from({ length: 52 }, (_, index) => {
      const content = `export function operation${index}() { return ${index}; }\nconst privateMarker${index} = "independent sweep ${index}";`;
      const artifact: Artifact = { id: `file-${index}`, projectId: 'p', versionId: `version-${index}`,
        contentHash: crypto.createHash('sha256').update(content).digest('hex'), type: 'source_code', source: 'repository',
        fileName: `file-${index}.ts`, filePath: `src/file-${index}.ts`, originalPath: null, createdAt: '2026-10-27T00:00:00Z' };
      return { artifact, content };
    });
    const repository = new InMemoryStaticReviewRepository();
    const requests: StaticModelRequest[] = [];
    const runner = createStaticReviewOrchestrator({ repository, deterministic: async () => [], retry: { sleep: async () => undefined },
      readArtifactContent: async artifact => sources.find(source => source.artifact.id === artifact.id)!.content,
      modelProvider: { analyze: async request => {
        requests.push(request);
        if (capacityStop) throw new ModelProviderError('Synthetic provider capacity pause.', { code: 'credits_exhausted', retryable: false });
        const map = readPromptAnalysisMap(request);
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
          findings: requests.length === 1 ? [{ title: 'Early uncertain observation', description: 'This source quotation needs verification.',
            severity: 'low', category: 'technical', filePath: sources[0].artifact.filePath, lineNumber: 1,
            evidence: 'QUOTE_NOT_IN_FROZEN_SOURCE', recommendation: 'Verify the evidence.', confidence: 'low' }] : [],
          featureAssessments: map.features.map(feature => ({ featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel']
            .map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'The bounded source was inspected.', evidence: feature.entryPoints })) })),
        } };
      } },
    });
    const run = await runner.start({ projectId: 'p', reviewType: 'code_review', artifacts: sources.map(source => source.artifact) });
    const finished = await run.completion;
    if (capacityStop) {
      expect(finished).toMatchObject({ status: 'blocked', progress: { stage: 'provider_paused' } });
      expect(requests).toHaveLength(1);
      expect(repository.audits.some(event => event.event === 'review_source_batches_finished')).toBe(false);
    } else {
      expect(finished).toMatchObject({ status: 'failed', modelStatus: 'partial' });
      expect(new Set(requests.flatMap(request => request.usageContext?.sources?.map(source => source.artifactId) ?? [])).size).toBe(52);
      for (let index = 0; index < 52; index++) expect(requests.some(request => request.prompt.includes(`privateMarker${index} =`))).toBe(true);
      const planned = repository.audits.find(event => event.event === 'review_batches_planned')?.detail?.batches as unknown[];
      expect(repository.audits.find(event => event.event === 'review_source_batches_finished')?.detail).toMatchObject({ plannedBatches: planned.length, uncertainCitations: 1 });
      expect(requests).toHaveLength(planned.length);
      expect(repository.findings[0].sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
    }
    expect(repository.audits.some(event => event.event === 'review_assessment_validated')).toBe(false);
    expect(repository.findingCorrelations.size).toBe(0);
  });
  it('flags an excerpt omitted from the feature packet and continues its independent whole-file sweep', async () => {
    const lines = [
      'export function checkout() {',
      '  return true;',
      '}',
      'function unrelatedPrivateHelper() {',
      '  return "not supplied in the feature packet";',
      '}',
    ];
    const content = lines.join('\n');
    const artifact: Artifact = { id: 'payment', projectId: 'p', versionId: 'v1',
      contentHash: crypto.createHash('sha256').update(content).digest('hex'), type: 'source_code',
      source: 'repository', fileName: 'payment.ts', filePath: 'src/payment.ts', originalPath: null,
      createdAt: '2026-10-25T00:00:00Z' };
    const repository = new InMemoryStaticReviewRepository();
    const requests: StaticModelRequest[] = [];
    const reader = vi.fn(async () => content);
    let injected = false;
    const runner = createStaticReviewOrchestrator({ repository, readArtifactContent: reader,
      deterministic: async () => [], retry: { sleep: async () => undefined },
      modelProvider: { analyze: async request => {
        requests.push(request);
        const map = readPromptAnalysisMap(request);
        const findings: unknown[] = [];
        if (map.features.length && !injected) {
          injected = true;
          findings.push({ title: 'Unseen helper claim', description: 'This excerpt exists in the frozen file but was not inspected in this request.',
            severity: 'low', category: 'technical', filePath: artifact.filePath, lineNumber: 5,
            evidence: lines[4], recommendation: 'Inspect this helper.', confidence: 'high' });
        }
        return { result: { findings, featureAssessments: map.features.map((feature: any) => ({ featureId: feature.id,
          assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed',
            outcome: 'no_issue_identified', summary: 'The supplied local operation was inspected.', evidence: feature.entryPoints })) })) },
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          settings: { provider: 'fixture', apiFormat: 'openai-compatible', model: 'offline' } };
      } },
    });
    const run = await runner.start({ projectId: 'p', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'failed', modelStatus: 'partial' });
    expect(requests[0].prompt).not.toContain('function unrelatedPrivateHelper');
    expect(requests.some(request => request.prompt.includes('function unrelatedPrivateHelper'))).toBe(true);
    expect(requests.every(request => !request.repair)).toBe(true);
    expect(repository.attempts[0]).toMatchObject({ outcome: 'success', usage: { inputTokens: 100 } });
    const uncertain = repository.findings.find(finding => finding.title === 'Unseen helper claim');
    expect(uncertain?.sourceLocator?.citationEvidence).toMatchObject({ verification: 'needs_verification' });
    expect(uncertain?.evidence).not.toContain('not supplied in the feature packet');
    expect(repository.audits.find(event => event.event === 'review_source_batches_finished')?.detail).toMatchObject({ uncertainCitations: 1 });
    expect(repository.audits.some(event => event.event === 'review_assessment_validated')).toBe(false);
    expect(reader).toHaveBeenCalledOnce();
    const planned = repository.audits.find(event => event.event === 'review_batches_planned');
    expect(JSON.stringify(planned?.detail)).not.toContain('return true');
    expect((planned?.detail?.batches as any[])[0].packetDiagnostics).toMatchObject({ method: 'ast_dependency_units' });
  });
});
