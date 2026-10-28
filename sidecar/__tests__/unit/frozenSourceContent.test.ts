import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readFrozenReviewSource } from '../../src/review/frozenSourceContent.js';
import type { Artifact } from '../../src/artifacts.js';
import type { StaticReviewRecord } from '../../src/review/types.js';

const bytes = Buffer.from('saved version one');
const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
const review = { id: 'review', projectId: 'project', sourceManifestId: 'manifest' } as StaticReviewRecord;
const artifact: Artifact = { id: 'artifact', projectId: 'project', versionId: 'version-one', filePath: 'saved.ts', fileName: 'saved.ts', contentHash, source: 'repository', type: 'source_code', originalPath: null, createdAt: '' };
function storage(patch = {}) {
  return { getArtifactVersion: vi.fn(async () => ({ id: 'version-one', artifactId: 'artifact', contentHash, contentType: 'text/plain' })), downloadArtifactVersion: vi.fn(async () => bytes), ...patch } as any;
}
describe('Frozen Review content reads', () => {
  it('reads exact retained version without looking up a current artifact', async () => {
    const store = storage();
    expect(await readFrozenReviewSource('project', review, [artifact], 'artifact', store)).toMatchObject({ versionId: 'version-one', contentHash, content: bytes.toString('base64') });
    expect(store.getArtifactVersion).toHaveBeenCalledWith('project', 'version-one');
  });
  it.each([{ projectId: 'other' }, { versionId: undefined }, { contentHash: '' }])('rejects unavailable or cross-project manifest evidence (%j)', async patch => {
    const store = storage();
    await expect(readFrozenReviewSource('project', review, [{ ...artifact, ...patch }], 'artifact', store)).rejects.toThrow();
    expect(store.downloadArtifactVersion).not.toHaveBeenCalled();
  });
  it('rejects mismatched version identity and altered bytes without current fallback', async () => {
    await expect(readFrozenReviewSource('project', review, [artifact], 'artifact', storage({ getArtifactVersion: async () => ({ id: 'version-one', artifactId: 'other', contentHash }) }))).rejects.toThrow();
    await expect(readFrozenReviewSource('project', review, [artifact], 'artifact', storage({ downloadArtifactVersion: async () => Buffer.from('current content') }))).rejects.toThrow();
  });
  it('rejects artifacts outside the Review and a Review outside the project', async () => {
    await expect(readFrozenReviewSource('project', review, [artifact], 'unselected', storage())).rejects.toThrow();
    await expect(readFrozenReviewSource('other', review, [artifact], 'artifact', storage())).rejects.toThrow();
  });
});
