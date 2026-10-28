import type { AnalysisEvidenceReference, ReviewAnalysisMap } from './featurePathAnalysis.js';
import type { StaticFindingInput } from './types.js';

/** Prompt-only projection. The canonical evidence/validation map is untouched.
 * Empty machine placeholders are shortened; repeated exact references use a
 * lossless table only when the complete encoded representation is smaller.
 * Model responses must still use the original full reference schema. */
export function compactAnalysisMapForPrompt(map: ReviewAnalysisMap): string {
  const projected = { ...map, features: map.features.map(feature => {
    const pending = feature.assessments.filter(item => item.status === 'unverified' && item.outcome === 'unverified'
      && item.summary === 'No domain assessment was returned for this feature.' && item.evidence.length === 0);
    if (!pending.length) return feature;
    const retained = feature.assessments.filter(item => !pending.includes(item));
    const { assessments: _assessments, ...rest } = feature;
    return { ...rest, ...(retained.length ? { assessments: retained } : {}), pendingDomains: pending.map(item => item.domain) };
  }) };
  const plain = JSON.stringify(projected);
  const evidenceReferenceTable: Record<string, AnalysisEvidenceReference> = {};
  const identities = new Map<string, string>();
  const encode = (references: AnalysisEvidenceReference[]) => references.map(reference => {
    // Include every property, including future additive fields. Property order
    // may differ without changing reference identity; no source fact is removed.
    const identity = JSON.stringify(Object.entries(reference).sort(([left], [right]) => left.localeCompare(right)));
    let key = identities.get(identity);
    if (!key) {
      key = `r${identities.size}`;
      identities.set(identity, key);
      evidenceReferenceTable[key] = { ...reference };
    }
    return { evidenceRef: key };
  });
  const encoded = JSON.stringify({ ...projected,
    referenceEncoding: 'evidence-table-v1: evidenceRef links resolve to exact full objects in evidenceReferenceTable. In responses, return full artifactId/filePath/lineNumber/sourceVersion reference objects copied from that table, never evidenceRef links.',
    evidenceReferenceTable,
    features: projected.features.map(feature => ({ ...feature,
      entryPoints: encode(feature.entryPoints),
      paths: feature.paths.map(path => ({ ...path, evidence: encode(path.evidence) })),
      unresolved: feature.unresolved.map(boundary => ({ ...boundary, evidence: encode(boundary.evidence) })),
      ...('assessments' in feature && feature.assessments
        ? { assessments: feature.assessments.map(assessment => ({ ...assessment, evidence: encode(assessment.evidence) })) }
        : {}),
    })),
  });
  return encoded.length < plain.length ? encoded : plain;
}

/** Deterministic occurrences remain persisted in full. A batch only needs the
 * duplicate-avoidance facts that touch its source packet. Unknown scope stays. */
export function deterministicFactsForPacket(findings: StaticFindingInput[], filePaths: Set<string>): StaticFindingInput[] {
  return findings.filter(finding => !finding.filePath || filePaths.has(finding.filePath)
    || finding.relatedLocations?.some(location => filePaths.has(location.filePath)));
}
