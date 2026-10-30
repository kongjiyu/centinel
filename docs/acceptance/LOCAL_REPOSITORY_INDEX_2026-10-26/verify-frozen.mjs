import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Evaluator-only filesystem proof. Never import this into the app/model/index.
const [manifestFile, stageDirectory] = process.argv.slice(2);
if (!manifestFile || !stageDirectory) throw new Error('Pass the captured manifest JSON and exact staged-source directory.');
const capture = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const manifest = capture.data ?? capture;
const receipt = JSON.parse(await fs.readFile(`${stageDirectory}.receipt.json`, 'utf8'));
const artifacts = manifest.artifacts;
if (manifest.status !== 'available' || !Array.isArray(artifacts) || artifacts.length !== 52 || receipt.identity.sources?.length !== 52)
  throw new Error('The complete frozen 52-file scope is unavailable.');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalHash = value => String(value).replace(/^sha256:/i, '').toLowerCase();
const rows = artifacts.map(item => ({ path: item.filePath.replaceAll('\\', '/'), versionId: item.artifactVersionId, contentHash: item.contentHash }))
  .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const manifestSha256 = digest(JSON.stringify(rows));
const mismatches = [];
const root = path.resolve(stageDirectory);
for (const source of receipt.identity.sources) {
  const artifact = artifacts.find(item => item.id === source.artifactId);
  const filename = path.resolve(root, source.filePath);
  const relative = path.relative(root, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Staged source path escapes its frozen root.');
  const bytes = await fs.readFile(filename);
  if (!artifact || artifact.artifactVersionId !== source.versionId || normalHash(artifact.contentHash) !== source.contentHash
    || digest(bytes) !== normalHash(artifact.contentHash)) mismatches.push(source.artifactId);
}
const expected = '669a3ea464b6c3184f87dc29526db66e587c9226e754c4e69b56937bbdf99c64';
const proof = { recordedAt: new Date().toISOString(), projectId: receipt.identity.projectId,
  indexFingerprint: receipt.identity.fingerprint, manifestSha256, expectedManifestMatches: manifestSha256 === expected,
  filesChecked: artifacts.length, validFiles: artifacts.length - mismatches.length, mismatchArtifactIds: mismatches,
  scope: 'frozen_bytes_and_version_identity_only' };
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
if (mismatches.length || manifestSha256 !== expected) process.exitCode = 1;
