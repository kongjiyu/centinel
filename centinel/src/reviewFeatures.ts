import type { ReviewAnalysisMap } from './reviewHarness';
import type { Finding, ReviewTraceabilitySnapshot } from './types';

export type ReviewFeature = ReviewAnalysisMap['features'][number];

function operationWords(name: string): string {
  const words = name.split('.').at(-1)?.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || name;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function nestedOperation(label: string) {
  const match = /^(?:Internal operation (.+) called by |Callback operation (.+) registered within )(.+)$/.exec(label);
  return match ? { name: match[1] ?? match[2], caller: match[3] } : null;
}

export function featureDisplayName(label: string): string {
  const exported = /^Exported operation (.+)$/.exec(label);
  const nested = nestedOperation(label);
  if (exported) return operationWords(exported[1]);
  if (nested) return nested.name.startsWith('<anonymous@') ? operationWords(nested.caller) : operationWords(nested.name);
  return label;
}

export type ReviewFeatureGroup = { feature: ReviewFeature; operations: ReviewFeature[] };

/** Presentation projection only. Keep each original operation, path and evidence identity. */
export function groupReviewFeatures(map: ReviewAnalysisMap, findings: Finding[], traceability?: ReviewTraceabilitySnapshot | null): ReviewFeatureGroup[] {
  const requirements = traceability && new Set(traceability.status === 'available' ? traceability.records.map(record => record.requirementId) : []);
  const groups = new Map<string, ReviewFeatureGroup>();
  const parentsByCallable = new Map<string, ReviewFeatureGroup[]>();
  for (const feature of map.features) {
    if (nestedOperation(feature.label)) continue;
    const group = { feature, operations: [feature] };
    groups.set(feature.id, group);
    const callable = /^Exported operation (.+)$/.exec(feature.label)?.[1].split('.').at(-1);
    if (callable) parentsByCallable.set(callable, [...(parentsByCallable.get(callable) ?? []), group]);
  }
  for (const feature of map.features) {
    const nested = nestedOperation(feature.label);
    if (!nested) continue;
    const paths = new Set(feature.paths.map(path => path.id));
    const explicitlyRequired = findings.some(finding => {
      const analysis = finding.location?.sourceLocator?.analysis;
      return finding.requirementId && (!requirements || requirements.has(finding.requirementId)) && analysis?.featureId === feature.id && paths.has(analysis.pathId);
    });
    const action = operationWords(nested.name).toLowerCase();
    const businessAction = /^(?:add|remove|update|clear|empty) (?:.* )?cart$/.test(action)
      || /^(?:process|authorize|capture|confirm|cancel|refund|submit|make|charge) (?:.* )?(?:payment|refund|card)$/.test(action);
    if (explicitlyRequired || businessAction) {
      groups.set(feature.id, { feature, operations: [feature] });
      continue;
    }
    const possibleParents = (parentsByCallable.get(nested.caller.split('.').at(-1) ?? '') ?? []).filter(parent =>
      parent.feature.entryPoints.some(entry => feature.entryPoints.some(point =>
        point.artifactId === entry.artifactId && point.sourceVersion === entry.sourceVersion)));
    if (possibleParents.length === 1) {
      possibleParents[0].operations.push(feature);
    }
  }
  return map.features.flatMap(feature => {
    const group = groups.get(feature.id);
    return group ? [group] : [];
  });
}
