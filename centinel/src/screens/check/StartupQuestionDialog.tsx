import { useState } from 'react';
import { api } from '../../api/client';
import type { AutoTestSession } from '../../autotest/types';
import { addNote } from '../../check/projectPrefs';
import { Modal } from '../../components/Modal';
import { userFacingError } from '../../utils/userFacingError';

type Choice = 'install' | 'retry' | 'skip' | 'custom';

export function StartupQuestionDialog({ session, onAnswered }: { session: AutoTestSession | null | undefined; onAnswered?(): void }) {
  if (!session?.startupQuestion) return null;
  return <InstallQuestion key={session.startupQuestion.id} session={session} question={session.startupQuestion} onAnswered={onAnswered} />;
}

function InstallQuestion({ session, question, onAnswered }: { session: AutoTestSession; question: NonNullable<AutoTestSession['startupQuestion']>; onAnswered?(): void }) {
  const manual = !!question.manualSetup;
  const first = manual ? 'skip' : 'install';
  const [choice, setChoice] = useState<Choice>(first);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (answer: Choice) => {
    if (sending || answered || answer === 'custom' && !custom.trim()) return;
    setSending(true);
    try {
      await api.answerAutoTestStartup(session.projectId, session.id, question.id, answer);
      if (answer === 'custom') addNote(session.projectId, `Browser setup note: ${custom.trim()}`);
      setAnswered(true);
      onAnswered?.();
    } catch (cause) {
      setError(userFacingError(cause, 'The startup answer could not be saved. Try again.'));
      onAnswered?.();
    } finally {
      setSending(false);
    }
  };

  return <Modal isOpen={!answered} title={manual ? 'App startup needs a tool' : 'Install dependencies to start the app?'} onClose={() => void send('skip')}
    footer={<>
      <button type="button" className="btn-primary" onClick={() => void send(choice)} disabled={sending || choice === 'custom' && !custom.trim()}>
        {sending ? 'Submitting…' : 'Continue'}
      </button>
    </>}>
    <div className="ck-startup-question">
      <p>{question.manualSetup ?? 'The local app needs dependencies before browser testing can start.'} Any code review can continue while you decide.</p>
      <pre className="ck-excerpt"><code>{question.command}{question.packages.length > 0 && '\n\n' + question.packages.join('\n')}{question.packageCount > question.packages.length ? `\n… and ${question.packageCount - question.packages.length} more declared packages` : ''}</code></pre>
      {!manual && <p>The package manager may also install dependencies required by these packages.</p>}
      <fieldset className="ck-startup-options" disabled={sending}>
        <legend>Choose an answer</legend>
        <label><input data-autofocus type="radio" name="startup-choice" checked={choice === first} onChange={() => setChoice(first)} /> {manual ? 'Pause browser testing and set up the tool (recommended)' : 'Install and start the app (recommended)'}</label>
        <label><input type="radio" name="startup-choice" checked={choice === (manual ? 'retry' : 'skip')} onChange={() => setChoice(manual ? 'retry' : 'skip')} /> {manual ? 'I set up the tool. Retry startup.' : 'Pause browser testing'}</label>
        <label><input type="radio" name="startup-choice" checked={choice === 'custom'} onChange={() => setChoice('custom')} /> Write a custom answer</label>
        {choice === 'custom' && <label>Setup note<textarea maxLength={1000} value={custom} onChange={event => setCustom(event.target.value)} placeholder="Describe what needs to happen before testing resumes" /></label>}
      </fieldset>
      {choice === 'custom' && <p>Your note stays in this project’s conversation on this device. Browser testing will pause.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}
