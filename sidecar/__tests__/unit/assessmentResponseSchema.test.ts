import { describe, expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { deriveReviewAnalysisMap, type ReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import { schemaForAssessmentMap, STATIC_ASSESSMENT_SCHEMA, validateAssessmentResponse } from '../../src/review/assessmentValidation.js';
import type { Artifact } from '../../src/artifacts.js';
import { specializeSupportSchema } from '../../src/review/assessmentResponseSchema.js';
import { CANDIDATE_SUPPORT_SCHEMA, validateCandidateSupportResponse } from '../../src/review/assessmentValidation.js';

const artifact: Artifact = { id: 'one', projectId: 'project', type: 'source_code', source: 'repository',
  fileName: 'one.ts', filePath: 'src/one.ts', contentHash: 'v1', originalPath: null, createdAt: '2026-10-27T00:00:00Z' };
const content = 'export function one() { return true; }';
const original = deriveReviewAnalysisMap([{ artifact, content }]);
function response(map: ReviewAnalysisMap, status: 'assessed' | 'unverified' = 'assessed') {
  return { findings: [], featureAssessments: map.features.map(feature => ({ featureId: feature.id,
    assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status,
      outcome: status === 'assessed' ? 'no_issue_identified' : 'unverified', summary: 'Bounded public conclusion.',
      evidence: status === 'assessed' ? [...feature.entryPoints] : [] })),
  })) };
}
const valid = (map: ReviewAnalysisMap, value: unknown) =>
  new AjvJsonSchemaValidator().getValidator(schemaForAssessmentMap(map, { exactReferences: true }))(value).valid;

describe('bounded full-reference generation schema', () => {
  it('accepts the unchanged full-reference response and keeps the canonical map/base schema immutable', () => {
    const before = JSON.stringify({ original, STATIC_ASSESSMENT_SCHEMA });
    const schema = schemaForAssessmentMap(original, { exactReferences: true });
    expect(schema.$defs).toBeDefined();
    expect(valid(original, response(original))).toBe(true);
    expect(validateAssessmentResponse(response(original), original, { requireCompleteLocalDomains: true }).status).toBe('assessed');
    expect(JSON.stringify({ original, STATIC_ASSESSMENT_SCHEMA })).toBe(before);
  });
  it('permits honest unverified outcomes while the clean-completion gate still rejects them', () => {
    const value = response(original, 'unverified');
    expect(valid(original, value)).toBe(true);
    expect(validateAssessmentResponse(value, original).features[0].assessments[0].status).toBe('unverified');
    expect(() => validateAssessmentResponse(value, original, { requireCompleteLocalDomains: true })).toThrow();
  });
  it.each(['artifactId', 'filePath', 'sourceVersion', 'lineNumber'] as const)('rejects a changed %s within a reference', field => {
    const value = response(original);
    value.featureAssessments[0].assessments[0].evidence = [{ ...value.featureAssessments[0].assessments[0].evidence[0],
      [field]: field === 'lineNumber' ? 123 : 'invented' }];
    expect(valid(original, value)).toBe(false);
  });
  it('rejects cross-reference field combinations even when each value occurs in the feature', () => {
    const map = structuredClone(original);
    map.features[0].entryPoints.push({ artifactId: 'two', filePath: 'src/two.ts', lineNumber: 2, sourceVersion: 'v2' });
    const value = response(map);
    value.featureAssessments[0].assessments[0].evidence = [{ ...map.features[0].entryPoints[0], filePath: 'src/two.ts' }];
    expect(valid(map, value)).toBe(false);
    value.featureAssessments[0].assessments[0].evidence = [map.features[0].entryPoints[1]];
    expect(valid(map, value)).toBe(true);
  });
  it('binds reference allowlists to the feature, including path evidence', () => {
    const map = structuredClone(original);
    const second = structuredClone(map.features[0]);
    second.id = 'second';
    second.entryPoints = [{ artifactId: 'two', filePath: 'src/two.ts', lineNumber: 2, sourceVersion: 'v2' }];
    second.paths = [];
    map.features.push(second);
    const value = response(map);
    value.featureAssessments[0].assessments[0].evidence = second.entryPoints;
    expect(valid(map, value)).toBe(false);
    map.features[0].paths.push({ id: 'path', kind: 'normal', status: 'inferred', label: 'Selected path', evidence: second.entryPoints });
    expect(valid(map, value)).toBe(true);
  });
  it.each([
    { status: 'assessed', outcome: 'unverified' },
    { status: 'unverified', outcome: 'no_issue_identified' },
    { status: 'assessed', evidence: [] },
    { status: 'assessed', evidence: [{ evidenceRef: 'r0' }] },
    { summary: '' }, { domain: 'invented' },
  ])('rejects inconsistent or incomplete assessment rows: %s', changed => {
    const value = response(original);
    Object.assign(value.featureAssessments[0].assessments[0], changed);
    expect(valid(original, value)).toBe(false);
  });
  it('requires four domains structurally; duplicate domains still fail canonical validation', () => {
    const value = response(original);
    value.featureAssessments[0].assessments[1] = structuredClone(value.featureAssessments[0].assessments[0]);
    expect(() => validateAssessmentResponse(value, original)).toThrow();
    value.featureAssessments[0].assessments.pop();
    expect(valid(original, value)).toBe(false);
  });
  it('preserves null source versions without inventing provenance', () => {
    const map = structuredClone(original);
    for (const feature of map.features) {
      for (const ref of [...feature.entryPoints, ...feature.paths.flatMap(path => path.evidence)]) ref.sourceVersion = null;
    }
    expect(valid(map, response(map))).toBe(true);
  });
  it.each(['empty', 'unresolved'])('allows only unverified rows for %s entry evidence', kind => {
    const map = structuredClone(original);
    if (kind === 'empty') { map.features[0].entryPoints = []; map.features[0].paths = []; }
    else map.features[0].entryPointStatus = 'unresolved';
    expect(valid(map, response(map, 'unverified'))).toBe(true);
    expect(valid(map, response(map))).toBe(false);
  });
  it('uses an empty feature array for independent source sweeps', () => {
    const map = { ...original, features: [] };
    expect(valid(map, response(map))).toBe(true);
    expect(valid(map, response(original))).toBe(false);
  });
  it.each(['references', 'strings', 'features'])('falls back atomically on oversized %s without changing the map or validator', reason => {
    const map = structuredClone(original);
    if (reason === 'references') map.features[0].entryPoints = Array.from({ length: 230 }, (_, index) => ({
      artifactId: `a${index}`, filePath: `src/${index}.ts`, lineNumber: 1, sourceVersion: `v${index}` }));
    if (reason === 'strings') map.features[0].entryPoints[0].filePath = 'x'.repeat(100_001);
    if (reason === 'features') map.features = Array.from({ length: 1_010 }, (_, index) => ({ ...map.features[0], id: `f${index}` }));
    const before = JSON.stringify(map);
    const schema = schemaForAssessmentMap(map, { exactReferences: true });
    expect(schema.$defs).toBeUndefined();
    expect(schema.properties.featureAssessments.maxItems).toBe(map.features.length);
    expect(JSON.stringify(map)).toBe(before);
    expect(valid(map, response(map))).toBe(true);
    const bad = response(map);
    bad.featureAssessments[0].assessments[0].evidence = [{ ...map.features[0].entryPoints[0], sourceVersion: 'invented' }];
    expect(() => validateAssessmentResponse(bad, map)).toThrow();
    Object.assign(bad.featureAssessments[0].assessments[0], { status: 'unverified', outcome: 'potential_gap' });
    expect(valid(map, bad)).toBe(false);
  });
  it('does not replace exact packet validation with a canonical reference allowlist', () => {
    const value = response(original);
    expect(valid(original, value)).toBe(true);
    expect(() => validateAssessmentResponse(value, original, { sources: [{ artifact, content: '', lineStart: 2, lineEnd: 2 }] })).toThrow();
  });
  it('keeps initial requests small while coupling statuses before any repair', () => {
    const schema = schemaForAssessmentMap(original);
    expect(schema.$defs).toBeUndefined();
    expect(JSON.stringify(schema).length - JSON.stringify(STATIC_ASSESSMENT_SCHEMA).length).toBeLessThan(1_000);
    const check = new AjvJsonSchemaValidator().getValidator(schema);
    expect(check(response(original)).valid).toBe(true);
    const bad = response(original);
    bad.featureAssessments[0].assessments[0].outcome = 'unverified';
    expect(check(bad).valid).toBe(false);
  });
});

describe('support repair source schema', () => {
  const sources = [{ artifact, content, lineStart: 1, lineEnd: 1 }, {
    artifact: { ...artifact, id: 'two', filePath: 'src/two.ts', contentHash: 'v2' },
    content: 'const safe = true;', lineStart: 8, lineEnd: 8,
  }];
  const row = { candidateId: 'candidate', claimBoundary: 'local_source', disposition: 'supported',
    trigger: 'The local expression runs.', consequence: 'The result is returned.', limitation: null, authorityReferences: [],
    references: [{ role: 'sink', artifactId: artifact.id, filePath: artifact.filePath, sourceVersion: artifact.contentHash, lineNumber: 1, evidence: content }] };
  const check = (value: unknown) => new AjvJsonSchemaValidator().getValidator(specializeSupportSchema(CANDIDATE_SUPPORT_SCHEMA, sources))(value).valid;
  it('accepts original support rows without mutating schema or source packets', () => {
    const before = JSON.stringify({ CANDIDATE_SUPPORT_SCHEMA, sources });
    expect(check({ candidates: [row] })).toBe(true);
    expect(check({ candidates: [{ ...row, disposition: 'insufficient', limitation: 'Runtime caller unavailable.', references: [] }] })).toBe(true);
    expect(JSON.stringify({ CANDIDATE_SUPPORT_SCHEMA, sources })).toBe(before);
  });
  it.each([{ filePath: 'src/two.ts' }, { sourceVersion: 'invented' }, { lineNumber: 2 }, { artifactId: 'two' }, { evidence: '' }])('rejects mixed identity, omitted range or empty evidence: %s', changed => {
    expect(check({ candidates: [{ ...row, references: [{ ...row.references[0], ...changed }] }] })).toBe(false);
  });
  it('leaves exact excerpt validation authoritative', () => {
    const value = { candidates: [{ ...row, references: [{ ...row.references[0], evidence: 'fabricated source' }] }] };
    expect(check(value)).toBe(true);
    expect(validateCandidateSupportResponse(value, [{ candidateId: 'candidate', finding: {} as never }], sources).complete).toBe(false);
  });
  it('falls back atomically on oversized or empty inventories', () => {
    expect(specializeSupportSchema(CANDIDATE_SUPPORT_SCHEMA, [])).toEqual(CANDIDATE_SUPPORT_SCHEMA);
    expect(specializeSupportSchema(CANDIDATE_SUPPORT_SCHEMA, Array.from({ length: 65 }, () => sources[0]))).toEqual(CANDIDATE_SUPPORT_SCHEMA);
    expect(specializeSupportSchema(CANDIDATE_SUPPORT_SCHEMA, [{ ...sources[0], artifact: { ...artifact, filePath: 'x'.repeat(100_001) } }])).toEqual(CANDIDATE_SUPPORT_SCHEMA);
  });
});
