import crypto from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import type { StaticReviewRecord } from './types.js';
import type { CentinelApplicationRepository } from '../applicationRepository.js';

/** Callers authenticate project membership. Only the Review's exact saved version is read. */
export async function readFrozenReviewSource(projectId: string, review: StaticReviewRecord, artifacts: Artifact[], artifactId: string,
  storage: Pick<CentinelApplicationRepository, 'getArtifactVersion' | 'downloadArtifactVersion'>) {
  if (review.projectId !== projectId || !review.sourceManifestId) throw new Error('Frozen Review source unavailable.');
  const artifact = artifacts.find(item => item.id === artifactId && item.projectId === projectId);
  if (!artifact?.versionId || !artifact.contentHash) throw new Error('Frozen Review source unavailable.');
  const version = await storage.getArtifactVersion(projectId, artifact.versionId);
  const hash = (value: string) => value.replace(/^sha256:/i, '').toLowerCase();
  if (!version || version.id !== artifact.versionId || version.artifactId !== artifactId || hash(version.contentHash) !== hash(artifact.contentHash)) throw new Error('Frozen Review source version unavailable.');
  const content = await storage.downloadArtifactVersion(projectId, version.id);
  if (hash(artifact.contentHash) !== crypto.createHash('sha256').update(content).digest('hex')) throw new Error('Frozen Review source content could not be verified.');
  return { versionId: version.id, artifactVersionId: version.id, content: content.toString('base64'), contentHash: version.contentHash, mimeType: version.contentType };
}
