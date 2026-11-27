import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Copy, FileSearch, ListChecks, LoaderCircle, Quote, SquareChartGantt, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import { conversationQuestionOptions, eligibleReplySource, isCodeReviewChoice, rememberAcknowledgedRequest, replyExcerpt } from '../../check/conversation';
import { readPrefs } from '../../check/projectPrefs';
import type { ConversationRequest, SavedConversationExplanation } from '../../check/conversationTypes';
import type { Artifact } from '../../types';
import { ConversationEvidence } from './ConversationEvidence';
import { ConversationFailure, conversationFailureDetails } from './ConversationFailure';
import { ConversationMessage, copyConversationText, MessageTime } from './ConversationMessage';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { ConversationAttachment, type ConversationAttachmentKind } from '../check/ConversationAttachment';
import { ConversationQuotePreview } from '../check/ConversationQuotePreview';
import { checkWorkLabels, WorkRow, type CheckWorkBranches } from './CheckWorkActivity';
import { Icon } from '../../components/Icon';

const traceStages: ReadonlyMap<string, string> = new Map([
  ['accepted', 'Request saved'], ['planning', 'Planning started'], ['context_resolved', 'Context resolved'],
  ['scope_validated', 'Action and scope validated'], ['permission_changed', 'Permission changed'],
  ['awaiting_permission', 'Waiting for approval'], ['running', 'Request entered execution'],
  ['current_sources_frozen', 'Current sources recorded'], ['criteria_bound', 'Browser criteria bound'],
  ['child_admitted', 'Child execution recorded'], ['completed', 'Request completed'],
  ['failed', 'Request failed'], ['paused', 'Request paused'], ['interrupted', 'Request interrupted'],
  ['cancelled', 'Request cancelled'],
]);

const activeStates = new Set(['accepted', 'planning', 'running']);

function elapsedLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function HarnessTrace({ request }: { request: ConversationRequest }) {
  const start = Date.parse(request.createdAt);
  return <details className="pc-harness-trace">
    <summary>Harness trace</summary>
    <dl>
      <dt>Requested mode</dt><dd>{({ code: 'Code', browser: 'Browser', both: 'Code and Browser' })[request.input.mode]}</dd>
      <dt>Selected action</dt><dd>{request.action ?? 'None recorded'}</dd>
      <dt>Attached references</dt><dd>{request.input.references.length}</dd>
      <dt>Resolved evidence</dt><dd>{request.context ? `${request.context.length} total, ${request.context.filter(item => item.unavailable).length} unavailable` : 'None recorded'}</dd>
      {request.recall && <><dt>Earlier turns supplied</dt><dd>{request.recall.status === 'unavailable' ? 'Unavailable'
        : `${request.recall.turns}${request.recall.status === 'limited' ? ' (limit reached)' : ''}`}</dd></>}
      {request.citations && <><dt>Validated citations</dt><dd>{request.citations.length}</dd></>}
      {request.action === 'code' && <><dt>Selected code files</dt><dd>{request.scope?.length ?? 'None recorded'}</dd></>}
      <dt>Code sources recorded</dt><dd>{request.executionSources?.length ?? 'None recorded'}</dd>
      <dt>Browser targets bound</dt><dd>{request.verificationBindings?.length ?? 'None recorded'}</dd>
      <dt>Child execution</dt><dd>{request.reviewId ? 'Code Review recorded' : request.autoTestId ? 'Browser session recorded' : 'None recorded'}</dd>
      {request.failureStage && <><dt>Stopped during</dt><dd>{({ context: 'Context', planning: 'Planning', validation: 'Response validation', execution: 'Execution' })[request.failureStage]}</dd></>}
    </dl>
    <ol aria-label="Saved request stages">{request.events?.map((event, index) => {
      const label = traceStages.get(event.stage);
      if (!label) return null;
      const elapsed = Date.parse(event.at) - start;
      return <li key={index}>{label}{Number.isFinite(elapsed) && elapsed >= 0 && <span> +{(elapsed / 1000).toFixed(2)} s</span>}</li>;
    })}</ol>
  </details>;
}

function messageAttachments(request: ConversationRequest, explanation: SavedConversationExplanation | undefined, artifacts: Artifact[]) {
  const attachments = new Map<string, { kind: ConversationAttachmentKind; label: string }>();
  const evidenceTitle = (id: string) => explanation?.sections.find(section => section.evidenceId === id)?.title;
  request.input.references.forEach((reference, index) => {
    const named = request.resolvedAttachmentNames?.[index] || request.input.referenceLabels?.[index];
    const problemId = reference.findingId ? `finding:${reference.findingId}`
      : reference.testId && reference.autoTestId ? `browser:${reference.autoTestId}:${reference.testId}` : undefined;
    if (problemId) {
      attachments.set(problemId, { kind: 'problem', label: evidenceTitle(problemId) || named || (reference.findingId ? 'Code problem' : 'Browser problem') });
    } else if (reference.reviewId || reference.autoTestId) {
      const evidenceId = reference.reviewId ? `review:${reference.reviewId}` : `browser:${reference.autoTestId}`;
      const key = reference.checkId ? `check:${reference.checkId}:${reference.reviewId ?? ''}:${reference.autoTestId ?? ''}` : evidenceId;
      if (!attachments.has(key)) attachments.set(key, { kind: 'check', label: named || evidenceTitle(evidenceId) || reference.checkFocus || 'Saved Check' });
    }
    if (reference.artifactId) {
      const artifact = artifacts.find(item => item.id === reference.artifactId && item.projectId === request.projectId);
      const kind = artifact?.source === 'documents' || artifact?.source === 'drive' ? 'document' : 'library';
      attachments.set(`artifact:${reference.artifactId}`, { kind, label: named || artifact?.fileName || 'Saved file' });
    }
  });
  return [...attachments];
}

export function ConversationTurn({ request, onQuote, replySourceExcerpt, onOpenProblem, onOpenActivity, activityCheckName, executionCard, anchorKey, artifacts = [] }: {
  request: ConversationRequest;
  anchorKey?: string;
  onQuote?: () => void;
  replySourceExcerpt?: string;
  onOpenProblem?: (evidenceId: string, browserRunId?: string) => void;
  onOpenActivity?: (evidenceId: string) => (() => void) | undefined;
  activityCheckName?: (evidenceId: string) => string | undefined;
  executionCard?: ReactNode | ((renderProgress: (work: CheckWorkBranches, currentWork?: ReactNode) => ReactNode) => ReactNode);
  artifacts?: Artifact[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<(SavedConversationExplanation & { unavailable: number })>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copyStatus, setCopyStatus] = useState('');
  const [progressOpen, setProgressOpen] = useState(false);
  const [olderQuote, setOlderQuote] = useState<{ id: string; excerpt: string }>();
  const quoteId = request.replyTo?.status === 'resolved' ? request.replyTo.turnId : undefined;
  useEffect(() => {
    const owner = sessionStorage.getItem('centinel:supabase-user-id');
    if (!progressOpen || !quoteId || replySourceExcerpt || owner !== request.ownerId || typeof api.conversationRequest !== 'function') return;
    let mounted = true;
    void api.conversationRequest(request.projectId, quoteId).then(row => {
      if (mounted && row?.id === quoteId && eligibleReplySource(row, request.projectId, owner)) setOlderQuote({ id: quoteId, excerpt: replyExcerpt(row) });
    }).catch(() => { /* The referenced reply is unavailable on this device. */ });
    return () => { mounted = false; };
  }, [progressOpen, quoteId, replySourceExcerpt, request.ownerId, request.projectId]);
  useEffect(() => {
    if (!activeStates.has(request.state)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.state]);
  const active = activeStates.has(request.state);
  useEffect(() => { setProgressOpen(false); }, [active]);
  const elapsed = (active ? now : Date.parse(request.updatedAt)) - Date.parse(request.createdAt);
  const namedActions = new Map<string, { icon: typeof FileSearch; text: ReactNode; label: string; order: number }>();
  const recordAction = (id: string, icon: typeof FileSearch, label: string, text: ReactNode = label, order = request.events.length) =>
    namedActions.set(id, { icon, label, text, order });
  const referenceRows = new Map(request.events.flatMap((event, order) => event.activity?.references?.map(item => [item.id, { label: item.label, order }] as const) ?? []));
  for (const [id, { label: savedLabel, order }] of referenceRows) {
    if (id.startsWith('conversation:')) continue;
    const file = id.startsWith('artifact:');
    const problem = id.startsWith('finding:') || id.startsWith('browser:') && id.split(':').length === 3;
    const action = file ? 'Read' : problem ? 'Opened Problem' : 'Opened Check';
    const label = file || problem ? savedLabel : activityCheckName?.(id) || savedLabel;
    const open = onOpenActivity?.(id);
    recordAction(id, file ? FileSearch : problem ? TriangleAlert : SquareChartGantt, `${action} ${label}`,
      <>{action} {open ? <button type="button" className="ck-link" onClick={open}>{label}</button> : file ? <code>{label}</code> : <strong>{label}</strong>}</>, order);
  }
  const quoteEvent = request.events.find(event => event.stage === 'loading_quoted_reply');
  if (quoteEvent) {
    const characters = Array.from(replySourceExcerpt ?? (olderQuote?.id === quoteId ? olderQuote?.excerpt : undefined) ?? '');
    const preview = characters.slice(0, 40).join('') + (characters.length > 40 ? '…' : '');
    recordAction('quote', Quote, 'Checking the quote', <>Checking the quote{preview && <> · <span className="pc-work-detail">“{preview}”</span></>}</>, request.events.indexOf(quoteEvent));
  }
  const scopeEvent = [...request.events].reverse().find(event => event.stage === 'scope_validated' && event.activity?.scopePaths?.length);
  const scopePaths = scopeEvent?.activity?.scopePaths ?? (request.scope ?? []).flatMap(id => {
    const artifact = artifacts.find(file => file.id === id && file.projectId === request.projectId);
    return artifact?.filePath ? [artifact.filePath] : [];
  });
  if (request.action === 'code' && scopePaths.length) recordAction('scope', ListChecks, 'Checking for the review scope',
    <>Checking for the review scope{': '}{[...new Set(scopePaths)].map((path, index) => <span key={path}>{index > 0 && ', '}<code>{path}</code></span>)}</>, scopeEvent ? request.events.indexOf(scopeEvent) : undefined);
  request.events.forEach((event, order) => {
    if (event.stage === 'question_answered') recordAction(`answered:${order}`, ListChecks, 'Received your answer', undefined, order);
  });
  if (request.reviewId) recordAction('code', SquareChartGantt, checkWorkLabels.code);
  if (request.autoTestId) recordAction('browser', SquareChartGantt, checkWorkLabels.browser);
  const orderedActions = [...namedActions].sort(([, a], [, b]) => a.order - b.order);
  const latestActivity = orderedActions.at(-1)?.[1].label;
  const attachmentUrls = new Set((request.input.text.match(/https?:\/\/[^\s<>]+/gi) ?? []).flatMap(value => {
    try { const url = new URL(value.replace(/[),.!?\]]+$/, '')); return url.username || url.password ? [] : [url.href]; } catch { return []; }
  }));
  const copy = async (text: string) => {
    try {
      await copyConversationText(text);
      setCopyStatus('Reply copied');
    } catch { setCopyStatus('Copy failed'); }
  };
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(''), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const confirm = async () => {
    setBusy(true);
    try {
      const updated = await api.confirmConversationRequest(request.projectId, request.id, request.revision);
      if (updated?.ownerId === sessionStorage.getItem('centinel:supabase-user-id')) rememberAcknowledgedRequest(request.projectId, updated);
      setError(null);
    } catch { setError('The request changed or could not be saved. Refresh and try again.'); }
    finally { setBusy(false); }
  };
  const owner = sessionStorage.getItem('centinel:supabase-user-id');
  const explanation = evidence?.sections.length ? evidence : request.explanation;
  const attachments = messageAttachments(request, explanation, artifacts);
  const options = conversationQuestionOptions(request);
  const selected = request.selectedOption === undefined ? undefined : options[request.selectedOption];
  const failure = conversationFailureDetails(request);
  const showReply = !failure && !!request.reply && (!executionCard || request.state === 'awaiting_permission')
    && (request.replyOrigin !== 'saved_evidence' || !explanation?.sections.length
      || (request.replyFormat === 'markdown' && !request.answerUnavailable));
  const continueReview = async () => {
    if (request.selectedOption === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.answerConversationQuestion(request.projectId, request.id, {
        revision: request.revision, questionId: request.id,
        answer: { kind: 'option', selectedOption: request.selectedOption },
        askFirst: readPrefs(request.projectId).mode === 'ask',
      });
      if (updated?.id !== request.id || !updated.reviewContinuation) throw new Error('Continuation was not acknowledged.');
      if (updated.ownerId === sessionStorage.getItem('centinel:supabase-user-id')) rememberAcknowledgedRequest(request.projectId, updated);
    } catch { setError('The Review could not be prepared. Try again.'); }
    finally { setBusy(false); }
  };
  const hasFinding = request.input.references.some(reference => reference.findingId);
  const canLoadEvidence = owner === request.ownerId && !active && !evidence
    && request.input.references.some(reference => reference.reviewId || reference.autoTestId)
    && (!explanation || explanation.sections.some(section => (section.evidenceId?.startsWith('finding:') || !section.evidenceId && hasFinding)
      && !section.excerpt && !section.sourceWindow));
  const loadEvidence = async () => {
    setEvidenceLoading(true);
    setEvidenceError(null);
    try { setEvidence(await api.conversationEvidence(request.projectId, request.id)); }
    catch { setEvidenceError('Saved evidence could not be loaded. Try again.'); }
    finally { setEvidenceLoading(false); }
  };
  const hasAttachments = !!(request.replyTo || request.input.replyToTurnId || attachments.length);
  const quotedTurnId = request.replyTo?.status === 'unavailable' ? undefined
    : request.replyTo?.turnId ?? request.input.replyToTurnId;
  const message = <ConversationMessage text={request.input.text} at={request.createdAt} attachments={hasAttachments ? <>
      {(request.replyTo || request.input.replyToTurnId) && <ConversationQuotePreview className="pc-reply-attribution"
        projectId={request.projectId} ownerId={request.ownerId} turnId={quotedTurnId}
        preview={request.replyTo?.status === 'resolved' ? replySourceExcerpt : undefined}
        label={request.replyTo?.status === 'unavailable' ? 'Quoted reply unavailable' : 'Quoted reply'}>
        {preview => <>
          <Quote size={14} aria-hidden="true" />
          <div>
            <strong>{request.replyTo?.status === 'unavailable' ? 'Quoted reply unavailable' : 'Quoted reply'}</strong>
            {request.replyTo?.status !== 'unavailable' && preview && <span>{preview}</span>}
          </div>
        </>}
      </ConversationQuotePreview>}
      {!!attachments.length && <ul className="ck-attached ck-conversation-attachments pc-message-attachments" aria-label="Message attachments">
        {attachments.map(([key, item]) => <ConversationAttachment key={key} {...item} />)}
      </ul>}
    </> : undefined} />;
  if (options.length && selected === undefined && !failure) return <div className="pc-turn" data-conversation-key={anchorKey}>{message}</div>;
  const progress = (work: CheckWorkBranches = {}, currentWork?: ReactNode) => {
    const progressSummary = <>
        {active && <Icon icon={LoaderCircle} className="ci-spin" />}
        <span>{active ? `Working for ${elapsedLabel(elapsed)}` : `Worked for ${elapsedLabel(elapsed)}`}</span>
        {active && !progressOpen && (currentWork || latestActivity) && <span className="pc-current-activity">{currentWork || latestActivity}</span>}
    </>;
    const hasProgressDetails = namedActions.size > 0 || !!(work.code || work.browser);
    return (active || request.events.length > 0 || hasProgressDetails) && <section className="pc-progress" aria-label="ORIN progress">
      {hasProgressDetails ? <button type="button" className="pc-worked" aria-expanded={progressOpen} onClick={() => setProgressOpen(value => !value)}>
        {progressSummary}{progressOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
      </button> : <span className="pc-worked pc-worked-label">{progressSummary}</span>}
      {hasProgressDetails && progressOpen && <div className="pc-progress-body">
        <ul className="pc-activity-list" role="list" aria-label="Saved activity">
          {orderedActions.map(([id, action]) => {
            const branch = id === 'code' || id === 'browser' ? work[id] : undefined;
            return branch ? <li key={id} className="pc-activity-branch">{branch}</li>
              : <WorkRow key={id} icon={action.icon}>{action.text}</WorkRow>;
          })}
          {!request.reviewId && work.code && <li className="pc-activity-branch">{work.code}</li>}
          {!request.autoTestId && work.browser && <li className="pc-activity-branch">{work.browser}</li>}
        </ul>
      </div>}
    </section>;
  };
  return <div className="pc-turn pc-conversation-request" data-conversation-key={anchorKey}>
    {message}
    {typeof executionCard === 'function' ? executionCard(progress) : <>{progress()}{executionCard}</>}
    {explanation?.sections.length ? <ConversationEvidence explanation={explanation} projectId={request.projectId} onOpenProblem={onOpenProblem} /> : null}
    {request.reviewContinuation && <>
      <p className="pc-label">Question</p>
      <div className="pc-markdown"><ReactMarkdown skipHtml disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{request.reviewContinuation.question}</ReactMarkdown></div>
      {selected && <p className="pc-msg is-me"><strong>You selected</strong> {selected}</p>}
    </>}
    {showReply && selected && !request.reviewContinuation && <p className="pc-label pc-reply-heading">Question</p>}
    {showReply && <div className={`pc-agent-message${explanation?.sections.length ? ' is-evidence-reply' : ''}`}>
    {request.replyOrigin === 'saved_recall' || request.replyFormat !== 'markdown'
      ? <p className="pc-ai-text pc-ai-reply-literal">{request.reply}</p>
      : <div className="pc-markdown pc-ai-reply"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img', 'input']} unwrapDisallowed
          components={{
            a: ({ children, href }) => {
              let url: URL | undefined;
              try { if (href) url = new URL(href); } catch { /* Render unsupported destinations as text. */ }
              if (!url || !attachmentUrls.has(url.href)) return <span>{children}</span>;
              const destination = url.href;
              return <a href={destination} onClick={event => { event.preventDefault(); void openExternalUrl(destination); }}>{children}</a>;
            },
            h1: ({ children }) => <h3>{children}</h3>,
            h2: ({ children }) => <h3>{children}</h3>,
            table: ({ children }) => <div className="pc-table-scroll"><table>{children}</table></div>,
          }}>
          {request.reply}
        </ReactMarkdown></div>}
    <div className="pc-response-actions" role="group" aria-label="Reply actions">
      <MessageTime at={request.updatedAt} />
      <button type="button" className="pc-message-action" aria-label="Copy reply" title="Copy reply" onClick={() => void copy(request.reply!)}>
        <Copy size={14} aria-hidden="true" />
      </button>
      {onQuote && <button type="button" className="pc-message-action" aria-label="Quote reply" title="Quote reply" onClick={onQuote}>
        <Quote size={14} aria-hidden="true" />
      </button>}
    </div></div>}
    {selected && !request.reviewContinuation && <p className="pc-msg is-me"><strong>You selected</strong> {selected}</p>}
    {owner === request.ownerId && request.state === 'completed' && !request.reviewContinuation && !request.reviewId && !request.autoTestId
      && isCodeReviewChoice(request.reply, selected) && <div><button type="button" className="ck-button is-small" disabled={busy} onClick={() => void continueReview()}>Continue Code Review</button></div>}
    {request.fallbackReason && <p role="status">{request.state === 'awaiting_permission' ? 'The app could not start. Approve a Code-only check of the same sources.' : 'The app could not start. This check switched to Code only.'}</p>}
    {canLoadEvidence && <div><button type="button" className="ck-link" disabled={evidenceLoading} onClick={() => void loadEvidence()}>
      {evidenceLoading ? 'Loading saved evidence…' : 'Show saved evidence in chat'}
    </button></div>}
    {evidenceError && <p role="status">{evidenceError}</p>}
    {evidence && (evidence.unavailable > 0 || !evidence.sections.length) && <p role="status">{evidence.sections.length ? 'Some attachments are unavailable. Reattach the saved record to ask about it again.' : 'No saved evidence is available for these attachments.'}</p>}
    {failure ? <div className="pc-agent-message"><ConversationFailure failure={failure} />
      <footer className="pc-response-actions" role="group" aria-label="Reply actions">
        <MessageTime at={request.updatedAt} />
        <button type="button" className="pc-message-action" aria-label="Copy reply" title="Copy reply" onClick={() => void copy(failure.join(' '))}>
          <Copy size={14} aria-hidden="true" />
        </button>
      </footer></div>
      : !executionCard && request.state === 'awaiting_permission' && <p className="pc-label" role="status">Waiting for approval.</p>}
    {request.state === 'cancelled' && <p className="pc-label" role="status">This request was cancelled.</p>}
    {import.meta.env.DEV && import.meta.env.VITE_CENTINEL_HARNESS_TRACE === '1' && owner === request.ownerId && <HarnessTrace request={request} />}
    {owner === request.ownerId && request.state === 'awaiting_permission' && <div className="pc-actions">
      <button type="button" className="ck-button is-small" disabled={busy} onClick={() => void confirm()}>{request.fallbackReason ? 'Run Code check' : 'Run this scope'}</button>
    </div>}
    {copyStatus && <p className="pc-copy-status" role="status">{copyStatus}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
