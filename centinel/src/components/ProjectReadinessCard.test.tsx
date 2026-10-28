import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectReadinessCard } from './ProjectReadinessCard';
import { api } from '../api/client';
import type { ProjectReadinessStatus } from '../types';

const readinessApi = vi.hoisted(() => ({
  getProjectReadiness: vi.fn(),
  startProjectReadiness: vi.fn(),
}));

vi.mock('../api/client', () => ({ api: readinessApi }));

const assessedAt = '2026-10-19T10:00:08.000Z';
const originalVisibilityState = document.visibilityState;

function status(overrides: Partial<ProjectReadinessStatus> = {}): ProjectReadinessStatus {
  return {
    projectId: 'project-1', requestId: null, status: 'idle', trigger: null,
    requestedAt: null, startedAt: null, completedAt: null, error: null, snapshot: null, stale: false,
    ...overrides,
  };
}

const completedSnapshot: ProjectReadinessStatus = status({
  status: 'completed', completedAt: assessedAt,
  snapshot: {
    id: 'assessment-1', projectId: 'project-1', sourceFingerprint: 'fingerprint-1', assessedAt,
    categories: [
      { id: 'repository', label: 'Repository', state: 'completed', sourceCount: 2, checksPassed: 4, checksTotal: 4, gapIds: [] },
      { id: 'requirements', label: 'Requirement specification', state: 'incomplete', sourceCount: 1, checksPassed: 2, checksTotal: 4, gapIds: ['gap-1'] },
      { id: 'design', label: 'Design documentation', state: 'missing', sourceCount: 0, checksPassed: 0, checksTotal: 3, gapIds: ['gap-2'] },
      { id: 'standards', label: 'Coding standards', state: 'completed', sourceCount: 1, checksPassed: 3, checksTotal: 3, gapIds: [] },
    ],
    findings: [],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getProjectReadiness).mockResolvedValue(status());
  vi.mocked(api.startProjectReadiness).mockResolvedValue(status({ status: 'queued', requestId: 'request-1', trigger: 'manual' }));
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: originalVisibilityState });
});

describe('ProjectReadinessCard', () => {
  it('shows a durable provider pause with previous results and a manual Resume action', async () => {
    vi.mocked(api.getProjectReadiness).mockResolvedValue({ ...completedSnapshot, status: 'paused', errorCode: 'credits_exhausted', error: 'Paused: the Model Provider reported insufficient credits. Restore provider access, then retry manually. No automatic retry will run.' });
    render(<ProjectReadinessCard projectId="project-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the previous assessment. Paused:');
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(api.startProjectReadiness).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.startProjectReadiness).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
  it('keeps category states as a dash until the first saved snapshot is available', () => {
    vi.mocked(api.getProjectReadiness).mockReturnValue(new Promise(() => {}));
    render(<ProjectReadinessCard projectId="project-1" />);

    expect(screen.getByRole('heading', { name: 'Readiness' })).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('Missing')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading assessment status.');
  });

  it('shows only category labels and the three assessment states, then disables Start while queued', async () => {
    vi.mocked(api.getProjectReadiness).mockResolvedValueOnce(completedSnapshot);
    render(<ProjectReadinessCard projectId="project-1" />);

    expect(await screen.findByText('Incomplete')).toBeInTheDocument();
    expect(screen.getByText('Repository')).toBeInTheDocument();
    expect(screen.getByText('Requirement specification')).toBeInTheDocument();
    expect(screen.getByText('Design documentation')).toBeInTheDocument();
    expect(screen.getByText('Coding standards')).toBeInTheDocument();
    expect(screen.getAllByText('Completed')).toHaveLength(2);
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.queryByText(/source[s]? available/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Assessment queued.'));
    expect(api.startProjectReadiness).toHaveBeenCalledWith('project-1');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
  });

  it('preserves the last snapshot on failure and offers a manual retry', async () => {
    const failed = status({ status: 'failed', error: 'The AI provider is unavailable. Check Model Provider in Settings, then try again.', snapshot: completedSnapshot.snapshot });
    vi.mocked(api.getProjectReadiness).mockResolvedValueOnce(failed);
    vi.mocked(api.startProjectReadiness).mockResolvedValueOnce(status({ status: 'running', requestId: 'request-2', trigger: 'manual', snapshot: completedSnapshot.snapshot }));
    render(<ProjectReadinessCard projectId="project-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Check Model Provider in Settings');
    expect(screen.getAllByText('Completed')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(api.startProjectReadiness).toHaveBeenCalledWith('project-1'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Checking updated sources.'));
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.getAllByText('Completed')).toHaveLength(2);
  });

  it.each([
    { status: 'idle', job: 'Awaiting manual assessment.', action: 'Start' },
    { status: 'queued', job: 'Assessment queued.', action: 'Start' },
    { status: 'running', job: 'Checking updated sources.', action: 'Start' },
    { status: 'failed', job: 'Assessment failed. The saved result is still available.', action: 'Retry' },
    { status: 'paused', job: 'Assessment paused. Manual resume is required.', action: 'Resume' },
  ] as const)('labels stale $status results as previous and describes the job separately', async ({ status: jobStatus, job, action }) => {
    vi.mocked(api.getProjectReadiness).mockResolvedValue({
      ...completedSnapshot,
      status: jobStatus,
      stale: true,
      error: jobStatus === 'failed' ? 'Updated-source assessment failed.' : jobStatus === 'paused' ? 'Provider paused the assessment.' : null,
    });
    render(<ProjectReadinessCard projectId="project-1" />);

    expect(await screen.findByText('Previous assessment — sources have changed')).toBeInTheDocument();
    expect(screen.getByText(/Assessed /)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(job);
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    expect(screen.getAllByText('Incomplete')).toHaveLength(1);
    expect(api.startProjectReadiness).not.toHaveBeenCalled();
  });

  it('does not invent a previous assessment or date when no snapshot exists', async () => {
    vi.mocked(api.getProjectReadiness).mockResolvedValue(status({ stale: true }));
    render(<ProjectReadinessCard projectId="project-1" />);

    expect(await screen.findByRole('status')).toHaveTextContent('No assessment is saved yet.');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/Previous assessment/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Assessed /)).not.toBeInTheDocument();
  });

  it('labels an invalid stale snapshot date as unavailable and clears stale copy for fresh results', async () => {
    vi.mocked(api.getProjectReadiness).mockResolvedValueOnce({
      ...completedSnapshot, stale: true, snapshot: { ...completedSnapshot.snapshot!, assessedAt: 'not-a-date' },
    });
    const view = render(<ProjectReadinessCard projectId="project-1" />);

    expect(await screen.findByText('Assessment date unavailable.')).toBeInTheDocument();
    vi.mocked(api.getProjectReadiness).mockResolvedValueOnce(completedSnapshot);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent.focus(window);

    await waitFor(() => expect(screen.queryByText('Previous assessment — sources have changed')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Assessment is current.');
    view.unmount();
  });

  it('polls queued or running work and refreshes its saved snapshot', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getProjectReadiness)
      .mockResolvedValueOnce(status({ status: 'queued', requestId: 'request-1' }))
      .mockResolvedValueOnce(completedSnapshot);
    render(<ProjectReadinessCard projectId="project-1" />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(api.getProjectReadiness).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.getProjectReadiness).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
  });

  it('refreshes status when the app returns to the foreground', async () => {
    vi.mocked(api.getProjectReadiness)
      .mockResolvedValueOnce(completedSnapshot)
      .mockResolvedValueOnce(status({ status: 'running', requestId: 'request-2', snapshot: completedSnapshot.snapshot }));
    render(<ProjectReadinessCard projectId="project-1" />);

    expect(await screen.findByText('Incomplete')).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent.focus(window);
    await waitFor(() => expect(api.getProjectReadiness).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Checking updated sources.'));
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('ignores a late response after switching projects', async () => {
    let resolveFirst!: (value: ProjectReadinessStatus) => void;
    const firstRequest = new Promise<ProjectReadinessStatus>(resolve => { resolveFirst = resolve; });
    const secondProjectStatus = status({
      projectId: 'project-2', status: 'completed',
      snapshot: {
        ...completedSnapshot.snapshot!,
        projectId: 'project-2',
        categories: completedSnapshot.snapshot!.categories.map(category => ({ ...category, state: 'completed' as const })),
      },
    });
    vi.mocked(api.getProjectReadiness).mockReturnValueOnce(firstRequest).mockResolvedValueOnce(secondProjectStatus);
    const view = render(<ProjectReadinessCard projectId="project-1" />);

    view.rerender(<ProjectReadinessCard projectId="project-2" />);
    expect(await screen.findAllByText('Completed')).toHaveLength(4);
    await act(async () => { resolveFirst(completedSnapshot); await firstRequest; });
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
    expect(screen.queryByText('Missing')).not.toBeInTheDocument();
    expect(screen.getAllByText('Completed')).toHaveLength(4);
  });
});
