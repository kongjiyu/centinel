/**
 * ReviewDecisionBar.test.tsx — Component tests for the session-level decision UI.
 *
 * ReviewDecisionBar (P0-3) is the verdict UI that sits under a completed
 * static review. Decisions are append-only — each click creates a new
 * ReviewDecisionRecord, the latest one is what the dashboard surfaces.
 *
 * The component is interactive (textarea, 3 buttons, history toggle), so
 * we use @testing-library/user-event for the click + type flows. The
 * api module is mocked so the test is self-contained.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewDecisionBar } from './ReviewDecisionBar';
import { api } from '../api/client';
import type { ReviewDecisionRecord } from '../types';

vi.mock('../api/client', () => ({
  api: {
    submitReviewDecision: vi.fn(),
    listReviewDecisions: vi.fn(),
  },
}));

const baseDecision: ReviewDecisionRecord = {
  id: 'd-1',
  sessionId: 's-1',
  decision: 'approved',
  comment: 'LGTM',
  reviewer: 'tester',
  createdAt: '2026-06-25T10:00:00.000Z',
};

describe('ReviewDecisionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 3 decision buttons (Approve / Request Changes / Comment)', () => {
    render(
      <ReviewDecisionBar
        projectId="p-1"
        sessionId="s-1"
        currentDecision={null}
        onChange={() => {}}
      />
    );
    expect(screen.getByTestId('decision-approve')).toBeInTheDocument();
    expect(screen.getByTestId('decision-changes')).toBeInTheDocument();
    expect(screen.getByTestId('decision-comment')).toBeInTheDocument();
  });

  it('shows the current decision as a pill when one is provided', () => {
    render(
      <ReviewDecisionBar
        projectId="p-1"
        sessionId="s-1"
        currentDecision={baseDecision}
        onChange={() => {}}
      />
    );
    const pill = screen.getByTestId('review-decision-current');
    expect(pill).toHaveTextContent(/approved/i);
  });

  it('shows a comment textarea when a decision is picked, and submits with the comment', async () => {
    const onChange = vi.fn();
    vi.mocked(api.submitReviewDecision).mockResolvedValue({ ...baseDecision, comment: 'Looks good' });
    const user = userEvent.setup();
    render(
      <ReviewDecisionBar
        projectId="p-1"
        sessionId="s-1"
        currentDecision={null}
        onChange={onChange}
      />
    );

    // Click "Approve" — the textarea should appear.
    await user.click(screen.getByTestId('decision-approve'));
    expect(screen.getByTestId('review-decision-comment')).toBeInTheDocument();

    // Type a comment, then submit.
    await user.type(screen.getByTestId('review-decision-comment-input'), 'Looks good');
    await user.click(screen.getByTestId('review-decision-submit'));

    await waitFor(() => {
      expect(api.submitReviewDecision).toHaveBeenCalledWith('p-1', 's-1', {
        decision: 'approved',
        comment: 'Looks good',
      });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not require a comment for "Comment" (commented decision defaults to empty)', async () => {
    const onChange = vi.fn();
    vi.mocked(api.submitReviewDecision).mockResolvedValue({ ...baseDecision, decision: 'commented' });
    const user = userEvent.setup();
    render(
      <ReviewDecisionBar
        projectId="p-1"
        sessionId="s-1"
        currentDecision={null}
        onChange={onChange}
      />
    );

    // Click "Comment" twice — the second click submits (no comment required).
    await user.click(screen.getByTestId('decision-comment'));
    await user.click(screen.getByTestId('decision-comment'));

    await waitFor(() => {
      expect(api.submitReviewDecision).toHaveBeenCalledWith('p-1', 's-1', {
        decision: 'commented',
        comment: undefined,
      });
    });
  });

  it('shows the history list when the History button is clicked', async () => {
    const records: ReviewDecisionRecord[] = [
      { ...baseDecision, id: 'd-1', decision: 'commented', comment: 'first pass' },
      { ...baseDecision, id: 'd-2', decision: 'approved', comment: 'LGTM now' },
    ];
    vi.mocked(api.listReviewDecisions).mockResolvedValue(records);
    const user = userEvent.setup();
    render(
      <ReviewDecisionBar
        projectId="p-1"
        sessionId="s-1"
        currentDecision={baseDecision}
        onChange={() => {}}
      />
    );

    await user.click(screen.getByTestId('review-decision-history-toggle'));

    await waitFor(() => {
      expect(api.listReviewDecisions).toHaveBeenCalledWith('p-1', 's-1');
    });
    expect(screen.getByTestId('review-decision-history')).toBeInTheDocument();
  });

  it('disables all buttons while a submission is in flight', async () => {
    // Make the submission hang so we can observe the disabled state.
    vi.mocked(api.submitReviewDecision).mockReturnValue(new Promise(() => { /* never resolves */ }));
    const user = userEvent.setup();
    render(
      <ReviewDecisionBar
        projectId="p-1"
        sessionId="s-1"
        currentDecision={null}
        onChange={() => {}}
      />
    );

    await user.click(screen.getByTestId('decision-approve'));
    // After the comment box appears, click Submit. The submit button
    // shows "Submitting…" and all decision buttons are disabled.
    await user.click(screen.getByTestId('review-decision-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('decision-approve')).toBeDisabled();
      expect(screen.getByTestId('decision-changes')).toBeDisabled();
      expect(screen.getByTestId('decision-comment')).toBeDisabled();
    });
  });
});
