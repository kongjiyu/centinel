import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { compactAnalysisMapForPrompt } from '../../sidecar/src/review/promptContextCompaction.js';
import type { ReviewAnalysisMap } from '../../sidecar/src/review/featurePathAnalysis.js';

// Offline comparison of the same captured initial batch maps. No source body,
// provider request, canonical map or historical journal is changed.
const filename = process.argv[2];
if (!filename) throw Error('Pass one captured optimized-harness.json file.');
const bytes = await fs.readFile(filename);
const harness = JSON.parse(bytes.toString('utf8')).data;
const prepared = harness.events.find((event: any) => event.event === 'review_analysis_map_saved' && event.detail?.phase === 'prepared')?.detail.analysisMap as ReviewAnalysisMap;
const plan = harness.events.find((event: any) => event.event === 'review_batches_planned')?.detail;
if (!prepared || !Array.isArray(plan?.batches)) throw Error('Prepared map and complete batch plan are required.');
const placeholderOnly = (map: ReviewAnalysisMap) => JSON.stringify({ ...map, features: map.features.map(feature => {
  const pending = feature.assessments.filter(row => row.status === 'unverified' && row.outcome === 'unverified'
    && row.summary === 'No domain assessment was returned for this feature.' && row.evidence.length === 0);
  if (!pending.length) return feature;
  const retained = feature.assessments.filter(row => !pending.includes(row));
  const { assessments: _assessments, ...rest } = feature;
  return { ...rest, ...(retained.length ? { assessments: retained } : {}), pendingDomains: pending.map(row => row.domain) };
}) });
const before = JSON.stringify(prepared);
const batches = plan.batches.map((batch: any) => {
  const selected = new Set(batch.featureIds);
  const sourceIds = new Set(batch.sources.map((source: any) => source.artifactId));
  const map: ReviewAnalysisMap = { ...prepared, features: prepared.features.filter(feature => selected.has(feature.id)),
    coverage: { ...prepared.coverage,
      declarationArtifacts: prepared.coverage.declarationArtifacts?.filter(item => sourceIds.has(item.artifactId)),
      nonExecutableArtifacts: prepared.coverage.nonExecutableArtifacts?.filter(item => sourceIds.has(item.artifactId)),
      unsupportedArtifacts: prepared.coverage.unsupportedArtifacts.filter(item => sourceIds.has(item.artifactId)),
    } };
  const old = placeholderOnly(map);
  const compact = compactAnalysisMapForPrompt(map);
  return { batchId: batch.id, featureCount: map.features.length, beforeCharacters: old.length,
    afterCharacters: compact.length, removedCharacters: old.length - compact.length,
    dictionaryUsed: Boolean(JSON.parse(compact).evidenceReferenceTable) };
});
if (JSON.stringify(prepared) !== before) throw Error('Canonical map was mutated.');
const total = (key: string) => batches.reduce((sum: number, row: any) => sum + row[key], 0);
process.stdout.write(JSON.stringify({ schemaVersion: 'centinel-graph-wire-comparison-v1',
  harnessSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  basis: 'Exact captured initial maps; characters only, no provider-token or quality claim',
  batchCount: batches.length, beforeCharacters: total('beforeCharacters'), afterCharacters: total('afterCharacters'),
  removedCharacters: total('removedCharacters'), canonicalUnchanged: true, batches }, null, 2) + '\n');
