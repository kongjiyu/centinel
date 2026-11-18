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
vi.mock('../../src/applicationRepository.js', () => ({ CentinelApplicationRepository: class {} }));
vi.mock('../../src/applicationApi.js', () => ({ listClientArtifacts: mocks.artifacts, readClientArtifactContent: mocks.read }));
vi.mock('../../src/store/index.js', () => ({ SupabaseCentinelStore: class { listFindings = mocks.findings; } }));
vi.mock('../../src/dynamic/autonomous/store.js', () => ({ SupabaseAutoTestStore: class { get = mocks.autoTest; } }));
const client = {} as SupabaseClient;
const signal = new AbortController().signal;
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
