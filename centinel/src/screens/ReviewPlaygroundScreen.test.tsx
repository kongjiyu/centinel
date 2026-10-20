import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewPlaygroundScreen } from './ReviewPlaygroundScreen';
import type { Project, StaticSession } from '../types';
import type { ReviewHarnessTrace } from '../reviewHarness';

vi.mock('../api/client', () => ({ api: { listStaticSessions: vi.fn(), getReviewHarness: vi.fn() } }));
const project = { id: 'project', name: 'Checkout' } as Project;
const review = { id: 'review', name: 'Security review', status: 'pending_approval' } as StaticSession;
const trace: ReviewHarnessTrace = {
  workflow: { version: 'centinel-harness-v1', reference: 'https://github.com/alibaba/open-code-review', stages: [{ id: 'freezing_sources', label: 'Freeze and validate sources', steps: ['read_source'] }, { id: 'model_analysis', label: 'Review with configured model', steps: ['run_model'] }] },
  review: { id: 'review', name: 'Security review', status: 'pending_approval', progress: { stage: 'complete', completedStages: ['freezing_sources', 'model_analysis'] }, modelStatus: 'succeeded', updatedAt: '2026-10-11T00:00:00Z' },
  events: [{ reviewId: 'review', event: 'harness_step_completed', stage: 'freezing_sources', detail: { step: 'read_source', executionId: 'one', durationMs: 5, output: { characters: 42 } }, createdAt: '2026-10-11T00:00:00Z' }],
};

beforeEach(() => {
  vi.mocked(api.listStaticSessions).mockReset().mockResolvedValue([review]);
  vi.mocked(api.getReviewHarness).mockReset().mockResolvedValue(trace);
});

describe('Review Playground', () => {
  it('polls active runs and stops when execution becomes terminal', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getReviewHarness).mockResolvedValueOnce({ ...trace, review: { ...trace.review, status: 'running' } }).mockResolvedValue(trace);
      await act(async () => { render(<ReviewPlaygroundScreen projects={[project]} onNavigate={vi.fn()} />); });
      expect(screen.getByText(/Observing live execution/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(screen.getByText(/Saved execution history/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(api.getReviewHarness).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('loads persisted steps, opens metadata, changes stages, refreshes and navigates', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<ReviewPlaygroundScreen projects={[project]} onNavigate={onNavigate} />);
    await screen.findByRole('region', { name: 'Observed review' });
    await user.click(screen.getByText('Read source'));
    expect(screen.getByText(/"characters": 42/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Review with configured model/ }));
    expect(screen.getByText('Run model')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Freeze and validate sources/ }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getReviewHarness).toHaveBeenCalledTimes(2));
    await screen.findByRole('region', { name: 'Observed review' });
    await user.click(screen.getByRole('button', { name: 'Open review' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'review-activity', projectId: 'project', sessionId: 'review' });
    await user.click(screen.getByRole('button', { name: 'Start review' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'review-entry', projectId: 'project', returnToPlayground: true });
  });

  it('explains old runs without inventing execution history', async () => {
    vi.mocked(api.getReviewHarness).mockResolvedValue({ ...trace, events: [] });
    render(<ReviewPlaygroundScreen projects={[project]} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/This review has no step trace/)).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });

  it('shows actionable errors and empty projects', async () => {
    vi.mocked(api.getReviewHarness).mockRejectedValue(new Error('private details'));
    const view = render(<ReviewPlaygroundScreen projects={[project]} onNavigate={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm the updated sidecar');
    expect(screen.queryByText('private details')).not.toBeInTheDocument();
    view.unmount();
    render(<ReviewPlaygroundScreen projects={[]} onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Choose a project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
  });
});
