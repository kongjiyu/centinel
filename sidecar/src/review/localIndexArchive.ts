import type { DatabaseSync } from 'node:sqlite';
import type { Artifact } from '../artifacts.js';
import { throwIfAborted } from './abort.js';
import { MAX_REPOSITORY_INDEX_ARCHIVE_BYTES, repositoryIndexArchiveSha256, normalizeRepositoryIndexIdentity,
  validateRepositorySnapshotArchive, type RepositoryIndexIdentity } from './repositoryIndexSnapshot.js';

export const localIndexArchiveSchema = `
  CREATE TABLE IF NOT EXISTS local_repository_index_archive (
    owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL,
    sha256 TEXT NOT NULL, content BLOB NOT NULL,
    PRIMARY KEY (owner, project, fingerprint), FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
`;

export type PortableIndexArchive = { identity: RepositoryIndexIdentity; archiveSha256: string; contentBase64: string };
export type VerifiedIndexArchive = { identity: RepositoryIndexIdentity; archiveSha256: string; bytes: Buffer };

export function sourcesCoverIndex(identity: RepositoryIndexIdentity, sources: ReadonlyMap<string, Artifact>): boolean {
  return identity.sources.length > 0 && identity.sources.every(entry => {
    const source = sources.get(entry.versionId);
    return source?.projectId === identity.projectId && source.id === entry.artifactId
      && typeof source.contentHash === 'string' && source.contentHash.replace(/^sha256:/i, '').toLowerCase() === entry.contentHash;
  });
}

export async function verifyPortableIndexArchives(items: unknown, project: string, sources: Artifact[]): Promise<VerifiedIndexArchive[]> {
  if (!Array.isArray(items)) throw new Error('Invalid repository index archive inventory.');
  const versions = new Map(sources.flatMap(source => source.versionId ? [[source.versionId, source] as const] : []));
  const seen = new Set<string>();
  const archives: VerifiedIndexArchive[] = [];
  for (const item of items as PortableIndexArchive[]) {
    const identity = normalizeRepositoryIndexIdentity(item?.identity);
    if (!identity || identity.projectId !== project || !sourcesCoverIndex(identity, versions) || seen.has(identity.fingerprint)
      || typeof item.contentBase64 !== 'string' || item.contentBase64.length > Math.ceil(MAX_REPOSITORY_INDEX_ARCHIVE_BYTES / 3) * 4) {
      throw new Error('A repository index archive has invalid identity or frozen sources.');
    }
    const bytes = Buffer.from(item.contentBase64, 'base64');
    if (bytes.toString('base64') !== item.contentBase64 || repositoryIndexArchiveSha256(bytes) !== item.archiveSha256) {
      throw new Error('A repository index archive failed its checksum.');
    }
    await validateRepositorySnapshotArchive(bytes, identity);
    seen.add(identity.fingerprint);
    archives.push({ identity, archiveSha256: item.archiveSha256, bytes });
  }
  return archives;
}

export class LocalIndexArchives {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  seed(project: string, archives: VerifiedIndexArchive[]): void {
    const insert = this.db.prepare('INSERT INTO local_repository_index_archive VALUES (?, ?, ?, ?, ?)');
    for (const archive of archives) {
      if (archive.identity.projectId !== project) throw new Error('A repository index archive belongs to a different project.');
      insert.run(this.owner, project, archive.identity.fingerprint, archive.archiveSha256, archive.bytes);
    }
  }

  async load(identity: RepositoryIndexIdentity, signal?: AbortSignal): Promise<Buffer | null> {
    throwIfAborted(signal);
    const row = this.db.prepare(`SELECT sha256, content FROM local_repository_index_archive
      WHERE owner = ? AND project = ? AND fingerprint = ? AND length(content) <= ?`)
      .get(this.owner, identity.projectId, identity.fingerprint, MAX_REPOSITORY_INDEX_ARCHIVE_BYTES);
    if (!(row?.content instanceof Uint8Array)) return null;
    const bytes = Buffer.from(row.content);
    if (repositoryIndexArchiveSha256(bytes) !== row.sha256) return null;
    try { await validateRepositorySnapshotArchive(bytes, identity, signal); }
    catch { throwIfAborted(signal); return null; }
    return bytes;
  }
}
