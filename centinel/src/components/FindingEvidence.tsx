import { useEffect, useRef, useState } from 'react';
import type { Finding, FindingSourceReference } from '../types';
import { findingSourceReferences, groupStatus, type FindingGroup } from '../findingGroups';
import { effectiveFindingStatus } from '../findingStatus';
import { api } from '../api/client';
import { userFacingError } from '../utils/userFacingError';
import './FindingEvidence.css';

const MAX_EVIDENCE_REFERENCES = 17;
const MAX_EVIDENCE_CANDIDATES = 51;
const MAX_CANDIDATES_PER_REFERENCE = 3;

type EvidenceConfidence = 'high' | 'medium' | 'low';
type EvidenceCandidate = {
  artifactId: string;
  sourceVersion: string;
  filePath: string;
  lineNumber: number;
  excerpt: string;
  score: number;
  confidence: EvidenceConfidence;
  match: 'exact' | 'relocated_exact' | 'approximate';
  referenceIndex: number;
};
type CitationEvidence = {
  verification: 'verified' | 'needs_verification';
  reason: 'source_match' | 'support_unverified';
  candidates: EvidenceCandidate[];
  unmatchedReferences: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function evidenceConfidence(score: number): EvidenceConfidence {
  return score >= 90 ? 'high' : score >= 60 ? 'medium' : 'low';
}

/** Validate persisted v1 metadata and recompute confidence from the bounded score. */
function readCitationEvidence(value: unknown): CitationEvidence | null {
  if (!isRecord(value) || value.version !== 1
    || (value.verification !== 'verified' && value.verification !== 'needs_verification')
    || (value.reason !== 'source_match' && value.reason !== 'support_unverified')
    || !Array.isArray(value.candidates) || value.candidates.length > MAX_EVIDENCE_CANDIDATES
    || !boundedInteger(value.unmatchedReferences, 0, MAX_EVIDENCE_REFERENCES)) return null;

  const candidates: EvidenceCandidate[] = [];
  const counts = new Map<number, number>();
  for (const raw of value.candidates) {
    if (!isRecord(raw)
      || !boundedText(raw.artifactId, 200)
      || !boundedText(raw.sourceVersion, 200)
      || !boundedText(raw.filePath, 2_000)
      || !boundedInteger(raw.lineNumber, 1, 2_147_483_647)
      || !boundedText(raw.excerpt, 2_000)
      || !boundedInteger(raw.score, 0, 100)
      || (raw.confidence !== 'high' && raw.confidence !== 'medium' && raw.confidence !== 'low')
      || (raw.match !== 'exact' && raw.match !== 'relocated_exact' && raw.match !== 'approximate')
      || !boundedInteger(raw.referenceIndex, 0, MAX_EVIDENCE_REFERENCES - 1)) return null;

    // The v1 producer has fixed score bands for its match types. Reject inconsistent
    // persisted rows instead of presenting a forged exact or relocated match.
    if ((raw.match === 'exact' && raw.score !== 100)
      || (raw.match === 'relocated_exact' && raw.score !== 80 && raw.score !== 95)
      || (raw.match === 'approximate' && (raw.score < 20 || raw.score > 85))) return null;

    const count = (counts.get(raw.referenceIndex) ?? 0) + 1;
    if (count > MAX_CANDIDATES_PER_REFERENCE) return null;
    counts.set(raw.referenceIndex, count);
    candidates.push({
      artifactId: raw.artifactId,
      sourceVersion: raw.sourceVersion,
      filePath: raw.filePath,
      lineNumber: raw.lineNumber,
      excerpt: raw.excerpt,
      score: raw.score,
      confidence: evidenceConfidence(raw.score),
      match: raw.match,
      referenceIndex: raw.referenceIndex,
    });
  }

  const representedReferences = counts.size;
  const inferredReferenceCount = representedReferences + value.unmatchedReferences;
  const highestReferenceIndex = counts.size ? Math.max(...counts.keys()) : -1;
  if (inferredReferenceCount > MAX_EVIDENCE_REFERENCES
    || inferredReferenceCount < highestReferenceIndex + 1) return null;

  // A stored "verified" label is accepted only if every represented reference has
  // a strong top match and no reference is missing. It still means location match,
  // never that the excerpt proves the finding.
  if (value.verification === 'verified'
    && (value.reason !== 'source_match' || value.unmatchedReferences !== 0 || !counts.size
      || [...counts.keys()].some(referenceIndex => candidates
        .filter(candidate => candidate.referenceIndex === referenceIndex)
        .sort((left, right) => right.score - left.score)[0]?.score < 90))) return null;
  if (value.reason === 'support_unverified' && value.verification !== 'needs_verification') return null;

  return {
    verification: value.verification,
    reason: value.reason,
    candidates,
    unmatchedReferences: value.unmatchedReferences,
  };
}

function groupCandidates(candidates: EvidenceCandidate[]): Array<{ referenceIndex: number; candidates: EvidenceCandidate[] }> {
  const groups = new Map<number, EvidenceCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.referenceIndex) ?? [];
    group.push(candidate);
    groups.set(candidate.referenceIndex, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([referenceIndex, items]) => ({
    referenceIndex,
    candidates: items.sort((left, right) => right.score - left.score
      || left.filePath.localeCompare(right.filePath) || left.lineNumber - right.lineNumber),
  }));
}

function matchLabel(match: EvidenceCandidate['match']): string {
  if (match === 'relocated_exact') return 'Exact text at another location';
  if (match === 'approximate') return 'Approximate text match';
  return 'Exact source location';
}

export function FindingOccurrences({ group, selectedId, onSelect }: { group: FindingGroup; selectedId: string; onSelect: (id: string) => void }) {
  if (group.members.length < 2) return null;
  return <section className="finding-occurrences" aria-label="Affected occurrences">
    <h5>{group.members.length} affected occurrences</h5><p>{groupStatus(group)} · Select a location to inspect its evidence and update that occurrence.</p>
    <ul>{group.members.map(item => <li key={item.id}><button type="button" aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)}>
      <strong>{item.filePath ? `${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ''}` : item.requirementId ? `Requirement ${item.requirementId}` : item.title}</strong>
      <span>{item.severity} · {effectiveFindingStatus(item)} · {item.title}</span>
    </button></li>)}</ul>
  </section>;
}

export function FindingEvidence({ finding, headingLevel = 5 }: { finding: Finding; headingLevel?: 4 | 5 }) {
  const Heading = headingLevel === 4 ? 'h4' : 'h5';
  const SectionHeading = headingLevel === 4 ? 'h5' : 'h6';
  const refs = findingSourceReferences(finding);
  const citationEvidence = readCitationEvidence(finding.location?.sourceLocator?.citationEvidence);
  const citationGroups = citationEvidence ? groupCandidates(citationEvidence.candidates) : [];
  const remainingRefs = refs.filter(ref => !citationEvidence?.candidates.some(candidate =>
    candidate.artifactId === ref.artifactId && candidate.sourceVersion === ref.sourceVersion
    && candidate.filePath === ref.filePath && candidate.lineNumber === ref.lineNumber && candidate.excerpt === ref.excerpt));
  const sequence = useRef(0);
  const [preview, setPreview] = useState<{ key: string; text?: string; error?: string; loading?: boolean } | null>(null);
  useEffect(() => { sequence.current++; setPreview(null); return () => { sequence.current++; }; }, [finding.id]);
  const reviewId = finding.latestOccurrence?.reviewId || finding.sessionId;
  const load = async (ref: FindingSourceReference, key: string) => {
    if (!ref.artifactId || !reviewId) return;
    const request = ++sequence.current;
    setPreview({ key, loading: true });
    try {
      const result = await api.getReviewArtifactContent(finding.projectId, reviewId, ref.artifactId);
      if (sequence.current !== request) return;
      const normalized = (value: string) => value.replace(/^sha256:/i, '').toLowerCase();
      if (ref.sourceVersion && normalized(ref.sourceVersion) !== normalized(result.versionId) && normalized(ref.sourceVersion) !== normalized(result.contentHash)) {
        setPreview({ key, error: 'The saved reference version does not match this Review’s source version. Only the recorded excerpt can be shown.' }); return;
      }
      if (result.mimeType && !result.mimeType.startsWith('text/') && !/json|xml|javascript/.test(result.mimeType) && !/\.(md|txt|js|ts|jsx|tsx|mjs|cjs|cs|py|java|go|rb|rs|php|json|ya?ml|xml|html|css|toml|ini)$/i.test(ref.filePath)) {
        setPreview({ key, error: 'This file format has no text preview. The saved evidence above remains available.' }); return;
      }
      const text = new TextDecoder().decode(Uint8Array.from(atob(result.content), char => char.charCodeAt(0)));
      setPreview({ key, text });
    } catch (error) {
      if (sequence.current === request) setPreview({ key, error: userFacingError(error, 'The reviewed source is unavailable. Current source content has not been substituted.') });
    }
  };
  const renderPreview = (key: string, filePath: string) => preview?.key === key && <div>
    {preview.error ? <p role="alert">{preview.error}</p> : preview.text !== undefined
      ? <pre className="finding-source-preview" tabIndex={0} aria-label={`Reviewed source ${filePath}`}><code>{preview.text || 'This file is empty.'}</code></pre>
      : null}
  </div>;
  const renderCandidate = (candidate: EvidenceCandidate, isBest: boolean) => {
    const key = `${finding.id}:candidate:${candidate.referenceIndex}:${candidate.artifactId}:${candidate.sourceVersion}:${candidate.lineNumber}`;
    const reference: FindingSourceReference = {
      artifactId: candidate.artifactId,
      filePath: candidate.filePath,
      lineNumber: candidate.lineNumber,
      sourceVersion: candidate.sourceVersion,
      excerpt: candidate.excerpt,
      relation: 'code',
    };
    return <article className={`finding-evidence-candidate${isBest ? ' is-best' : ''}`} key={key}>
      <div className="finding-evidence-candidate-heading">
        <strong>{candidate.filePath}:{candidate.lineNumber}</strong>
        {isBest && <span className="finding-evidence-best-label">Best source match</span>}
      </div>
      <div className="finding-evidence-match-meta">
        <span className={`finding-evidence-confidence is-${candidate.confidence}`}>{candidate.confidence[0].toUpperCase() + candidate.confidence.slice(1)} match strength</span>
        <span>{candidate.score}% match</span>
        <span>{matchLabel(candidate.match)}</span>
      </div>
      <p>Version: <code>{candidate.sourceVersion}</code></p>
      <pre aria-label={`Candidate excerpt from ${candidate.filePath}:${candidate.lineNumber}`}>{candidate.excerpt}</pre>
      {reviewId && finding.verifier !== 'readiness' && <button type="button" className="btn-secondary" aria-label={`View reviewed source ${candidate.filePath}:${candidate.lineNumber}`} disabled={preview?.key === key && preview.loading} onClick={() => void load(reference, key)}>{preview?.key === key && preview.loading ? 'Loading reviewed source…' : 'View reviewed source'}</button>}
      {renderPreview(key, `${candidate.filePath}:${candidate.lineNumber}`)}
    </article>;
  };

  return <section className="finding-related-sources" aria-label="Related sources">
    <Heading>Related sources</Heading>
    {finding.requirementId && <p>Requirement: <code>{finding.requirementId}</code></p>}
    {citationEvidence && <section className="finding-citation-evidence" aria-label="Source match evidence" data-verification={citationEvidence.verification}>
      <SectionHeading>Source match evidence</SectionHeading>
      <p className="finding-citation-status"><strong>{citationEvidence.verification === 'verified'
        ? 'Source location match verified'
        : citationEvidence.reason === 'support_unverified'
          ? 'Support for the finding needs verification'
          : 'Source location needs verification'}</strong></p>
      <p>Match strength shows how closely the excerpt matches a source location. It does not measure whether the finding is correct; check that the excerpt supports the finding.</p>
      {citationEvidence.unmatchedReferences > 0 && <p>{citationEvidence.unmatchedReferences} cited {citationEvidence.unmatchedReferences === 1 ? 'reference has' : 'references have'} no candidate source match.</p>}
      {citationGroups.length === 0
        ? <p>No candidate source matches are available. The recorded evidence below remains unchanged.</p>
        : <ol className="finding-citation-groups">{citationGroups.map(group => {
          const [best, ...others] = group.candidates;
          return <li key={group.referenceIndex}>
            <p className="finding-citation-reference-label"><strong>Reference {group.referenceIndex + 1}</strong></p>
            {renderCandidate(best, true)}
            {others.length > 0 && <details>
              <summary>Other candidates ({others.length})</summary>
              <div className="finding-citation-alternatives">{others.map(candidate => renderCandidate(candidate, false))}</div>
            </details>}
          </li>;
        })}</ol>}
    </section>}
    {!refs.length && <p>No exact source location was recorded for this finding. Related code has not been inferred.</p>}
    {remainingRefs.length > 0 && <ul>{remainingRefs.map((ref, index) => {
      const key = `${finding.id}:${index}`;
      return <li key={index}>
        <strong>{ref.relation === 'code' ? 'Code' : ref.relation === 'requirement' ? 'Requirement source' : 'Document'}: <span>{ref.filePath || 'Path unavailable'}{ref.lineNumber ? `:${ref.lineNumber}` : ''}</span></strong>
        <p>{ref.sourceVersion ? <>Version: <code>{ref.sourceVersion}</code></> : 'Source version not supplied.'}</p>
        {ref.excerpt && <pre aria-label={`Saved excerpt from ${ref.filePath}`}>{ref.excerpt}</pre>}
        {ref.artifactId && reviewId && finding.verifier !== 'readiness' && <button type="button" className="btn-secondary" disabled={preview?.key === key && preview.loading} onClick={() => void load(ref, key)}>{preview?.key === key && preview.loading ? 'Loading reviewed source…' : 'View reviewed source'}</button>}
        {renderPreview(key, ref.filePath)}
      </li>;
    })}</ul>}
  </section>;
}
