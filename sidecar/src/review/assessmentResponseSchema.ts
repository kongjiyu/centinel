import type { AnalysisEvidenceReference, ReviewAnalysisMap } from './featurePathAnalysis.js';
import type { AssessmentSourceSegment } from './assessmentBatches.js';

type Schema = Record<string, any>;
const object = (properties: Schema): Schema => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
});
const literal = (value: string | number | null): Schema => ({
  type: value === null ? 'null' : typeof value === 'number' ? 'integer' : 'string', enum: [value],
});

/** Count the entire emitted schema, including definitions, before choosing the specialization.
 * Leave headroom below provider limits; an oversized map never loses source/context to fit.
 */
function withinBudget(schema: Schema): boolean {
  let properties = 0, enums = 0, strings = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const node = value as Schema;
    if (node.properties) {
      properties += Object.keys(node.properties).length;
      strings += Object.keys(node.properties).reduce((sum, key) => sum + key.length, 0);
    }
    if (Array.isArray(node.enum)) {
      enums += node.enum.length;
      strings += node.enum.reduce((sum: number, item: unknown) => sum + (typeof item === 'string' ? item.length : 0), 0);
    }
    if (node.$defs) strings += Object.keys(node.$defs).reduce((sum, key) => sum + key.length, 0);
    for (const child of Object.values(node)) visit(child);
  };
  visit(schema);
  // The fixed response shape has four object levels, including referenced objects.
  return properties <= 4_500 && enums <= 900 && strings <= 100_000;
}

function assessmentRows(row: Schema, evidence: Schema, canAssess = true): Schema {
  const common = {
    domain: structuredClone(row.properties.domain),
    summary: structuredClone(row.properties.summary),
  };
  const unverified = object({ ...common, status: literal('unverified'), outcome: literal('unverified'), evidence });
  return { anyOf: [
    ...(canAssess ? [object({
      ...common, status: literal('assessed'),
      outcome: { type: 'string', enum: ['potential_gap', 'no_issue_identified', 'not_applicable'] },
      evidence: { ...evidence, minItems: 1 },
    })] : []),
    unverified,
  ] };
}

/** Generation guidance only. Canonical, actual-packet and semantic validators remain authoritative.
 * Exact reference tuples avoid mixed artifact/path/version/line combinations. No short-ID response
 * decoder or evidence synthesis is introduced; the response wire format stays unchanged.
 */
export function specializeAssessmentSchema(base: Schema, map: ReviewAnalysisMap, options: { exactReferences?: boolean } = {}): Schema {
  const fallback = structuredClone(base);
  const rows = fallback.properties.featureAssessments;
  rows.minItems = rows.maxItems = map.features.length;
  if (!map.features.length) return fallback;
  const assessment = rows.items.properties.assessments.items;
  rows.items.properties.assessments.items = assessmentRows(assessment, structuredClone(assessment.properties.evidence));
  const bounded = structuredClone(fallback);
  bounded.properties.featureAssessments.items.properties.featureId.enum = map.features.map(feature => feature.id);
  if (withinBudget(bounded)) Object.assign(fallback, bounded);
  if (!options.exactReferences) return fallback;

  const exact = structuredClone(fallback);
  const definitions: Schema = {};
  const identities = new Map<string, string>();
  const alternatives: Schema[] = [];
  for (const feature of map.features) {
    const known = new Map<string, AnalysisEvidenceReference>();
    for (const ref of [...feature.entryPoints, ...feature.paths.flatMap(path => path.evidence)]) {
      const tuple = JSON.stringify([ref.artifactId, ref.filePath, ref.sourceVersion, ref.lineNumber]);
      known.set(tuple, ref);
    }
    const references = [...known].map(([tuple, ref]) => {
      let name = identities.get(tuple);
      if (!name) {
        name = `r${identities.size}`;
        identities.set(tuple, name);
        definitions[name] = object({ artifactId: literal(ref.artifactId), filePath: literal(ref.filePath),
          lineNumber: literal(ref.lineNumber), sourceVersion: literal(ref.sourceVersion) });
      }
      return { $ref: `#/$defs/${name}` };
    });
    const evidence: Schema = references.length
      ? { type: 'array', items: { anyOf: references } }
      : { ...structuredClone(assessment.properties.evidence), maxItems: 0 };
    alternatives.push(object({
      featureId: literal(feature.id), assessments: { type: 'array', minItems: 4, maxItems: 4,
        items: assessmentRows(assessment, evidence, references.length > 0 && feature.entryPointStatus !== 'unresolved') },
    }));
    // Bound construction as well as the final response size. Fall back atomically;
    // never retain only the first features or a partial reference allowlist.
    if (identities.size > 200 || alternatives.length > 64) return fallback;
  }
  if (Object.keys(definitions).length) exact.$defs = definitions;
  exact.properties.featureAssessments.items = { anyOf: alternatives };
  return withinBudget(exact) ? exact : fallback;
}

/** Tighten repair guidance to the supplied frozen identity/range combinations.
 * Excerpts and semantic dispositions still require unchanged runtime validation.
 */
export function specializeSupportSchema(base: Schema, sources: readonly AssessmentSourceSegment[]): Schema {
  const fallback = structuredClone(base);
  if (!sources.length || sources.length > 64) return fallback;
  const exact = structuredClone(base);
  const reference = exact.properties.candidates.items.properties.references.items;
  const alternatives = sources.map(source => object({
    role: structuredClone(reference.properties.role),
    artifactId: literal(source.artifact.id), filePath: literal(source.artifact.filePath),
    sourceVersion: literal(source.artifact.contentHash),
    lineNumber: { type: 'integer', minimum: source.lineStart, maximum: source.lineEnd },
    evidence: { ...structuredClone(reference.properties.evidence), minLength: 1 },
  }));
  exact.properties.candidates.items.properties.references.items = { anyOf: alternatives };
  return withinBudget(exact) ? exact : fallback;
}
