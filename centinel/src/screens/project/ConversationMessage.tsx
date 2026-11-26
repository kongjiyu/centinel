import { useEffect, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';

export async function copyConversationText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally { input.remove(); }
}

const messageDay = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
const messageDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const messageClock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

export function conversationTime(value: string, today = new Date()) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return '';
  const time = messageClock.format(at);
  if (at.toDateString() === today.toDateString()) return time;
  return `${(at.getFullYear() === today.getFullYear() ? messageDay : messageDate).format(at)} ${time}`;
}

export function MessageTime({ at }: { at: string }) {
  const label = conversationTime(at);
  return label ? <time dateTime={at}>{label}</time> : null;
}

export function ConversationMessage({ text, at, attachments, children }: { text: string; at: string; attachments?: ReactNode; children?: ReactNode }) {
  const [copy, setCopy] = useState('');
  useEffect(() => {
    if (!copy) return;
    const timer = setTimeout(() => setCopy(''), 1800);
    return () => clearTimeout(timer);
  }, [copy]);
  return <div className="pc-user-message">
    {attachments && <div className="pc-user-attachments">{attachments}</div>}
    <div className="pc-msg is-me">{children}<div className="pc-user-text">{text}</div></div>
    <footer className="pc-user-message-meta">
      <span role="status">{copy}</span><MessageTime at={at} />
      <button type="button" className="pc-message-action" aria-label="Copy message" title="Copy message" onClick={() => {
        void copyConversationText(text).then(() => setCopy('Message copied'), () => setCopy('Copy failed'));
      }}><Copy size={14} aria-hidden="true" /></button>
    </footer>
  </div>;
}
