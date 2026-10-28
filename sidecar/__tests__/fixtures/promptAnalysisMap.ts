import type { ReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import type { StaticModelRequest } from '../../src/review/types.js';

/** Offline provider fixtures follow the prompt's reference-table instructions.
 * Production response parsing deliberately does not expand short links. */
export function readPromptAnalysisMap(request: Pick<StaticModelRequest, 'prompt'>): ReviewAnalysisMap {
  const text = request.prompt.split('Provisional feature/path map (bounded syntax evidence; coverage limits apply):\n')[1]
    .split('\n\nFrozen artifact content:')[0];
  const map = JSON.parse(text);
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      if (Object.keys(row).length === 1 && typeof row.evidenceRef === 'string') {
        const reference = map.evidenceReferenceTable?.[row.evidenceRef];
        if (!reference) throw new Error('Offline fixture encountered an unresolved prompt reference.');
        return reference;
      }
      return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, expand(item)]));
    }
    return value;
  };
  const { referenceEncoding: _encoding, evidenceReferenceTable: _table, ...body } = map;
  return expand(body) as ReviewAnalysisMap;
}
