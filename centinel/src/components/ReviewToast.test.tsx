import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveReviewContext, type ActiveReviewSnapshot, type ActiveReviewState } from '../context/ActiveReviewContext';
import { ReviewToast } from './ReviewToast';

vi.mock('../api/client', () => ({ api: { cancelStaticSession: vi.fn().mockResolvedValue(undefined) } }));

function snapshot(overrides: Partial<ActiveReviewSnapshot> = {}): ActiveReviewSnapshot {
  return {
    id: 'review-1',
    projectId: 'project-1',
    projectName: 'Sample Shop',
    name: 'Checkout review',
    reviewType: 'full_review' as ActiveReviewSnapshot['reviewType'],
    status: 'running',
    progress: {
      stage: 'model_analysis',
      completedStages: ['freezing_sources', 'indexing_context', 'deterministic_analysis'],
      currentStage: 'code_review',
      stages: [
        { id: 'understanding_context', label: 'Understanding Context', status: 'done', thoughts: ['Read sources'] },
        { id: 'code_review', label: 'Code Review', status: 'active', thoughts: ['Checking the checkout total'] },
        { id: 'requirement_validation', label: 'Requirement Validation', status: 'pending', thoughts: [] },
        { id: 'summarizing', label: 'Summarizing Findings', status: 'pending', thoughts: [] },
      ],
      startedAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
    },
    findings: [],
    finalSummary: '',
    failureReason: '',
    createdAt: '2026-11-09T00:00:00.000Z',
    ...overrides,
  } as ActiveReviewSnapshot;
}

function renderToast(state: Partial<ActiveReviewState> & { session: ActiveReviewSnapshot }, onOpenReview = vi.fn()) {
  const controls = { setExpanded: vi.fn(), setDismissed: vi.fn(), trackSession: vi.fn(), retry: vi.fn() };
  render(
    <ActiveReviewContext.Provider value={{ state: { expanded: false, completedAt: null, dismissed: false, connectionLost: false, ...state }, controls }}>
      <ReviewToast onOpenReview={onOpenReview} />
    </ActiveReviewContext.Provider>,
  );
  return controls;
}

describe('ReviewToast', () => {
  it('summarises the current stage in plain language and opens details', () => {
    const openReview = vi.fn();
    const controls = renderToast({ session: snapshot() }, openReview);
    expect(screen.getByRole('region', { name: 'Review progress' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 5 · Review the behaviour')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checkout review: Review the behaviour, step 4 of 5');
    fireEvent.click(screen.getByRole('button', { name: 'Open review progress for Checkout review' }));
    expect(controls.setExpanded).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(openReview).toHaveBeenCalledWith('project-1', 'review-1', 'Checkout review');
  });

  it('lists every stage with a readable status and can collapse again', () => {
    const controls = renderToast({ session: snapshot(), expanded: true });
    expect(screen.getByText('Check the documents')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getAllByText('Not started')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel review' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide review progress details for Checkout review' }));
    expect(controls.setExpanded).toHaveBeenCalledWith(false);
  });

  it('announces a failed review and can be dismissed', () => {
    const controls = renderToast({ session: snapshot({ status: 'failed' }) });
    expect(screen.getByText('Review failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(controls.setDismissed).toHaveBeenCalledWith(true);
  });
});
