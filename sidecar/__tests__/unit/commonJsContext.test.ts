import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { planAssessmentBatches } from '../../src/review/assessmentBatches.js';
import { deriveReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import type { ReviewAnalysisFeature, ReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';

function item(id: string, content: string, type: Artifact['type'] = 'source_code') {
  return { artifact: { id, projectId: 'p', type, source: 'repository', fileName: id.split('/').at(-1)!, filePath: id,
    originalPath: null, versionId: `frozen-${id}`, contentHash: crypto.createHash('sha256').update(content).digest('hex'),
    createdAt: '2026-10-27T00:00:00Z' } as Artifact, content };
}

function mappedFeature(source: ReturnType<typeof item>, lineNumber: number): ReviewAnalysisFeature {
  return { id: 'selected-form-conversion', label: 'selected form conversion', provisional: true,
    entryPoints: [{ artifactId: source.artifact.id, filePath: source.artifact.filePath, lineNumber, sourceVersion: source.artifact.contentHash }],
    paths: [], assessments: [], unresolved: [] };
}

function plan(importer: ReturnType<typeof item>, extras: ReturnType<typeof item>[] = []) {
  const artifacts = [importer, ...extras];
  const selectedLine = importer.content.split('\n').findIndex(line => line.includes('function formDataToJSON')) + 1;
  const map: ReviewAnalysisMap = { ...deriveReviewAnalysisMap([]), features: [mappedFeature(importer, selectedLine)] };
  return { artifacts, batches: planAssessmentBatches(map, artifacts) };
}

const importer = (body = 'return utils.formDataToJSON(input);') => item('lib/forms/formDataToJSON.js',
  `var utils = require('../utils');\nfunction formDataToJSON(input) {\n  ${body}\n}\n`);
const dependency = (content = 'exports.formDataToJSON = function (input) { return input; };\n') => item('lib/utils.js', content);

function featureBatch(batches: ReturnType<typeof plan>['batches']) {
  const batch = batches.find(candidate => candidate.features.length > 0);
  if (!batch) throw new Error('Expected a feature batch.');
  return batch;
}

describe('bounded CommonJS dependency context', () => {
  it('adds the exact complete frozen dependency for a selected namespace use', () => {
    const source = importer();
    const target = dependency("var serializer = require('./serializer');\nexports.formDataToJSON = function (input) { return serializer.convert(input); };\n");
    const transitive = item('lib/serializer.js', 'exports.convert = input => input;\n');
    const before = structuredClone([source, target, transitive]);
    const { artifacts, batches } = plan(source, [target, transitive]);
    const batch = featureBatch(batches);
    const added = batch.sources.find(segment => segment.artifact.id === target.artifact.id
      && segment.content === target.content);

    expect(added).toMatchObject({ artifact: { versionId: target.artifact.versionId, contentHash: target.artifact.contentHash },
      content: target.content, lineStart: 1, lineEnd: target.content.split('\n').length });
    expect(batch.packetDiagnostics).toMatchObject({ addedCommonJsDependencyCount: 1, omittedCommonJsDependencyCount: 0 });
    expect(batch.sources.some(segment => segment.artifact.id === transitive.artifact.id)).toBe(false);
    expect(artifacts).toEqual(before);
  });

  it('keeps appended documents and the original packet when the whole dependency exceeds remaining capacity', () => {
    const source = importer();
    const target = dependency(`module.exports = {};\n//${'x'.repeat(63_900)}`);
    const document = item('policy.md', 'Frozen project policy.', 'other');
    const before = structuredClone([source, target, document]);
    const { artifacts, batches } = plan(source, [target, document]);
    const batch = featureBatch(batches);

    expect(batch.sources.some(segment => segment.artifact.id === document.artifact.id && segment.content === document.content)).toBe(true);
    expect(batch.sources.some(segment => segment.artifact.id === target.artifact.id && segment.content === target.content)).toBe(false);
    expect(batch.sources.some(segment => segment.artifact.id === source.artifact.id)).toBe(true);
    expect(batch.packetDiagnostics).toMatchObject({ addedCommonJsDependencyCount: 0, omittedCommonJsDependencyCount: 1 });
    expect(batch.sources.reduce((sum, segment) => sum + segment.content.length, 0)).toBeLessThanOrEqual(64_000);
    expect(artifacts).toEqual(before);
  });

  it.each([
    ['shadowed require', "const require = localRequire;\nvar utils = require('../utils');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['reassigned require', "require = localRequire;\nvar utils = require('../utils');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['shadowed binding', "var utils = require('../utils');\nfunction formDataToJSON(utils) { return utils.formDataToJSON('input'); }\n", 0],
    ['reassigned binding', "var utils = require('../utils');\nutils = replacement;\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['mutated property', "var utils = require('../utils');\nutils.formDataToJSON = replacement;\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['dynamic specifier', "var utils = require('../' + target);\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['non-relative specifier', "var utils = require('selected-package');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['with dynamic scope', "var utils = require('../utils');\nfunction formDataToJSON(obj, input) { with (obj) { return utils.formDataToJSON(input); } }\n", 1],
    ['direct eval dynamic scope', "var utils = require('../utils');\neval('utils = replacement');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['parenthesized direct eval dynamic scope', "var utils = require('../utils');\n(eval)('utils = replacement');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n", 1],
    ['parse error', "var utils = require('../utils');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input);\n", 0],
  ])('does not add context for %s', (_reason, content, expectedOmittedCount) => {
    const source = item('lib/forms/formDataToJSON.js', content);
    const target = dependency();
    const before = structuredClone([source, target]);
    const { artifacts, batches } = plan(source, [target]);
    const batch = featureBatch(batches);

    expect(batch.sources.some(segment => segment.artifact.id === target.artifact.id && segment.content === target.content)).toBe(false);
    expect(batch.packetDiagnostics).toMatchObject({ addedCommonJsDependencyCount: 0,
      omittedCommonJsDependencyCount: expectedOmittedCount });
    expect(artifacts).toEqual(before);
  });

  it('rejects a TypeScript import-equals binding named require', () => {
    const source = item('lib/forms/formDataToJSON.ts',
      "import require = require('./replacement');\nvar utils = require('../utils');\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n");
    const target = dependency();
    const { batches } = plan(source, [target]);
    const batch = featureBatch(batches);

    expect(batch.sources.some(segment => segment.artifact.id === target.artifact.id && segment.content === target.content)).toBe(false);
    expect(batch.packetDiagnostics).toMatchObject({ addedCommonJsDependencyCount: 0, omittedCommonJsDependencyCount: 1 });
  });

  it.each([
    ['as assertion', "(eval as typeof eval)('utils = replacement');"],
    ['type assertion', "(<typeof eval>eval)('utils = replacement');"],
    ['non-null assertion', "(eval!)('utils = replacement');"],
    ['satisfies expression', "(eval satisfies typeof eval)('utils = replacement');"],
  ])('rejects eval wrapped in a TypeScript %s', (_wrapper, evalCall) => {
    const source = item('lib/forms/formDataToJSON.ts',
      `var utils = require('../utils');\n${evalCall}\nfunction formDataToJSON(input) { return utils.formDataToJSON(input); }\n`);
    const target = dependency();
    const { batches } = plan(source, [target]);
    const batch = featureBatch(batches);

    expect(batch.sources.some(segment => segment.artifact.id === target.artifact.id && segment.content === target.content)).toBe(false);
    expect(batch.packetDiagnostics).toMatchObject({ addedCommonJsDependencyCount: 0, omittedCommonJsDependencyCount: 1 });
  });

  it('stops after the bounded selected dependency candidate count and records skipped candidates', () => {
    const unavailableBindings = Array.from({ length: 128 }, (_, index) =>
      `var module${index} = require('external-${index}');`).join('\n');
    const selectedReads = Array.from({ length: 128 }, (_, index) => `module${index}.value;`).join(' ');
    const source = item('lib/forms/formDataToJSON.js',
      `${unavailableBindings}\nvar utils = require('../utils');\nfunction formDataToJSON(input) { ${selectedReads} return utils.formDataToJSON(input); }\n`);
    const target = dependency();
    const { batches } = plan(source, [target]);
    const batch = featureBatch(batches);

    expect(batch.sources.some(segment => segment.artifact.id === target.artifact.id && segment.content === target.content)).toBe(false);
    expect(batch.packetDiagnostics).toMatchObject({ addedCommonJsDependencyCount: 0, omittedCommonJsDependencyCount: 129 });
  });

  it('does not resolve a missing selected target or an ambiguous selected path', () => {
    const source = importer();
    const first = dependency('exports.first = true;');
    const second = item('lib/utils-copy.js', 'exports.second = true;');
    second.artifact.filePath = 'lib/utils.js';
    const before = structuredClone([source, first, second]);
    const missingImporter = item('lib/forms/formDataToJSON.js',
      "var utils = require('../missing');\nfunction formDataToJSON(input) { return utils.missing(input); }\n");
    const missing = plan(missingImporter, [first]);
    const ambiguous = plan(source, [first, second]);

    expect(featureBatch(missing.batches).sources.some(segment => segment.artifact.id === first.artifact.id)).toBe(false);
    expect(featureBatch(ambiguous.batches).sources.some(segment => [first.artifact.id, second.artifact.id].includes(segment.artifact.id))).toBe(false);
    expect(featureBatch(missing.batches).packetDiagnostics?.addedCommonJsDependencyCount).toBe(0);
    expect(featureBatch(ambiguous.batches).packetDiagnostics?.addedCommonJsDependencyCount).toBe(0);
    expect([source, first, second]).toEqual(before);
  });
});
