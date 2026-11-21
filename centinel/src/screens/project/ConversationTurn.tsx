import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../api/client';
import type { ConversationRequest } from '../../check/conversationTypes';
import type { Screen } from '../../types';

export function ConversationTurn({ request, onNavigate }: { request: ConversationRequest; onNavigate: (screen: Screen) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (cancel: boolean) => {
    setBusy(true);
    try {
      if (cancel) await api.cancelConversationRequest(request.projectId, request.id);
      else await api.confirmConversationRequest(request.projectId, request.id, request.revision);
      setError(null);
    } catch { setError('The request changed or could not be saved. Refresh and try again.'); }
    finally { setBusy(false); }
  };
  const owner = sessionStorage.getItem('centinel:supabase-user-id');
  const recalled = request.recall?.status === "recalled";
  const active = ['accepted', 'planning', 'running', 'awaiting_permission'].includes(request.state);
  return <div className="pc-turn pc-conversation-request">
    <div className="pc-msg is-me">
      {request.input.text}
      {!!request.input.references.length && <>
        <span className="pc-sent-context-caption">Attachments · names as sent</span>
        <ul className="pc-sent-context" aria-label="Included with this message">
        {request.input.references.map((reference, index) => {
          const kind = reference.findingId ? 'Code problem' : reference.testId ? 'Browser problem'
            : reference.artifactId ? 'Source' : 'Check';
          const sent = request.input.referenceLabels?.[index];
          const saved = request.resolvedAttachmentNames?.[index];
          const label = sent || saved;
          return <li key={JSON.stringify(reference)}>
            <span>{kind}{label ? ':' : ' attached'}</span>{label && <> {label}</>}
            {saved && sent && saved !== sent && <small>Saved name: {saved}</small>}
          </li>;
        })}
        </ul>
      </>}
    </div>
    {request.context?.some(item => item.unavailable) && <p className="pc-sub">Some attached evidence was unavailable. Attachment names show what was sent, not what could be verified.</p>}
    {request.reply && <>
      <p className="pc-label"> {recalled ? "Quoted previous reply" : "AI analysis"}</p>
      {request.replyFormat === 'markdown'
        ? <div className="pc-ai-reply"><ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            disallowedElements={['a', 'img', 'input']}
            unwrapDisallowed
            components={{
              h1: ({ children }) => <h3>{children}</h3>,
              h2: ({ children }) => <h3>{children}</h3>,
              table: ({ children }) => <div className="pc-ai-table"><table>{children}</table></div>,
            }}
          >{request.reply}</ReactMarkdown></div>
        : <p className="pc-ai-text pc-ai-reply-literal">{request.reply}</p>}
    </>}
    {request.citations?.length ? <details><summary>{recalled ? "Source" : "Saved evidence"}</summary><ul>{request.citations.map(id => {
      const [kind, value] = id.split(':');
      const reference = request.input.references.find(ref => ref.findingId === value || ref.reviewId === value || ref.autoTestId === value);
      return <li key={id}>{kind === 'finding' && reference?.reviewId
        ? <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'review-finding', projectId: request.projectId, sessionId: reference.reviewId!, findingId: value })}>Open code evidence</button>
        : kind === 'review' ? <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'review-activity', projectId: request.projectId, sessionId: value })}>Open saved Review</button>
          : <span>{kind === 'browser' ? 'Saved browser observations' : kind === 'conversation' ? 'Earlier reply in this project' : 'Saved source context'}</span>}</li>;
    })}</ul></details> : null}
    <p className="pc-label" role="status">{request.state === 'completed' && !request.reviewId && !request.autoTestId ? 'Response saved' : request.state.replaceAll('_', ' ')}</p>
    {request.error && <p role="status">{request.error}</p>}
    {owner === request.ownerId && active && <div className="pc-actions">
      {request.state === 'awaiting_permission' && <button type="button" className="ck-button is-small" disabled={busy} onClick={() => void act(false)}>Run this scope</button>}
      <button type="button" className="ck-button is-small" disabled={busy} onClick={() => void act(true)}>Cancel</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
