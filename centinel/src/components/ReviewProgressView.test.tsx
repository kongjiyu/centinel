/**
 * ReviewProgressView.test.tsx — Component tests for the 4-stage progress bar.
 *
 * The progress view is the user-facing surface of the B7 per-stage error
 * recovery (Task 9): when a stage fails, the user needs to see WHICH stage
 * broke and what the error was. These tests pin the rendering for the
 * three stage statuses (pending/active/done) and the new 'failed' status.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewProgressView } from './ReviewProgressView';
import type { ReviewProgress } from '../types';

const baseStage = {
  thoughts: [] as string[],
};

function makeProgress(stageStatuses: Array<'pending' | 'active' | 'done' | 'failed'>, thoughts: string[][] = []): ReviewProgress {
  return {
    currentStage: 'understanding_context',
    stages: [
      { id: 'understanding_context', label: 'Understanding Context', status: stageStatuses[0] ?? 'pending', thoughts: thoughts[0] ?? [], summary: 'Context understood' },
      { id: 'code_review', label: 'Code Review', status: stageStatuses[1] ?? 'pending', thoughts: thoughts[1] ?? [], summary: '5 code issue(s) found' },
      { id: 'requirement_validation', label: 'Requirement Validation', status: stageStatuses[2] ?? 'pending', thoughts: thoughts[2] ?? [], summary: '2 traceability issue(s) found' },
      { id: 'summarizing', label: 'Summarize Findings', status: stageStatuses[3] ?? 'pending', thoughts: thoughts[3] ?? [], summary: 'Review complete' },
    ],
    startedAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:01:00.000Z',
  };
}

describe('ReviewProgressView', () => {
  it('renders an "Initializing" placeholder when progress is null', () => {
    render(<ReviewProgressView progress={null} />);
    expect(screen.getByText(/initializing review/i)).toBeInTheDocument();
  });

  it('renders all 4 stages in order with their labels', () => {
    const progress = makeProgress(['done', 'done', 'active', 'pending']);
    render(<ReviewProgressView progress={progress} />);
    expect(screen.getByText('Understanding Context')).toBeInTheDocument();
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.getByText('Requirement Validation')).toBeInTheDocument();
    expect(screen.getByText('Summarize Findings')).toBeInTheDocument();
  });

  it('renders the active stage with a spinner indicator', () => {
    const progress = makeProgress(['done', 'active', 'pending', 'pending']);
    const { container } = render(<ReviewProgressView progress={progress} />);
    // The active stage row has a step-spinner inside it.
    const activeRow = container.querySelector('.stage.stage-active');
    expect(activeRow).not.toBeNull();
    expect(activeRow!.querySelector('.step-spinner')).not.toBeNull();
  });

  it('renders done stages with the summary text', () => {
    const progress = makeProgress(['done', 'done', 'pending', 'pending']);
    render(<ReviewProgressView progress={progress} />);
    expect(screen.getByText('Context understood')).toBeInTheDocument();
    expect(screen.getByText('5 code issue(s) found')).toBeInTheDocument();
  });

  it('renders failed stages with a distinct visual class (B7 — per-stage error recovery)', () => {
    // B7 added the 'failed' status. A failed stage must not be styled
    // identically to a pending or done one — the user has to be able to
    // see at a glance which stage broke.
    const progress = makeProgress(['done', 'failed', 'pending', 'pending']);
    const { container } = render(<ReviewProgressView progress={progress} />);
    const failedRow = container.querySelector('.stage.stage-failed');
    expect(failedRow).not.toBeNull();
    // The code-review stage (the failed one) should not show its summary
    // because the stage didn't complete.
    expect(within(failedRow!).queryByText('5 code issue(s) found')).toBeNull();
  });

  it('shows the latest thought for the active stage', () => {
    const progress = makeProgress(['done', 'active', 'pending', 'pending'],
      [[], ['Reviewing 12 file(s) via tools...', 'Fetching file src/auth.ts'], [], []]);
    render(<ReviewProgressView progress={progress} />);
    // The latest thought is shown inline; the earlier one is in a <details>.
    expect(screen.getByText('Fetching file src/auth.ts')).toBeInTheDocument();
  });

  it('handles legacy progress shape (no .stages array) without crashing', () => {
    // Backward-compat: progress payloads from before the 4-stage refactor
    // had a different shape. The component must render a minimal view
    // instead of crashing on .stages.map(...).
    const legacy = { stage: 'Review', message: 'Some legacy message' } as unknown as ReviewProgress;
    render(<ReviewProgressView progress={legacy} />);
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Some legacy message')).toBeInTheDocument();
  });
});

// Local re-import of within to avoid touching the top-level import list
// (only used by one assertion).
import { within } from '@testing-library/react';
