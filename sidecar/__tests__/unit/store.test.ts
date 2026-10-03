import { describe, expect, it } from 'vitest';
import { InMemoryCentinelStore } from '../../src/store/inMemory.js';

const project = {
  ownerId: 'user-1', name: 'Static project', description: '', workspacePath: 'C:/repo',
};

describe('InMemoryCentinelStore static repository contract', () => {
  it('persists project membership and immutable artifact versions', async () => {
    const store = new InMemoryCentinelStore();
    const created = await store.createProject(project);
    expect((await store.listProjectMembers(created.id))[0]).toMatchObject({ userId: 'user-1', role: 'owner' });
    const artifact = await store.saveArtifact({ projectId: created.id, sourceId: null, path: 'src/index.ts', name: 'index.ts', kind: 'file', mimeType: 'text/typescript', metadata: {} });
    const first = await store.saveArtifactVersion({ projectId: created.id, artifactId: artifact.id, versionNumber: 1, contentHash: 'hash-1', byteSize: 10, storagePath: null, sourceRevision: null, contentType: 'text/plain', metadata: {} });
    const second = await store.saveArtifactVersion({ projectId: created.id, artifactId: artifact.id, versionNumber: 2, contentHash: 'hash-2', byteSize: 12, storagePath: null, sourceRevision: null, contentType: 'text/plain', metadata: {} });
    expect((await store.listArtifactVersions(artifact.id)).map(item => item.id)).toEqual([first.id, second.id]);
  });

  it('deduplicates idempotent review starts and records finding state history', async () => {
    const store = new InMemoryCentinelStore();
    const created = await store.createProject(project);
    const reviewInput = { projectId: created.id, name: 'Review 1', reviewType: 'static', status: 'queued' as const, config: {}, progress: {}, parentReviewId: null, idempotencyKey: 'start-1', sourceManifestHash: null, finalSummary: '', failureReason: '', cancelledAt: null, completedAt: null };
    const first = await store.saveReviewSession(reviewInput);
    const duplicate = await store.saveReviewSession(reviewInput);
    expect(duplicate.id).toBe(first.id);
    const finding = await store.saveFinding({ projectId: created.id, reviewSessionId: first.id, dynamicSessionId: null, source: 'static', severity: 'high', priority: 'high', title: 'Issue', description: 'Issue', status: 'new', category: 'security', evidenceText: 'line 1', recommendation: 'Fix', confidence: 'high', artifactId: null, artifactVersionId: null, evidenceId: null, requirementId: null, standardId: null, verifier: 'deterministic', location: { line: 1 }, correlationFingerprint: 'fp-1' });
    await store.updateFindingStatus(finding.id, 'accepted', 'user-1', 'reviewed');
    expect((await store.listFindingStateHistory(finding.id))[0]).toMatchObject({ fromStatus: 'new', toStatus: 'accepted', actorId: 'user-1' });
  });
});
