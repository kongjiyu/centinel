import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deriveReviewAnalysisMap } from '../../sidecar/src/review/featurePathAnalysis.js';
import { planAssessmentBatches, REVIEW_SOURCE_BATCH_CHARACTERS } from '../../sidecar/src/review/assessmentBatches.js';
import type { Artifact } from '../../sidecar/src/artifacts.js';

// Replay the actual failed source packet offline. No model/index requests or
// runtime imports from the evaluated repository are executed.
const [directory, stage] = process.argv.slice(2).map(value => path.resolve(value));
if (!directory || !stage) throw Error('Pass the captured run and exact frozen staging directories.');
const filenames = (await fs.readdir(directory)).sort();
const latest = async (suffix: string) => JSON.parse(await fs.readFile(path.join(directory, filenames.filter(name => /^\d+-/.test(name) && name.endsWith(suffix)).at(-1)!), 'utf8')).data;
const manifest = await latest('baseline-manifest.json');
const harness = await latest('optimized-harness.json');
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const originalImports = JSON.parse(await fs.readFile(path.join(workspace, 'evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z/0002-imported-artifacts.json'), 'utf8')).data;
const artifacts = await Promise.all(manifest.artifacts.map(async (frozen: any) => {
  const metadata = originalImports.find((item: any) => item.id === frozen.id);
  if (!metadata) throw Error('Frozen artifact metadata unavailable.');
  const filename = path.resolve(stage, frozen.filePath);
  if (!filename.startsWith(stage + path.sep)) throw Error('Source path escaped the frozen staging root.');
  const content = await fs.readFile(filename, 'utf8');
  if (crypto.createHash('sha256').update(content).digest('hex') !== frozen.contentHash) throw Error('Frozen source hash mismatch.');
  return { artifact: { ...metadata, versionId: frozen.artifactVersionId, contentHash: frozen.contentHash } as Artifact, content };
}));
const map = deriveReviewAnalysisMap(artifacts);
const batches = planAssessmentBatches(map, artifacts, null);
const original = harness.events.find((event: any) => event.event === 'review_batches_planned').detail.batches
  .find((batch: any) => batch.id === '0ea12672958cd46a');
if (!original) throw Error('Original failed packet was not found.');
const targetIds = [...original.featureIds].sort();
const candidate = batches.find(batch => JSON.stringify(batch.features.map(feature => feature.id).sort()) === JSON.stringify(targetIds));
if (!candidate) throw Error('The original failed feature group was not preserved.');
const key = (row: any) => `${row.artifactId}:${row.lineStart}:${row.lineEnd}:${row.sourceVersion}`;
const ranges = candidate.sources.map(source => ({ artifactId: source.artifact.id, sourceVersion: source.artifact.contentHash,
  filePath: source.artifact.filePath, lineStart: source.lineStart, lineEnd: source.lineEnd }));
const missing = original.sources.filter((row: any) => !ranges.some(next => key(next) === key(row)));
const dependency = artifacts.find(item => item.artifact.filePath === 'lib/utils.js');
const retained = candidate.sources.filter(item => item.artifact.id === dependency?.artifact.id);
const completeDependency = !!dependency && retained.length > 0
  && retained.map(item => item.content).join('\n') === dependency.content;
const sourceCharacters = candidate.sources.reduce((sum, source) => sum + source.content.length, 0);
const status = missing.length === 0 && completeDependency && sourceCharacters <= REVIEW_SOURCE_BATCH_CHARACTERS ? 'passed' : 'failed';
process.stdout.write(JSON.stringify({ schemaVersion: 'centinel-frozen-axios-packet-replay-v1', status,
  originalBatchId: original.id, candidateBatchId: candidate.id, selectedFiles: artifacts.length, featureCount: map.features.length,
  originalSourceRanges: original.sources.length, retainedSourceRanges: ranges.length, missingOriginalRanges: missing.length,
  dependencyComplete: completeDependency, sourceCharacters, sourceCeiling: REVIEW_SOURCE_BATCH_CHARACTERS,
  packetDiagnostics: candidate.packetDiagnostics, providerRequests: 0,
  limitation: 'Evidence-delivery verification only; not semantic support, runtime reachability or full-review acceptance.' }, null, 2) + '\n');
if (status !== 'passed') process.exitCode = 1;
