import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Save, ScanEye, Stethoscope } from 'lucide-react';
import type { AiProviderSetting, AiTestResult, EmbeddingModelOption, EmbeddingSettingsCatalog } from '../types';
import { api } from '../api/client';
import { IconButton, StatusBadge } from './CommandUI';
import { Select } from './Select';
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
  const options = useMemo(() => savedModelOptions(catalog?.models ?? [], model), [catalog?.models, model]);

  const loadCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current;
    const requestedSettingVersion = settingVersionRef.current;
    setCatalogError(null);
    try {
      const nextCatalog = await api.embeddingModels();
      if (requestId !== catalogRequestRef.current || requestedSettingVersion !== settingVersionRef.current) return;
      setCatalog(nextCatalog);
    } catch (cause) {
      if (requestId === catalogRequestRef.current && requestedSettingVersion === settingVersionRef.current) {
        setCatalogError(userFacingError(cause, 'Embedding model and usage details could not be loaded.'));
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


  return <div className="provider-form embedding-provider-form" aria-labelledby="embedding-provider-heading">
    <div className="provider-form-header">
      <h4 id="embedding-provider-heading">Embedding model provider</h4>
      <StatusBadge label={setting.hasApiKey ? 'Configured' : 'Optional'} tone={setting.hasApiKey ? 'success' : 'neutral'} />
    </div>
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
      {catalogError && <p className="embedding-inline-error" role="alert">{catalogError} <button type="button" className="btn-link" onClick={() => void loadCatalog()}>Retry model catalog</button></p>}
      {!catalog && !catalogError && <p className="embedding-field-hint" role="status">Loading published Voyage models…</p>}
    </div> : <div className="form-field">
      <label htmlFor="embedding-model">Embedding model</label>
      <input id="embedding-model" value={model} onChange={event => updateModel(event.target.value)} placeholder="embedding-model-name" disabled={saving} />
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
    </div>

    <details className="embedding-endpoint-details" open={endpointOpen} onToggle={event => setEndpointOpen(event.currentTarget.open)}>
      <summary>Endpoint details</summary>
      {provider === 'voyage' ? <div className="form-field embedding-readonly-endpoint">
        <label htmlFor="embedding-voyage-endpoint">Base URL</label>
        <input id="embedding-voyage-endpoint" value={VOYAGE_BASE_URL} readOnly aria-readonly="true" disabled={saving} />
      </div> : <div className="form-field">
        <label htmlFor="embedding-custom-endpoint">Base URL</label>
        <input id="embedding-custom-endpoint" value={baseUrl} onChange={event => { setCustomBaseUrl(event.target.value); setError(null); setSaved(false); setTestOutcome(null); }} placeholder="https://provider.example.com/v1" disabled={saving} />
      </div>}
    </details>

    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && <p className="form-success" role="status"><Check size={14} aria-hidden="true" /> Settings saved. The API key was cleared from this form.</p>}
    <div className="form-actions">
      <IconButton icon={Stethoscope} label={testing ? 'Testing saved connection…' : 'Test saved connection'} onClick={() => void test()} disabled={testing || saving || !setting.hasApiKey || draftDirty} />
      <button className="btn-primary" type="button" onClick={() => void save()} disabled={saving || testing}>
        <Save size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
    {testOutcome && <div className={`test-result provider-test-status ${testOutcome.result.status}`} role={testOutcome.result.status === 'pass' ? 'status' : 'alert'}>
      {testOutcome.result.status === 'pass' ? <Check size={16} aria-hidden="true" /> : <ScanEye size={16} aria-hidden="true" />}
      <div><strong>{testOutcome.result.status === 'pass' ? 'Connection successful' : 'Connection failed'}</strong>
        <span className="provider-test-scope">Tested the saved {testOutcome.model} settings for {testOutcome.provider === 'voyage' ? 'Voyage AI' : 'the custom provider'}.</span>
        {testOutcome.result.message && <p className="provider-test-message">{testOutcome.result.message}</p>}
        {testOutcome.result.hint && <p className="test-result-hint">{testOutcome.result.hint}</p>}
      </div>
    </div>}
  </div>;
}
