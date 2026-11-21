import { useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Braces, ClipboardCheck, Ellipsis, FileText, Image, Monitor, Paperclip, Reply, ScanSearch } from 'lucide-react';
import { api } from '../../api/client';
import type { ConversationRequest } from '../../check/conversationTypes';
import type { Screen } from '../../types';

export function ConversationTurn({ request, onNavigate, onReplyTo, replySourceExcerpt }: {
  request: ConversationRequest; onNavigate: (screen: Screen) => void; onReplyTo?: () => void; replySourceExcerpt?: string;
}) {
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
      {(request.replyTo || request.input.replyToTurnId) && <div className="pc-reply-attribution">
        <Reply size={14} aria-hidden="true" />
        <div>
          <strong>{request.replyTo?.status === 'resolved' ? 'In reply to ORIN'
            : request.replyTo?.status === 'unavailable' ? 'Selected reply unavailable' : 'Reply target selected'}</strong>
          {request.replyTo?.status === 'resolved' && replySourceExcerpt && <span>{replySourceExcerpt}</span>}
        </div>
      </div>}
      <SentAttachments request={request} />
      {request.input.text}
    </div>
    {request.context?.some(item => item.unavailable) && <p className="pc-sub">Some attached evidence was unavailable. Attachment names show what was sent, not what could be verified.</p>}
    {request.reply && <>
      <p className="pc-label pc-reply-heading">
        <span>{recalled ? 'Quoted previous reply' : 'AI analysis'}</span>
        {onReplyTo && <button type="button" className="pc-reply-action" onClick={onReplyTo}>
          <Reply size={14} aria-hidden="true" /> Reply to
        </button>}
      </p>
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

const attachmentPreviewLimit = 3;

function SentAttachments({ request }: { request: ConversationRequest }) {
  const listId = useId();
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const count = request.input.references.length;
  const hiddenCount = Math.max(0, count - attachmentPreviewLimit);
  const expanded = hiddenCount > 0 && (pinned || hovering);
  if (!count) return null;
  const renderAttachment = (reference: ConversationRequest['input']['references'][number], index: number) => {
    const kind = reference.findingId ? 'Code problem' : reference.testId ? 'Browser problem'
      : reference.artifactId ? 'Source' : 'Check';
    const safeName = (value: string | null | undefined) => {
      const name = reference.artifactId ? value?.split(/[\\/]/).pop() : value;
      return name && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(name) ? name : undefined;
    };
    const sent = safeName(request.input.referenceLabels?.[index]);
    const saved = safeName(request.resolvedAttachmentNames?.[index]);
    const isImage = reference.artifactId && /\.(avif|bmp|gif|heic|ico|jpe?g|png|svg|tiff?|webp)$/i.test(sent ?? saved ?? '');
    const isCode = reference.artifactId && /\.(c|cpp|cs|css|go|html|java|js|json|jsx|kt|php|py|rb|rs|sh|sql|ts|tsx|vue|ya?ml)$/i.test(sent ?? saved ?? '');
    const Icon = reference.findingId ? ScanSearch : reference.testId ? Monitor : isImage ? Image
      : isCode ? Braces : reference.artifactId ? FileText : ClipboardCheck;
    return <li key={index} className="pc-sent-attachment">
      <span className="pc-sent-attachment-icon" aria-hidden="true"><Icon size={14} strokeWidth={1.65} /></span>
      <div className="pc-sent-attachment-detail">
        {sent && <span className="pc-sent-attachment-kind">{kind}: </span>}
        <span className="pc-sent-attachment-name">{sent || kind + ' attached'}</span>
        {saved && saved !== sent && <small>Saved name: {saved}</small>}
      </div>
    </li>;
  };
  return <div className="pc-sent-attachments"
    onPointerLeave={() => setHovering(false)}
    onKeyDown={event => {
      if (event.key === 'Escape' && expanded) {
        event.stopPropagation();
        setPinned(false);
        setHovering(false);
      }
    }}
  >
    <div className="pc-sent-context-heading">
      <div className="pc-sent-context-caption">
        <Paperclip size={13} strokeWidth={1.75} aria-hidden="true" />
        <span>Attachments</span><span className="pc-sent-context-count">{count}</span>
        <span className="pc-sent-context-provenance">Names as sent</span>
      </div>
      {hiddenCount > 0 && <button type="button" className="pc-sent-context-more"
        aria-label={expanded ? 'Hide additional attachments' : 'Show all ' + count + ' attachments'}
        aria-expanded={expanded} aria-controls={listId}
        onPointerEnter={event => { if (event.pointerType === 'mouse') setHovering(true); }}
        onClick={() => {
          if (pinned) setHovering(false);
          setPinned(!pinned);
        }}
      ><Ellipsis size={17} strokeWidth={1.8} aria-hidden="true" /><span aria-hidden="true">+{hiddenCount}</span></button>}
    </div>
    <ul className="pc-sent-context" aria-label="Included with this message">
      {request.input.references.slice(0, attachmentPreviewLimit).map(renderAttachment)}
    </ul>
    {hiddenCount > 0 && <ul id={listId} className="pc-sent-context" aria-label="Additional attachments" hidden={!expanded}>
      {expanded && request.input.references.slice(attachmentPreviewLimit).map((reference, index) =>
        renderAttachment(reference, index + attachmentPreviewLimit))}
    </ul>}
  </div>;
}
