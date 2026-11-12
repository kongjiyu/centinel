import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { SourceIndexStatus } from './SourceIndexStatus';
vi.mock('../api/client', () => ({ api: { getSourceIndexStatus: vi.fn(), ensureSourceIndex: vi.fn(), resumeSourceIndex: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe('source search preparation', () => {
  it('observes a saved pause without automatically resuming and exposes the explicit action', async () => {
    vi.mocked(api.getSourceIndexStatus).mockResolvedValue({ state: 'paused', errorCode: 'quota_exhausted' });
    render(<SourceIndexStatus projectId="one" sourceVersionKey="v1" />);
    expect(await screen.findByRole('button', { name: 'Resume indexing' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Automatic retries are stopped');
    expect(api.resumeSourceIndex).not.toHaveBeenCalled();
    expect(api.ensureSourceIndex).not.toHaveBeenCalled();
  });
  it('prepares search automatically only when no index exists', async () => {
    vi.mocked(api.getSourceIndexStatus).mockResolvedValue({ state: 'none' });
    vi.mocked(api.ensureSourceIndex).mockResolvedValue({ state: 'queued' });
    render(<SourceIndexStatus projectId="one" sourceVersionKey="v1" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Search preparation is queued.');
    expect(api.ensureSourceIndex).toHaveBeenCalledExactlyOnceWith('one', expect.any(AbortSignal));
    expect(api.resumeSourceIndex).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps unknown status explicit after a request failure', async () => {
    vi.mocked(api.getSourceIndexStatus).mockRejectedValue(new Error('PRIVATE_ERROR'));
    render(<SourceIndexStatus projectId="one" sourceVersionKey="v1" />);
    expect(await screen.findByRole('status')).toHaveTextContent('status is unavailable');
    expect(screen.queryByText('PRIVATE_ERROR')).not.toBeInTheDocument(); expect(api.resumeSourceIndex).not.toHaveBeenCalled();
  });
  it('does not replace a new project state with a late response from the previous project', async () => {
    let release!: (value: { state: 'paused' }) => void;
    vi.mocked(api.getSourceIndexStatus).mockImplementation(project => project === 'old'
      ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ state: 'ready' }));
    const view = render(<SourceIndexStatus projectId="old" sourceVersionKey="v1" />);
    view.rerender(<SourceIndexStatus projectId="new" sourceVersionKey="v2" />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => release({ state: 'paused' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume indexing' })).not.toBeInTheDocument();
  });
  it('polls status without overlapping slow requests or implicitly starting work', async () => {
    vi.useFakeTimers(); vi.mocked(api.getSourceIndexStatus).mockResolvedValue({ state: 'running' });
    render(<SourceIndexStatus projectId="one" sourceVersionKey="v1" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.getSourceIndexStatus).toHaveBeenCalledTimes(3); expect(api.resumeSourceIndex).not.toHaveBeenCalled();
  });
});
