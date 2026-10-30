import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { schemaForAssessmentMap, STATIC_ASSESSMENT_SCHEMA } from '../../sidecar/src/review/assessmentValidation.js';
import type { ReviewAnalysisMap } from '../../sidecar/src/review/featurePathAnalysis.js';
const { AjvJsonSchemaValidator } = createRequire(new URL('../../sidecar/package.json', import.meta.url))('@modelcontextprotocol/sdk/validation/ajv');

// Read captured maps only. No provider, evaluated repository execution or runtime import.
const filename = process.argv[2];
if (!filename) throw Error('Pass a saved optimized-harness.json.');
const bytes = await fs.readFile(filename);
const harness = JSON.parse(bytes.toString('utf8')).data;
const prepared = harness.events.find((event: any) => event.event === 'review_analysis_map_saved'
  && event.detail?.phase === 'prepared')?.detail.analysisMap as ReviewAnalysisMap;
const plan = harness.events.find((event: any) => event.event === 'review_batches_planned')?.detail;
if (!prepared || !Array.isArray(plan?.batches)) throw Error('Complete prepared map/plan required.');
const beforeMap = JSON.stringify(prepared);
const validator = new AjvJsonSchemaValidator();
const batches = plan.batches.map((batch: any) => {
  const selected = new Set(batch.featureIds);
  const map = { ...prepared, features: prepared.features.filter(feature => selected.has(feature.id)) };
  const prior = structuredClone(STATIC_ASSESSMENT_SCHEMA) as any;
  prior.properties.featureAssessments.minItems = prior.properties.featureAssessments.maxItems = map.features.length;
  if (map.features.length) prior.properties.featureAssessments.items.properties.featureId.enum = map.features.map(feature => feature.id);
  const next = schemaForAssessmentMap(map);
  const repair = schemaForAssessmentMap(map, { exactReferences: true });
  const honest = { findings: [], featureAssessments: map.features.map(feature => ({ featureId: feature.id,
    assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain,
      status: 'unverified', outcome: 'unverified', summary: 'Offline schema compatibility probe only.', evidence: [] })),
  })) };
  if (!validator.getValidator(next)(honest).valid) throw Error(`Honest unverified response rejected: ${batch.id}`);
  if (!validator.getValidator(repair)(honest).valid) throw Error(`Honest repair response rejected: ${batch.id}`);
  const beforeCharacters = JSON.stringify(prior).length;
  const afterCharacters = JSON.stringify(next).length;
  return { batchId: batch.id, featureCount: map.features.length, beforeCharacters, afterCharacters,
    addedCharacters: afterCharacters - beforeCharacters, repairCharacters: JSON.stringify(repair).length,
    exactRepairReferences: Boolean(repair.$defs),
    referenceDefinitions: Object.keys(repair.$defs ?? {}).length, honestUnverifiedValid: true };
});
if (JSON.stringify(prepared) !== beforeMap) throw Error('Canonical map mutated.');
const sum = (key: string) => batches.reduce((total: number, row: any) => total + row[key], 0);
process.stdout.write(JSON.stringify({ schemaVersion: 'centinel-assessment-schema-size-v1',
  harnessSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  basis: 'Exact initial captured batch maps; JSON characters only, no token or semantic-quality claim.',
  providerRequests: 0, batchCount: batches.length, beforeCharacters: sum('beforeCharacters'),
  afterCharacters: sum('afterCharacters'), addedCharacters: sum('addedCharacters'),
  hypotheticalEveryCallExactSchemaCharacters: sum('repairCharacters'),
  exactRepairBatches: batches.filter((row: any) => row.exactRepairReferences).length,
  canonicalUnchanged: true, batches }, null, 2) + '\n');
