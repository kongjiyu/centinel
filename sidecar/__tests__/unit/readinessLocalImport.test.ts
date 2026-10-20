import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CentinelApplicationRepository } from '../../src/applicationRepository.js';
import { importLocalRepositoryArtifacts } from '../../src/applicationApi.js';

const temporaryDirectories: string[] = [];
const temporaryPrefix = 'centinel-readiness-local-import-';

async function createLocalRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), temporaryPrefix));
  temporaryDirectories.push(root);
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'config'));
  await fs.writeFile(path.join(root, 'src', 'auth.ts'), 'export const secretMarker = "source-body-must-not-be-audit-data";\n');
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"readiness-fixture","private":true}\n');
  await fs.writeFile(path.join(root, 'config', 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n');
  await fs.writeFile(path.join(root, 'asset.bin'), Buffer.from([0, 255, 1, 254]));
  return root;
}

async function removeTemporaryDirectories() {
  const tempRoot = path.resolve(os.tmpdir());
  for (const directory of temporaryDirectories.splice(0)) {
    const target = path.resolve(directory);
    if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith(temporaryPrefix)) {
      throw new Error(`Refusing to remove a non-fixture path: ${target}`);
    }
    await fs.rm(target, { recursive: true, force: true });
  }
}

afterEach(async () => {
  await removeTemporaryDirectories();
  vi.restoreAllMocks();
});

function fakeRepository(options: { coverageError?: unknown; coverageReject?: Error } = {}) {
  const artifacts: Record<string, any>[] = [];
  const versionsByArtifact = new Map<string, Record<string, any>[]>();
  const savedContents = new Map<string, Buffer>();
  const coverageRows: Record<string, any>[] = [];
  let coverageError: unknown = options.coverageError ?? null;
  let coverageReject = options.coverageReject;
  let artifactNumber = 0;
  let versionNumber = 0;

  const insert = vi.fn(async (payload: Record<string, any>) => {
    coverageRows.push(payload);
    if (coverageReject) throw coverageReject;
    return { data: null, error: coverageError };
  });
  const repository = {
    userId: 'member-1',
    client: { from: vi.fn((table: string) => {
      if (table !== 'audit_events') throw new Error(`Unexpected table: ${table}`);
      return { insert };
    }) },
    saveArtifact: vi.fn(async (input: Record<string, any>) => {
      const artifact = {
        id: `artifact-${++artifactNumber}`, projectId: input.projectId, sourceId: input.sourceId,
        path: input.path, name: input.name, kind: input.kind, mimeType: input.mimeType, metadata: input.metadata,
        createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
      };
      artifacts.push(artifact);
      return artifact;
    }),
    uploadArtifactVersion: vi.fn(async (input: { projectId: string; artifactId: string; content: Buffer }) => {
      const version = {
        id: `version-${++versionNumber}`, projectId: input.projectId, artifactId: input.artifactId,
        versionNumber: 1, contentHash: crypto.createHash('sha256').update(input.content).digest('hex'),
        byteSize: input.content.length, storagePath: `versions/${input.artifactId}`, sourceRevision: null,
        contentType: 'application/octet-stream', metadata: {}, createdAt: '2026-10-19T00:00:00.000Z',
      };
      versionsByArtifact.set(input.artifactId, [version]);
      savedContents.set(version.id, Buffer.from(input.content));
      return version;
    }),
    listArtifactVersions: vi.fn(async (_projectId: string, artifactId: string) => versionsByArtifact.get(artifactId) ?? []),
  };

  return {
    repository: repository as unknown as CentinelApplicationRepository,
    saveArtifact: repository.saveArtifact,
    uploadArtifactVersion: repository.uploadArtifactVersion,
    listArtifactVersions: repository.listArtifactVersions,
    artifacts,
    savedContents,
    coverageRows,
    insert,
    setCoverageError(value: unknown) { coverageError = value; },
    setCoverageReject(value: Error | undefined) { coverageReject = value; },
  };
}

describe('importLocalRepositoryArtifacts readiness coverage', () => {
  it('persists supported files as versioned repository artifacts and stores only coverage metadata', async () => {
    const root = await createLocalRepository();
    const test = fakeRepository();

    const result = await importLocalRepositoryArtifacts(test.repository, 'project-1', root);

    expect(result.imported).toHaveLength(3);
    expect(result.skipped).toEqual(['asset.bin']);
    expect(test.artifacts.map(artifact => artifact.path).sort()).toEqual([
      'config/tsconfig.json', 'package.json', 'src/auth.ts',
    ]);
    expect(test.artifacts.every(artifact => artifact.metadata.source === 'repository')).toBe(true);
    expect(result.imported.map(artifact => artifact.filePath).sort()).toEqual([
      'config/tsconfig.json', 'package.json', 'src/auth.ts',
    ]);
    expect(result.imported.every(artifact => artifact.versionId && artifact.contentHash)).toBe(true);

    const source = test.artifacts.find(artifact => artifact.path === 'src/auth.ts');
    const sourceResult = result.imported.find(artifact => artifact.filePath === 'src/auth.ts');
    expect(sourceResult?.originalPath).toBe(path.join(root, 'src', 'auth.ts'));
    expect(test.savedContents.get(sourceResult!.versionId!)).toEqual(
      Buffer.from('export const secretMarker = "source-body-must-not-be-audit-data";\n'),
    );
    expect(source?.metadata.originalPath).toBe(path.join(root, 'src', 'auth.ts'));
    expect(test.saveArtifact).toHaveBeenCalledTimes(3);
    expect(test.uploadArtifactVersion).toHaveBeenCalledTimes(3);
    expect(test.listArtifactVersions).toHaveBeenCalledTimes(3);

    expect(test.coverageRows).toHaveLength(1);
    expect(test.coverageRows[0]).toMatchObject({
      project_id: 'project-1', actor_id: 'member-1', event_type: 'local_import_coverage',
      entity_type: 'project', entity_id: 'project-1',
      payload: {
        rootHash: crypto.createHash('sha256').update(root.toLowerCase()).digest('hex'),
        imported: 3,
        skipped: 1,
      },
    });
    const auditPayload = JSON.stringify(test.coverageRows[0]);
    expect(auditPayload).not.toContain(root);
    expect(auditPayload).not.toContain('src/auth.ts');
    expect(auditPayload).not.toContain('asset.bin');
    expect(auditPayload).not.toContain('source-body-must-not-be-audit-data');
  });

  it('throws a generic retryable error when the coverage event cannot be persisted', async () => {
    const root = await createLocalRepository();
    const test = fakeRepository({ coverageError: { message: 'Database response includes a private provider token.' } });

    let failure: unknown;
    try {
      await importLocalRepositoryArtifacts(test.repository, 'project-1', root);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Local import coverage could not be recorded. Retry the import before assessing readiness.');
    expect((failure as Error).message).not.toContain('private provider token');
    expect(test.coverageRows).toHaveLength(1);
    const auditPayload = JSON.stringify(test.coverageRows[0]);
    expect(auditPayload).not.toContain(root);
    expect(auditPayload).not.toContain('src/auth.ts');
    expect(auditPayload).not.toContain('source-body-must-not-be-audit-data');
  });

  it('converts a rejected coverage insert into the same generic retryable error', async () => {
    const root = await createLocalRepository();
    const rejected = new Error('Transport failure with local root and provider secret.');
    const test = fakeRepository({ coverageReject: rejected });

    let failure: unknown;
    try {
      await importLocalRepositoryArtifacts(test.repository, 'project-1', root);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Local import coverage could not be recorded. Retry the import before assessing readiness.');
    expect((failure as Error).message).not.toContain(rejected.message);

    expect(test.coverageRows).toHaveLength(1);
    const auditPayload = JSON.stringify(test.coverageRows[0]);
    expect(auditPayload).not.toContain(root);
    expect(auditPayload).not.toContain('src/auth.ts');
    expect(auditPayload).not.toContain('source-body-must-not-be-audit-data');
  });
});
