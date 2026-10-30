import { createPortal } from 'react-dom';
import { displayPath } from '../utils/displayPath';
import { useCallback, useEffect, useRef, useState } from 'react';
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
      <strong>{item.filePath ? `${displayPath(item.filePath)}${item.lineNumber ? `:${item.lineNumber}` : ''}` : item.requirementId ? `Requirement ${item.requirementId}` : item.title}</strong>
      <span>{item.severity} · {effectiveFindingStatus(item)} · {item.title}</span>
    </button></li>)}</ul>
  </section>;
}

type SavedSource = { text: string; error?: string };
type PreviewPosition = { left: number; top: number; width: number; height: number };
type PreviewState = { key: string; ref: FindingSourceReference; position: PreviewPosition; text?: string; error?: string; loading?: boolean; uncertain?: boolean };

function sourceLines(text: string, ref: FindingSourceReference): { lines: string[]; targetLine: number | null; rangeEnd: number | null } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!ref.lineNumber || ref.lineNumber < 1 || ref.lineNumber > lines.length) return { lines, targetLine: null, rangeEnd: null };
  const targetLine = ref.lineNumber;
  const excerptLines = ref.excerpt?.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean) ?? [];
  if (!excerptLines.length) return { lines, targetLine, rangeEnd: targetLine };
  const first = lines[targetLine - 1]?.trim();
  if (first !== excerptLines[0]) return { lines, targetLine, rangeEnd: targetLine };
  const exactRange = excerptLines.every((line, index) => lines[targetLine - 1 + index]?.trim() === line);
  return { lines, targetLine, rangeEnd: exactRange ? targetLine + excerptLines.length - 1 : targetLine };
}

export function SourceCode({ text, sourceRef, preview = false, uncertain = false, onOpen }: {
  text: string; sourceRef: FindingSourceReference; preview?: boolean; uncertain?: boolean; onOpen?: () => void;
}) {
  const container = useRef<HTMLPreElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const { lines, targetLine, rangeEnd } = sourceLines(text, sourceRef);
  const displayStart = preview && targetLine ? Math.max(1, targetLine - 36) : 1;
  const displayEnd = preview && targetLine ? Math.min(lines.length, Math.max(rangeEnd ?? targetLine, targetLine) + 36) : preview ? Math.min(lines.length, 80) : lines.length;

  useEffect(() => {
    if (!targetLine || !container.current) return;
    const scrollArea = container.current;
    const target = scrollArea.querySelector<HTMLElement>('[data-preview-location="true"]');
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const containerRect = scrollArea.getBoundingClientRect();
    scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop + targetRect.top - containerRect.top - scrollArea.clientHeight / 2 + targetRect.height / 2);
  }, [preview, targetLine, rangeEnd, text]);

  const openFromClick = (event: React.MouseEvent<HTMLPreElement>) => {
    if (!onOpen || moved.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width > 0 && event.clientX >= bounds.right - 18) return;
    if (window.getSelection()?.toString()) return;
    onOpen();
  };
  const startPointer = (x: number, y: number) => { pointerStart.current = { x, y }; moved.current = false; };
  const trackPointer = (x: number, y: number) => {
    if (pointerStart.current && (Math.abs(x - pointerStart.current.x) > 5 || Math.abs(y - pointerStart.current.y) > 5)) moved.current = true;
  };
  const endPointer = () => {
    if (moved.current) window.setTimeout(() => { moved.current = false; pointerStart.current = null; }, 0);
    else pointerStart.current = null;
  };

  return <pre ref={container} role="region" className={preview ? 'finding-source-preview-body' : 'finding-source-reader-body'} tabIndex={0}
    aria-label={`${preview ? 'Reviewed source preview' : 'Reviewed source'} ${sourceRef.filePath || 'file'}`}
    onPointerDown={event => startPointer(event.clientX, event.clientY)} onMouseDown={event => startPointer(event.clientX, event.clientY)}
    onPointerMove={event => trackPointer(event.clientX, event.clientY)} onMouseMove={event => trackPointer(event.clientX, event.clientY)}
    onPointerUp={endPointer} onMouseUp={endPointer}
    onClick={preview ? openFromClick : undefined}
    onKeyDown={preview && onOpen ? event => { if (event.key === 'Enter' && !window.getSelection()?.toString()) { event.preventDefault(); onOpen(); } } : undefined}>
    <code>{lines.slice(displayStart - 1, displayEnd).map((line, index) => {
      const lineNumber = displayStart + index;
      const highlighted = targetLine !== null && rangeEnd !== null && lineNumber >= targetLine && lineNumber <= rangeEnd;
      return <span className={`finding-source-line${highlighted ? ' is-highlighted' : ''}${highlighted && uncertain ? ' is-uncertain' : ''}`} data-line={lineNumber} data-preview-location={lineNumber === targetLine ? 'true' : undefined} key={lineNumber}>
        <span className="finding-source-line-number" aria-label={`Line ${lineNumber}`}>{lineNumber}</span><span className="finding-source-line-content">{line || ' '}</span>
      </span>;
    })}</code>
    {preview && displayStart > 1 && <span className="finding-source-range-note">Earlier lines are above.</span>}
    {preview && displayEnd < lines.length && <span className="finding-source-range-note">More lines are below.</span>}
  </pre>;
}

export function FindingEvidence({ finding, headingLevel = 5, onOpenSource }: { finding: Finding; headingLevel?: 4 | 5; onOpenSource?: (ref: FindingSourceReference, text: string, uncertain?: boolean) => void }) {
  const Heading = headingLevel === 4 ? 'h4' : 'h5';
  const SectionHeading = headingLevel === 4 ? 'h5' : 'h6';
  const refs = findingSourceReferences(finding);
  const citationEvidence = readCitationEvidence(finding.location?.sourceLocator?.citationEvidence);
  const citationGroups = citationEvidence ? groupCandidates(citationEvidence.candidates) : [];
  const remainingRefs = refs.filter(ref => !citationEvidence?.candidates.some(candidate =>
    candidate.artifactId === ref.artifactId && candidate.sourceVersion === ref.sourceVersion
    && candidate.filePath === ref.filePath && candidate.lineNumber === ref.lineNumber && candidate.excerpt === ref.excerpt));
  const sequence = useRef(0);
  const cache = useRef(new Map<string, SavedSource>());
  const inFlight = useRef(new Map<string, Promise<SavedSource>>());
  const closeTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const suppressTriggerFocus = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  useEffect(() => { sequence.current++; setPreview(null); return () => { sequence.current++; if (closeTimer.current) window.clearTimeout(closeTimer.current); }; }, [finding.id]);
  const reviewId = finding.latestOccurrence?.reviewId || finding.sessionId;
  const getSavedSource = useCallback(async (ref: FindingSourceReference, key: string): Promise<SavedSource> => {
    const cached = cache.current.get(key);
    if (cached) return cached;
    const pending = inFlight.current.get(key);
    if (pending) return pending;
    const request = (async (): Promise<SavedSource> => {
      if (!ref.artifactId || !reviewId) return { text: '', error: 'The Review and artifact identity needed to open this saved source were not recorded.' };
      try {
        const result = await api.getReviewArtifactContent(finding.projectId, reviewId, ref.artifactId);
        const normalized = (value: string) => value.replace(/^sha256:/i, '').toLowerCase();
        if (ref.sourceVersion && normalized(ref.sourceVersion) !== normalized(result.versionId) && normalized(ref.sourceVersion) !== normalized(result.contentHash)) {
          return { text: '', error: 'The saved reference version does not match this Review’s source version. Only the recorded excerpt can be shown.' };
        }
        if (result.mimeType && !result.mimeType.startsWith('text/') && !/json|xml|javascript/.test(result.mimeType) && !/\.(md|txt|js|ts|jsx|tsx|mjs|cjs|cs|py|java|go|rb|rs|php|json|ya?ml|xml|html|css|toml|ini)$/i.test(ref.filePath)) {
          return { text: '', error: 'This file format has no text preview. The saved evidence above remains available.' };
        }
        const text = result.textContent ?? new TextDecoder().decode(Uint8Array.from(atob(result.content), char => char.charCodeAt(0)));
        return { text };
      } catch (error) {
        return { text: '', error: userFacingError(error, 'The reviewed source is unavailable. Current source content has not been substituted.') };
      }
    })();
    inFlight.current.set(key, request);
    const result = await request;
    inFlight.current.delete(key);
    if (!result.error) cache.current.set(key, result);
    return result;
  }, [finding.projectId, reviewId]);
  const positionPopover = (anchor: HTMLElement): PreviewPosition => {
    const margin = 12;
    const width = Math.max(240, Math.min(760, window.innerWidth - margin * 2));
    const rect = anchor.getBoundingClientRect();
    const belowSpace = window.innerHeight - rect.bottom - margin - 8;
    const aboveSpace = rect.top - margin - 8;
    const placeBelow = belowSpace >= aboveSpace;
    const availableHeight = Math.max(160, placeBelow ? belowSpace : aboveSpace);
    const height = Math.min(560, availableHeight);
    const top = Math.max(margin, Math.min(placeBelow ? rect.bottom + 8 : rect.top - height - 8, window.innerHeight - height - margin));
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    return { left, top, width, height };
  };
  useEffect(() => {
    if (!preview) return;
    const reposition = () => {
      const anchor = triggerRef.current;
      if (anchor) setPreview(current => current ? { ...current, position: positionPopover(anchor) } : current);
    };
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [preview?.key]);
  const closePreview = () => setPreview(null);
  const restoreTriggerFocus = () => {
    suppressTriggerFocus.current = true;
    triggerRef.current?.focus();
    window.setTimeout(() => { suppressTriggerFocus.current = false; }, 0);
  };
  const deferClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      if ((triggerRef.current && active === triggerRef.current) || (popoverRef.current && active && popoverRef.current.contains(active))) return;
      closePreview();
    }, 180);
  };
  const showPreview = async (ref: FindingSourceReference, key: string, anchor: HTMLElement, uncertain = false) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    triggerRef.current = anchor;
    const position = positionPopover(anchor);
    const cached = cache.current.get(key);
    const sequenceId = ++sequence.current;
    setPreview({ key, ref, position, ...(cached ? cached : { loading: true }), uncertain });
    const result = cached ?? await getSavedSource(ref, key);
    if (sequence.current !== sequenceId) return;
    setPreview(current => current?.key === key ? { ...current, ...result, loading: false } : current);
  };
  const trigger = (ref: FindingSourceReference, key: string, label: string, uncertain = false) => <button type="button" className="finding-source-trigger"
    aria-label={`Preview reviewed source ${label}`} aria-haspopup="dialog" aria-expanded={preview?.key === key}
    onMouseEnter={event => void showPreview(ref, key, event.currentTarget, uncertain)}
    onMouseLeave={deferClose}
    onFocus={event => { if (!suppressTriggerFocus.current) void showPreview(ref, key, event.currentTarget, uncertain); }}
    onBlur={event => { if (!event.relatedTarget || !popoverRef.current?.contains(event.relatedTarget as Node)) deferClose(); }}
    onClick={event => { if (preview?.key !== key) void showPreview(ref, key, event.currentTarget, uncertain); }}>
    {label}
  </button>;
  const renderPopover = () => {
    if (!preview) return null;
    const openSource = () => { if (preview.text !== undefined && !preview.error) onOpenSource?.(preview.ref, preview.text, Boolean(preview.uncertain)); };
    return createPortal(<div ref={popoverRef} role="dialog" aria-label={`Reviewed source preview ${preview.ref.filePath || 'file'}`} className="finding-source-popover" style={{ left: preview.position.left, top: preview.position.top, width: preview.position.width, height: preview.position.height }}
      onMouseEnter={() => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }} onMouseLeave={deferClose}
      onFocus={() => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }}
      onBlur={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) deferClose(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closePreview(); restoreTriggerFocus(); } }}>
      <header className="finding-source-popover-header">
        <div><strong>{preview.ref.filePath || 'Reviewed file'}</strong><span>{preview.ref.lineNumber ? `Line ${preview.ref.lineNumber}` : 'Location not recorded'} · Saved Review source</span></div>
        <button type="button" className="finding-source-close" aria-label="Close source preview" onClick={() => { closePreview(); restoreTriggerFocus(); }}>×</button>
      </header>
      <div className="finding-source-popover-meta">{preview.ref.sourceVersion ? <>Saved version <code>{preview.ref.sourceVersion}</code></> : 'Saved Review version; no source version identifier was recorded.'}{preview.uncertain && <strong className="finding-source-uncertain">Candidate location · needs verification</strong>}</div>
      <div className="finding-source-popover-content">
        {preview.loading ? <p role="status">Loading saved source…</p> : preview.error ? <div><p role="alert">{preview.error}</p><button type="button" className="btn-secondary" onClick={() => { cache.current.delete(preview.key); void showPreview(preview.ref, preview.key, triggerRef.current || document.body, preview.uncertain); }}>Retry</button></div>
          : preview.text ? <SourceCode text={preview.text} sourceRef={preview.ref} preview uncertain={preview.uncertain} onOpen={openSource} />
            : <p>This saved file is empty.</p>}
      </div>
      <footer className="finding-source-popover-footer">
        <button type="button" className="btn-primary" disabled={preview.loading || Boolean(preview.error) || preview.text === undefined} onClick={openSource}>Open full reviewed source</button>
        <button type="button" className="btn-secondary" onClick={() => { closePreview(); restoreTriggerFocus(); }}>Close preview</button>
      </footer>
    </div>, document.querySelector('.app-shell') ?? document.body);
  };
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
        {trigger(reference, key, `${candidate.filePath}:${candidate.lineNumber}`, candidate.match === 'approximate' || candidate.score < 90)}
        {isBest && <span className="finding-evidence-best-label">Best source match</span>}
      </div>
      <div className="finding-evidence-match-meta">
        <span className={`finding-evidence-confidence is-${candidate.confidence}`}>{candidate.confidence[0].toUpperCase() + candidate.confidence.slice(1)} match strength</span>
        <span>{candidate.score}% match</span>
        <span>{matchLabel(candidate.match)}</span>
      </div>
      <p>Version: <code>{candidate.sourceVersion}</code></p>
      <pre aria-label={`Candidate excerpt from ${candidate.filePath}:${candidate.lineNumber}`}>{candidate.excerpt}</pre>
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
        <p className="finding-saved-excerpt-label">Recorded source evidence</p>
        {ref.excerpt && <pre aria-label={`Saved excerpt from ${ref.filePath}`}>{ref.excerpt}</pre>}
        {finding.verifier !== 'readiness' ? trigger(ref, key, `${ref.filePath || 'Source path unavailable'}${ref.lineNumber ? `:${ref.lineNumber}` : ''}`) : <p>Reviewed file content is unavailable for this source.</p>}
      </li>;
    })}</ul>}
    {renderPopover()}
  </section>;
}
