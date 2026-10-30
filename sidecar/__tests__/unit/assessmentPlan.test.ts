import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { prepareAssessmentPlan } from '../../src/review/assessmentPlan.js';
import { deriveReviewAnalysisMap, applyFeatureDomainAssessments } from '../../src/review/featurePathAnalysis.js';
import { assessedArtifactIds } from '../../src/review/assessmentValidation.js';
import type { EvidenceArtifact } from '../../src/review/evidenceSufficiency.js';

const source = (content: string): EvidenceArtifact => ({ artifact: { id: 'code', projectId: 'project', versionId: 'version',
  contentHash: 'frozen-hash', fileName: 'operations.ts', filePath: 'src/operations.ts', source: 'repository', type: 'source_code', originalPath: null, createdAt: '' }, content });

describe('complete assessment preplanning', () => {
  it('retains an ordinary bounded syntax plan', () => {
    const evidence = [source('export function sum() { return 1; }')];
    const map = deriveReviewAnalysisMap(evidence);
    const plan = prepareAssessmentPlan(map, evidence);
    expect(plan.map).toBe(map);
    expect(plan.syntaxMap).toBeUndefined();
  });
  it('bounds a real selected-module dependency closure without dropping any source', () => {
    const module = (id: string, content: string): EvidenceArtifact => ({ ...source(content), artifact: { ...source('').artifact,
      id, fileName: `${id}.ts`, filePath: `src/${id}.ts`, contentHash: crypto.createHash('sha256').update(content).digest('hex') } });
    const evidence = [module('entry', "import { first } from './first';\nexport function operation() { return first(); }"),
      module('first', `import { second } from './second';\nexport function first() {\n const local = '${'a'.repeat(35000)}';\n return second() + local;\n}`),
      module('second', `export function second() {\n const local = '${'b'.repeat(35000)}';\n return local;\n}`)];
    const original = deriveReviewAnalysisMap(evidence);
    const plan = prepareAssessmentPlan(original, evidence);
    expect(plan.syntaxMap).toBe(original);
    expect(plan.map.coverage.assessmentMode).toBe('plain_text_context_fallback');
    expect(new Set(plan.batches.flatMap(batch => batch.sources.map(segment => segment.artifact.id)))).toEqual(new Set(['entry', 'first', 'second']));
    expect(plan.batches.every(batch => batch.sources.reduce((n, segment) => n + segment.content.length, 0) <= 64000)).toBe(true);
  });
  it('keeps existing text units separate from diagnostic mapped-operation counts', () => {
    const evidence = [source(Array.from({ length: 2047 }, (_, i) => `export function operation${i}() { return ${i}; }`).join('\n')),
      { ...source('def worker():\n    return True'), artifact: { ...source('').artifact, id: 'python', fileName: 'worker.py', filePath: 'src/worker.py' } }];
    const map = deriveReviewAnalysisMap(evidence);
    const plan = prepareAssessmentPlan(map, evidence);
    expect(map.features).toHaveLength(2048);
    expect(plan.map.coverage.syntaxFeatureCount).toBe(2047);
  });
  it('retains the intact syntax map separately when bounded source text replaces oversized operation context', () => {
    const evidence = [source(Array.from({ length: 2048 }, (_, i) => `export function operation${i}() { return ${i}; }`).join('\n'))];
    const map = deriveReviewAnalysisMap(evidence);
    const plan = prepareAssessmentPlan(map, evidence);
    expect(plan.syntaxMap).toBe(map);
    expect(map.features).toHaveLength(2048);
    expect(plan.map.coverage).toMatchObject({ assessmentMode: 'plain_text_context_fallback', syntaxFeatureCount: 2048, featureInventoryTruncated: false });
    expect(plan.batches.length).toBeLessThanOrEqual(256);
    expect(plan.batches.every(batch => batch.features.length <= 8 && batch.sources.reduce((n, segment) => n + segment.content.length, 0) <= 64000)).toBe(true);
    const units = plan.map.features;
    expect(units.every(unit => unit.analysisKind === 'plain_text_logic')).toBe(true);
    const lines = evidence[0]!.content!.split('\n');
    expect(units.flatMap(unit => lines.slice(unit.sourceRange!.lineStart - 1, unit.sourceRange!.lineEnd)).join('\n')).toBe(evidence[0]!.content);
    const assessed = applyFeatureDomainAssessments(plan.map, { featureAssessments: units.map(unit => ({ featureId: unit.id,
      assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'The supplied text was assessed.', evidence: unit.entryPoints })) })) });
    expect(assessed.status).toBe('assessed');
    expect(assessedArtifactIds(assessed)).toEqual([]);
  });
  it('cannot bypass invalid parser input or an indivisible oversized executable line', () => {
    const invalid = [source('export function broken( {')];
    // A context failure elsewhere cannot convert this invalid source into accepted text assessment.
    const map = deriveReviewAnalysisMap(invalid);
    expect(map.coverage.unsupportedArtifacts[0]?.parserExclusion).toBeUndefined();
    const large = source(`export function huge() { return '${'x'.repeat(65000)}'; }`);
    expect(() => prepareAssessmentPlan(deriveReviewAnalysisMap([large]), [large])).toThrow();
    const many = source(Array.from({ length: 2048 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n'));
    expect(() => prepareAssessmentPlan(deriveReviewAnalysisMap([many, { ...invalid[0]!, artifact: { ...invalid[0]!.artifact, id: 'invalid', filePath: 'src/broken.ts' } }]),
      [many, { ...invalid[0]!, artifact: { ...invalid[0]!.artifact, id: 'invalid', filePath: 'src/broken.ts' } }])).toThrow();
    const mixed = [large, { ...invalid[0]!, artifact: { ...invalid[0]!.artifact, id: 'invalid', filePath: 'src/broken.ts' } },
      ...Array.from({ length: 10 }, (_, i) => ({ ...source('def worker():\n    return True'), artifact: { ...source('').artifact,
        id: `python-${i}`, fileName: `worker${i}.py`, filePath: `src/worker${i}.py` } }))];
    const mixedMap = deriveReviewAnalysisMap(mixed);
    expect(mixedMap.coverage.unsupportedExecutableArtifacts! - mixedMap.coverage.plainTextLogicArtifactCount!).toBe(1);
    expect(() => prepareAssessmentPlan(mixedMap, mixed)).toThrow();
  });
});
