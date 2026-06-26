/**
 * ReviewDecisionBar (P0-3).
 *
 * Session-level decision UI: Approve / Request Changes / Comment. Lives
 * under a completed session's findings so the verdict sits next to the
 * evidence that drove it. The component owns its own loading + error
 * state and calls back via `onChange` so the parent can refresh the
 * session row.
 *
 * Decisions are append-only — submitting a new one does not "edit" a
 * previous one. The history is preserved in `review_decisions` and the
 * latest one is what the dashboard surfaces.
 */

import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, MessageSquare, RotateCcw, History } from 'lucide-react';
import { api } from '../api/client';
import type { ReviewDecision, ReviewDecisionRecord } from '../types';

const DECISION_LABELS: Record<ReviewDecision, string> = {
  approved: 'Approved',
  changes_requested: 'Changes Requested',
  commented: 'Commented',
};

const DECISION_ICONS: Record<ReviewDecision, typeof CheckCircle2> = {
  approved: CheckCircle2,
  changes_requested: XCircle,
  commented: MessageSquare,
};

type Props = {
  projectId: string;
  sessionId: string;
  currentDecision: ReviewDecisionRecord | null;
  onChange: (next: ReviewDecisionRecord) => void;
};

export function ReviewDecisionBar({ projectId, sessionId, currentDecision, onChange }: Props) {
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showComment, setShowComment] = useState<ReviewDecision | null>(null);
  const [comment, setComment] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ReviewDecisionRecord[] | null>(null);

  const reset = useCallback(() => {
    setShowComment(null);
    setComment('');
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    async (decision: ReviewDecision) => {
      setSubmitting(decision);
      setError(null);
      try {
        const record = await api.submitReviewDecision(projectId, sessionId, {
          decision,
          comment: comment.trim() || undefined,
        });
        onChange(record);
        reset();
      } catch (e) {
        setError(String(e));
      } finally {
        setSubmitting(null);
      }
    },
    [projectId, sessionId, comment, onChange, reset]
  );

  const loadHistory = useCallback(async () => {
    setShowHistory(prev => !prev);
    if (history) return; // already loaded
    try {
      const records = await api.listReviewDecisions(projectId, sessionId);
      setHistory(records);
    } catch (e) {
      setError(String(e));
    }
  }, [projectId, sessionId, history]);

  const onPick = (decision: ReviewDecision) => {
    if (showComment === decision) {
      // Already showing the comment box; submit directly if there's a comment.
      if (comment.trim() || decision === 'commented') {
        void handleSubmit(decision);
      } else {
        setShowComment(null);
      }
    } else {
      setShowComment(decision);
      setComment('');
    }
  };

  return (
    <div className="review-decision-bar" data-testid="review-decision-bar">
      <div className="review-decision-bar-header">
        <span className="review-decision-bar-label">Review Decision</span>
        {currentDecision && <CurrentDecisionPill decision={currentDecision} />}
        {history && history.length > 0 && (
          <button
            className="btn-ghost btn-history"
            onClick={loadHistory}
            data-testid="review-decision-history-toggle"
            type="button"
          >
            <History size={12} /> {showHistory ? 'Hide' : 'Show'} history ({history.length})
          </button>
        )}
        {!history && currentDecision && (
          <button
            className="btn-ghost btn-history"
            onClick={loadHistory}
            data-testid="review-decision-history-toggle"
            type="button"
          >
            <History size={12} /> History
          </button>
        )}
      </div>

      <div className="review-decision-bar-actions">
        <button
          className="btn-decision btn-decision-approve"
          onClick={() => onPick('approved')}
          disabled={submitting !== null}
          data-testid="decision-approve"
          type="button"
        >
          <CheckCircle2 size={14} /> Approve
        </button>
        <button
          className="btn-decision btn-decision-changes"
          onClick={() => onPick('changes_requested')}
          disabled={submitting !== null}
          data-testid="decision-changes"
          type="button"
        >
          <XCircle size={14} /> Request Changes
        </button>
        <button
          className="btn-decision btn-decision-comment"
          onClick={() => onPick('commented')}
          disabled={submitting !== null}
          data-testid="decision-comment"
          type="button"
        >
          <MessageSquare size={14} /> Comment
        </button>
      </div>

      {showComment && (
        <div className="review-decision-comment" data-testid="review-decision-comment">
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={
              showComment === 'approved'
                ? 'Optional note (e.g. "LGTM, ship it")'
                : showComment === 'changes_requested'
                ? 'What needs to change? (required for the audit trail)'
                : 'Add a note for the team'
            }
            rows={2}
            data-testid="review-decision-comment-input"
          />
          <div className="review-decision-comment-actions">
            <button
              className="btn-ghost"
              onClick={reset}
              disabled={submitting !== null}
              type="button"
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => handleSubmit(showComment)}
              disabled={submitting !== null}
              data-testid="review-decision-submit"
              type="button"
            >
              {submitting ? 'Submitting…' : `Submit ${DECISION_LABELS[showComment]}`}
            </button>
          </div>
        </div>
      )}

      {showHistory && history && history.length > 0 && (
        <ul className="review-decision-history" data-testid="review-decision-history">
          {history.map(h => {
            const Icon = DECISION_ICONS[h.decision];
            return (
              <li key={h.id} className="review-decision-history-item">
                <Icon size={12} className={`decision-icon decision-icon-${h.decision}`} />
                <span className="decision-text">
                  <strong>{DECISION_LABELS[h.decision]}</strong>
                  {h.reviewer && <span className="decision-reviewer"> by {h.reviewer}</span>}
                  {h.comment && <span className="decision-comment-text"> — {h.comment}</span>}
                </span>
                <time className="decision-time">{new Date(h.createdAt).toLocaleString()}</time>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <div className="review-decision-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function CurrentDecisionPill({ decision }: { decision: ReviewDecisionRecord }) {
  const Icon = DECISION_ICONS[decision.decision];
  return (
    <span
      className={`review-decision-pill review-decision-pill-${decision.decision}`}
      data-testid="review-decision-current"
    >
      <Icon size={12} /> {DECISION_LABELS[decision.decision]}
    </span>
  );
}

/** Renders the current decision next to the session name, as a small pill.
 *  Use this on the session row for at-a-glance status. */
export function ReviewDecisionPill({ decision }: { decision: ReviewDecisionRecord | null | undefined }) {
  if (!decision) return null;
  const Icon = DECISION_ICONS[decision.decision];
  return (
    <span
      className={`review-decision-pill review-decision-pill-sm review-decision-pill-${decision.decision}`}
      data-testid="review-decision-pill"
    >
      <Icon size={10} /> {DECISION_LABELS[decision.decision]}
    </span>
  );
}
