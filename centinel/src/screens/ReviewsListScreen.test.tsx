import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { REVIEWS_PAGE_SIZE, ReviewsListScreen } from './ReviewsListScreen';
import type { Project, StaticSession } from '../types';

vi.mock('../api/client', () => ({ api: { listStaticSessions: vi.fn() } }));

const project: Project = { id: 'project-1', name: 'Checkout app', description: '', workspacePath: '', createdAt: '', updatedAt: '' };

function review(overrides: Partial<StaticSession> & { id: string }): StaticSession {
  return {
    projectId: 'project-1', name: `Review ${overrides.id}`, reviewType: 'code_review', status: 'pending_approval',
    configJson: '{}', progressJson: '{}', remarks: '', finalSummary: '', failureReason: '',
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
    baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '',
    ...overrides,
  } as StaticSession;
}

function renderList(initialStatus?: string) {
  const onNavigate = vi.fn();
  render(<ReviewsListScreen projectId="project-1" projects={[project]} initialStatus={initialStatus} onNavigate={onNavigate} />);
  return onNavigate;
}

describe('ReviewsListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists Reviews with status, findings, lineage and opens the Review page', async () => {
    vi.mocked(api.listStaticSessions).mockResolvedValue([
      review({ id: 'r-1', name: 'Payments review', status: 'failed', createdAt: '2026-11-01T08:00:00.000Z' }),
      review({ id: 'r-2', name: 'Payments review retry', parentSessionId: 'r-1', deterministicFindingCount: 1, modelFindingCount: 3,
        progressJson: JSON.stringify({ stage: 'complete', coverage: 'partial' }), createdAt: '2026-11-01T09:00:00.000Z' }),
    ]);
    const onNavigate = renderList();
    const table = await screen.findByRole('table', { name: 'Reviews' });
    expect(api.listStaticSessions).toHaveBeenCalledWith('project-1', { summary: true });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByRole('button', { name: 'Payments review retry' })).toBeInTheDocument();
    expect(within(rows[0]).getByText('Completed with gaps')).toBeInTheDocument();
    expect(within(rows[0]).getByText('4')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Follows/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Failed')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Superseded by/)).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText('Not available')).toBeInTheDocument();

    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Payments review retry' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: 'project-1', sessionId: 'r-2', reviewName: 'Payments review retry' });
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Payments review retry' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'review-activity', projectId: 'project-1', sessionId: 'r-2', reviewName: 'Payments review retry' });
  });

  it('filters by status, keeps the filter in the route, and clears it', async () => {
    vi.mocked(api.listStaticSessions).mockResolvedValue([
      review({ id: 'a', name: 'Approved one', status: 'approved' }),
      review({ id: 'b', name: 'Failed one', status: 'failed' }),
      review({ id: 'c', name: 'Pending one' }),
    ]);
    const onNavigate = renderList();
    await screen.findByRole('table', { name: 'Reviews' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Failed (1)' }));
    expect(screen.getByRole('button', { name: 'Failed one' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approved one' })).not.toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledWith({ name: 'reviews', projectId: 'project-1', status: 'failed' });

    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('button', { name: 'Approved one' })).toBeInTheDocument();
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'reviews', projectId: 'project-1' });
  });

  it('restores a filter from the route and explains an empty match', async () => {
    vi.mocked(api.listStaticSessions).mockResolvedValue([review({ id: 'a', status: 'approved' })]);
    renderList('cancelled');
    expect(await screen.findByText('No Reviews match this status.')).toBeInTheDocument();
  });

  it('shows more Reviews on request', async () => {
    const many = Array.from({ length: REVIEWS_PAGE_SIZE + 5 }, (_, index) => review({
      id: `r-${index}`, name: `Review number ${index}`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
    }));
    vi.mocked(api.listStaticSessions).mockResolvedValue(many);
    renderList();
    const table = await screen.findByRole('table', { name: 'Reviews' });
    expect(within(table).getAllByRole('row')).toHaveLength(REVIEWS_PAGE_SIZE + 1);
    expect(screen.getByText(`Showing ${REVIEWS_PAGE_SIZE} of ${REVIEWS_PAGE_SIZE + 5}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(within(table).getAllByRole('row')).toHaveLength(REVIEWS_PAGE_SIZE + 6);
    expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument();
  });

  it('offers retry when the list cannot load and an empty state when there are no Reviews', async () => {
    vi.mocked(api.listStaticSessions).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    renderList();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No Reviews yet')).toBeInTheDocument());
  });
});
