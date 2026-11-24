import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolveConversationEvidence } from '../../src/conversation/evidence.js';
const mocks = vi.hoisted(() => ({
  review: vi.fn(), manifest: vi.fn(), traceability: vi.fn(), findings: vi.fn(), read: vi.fn(), artifacts: vi.fn(), autoTest: vi.fn(),
}));
vi.mock('../../src/review/supabaseRepository.js', () => ({
  SupabaseStaticReviewRepository: class {
    getReview = mocks.review;
    loadSourceManifestArtifacts = mocks.manifest;
    getTraceabilitySnapshot = mocks.traceability;
  },
}));
vi.mock('../../src/applicationRepository.js', () => ({ CentinelApplicationRepository: class { async getProject() { return { name: 'Fixture' }; } } }));
vi.mock('../../src/applicationApi.js', () => ({ listClientArtifacts: mocks.artifacts, readClientArtifactContent: mocks.read }));
vi.mock('../../src/store/index.js', () => ({ SupabaseCentinelStore: class { listFindings = mocks.findings; } }));
vi.mock('../../src/dynamic/autonomous/store.js', () => ({ SupabaseAutoTestStore: class { get = mocks.autoTest; } }));
const client = {} as SupabaseClient;
const signal = new AbortController().signal;
it('selects only versioned repository files under the named automation module', async () => {
  mocks.artifacts.mockResolvedValue([
    { id: 'a', source: 'repository', filePath: 'cypress/e2e/login.ts', versionId: 'v1' },
    { id: 'b', source: 'repository', filePath: 'src/automation.ts', versionId: 'v2' },
    { id: 'c', source: 'documents', filePath: 'cypress/requirements.md', versionId: 'v3' },
    { id: 'd', source: 'repository', filePath: 'cypress/stale.ts', versionId: 'v4', currency: { deprecated: true } },
  ]);
  const result = await resolveConversationEvidence(client, 'owner', 'project', [], signal, false, 'conduct a review on automation module');
  expect(result.map(item => item.id)).toEqual(['module:project', 'module-source:a']);
  expect(result[1]).toMatchObject({ artifactId: 'a', versionId: 'v1' });
  expect(mocks.read).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.review.mockResolvedValue({ id: 'review', projectId: 'project', name: 'Order access', status: 'completed', summary: 'Saved result', sourceManifestId: 'manifest' });
  mocks.manifest.mockResolvedValue([{ id: 'artifact', versionId: 'original-version', contentHash: 'original-hash', filePath: 'orders.ts' }]);
  mocks.traceability.mockResolvedValue({ records: [{ requirementId: 'req', description: 'Orders belong to their owner.' }] });
  mocks.findings.mockResolvedValue([{ id: 'finding', artifactId: 'artifact', artifactVersionId: 'original-version',
    title: 'Missing ownership check', evidenceText: 'return orders.get(id)', requirementId: 'req' }]);
  mocks.read.mockResolvedValue('function order() { return orders.get(id) }');
});
it('loads the original version and saved requirement for a selected problem', async () => {
  const result = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'finding' }], signal);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(client, 'owner', 'artifact', 'original-version', signal, 'project', 'original-hash');
  expect(JSON.parse(result.find(item => item.id === 'finding:finding')!.text)).toMatchObject({
    excerpt: 'return orders.get(id)', requirement: { requirementId: 'req', description: 'Orders belong to their owner.' },
  });
  expect(mocks.artifacts).not.toHaveBeenCalled();
});
it('rejects a cross-project Review before reading findings or source content', async () => {
  mocks.review.mockResolvedValue({ projectId: 'other-project' });
  await expect(resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal)).rejects.toThrow('unavailable');
  expect(mocks.findings).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it('resolves an entire saved check with 56 findings without reading individual source excerpts', async () => {
  mocks.findings.mockResolvedValue(Array.from({ length: 56 }, (_, i) => ({ id: `finding-${i}`, title: `Saved problem ${i}`, status: 'new' })));
  const resolved = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal);
  expect(JSON.parse(resolved.find(item => item.id === 'review:review')!.text)).toMatchObject({ findingCount: 56, moreFindings: 48 });
  expect(mocks.read).not.toHaveBeenCalled();
});
it('rejects a finding that is absent from the selected Review', async () => {
  await expect(resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'unrelated' }], signal)).rejects.toThrow('unavailable');
  expect(mocks.read).not.toHaveBeenCalled();
});
it('retains an explicit missing-excerpt limitation instead of substituting current sources', async () => {
  mocks.read.mockRejectedValue(new Error('version unavailable'));
  const result = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'finding' }], signal);
  expect(result.find(item => item.id === 'finding:finding')).toMatchObject({ unavailable: true });
  expect(mocks.artifacts).not.toHaveBeenCalled();
});
it('provides a bounded display-only window from the frozen source when an exact excerpt is unavailable', async () => {
  mocks.findings.mockResolvedValue([{ id: 'finding', artifactId: 'artifact', artifactVersionId: 'original-version',
    title: 'Missing ownership check', evidenceText: 'unverified statement', location: { lineNumber: 3 } }]);
  mocks.read.mockResolvedValue('one\ntwo\nthree\nfour\nfive\nsix');
  const refs = [{ reviewId: 'review', findingId: 'finding' }];
  const normal = await resolveConversationEvidence(client, 'owner', 'project', refs, signal);
  const display = await resolveConversationEvidence(client, 'owner', 'project', refs, signal, true);
  expect(normal.find(item => item.id === 'finding:finding')?.text).not.toContain('nearby');
  const shown = display.find(item => item.id === 'finding:finding')!;
  expect(shown.unavailable).toBe(true);
  expect(JSON.parse(shown.text)).toMatchObject({ excerpt: null, nearby: { firstLine: 1, citedLine: 3, text: 'one\ntwo\nthree\nfour\nfive' } });
});
