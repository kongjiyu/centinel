import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpScreen, PRIVACY_STATEMENT_URL } from './HelpScreen';
import { exportAndSaveDiagnostics } from '../utils/saveDiagnostics';
import { openExternalUrl } from '../utils/openExternalUrl';

vi.mock('../utils/saveDiagnostics', () => ({ exportAndSaveDiagnostics: vi.fn() }));
vi.mock('../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn().mockResolvedValue(true) }));
beforeEach(() => vi.clearAllMocks());

describe('HelpScreen', () => {
  it('explains the Review workflow and source updates in task-focused sections', () => {
    render(<HelpScreen />);

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start a Review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Follow Activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Read the result' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspect evidence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Update project sources' })).toBeInTheDocument();
    expect(screen.getByText(/does not browse or inspect repository files/i)).toBeInTheDocument();
    expect(screen.getByText(/Source updates and model-backed indexing or assessment are separate/i)).toBeInTheDocument();
  });

  it('links the privacy statement and exports diagnostics on request', async () => {
    vi.mocked(exportAndSaveDiagnostics).mockResolvedValue({ outcome: 'saved', path: '/Users/me/Desktop/centinel-diagnostics.zip' });
    const user = userEvent.setup();
    render(<HelpScreen />);
    expect(screen.getByText(/no telemetry and sends no crash reports/i)).toBeInTheDocument();
    expect(exportAndSaveDiagnostics).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: /privacy statement/i }));
    expect(openExternalUrl).toHaveBeenCalledWith(PRIVACY_STATEMENT_URL);
    await user.click(screen.getByRole('button', { name: 'Export diagnostics' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved diagnostics to /Users/me/Desktop/centinel-diagnostics.zip.');
    expect(exportAndSaveDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('announces an export failure and allows another attempt', async () => {
    vi.mocked(exportAndSaveDiagnostics).mockRejectedValueOnce(new Error('Sign in again to export diagnostics.')).mockResolvedValueOnce({ outcome: 'cancelled' });
    const user = userEvent.setup();
    render(<HelpScreen />);
    await user.click(screen.getByRole('button', { name: 'Export diagnostics' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again to export diagnostics.');
    await user.click(screen.getByRole('button', { name: 'Export diagnostics' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
