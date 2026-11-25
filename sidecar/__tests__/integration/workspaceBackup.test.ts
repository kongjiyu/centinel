import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import fs, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { backupWorkspace, restoreWorkspace } from '../../src/migration/workspaceBackup.js';
import { LocalWorkspace } from '../../src/store/localWorkspace.js';
import { LocalHistory } from '../../src/store/localHistory.js';
import type { ConversationRequest } from '../../src/conversation/types.js';

const passphrase = 'test fixture recovery passphrase';

it('uses the migration commands and refuses to capture while the sidecar port is occupied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orin-backup-cli-'));
  const home = join(root, 'source');
  const archive = join(root, 'workspace.orin');
  const destination = join(root, 'restore');
  const device = new LocalWorkspace(join(home, 'data', 'local-workspace'));
  const portLock = createServer();
  const close = () => new Promise<void>((done, reject) => portLock.close(error => error ? reject(error) : done()));
  try {
    const owner = randomUUID();
    const project = device.createProject(owner, { name: 'Offline CLI fixture', description: '', workspacePath: '' });
    device.close();
    await new Promise<void>((done, reject) => portLock.once('error', reject).listen(0, 'localhost', done));
    const env = { ...process.env, CENTINEL_WORKSPACE_BACKUP_PASSPHRASE: passphrase,
      CENTINEL_SIDECAR_PORT: String((portLock.address() as AddressInfo).port) };
    const run = (mode: string, location: string) => promisify(execFile)(process.execPath,
      ['--import', 'tsx', 'src/migration/workspaceBackupCli.ts', mode, location, archive], { env, timeout: 10_000 });
    await expect(run('backup', home)).rejects.toThrow(/Close the desktop sidecar/);
    expect(await readdir(root)).not.toContain('workspace.orin');
    await close();
    expect(JSON.parse((await run('backup', home)).stdout)).toMatchObject({ files: 1 });
    expect(JSON.parse((await run('restore', destination)).stdout)).toEqual({ files: 1 });
    const restored = new LocalWorkspace(join(destination, 'data', 'local-workspace'));
    try { expect(restored.project(owner, project.id)).toEqual(project); }
    finally { restored.close(); }
  } finally {
    if (portLock.listening) await close();
    device.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 20_000);

it('restores a verified workspace and history and preserves existing data on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orin-workspace-backup-'));
  const home = join(root, 'source');
  const workspacePath = join(home, 'data', 'local-workspace');
  const historyPath = join(home, 'data', 'project-history.sqlite');
  const workspace = new LocalWorkspace(workspacePath);
  const history = new LocalHistory(historyPath);
  const owner = randomUUID();
  const archive = join(root, 'workspace.orin');
  const destination = join(root, 'restore');
  try {
    const project = workspace.createProject(owner, { name: 'Private workspace marker', description: '', workspacePath: '' });
    const content = Buffer.from('Frozen fixture source\r\n'.repeat(9000));
    const sha = createHash('sha256').update(content).digest('hex');
    const artifact = { id: randomUUID(), versionId: randomUUID(), projectId: project.id, fileName: 'source.ts', filePath: 'source.ts',
      originalPath: null, contentHash: sha, source: 'repository' as const, type: 'source_code' as const, createdAt: project.createdAt };
    workspace.importSnapshot(owner, project, [{ artifact, bytes: content, mimeType: 'text/plain' }]);
    const turn = { id: randomUUID(), ownerId: owner, projectId: project.id, state: 'completed', createdAt: project.createdAt,
      updatedAt: project.createdAt, revision: 1, input: { text: 'Stored workspace chat', references: [] } } as ConversationRequest;
    history.importSaved(owner, project.id, [turn], []);
    await mkdir(workspace.hookReceiptsRoot, { recursive: true });
    await writeFile(join(workspace.hookReceiptsRoot, 'receipt.json'), '{"fixture":"retained"}');
    await mkdir(workspace.repositoryIndexRoot, { recursive: true });
    await writeFile(join(workspace.repositoryIndexRoot, 'derived'), 'temporary index');
    await writeFile(join(home, '.env'), 'OAUTH_SECRET=never-copied');

    // Leave the fixture connections open so that SQLite must include committed WAL data.
    expect(await backupWorkspace(home, archive, passphrase)).toMatchObject({ files: 4 });
    const encrypted = await readFile(archive);
    expect(encrypted.includes(Buffer.from('Private workspace marker'))).toBe(false);
    await expect(backupWorkspace(home, archive, passphrase)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(archive)).toEqual(encrypted);
    await expect(restoreWorkspace(archive, destination, 'an unrelated strong passphrase')).rejects.toThrow();
    expect(await readdir(root)).not.toContain('restore');

    const volume = vi.spyOn(fs, 'statfs').mockResolvedValue({ bsize: 4096n, bavail: 1n, type: 0n, blocks: 1n,
      bfree: 1n, files: 1n, ffree: 1n });
    try {
      await expect(restoreWorkspace(archive, destination, passphrase)).rejects.toThrow(/insufficient disk space/);
      await expect(backupWorkspace(home, join(root, 'no-space.orin'), passphrase)).rejects.toThrow(/insufficient disk space/);
      const entries = await readdir(root);
      expect(entries).not.toContain('restore');
      expect(entries).not.toContain('no-space.orin');
    } finally { volume.mockRestore(); }
    const damaged = join(root, 'damaged.orin');
    const truncated = Buffer.from(encrypted.subarray(0, encrypted.length - 19));
    await writeFile(damaged, truncated);
    await expect(restoreWorkspace(damaged, destination, passphrase)).rejects.toThrow();
    expect(await readdir(root)).not.toContain('restore');

    await writeFile(join(workspacePath, 'objects', sha), 'modified source');
    await expect(backupWorkspace(home, join(root, 'damaged-source.orin'), passphrase)).rejects.toThrow(/checksum/);
    expect(await readdir(root)).not.toContain('damaged-source.orin');
    expect(await restoreWorkspace(archive, destination, passphrase)).toEqual({ files: 4 });
    await expect(restoreWorkspace(archive, destination, passphrase)).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await readdir(root)).filter(name => name.startsWith('.orin-backup-'))).toEqual([]);
    expect(await readdir(destination)).toEqual(['data']);

    const restoredPath = join(destination, 'data', 'local-workspace');
    const restored = new LocalWorkspace(restoredPath);
    const restoredHistory = new LocalHistory(join(destination, 'data', 'project-history.sqlite'));
    try {
      expect(restored.project(owner, project.id)).toEqual(project);
      expect(restored.project(randomUUID(), project.id)).toBeNull();
      expect(restored.sourceBytes(owner, project.id, artifact.id, artifact.versionId)?.content).toEqual(content);
      expect(await restoredHistory.conversations(owner).list(project.id)).toEqual([turn]);
      expect(await readFile(join(restored.hookReceiptsRoot, 'receipt.json'), 'utf8')).toContain('retained');
      expect(await readdir(restoredPath)).not.toContain('index');
    } finally { restored.close(); restoredHistory.close(); }
  } finally {
    workspace.close();
    history.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
