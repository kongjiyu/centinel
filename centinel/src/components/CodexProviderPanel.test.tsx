import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexProviderPanel } from './CodexProviderPanel';
import { api } from '../api/client';
import { openExternalUrl } from '../utils/openExternalUrl';
import type { AiProviderSetting } from '../types';

vi.mock('../api/client', () => ({ api: {
  codexStatus: vi.fn(), codexSubscriptionUsage: vi.fn(), codexModels: vi.fn(), codexLogin: vi.fn(), codexLogout: vi.fn(), codexCancelLogin: vi.fn(), testCodex: vi.fn(), updateSharedAiSetting: vi.fn(),
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
  vi.mocked(api.codexSubscriptionUsage).mockResolvedValue({ fiveHour: null, weekly: null });
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
  it('shows all catalog models and tests a text-only selection without screenshots', async () => {
    const user = userEvent.setup();
    vi.mocked(api.codexModels).mockResolvedValue([...catalog.map(model => ({ ...model, catalogSource: 'codex' as const })),
      { id: 'unknown', label: 'Unknown vision', supportsImages: true, imageSupportKnown: false, isDefault: false } as TestModel]);
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByText('Installed CLI catalog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    expect(screen.getByRole('option', { name: 'Vision Model' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Unknown vision (screenshot support unverified)' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: 'Model One (text only)' }));
    expect(screen.getByText(/Dynamic Testing requires confirmed screenshot support/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(api.testCodex).toHaveBeenCalledWith('model-1', false);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateSharedAiSetting).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-1' }));
  });

  it('tests and saves one model for both workflows', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled());
    await chooseModel(user, 'Model', 'Vision Model');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(api.testCodex).toHaveBeenCalledWith('vision-model', true);
    expect(await screen.findByText('Codex test passed.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.updateSharedAiSetting).toHaveBeenCalledWith({ provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: 'vision-model' });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps model selection keyboard accessible', async () => {
    const user = userEvent.setup();
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    const select = await screen.findByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(select).toBeEnabled());
    select.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(select).toHaveTextContent('Model One (text only)');
  });

  it('retains the saved model when it cannot be selected and allows catalog recovery', async () => {
    const user = userEvent.setup();
    vi.mocked(api.codexModels).mockRejectedValueOnce(new Error('Catalog unavailable'));
    render(<CodexProviderPanel settings={[setting('text', 'codex', 'old-model')]} onRefresh={refresh} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog unavailable');
    await user.click(screen.getByRole('button', { name: 'Refresh Codex connection' }));
    expect(await screen.findByText('Saved model unavailable: old-model')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('announces pending and empty model catalogs', async () => {
    let resolve!: (models: TestModel[]) => void;
    vi.mocked(api.codexModels).mockImplementationOnce(() => new Promise(result => { resolve = result; }));
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    expect(await screen.findByText('Loading models…')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    await act(async () => resolve([]));
    expect(await screen.findByText('No Codex models are available.')).toBeVisible();
  });

  it('reports provider test failures', async () => {
    const user = userEvent.setup();
    vi.mocked(api.testCodex).mockResolvedValue({ status: 'fail', message: 'Provider failed.' });
    render(<CodexProviderPanel settings={[setting('text', 'codex', 'vision-model')]} onRefresh={refresh} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider failed.');
  });

  it('opens browser sign-in and allows explicit cancellation', async () => {
    const user = userEvent.setup();
    vi.mocked(api.codexStatus).mockResolvedValue(disconnected);
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    const connect = await screen.findByRole('button', { name: 'Connect Codex' });
    await waitFor(() => expect(connect).toBeEnabled());
    await user.click(connect);
    expect(openExternalUrl).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?state=test');
    await user.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    expect(api.codexCancelLogin).toHaveBeenCalledWith('login-1');
  });

  it('disconnects locally without changing saved settings', async () => {
    const user = userEvent.setup();
    vi.mocked(api.codexStatus).mockResolvedValueOnce(connected).mockResolvedValue(disconnected);
    render(<CodexProviderPanel settings={[setting('text', 'codex', 'vision-model')]} onRefresh={refresh} />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(api.codexLogout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Connect Codex' })).toBeEnabled();
    expect(api.updateSharedAiSetting).not.toHaveBeenCalled();
  });

  it('shows when the local CLI is unavailable', async () => {
    vi.mocked(api.codexStatus).mockResolvedValue({ ...disconnected, available: false });
    render(<CodexProviderPanel settings={[]} onRefresh={refresh} />);
    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(2));
    expect(screen.getByRole('button', { name: 'Connect Codex' })).toBeDisabled();
  });

});
