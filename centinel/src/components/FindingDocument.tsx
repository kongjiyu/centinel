import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Copy } from 'lucide-react';
import { displayPath } from '../utils/displayPath';
import type { Finding, FindingSourceReference } from '../types';
import { findingDomain, findingIssueFor, findingSourceReferences, groupStatus, mergedObservations, ruleCheckExplanation, type FindingGroup } from '../findingGroups';
import { buildFixPrompt, copyText } from '../fixPrompt';
import { effectiveFindingStatus } from '../findingStatus';
import { EvidenceFileControl, FindingEvidence, loadFindingSavedSource, SourceCode } from './FindingEvidence';
import { entityIdTitle, formatEntityId } from '../utils/entityId';
import { rankFindingEvidence } from '../findingEvidenceRanking';
import { deriveRiskLevelWithFallback } from '../riskPolicy';
import { api } from '../api/client';

function locationLabel(finding: Finding): string {
  const source = (finding.filePath && displayPath(finding.filePath)) || (finding.requirementId ? `Requirement ${finding.requirementId}` : 'Location unavailable');
  return `${source}${finding.lineNumber ? `:${finding.lineNumber}` : ''}`;
}

/**
 * For a rule-only issue: what the pattern means, that no AI-reported issue
 * explains this location, and any requirement link that was actually recorded.
 * Nothing here is an AI verdict.
 */
function RuleCheckExplanation({ finding, explanation }: { finding: Finding; explanation: string }) {
  const observedRequirements = [...new Set(mergedObservations(finding).map(item => item.requirementId).filter((id): id is string => Boolean(id)))];
  return <section className="finding-document-section finding-rule-explanation" aria-label="About this rule check">
    <h4>What this check means</h4>
    <p>{explanation}</p>
    <p className="finding-verification-hint">The AI review did not report an issue at this location, so this result comes from Centinel's pattern check alone. Read the code to confirm it; it is not an AI-verified conclusion.</p>
    {finding.requirementId
      ? <p>Linked requirement: <code>{finding.requirementId}</code></p>
      : observedRequirements.length
        ? <p>An AI observation merged into this finding cited {observedRequirements.length === 1 ? 'requirement' : 'requirements'} {observedRequirements.map((id, index) => <span key={id}>{index ? ', ' : ''}<code>{id}</code></span>)}.</p>
        : <p>No requirement is linked to this finding. If a confirmed requirement covers this code, link it on the Requirements screen.</p>}
  </section>;
}

function MergedObservationList({ finding }: { finding: Finding }) {
  const items = mergedObservations(finding);
  if (!items.length) return null;
  const total = Math.max(items.length, finding.location?.sourceLocator?.mergedObservationTotal ?? 0);
  return <section className="finding-document-section finding-merged-observations" aria-label="Also reported in this Review">
    <h4>Also reported in this Review</h4>
    <p className="finding-verification-hint">The same Review described this issue {total === 1 ? 'one more time' : `${total} more times`} at this place. The repeats are kept here as evidence instead of separate findings.{total > items.length ? ` The first ${items.length} are shown.` : ''}</p>
    <ul>
      {items.map((item, index) => <li key={`${finding.id}:merged:${index}`}>
        <p><strong>{item.title}</strong> · {item.filePath ? displayPath(item.filePath) : 'Location unavailable'}{item.lineNumber ? `:${item.lineNumber}` : ''} · {item.verification === 'needs_verification' ? 'Needs verification' : item.verification === 'verified' ? 'Citation verified' : item.source === 'deterministic' ? 'Rule check' : 'Recorded'}</p>
        {item.description && item.description !== item.title && <p>{item.description}</p>}
        {item.evidence && <pre>{item.evidence}</pre>}
      </li>)}
    </ul>
  </section>;
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

export function FindingDocument({ group, selectedId, onSelect, onBack, actions, onOpenReview, onVerifyWithDynamic, recheckFor, standalone = false }: {
  standalone?: boolean;
  group: FindingGroup; selectedId: string; onSelect: (id: string) => void; onBack: () => void;
  actions: (finding: Finding) => ReactNode; onOpenReview?: (id: string) => void; onVerifyWithDynamic?: (finding: Finding) => void;
  /** Re-check the Review that produced the finding against updated sources, when the host supports it. */
  recheckFor?: (finding: Finding) => FindingRecheck | null;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const sourceReaderFocus = useRef<HTMLButtonElement>(null);
  const returnScroll = useRef<{ element: HTMLElement | null; scrollTop: number; windowTop: number } | null>(null);
  const [sourceReader, setSourceReader] = useState<{ ref: FindingSourceReference; text: string; uncertain: boolean; additionalRefs?: FindingSourceReference[] } | null>(null);
  const [occurrenceSearch, setOccurrenceSearch] = useState('');
  const [allEvidence, setAllEvidence] = useState(false);
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(() => new Set());
  const [activeFile, setActiveFile] = useState<{ findingId: string; path: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sourceRequest = useRef(0);
  const [featureLabels, setFeatureLabels] = useState<Record<string, string>>({});
  const rankedEvidence = useMemo(() => rankFindingEvidence(group.members), [group.members]);
  const featureReviews = useMemo(() => [...new Set(rankedEvidence.slice(0, 3).flatMap(feature => {
    const finding = feature.files[0]?.findings[0];
    return feature.id && finding ? [finding.latestOccurrence?.reviewId || finding.sessionId] : [];
  }).filter((id): id is string => Boolean(id)))], [rankedEvidence]);
  const projectId = group.representative.projectId;
  useEffect(() => {
    if (!featureReviews.length || typeof api.getReviewHarness !== 'function') return;
    let current = true;
    void Promise.allSettled(featureReviews.map(reviewId => api.getReviewHarness(projectId, reviewId))).then(results => {
      if (current) setFeatureLabels(Object.fromEntries(results.flatMap(result => result.status === 'fulfilled'
        ? (result.value?.analysisMap?.features ?? []).map(feature => [feature.id, feature.label]) : [])));
    });
    return () => { current = false; };
  }, [featureReviews, projectId]);
  useEffect(() => { heading.current?.focus(); }, [group.key]);
  useEffect(() => {
    setOccurrenceSearch(''); setAllEvidence(false); setExpandedFeatures(new Set()); setActiveFile(null);
    return () => { sourceRequest.current += 1; };
  }, [group.key]);
  useEffect(() => { if (sourceReader) sourceReaderFocus.current?.focus(); }, [sourceReader]);

  const selected = group.members.find(item => item.id === selectedId) ?? group.representative;
  const issueCount = group.issues.length;
  const repeated = group.members.length > issueCount;
  const timesAtLocation = findingIssueFor(group, selected.id)?.occurrences.length ?? 1;
  const recheck = recheckFor?.(selected) ?? null;
  const summary = selected.description.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] || selected.description.trim();
  const risk = selected.riskLevel ?? deriveRiskLevelWithFallback(selected.severity, selected.priority);
  const priority = selected.priority?.trim() || 'Not set';
  const priorityLevel = /^(critical|high|medium|low)$/i.test(priority) ? priority.toLowerCase() : 'unclassified';
  const evidencePath = activeFile?.findingId === selected.id ? activeFile.path : undefined;
  const recommendation = selected.recommendation.trim() || 'No recommendation was recorded for this occurrence.';
  const verificationGuidance = (selected.filePath
    ? 'Compare the change with the saved excerpt and repeat the check that exposed the issue.'
    : 'Check the updated evidence against the reported gap.') + ' No verification steps or completion criteria were recorded for this occurrence.';
  const origin = group.representative.verifier === 'readiness' ? 'Readiness' : group.representative.source === 'dynamic' ? 'Dynamic Testing' : 'Review';
  // Rule groups are folded into an AI-reported issue at the same place; a group without one is rule-only.
  const ruleExplanation = group.members.every(item => ruleCheckExplanation(item) !== null) ? ruleCheckExplanation(selected) : null;
  const occurrenceChoices = useMemo(() => {
    const query = occurrenceSearch.trim().toLocaleLowerCase();
    const matches = query
      ? group.members.filter(item => occurrenceLabel(item).toLocaleLowerCase().includes(query) || item.title.toLocaleLowerCase().includes(query))
      : group.members;
    return matches.some(item => item.id === selected.id) ? matches : [selected, ...matches];
  }, [group.members, occurrenceSearch, selected]);

  const openSavedSource = (ref: FindingSourceReference, text: string, uncertain = false, additionalRefs?: FindingSourceReference[]) => {
    const element = document.querySelector<HTMLElement>('.main-content');
    returnScroll.current = { element, scrollTop: element?.scrollTop ?? 0, windowTop: window.scrollY };
    setSourceReader({ ref, text, uncertain, additionalRefs });
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
  const selectEvidenceFile = async (occurrence: Finding, path: string, ref?: FindingSourceReference, additionalRefs?: FindingSourceReference[]) => {
    const request = ++sourceRequest.current;
    setSourceError(null);
    setActiveFile({ findingId: occurrence.id, path });
    onSelect(occurrence.id);
    if (!standalone || !ref) return;
    const source = await loadFindingSavedSource(occurrence.projectId, occurrence.latestOccurrence?.reviewId || occurrence.sessionId, ref);
    if (request !== sourceRequest.current) return;
    if (source.error) setSourceError(source.error);
    else openSavedSource(ref, source.text, occurrence.location?.sourceLocator?.citationEvidence?.verification === 'needs_verification', additionalRefs);
  };
  const copyFinding = async () => {
    const sections = [
      `# ${group.title}`,
      `${findingDomain(selected)} · Risk ${risk ?? 'not classified'} · Priority ${priority} · ${groupStatus(group)}`,
      summary,
      `Reported confidence: ${selected.confidence?.trim() || 'Not recorded'}`,
      '## Overview',
      '### Possible threats',
      ...group.issues.map(({ key, representative }, index) => {
        const issue = findingIssueFor(group, selected.id)?.key === key ? selected : representative;
        return `#### ${index + 1}. ${issue.title}\n\n${issue.description}`;
      }),
      ...(selected.location?.logicFlow ?? []).map((step, index) => `${index + 1}. ${step}`),
      '## Evidence',
      ...rankedEvidence.map(feature => [
        `### ${feature.id ? featureLabels[feature.id] || `Feature ${formatEntityId(feature.id)}` : 'Feature not recorded'}`,
        ...feature.files.map(file => `- ${displayPath(file.path)} · ${file.lines ? `${file.lines} highlighted lines` : 'No lines recorded'}`),
      ].join('\n')),
      ...findingSourceReferences(selected).map(ref => [
        `- ${displayPath(ref.filePath)}${ref.lineNumber ? `:${ref.lineNumber}` : ''}`,
        ref.excerpt ? ref.excerpt.split(/\r?\n/).map(line => `    ${line}`).join('\n') : '',
      ].filter(Boolean).join('\n\n')),
      '## Recommended Action', recommendation, verificationGuidance,
    ];
    try {
      await copyText(sections.join('\n\n'));
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Clipboard unavailable');
    }
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
    <SourceCode text={sourceReader.text} sourceRef={sourceReader.ref} additionalRefs={sourceReader.additionalRefs} uncertain={sourceReader.uncertain} />
  </article>;

  return <article className="finding-document finding-detail-page" aria-label="Finding details">
    <header className="finding-document-heading card detail-card">
      <button type="button" className="btn-secondary finding-document-back" aria-label="Back to findings" title="Back to findings" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" /></button>
      <div className="finding-heading-content">
      <div className="finding-header-title-row">
        <h2 ref={heading} tabIndex={-1}>{group.title}</h2>
        <div className="finding-header-badges">
          <span className="finding-risk-badge" data-level={risk}>Risk {risk ?? 'not classified'}</span>
          <span className="finding-risk-badge" data-level={priorityLevel}>Priority {priority}</span>
          <span className="finding-risk-badge">{groupStatus(group)}</span>
        </div>
      </div>
      <p className="finding-header-kicker"><span>{findingDomain(selected)}</span> · <span>{origin}</span></p>
      {summary && <p className="finding-document-summary">{summary}</p>}
      {selected.affectedFeature && <p>Affected feature <strong>{selected.affectedFeature}</strong></p>}
      <div className="finding-header-metadata">
        <span className="finding-header-id" title={entityIdTitle('Finding ID:', selected.id)}>{formatEntityId(selected.id)}</span>
        {group.members.length > 1 && <span>{issueCount > 1 ? `${issueCount} affected locations · ` : ''}{group.members.length} occurrences{repeated ? ' across Reviews' : ''}</span>}
      </div>
      <dl className="finding-header-facts">
        <div><dt>Reported confidence</dt><dd>{selected.confidence?.trim() || 'Not recorded'}</dd></div>
      </dl>
      {(selected.resolutionEvidence || selected.lineageHistory?.length) && <details className="finding-history-details">
        <summary><ChevronRight size={14} aria-hidden="true" /> Review history and resolution evidence</summary>
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

      </div>
      <div className="finding-copy-control">
        <button type="button" className="btn-secondary" aria-label="Copy finding as Markdown" title="Copy finding as Markdown" onClick={() => void copyFinding()}><Copy size={17} aria-hidden="true" /></button>
        {copyStatus && <span role="status">{copyStatus}</span>}
      </div>
    </header>

    <div className="finding-detail-body card detail-card">
    <section className="finding-detail-part" aria-labelledby="finding-overview-heading">
      <h3 id="finding-overview-heading">Overview</h3>
      <section className="finding-document-section" aria-label="Possible threats">
        <h4>Possible threats</h4>
        <ol className="finding-threats">{group.issues.map(({ key, representative }, index) => {
          const issue = findingIssueFor(group, selected.id)?.key === key ? selected : representative;
          return <li key={key} id={`finding-threat-${index}`}><h5>{issue.title}</h5><p>{issue.description}</p></li>;
        })}</ol>
        {selected.location?.logicFlow?.length
          ? <ol aria-label="Recorded causal sequence">{selected.location.logicFlow.map((step, index) => <li key={index}>{step}</li>)}</ol>
          : null}
      </section>
      {ruleExplanation && <RuleCheckExplanation finding={selected} explanation={ruleExplanation} />}
    </section>

    <section className="finding-detail-part" aria-labelledby="finding-evidence-heading">
      <h3 id="finding-evidence-heading">Evidence</h3>
      {rankedEvidence.length > 0 && <div className="finding-evidence-ranked" aria-label="Ranked evidence">
        {rankedEvidence.slice(0, allEvidence ? undefined : 3).map(feature => {
          const expanded = expandedFeatures.has(feature.id);
          const moreFiles = feature.files.length - 3;
          return <div className="finding-feature-evidence" key={feature.id || 'unassigned'}>
          <header>
            <h4>{feature.id ? featureLabels[feature.id] || `Feature ${formatEntityId(feature.id)}` : 'Feature not recorded'}</h4>
            <p>{feature.files.length} affected {feature.files.length === 1 ? 'file' : 'files'}</p>
          </header>
          <table aria-label={feature.id ? featureLabels[feature.id] || `Feature ${formatEntityId(feature.id)} evidence` : 'Evidence without a recorded feature'}><tbody>{feature.files.slice(0, expanded ? undefined : 3).map(file => {
            const issues = group.issues.flatMap((issue, index) => issue.occurrences.some(item => file.findings.includes(item)) ? [index] : []);
            return <tr key={file.path}><td>
              <EvidenceFileControl path={file.path} findings={file.findings} selectedId={selected.id} pressed={evidencePath === file.path}
                onOpen={(occurrence, ref, additionalRefs) => void selectEvidenceFile(occurrence, file.path, ref, additionalRefs)} />
            </td><td>
              {issues.map(index => <a className="finding-threat-link" key={index} href={`#finding-threat-${index}`} onClick={event => {
                event.preventDefault();
                document.getElementById(`finding-threat-${index}`)?.scrollIntoView?.({ block: 'nearest' });
              }}>Threat {index + 1}</a>)}
              <span>{file.lines > 0 ? `${file.lines} ${file.lines === 1 ? 'line' : 'lines'} highlighted` : 'No lines recorded'}</span>
            </td></tr>;
          })}</tbody></table>
          {moreFiles > 0 && <footer><button type="button" className="btn-link" aria-expanded={expanded} onClick={() => {
            setExpandedFeatures(previous => {
              const next = new Set(previous);
              if (next.has(feature.id)) next.delete(feature.id);
              else next.add(feature.id);
              return next;
            });
          }}>{expanded ? 'Show fewer files' : `Show ${moreFiles} more ${moreFiles === 1 ? 'file' : 'files'}`}</button></footer>}
          </div>;
        })}
        {rankedEvidence.length > 3 &&
          <button type="button" className="btn-secondary" aria-expanded={allEvidence} onClick={() => setAllEvidence(value => !value)}>{allEvidence ? 'Show top three' : 'Show all evidence'}</button>}
      </div>}
      {sourceError && <p role="alert">{sourceError}</p>}
    {group.members.length > 1 && <section className="finding-occurrence-selector" aria-label="Affected locations">
      <div className="finding-occurrence-selector-heading">
        <label htmlFor="finding-occurrence-select">Location</label>
        <span>{group.members.length} saved occurrences</span>
      </div>
      {group.members.length > 12 && <label className="finding-occurrence-search">
        <span className="visually-hidden">Search affected locations</span>
        <input type="search" value={occurrenceSearch} onChange={event => setOccurrenceSearch(event.target.value)} placeholder="Search path or issue" />
      </label>}
      <select id="finding-occurrence-select" value={selected.id} onChange={event => { setActiveFile(null); onSelect(event.target.value); }} aria-describedby="finding-occurrence-status">
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
        <header className="finding-selected-occurrence-heading"><h3>{evidencePath ? displayPath(evidencePath) : locationLabel(selected)}</h3></header>
        {timesAtLocation > 1 && <p className="finding-repeat-count">Found {timesAtLocation} times at this location across Reviews.</p>}
        <FindingEvidence key={selected.id} finding={selected} headingLevel={4} sourcePath={evidencePath} onOpenSource={openSavedSource} />
        <MergedObservationList finding={selected} />
        {selected.evidenceText && !selected.filePath && <section className="finding-document-section" aria-label="Recorded evidence"><h4>Recorded evidence</h4><pre>{selected.evidenceText}</pre></section>}
      </section>
    </section>
    <section className="finding-detail-part" aria-labelledby="finding-action-heading">
      <h3 id="finding-action-heading">Recommended Action</h3>
      <section className="finding-document-section finding-fix" aria-label="Fix this issue">
        <h4>Recommended changes</h4>
        <p>{recommendation}</p>
        <FixPromptAction finding={selected} title={group.title} />
        {actions(selected)}
      </section>
      <section className="finding-document-section finding-verification" aria-label="How to verify resolution">
        <h4>How to verify</h4>
        <p>{verificationGuidance}</p>
        {recheck && <RecheckAction recheck={recheck} findingId={selected.id} />}
        {onVerifyWithDynamic && origin === 'Review' && <p><button type="button" className="btn-secondary" onClick={() => onVerifyWithDynamic(selected)}>Verify with Dynamic Testing</button> <span className="finding-verification-hint">Opens a draft browser test for you to review.</span></p>}
      </section>
    </section>
    </div>
  </article>;
}
