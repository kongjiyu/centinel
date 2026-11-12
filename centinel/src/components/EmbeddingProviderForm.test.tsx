import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { AiProviderSetting, EmbeddingSettingsCatalog } from '../types';
import { openExternalUrl } from '../utils/openExternalUrl';
import { EmbeddingProviderForm } from './EmbeddingProviderForm';

vi.mock('../api/client', () => ({ api: {
  embeddingModels: vi.fn(),
  updateAiSetting: vi.fn(),
  testAiProvider: vi.fn(),
} }));
vi.mock('../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));

const voyageBaseUrl = 'https://api.voyageai.com/v1';
const refresh = vi.fn(async () => undefined);

function catalog(overrides: Partial<EmbeddingSettingsCatalog> = {}): EmbeddingSettingsCatalog {
  return {
    source: 'published_catalog',
    verifiedAt: '2026-10-26T00:00:00.000Z',
    models: [
      { id: 'voyage-4-lite', label: 'Voyage 4 Lite', provider: 'voyage', dimensions: 1024, publishedFreeTokens: 200_000_000, documentationUrl: 'https://docs.voyageai.com/reference/embeddings-api' },
      { id: 'voyage-4', label: 'Voyage 4', provider: 'voyage', dimensions: 1024, publishedFreeTokens: 200_000_000, documentationUrl: 'https://docs.voyageai.com/reference/embeddings-api' },
      { id: 'voyage-4-large', label: 'Voyage 4 Large', provider: 'voyage', dimensions: 1024, publishedFreeTokens: 200_000_000, documentationUrl: 'https://docs.voyageai.com/reference/embeddings-api' },
    ],
    usageAvailable: true,
    usage: [],
    remaining: {
      status: 'not_reported',
      tokens: null,
      message: 'Voyage does not report remaining account balance through a public API.',
      dashboardUrl: 'https://dashboard.voyageai.com/',
    },
    ...overrides,
  };
}

function setting(overrides: Partial<AiProviderSetting> = {}): AiProviderSetting {
  return {
    id: 'embedding',
    label: 'Embedding',
    provider: 'custom',
    apiFormat: 'openai-compatible',
    hasApiKey: false,
    apiKeyPreview: '',
    baseUrl: '',
    model: '',
    updatedAt: '2026-10-26T10:00:00.000Z',
    ...overrides,
  };
}

function savedVoyageSetting(overrides: Partial<AiProviderSetting> = {}): AiProviderSetting {
  return setting({
    embeddingProvider: 'voyage',
    hasApiKey: true,
    apiKeyPreview: '••••••89',
    baseUrl: voyageBaseUrl,
    model: 'voyage-4-lite',
    updatedAt: '2026-10-26T10:00:00.000Z',
    ...overrides,
  });
}

function renderForm(current = setting(), onRefresh = refresh) {
  return render(<EmbeddingProviderForm setting={current} onRefresh={onRefresh} />);
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(await screen.findByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function waitForVoyageModels() {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Embedding model' })).toBeEnabled());
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.embeddingModels).mockResolvedValue(catalog());
  vi.mocked(api.updateAiSetting).mockResolvedValue(savedVoyageSetting());
  vi.mocked(api.testAiProvider).mockResolvedValue({ status: 'pass', message: 'The embedding provider returned a valid vector.' });
  vi.mocked(openExternalUrl).mockResolvedValue(true);
});

describe('EmbeddingProviderForm', () => {
  it('offers all published Voyage models, saves the selection, and retains save feedback after refresh', async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();
    await waitForVoyageModels();

    await choose(user, 'Embedding model', 'Voyage 4 Large');
    await user.type(screen.getByLabelText('API key'), 'secret-voyage-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('embedding', {
      provider: 'custom',
      apiFormat: 'openai-compatible',
      embeddingProvider: 'voyage',
      apiKey: 'secret-voyage-key',
      baseUrl: voyageBaseUrl,
      model: 'voyage-4-large',
      fallbackEnabled: false,
    }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(document.body).not.toHaveTextContent('secret-voyage-key');

    rerender(<EmbeddingProviderForm setting={savedVoyageSetting({
      model: 'voyage-4-large',
      updatedAt: '2026-10-26T10:01:00.000Z',
    })} onRefresh={refresh} />);
    expect(await screen.findByText('Settings saved. The API key was cleared from this form.')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('keeps testing tied to the saved model and disables save and retest while the request is running', async () => {
    const user = userEvent.setup();
    let resolveTest!: (result: { status: string; message: string }) => void;
    vi.mocked(api.testAiProvider).mockReturnValue(new Promise(resolve => { resolveTest = resolve; }));
    renderForm(savedVoyageSetting());
    await waitForVoyageModels();

    await user.click(screen.getByRole('button', { name: 'Test saved connection' }));
    await waitFor(() => expect(api.testAiProvider).toHaveBeenCalledWith('embedding'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Testing saved connection…' })).toBeDisabled();

    await choose(user, 'Embedding model', 'Voyage 4');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Testing saved connection…' })).toBeDisabled();

    await act(async () => resolveTest({ status: 'pass', message: 'Probe completed.' }));
    await waitFor(() => expect(api.embeddingModels).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Tested the saved voyage-4-lite settings for Voyage AI.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toHaveTextContent('Voyage 4');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled();
  });

  it('disables a saved-connection test while a save is in progress', async () => {
    const user = userEvent.setup();
    let resolveSave!: (result: AiProviderSetting) => void;
    vi.mocked(api.updateAiSetting).mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
    renderForm(savedVoyageSetting());
    await waitForVoyageModels();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled();
    expect(api.testAiProvider).not.toHaveBeenCalled();

    await act(async () => resolveSave(savedVoyageSetting({ updatedAt: '2026-10-26T10:01:00.000Z' })));
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved');
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeEnabled();
  });

  it('requires a new API key when switching from a legacy custom provider to Voyage', async () => {
    const user = userEvent.setup();
    const legacy = setting({
      hasApiKey: true,
      apiKeyPreview: '••••••12',
      baseUrl: 'https://legacy.example.com/v1',
      model: 'legacy-embedding-model',
    });
    renderForm(legacy);
    await waitFor(() => expect(api.embeddingModels).toHaveBeenCalledOnce());

    await choose(user, 'Provider', 'Voyage AI');
    await waitForVoyageModels();
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a new API key for the selected provider or endpoint.');
    expect(api.updateAiSetting).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('API key'), 'fresh-voyage-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('embedding', expect.objectContaining({
      embeddingProvider: 'voyage',
      apiKey: 'fresh-voyage-key',
      baseUrl: voyageBaseUrl,
    })));
  });

  it('requires a new credential after a custom endpoint change', async () => {
    const user = userEvent.setup();
    renderForm(setting({
      embeddingProvider: 'custom',
      hasApiKey: true,
      apiKeyPreview: '••••••12',
      baseUrl: 'https://old.example.com/v1',
      model: 'custom-embed-v1',
      embeddingDimensions: 768,
    }));

    const endpoint = screen.getByLabelText('Base URL');
    await user.clear(endpoint);
    await user.type(endpoint, 'https://new.example.com/v1');
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a new API key for the selected provider or endpoint.');
    expect(api.updateAiSetting).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('API key'), 'new-endpoint-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('embedding', expect.objectContaining({
      embeddingProvider: 'custom',
      apiKey: 'new-endpoint-key',
      baseUrl: 'https://new.example.com/v1',
      model: 'custom-embed-v1',
    })));
  });

  it('keeps recorded embedding usage out of the provider form', async () => {
    render(<EmbeddingProviderForm setting={setting()} onRefresh={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Embedding model' });
    expect(screen.queryByRole('region', { name: 'Recorded usage' })).not.toBeInTheDocument();
  });

  it('preserves legacy custom provider settings and reports unavailable usage as unknown', async () => {
    const user = userEvent.setup();
    vi.mocked(api.embeddingModels).mockResolvedValue(catalog({ usageAvailable: false }));
    const legacy = setting({
      hasApiKey: true,
      apiKeyPreview: '••••••12',
      baseUrl: 'https://legacy.example.com/v1',
      model: 'legacy-embed-v1',
      embeddingDimensions: 768,
    });
    renderForm(legacy);

    expect(await screen.findByRole('combobox', { name: 'Provider' })).toHaveTextContent('Custom (OpenAI-compatible)');
    expect(screen.getByLabelText('Embedding model')).toHaveValue('legacy-embed-v1');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://legacy.example.com/v1');
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateAiSetting).toHaveBeenCalledWith('embedding', expect.objectContaining({
      embeddingProvider: 'custom',
      apiKey: '',
      baseUrl: 'https://legacy.example.com/v1',
      model: 'legacy-embed-v1',
    })));
  });

  it('shows catalog errors with a retry and recovers the published model choices', async () => {
    const user = userEvent.setup();
    vi.mocked(api.embeddingModels)
      .mockRejectedValueOnce(new Error('Published Voyage model catalog is unavailable.'))
      .mockResolvedValueOnce(catalog());
    renderForm();

    expect(await screen.findByRole('alert')).toHaveTextContent('Published Voyage model catalog is unavailable.');
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry model catalog' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Embedding model' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await choose(user, 'Embedding model', 'Voyage 4 Large');
  });

  it('reloads the model catalog when a save refreshes persisted settings during an earlier load', async () => {
    const user = userEvent.setup();
    let resolveInitialCatalog!: (result: EmbeddingSettingsCatalog) => void;
    let resolveRefreshedCatalog!: (result: EmbeddingSettingsCatalog) => void;
    vi.mocked(api.embeddingModels)
      .mockImplementationOnce(() => new Promise(resolve => { resolveInitialCatalog = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRefreshedCatalog = resolve; }));
    const { rerender } = renderForm(setting());

    await waitFor(() => expect(api.embeddingModels).toHaveBeenCalledOnce());
    await user.type(screen.getByLabelText('API key'), 'saved-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Settings saved. The API key was cleared from this form.')).toBeInTheDocument();

    rerender(<EmbeddingProviderForm setting={savedVoyageSetting({ updatedAt: '2026-10-26T10:01:00.000Z' })} onRefresh={refresh} />);
    await waitFor(() => expect(api.embeddingModels).toHaveBeenCalledTimes(2));
    await act(async () => resolveRefreshedCatalog(catalog()));
    await waitForVoyageModels();
    await act(async () => resolveInitialCatalog(catalog({ models: [] })));
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toHaveTextContent('Voyage 4 Lite');
  });


  it('ignores a test result after saved settings change', async () => {
    const user = userEvent.setup();
    let resolveTest!: (result: { status: string; message: string }) => void;
    vi.mocked(api.testAiProvider).mockReturnValue(new Promise(resolve => { resolveTest = resolve; }));
    const { rerender } = renderForm(savedVoyageSetting());
    await user.click(screen.getByRole('button', { name: 'Test saved connection' }));
    expect(screen.getByRole('button', { name: 'Testing saved connection…' })).toBeDisabled();
    rerender(<EmbeddingProviderForm setting={savedVoyageSetting({
      model: 'voyage-4', updatedAt: '2026-10-26T10:01:00.000Z',
    })} onRefresh={refresh} />);
    await act(async () => resolveTest({ status: 'pass', message: 'Earlier model test completed.' }));
    expect(screen.queryByText('Earlier model test completed.')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toHaveTextContent('Voyage 4');
  });
});
