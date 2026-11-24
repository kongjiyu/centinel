import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Reply } from 'lucide-react';
import { api } from '../../api/client';
import { conversationQuestionOptions, isCodeReviewChoice, rememberAcknowledgedRequest } from '../../check/conversation';
import { readPrefs } from '../../check/projectPrefs';
import type { ConversationReference, ConversationRequest, SavedConversationExplanation } from '../../check/conversationTypes';
import { ConversationEvidence } from './ConversationEvidence';
import { conversationFailureDetails } from './ConversationFailure';

const traceStages: ReadonlyMap<string, string> = new Map([
  ['accepted', 'Request saved'], ['planning', 'Planning started'], ['context_resolved', 'Context resolved'],
  ['scope_validated', 'Action and scope validated'], ['permission_changed', 'Permission changed'],
  ['awaiting_permission', 'Waiting for approval'], ['running', 'Request entered execution'],
  ['current_sources_frozen', 'Current sources recorded'], ['criteria_bound', 'Browser criteria bound'],
  ['child_admitted', 'Child execution recorded'], ['completed', 'Request completed'],
  ['failed', 'Request failed'], ['paused', 'Request paused'], ['interrupted', 'Request interrupted'],
  ['cancelled', 'Request cancelled'],
]);

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

function attachmentLabels(reference: ConversationReference, explanation?: SavedConversationExplanation) {
  const title = (id: string, fallback: string) => explanation?.sections.find(section => section.evidenceId === id)?.title || fallback;
  const browserId = `browser:${reference.autoTestId}${reference.testId ? ':' + reference.testId : ''}`;
  return [
    reference.findingId ? title('finding:' + reference.findingId, 'Code problem')
      : reference.reviewId ? title('review:' + reference.reviewId, 'Code Check') : '',
    reference.autoTestId ? title(browserId, reference.testId ? 'Browser problem' : 'Browser Check') : '',
    reference.artifactId ? 'Saved file' : '',
  ].filter(Boolean);
}

export function ConversationTurn({ request, onOpenFailure, onReplyTo, replySourceExcerpt }: {
  request: ConversationRequest;
  onOpenFailure?: (id: string) => void;
  onReplyTo?: () => void;
  replySourceExcerpt?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<(SavedConversationExplanation & { unavailable: number })>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const act = async (cancel: boolean) => {
    setBusy(true);
    try {
      const updated = cancel ? await api.cancelConversationRequest(request.projectId, request.id)
        : await api.confirmConversationRequest(request.projectId, request.id, request.revision);
      if (updated?.ownerId === sessionStorage.getItem('centinel:supabase-user-id')) rememberAcknowledgedRequest(request.projectId, updated);
      setError(null);
    } catch { setError('The request changed or could not be saved. Refresh and try again.'); }
    finally { setBusy(false); }
  };
  const owner = sessionStorage.getItem('centinel:supabase-user-id');
  const active = ['accepted', 'planning', 'running', 'awaiting_permission'].includes(request.state);
  const explanation = evidence?.sections.length ? evidence : request.explanation;
  const attachments = request.input.references.flatMap(reference => attachmentLabels(reference, explanation));
  const options = conversationQuestionOptions(request);
  const selected = request.selectedOption === undefined ? undefined : options[request.selectedOption];
  const failure = conversationFailureDetails(request);
  const continueReview = async () => {
    if (request.selectedOption === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.answerConversationQuestion(request.projectId, request.id, request.revision, request.selectedOption, readPrefs(request.projectId).mode === 'ask');
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
  const message = <div className="pc-msg is-me">
      {(request.replyTo || request.input.replyToTurnId) && <div className="pc-reply-attribution">
        <Reply size={14} aria-hidden="true" />
        <div>
          <strong>{request.replyTo?.status === 'resolved' ? 'In reply to ORIN'
            : request.replyTo?.status === 'unavailable' ? 'Selected reply unavailable' : 'Reply target selected'}</strong>
          {request.replyTo?.status === 'resolved' && replySourceExcerpt && <span>{replySourceExcerpt}</span>}
        </div>
      </div>}
      <p>{request.input.text}</p>
      {!!attachments.length && <ul className="ck-attached pc-message-attachments" aria-label="Message attachments">{attachments.map((label, index) => <li className="ck-chip" key={index}>{label}</li>)}</ul>}
    </div>;
  if (options.length && selected === undefined && !failure) return <div className="pc-turn">{message}</div>;
  return <div className="pc-turn pc-conversation-request">
    {message}
    {explanation?.sections.length ? <ConversationEvidence explanation={explanation} projectId={request.projectId} /> : null}
    {request.reviewContinuation && <>
      <p className="pc-label">Question</p>
      <div className="pc-markdown"><ReactMarkdown skipHtml disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{request.reviewContinuation.question}</ReactMarkdown></div>
      {selected && <p className="pc-msg is-me"><strong>You selected</strong> {selected}</p>}
    </>}
    {request.reply && request.replyOrigin !== 'saved_evidence' && <p className="pc-label pc-reply-heading">
      {selected && !request.reviewContinuation ? 'Question' : request.replyOrigin === 'saved_recall' ? 'Earlier reply' : request.action === 'code' ? 'Review plan' : 'AI analysis'}
      {onReplyTo && <button type="button" className="pc-reply-action" onClick={onReplyTo}><Reply size={14} aria-hidden="true" /> Reply to</button>}
    </p>}
    {request.reply && (request.replyOrigin !== 'saved_evidence' || !explanation?.sections.length) && (request.replyOrigin === 'saved_recall' || request.replyFormat !== 'markdown'
      ? <p className="pc-ai-text pc-ai-reply-literal">{request.reply}</p>
      : <div className="pc-markdown pc-ai-reply"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['a', 'img', 'input']} unwrapDisallowed
          components={{
            h1: ({ children }) => <h3>{children}</h3>,
            h2: ({ children }) => <h3>{children}</h3>,
            table: ({ children }) => <div className="pc-table-scroll"><table>{children}</table></div>,
          }}>
          {request.reply}
        </ReactMarkdown></div>)}
    {selected && !request.reviewContinuation && <p className="pc-msg is-me"><strong>You selected</strong> {selected}</p>}
    {owner === request.ownerId && request.state === 'completed' && !request.reviewContinuation && !request.reviewId && !request.autoTestId
      && isCodeReviewChoice(request.reply, selected) && <div><button type="button" className="ck-button is-small" disabled={busy} onClick={() => void continueReview()}>Continue Code Review</button></div>}
    {request.fallbackReason && <p role="status">{request.state === 'awaiting_permission' ? 'The app could not start. Approve a Code-only check of the same sources.' : 'The app could not start. This check switched to Code only.'}</p>}
    {request.citations?.some(id => id.startsWith('conversation:')) && <p className="pc-label">Uses an earlier conversation turn</p>}
    {canLoadEvidence && <div><button type="button" className="ck-link" disabled={evidenceLoading} onClick={() => void loadEvidence()}>
      {evidenceLoading ? 'Loading saved evidence…' : 'Show saved evidence in chat'}
    </button></div>}
    {evidenceError && <p role="status">{evidenceError}</p>}
    {evidence && (evidence.unavailable > 0 || !evidence.sections.length) && <p role="status">{evidence.sections.length ? 'Some attachments are unavailable. Reattach the saved record to ask about it again.' : 'No saved evidence is available for these attachments.'}</p>}
    {failure ? <div>{onOpenFailure
      ? <button type="button" className="ck-link" onClick={() => onOpenFailure(request.id)}>View response error</button>
      : <p className="pc-label" role="status">{failure[0]}</p>}</div>
      : <p className="pc-label" role="status">{request.reviewContinuation && (request.state === 'accepted' || request.state === 'planning')
        ? 'Preparing Code Review…' : request.state === 'completed' && !request.reviewId && !request.autoTestId ? 'Response saved' : request.state.replaceAll('_', ' ')}</p>}
    {import.meta.env.DEV && import.meta.env.VITE_CENTINEL_HARNESS_TRACE === '1' && owner === request.ownerId && <HarnessTrace request={request} />}
    {owner === request.ownerId && active && <div className="pc-actions">
      {request.state === 'awaiting_permission' && <button type="button" className="ck-button is-small" disabled={busy} onClick={() => void act(false)}>{request.fallbackReason ? 'Run Code check' : 'Run this scope'}</button>}
      <button type="button" className="ck-button is-small" disabled={busy} onClick={() => void act(true)}>Cancel</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
