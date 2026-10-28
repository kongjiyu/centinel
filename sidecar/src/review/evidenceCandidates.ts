import type { AssessmentSourceSegment } from './assessmentBatches.js';
import type { StaticFindingInput } from './types.js';
import { findingFingerprint } from './findings.js';

export type EvidenceMatchCandidate = {
  artifactId: string; sourceVersion: string; filePath: string; lineNumber: number;
  excerpt: string; score: number; confidence: 'high' | 'medium' | 'low';
  match: 'exact' | 'relocated_exact' | 'approximate'; referenceIndex: number;
};
export type CitationEvidence = {
  version: 1; verification: 'verified' | 'needs_verification';
  reason: 'source_match' | 'support_unverified'; candidates: EvidenceMatchCandidate[];
  unmatchedReferences: number;
};
export const evidenceConfidence = (score: number): EvidenceMatchCandidate['confidence'] => score >= 90 ? 'high' : score >= 60 ? 'medium' : 'low';
const normalized = (value: string) => value.replace(/\r\n/g, '\n');
const tokens = (value: string) => new Set(value.match(/[A-Za-z_$][\w$]*|\d+|[^\s\w]/g) ?? []);
const path = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');

/** Match strength, not calibrated probability or semantic support. All displayed
 * excerpts are copied from this frozen packet; fuzzy matches never become proof.
 */
export function rankEvidenceCandidates(reference: { filePath: string; artifactId?: string | null; sourceVersion?: string | null; lineNumber?: number | null; evidence: string },
  sources: readonly AssessmentSourceSegment[], referenceIndex = 0): EvidenceMatchCandidate[] {
  const quote = normalized(reference.evidence).trim();
  if (!quote || quote.length > 2_000) return [];
  const wanted = tokens(quote);
  const lineCount = Math.min(8, quote.split('\n').length);
  const exactLineCount = quote.split('\n').length;
  const candidates: EvidenceMatchCandidate[] = [];
  const identities = new Set<string>();
  let inspectedCharacters = 0;
  let truncated = false;
  let relocatedCount = 0;
  for (const source of sources) {
    if (typeof source.content !== 'string' || source.state && source.state !== 'available' || !source.artifact.contentHash) continue;
    // Production packets are already bounded. Also bound this trust boundary
    // independently, including memory retained for repetitive/minified inputs.
    if (inspectedCharacters + source.content.length > 256_000) { truncated = true; continue; }
    inspectedCharacters += source.content.length;
    const lines = normalized(source.content).split('\n');
    for (let offset = 0; offset < lines.length; offset++) {
      const lineNumber = source.lineStart + offset;
      if (lineNumber > source.lineEnd) break;
      const window = lines.slice(offset, Math.min(lines.length, offset + lineCount, source.lineEnd - source.lineStart + 1)).join('\n');
      if (!window.trim() || window.length > 2_000) continue;
      const exact = lines.slice(offset, Math.min(lines.length, offset + exactLineCount, source.lineEnd - source.lineStart + 1)).join('\n').includes(quote);
      const samePath = path(source.artifact.filePath) === path(reference.filePath);
      const sameIdentity = samePath && (!reference.artifactId || reference.artifactId === source.artifact.id)
        && (!reference.sourceVersion || reference.sourceVersion === source.artifact.contentHash || reference.sourceVersion === source.artifact.versionId);
      let score: number;
      if (exact) score = sameIdentity ? lineNumber === reference.lineNumber ? 100 : 95 : 80;
      else {
        const actual = tokens(window);
        let common = 0; for (const token of wanted) if (actual.has(token)) common++;
        score = Math.min(85, Math.round(85 * 2 * common / Math.max(1, wanted.size + actual.size)));
      }
      if (score < 20) continue;
      const candidate: EvidenceMatchCandidate = { artifactId: source.artifact.id, sourceVersion: source.artifact.contentHash, filePath: source.artifact.filePath,
        lineNumber, excerpt: exact ? quote : window, score, confidence: evidenceConfidence(score),
        match: exact ? lineNumber === reference.lineNumber && sameIdentity ? 'exact' : 'relocated_exact' : 'approximate', referenceIndex };
      const identity = JSON.stringify([candidate.artifactId, candidate.sourceVersion, lineNumber, candidate.excerpt]);
      if (identities.has(identity)) continue;
      // Only exact matches need global ambiguity counting. The retained best
      // candidates remain bounded even if thousands of fuzzy windows match.
      if (score === 95) { identities.add(identity); relocatedCount++; }
      candidates.push(candidate);
      candidates.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber);
      if (candidates.length > 6) candidates.length = 6;
    }
  }
  // A relocated repeated quotation does not identify one location unambiguously.
  const relocated = candidates.filter(item => item.score === 95);
  if ((relocatedCount > 1 || truncated) && !candidates.some(item => item.score === 100)) for (const item of relocated) {
    item.score = 80; item.confidence = 'medium';
  }
  candidates.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber);
  return [...new Map(candidates.map(item => [JSON.stringify([item.artifactId, item.sourceVersion, item.lineNumber, item.excerpt]), item])).values()].slice(0, 3);
}

export function withCitationEvidence(finding: StaticFindingInput, sources: readonly AssessmentSourceSegment[], forceUnverified = false): StaticFindingInput {
  const references = [{ ...finding }, ...(finding.relatedLocations ?? [])];
  const groups = references.map((reference, index) => rankEvidenceCandidates(reference, sources, index));
  const verified = !forceUnverified && groups.every(group => group[0]?.score >= 90);
  const main = groups[0]?.[0];
  const info: CitationEvidence = { version: 1, verification: verified ? 'verified' : 'needs_verification',
    reason: forceUnverified ? 'support_unverified' : 'source_match', candidates: groups.flat(), unmatchedReferences: groups.filter(group => !group.length).length };
  const result: StaticFindingInput = { ...finding, ...(main ? { artifactId: main.artifactId, filePath: main.filePath, lineNumber: main.lineNumber,
    sourceVersion: main.sourceVersion, evidence: main.excerpt } : { evidence: '', lineNumber: null }),
    relatedLocations: groups.slice(1).flatMap(group => group[0] ? [{ artifactId: group[0].artifactId, filePath: group[0].filePath,
      sourceVersion: group[0].sourceVersion, lineNumber: group[0].lineNumber, evidence: group[0].excerpt }] : []),
    sourceLocator: { ...finding.sourceLocator, citationEvidence: info } };
  result.fingerprint = findingFingerprint(result);
  return result;
}

export function needsCitationVerification(finding: StaticFindingInput): boolean {
  return (finding.sourceLocator?.citationEvidence as CitationEvidence | undefined)?.verification === 'needs_verification';
}
