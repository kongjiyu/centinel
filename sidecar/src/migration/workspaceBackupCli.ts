import { createServer } from 'node:net';
import { isAbsolute, join, relative, sep } from 'node:path';
import { config } from 'dotenv';
import { backupWorkspace, restoreWorkspace } from './workspaceBackup.js';

const [mode, home, archive, ...extra] = process.argv.slice(2);
if (!['backup', 'restore'].includes(mode) || !home || !isAbsolute(home) || !archive || !isAbsolute(archive) || extra.length) {
  throw new Error('Usage: backup|restore <absolute workspace home> <absolute archive file>.');
}
const relation = relative(home, archive);
if (!relation || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith('..' + sep))) {
  throw new Error('Place the backup archive outside the workspace home.');
}
const passphrase = process.env.CENTINEL_WORKSPACE_BACKUP_PASSPHRASE ?? '';
if (mode === 'restore') {
  console.log(JSON.stringify(await restoreWorkspace(archive, home, passphrase)));
} else {
  // Reserve the sidecar port for the capture so the normal desktop launcher
  // cannot start a writer between the database and evidence snapshots.
  config({ path: join(home, '.env'), quiet: true });
  const port = Number(process.env.CENTINEL_SIDECAR_PORT || 37701);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid sidecar port.');
  const lock = createServer(socket => socket.destroy());
  try {
    await new Promise<void>((done, fail) => {
      lock.once('error', fail);
      lock.listen(port, 'localhost', done);
    });
  } catch { throw new Error('Close the desktop sidecar on this port before backing up the workspace.'); }
  try { console.log(JSON.stringify(await backupWorkspace(home, archive, passphrase))); }
  finally { await new Promise<void>((done, fail) => lock.close(error => error ? fail(error) : done())); }
}
