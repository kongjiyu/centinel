import { useEffect, useRef, useState } from 'react';
import { Ban, Eye, RotateCcw, Send } from 'lucide-react';
import { EvidenceFileControl, loadFindingSavedSource } from './FindingEvidence';
import { StatusBadge } from './CommandUI';
import { findingRiskLevel } from './FindingsPanel';
import { findingSourceReferences, groupFindings } from '../findingGroups';
import { rankFindingEvidence } from '../findingEvidenceRanking';
import { effectiveFindingStatus } from '../findingStatus';
import { featureDisplayName, groupReviewFeatures } from '../reviewFeatures';
import { plainReviewText } from '../reviewNarrative';
import { userFacingError } from '../utils/userFacingError';
import type { ReviewAnalysisMap } from '../reviewHarness';
import type { Finding, FindingSourceReference, ReviewTraceabilitySnapshot } from '../types';

function codeProse(value: string) {
  const code = /(`[^`]+`|https?:\/\/[^\s<>"'`]+|(?<![\w/])\/[\w{}:[\]-]+(?:[/?#][^\s<>"'`]*)?|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\n]{0,80}\)|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|\b[a-z]+[A-Z][\w$]*\b)/g;
  return value.split(code).map((part, index) => {
    if (index % 2 === 0) return part;
    const address = /^(?:https?:\/\/|\/)/.test(part);
    const token = address ? part.replace(/[.,;:!?)]+$/, '') : part;
    return <span key={index}><code>{token.replace(/^`|`$/g, '')}</code>{part.slice(token.length)}</span>;
  });
}

export const REVIEW_ISSUE_CATEGORIES = ['Document', 'Security', 'Technical', 'Human manual', 'System'] as const;
export type ReviewIssueCategory = typeof REVIEW_ISSUE_CATEGORIES[number];

export function reviewIssueCategory(finding: Pick<Finding, 'title' | 'category' | 'location' | 'evidenceGap'>): ReviewIssueCategory {
  const labels = [finding.category, finding.location?.issueType, finding.location?.ruleId, finding.title].filter(Boolean).join(' ').replace(/[_-]/g, ' ');
  if (finding.evidenceGap || /\b(document|traceability|requirement mismatch|requirement conflict|requirement violation|nonconformance)\b/i.test(labels)) return 'Document';
  if (finding.location?.domain === 'security' || /\b(security|auth(?:entication|orization)?|ownership check|credential|secret|validation|unsafe html|outdated dependenc)\w*/i.test(labels)) return 'Security';
  if (finding.location?.domain === 'personnel' || /\b(human manual|usability|confirmation|undo|UI|UX)\b/i.test(labels)) return 'Human manual';
  if (/\b(system|maintainab\w*|architecture|modular\w*|memory leak|resource leak|deep nesting|long function)\b/i.test(labels)) return 'System';
  return 'Technical';
}

export function shortReviewIssueTitle(title: string) {
  const text = title.replace(/^\[[^\]]+\]\s*/, '').trim();
  const firstSentence = text.split(/[.!?](?=\s+[A-Z])/)[0];
  return firstSentence.length <= 80 ? firstSentence : firstSentence.slice(0, 79).replace(/\s+\S*$/, '') + '…';
}

function IssueSourceContext({ projectId, reviewId, referencesJson }: {
  projectId: string;
  reviewId: string | null;
  referencesJson: string;
}) {
  const [sources, setSources] = useState<Array<{ text: string; error?: string }> | null>(null);
  useEffect(() => {
    let active = true;
    const references: FindingSourceReference[] = JSON.parse(referencesJson);
    const requests = new Map<string, ReturnType<typeof loadFindingSavedSource>>();
    void Promise.all(references.map(ref => {
      const key = JSON.stringify([ref.artifactId, ref.sourceVersion, ref.filePath]);
      const pending = requests.get(key) ?? loadFindingSavedSource(projectId, reviewId, ref);
      requests.set(key, pending);
      return pending;
    })).then(results => {
      if (active) setSources(results);
    });
    return () => { active = false; };
  }, [projectId, reviewId, referencesJson]);

  if (!sources) return <p role="status">Loading saved source…</p>;
  const references: FindingSourceReference[] = JSON.parse(referencesJson);
  const lines = new Map<number, { text: string; highlighted: boolean }>();
  const unnumbered: string[] = [];
  references.forEach((ref, index) => {
    const source = sources[index].text.split(/\r?\n/);
    const excerpt = ref.excerpt?.trim() ? ref.excerpt.trimEnd().split(/\r?\n/) : [];
    const start = ref.lineNumber;
    if (!start || start < 1) {
      if (excerpt.length) unnumbered.push(excerpt.join('\n'));
      return;
    }
    const hasSource = Boolean(sources[index].text) && start <= source.length;
    const excerptMatches = excerpt.length > 0 && excerpt.every((line, offset) => source[start - 1 + offset]?.trim() === line.trim());
    const end = start + (hasSource ? (excerptMatches ? excerpt.length : 1) : excerpt.length) - 1;
    for (let line = hasSource ? Math.max(1, start - 2) : start; line <= (hasSource ? Math.min(source.length, end + 2) : end); line++) {
      lines.set(line, { text: hasSource ? source[line - 1] : excerpt[line - start], highlighted: Boolean(lines.get(line)?.highlighted) || (line >= start && line <= end) });
    }
  });
  if (!lines.size && !unnumbered.length) return <p>Saved source context is unavailable for these citations.</p>;
  let previous = 0;
  return <div className="review-issue-code" role="region" aria-label={`Saved source from ${references[0].filePath}`} tabIndex={0}>
    <pre><code>{[...lines].sort(([a], [b]) => a - b).map(([line, row]) => {
      const gap = previous > 0 && line > previous + 1;
      previous = line;
      return <span key={line}>{gap && <span className="review-issue-source-gap">…</span>}<span className={row.highlighted ? 'is-highlighted' : undefined}><span>{line}</span>{row.text || ' '}</span></span>;
    })}</code></pre>
    {unnumbered.map((excerpt, index) => <pre key={index}><code>{excerpt}</code></pre>)}
  </div>;
}

export function ReviewIssues({ findings, storedIds, map, traceability, coverageInterrupted, issuesUnavailable, progress, completion, liveIssues = [], onView, onStatus, onReply }: {
  findings: Finding[];
  storedIds: ReadonlySet<string>;
  map?: ReviewAnalysisMap | null;
  traceability?: ReviewTraceabilitySnapshot | null;
  coverageInterrupted: boolean;
  issuesUnavailable: boolean;
  progress?: string;
  completion?: string;
  liveIssues?: ReadonlyArray<{ key: string; title: string }>;
  onView: (id: string) => void;
  onStatus?: (id: string, status: 'dismissed' | 'new') => Promise<void>;
  onReply?: (finding: Finding, reply: string) => Promise<void>;
}) {
  const groups = map ? groupReviewFeatures(map, findings, traceability) : [];
  const names = new Map<string, string>();
  const coverage = groups.map(({ feature, operations }) => {
    const name = featureDisplayName(feature.label);
    operations.forEach(operation => names.set(operation.id, name));
    const assessments = operations.flatMap(operation => operation.assessments);
    const checked = assessments.some(assessment => assessment.status === 'assessed');
    const complete = operations.every(operation =>
      new Set(operation.assessments.filter(assessment => assessment.status === 'assessed').map(assessment => assessment.domain)).size === 4
      && !operation.unresolved.length && operation.entryPointStatus !== 'unresolved'
      && operation.entryPointStatus !== 'external_boundary' && operation.analysisKind !== 'plain_text_logic');
    return { id: feature.id, name, state: checked ? complete ? 'Checked' : 'Partial' : 'Not checked' };
  });
  const counts = ['Checked', 'Partial', 'Not checked'].map(state => ({ state, count: coverage.filter(item => item.state === state).length }));
  const orderedIssues = [...findings].sort((a, b) => Number(storedIds.has(b.id)) - Number(storedIds.has(a.id)));
  const behaviorName = (finding: Finding) => {
    const named = names.get(finding.location?.sourceLocator?.analysis?.featureId ?? '') ?? finding.affectedFeature;
    if (named) return named;
    const refs = findingSourceReferences(finding);
    const matches = new Set<string>();
    for (const { feature, operations } of groups) {
      if (operations.some(operation => refs.some(ref => ref.lineNumber && operation.entryPoints.some(point =>
        point.filePath.replaceAll('\\', '/') === ref.filePath.replaceAll('\\', '/')
        && (point.lineNumber === ref.lineNumber || (operation.sourceRange && ref.lineNumber! >= operation.sourceRange.lineStart && ref.lineNumber! <= operation.sourceRange.lineEnd))
      )))) matches.add(featureDisplayName(feature.label));
    }
    return matches.size > 0 ? [...matches].join(' / ') : undefined;
  };
  const renderIssue = (finding: Finding, crossCutting = false, grouped = false, initiallyExpanded = true) => <ReviewIssue key={finding.id} finding={finding}
    crossCutting={crossCutting}
    grouped={grouped}
    initiallyExpanded={initiallyExpanded}
    behavior={behaviorName(finding)}
    expectation={traceability?.status === 'available' ? traceability.records.find(record => record.requirementId === finding.requirementId && record.evidenceStatus !== 'stale' && record.evidenceStatus !== 'unavailable')?.title : undefined}
    onView={onView} onStatus={storedIds.has(finding.id) ? onStatus : undefined} onReply={onReply} />;
  const renderGroup = ({ key, title, members, representative }: ReturnType<typeof groupFindings>[number], crossCutting = false) => {
    if (members.length === 1) return renderIssue(members[0], crossCutting);
    return <div className="review-issue-group" key={key}>
      <IssueGroupHeader title={title} members={members} onView={() => onView(representative.id)}
        editableIds={storedIds} onStatus={onStatus} />
      <table aria-label={title}>
        <tbody>{members.map((finding, index) => <tr key={finding.id}><td>
          {renderIssue(finding, crossCutting, true, index === 0)}
        </td></tr>)}</tbody>
      </table>
    </div>;
  };

  return <>
    <section className="review-behavior-coverage" aria-label="Review coverage">
      <h2>Review coverage</h2>
      {coverage.length ? <>
        <div className="review-coverage-bar" aria-hidden="true">{counts.filter(item => item.count).map(({ state, count }) =>
          <span key={state} data-state={state} style={{ flexGrow: count }} />)}</div>
        <p className="review-coverage-legend" aria-live="polite">
          {counts.map(({ state, count }) => <span key={state}><i data-state={state} aria-hidden="true" />{count} {state.toLowerCase()}</span>)}</p>
        {coverageInterrupted && counts[2].count > 0 && <p>The review stopped before it could assess every discovered behavior.</p>}
        {map?.coverage.featureInventoryTruncated && <p>Behavior inventory is incomplete.</p>}
        <details><summary>See all behaviors ({coverage.length})</summary>
          <table className="review-sidebar-findings review-coverage-table" aria-label="Behavior coverage">
            <thead><tr><th scope="col">Behavior</th><th scope="col">Status</th></tr></thead>
            <tbody>{coverage.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.state}</td></tr>)}</tbody>
          </table>
        </details>
      </> : <p>Behavior coverage has not been recorded.</p>}
    </section>
    <section className="review-issues" aria-label="Issues">
      <h3>Issues</h3>
      {REVIEW_ISSUE_CATEGORIES.map(category => {
        const groupsInCategory = groupFindings(orderedIssues.filter(finding => reviewIssueCategory(finding) === category));
        const categoryLiveIssues = liveIssues.filter(issue => reviewIssueCategory({ title: issue.title, category: '' }) === category);
        if (!groupsInCategory.length && !categoryLiveIssues.length) return null;
        return <section key={category} className="review-issue-category" aria-label={category}>
          <h4>{progress && <span className="review-focus-light" data-active={categoryLiveIssues.length > 0} aria-label={categoryLiveIssues.length > 0 ? 'Issues reported during this review' : undefined} />}{category}</h4>
          {groupsInCategory.map(group => renderGroup(group, category === 'System'))}
          {categoryLiveIssues.length > 0 && <table className="review-sidebar-findings review-coverage-table" aria-label={`Live ${category} issues`}>
            <thead><tr><th scope="col">Issue</th><th scope="col">Status</th></tr></thead>
            <tbody>{categoryLiveIssues.map(issue => <tr key={issue.key} id={`review-finding-${issue.key}`} tabIndex={-1}>
              <th scope="row">{shortReviewIssueTitle(issue.title)}</th><td>Awaiting final review</td>
            </tr>)}</tbody>
          </table>}
        </section>;
      })}
      {!findings.length && !liveIssues.length && <p>{issuesUnavailable ? 'Saved issues are unavailable.' : 'No issues recorded yet.'}</p>}
      {progress && <p className="review-issue-progress" role="status"><span className="review-focus-light" data-active="true" aria-hidden="true" />{progress}</p>}
      {completion && <p className="review-issue-progress">{completion}</p>}
    </section>
  </>;
}

function IssueSourceCount({ findings }: { findings: Finding[] }) {
  const evidence = rankFindingEvidence(findings, false)[0];
  const lines = evidence?.lines ?? 0;
  const files = evidence?.files.length ?? 0;
  return <span className="review-issue-count">{lines} {lines === 1 ? 'line' : 'lines'} across {files} {files === 1 ? 'file' : 'files'}</span>;
}

function IssueGroupHeader({ title, members, onView, editableIds, onStatus }: {
  title: string;
  members: Finding[];
  onView: () => void;
  editableIds: ReadonlySet<string>;
  onStatus?: (id: string, status: 'dismissed' | 'new') => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const statuses = new Set(members.map(issueStatusLabel));
  const label = statuses.size === 1 ? issueStatusLabel(members[0]) : 'Mixed';
  const editable = members.filter(item => editableIds.has(item.id) && issueStatusLabel(item) !== 'Resolved');
  const reopening = editable.length > 0 && editable.every(item => issueStatusLabel(item) === 'Ignored');
  const targets = editable.filter(item => reopening || issueStatusLabel(item) === 'Open');
  const action = reopening ? 'Reopen issue' : 'Ignore issue';

  async function update() {
    if (!onStatus || pending) return;
    setPending(true);
    setError('');
    let failures = 0;
    for (const item of targets) {
      try {
        await onStatus(item.id, reopening ? 'new' : 'dismissed');
      } catch {
        failures++;
      }
    }
    if (failures) setError('Some issue statuses could not be saved.');
    setPending(false);
  }

  return <>
    <header className="review-issue-group-header"><div className="review-issue-title"><h4 title={title}>{shortReviewIssueTitle(title)}</h4><IssueSourceCount findings={members} /></div><div>
      <StatusBadge label={label} tone={label === 'Resolved' ? 'success' : 'neutral'} />
      <button type="button" className="command-icon-button" aria-label={`View issue: ${title}`} title="View issue" onClick={onView}><Eye size={16} aria-hidden="true" /></button>
      {onStatus && targets.length > 0 && <button type="button" className="command-icon-button" aria-label={action} title={action} disabled={pending} onClick={() => void update()}>
        {reopening ? <RotateCcw size={16} aria-hidden="true" /> : <Ban size={16} aria-hidden="true" />}
      </button>}
    </div></header>
    {error && <p role="alert">{error}</p>}
  </>;
}

function issueStatusLabel(finding: Finding) {
  const status = effectiveFindingStatus(finding);
  return status === 'fixed' ? 'Resolved' : status === 'dismissed' ? 'Ignored' : 'Open';
}

function ReviewIssue({ finding, crossCutting, grouped, initiallyExpanded, behavior, expectation, onView, onStatus, onReply }: {
  finding: Finding;
  crossCutting: boolean;
  grouped: boolean;
  initiallyExpanded: boolean;
  behavior?: string;
  expectation?: string;
  onView: (id: string) => void;
  onStatus?: (id: string, status: 'dismissed' | 'new') => Promise<void>;
  onReply?: (finding: Finding, reply: string) => Promise<void>;
}) {
  const [reply, setReply] = useState('');
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<'status' | 'reply' | null>(null);
  const busy = useRef(false);
  const status = effectiveFindingStatus(finding);
  const label = issueStatusLabel(finding);
  const statusAction = label === 'Open' ? 'Ignore issue' : 'Reopen issue';
  const files = new Map<string, FindingSourceReference[]>();
  const lineCounts = rankFindingEvidence([finding], false)[0]?.files;
  for (const ref of findingSourceReferences(finding)) {
    const path = ref.filePath.replaceAll('\\', '/');
    const existing = files.get(path);
    if (existing) existing.push(ref);
    else files.set(path, [ref]);
  }
  const description = plainReviewText(finding.description);
  const flow = (finding.location?.logicFlow ?? []).map(plainReviewText).filter(Boolean);
  const fileNotes = new Map<string, string>();
  const sentences = description.match(/[^]*?(?:[.!?](?=\s+[A-Z]|$)|$)/g)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
  const verification = sentences.find(sentence => /^(?:to verify|verify|confirm|check)\b/i.test(sentence));
  const observations = sentences.filter(sentence => sentence !== verification);
  const codeNames = /\b(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[a-z]+[A-Z][\w$]*|[A-Za-z_$][\w$]*(?=\())\b/g;
  for (const step of [...flow, ...observations]) {
    const normalized = step.replaceAll('\\', '/');
    const matches = [...files.keys()].filter(path => {
      const offset = normalized.indexOf(path);
      return offset >= 0 && (offset === 0 || !/[\w./-]/.test(normalized[offset - 1]));
    });
    if (!matches.length) {
      const names = step.match(codeNames) ?? [];
      for (const [path, refs] of files) {
        if (names.some(name => refs.some(ref => ref.excerpt?.match(codeNames)?.includes(name)))) matches.push(path);
      }
      if (!matches.length && files.size === 1) matches.push(...files.keys());
    }
    if (matches.length !== 1) continue;
    const path = matches[0];
    const note = step.replace(/^\s*[^\s]+:\d+\s*[:–—-]?\s*/, '');
    const previous = fileNotes.get(path);
    if (note && (!previous || note.length < previous.length)) fileNotes.set(path, note);
  }
  const impact = observations.slice(1).find(sentence => /\b(?:consequently|results? in|leads? to|can|could|may)\b/i.test(sentence));
  const summary = [observations[0], impact].filter(Boolean).join(' ');
  const uncertain = finding.location?.sourceLocator?.citationEvidence?.verification === 'needs_verification';
  const risk = findingRiskLevel(finding);
  const run = async (action: 'status' | 'reply', operation: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    setNotice('');
    try {
      await operation();
      if (action === 'reply') {
        setReply('');
        setNotice('Feedback added to this review.');
      }
    } catch (error) {
      setNotice(userFacingError(error, action === 'reply' ? 'Feedback could not be sent.' : 'Issue status could not be saved.'));
    } finally {
      busy.current = false;
      setPending(null);
    }
  };
  return <article className="review-issue" id={`review-finding-${finding.id}`} tabIndex={-1}>
    {!grouped && <header><div className="review-issue-title"><h4 title={finding.title}>{shortReviewIssueTitle(finding.title)}</h4><IssueSourceCount findings={[finding]} /></div><div>
      <StatusBadge label={label} tone={label === 'Resolved' ? 'success' : 'neutral'} />
      <button type="button" className="command-icon-button" aria-label={`View issue: ${finding.title}`} title="View issue" onClick={() => onView(finding.id)}><Eye size={16} aria-hidden="true" /></button>
      {onStatus && status !== 'fixed' && <button type="button" className="command-icon-button" aria-label={statusAction} title={statusAction} disabled={pending !== null}
        onClick={() => void run('status', () => onStatus(finding.id, status === 'dismissed' ? 'new' : 'dismissed'))}>
        {status === 'dismissed' ? <RotateCcw size={16} aria-hidden="true" /> : <Ban size={16} aria-hidden="true" />}
      </button>}
    </div></header>}
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary><span className="review-issue-row"><strong>{behavior || (finding.filePath ? finding.filePath.split(/[\\/]/).at(-1) : 'Behavior not recorded')}</strong>
        <span className="review-issue-count">{files.size} {files.size === 1 ? 'file' : 'files'}</span></span></summary>
      {expectation && <p>{codeProse(expectation)}</p>}
      {(risk || uncertain || finding.verifier === 'deterministic') && <p>{risk && <StatusBadge label={`${risk} risk`} />}{' '}
        {uncertain ? 'Source references need verification.' : finding.verifier === 'deterministic' ? 'Rule check · Confirm the behavior before treating this as a defect.' : ''}</p>}
      {[...files].map(([path, refs]) => <section key={path} className="review-issue-file">
        <h5><EvidenceFileControl path={path} findings={[finding]} tooltip />
          <span className="review-issue-count">{lineCounts?.find(file => file.path === path)?.lines ?? 0} highlighted</span></h5>
        {expanded && <IssueSourceContext key={JSON.stringify(refs)} projectId={finding.projectId}
          reviewId={finding.latestOccurrence?.reviewId ?? finding.sessionId} referencesJson={JSON.stringify(refs)} />}
        {fileNotes.has(path) && <div className="review-issue-line-notes"><p>{codeProse(fileNotes.get(path)!)}</p></div>}
      </section>)}
      {files.size > 0 && <hr className="review-issue-evidence-divider" />}
      <div className="review-issue-overview">
        <h5>Issue overview</h5>
        <p className="review-issue-prose">{codeProse(summary)}{' '}{codeProse(verification ?? (finding.evidenceGap
          ? plainReviewText(finding.recommendation)
          : 'Check the cited code against the expected behavior.'))}</p>
      </div>
      {onReply && <footer><form onSubmit={event => { event.preventDefault(); if (reply.trim()) void run('reply', () => onReply(finding, reply.trim())); }}>
        <input aria-label="Write feedback" placeholder="Write feedback" value={reply} onChange={event => setReply(event.target.value)} maxLength={2000} disabled={pending === 'reply'} />
        <button type="submit" className="command-icon-button" aria-label="Send issue feedback" disabled={!reply.trim() || pending !== null}><Send size={16} aria-hidden="true" /></button>
      </form></footer>}
    </details>
    {notice && <p role="status">{notice}</p>}
  </article>;
}
