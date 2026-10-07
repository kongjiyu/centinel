import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProviderPanel } from './CodexProviderPanel';
import { api } from '../api/client';
import { openExternalUrl } from '../utils/openExternalUrl';

vi.mock('../api/client', () => ({ api: {
  codexStatus: vi.fn(), codexModels: vi.fn(), codexLogin: vi.fn(), codexLogout: vi.fn(), codexCancelLogin: vi.fn(), testCodex: vi.fn(), updateAiSetting: vi.fn(),
} }));
vi.mock('../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
const connected = { available: true, connected: true, accountLabel: 'tester@example.test', message: 'Connected' };
const disconnected = { available: true, connected: false, accountLabel: null, message: 'Sign in to Codex.' };
const refresh = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.codexStatus).mockResolvedValue(connected);
  vi.mocked(api.codexModels).mockResolvedValue([{ id: 'model-1', label: 'Model One', supportsImages: true, isDefault: true }]);
  vi.mocked(api.testCodex).mockResolvedValue({ status: 'pass', message: 'Codex test passed.' });
  vi.mocked(api.codexLogin).mockResolvedValue({ loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=test' });
  vi.mocked(openExternalUrl).mockResolvedValue(true);
});

describe('Codex provider settings', () => {
  it('selects the account model for each product without requesting an API key', async () => {
    const user = userEvent.setup(); render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await screen.findByText('This model supports text and screenshots.');
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use for Review' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('text', { provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: 'model-1', fallbackEnabled: false }));
    await user.click(screen.getByRole('button', { name: 'Use for Dynamic' }));
    expect(api.updateAiSetting).toHaveBeenLastCalledWith('vision', expect.objectContaining({ model: 'model-1' }));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('runs distinct text and screenshot tests and displays failure honestly', async () => {
    const user = userEvent.setup(); render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await screen.findByText('This model supports text and screenshots.');
    await user.click(screen.getByRole('button', { name: 'Test text' }));
    expect(api.testCodex).toHaveBeenCalledWith('model-1');
    vi.mocked(api.testCodex).mockResolvedValue({ status: 'fail', message: 'Unexpected screenshot response.' });
    await user.click(screen.getByRole('button', { name: 'Test screenshot' }));
    expect(api.testCodex).toHaveBeenLastCalledWith('model-1', true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected screenshot response.');
  });
  it('disables Dynamic selection for a text-only model', async () => {
    vi.mocked(api.codexModels).mockResolvedValue([{ id: 'text-only', label: 'Text', supportsImages: false, isDefault: true }]);
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByRole('button', { name: 'Use for Dynamic' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test screenshot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use for Review' })).toBeEnabled();
  });
  it('opens browser sign-in, allows explicit cancellation, and refreshes connection', async () => {
    vi.mocked(api.codexStatus).mockResolvedValue(disconnected);
    const user = userEvent.setup(); render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await user.click(await screen.findByRole('button', { name: 'Connect Codex' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?state=test');
    await user.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));
    expect(api.codexCancelLogin).toHaveBeenCalledWith('login-1');
    vi.mocked(api.codexStatus).mockResolvedValue(connected);
    await user.click(screen.getByRole('button', { name: 'Refresh connection' }));
    expect(await screen.findByText('tester@example.test')).toBeInTheDocument();
  });
  it('disconnects only this local integration and retains saved role selections', async () => {
    const user = userEvent.setup(); render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await screen.findByText('This model supports text and screenshots.');
    vi.mocked(api.codexStatus).mockResolvedValue(disconnected);
    await user.click(screen.getByRole('button', { name: 'Disconnect Codex' }));
    expect(api.codexLogout).toHaveBeenCalledOnce(); expect(api.updateAiSetting).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Connect Codex' })).toBeEnabled();
  });
  it('shows a recoverable missing CLI state', async () => {
    vi.mocked(api.codexStatus).mockResolvedValue({ ...disconnected, available: false, message: 'Install Codex CLI or configure CENTINEL_CODEX_BIN.' });
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByText(/Install Codex CLI/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Codex' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh connection' })).toBeEnabled();
  });
});
