import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './SettingsScreen';
import { api } from '../api/client';
import type { AiProviderSetting } from '../types';

const tauriApp = vi.hoisted(() => ({ getVersion: vi.fn() }));
const tauriShell = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@tauri-apps/api/app', () => tauriApp);
vi.mock('@tauri-apps/api/shell', () => tauriShell);

vi.mock('../api/client', () => ({
  api: {
    getAiUsage: vi.fn(),
    updateAiSetting: vi.fn(),
    testAiProvider: vi.fn(),
  },
}));

const settings: AiProviderSetting[] = [
  {
    id: 'text',
    label: 'Text AI',
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    hasApiKey: false,
    apiKeyPreview: '',
    baseUrl: 'https://example.com/text',
    model: 'text-model',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'vision',
    label: 'Vision AI',
    provider: 'gemini',
    apiFormat: 'google-native',
    hasApiKey: false,
    apiKeyPreview: '',
    baseUrl: 'https://example.com/vision',
    model: 'vision-model',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
];

describe('SettingsScreen information architecture and capability boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriApp.getVersion.mockResolvedValue('0.0.1');
    tauriShell.open.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.0.1', html_url: 'https://github.com/kongjiyu/centinel/releases/tag/v0.0.1' }),
    }));
  });

  it('presents four settings containers with one custom model provider and honest connections', async () => {
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 },
      byGroup: [],
      recent: [],
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole('heading', { name: 'App Version' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Model Provider' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Custom Model Provider' })).toBeInTheDocument();
    expect(screen.queryByText('Text AI')).not.toBeInTheDocument();
    expect(screen.queryByText('Vision AI')).not.toBeInTheDocument();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('Import and review shared documents and requirements.')).toBeInTheDocument();
    expect(screen.getByText('Connect repositories and pull request context to reviews.')).toBeInTheDocument();
    expect(screen.getByText('Share review updates and collaborate with your team.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Connect / })).toHaveLength(3);
    expect(screen.getByText('Current version')).toBeInTheDocument();
    expect(screen.getByText('Latest version')).toBeInTheDocument();
    expect(await screen.findAllByText('Centinel v0.0.1')).toHaveLength(2);
    expect(screen.queryByText('Versions')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider credentials')).not.toBeInTheDocument();
    expect(screen.queryByText('Model activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Checks the latest published GitHub release.')).not.toBeInTheDocument();
    expect(screen.queryByText('Totals grouped by provider, format, and model.')).not.toBeInTheDocument();
    expect(screen.queryByText('Inspect the latest recorded AI requests.')).not.toBeInTheDocument();

    await waitFor(() => expect(api.getAiUsage).toHaveBeenCalled());
  });

  it('checks the published GitHub release and only offers Open update for a newer version', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.0.2', html_url: 'https://github.com/kongjiyu/centinel/releases/tag/v0.0.2' }),
    }));
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 },
      byGroup: [],
      recent: [],
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByText('Version 0.0.2 is available on GitHub.')).toBeInTheDocument();
    const openUpdate = screen.getByRole('button', { name: 'Open update' });
    expect(openUpdate).toBeInTheDocument();
    await user.click(openUpdate);
    expect(tauriShell.open).toHaveBeenCalledWith('https://github.com/kongjiyu/centinel/releases/tag/v0.0.2');
  });

  it('opens the OAuth connection workload when a provider add control is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 },
      byGroup: [],
      recent: [],
    });
    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole('button', { name: 'Connect Google Drive' }));
    expect(screen.getByRole('dialog', { name: 'Connect Google Drive' })).toBeInTheDocument();
    expect(screen.getByText(/OAuth client credentials/)).toBeInTheDocument();
  });

  it('reports a truthful release-check error without exposing an installer action', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 },
      byGroup: [],
      recent: [],
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.queryByRole('button', { name: 'Open update' })).not.toBeInTheDocument();
  });

  it('renders the usage hierarchy from real totals and keeps the call log separate', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 1000, output: 200, cacheRead: 300, cacheCreation: 400, calls: 5 },
      byGroup: [{
        provider: 'mimo',
        apiFormat: 'openai-compatible',
        model: 'mimo-v2.5',
        totalInput: 1000,
        totalOutput: 200,
        totalCacheRead: 300,
        totalCacheCreation: 400,
        totalCalls: 5,
      }],
      recent: [{
        id: 'call-1',
        projectId: null,
        sessionId: null,
        scope: 'text',
        callKind: 'review',
        stage: 'analysis',
        roundNumber: 1,
        provider: 'mimo',
        apiFormat: 'openai-compatible',
        model: 'mimo-v2.5',
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 300,
        cacheCreationTokens: 400,
        totalTokens: 1900,
        createdAt: '2026-09-08T10:00:00.000Z',
      }],
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(screen.getByText('Tokens processed')).toBeInTheDocument());
    expect(document.querySelector('.usage-total-value')).toHaveTextContent('1, 900');
    expect(screen.getByText('Total requests')).toBeInTheDocument();
    expect(screen.getByText('5', { selector: 'strong' })).toHaveClass('usage-request-value');
    expect(screen.getByText('Cache creation')).toBeInTheDocument();
    expect(screen.getByText('Cache reads')).toBeInTheDocument();

    const overview = screen.getByRole('table', { name: 'Usage overview by provider' });
    expect(within(overview).getByRole('columnheader', { name: 'Total tokens' })).toBeInTheDocument();
    expect(within(overview).getByText('mimo-v2.5')).toBeInTheDocument();
    expect(within(overview).getByText('openai-compatible')).toBeInTheDocument();
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Success rate')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Recent AI calls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent calls' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show log (1)' }));
    const recentCalls = screen.getByRole('table', { name: 'Recent AI calls' });
    expect(recentCalls).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent calls' })).toBeInTheDocument();
    expect(screen.getByText('analysis (r1)')).toBeInTheDocument();
    expect(within(recentCalls).queryByRole('columnheader', { name: 'Scope' })).not.toBeInTheDocument();
    await user.click(within(recentCalls).getByRole('button', { name: 'Time' }));
    expect(within(recentCalls).getByRole('columnheader', { name: 'Time' })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('compacts usage totals longer than six digits', async () => {
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 1_000_000, output: 200_000, cacheRead: 30_000, cacheCreation: 4_567, calls: 123_456 },
      byGroup: [],
      recent: [],
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(document.querySelector('.usage-total-value')).toHaveTextContent('1.23M'));
    expect(screen.getByText('123, 456', { selector: 'strong' })).toBeInTheDocument();
  });

  it('paginates the recent call log in groups of five', async () => {
    const user = userEvent.setup();
    const recent = Array.from({ length: 6 }, (_, index) => ({
      id: `call-${index + 1}`,
      projectId: null,
      sessionId: null,
      scope: 'text' as const,
      callKind: 'review' as const,
      stage: `stage-${index + 1}`,
      roundNumber: null,
      provider: 'mimo' as const,
      apiFormat: 'openai-compatible' as const,
      model: 'mimo-v2.5',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 15,
      createdAt: '2026-09-08T10:00:00.000Z',
    }));
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 60, output: 30, cacheRead: 0, cacheCreation: 0, calls: 6 },
      byGroup: [],
      recent,
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(await screen.findByRole('button', { name: 'Show log (6)' }));

    const table = screen.getByRole('table', { name: 'Recent AI calls' });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('keeps custom provider fields editable and provider actions labelled', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 },
      byGroup: [],
      recent: [],
    });
    vi.mocked(api.testAiProvider).mockResolvedValue({ status: 'pass' });
    vi.mocked(api.updateAiSetting).mockResolvedValue(settings[0]);
    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByLabelText('Base URL', { selector: '#base-url-text' })).toBeEnabled();
    expect(screen.getByLabelText('Model', { selector: '#model-text' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Show API key' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Test provider connectivity' })).toHaveLength(1);
    await user.type(screen.getByLabelText('API Key'), 'temporary-key');
    await user.click(screen.getByRole('button', { name: 'Test provider connectivity' }));
    expect(api.testAiProvider).toHaveBeenCalledWith('text', expect.objectContaining({ apiKey: 'temporary-key' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateAiSetting).toHaveBeenCalledWith('text', expect.objectContaining({ apiKey: 'temporary-key' }));
    await waitFor(() => expect(api.getAiUsage).toHaveBeenCalled());
  });
});
