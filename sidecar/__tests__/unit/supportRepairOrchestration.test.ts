import { describe, expect, it } from 'vitest';
import { createStaticReviewOrchestrator } from '../../src/review/orchestrator.js';
import { InMemoryStaticReviewRepository } from '../../src/review/repository.js';
import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';
import { candidateSupportResult, isCandidateSupportRequest } from '../fixtures/semanticSupport.js';
import type { StaticModelRequest } from '../../src/review/types.js';
import type { Artifact } from '../../src/artifacts.js';
import { ModelProviderError } from '../../src/review/retry.js';
import { analysisMapFromEvents } from '../../src/review/assessmentBatches.js';

describe('support repair delivery and accounting', () => {
  it('does not promote uninspected later features when a runtime limitation affects their shared file', async () => {
    const content = Array.from({ length: 12 }, (_, index) => `export function action${index}(value) { return value; }`).join('\n');
    const artifact: Artifact = { id: 'code', projectId: 'project', type: 'source_code', source: 'repository',
      fileName: 'actions.ts', filePath: 'src/actions.ts', contentHash: 'v1', originalPath: null, createdAt: '2026-10-28T00:00:00Z' };
    const repository = new InMemoryStaticReviewRepository();
    let generations = 0;
    const runner = createStaticReviewOrchestrator({ repository, readArtifactContent: async () => content,
      deterministic: async () => [], modelProvider: { analyze: async request => {
        if (isCandidateSupportRequest(request)) return { result: candidateSupportResult(request, { disposition: 'insufficient', boundary: 'runtime_dependent' }),
          settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' } };
        if (++generations > 1) throw new ModelProviderError('Offline capacity stop.', { code: 'quota_exhausted', retryable: false });
        const map = readPromptAnalysisMap(request);
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result: {
          findings: [{ title: 'Conditional runtime concern', description: 'The caller runtime is not supplied.', severity: 'low', category: 'behavior',
            domain: 'security', filePath: artifact.filePath, artifactId: artifact.id, sourceVersion: 'v1', lineNumber: 1,
            evidence: content.split('\n')[0], recommendation: 'Verify the caller runtime.', confidence: 'medium' }],
          featureAssessments: map.features.map(feature => ({ featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({
            domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'The supplied local operation was inspected.', evidence: feature.entryPoints,
          })) })),
        } };
      } },
    });
    const started = await runner.start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect((await started.completion).status).toBe('blocked');
    const map = analysisMapFromEvents(repository.audits)!;
    expect(map.features.length).toBeGreaterThan(8);
    expect(map.features.flatMap(feature => feature.assessments).filter(row => row.status === 'assessed' && !row.evidence.length)).toEqual([]);
    expect(map.features.some(feature => feature.assessments.some(row => row.domain === 'security' && row.status === 'unverified'))).toBe(true);
  });
  it('tightens only repair requests and records their actual augmented prompt/schema without retaining rejected text', async () => {
    const content = 'export function account() { return true; }';
    const artifact: Artifact = { id: 'code', projectId: 'project', type: 'source_code', source: 'repository',
      fileName: 'account.ts', filePath: 'src/account.ts', contentHash: 'v1', originalPath: null, createdAt: '2026-10-27T00:00:00Z' };
    const repository = new InMemoryStaticReviewRepository();
    const supportRequests: StaticModelRequest[] = [];
    const sentinel = 'PRIVATE_REJECTED_MODEL_REFERENCE';
    const runner = createStaticReviewOrchestrator({ repository, readArtifactContent: async () => content,
      deterministic: async () => [], retry: { sleep: async () => undefined },
      modelProvider: { analyze: async request => {
        let result: unknown;
        if (isCandidateSupportRequest(request)) {
          supportRequests.push(request);
          const supported = candidateSupportResult(request);
          if (supportRequests.length === 1) supported.candidates[0].references[0].evidence = sentinel;
          result = supported;
        } else {
          const map = readPromptAnalysisMap(request);
          result = { findings: map.features.length ? [{ title: 'Local fixture observation', description: 'The local result is exposed.', severity: 'medium',
            category: 'technical', filePath: artifact.filePath, lineNumber: 1, evidence: content,
            recommendation: 'Inspect the bounded return.', confidence: 'high' }] : [],
          featureAssessments: map.features.map(feature => ({ featureId: feature.id,
            assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain,
              status: 'assessed', outcome: 'no_issue_identified', summary: 'Bounded source inspected.', evidence: feature.entryPoints })),
          })) };
        }
        return { settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'offline' }, result };
      } },
    });
    const run = await runner.start({ projectId: 'project', reviewType: 'code_review', artifacts: [artifact] });
    expect(await run.completion).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded' });
    expect(supportRequests).toHaveLength(2);
    const first = supportRequests[0], repair = supportRequests[1];
    expect((first.outputSchema as any).properties.candidates.items.properties.references.items.anyOf).toBeUndefined();
    expect((repair.outputSchema as any).properties.candidates.items.properties.references.items.anyOf).toBeDefined();
    expect(repair.prompt.length).toBeGreaterThan(first.prompt.length);
    expect(repair.prompt).not.toContain(sentinel);
    const recorded = repository.attempts.find(attempt => attempt.usageContext?.phase === 'support_repair');
    expect(recorded?.usageContext?.components?.promptCharacters).toBe(repair.prompt.length);
    expect(recorded?.usageContext?.components?.schemaCharacters).toBe(JSON.stringify(repair.outputSchema).length);
    expect(JSON.stringify(repository.audits)).not.toContain(sentinel);
    expect(JSON.stringify(repository.attempts)).not.toContain(sentinel);
  });
});
