import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { UpdatePrompt } from './UpdatePrompt';

afterEach(() => { vi.useRealTimers(); });

describe('UpdatePrompt', () => {
  it('offers Restart when a signed update is published and installs only on request', async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => ({ version: '0.2.0', notes: null }));
    const install = vi.fn(async () => {});
    render(<UpdatePrompt check={check} install={install} />);
    expect(screen.queryByRole('heading', { name: 'Update available' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText('Centinel 0.2.0 is ready to install. Restart to update.')).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: 'Restart' }).click(); });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when Centinel is current and can be dismissed', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<UpdatePrompt check={async () => null} install={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole('heading', { name: 'Update available' })).not.toBeInTheDocument();
    const check = async () => ({ version: '0.2.0', notes: null });
    rerender(<UpdatePrompt check={check} install={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await act(async () => { screen.getByRole('button', { name: 'Later' }).click(); });
    expect(screen.queryByRole('heading', { name: 'Update available' })).not.toBeInTheDocument();
  });
});
