import { useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { loadConversationReplySource } from '../../check/conversation';

export function ConversationQuotePreview({ className, projectId, ownerId, turnId, preview, label, unavailableText,
  children }: {
  className: string;
  projectId: string;
  ownerId: string | null;
  turnId?: string;
  preview?: string;
  label: string;
  unavailableText?: string;
  children: (preview: string | undefined) => ReactNode;
}) {
  const tooltipId = useId();
  const sourceKey = JSON.stringify([projectId, ownerId, turnId]);
  const [replyState, setReplyState] = useState<{ key: string; excerpt: string; full: string }>();
  const [loadingKey, setLoadingKey] = useState<string>();
  const [unavailableKey, setUnavailableKey] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const inFlight = useRef<string>();
  const activeKey = useRef(sourceKey);
  activeKey.current = sourceKey;
  const reply = replyState?.key === sourceKey ? replyState : undefined;
  const loading = loadingKey === sourceKey;
  const unavailable = unavailableKey === sourceKey;
  const load = () => {
    setRevealed(true);
    if (!turnId || !ownerId || inFlight.current === sourceKey || reply) return;
    inFlight.current = sourceKey;
    setUnavailableKey(undefined);
    setLoadingKey(sourceKey);
    void loadConversationReplySource(projectId, turnId, ownerId).then(source => {
      if (activeKey.current !== sourceKey) return;
      if (source) setReplyState({ key: sourceKey, ...source });
      else setUnavailableKey(sourceKey);
    }).catch(() => {
      if (activeKey.current === sourceKey) setUnavailableKey(sourceKey);
    }).finally(() => {
      if (inFlight.current === sourceKey) inFlight.current = undefined;
      if (activeKey.current === sourceKey) setLoadingKey(undefined);
    });
  };
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRevealed(false);
  };
  const tooltip = reply?.full || (loading ? 'Loading the full quoted reply…'
    : unavailable || !turnId ? unavailableText ?? 'The full quoted reply is unavailable.'
      : 'Hover or focus to load the full quoted reply.');

  return <div className={`pc-quote-preview ${className}`} role="group" tabIndex={0} aria-label={label}
    aria-describedby={tooltipId} onPointerEnter={load} onPointerLeave={() => setRevealed(false)}
    onFocus={load} onBlur={blur}>
    {children(preview ?? reply?.excerpt)}
    <span id={tooltipId} className="pc-reply-tooltip" role="tooltip" tabIndex={0} aria-live={revealed ? 'polite' : undefined}>{tooltip}</span>
  </div>;
}
