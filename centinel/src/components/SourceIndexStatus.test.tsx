import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { SourceIndexStatus } from './SourceIndexStatus';
vi.mock('../api/client', () => ({ api: { getSourceIndexStatus: vi.fn(), resumeSourceIndex: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe('source search preparation', () => {
  it('observes a saved pause without automatically resuming and exposes the explicit action', async () => {
    vi.mocked(api.getSourceIndexStatus).mockResolvedValue({ state: 'paused', errorCode: 'quota_exhausted' });
    render(<SourceIndexStatus projectId="one" sourceVersionKey="v1" />);
    expect(await screen.findByRole('button', { name: 'Resume indexing' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Automatic retries are stopped');
    expect(api.resumeSourceIndex).not.toHaveBeenCalled();
  });
  it('starts only on click, disables repeats and refreshes the saved state', async () => {
    let release!: () => void;
    vi.mocked(api.getSourceIndexStatus).mockResolvedValueOnce({ state: 'none' }).mockResolvedValue({ state: 'running' });
    vi.mocked(api.resumeSourceIndex).mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return { state: 'queued' }; });
    render(<SourceIndexStatus projectId="one" sourceVersionKey="v1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare search' }));
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Preparing source search'));
    expect(api.resumeSourceIndex).toHaveBeenCalledExactlyOnceWith('one');
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
    await screen.findByText('Source search is ready.');
    await act(async () => release({ state: 'paused' }));
    expect(screen.getByRole('status')).toHaveTextContent('Source search is ready.');
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
