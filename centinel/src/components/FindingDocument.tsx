import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { displayPath } from '../utils/displayPath';
import type { Finding, FindingSourceReference } from '../types';
import { findingDomain, findingGroupDomains, findingIssueFor, groupStatus, type FindingGroup } from '../findingGroups';
import { buildFixPrompt, copyText } from '../fixPrompt';
import { effectiveFindingStatus } from '../findingStatus';
import { FindingEvidence, SourceCode } from './FindingEvidence';
import { formatEntityId } from '../utils/entityId';

function locationLabel(finding: Finding): string {
  const source = (finding.filePath && displayPath(finding.filePath)) || (finding.requirementId ? `Requirement ${finding.requirementId}` : 'Location unavailable');
  return `${source}${finding.lineNumber ? `:${finding.lineNumber}` : ''}`;
}

function occurrenceLabel(finding: Finding): string {
  return `${locationLabel(finding)} · ${finding.severity} · ${effectiveFindingStatus(finding)}`;
}

function foundLabel(finding: Finding): string {
  const time = Date.parse(finding.createdAt);
  const date = Number.isNaN(time) ? null : new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${locationLabel(finding)} · ${date ? `found ${date}` : 'found'} · ${finding.severity} · ${effectiveFindingStatus(finding)}`;
}

/** Re-check offered by the host: a hint describing what will happen and the action itself. */
export type FindingRecheck = {
  hint: string;
  run: () => Promise<void>;
  /** What the newest comparison Review said about this finding, in plain language. */
  latestResult?: string | null;
  /** Closes the finding after the person confirms they fixed it; offered with latestResult. */
  markResolved?: () => Promise<void>;
};

function FixPromptAction({ finding, title }: { finding: Finding; title: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [fallbackText, setFallbackText] = useState('');
  useEffect(() => { setState('idle'); setFallbackText(''); }, [finding.id]);
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    const prompt = buildFixPrompt(finding, { title: /^\[[^\]]+\]/.test(finding.title) ? title : finding.title });
    try {
      await copyText(prompt);
      setFallbackText('');
      setState('copied');
    } catch {
      setFallbackText(prompt);
      setState('failed');
    }
  };
  return <>
    <p className="finding-fix-actions">
      <button type="button" className="btn-primary finding-copy-fix" onClick={() => void copy()} aria-describedby="finding-fix-hint">{state === 'copied' ? 'Copied' : 'Copy fix prompt'}</button>
      <span id="finding-fix-hint" className="finding-verification-hint">Paste it into Cursor, Claude Code or Codex. It includes this issue only.</span>
    </p>
    <p className="visually-hidden" role="status" aria-live="polite">{state === 'copied' ? 'Fix prompt copied to the clipboard.' : ''}</p>
    {state === 'failed' && <div className="finding-fix-fallback">
      <p role="alert">The clipboard is unavailable. Select the prompt below and copy it manually.</p>
      <label className="visually-hidden" htmlFor="finding-fix-prompt-text">Fix prompt</label>
      <textarea id="finding-fix-prompt-text" readOnly value={fallbackText} rows={10} onFocus={event => event.currentTarget.select()} />
    </div>}
  </>;
}

function RecheckAction({ recheck, findingId }: { recheck: FindingRecheck; findingId: string }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => { setError(null); setResolving(false); }, [findingId]);
  const resolve = async () => {
    if (resolving || !recheck.markResolved) return;
    setResolving(true);
    try { await recheck.markResolved(); } finally { setResolving(false); }
  };
  const run = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try { await recheck.run(); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : 'The re-check could not be started. The original Review remains available.'); }
    finally { setStarting(false); }
  };
  return <>
    {recheck.latestResult && <div className="finding-recheck-result" role="status">
      <p>{recheck.latestResult}</p>
      {recheck.markResolved && <button type="button" className="btn-secondary finding-recheck-resolve" disabled={resolving} onClick={() => void resolve()}>{resolving ? 'Marking as resolved…' : 'I fixed it — mark as resolved'}</button>}
    </div>}
    <p><button type="button" className="btn-secondary finding-recheck" onClick={() => void run()} disabled={starting} aria-describedby="finding-recheck-hint">{starting ? 'Starting re-check…' : 'Re-check'}</button> <span id="finding-recheck-hint" className="finding-verification-hint">{recheck.hint}</span></p>
    {error && <p className="finding-recheck-error" role="alert">{error}</p>}
  </>;
}

export function FindingDocument({ group, selectedId, onSelect, onBack, actions, onOpenReview, onVerifyWithDynamic, recheckFor }: {
  group: FindingGroup; selectedId: string; onSelect: (id: string) => void; onBack: () => void;
  actions: (finding: Finding) => ReactNode; onOpenReview?: (id: string) => void; onVerifyWithDynamic?: (finding: Finding) => void;
  /** Re-check the Review that produced the finding against updated sources, when the host supports it. */
  recheckFor?: (finding: Finding) => FindingRecheck | null;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const sourceReaderFocus = useRef<HTMLButtonElement>(null);
  const returnScroll = useRef<{ element: HTMLElement | null; scrollTop: number; windowTop: number } | null>(null);
  const [sourceReader, setSourceReader] = useState<{ ref: FindingSourceReference; text: string; uncertain: boolean } | null>(null);
  const [occurrenceSearch, setOccurrenceSearch] = useState('');
  useEffect(() => { heading.current?.focus(); }, [group.key]);
  useEffect(() => { setOccurrenceSearch(''); }, [group.key]);
  useEffect(() => { if (sourceReader) sourceReaderFocus.current?.focus(); }, [sourceReader]);

  const selected = group.members.find(item => item.id === selectedId) ?? group.representative;
  const selectedIssue = findingIssueFor(group, selected.id);
  const issueCount = group.issues.length;
  const repeated = group.members.length > issueCount;
  const recheck = recheckFor?.(selected) ?? null;
  const recommendations = group.members.map(item => item.recommendation.trim());
  const commonRecommendation = recommendations[0] && recommendations.every(value => value === recommendations[0]) ? recommendations[0] : null;
  const descriptions = group.members.map(item => item.description.trim());
  const commonDescription = descriptions[0] && descriptions.every(value => value === descriptions[0]) ? descriptions[0] : null;
  const origin = group.representative.verifier === 'readiness' ? 'Readiness' : group.representative.source === 'dynamic' ? 'Dynamic Testing' : 'Review';
  const occurrenceChoices = useMemo(() => {
    const query = occurrenceSearch.trim().toLocaleLowerCase();
    const matches = query
      ? group.members.filter(item => occurrenceLabel(item).toLocaleLowerCase().includes(query) || item.title.toLocaleLowerCase().includes(query))
      : group.members;
    return matches.some(item => item.id === selected.id) ? matches : [selected, ...matches];
  }, [group.members, occurrenceSearch, selected]);

  const openSavedSource = (ref: FindingSourceReference, text: string, uncertain = false) => {
    const element = document.querySelector<HTMLElement>('.main-content');
    returnScroll.current = { element, scrollTop: element?.scrollTop ?? 0, windowTop: window.scrollY };
    setSourceReader({ ref, text, uncertain });
    window.requestAnimationFrame(() => {
      if (element) element.scrollTop = 0;
      else window.scrollTo({ top: 0, behavior: 'auto' });
    });
  };
  const returnToFinding = () => {
    setSourceReader(null);
    window.requestAnimationFrame(() => {
      const context = returnScroll.current;
      if (context?.element?.isConnected) context.element.scrollTop = context.scrollTop;
      else if (context) window.scrollTo({ top: context.windowTop, behavior: 'auto' });
      heading.current?.focus({ preventScroll: true });
    });
  };

  if (sourceReader) return <article className="finding-document finding-source-reader card detail-card" aria-label="Reviewed source reader">
    <button ref={sourceReaderFocus} type="button" className="btn-secondary finding-source-reader-back" onClick={returnToFinding}>Back to finding</button>
    <header className="finding-source-reader-heading">
      <p>Source from the saved Review</p>
      <h2>{sourceReader.ref.filePath ? displayPath(sourceReader.ref.filePath) : 'Reviewed file'}</h2>
      <p>{sourceReader.ref.lineNumber ? `Recorded location: line ${sourceReader.ref.lineNumber}` : 'No source line was recorded.'}</p>
      {sourceReader.uncertain && <p className="finding-source-reader-uncertain">This is a candidate source location and needs verification.</p>}
      <p>{sourceReader.ref.sourceVersion ? <>Saved version <code>{sourceReader.ref.sourceVersion}</code></> : 'Version identifier unavailable. Content is read from the selected Review.'}</p>
      {(selected.latestOccurrence?.reviewId || selected.sessionId) && <p>Review: <code>{selected.latestOccurrence?.reviewId || selected.sessionId}</code></p>}
    </header>
    <p className="finding-source-reader-note">This reader shows the source saved with this Review. It does not load a newer project file.</p>
    <SourceCode text={sourceReader.text} sourceRef={sourceReader.ref} uncertain={sourceReader.uncertain} />
  </article>;

  return <article className="finding-document card detail-card" aria-label="Finding details">
    <button type="button" className="btn-secondary finding-document-back" onClick={onBack}>Back to findings</button>
    <header className="finding-document-heading">
      <p>{origin} · {findingGroupDomains(group)} · {groupStatus(group)}</p>
      <h2 ref={heading} tabIndex={-1}>{group.title}</h2>
      <p className="finding-document-count">{issueCount > 1 ? `${issueCount} affected locations · ` : ''}{group.members.length} {group.members.length === 1 ? 'occurrence' : 'occurrences'}{repeated ? ' across Reviews' : ''}</p>
    </header>

    {commonRecommendation && <section className="finding-overall-recommendation finding-document-section" aria-label="Shared recommendation">
      <h3>What to do</h3>
      <p>{commonRecommendation}</p>
    </section>}

    {commonDescription && <section className="finding-document-shared-problem finding-document-section" aria-label="Shared problem">
      <h3>What is wrong</h3>
      <p>{commonDescription}</p>
    </section>}

    {group.members.length > 1 && <section className="finding-occurrence-selector" aria-label="Affected locations">
      <div className="finding-occurrence-selector-heading">
        <label htmlFor="finding-occurrence-select">Location</label>
        <span>{issueCount > 1 ? `${issueCount} affected locations` : 'One affected location'}{repeated ? ` · ${group.members.length} occurrences` : ''}</span>
      </div>
      {group.members.length > 12 && <label className="finding-occurrence-search">
        <span className="visually-hidden">Search affected locations</span>
        <input type="search" value={occurrenceSearch} onChange={event => setOccurrenceSearch(event.target.value)} placeholder="Search path or issue" />
      </label>}
      <select id="finding-occurrence-select" value={selected.id} onChange={event => onSelect(event.target.value)} aria-describedby="finding-occurrence-status">
        {group.issues.map(issue => {
          const visible = issue.occurrences.filter(item => occurrenceChoices.includes(item));
          if (!visible.length) return null;
          const prefix = (item: Finding) => item.id === selected.id && occurrenceSearch && !occurrenceLabel(item).toLocaleLowerCase().includes(occurrenceSearch.trim().toLocaleLowerCase()) && !item.title.toLocaleLowerCase().includes(occurrenceSearch.trim().toLocaleLowerCase()) ? 'Current selection · ' : '';
          if (issue.occurrences.length === 1) return visible.map(item => <option key={item.id} value={item.id}>{prefix(item)}{occurrenceLabel(item)}</option>);
          return <optgroup key={issue.key} label={`${locationLabel(issue.representative)} · ${issue.occurrences.length} occurrences`}>
            {visible.map(item => <option key={item.id} value={item.id}>{prefix(item)}{foundLabel(item)}</option>)}
          </optgroup>;
        })}
      </select>
      <p id="finding-occurrence-status" className="visually-hidden" aria-live="polite">Selected {occurrenceLabel(selected)}.</p>
    </section>}

    <section className="finding-selected-occurrence" aria-label={`Selected occurrence: ${locationLabel(selected)}`}>
      <header className="finding-selected-occurrence-heading">
        <div>
          <p className="finding-selected-kicker">Selected occurrence</p>
          <h3>{locationLabel(selected)}</h3>
          {selectedIssue && selectedIssue.occurrences.length > 1 && <p className="finding-repeat-count">Found {selectedIssue.occurrences.length} times at this location across Reviews.</p>}
        </div>
        <div className="finding-occurrence-status" aria-label={`Severity ${selected.severity}; status ${effectiveFindingStatus(selected)}`}>
          <span>{selected.severity}</span><span>{effectiveFindingStatus(selected)}</span>
          {selected.priority && <span>Priority {selected.priority}</span>}
        </div>
      </header>

      {/* The main next step for most users: hand the fix to their AI coding tool. */}
      <section className="finding-document-section finding-fix" aria-label="Fix this issue">
        <h4>Fix this issue</h4>
        <FixPromptAction finding={selected} title={group.title} />
      </section>

      {!commonRecommendation && <section className="finding-document-section finding-occurrence-action" aria-label="Recommended action">
        <h4>What to do</h4>
        <p>{selected.recommendation.trim() || 'No recommendation was recorded for this occurrence.'}</p>
      </section>}

      {!commonDescription && <section className="finding-document-section finding-occurrence-problem" aria-label="Problem description">
        <h4>What is wrong</h4>
        {selected.title !== group.title && <p className="finding-recorded-title">{selected.title}</p>}
        <p>{selected.description.trim() || 'A plain-language explanation was not recorded for this occurrence.'}</p>
      </section>}

      {selected.location?.logicFlow?.length ? <section className="finding-document-section finding-occurrence-cause" aria-label="Recorded cause">
        <h4>Where and why</h4>
        <ol aria-label="Recorded causal sequence">{selected.location.logicFlow.map((step, index) => <li key={`${selected.id}:${index}`}>{step}</li>)}</ol>
      </section> : null}

      <FindingEvidence key={selected.id} finding={selected} headingLevel={4} onOpenSource={openSavedSource} />

      {!commonDescription && selected.evidenceText && !selected.filePath && <section className="finding-document-section finding-occurrence-evidence-text" aria-label="Recorded evidence">
        <h4>Recorded evidence</h4><pre>{selected.evidenceText}</pre>
      </section>}

      <section className="finding-document-section finding-verification" aria-label="How to verify resolution">
        <h4>How to verify resolution</h4>
        <p>No verification steps or completion criteria were recorded for this occurrence.</p>
        {recheck && <RecheckAction recheck={recheck} findingId={selected.id} />}
        {onVerifyWithDynamic && origin === 'Review' && <p><button type="button" className="btn-secondary" onClick={() => onVerifyWithDynamic(selected)}>Verify with Dynamic Testing</button> <span className="finding-verification-hint">Drafts a browser test from this finding. You review it before anything runs.</span></p>}
      </section>

      {(selected.resolutionEvidence || selected.lineageHistory?.length) && <details className="finding-history-details">
        <summary>Review history and resolution evidence</summary>
        {selected.resolutionEvidence && <section aria-label="Resolution evidence"><h5>Resolution evidence</h5>
          <p>Not reproduced in the comparable re-review: <strong>{selected.resolutionEvidence.reviewName}</strong>.</p>
          <p>Source version: <code>{selected.resolutionEvidence.previousSourceVersion}</code> → <code>{selected.resolutionEvidence.reviewedSourceVersion}</code></p>
          <p>Source manifest: <code>{selected.resolutionEvidence.sourceManifestId}</code></p>
          {onOpenReview && <button type="button" className="btn-link" onClick={() => onOpenReview(selected.resolutionEvidence!.reviewId)}>Open review {selected.resolutionEvidence.reviewName}</button>}
        </section>}
        {selected.lineageHistory?.length ? <section aria-label="Prior finding history"><h5>Prior finding history</h5><ul>{selected.lineageHistory.map(entry => <li key={entry.findingId}>
          {entry.classification === 'regressed' ? 'Regressed' : 'Recurring'} in {entry.reviewName || entry.reviewId}: {entry.title} ({entry.status})
          {entry.sourceVersion && <p>Source version: <code>{entry.sourceVersion}</code></p>}
          {onOpenReview && entry.reviewId && <button type="button" className="btn-link" onClick={() => onOpenReview(entry.reviewId!)}>Open review {entry.reviewName || entry.reviewId}</button>}
        </li>)}</ul></section> : null}
      </details>}

      <details className="finding-provenance-details">
        <summary>Technical provenance</summary>
        <dl><div><dt>Finding ID</dt><dd>{formatEntityId(selected.id)}</dd></div>
          <div><dt>Domain</dt><dd>{findingDomain(selected)}</dd></div>
          {selected.confidence && <div><dt>Recorded confidence</dt><dd>{selected.confidence}</dd></div>}
          {selected.requirementId && <div><dt>Requirement</dt><dd>{selected.requirementId}</dd></div>}
          {selected.location?.ruleId && <div><dt>Rule</dt><dd>{selected.location.ruleId}</dd></div>}
        </dl>
      </details>

      {actions(selected)}
    </section>
  </article>;
}
