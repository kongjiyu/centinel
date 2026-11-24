import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const review = '44444444-4444-4444-8444-444444444444';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureRoot = new URL('../sidecar/__tests__/fixtures/synthetic-project/', import.meta.url);
const sources = [
  { id: '55555555-5555-4555-8555-555555555555', path: 'src/api.ts' },
  { id: '66666666-6666-4666-8666-666666666666', path: 'src/middleware.ts' },
].map(source => {
  const bytes = readFileSync(new URL(source.path, fixtureRoot));
  return { ...source, bytes, hash: digest(bytes) };
});

const directory = mkdtempSync(join(tmpdir(), 'centinel-local-pilot-'));
const databasePath = join(directory, 'workspace.sqlite');
let db;
try {
  db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (
      owner_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (owner_id, id)
    ) STRICT;
    CREATE TABLE versions (
      owner_id TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL,
      path TEXT NOT NULL, hash TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      PRIMARY KEY (owner_id, project_id, id),
      FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id)
    ) STRICT;
    CREATE TABLE review_sources (
      owner_id TEXT NOT NULL, project_id TEXT NOT NULL, review_id TEXT NOT NULL, version_id TEXT NOT NULL,
      PRIMARY KEY (owner_id, project_id, review_id, version_id),
      FOREIGN KEY (owner_id, project_id, version_id) REFERENCES versions(owner_id, project_id, id)
    ) STRICT;
    PRAGMA user_version = 1;
  `);

  for (const source of sources) writeFileSync(join(directory, source.hash), source.bytes, { flag: 'wx' });
  const insertProject = db.prepare('INSERT INTO projects VALUES (?, ?) ON CONFLICT DO NOTHING');
  const insertVersion = db.prepare('INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
  const attachVersion = db.prepare('INSERT INTO review_sources VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
  for (let attempt = 0; attempt < 2; attempt++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      insertProject.run(owner, project);
      for (const source of sources) {
        insertVersion.run(owner, project, source.id, source.path, source.hash, source.bytes.length);
        attachVersion.run(owner, project, review, source.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  assert.throws(() => attachVersion.run(otherOwner, project, review, sources[0].id), /foreign key/i);
  db.close();
  db = undefined;
  db = new DatabaseSync(databasePath, { readOnly: true });
  const selectSources = db.prepare(`
    SELECT v.id, v.path, v.hash, v.byte_length
    FROM review_sources AS r
    JOIN versions AS v ON (v.owner_id, v.project_id, v.id) = (r.owner_id, r.project_id, r.version_id)
    WHERE r.owner_id = ? AND r.project_id = ? AND r.review_id = ?
    ORDER BY v.path
  `);
  assert.equal(db.prepare('SELECT count(*) AS total FROM versions').get().total, sources.length);
  assert.deepEqual(selectSources.all(otherOwner, project, review), []);
  const reopened = selectSources.all(owner, project, review);
  assert.equal(reopened.length, sources.length);
  for (const [index, row] of reopened.entries()) {
    const source = sources[index];
    assert.equal(row.id, source.id);
    assert.equal(row.path, source.path);
    assert.equal(row.hash, source.hash);
    const savedBytes = readFileSync(join(directory, source.hash));
    assert.equal(row.byte_length, savedBytes.length);
    assert.equal(digest(savedBytes), row.hash);
    assert.deepEqual(savedBytes, source.bytes);
  }
  console.log('Local pilot passed: one fixture project, two frozen versions, idempotent metadata import, restart, and owner isolation.');
} finally {
  db?.close();
  for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
  rmdirSync(directory);
}
