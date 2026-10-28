import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProviderPanel } from './CodexProviderPanel';
import { api } from '../api/client';
import { openExternalUrl } from '../utils/openExternalUrl';
import type { AiProviderSetting } from '../types';

vi.mock('../api/client', () => ({ api: {
  codexStatus: vi.fn(), codexModels: vi.fn(), codexLogin: vi.fn(), codexLogout: vi.fn(), codexCancelLogin: vi.fn(), testCodex: vi.fn(), updateAiSetting: vi.fn(),
} }));
vi.mock('../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
const connected = { available: true, connected: true, accountLabel: 'tester@example.test', message: 'Connected' };
const disconnected = { available: true, connected: false, accountLabel: null, message: 'Sign in to Codex.' };
type TestModel = Awaited<ReturnType<typeof api.codexModels>>[number] & { imageSupportKnown?: boolean };
const catalog: TestModel[] = [
  { id: 'model-1', label: 'Model One', supportsImages: false, isDefault: true, imageSupportKnown: true },
  { id: 'vision-model', label: 'Vision Model', supportsImages: true, isDefault: false, imageSupportKnown: true },
];
const refresh = vi.fn();

function setting(id: 'text' | 'vision', provider: AiProviderSetting['provider'], model: string): AiProviderSetting {
  return {
    id,
    label: id === 'text' ? 'Review' : 'Dynamic testing',
    provider,
    apiFormat: provider === 'codex' ? 'codex-app-server' : 'openai-compatible',
    hasApiKey: provider !== 'codex',
    apiKeyPreview: '',
    baseUrl: '',
    model,
    updatedAt: '2026-10-25T10:00:00.000Z',
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.codexStatus).mockResolvedValue(connected);
  vi.mocked(api.codexModels).mockResolvedValue(catalog);
  vi.mocked(api.testCodex).mockResolvedValue({ status: 'pass', message: 'Codex test passed.' });
  vi.mocked(api.codexLogin).mockResolvedValue({ loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=test' });
  vi.mocked(openExternalUrl).mockResolvedValue(true);
});

async function chooseModel(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('Codex provider settings', () => {
  it('discloses limited catalog freshness while retaining real installed CLI choices', async () => {
    vi.mocked(api.codexModels).mockResolvedValue(catalog.map(model=>({...model,catalogSource:'codex',catalogWarning:'account_catalog_unavailable'})));
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByText(/Showing models reported by the installed Codex CLI/)).toBeVisible();
    expect(screen.getByRole('combobox',{name:'Review model'})).toBeEnabled();
    expect(api.updateAiSetting).not.toHaveBeenCalled();
  });
  it('loads real account models without preselecting the catalog default and saves separate role choices explicitly', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);

    await screen.findByText('Connected as tester@example.test');
    expect(await screen.findByRole('combobox', { name: 'Review model' })).toHaveTextContent('Choose an available model');
    expect(screen.getByRole('combobox', { name: 'Dynamic testing model' })).toHaveTextContent('Choose an available model');
    expect(screen.getByRole('button', { name: 'Use for Review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use for Dynamic' })).toBeDisabled();
    expect(api.codexModels).toHaveBeenCalledOnce();

    await chooseModel(user, 'Review model', 'Model One');
    await chooseModel(user, 'Dynamic testing model', 'Vision Model');
    await user.click(screen.getByRole('button', { name: 'Use for Review' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('text', {
      provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: 'model-1', fallbackEnabled: false,
    }));
    await user.click(screen.getByRole('button', { name: 'Use for Dynamic' }));
    expect(api.updateAiSetting).toHaveBeenLastCalledWith('vision', expect.objectContaining({ model: 'vision-model' }));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps model selection operable from the keyboard', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    const review = await screen.findByRole('combobox', { name: 'Review model' });

    review.focus();
    await user.keyboard('{Enter}{Home}{Enter}');

    expect(review).toHaveFocus();
    expect(review).toHaveTextContent('Model One');
    expect(screen.getByRole('button', { name: 'Use for Review' })).toBeEnabled();
  });

  it('announces account catalog loading and keeps model choices disabled until it completes', async () => {
    let resolveCatalog!: (models: Awaited<ReturnType<typeof api.codexModels>>) => void;
    vi.mocked(api.codexModels).mockImplementation(() => new Promise(resolve => { resolveCatalog = resolve; }));
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);

    await screen.findByText('Connected as tester@example.test');
    expect(screen.getByRole('status')).toHaveTextContent('Loading available Codex models…');
    const review = screen.getByRole('combobox', { name: 'Review model' });
    expect(review).toBeDisabled();

    await act(async () => resolveCatalog(catalog));
    await waitFor(() => expect(review).toBeEnabled());
    expect(review).toHaveTextContent('Choose an available model');
  });

  it('shows persisted Review and Dynamic models and does not silently replace a model missing from the account list', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[
      setting('text', 'codex', 'saved-old-review'),
      setting('vision', 'codex', 'vision-model'),
    ]} onRefresh={refresh} />);

    await screen.findByText('Connected as tester@example.test');
    expect(screen.getByText('Codex · saved-old-review')).toBeInTheDocument();
    expect(screen.getByText('Codex · vision-model')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('is not in this account’s current list.'));
    expect(screen.getByRole('combobox', { name: 'Review model' })).toHaveTextContent('Choose an available model');
    expect(screen.getByRole('button', { name: 'Use for Review' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Dynamic testing model' })).toHaveTextContent('Vision Model');

    await chooseModel(user, 'Review model', 'Model One');
    expect(screen.getByText('Codex · saved-old-review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use for Review' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('text', expect.objectContaining({ model: 'model-1' })));
  });

  it('guards Dynamic testing and screenshot tests with the selected model image capability', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await screen.findByRole('combobox', { name: 'Dynamic testing model' });

    await chooseModel(user, 'Dynamic testing model', 'Model One');
    expect(screen.getByText('This model supports text only. Dynamic testing requires screenshot support.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test screenshot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use for Dynamic' })).toBeDisabled();

    await chooseModel(user, 'Dynamic testing model', 'Vision Model');
    expect(screen.getByRole('button', { name: 'Test screenshot' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use for Dynamic' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Test screenshot' }));
    expect(api.testCodex).toHaveBeenCalledWith('vision-model', true);
  });

  it('keeps Dynamic disabled when the account catalog cannot confirm screenshot support', async () => {
    vi.mocked(api.codexModels).mockResolvedValueOnce([
      { id: 'unknown-images', label: 'Image support not confirmed', supportsImages: false, isDefault: true, imageSupportKnown: false },
    ] as TestModel[]);
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await screen.findByRole('combobox', { name: 'Dynamic testing model' });
    await chooseModel(user, 'Dynamic testing model', 'Image support not confirmed');

    expect(screen.getByText(/Screenshot support could not be confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test screenshot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use for Dynamic' })).toBeDisabled();
  });

  it('tests the selected Review model and displays failures honestly', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await screen.findByRole('combobox', { name: 'Review model' });
    await chooseModel(user, 'Review model', 'Vision Model');
    await user.click(screen.getByRole('button', { name: 'Test text' }));
    expect(api.testCodex).toHaveBeenCalledWith('vision-model');

    vi.mocked(api.testCodex).mockResolvedValue({ status: 'fail', message: 'Unexpected text response.' });
    await user.click(screen.getByRole('button', { name: 'Test text' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected text response.');
  });

  it('provides a retry after account model loading fails and handles an empty catalog explicitly', async () => {
    vi.mocked(api.codexModels).mockRejectedValueOnce(new Error('Account catalog is temporarily unavailable.'));
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Account catalog is temporarily unavailable.');

    vi.mocked(api.codexModels).mockResolvedValueOnce([]);
    await user.click(screen.getByRole('button', { name: 'Refresh models' }));
    expect(await screen.findByText('No Codex models are available for this account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use for Review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use for Dynamic' })).toBeDisabled();
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
    expect(await screen.findByText('Connected as tester@example.test')).toBeInTheDocument();
  });

  it('disconnects only the local integration and keeps saved Codex model names visible', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[setting('text', 'codex', 'model-1')]} onRefresh={refresh} />);
    await screen.findByRole('combobox', { name: 'Review model' });
    vi.mocked(api.codexStatus).mockResolvedValue(disconnected);
    await user.click(screen.getByRole('button', { name: 'Disconnect Codex' }));
    expect(api.codexLogout).toHaveBeenCalledOnce();
    expect(api.updateAiSetting).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Connect Codex' })).toBeEnabled();
    expect(screen.queryByRole('combobox', { name: 'Review model' })).not.toBeInTheDocument();
    expect(screen.getByText('Codex · model-1')).toBeInTheDocument();
  });

  it('shows a recoverable missing CLI state', async () => {
    vi.mocked(api.codexStatus).mockResolvedValue({ ...disconnected, available: false, message: 'Install Codex CLI or configure CENTINEL_CODEX_BIN.' });
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByText(/Install Codex CLI/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Codex' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh connection' })).toBeEnabled();
  });
});
