import { useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../../api/client';
import { rememberAcknowledgedRequest } from '../../check/conversation';
import { readPrefs } from '../../check/projectPrefs';
import type { ConversationQuestion as SavedQuestion, ConversationRequest } from '../../check/conversationTypes';

type AnswerChoice = { kind: 'option'; selectedOption: number } | { kind: 'custom'; text: string };

function currentQuestion(request: ConversationRequest, supplied?: SavedQuestion, fallbackOptions?: string[]): SavedQuestion | undefined {
  if (supplied) return supplied;
  if (request.pendingQuestionId) return request.questions?.find(question => question.id === request.pendingQuestionId && !question.answer);
  if (request.state === 'completed' && request.action === 'clarify' && request.selectedOption === undefined && request.reply) {
    return { id: request.id, createdAt: request.updatedAt, text: request.reply, options: fallbackOptions ?? request.questionOptions ?? [] };
  }
  return undefined;
}

export function ConversationQuestion({ request, question, options, deadlineAt, onAnswered }: {
  request: ConversationRequest;
  question?: SavedQuestion;
  /** Compatibility for request rows saved before question identities were added. */
  options?: string[];
  deadlineAt?: number;
  onAnswered?: (updated: ConversationRequest) => void;
}) {
  const id = useId();
  const active = useMemo(() => currentQuestion(request, question, options), [request, question, options]);
  const choices = active?.options ?? options ?? [];
  const [choice, setChoice] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!active || active.answer) return null;
  const customSelected = choice === 'custom';
  const canSend = customSelected ? !!custom.trim() : /^option:\d+$/.test(choice);
  const secondsRemaining = deadlineAt === undefined ? undefined : Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  const send = async (answer: AnswerChoice) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.answerConversationQuestion(request.projectId, request.id, {
        revision: request.revision,
        questionId: active.id,
        answer,
        askFirst: readPrefs(request.projectId).mode === 'ask',
      });
      const saved = updated.questions?.find(item => item.id === active.id)?.answer;
      if (updated.id !== request.id || !saved) throw new Error('The answer was not acknowledged.');
      if (updated.ownerId === sessionStorage.getItem('centinel:supabase-user-id')) rememberAcknowledgedRequest(request.projectId, updated);
      onAnswered?.(updated);
    } catch {
      setError('The answer could not be saved. Refresh and try again.');
    } finally { setSaving(false); }
  };

  return <section className="pc-card pc-chat-card pc-question-panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="pc-card-title">ORIN has a question</h2>
    <p className="pc-question-context">For: {request.input.text}</p>
    <div className="pc-markdown pc-question-copy"><ReactMarkdown skipHtml disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{active.text}</ReactMarkdown></div>
    <fieldset className="pc-question-answer-list" disabled={saving}>
      <legend className="ck-visually-hidden">Choose an answer</legend>
      {choices.map((option, index) => <label className="pc-question-answer-choice" key={`${active.id}:${index}`}>
        <input type="radio" name={`${id}-answer`} value={`option:${index}`} checked={choice === `option:${index}`}
          onChange={() => setChoice(`option:${index}`)} />
        <span className="pc-question-answer-copy"><span className="pc-question-answer-title">{option}</span>
          <span className="pc-question-answer-description">{index === 0 ? 'Recommended' : 'Choose this answer'}</span></span>
      </label>)}
      <label className="pc-question-answer-choice pc-question-custom-choice">
        <input type="radio" name={`${id}-answer`} value="custom" checked={customSelected} onChange={() => setChoice('custom')} />
        <span className="pc-question-answer-copy"><span className="pc-question-answer-title">Custom answer</span>
          <span className="pc-question-answer-description">Write a different answer</span></span>
      </label>
      {customSelected && <textarea className="pc-question-custom-input" aria-label="Custom answer" rows={2} maxLength={2000}
        value={custom} onChange={event => setCustom(event.target.value)} placeholder="Type your answer" />}
    </fieldset>
    <div className="pc-question-actions">
      <button type="button" className="ck-button is-small is-primary" disabled={saving || !canSend}
        onClick={() => void send(customSelected ? { kind: 'custom', text: custom } : { kind: 'option', selectedOption: Number(choice.slice('option:'.length)) })}>
        {saving ? 'Sending answer…' : 'Send answer'}
      </button>
      {secondsRemaining !== undefined && <p className="pc-question-countdown" role="status">Automatic answer in <span>{secondsRemaining}</span> seconds</p>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
