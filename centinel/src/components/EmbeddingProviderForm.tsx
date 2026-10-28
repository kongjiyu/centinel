import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, RefreshCw, Save, ScanEye, Stethoscope } from 'lucide-react';
import type { AiProviderSetting, AiTestResult, EmbeddingModelOption, EmbeddingModelUsage, EmbeddingSettingsCatalog } from '../types';
import { api } from '../api/client';
import { IconButton, StatusBadge } from './CommandUI';
import { Select } from './Select';
import { openExternalUrl } from '../utils/openExternalUrl';
import { userFacingError } from '../utils/userFacingError';
import './EmbeddingProviderForm.css';

const VOYAGE_BASE_URL = 'https://api.voyageai.com/v1';
const DEFAULT_VOYAGE_MODEL = 'voyage-4-lite';

type EmbeddingProviderFormProps = {
  setting: AiProviderSetting;
  onRefresh: () => Promise<void>;
};

type EmbeddingProvider = 'voyage' | 'custom';
type EmbeddingTestOutcome = {
  result: AiTestResult;
  provider: EmbeddingProvider;
  model: string;
};

function savedProvider(setting: AiProviderSetting): EmbeddingProvider {
  if (setting.embeddingProvider) return setting.embeddingProvider;
  // Rows predating embeddingProvider metadata are custom when they contain saved configuration.
  return setting.hasApiKey || setting.baseUrl.trim() || setting.model.trim() ? 'custom' : 'voyage';
}

function initialModel(setting: AiProviderSetting, provider: EmbeddingProvider): string {
  if (setting.model.trim() && savedProvider(setting) === provider) return setting.model;
  return provider === 'voyage' ? DEFAULT_VOYAGE_MODEL : '';
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function modelUsage(catalog: EmbeddingSettingsCatalog | null, model: string): EmbeddingModelUsage | null {
  if (!catalog || !catalog.usageAvailable) return null;
  return catalog.usage.find(item => item.model === model) ?? null;
}

function usageText(catalog: EmbeddingSettingsCatalog | null, usage: EmbeddingModelUsage | null, model: string): {
  tokens: string;
  calls: string;
  detail: string | null;
} {
  if (!catalog?.usageAvailable) return { tokens: 'Unknown', calls: 'Unknown', detail: 'Centinel usage data is unavailable.' };
  if (!usage) return { tokens: 'No recorded usage', calls: '0', detail: null };
  const tokens = usage.knownTokens === null
    ? 'Unknown'
    : usage.unknownCalls > 0
      ? `At least ${formatCount(usage.knownTokens)}`
      : formatCount(usage.knownTokens);
  return {
    tokens,
    calls: formatCount(usage.calls),
    detail: usage.unknownCalls > 0
      ? `${formatCount(usage.unknownCalls)} of ${formatCount(usage.calls)} calls have unknown token counts.`
      : usage.knownTokens === null
        ? `Token usage for ${model || 'this model'} is unknown.`
        : null,
  };
}

function savedModelOptions(models: EmbeddingModelOption[], model: string): EmbeddingModelOption[] {
  if (!model || models.some(option => option.id === model)) return models;
  return [{
    id: model,
    label: `${model} (saved model, not in published catalog)`,
    provider: 'voyage',
    dimensions: 0,
    publishedFreeTokens: null,
    documentationUrl: '',
  }, ...models];
}

export function EmbeddingProviderForm({ setting, onRefresh }: EmbeddingProviderFormProps) {
  const persistedProvider = savedProvider(setting);
  const settingVersion = [
    setting.provider,
    setting.apiFormat,
    setting.embeddingProvider ?? '',
    setting.embeddingDimensions ?? '',
    setting.hasApiKey,
    setting.apiKeyPreview,
    setting.baseUrl,
    setting.model,
    setting.updatedAt,
  ].join('\u0000');
  const settingVersionRef = useRef(settingVersion);
  settingVersionRef.current = settingVersion;
  const catalogRequestRef = useRef(0);
  const testRequestRef = useRef(0);
  const [provider, setProvider] = useState<EmbeddingProvider>(persistedProvider);
  const [voyageModel, setVoyageModel] = useState(() => initialModel(setting, 'voyage'));
  const [customModel, setCustomModel] = useState(() => initialModel(setting, 'custom'));
  const [customBaseUrl, setCustomBaseUrl] = useState(() => persistedProvider === 'custom' ? setting.baseUrl : '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<EmbeddingSettingsCatalog | null>(null);
  const [testOutcome, setTestOutcome] = useState<EmbeddingTestOutcome | null>(null);
  const [saved, setSaved] = useState(false);
  const [endpointOpen, setEndpointOpen] = useState(persistedProvider === 'custom' && Boolean(setting.baseUrl));

  const model = provider === 'voyage' ? voyageModel : customModel;
  const baseUrl = provider === 'voyage' ? VOYAGE_BASE_URL : customBaseUrl;
  const savedBaseUrl = persistedProvider === 'voyage' ? VOYAGE_BASE_URL : setting.baseUrl.trim();
  const credentialDestinationMatches = provider === persistedProvider && (provider === 'voyage' || baseUrl.trim() === savedBaseUrl);
  const savedKeyCanBeReused = setting.hasApiKey && credentialDestinationMatches;
  const draftDirty = provider !== persistedProvider || model !== setting.model || (provider === 'custom' && baseUrl.trim() !== setting.baseUrl.trim()) || Boolean(apiKey.trim());
  const selectedCatalogModel = catalog?.models.find(option => option.id === model) ?? null;
  const usage = useMemo(() => modelUsage(catalog, model), [catalog, model]);
  const usageSummary = useMemo(() => usageText(catalog, usage, model), [catalog, model, usage]);
  const options = useMemo(() => savedModelOptions(catalog?.models ?? [], model), [catalog?.models, model]);

  const loadCatalog = useCallback(async (manual = false) => {
    const requestId = ++catalogRequestRef.current;
    const requestedSettingVersion = settingVersionRef.current;
    if (manual) setRefreshingUsage(true);
    setCatalogError(null);
    try {
      const nextCatalog = await api.embeddingModels();
      if (requestId !== catalogRequestRef.current || requestedSettingVersion !== settingVersionRef.current) return;
      setCatalog(nextCatalog);
    } catch (cause) {
      if (requestId === catalogRequestRef.current && requestedSettingVersion === settingVersionRef.current) {
        setCatalogError(userFacingError(cause, 'Embedding model and usage details could not be loaded.'));
      }
    } finally {
      if (requestId === catalogRequestRef.current && requestedSettingVersion === settingVersionRef.current) {
        setRefreshingUsage(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog, settingVersion]);

  // Reconcile only when persisted values change; unrelated parent renders must not erase a draft key.
  useEffect(() => {
    const nextProvider = savedProvider(setting);
    // Ignore diagnostics that finish against credentials/model settings that are no longer saved.
    testRequestRef.current += 1;
    setTesting(false);
    setRefreshingUsage(false);
    setProvider(nextProvider);
    setVoyageModel(initialModel(setting, 'voyage'));
    setCustomModel(initialModel(setting, 'custom'));
    setCustomBaseUrl(nextProvider === 'custom' ? setting.baseUrl : '');
    setApiKey('');
    setTestOutcome(null);
    setError(null);
    setEndpointOpen(nextProvider === 'custom' && Boolean(setting.baseUrl));
  }, [settingVersion]);

  const updateModel = (nextModel: string) => {
    if (provider === 'voyage') setVoyageModel(nextModel);
    else setCustomModel(nextModel);
    setError(null);
    setSaved(false);
    setTestOutcome(null);
  };

  const updateProvider = (nextProvider: string) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider as EmbeddingProvider);
    // A saved credential belongs to its original provider/endpoint. Require a fresh key after switching.
    setApiKey('');
    setError(null);
    setSaved(false);
    setTestOutcome(null);
  };

  const save = async () => {
    if (saving || testing) return;
    setError(null);
    setSaved(false);
    setTestOutcome(null);
    if (!model.trim()) {
      setError(provider === 'voyage' ? 'Choose a Voyage model.' : 'Embedding model is required.');
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      setError('Custom endpoint URL is required.');
      return;
    }
    if (!apiKey.trim() && !savedKeyCanBeReused) {
      setError(setting.hasApiKey ? 'Enter a new API key for the selected provider or endpoint.' : 'API key is required.');
      return;
    }
    if (provider === 'custom' && !/^https?:\/\//i.test(baseUrl.trim())) {
      setError('Base URL must start with http:// or https://.');
      return;
    }

    setSaving(true);
    let providerSettingsSaved = false;
    try {
      await api.updateAiSetting('embedding', {
        provider: 'custom',
        apiFormat: 'openai-compatible',
        embeddingProvider: provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        fallbackEnabled: false,
      });
      providerSettingsSaved = true;
      setApiKey('');
      setSaved(true);
      await onRefresh();
    } catch (cause) {
      setError(userFacingError(cause, providerSettingsSaved
        ? 'Settings were saved, but the current settings could not be refreshed.'
        : 'Embedding provider settings could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (saving || testing) return;
    const requestId = ++testRequestRef.current;
    const testedProvider = persistedProvider;
    const testedModel = setting.model || 'model not selected';
    setTestOutcome(null);
    setError(null);
    setTesting(true);
    try {
      const result = await api.testAiProvider('embedding');
      if (requestId === testRequestRef.current) {
        setTestOutcome({ result, provider: testedProvider, model: testedModel });
      }
      // A resolved provider diagnostic may add a usage row, even when it reports failure.
      void loadCatalog();
    } catch (cause) {
      if (requestId === testRequestRef.current) {
        setTestOutcome({
          result: { status: 'fail', message: userFacingError(cause, 'The saved embedding provider could not be reached.') },
          provider: testedProvider,
          model: testedModel,
        });
      }
    } finally {
      if (requestId === testRequestRef.current) setTesting(false);
    }
  };

  const providerLabel = provider === 'voyage' ? 'Voyage AI' : 'Custom OpenAI-compatible';
  const savedModelLabel = setting.model || 'model not selected';
  const usageUnavailable = !catalog || !catalog.usageAvailable;

  return <div className="provider-form embedding-provider-form" aria-labelledby="embedding-provider-heading">
    <div className="provider-form-header">
      <h4 id="embedding-provider-heading">Embedding model provider</h4>
      <StatusBadge label={setting.hasApiKey ? 'Configured' : 'Optional'} tone={setting.hasApiKey ? 'success' : 'neutral'} />
    </div>
    <p className="embedding-provider-description">
      {provider === 'voyage'
        ? 'Choose an embedding model for local repository search. Compatible indexes are backed up to your project.'
        : 'Configure the embedding provider for local repository search.'}
    </p>

    <div className="form-field">
      <label htmlFor="embedding-provider">Provider</label>
      <Select
        id="embedding-provider"
        value={provider}
        onChange={updateProvider}
        disabled={saving}
        options={[
          { value: 'voyage', label: 'Voyage AI' },
          { value: 'custom', label: 'Custom (OpenAI-compatible)' },
        ]}
      />
    </div>

    {provider === 'voyage' ? <div className="form-field">
      <label htmlFor="embedding-model">Embedding model</label>
      <Select
        id="embedding-model"
        value={model}
        onChange={updateModel}
        options={options.map(option => ({ value: option.id, label: option.label }))}
        disabled={!catalog || Boolean(catalogError) || saving}
        required
      />
      {catalogError && <p className="embedding-inline-error" role="alert">{catalogError}</p>}
      {catalog && selectedCatalogModel && <p className="embedding-field-hint">
        {selectedCatalogModel.dimensions} dimensions. {selectedCatalogModel.publishedFreeTokens === null
          ? 'No published free allowance is listed for this model.'
          : `Published free allowance: ${formatCount(selectedCatalogModel.publishedFreeTokens)} tokens.`}
        {selectedCatalogModel.documentationUrl && <> <a href={selectedCatalogModel.documentationUrl} target="_blank" rel="noreferrer">Model details</a></>}
      </p>}
      {!catalog && !catalogError && <p className="embedding-field-hint" role="status">Loading published Voyage models…</p>}
    </div> : <div className="form-field">
      <label htmlFor="embedding-model">Embedding model</label>
      <input id="embedding-model" value={model} onChange={event => updateModel(event.target.value)} placeholder="embedding-model-name" disabled={saving} />
      <p className="embedding-field-hint">{persistedProvider === 'custom' ? setting.embeddingDimensions ?? 1536 : 1536} dimensions. Keep existing custom model names unchanged unless you intend to configure a different model.</p>
    </div>}

    <div className="form-field">
      <label htmlFor="embedding-api-key">API key</label>
      <div className="api-key-field">
        <input
          id="embedding-api-key"
          type={showKey ? 'text' : 'password'}
          autoComplete="new-password"
          value={apiKey}
          onChange={event => { setApiKey(event.target.value); setError(null); setSaved(false); setTestOutcome(null); }}
          placeholder={savedKeyCanBeReused ? `Current: ${setting.apiKeyPreview}` : 'Enter API key'}
          disabled={saving}
        />
        <IconButton icon={showKey ? EyeOff : Eye} label={showKey ? 'Hide embedding API key' : 'Show embedding API key'} onClick={() => setShowKey(value => !value)} disabled={saving} />
      </div>
      <p className="embedding-field-hint">A blank key keeps the saved key only when the provider and endpoint stay the same.</p>
    </div>

    <details className="embedding-endpoint-details" open={endpointOpen} onToggle={event => setEndpointOpen(event.currentTarget.open)}>
      <summary>Endpoint details</summary>
      {provider === 'voyage' ? <div className="form-field embedding-readonly-endpoint">
        <label htmlFor="embedding-voyage-endpoint">Base URL</label>
        <input id="embedding-voyage-endpoint" value={VOYAGE_BASE_URL} readOnly aria-readonly="true" disabled={saving} />
        <p className="embedding-field-hint">Voyage uses its fixed API endpoint.</p>
      </div> : <div className="form-field">
        <label htmlFor="embedding-custom-endpoint">Base URL</label>
        <input id="embedding-custom-endpoint" value={baseUrl} onChange={event => { setCustomBaseUrl(event.target.value); setError(null); setSaved(false); setTestOutcome(null); }} placeholder="https://provider.example.com/v1" disabled={saving} />
        <p className="embedding-field-hint">Changing a saved endpoint requires a new API key.</p>
      </div>}
    </details>

    <section className="embedding-usage" aria-labelledby="embedding-usage-heading">
      <div className="embedding-usage-heading">
        <h5 id="embedding-usage-heading">Recorded usage</h5>
        <button className="btn-secondary embedding-refresh-usage" type="button" onClick={() => void loadCatalog(true)} disabled={refreshingUsage}>
          <RefreshCw size={14} aria-hidden="true" /> {refreshingUsage ? 'Refreshing…' : 'Refresh usage'}
        </button>
      </div>
      <dl className="embedding-usage-grid">
        <div><dt>Model</dt><dd>{model || 'Not selected'}</dd></div>
        <div><dt>Known tokens</dt><dd>{usageSummary.tokens}</dd></div>
        <div><dt>Calls</dt><dd>{usageSummary.calls}</dd></div>
      </dl>
      {usageSummary.detail && <p className="embedding-usage-note">{usageSummary.detail}</p>}
      <p className="embedding-usage-note">Usage includes Centinel's recorded calls only; it may not include activity from other applications or account users.</p>
      {provider === 'voyage' && catalog && <div className="embedding-balance-note">
        <span>Remaining usage: {catalog.remaining.tokens === null ? 'Not reported' : formatCount(catalog.remaining.tokens)}</span>
        <a href={catalog.remaining.dashboardUrl} onClick={event => { event.preventDefault(); void openExternalUrl(catalog.remaining.dashboardUrl); }}>
          Voyage dashboard <ExternalLink size={13} aria-hidden="true" />
        </a>
        <p>{catalog.remaining.message} A published free allowance is pricing information, not your account balance.</p>
      </div>}
      {usageUnavailable && <p className="embedding-usage-note">Usage values are unknown until the catalog reports them.</p>}
    </section>

    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && <p className="form-success" role="status"><Check size={14} aria-hidden="true" /> Settings saved. The API key was cleared from this form.</p>}
    <div className="form-actions">
      <button className="btn-secondary embedding-test-button" type="button" onClick={() => void test()} disabled={testing || saving || !setting.hasApiKey || draftDirty}>
        <Stethoscope size={16} aria-hidden="true" /> {testing ? 'Testing saved connection…' : 'Test saved connection'}
      </button>
      <button className="btn-primary" type="button" onClick={() => void save()} disabled={saving || testing}>
        <Save size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
    <p className="embedding-test-scope">{setting.hasApiKey && setting.model.trim()
      ? `Tests the saved ${savedModelLabel} settings for ${persistedProvider === 'voyage' ? 'Voyage AI' : 'the custom provider'}. Save changes before testing.`
      : 'Save a model and API key before testing.'}</p>
    {testOutcome && <div className={`test-result provider-test-status ${testOutcome.result.status}`} role={testOutcome.result.status === 'pass' ? 'status' : 'alert'}>
      {testOutcome.result.status === 'pass' ? <Check size={16} aria-hidden="true" /> : <ScanEye size={16} aria-hidden="true" />}
      <div><strong>{testOutcome.result.status === 'pass' ? 'Connection successful' : 'Connection failed'}</strong>
        <span className="provider-test-scope">Tested the saved {testOutcome.model} settings for {testOutcome.provider === 'voyage' ? 'Voyage AI' : 'the custom provider'}.</span>
        {testOutcome.result.message && <p className="provider-test-message">{testOutcome.result.message}</p>}
        {testOutcome.result.hint && <p className="test-result-hint">{testOutcome.result.hint}</p>}
      </div>
    </div>}
    {catalog && catalog.verifiedAt && <span className="embedding-catalog-source" aria-label="Model source">Model list from published Voyage documentation.</span>}
    <span className="embedding-provider-scope" aria-live="polite">Current selection: {providerLabel}{provider === 'voyage' && selectedCatalogModel ? `, ${selectedCatalogModel.dimensions} dimensions` : ''}.</span>
  </div>;
}
