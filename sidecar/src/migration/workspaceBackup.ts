import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs, { link, lstat, mkdir, mkdtemp, open, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('ORIN-WORKSPACE-1\n');
const headerSize = magic.length + 16 + 12;
const tagSize = 16;
const maxManifestBytes = 32 * 1024 * 1024;
const chunkSize = 64 * 1024;
const workspace = 'local-workspace';
const workspaceDb = workspace + '/workspace.sqlite';
const historyDb = 'project-history.sqlite';
const roots = new Set(['objects', 'browser-runs', 'unit-receipts', 'hook-receipts', 'browser-sessions',
  'browser-uploads', 'browser-downloads', 'environment-values', 'workspace-authorizations']);
const digest = /^[a-f0-9]{64}$/;

type Entry = { path: string; bytes: number; sha256: string };
type Manifest = { version: 1; files: Entry[] };
type InputFile = Entry & { filename: string };

function safePath(path: string) {
  if (path === workspaceDb || path === historyDb) return true;
  const parts = path.split('/');
  return parts.length >= 3 && parts[0] === workspace && roots.has(parts[1]) && parts.every(part =>
    /^[A-Za-z0-9_.-]{1,255}$/.test(part) && part !== '.' && part !== '..' && !part.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

async function hashFile(filename: string) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('A workspace backup input is not a regular file.');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; hash.update(chunk); }
  if (bytes !== stat.size) throw new Error('A workspace file changed during backup.');
  return { bytes, sha256: hash.digest('hex') };
}

async function findFiles(directory: string, relative: string, files: InputFile[]) {
  const stat = await lstat(directory).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('A workspace backup directory is redirected.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'homes' && /(?:unit|hook)-receipts$/.test(relative)) continue;
    const path = relative + '/' + entry.name;
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) await findFiles(filename, path, files);
    else if (entry.isFile()) {
      if (!safePath(path)) throw new Error('Workspace backup encountered a file name that cannot be restored safely.');
      if (relative === workspace + '/objects' && !digest.test(entry.name)) continue;
      const verified = await hashFile(filename);
      if (relative === workspace + '/objects' && verified.sha256 !== entry.name) throw new Error('A workspace object failed checksum verification.');
      files.push({ path, filename, ...verified });
    } else throw new Error('A workspace backup directory contains a redirected or unsupported entry.');
  }
}

function verifySnapshot(root: string, files: readonly Entry[]) {
  const inventory = new Map(files.map(file => [file.path, file]));
  for (const path of [workspaceDb, historyDb]) {
    if (!inventory.has(path)) continue;
    const db = new DatabaseSync(join(root, path), { readOnly: true });
    try {
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
        throw new Error('The workspace SQLite snapshot failed its integrity checks.');
      }
      if (path !== workspaceDb) continue;
      const relationships = [
        'SELECT hash, bytes AS length FROM source_version',
        'SELECT hash, length FROM local_dynamic_evidence',
        'SELECT hash, length FROM local_legacy_dynamic_evidence WHERE hash IS NOT NULL',
        'SELECT hash, length FROM local_review_decision_file',
        ...['json', 'markdown', 'pdf'].map(format =>
          `SELECT json_extract(payload, '$.history.storage.${format}') AS hash,
                   json_extract(payload, '$.lengths.${format}') AS length
            FROM local_project_report WHERE json_type(payload, '$.lengths') = 'object'`),
      ];
      for (const query of relationships) {
        for (const row of db.prepare(query).iterate()) {
          const file = inventory.get(workspace + '/objects/' + row.hash);
          if (!file || file.sha256 !== row.hash || file.bytes !== row.length) {
            throw new Error('A referenced workspace object is missing or fails its recorded checksum or size.');
          }
        }
      }
    } finally { db.close(); }
  }
}

function key(passphrase: string, salt: Buffer) {
  if (passphrase.length < 16 || Buffer.byteLength(passphrase) > 4096) throw new Error('Supply a backup passphrase of at least 16 characters.');
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function requireSpace(directory: string, bytes: bigint) {
  const volume = await fs.statfs(directory, { bigint: true });
  if (volume.bavail * volume.bsize < bytes) throw new Error('There is insufficient disk space for this workspace backup or restore.');
}

async function removeStage(parent: string, stage: string) {
  if (dirname(resolve(stage)) !== resolve(parent) || !/^\.orin-backup-[A-Za-z0-9]+$/.test(stage.slice(stage.lastIndexOf(sep) + 1))) {
    throw new Error('Unexpected backup staging path.');
  }
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

export async function backupWorkspace(home: string, archive: string, passphrase: string) {
  const data = join(home, 'data');
  for (const directory of [data, join(data, workspace)]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The workspace backup source is redirected.');
  }
  const stageParent = dirname(archive);
  const stage = await mkdtemp(join(stageParent, '.orin-backup-'));
  try {
    const files: InputFile[] = [];
    for (const path of [workspaceDb, historyDb]) {
      const original = join(data, path);
      const stat = await lstat(original).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!stat && path === historyDb) continue;
      if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('A workspace SQLite database is missing or redirected.');
      const filename = join(stage, path);
      await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(original, { readOnly: true });
      try { await backup(db, filename); } finally { db.close(); }
      const snapshot = new DatabaseSync(filename);
      try { snapshot.exec('PRAGMA journal_mode = DELETE'); } finally { snapshot.close(); }
      files.push({ path, filename, ...await hashFile(filename) });
    }
    for (const root of roots) await findFiles(join(data, workspace, root), workspace + '/' + root, files);
    verifySnapshot(stage, files);
    const manifest: Manifest = { version: 1, files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) };
    const metadata = Buffer.from(JSON.stringify(manifest));
    if (metadata.length > maxManifestBytes) throw new Error('The workspace backup manifest exceeds its size limit.');
    const total = files.reduce((sum, file) => sum + BigInt(file.bytes), 0n);
    await requireSpace(stage, total + BigInt(metadata.length + headerSize + tagSize + 4));
    const header = Buffer.concat([magic, randomBytes(16), randomBytes(12)]);
    const cipher = createCipheriv('aes-256-gcm', key(passphrase, header.subarray(magic.length, magic.length + 16)), header.subarray(-12));
    cipher.setAAD(header);
    async function* contents() {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(metadata.length);
      yield length;
      yield metadata;
      for (const file of files) {
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of createReadStream(file.filename)) {
          bytes += chunk.length;
          hash.update(chunk);
          yield chunk;
        }
        if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error('A workspace file changed during backup.');
      }
    }
    const temporary = join(stage, 'archive');
    await pipeline(Readable.from((async function* () {
      yield header;
      const encoding = pipeline(Readable.from(contents()), cipher);
      void encoding.catch(() => undefined);
      try {
        for await (const chunk of cipher) yield chunk;
        await encoding;
        yield cipher.getAuthTag();
      } finally { cipher.destroy(); await encoding.catch(() => undefined); }
    })()), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const completed = await open(temporary, 'r+');
    try { await completed.sync(); } finally { await completed.close(); }
    await link(temporary, archive);
    return { files: files.length, bytes: Number(total) };
  } finally { await removeStage(stageParent, stage); }
}

function parseManifest(bytes: Buffer): Manifest {
  const manifest = JSON.parse(bytes.toString('utf8')) as Manifest;
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported workspace backup manifest.');
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !safePath(file.path) || paths.has(file.path.toLowerCase())
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== 'string' || !digest.test(file.sha256)) {
      throw new Error('Invalid workspace backup file metadata.');
    }
    paths.add(file.path.toLowerCase());
  }
  if (!paths.has(workspaceDb)) throw new Error('The archive has no workspace database.');
  return manifest;
}

export async function restoreWorkspace(archive: string, destination: string, passphrase: string) {
  const stageParent = dirname(destination);
  const stage = await mkdtemp(join(stageParent, '.orin-backup-'));
  const file = await open(archive, 'r').catch(async error => { await removeStage(stageParent, stage); throw error; });
  try {
    const header = Buffer.alloc(headerSize);
    const tag = Buffer.alloc(tagSize);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= headerSize + tagSize
      || (await file.read(header, 0, headerSize, 0)).bytesRead !== headerSize || !header.subarray(0, magic.length).equals(magic)
      || (await file.read(tag, 0, tagSize, stat.size - tagSize)).bytesRead !== tagSize) {
      throw new Error('Invalid workspace backup header.');
    }
    const decipher = createDecipheriv('aes-256-gcm', key(passphrase, header.subarray(magic.length, magic.length + 16)), header.subarray(-12));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const source = file.createReadStream({ start: headerSize, end: stat.size - tagSize - 1, autoClose: false, highWaterMark: chunkSize });
    const decoding = pipeline(source, decipher);
    void decoding.catch(() => undefined);
    try {
      const iterator = decipher[Symbol.asyncIterator]();
      let unread = Buffer.alloc(0);
      async function* take(length: number): AsyncGenerator<Buffer> {
        while (length) {
          if (!unread.length) {
            const next = await iterator.next();
            if (next.done) throw new Error('The workspace archive ended before all files were read.');
            unread = next.value;
          }
          const count = Math.min(length, unread.length);
          const chunk = unread.subarray(0, count);
          unread = unread.subarray(count);
          length -= count;
          yield chunk;
        }
      }
      async function read(length: number) {
        const chunks: Buffer[] = [];
        for await (const chunk of take(length)) chunks.push(chunk);
        return Buffer.concat(chunks);
      }
      const size = (await read(4)).readUInt32BE();
      if (size < 1 || size > maxManifestBytes) throw new Error('The workspace backup could not be unlocked or its manifest is invalid.');
      const manifest = parseManifest(await read(size));
      const total = manifest.files.reduce((sum, entry) => sum + BigInt(entry.bytes), 0n);
      if (total !== BigInt(stat.size - headerSize - tagSize - 4 - size)) throw new Error('The workspace archive byte count does not match its manifest.');
      await requireSpace(stage, total);
      for (const entry of manifest.files) {
        const path = join(stage, entry.path);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const hash = createHash('sha256');
        await pipeline(Readable.from((async function* () {
          for await (const chunk of take(entry.bytes)) { hash.update(chunk); yield chunk; }
        })()), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
        if (hash.digest('hex') !== entry.sha256) throw new Error('A restored workspace file failed its manifest checksum.');
      }
      if (unread.length || !(await iterator.next()).done) throw new Error('Unexpected data after the workspace backup inventory.');
      await decoding;
      verifySnapshot(stage, manifest.files);
      await mkdir(destination, { mode: 0o700 });
      try { await rename(stage, join(destination, 'data')); }
      catch (error) { await rmdir(destination).catch(() => undefined); throw error; }
      return { files: manifest.files.length };
    } finally {
      decipher.destroy();
      await decoding.catch(() => undefined);
    }
  } finally {
    await file.close();
    await removeStage(stageParent, stage);
  }
}
