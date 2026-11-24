import { useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../../api/client';
import { rememberAcknowledgedRequest } from '../../check/conversation';
import { readPrefs } from '../../check/projectPrefs';
import type { ConversationRequest } from '../../check/conversationTypes';

export function ConversationQuestion({ request, options }: { request: ConversationRequest; options: string[] }) {
  const headingId = useId();
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const select = async (index: number) => {
    setSaving(true);
    setError(false);
    try {
      const updated = await api.answerConversationQuestion(request.projectId, request.id, request.revision, index, readPrefs(request.projectId).mode === 'ask');
      if (updated?.id !== request.id || updated.selectedOption !== index) throw new Error('The selection was not acknowledged.');
      if (updated.ownerId === sessionStorage.getItem('centinel:supabase-user-id')) rememberAcknowledgedRequest(request.projectId, updated);
    } catch { setError(true); }
    finally { setSaving(false); }
  };
  if (!open) return <button type="button" className="ck-button is-small pc-chat-card-toggle" onClick={() => setOpen(true)}>Answer ORIN’s question</button>;
  return <section className="pc-card pc-chat-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="pc-card-title" aria-live="polite">ORIN has a question</h2>
      <div className="pc-markdown"><ReactMarkdown skipHtml disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{request.reply}</ReactMarkdown></div>
      <div className="pc-question-options" role="group" aria-label="Answer options">
        {options.map((option, index) => <button key={option} type="button" className="ck-button"
          disabled={saving} onClick={() => void select(index)}>{option}</button>)}
      </div>
      {saving && <p role="status">Saving your answer…</p>}
      {error && <p role="alert">The answer could not be saved. Try again.</p>}
      <button type="button" className="ck-link pc-chat-card-toggle" disabled={saving} onClick={() => setOpen(false)}>Answer later</button>
  </section>;
}
