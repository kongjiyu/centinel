import { createHash, randomUUID } from 'node:crypto';
import { detectArtifactType, type Artifact, type ArtifactType } from '../artifacts.js';
import { DynamicContractError } from '../dynamic/types.js';
import type { LocalWorkspace } from './localWorkspace.js';
import type { StoreProject } from './types.js';

const maxDocumentBytes = 10 * 1024 * 1024;
const maxBase64Characters = 4 * Math.ceil(maxDocumentBytes / 3);
export const maxDocumentRequestBytes = maxBase64Characters + 16_384;
const artifactTypes = new Set<ArtifactType>(['requirement', 'design', 'source_code', 'coding_standard', 'other']);

export function uploadLocalDocument(workspace: LocalWorkspace, owner: string, project: StoreProject, body: Record<string, unknown>) {
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';
  const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() as ArtifactType : detectArtifactType(fileName);
  if (!fileName || /[\\\x00-\x1f]/.test(fileName) || fileName.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new DynamicContractError(400, 'Supply a file name or a relative document path.');
  }
  if (!artifactTypes.has(type)) throw new DynamicContractError(400, 'Choose a supported document type.');
  if (!content || content.length > maxBase64Characters || content.length % 4 || /[^A-Za-z0-9+/=]/.test(content)
    || content.slice(0, -2).includes('=')) {
    throw new DynamicContractError(400, 'Supply a base64 encoded file up to 10 MiB.');
  }
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > maxDocumentBytes || bytes.toString('base64') !== content) {
    throw new DynamicContractError(400, 'Supply a base64 encoded file up to 10 MiB.');
  }
  if (body.reviewReference === true && (fileName.includes('/') || !/\.(?:md|txt|pdf|json|csv|ya?ml)$/i.test(fileName))) {
    throw new DynamicContractError(400, 'Choose a supported reference file up to 10 MiB.');
  }
  const now = new Date().toISOString();
  const artifact: Artifact & { versionId: string } = {
    id: randomUUID(), versionId: randomUUID(), projectId: project.id, type, source: 'documents', fileName,
    filePath: `uploads/${randomUUID()}-${fileName}`, originalPath: null,
    contentHash: createHash('sha256').update(bytes).digest('hex'), createdAt: now, updatedAt: now,
  };
  workspace.importSnapshot(owner, project, [{ artifact, bytes, mimeType: 'application/octet-stream' }]);
  return artifact;
}
