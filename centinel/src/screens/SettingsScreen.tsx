import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowDownUp, Save, Check, Eye, EyeOff, Stethoscope, ScanEye, RefreshCw, ExternalLink, PackageCheck, Cable, Bot, ChartNoAxesCombined, Ellipsis, Plus } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import type { AiProviderSetting, AiProvider, AiApiFormat, AiTestResult } from '../types';
import { api } from '../api/client';
import { CommandPageHeader, IconButton, StatusBadge } from '../components/CommandUI';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { userFacingError } from '../utils/userFacingError';
import { openExternalUrl } from '../utils/openExternalUrl';

type ProviderPreset = {
  id: string;
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  baseUrl: string;
  model: string;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'mimo-openai', label: 'MiMo (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5' },
  { id: 'mimo-anthropic', label: 'MiMo (Anthropic-compatible)', provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic', model: 'mimo-v2.5' },
  { id: 'mimo-pro-openai', label: 'MiMo Pro (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-pro' },
  { id: 'mimo-pro-anthropic', label: 'MiMo Pro (Anthropic-compatible)', provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic', model: 'mimo-v2.5-pro' },
  { id: 'gemini', label: 'Google Gemini', provider: 'gemini', apiFormat: 'google-native', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-2.5-flash' },
  { id: 'custom-openai', label: 'Custom (OpenAI-compatible)', provider: 'custom', apiFormat: 'openai-compatible', baseUrl: '', model: '' },
  { id: 'custom-anthropic', label: 'Custom (Anthropic-compatible)', provider: 'custom', apiFormat: 'anthropic-compatible', baseUrl: '', model: '' },
];

function findMatchingPreset(setting: AiProviderSetting): ProviderPreset | null {
  return PROVIDER_PRESETS.find(p =>
    p.provider === setting.provider && p.apiFormat === setting.apiFormat &&
    p.baseUrl === setting.baseUrl && p.model === setting.model
  ) || null;
}

export { findMatchingPreset, PROVIDER_PRESETS };

type Props = {
  settings: AiProviderSetting[];
  onRefresh: () => Promise<void>;
};

export const RELEASES_API_URL = 'https://api.github.com/repos/kongjiyu/centinel/releases/latest';
export const RELEASES_URL = 'https://github.com/kongjiyu/centinel/releases';
const VERSION_MOCK_VALUE = 'Centinel v0.0.1';

export type LatestRelease = {
  version: string;
  url: string;
};

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  if (!latestParts || !currentParts) return false;
  for (let index = 0; index < latestParts.length; index += 1) {
    if (latestParts[index] !== currentParts[index]) return latestParts[index] > currentParts[index];
  }
  return false;
}

export async function loadApplicationVersion(): Promise<string | null> {
  try {
    const version = await getVersion();
    return version.trim() || null;
  } catch {
    return null;
  }
}

export async function fetchLatestRelease(fetcher: typeof fetch = globalThis.fetch): Promise<LatestRelease> {
  const response = await fetcher(RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub release check failed (${response.status}).`);
  const payload = await response.json() as { tag_name?: unknown; html_url?: unknown };
  const version = typeof payload.tag_name === 'string' ? payload.tag_name.trim().replace(/^v/i, '') : '';
  if (!version || !parseVersion(version)) throw new Error('GitHub returned a release without a comparable version.');
  const url = typeof payload.html_url === 'string' && payload.html_url.trim() ? payload.html_url : RELEASES_URL;
  return { version, url };
}

export async function openReleasePage(url: string): Promise<boolean> {
  return openExternalUrl(url);
}

function findPresetForValues(provider: AiProvider | null | undefined, apiFormat: AiApiFormat | null | undefined, baseUrl: string, model: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find(p => p.provider === provider && p.apiFormat === apiFormat && p.baseUrl === baseUrl && p.model === model) || null;
}

function AppVersionSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(true);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'current' | 'error'>('idle');
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadApplicationVersion().then(value => {
      if (active) setVersion(value);
      if (active) setVersionLoading(false);
    });
    return () => { active = false; };
  }, []);

  const checkForUpdates = async () => {
    if (!version) {
      setUpdateState('error');
      setUpdateMessage('Update checks require a running desktop application version.');
      return;
    }
    setUpdateState('checking');
    setLatestRelease(null);
    setUpdateMessage(null);
    try {
      const release = await fetchLatestRelease();
      setLatestRelease(release);
      if (isNewerVersion(release.version, version)) {
        setUpdateState('available');
        setUpdateMessage(`Version ${release.version} is available on GitHub.`);
      } else {
        setUpdateState('current');
        setUpdateMessage('Centinel is up to date.');
      }
    } catch (cause) {
      setUpdateState('error');
      setUpdateMessage(userFacingError(cause, 'Updates could not be checked. Try again later.'));
    }
  };

  const formatVersion = (value: string | null) => value ? `Centinel v${value.replace(/^v/i, '')}` : VERSION_MOCK_VALUE;
  const currentVersion = formatVersion(version);
  const latestVersion = formatVersion(latestRelease?.version ?? null);

  return (
    <section className="settings-section settings-versions" aria-labelledby="settings-app-version-title">
      <div className="settings-section-heading">
        <h2 id="settings-app-version-title"><SectionTitleIcon Icon={PackageCheck} />App Version</h2>
      </div>
      <div className="app-version-row">
        <dl className="settings-version-list" aria-live="polite">
          <div>
            <dt>Current version</dt>
            <dd>{currentVersion}</dd>
          </div>
          <div>
            <dt>Latest version</dt>
            <dd>{latestVersion}</dd>
          </div>
        </dl>
        <div className="app-version-actions">
          <button type="button" className="btn-secondary" onClick={() => void checkForUpdates()} disabled={versionLoading || !version || updateState === 'checking'}>
            <RefreshCw size={14} aria-hidden="true" />
            {updateState === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {updateState === 'available' && latestRelease && (
            <button type="button" className="btn-primary" onClick={() => { void openReleasePage(latestRelease.url); }}>
              <ExternalLink size={14} aria-hidden="true" /> Open update
            </button>
          )}
        </div>
      </div>
      {updateMessage && <p className={`app-update-message app-update-${updateState}`} role={updateState === 'error' ? 'alert' : 'status'}>{updateMessage}</p>}
    </section>
  );
}

function ProviderForm({ setting, onRefresh }: { setting: AiProviderSetting; onRefresh: () => Promise<void> }) {
  const matchingPreset = findMatchingPreset(setting);
  const [selectedPresetId, setSelectedPresetId] = useState(matchingPreset?.id || 'custom-openai');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl);
  const [model, setModel] = useState(setting.model);
  const initialFallbackPreset = findPresetForValues(setting.fallbackProvider, setting.fallbackApiFormat, setting.fallbackBaseUrl ?? '', setting.fallbackModel ?? '');
  const [fallbackEnabled, setFallbackEnabled] = useState(Boolean(setting.fallbackEnabled));
  const [fallbackPresetId, setFallbackPresetId] = useState(initialFallbackPreset?.id ?? (setting.fallbackApiFormat === 'anthropic-compatible' ? 'custom-anthropic' : 'custom-openai'));
  const [fallbackApiKey, setFallbackApiKey] = useState('');
  const [showFallbackKey, setShowFallbackKey] = useState(false);
  const [fallbackBaseUrl, setFallbackBaseUrl] = useState(setting.fallbackBaseUrl ?? '');
  const [fallbackModel, setFallbackModel] = useState(setting.fallbackModel ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync local form state whenever the persisted setting changes (e.g. after save + onRefresh).
  // Without this, selectedPresetId is pinned to its initial value on first mount and the API Format
  // input can revert to "openai-compatible" even when the persisted apiFormat is anthropic-compatible.
  // User edits made during the current session still win until the next render with a new setting prop.
  useEffect(() => {
    setBaseUrl(setting.baseUrl);
    setModel(setting.model);
    const match = findMatchingPreset(setting);
    setSelectedPresetId(match?.id ?? (setting.apiFormat === 'anthropic-compatible' ? 'custom-anthropic' : 'custom-openai'));
    setFallbackEnabled(Boolean(setting.fallbackEnabled));
    setFallbackBaseUrl(setting.fallbackBaseUrl ?? '');
    setFallbackModel(setting.fallbackModel ?? '');
    const fallbackMatch = findPresetForValues(setting.fallbackProvider, setting.fallbackApiFormat, setting.fallbackBaseUrl ?? '', setting.fallbackModel ?? '');
    setFallbackPresetId(fallbackMatch?.id ?? (setting.fallbackApiFormat === 'anthropic-compatible' ? 'custom-anthropic' : 'custom-openai'));
  }, [setting.id, setting.baseUrl, setting.model, setting.apiFormat, setting.provider, setting.fallbackEnabled, setting.fallbackProvider, setting.fallbackApiFormat, setting.fallbackBaseUrl, setting.fallbackModel]);

  const selectedPreset = PROVIDER_PRESETS.find(p => p.id === selectedPresetId);
  const isCustom = selectedPresetId.startsWith('custom-');
  const isConfigured = setting.hasApiKey;
  const fallbackPreset = PROVIDER_PRESETS.find(p => p.id === fallbackPresetId);
  const fallbackIsCustom = fallbackPresetId.startsWith('custom-');

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PROVIDER_PRESETS.find(p => p.id === presetId);
    if (preset && !presetId.startsWith('custom-')) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const handleFallbackPresetChange = (presetId: string) => {
    setFallbackPresetId(presetId);
    const preset = PROVIDER_PRESETS.find(p => p.id === presetId);
    if (preset && !presetId.startsWith('custom-')) {
      setFallbackBaseUrl(preset.baseUrl);
      setFallbackModel(preset.model);
    }
  };

  const handleSave = async () => {
    setError(null); setSaved(false);
    if (!apiKey && !isConfigured) { setError('API key is required'); return; }
    if (!baseUrl.trim()) { setError('Base URL is required'); return; }
    if (!model.trim()) { setError('Model is required'); return; }
    if (fallbackEnabled && !fallbackApiKey && !setting.fallbackHasApiKey) { setError('Fallback API key is required'); return; }
    if (fallbackEnabled && !fallbackBaseUrl.trim()) { setError('Fallback Base URL is required'); return; }
    if (fallbackEnabled && !fallbackModel.trim()) { setError('Fallback model is required'); return; }
    setSaving(true);
    try {
      await api.updateAiSetting(setting.id, {
        provider: selectedPreset?.provider || 'custom',
        apiFormat: selectedPreset?.apiFormat || 'openai-compatible',
        apiKey: apiKey || '',
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        fallbackEnabled,
        fallbackProvider: fallbackEnabled ? fallbackPreset?.provider ?? 'custom' : null,
        fallbackApiFormat: fallbackEnabled ? fallbackPreset?.apiFormat ?? 'openai-compatible' : null,
        fallbackApiKey: fallbackApiKey || '',
        fallbackBaseUrl: fallbackEnabled ? fallbackBaseUrl.trim() : '',
        fallbackModel: fallbackEnabled ? fallbackModel.trim() : '',
      });
      setApiKey(''); setFallbackApiKey(''); setSaved(true); await onRefresh();
    } catch (e) { setError(userFacingError(e, 'The provider settings could not be saved. Try again.')); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      // Test against what the user has on screen, not just what's persisted.
      // Empty form fields fall back to the saved value (e.g. apiKey when not retyped).
      const result = await api.testAiProvider(setting.id, {
        provider: selectedPreset?.provider,
        apiFormat: selectedPreset?.apiFormat,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
      });
      setTestResult(result);
    }
    catch (e) { setTestResult({ status: 'fail', message: userFacingError(e, 'The provider could not be reached. Check the settings and try again.') }); }
    finally { setTesting(false); }
  };

  return (
    <div className="provider-form">
      <div className="provider-form-header">
        <h4>
          Custom Model Provider
        </h4>
        <StatusBadge label={isConfigured ? 'Configured' : 'Setup required'} tone={isConfigured ? 'success' : 'warning'} />
      </div>

      <div className="form-field">
        <label htmlFor={`provider-${setting.id}`}>Provider</label>
        <Select
          id={`provider-${setting.id}`}
          value={selectedPresetId}
          onChange={handlePresetChange}
          groups={[
            { label: 'MiMo', options: PROVIDER_PRESETS.filter(p => p.provider === 'mimo').map(p => ({ value: p.id, label: p.label })) },
            { label: 'Google', options: PROVIDER_PRESETS.filter(p => p.provider === 'gemini').map(p => ({ value: p.id, label: p.label })) },
            { label: 'Custom', options: PROVIDER_PRESETS.filter(p => p.provider === 'custom').map(p => ({ value: p.id, label: p.label })) },
          ]}
        />
      </div>

      <div className="form-field">
        <label htmlFor={`api-key-${setting.id}`}>API Key</label>
        <div className="api-key-field">
          <input
            id={`api-key-${setting.id}`}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={isConfigured ? `Current: ${setting.apiKeyPreview}` : 'Enter API key'}
          />
          <IconButton
            icon={showKey ? EyeOff : Eye}
            label={showKey ? 'Hide API key' : 'Show API key'}
            onClick={() => setShowKey(!showKey)}
          />
        </div>
      </div>

      <div className={`provider-endpoint-fields ${isCustom ? 'is-custom' : ''}`}>
        <div className="form-field">
          <label htmlFor={`base-url-${setting.id}`}>Base URL</label>
          <input id={`base-url-${setting.id}`} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1/messages" disabled={!isCustom} />
        </div>

        <div className="form-field">
          <label htmlFor={`model-${setting.id}`}>Model</label>
          <input id={`model-${setting.id}`} value={model} onChange={e => setModel(e.target.value)} placeholder="model-name" disabled={!isCustom} />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor={`api-format-${setting.id}`}>API Format</label>
        <input id={`api-format-${setting.id}`} value={selectedPreset?.apiFormat || 'openai-compatible'} disabled className="readonly-field" />
      </div>

      <section className="fallback-provider-config" aria-labelledby={`fallback-provider-heading-${setting.id}`}>
        <div className="fallback-provider-heading">
          <div>
            <h5 id={`fallback-provider-heading-${setting.id}`}>Fallback provider</h5>
            <p>Used only when the primary provider cannot complete the Review. Primary and fallback share a maximum of three total attempts.</p>
          </div>
          <label className="fallback-provider-toggle"><input type="checkbox" checked={fallbackEnabled} onChange={event => setFallbackEnabled(event.target.checked)} /> Enable fallback</label>
        </div>
        {fallbackEnabled && <div className="fallback-provider-fields">
          <div className="form-field">
            <label htmlFor={`fallback-provider-${setting.id}`}>Fallback provider</label>
            <Select
              id={`fallback-provider-${setting.id}`}
              value={fallbackPresetId}
              onChange={handleFallbackPresetChange}
              groups={[
                { label: 'MiMo', options: PROVIDER_PRESETS.filter(p => p.provider === 'mimo').map(p => ({ value: p.id, label: p.label })) },
                { label: 'Google', options: PROVIDER_PRESETS.filter(p => p.provider === 'gemini').map(p => ({ value: p.id, label: p.label })) },
                { label: 'Custom', options: PROVIDER_PRESETS.filter(p => p.provider === 'custom').map(p => ({ value: p.id, label: p.label })) },
              ]}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`fallback-api-key-${setting.id}`}>Fallback API Key</label>
            <div className="api-key-field">
              <input id={`fallback-api-key-${setting.id}`} type={showFallbackKey ? 'text' : 'password'} value={fallbackApiKey} onChange={event => setFallbackApiKey(event.target.value)} placeholder={setting.fallbackHasApiKey ? `Current: ${setting.fallbackApiKeyPreview}` : 'Enter fallback API key'} />
              <IconButton icon={showFallbackKey ? EyeOff : Eye} label={showFallbackKey ? 'Hide fallback API key' : 'Show fallback API key'} onClick={() => setShowFallbackKey(value => !value)} />
            </div>
          </div>
          <div className={`provider-endpoint-fields ${fallbackIsCustom ? 'is-custom' : ''}`}>
            <div className="form-field"><label htmlFor={`fallback-base-url-${setting.id}`}>Fallback Base URL</label><input id={`fallback-base-url-${setting.id}`} value={fallbackBaseUrl} onChange={event => setFallbackBaseUrl(event.target.value)} disabled={!fallbackIsCustom} /></div>
            <div className="form-field"><label htmlFor={`fallback-model-${setting.id}`}>Fallback model</label><input id={`fallback-model-${setting.id}`} value={fallbackModel} onChange={event => setFallbackModel(event.target.value)} disabled={!fallbackIsCustom} /></div>
          </div>
          <div className="form-field"><label htmlFor={`fallback-api-format-${setting.id}`}>Fallback API Format</label><input id={`fallback-api-format-${setting.id}`} value={fallbackPreset?.apiFormat ?? 'openai-compatible'} disabled className="readonly-field" /></div>
        </div>}
      </section>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-success"><Check size={14} /> Settings saved</p>}

      <div className="form-actions">
        <button className="btn-secondary provider-connectivity-button" type="button" onClick={handleTest} disabled={testing || (!apiKey && !isConfigured)}>
          <Stethoscope size={16} aria-hidden="true" /> {testing ? 'Testing connection…' : 'Test connection'}
        </button>
        <button className="btn-primary" type="button" onClick={handleSave} disabled={saving}>
          <Save size={14} aria-hidden="true" /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {testResult && (
        <div className={`test-result provider-test-status ${testResult.status}`} role={testResult.status === 'pass' ? 'status' : 'alert'}>
          {testResult.status === 'pass' ? <Check size={16} aria-hidden="true" /> : <ScanEye size={16} aria-hidden="true" />}
          <div><strong>{testResult.status === 'pass' ? 'Connection successful' : 'Connection failed'}</strong>
          <span className="provider-test-scope">Tested with the current form settings. Save any edits before using them in reviews.</span>
          {testResult.message && <p className="provider-test-message">{testResult.message}</p>}
          {testResult.hint && (
            <p className="test-result-hint">{testResult.hint}</p>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmbeddingProviderForm({ setting, onRefresh }: { setting: AiProviderSetting; onRefresh: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl);
  const [model, setModel] = useState(setting.model);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBaseUrl(setting.baseUrl);
    setModel(setting.model);
  }, [setting.baseUrl, setting.model]);

  const save = async () => {
    setError(null); setSaved(false); setResult(null);
    if (!apiKey.trim() && !setting.hasApiKey) { setError('API key is required.'); return; }
    if (!/^https?:\/\//i.test(baseUrl.trim())) { setError('Base URL must start with http:// or https://.'); return; }
    if (!model.trim()) { setError('Embedding model is required.'); return; }
    setSaving(true);
    try {
      await api.updateAiSetting('embedding', {
        provider: 'custom', apiFormat: 'openai-compatible', apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(), model: model.trim(), fallbackEnabled: false,
      });
      setApiKey(''); setSaved(true); await onRefresh();
    } catch (cause) {
      setError(userFacingError(cause, 'Source-indexing settings could not be saved. Try again.'));
    } finally { setSaving(false); }
  };

  const test = async () => {
    setResult(null); setError(null); setTesting(true);
    try { setResult(await api.testAiProvider('embedding')); }
    catch (cause) { setResult({ status: 'fail', message: userFacingError(cause, 'The source-indexing provider could not be reached.') }); }
    finally { setTesting(false); }
  };

  return <div className="provider-form embedding-provider-form" aria-labelledby="embedding-provider-heading">
    <div className="provider-form-header">
      <h4 id="embedding-provider-heading">Source indexing</h4>
      <StatusBadge label={setting.hasApiKey ? 'Configured' : 'Optional'} tone={setting.hasApiKey ? 'success' : 'neutral'} />
    </div>
    <p className="embedding-provider-description">Optional semantic retrieval for frozen Review sources. Without it, Centinel keeps the durable text index. Configure an OpenAI-compatible embedding endpoint that returns 1536 dimensions.</p>
    <div className="form-field">
      <label htmlFor="embedding-api-key">API key</label>
      <div className="api-key-field">
        <input id="embedding-api-key" type={showKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={setting.hasApiKey ? `Current: ${setting.apiKeyPreview}` : 'Enter API key'} />
        <IconButton icon={showKey ? EyeOff : Eye} label={showKey ? 'Hide source-indexing API key' : 'Show source-indexing API key'} onClick={() => setShowKey(value => !value)} />
      </div>
    </div>
    <div className="provider-endpoint-fields is-custom">
      <div className="form-field"><label htmlFor="embedding-base-url">Base URL</label><input id="embedding-base-url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://provider.example.com/v1" /></div>
      <div className="form-field"><label htmlFor="embedding-model">Embedding model</label><input id="embedding-model" value={model} onChange={event => setModel(event.target.value)} placeholder="embedding-model-name" /></div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && <p className="form-success" role="status"><Check size={14} aria-hidden="true" /> Settings saved</p>}
    <div className="form-actions">
      <button className="btn-secondary" type="button" onClick={() => void test()} disabled={testing || !setting.hasApiKey}>{testing ? 'Testing…' : 'Test connection'}</button>
      <button className="btn-primary" type="button" onClick={() => void save()} disabled={saving}><Save size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}</button>
    </div>
    {result && <div className={`test-result provider-test-status ${result.status}`} role={result.status === 'pass' ? 'status' : 'alert'}>
      {result.status === 'pass' ? <Check size={16} aria-hidden="true" /> : <ScanEye size={16} aria-hidden="true" />}
      <div><strong>{result.status === 'pass' ? 'Connection successful' : 'Connection failed'}</strong>
        <span className="provider-test-scope">Tested with saved source-indexing settings.</span>
        {result.message && <p className="provider-test-message">{result.message}</p>}
        {result.hint && <p className="test-result-hint">{result.hint}</p>}
      </div>
    </div>}
  </div>;
}

// ── Token Usage Dashboard ─────────────────────────────────────────────────
//
// Renders aggregated token usage grouped by (provider, apiFormat, model).
// Reads from /settings/ai/usage which returns:
//   - totals: { input, output, cacheRead, cacheCreation, calls }
//   - byGroup: per-(provider,apiFormat,model) subtotals
//   - recent: last 50 call rows
//
// The panel is intentionally compact: a 3-up totals strip, a per-group
// table, and a collapsible recent-calls list. All numbers are formatted
// with thousands separators so the user can scan them at a glance.

type UsageSummary = Awaited<ReturnType<typeof api.getAiUsage>>;
type UsageCallKind = 'review' | 'test' | 'dynamic';
type RecentCall = UsageSummary['recent'][number];
type RecentSortKey = 'time' | 'kind' | 'stage' | 'model' | 'input' | 'output' | 'cache';

const CALL_KIND_LABEL: Record<UsageCallKind, string> = {
  review: 'Review',
  test: 'Provider test',
  dynamic: 'Dynamic Testing activity',
};

function formatTokenCount(n: number): string {
  return formatUsageNumber(n);
}

function formatWholeNumber(n: number): string {
  return formatUsageNumber(n);
}

function formatUsageNumber(n: number): string {
  const value = Math.max(0, Math.round(n));
  if (value <= 999_999) return value.toLocaleString('en-US').replace(/,/g, ', ');

  const units = [
    { value: 1_000_000_000_000, suffix: 'T' },
    { value: 1_000_000_000, suffix: 'B' },
    { value: 1_000_000, suffix: 'M' },
    { value: 1_000, suffix: 'K' },
  ];
  const unit = units.find(candidate => value >= candidate.value) ?? units[units.length - 1];
  const scaled = value / unit.value;
  const precision = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(precision).replace(/\.0+$|(?<=\.[0-9])0+$/g, '')}${unit.suffix}`;
}

function totalTokensForGroup(group: UsageSummary['byGroup'][number]): number {
  return group.totalInput + group.totalOutput + group.totalCacheRead + group.totalCacheCreation;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function TokenUsagePanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [recentPage, setRecentPage] = useState(0);
  const [recentSort, setRecentSort] = useState<{ key: RecentSortKey; direction: 'asc' | 'desc' }>({ key: 'time', direction: 'desc' });
  const recentPageSize = 5;

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getAiUsage();
      setSummary(data);
      setRecentPage(0);
    } catch (e) {
      setError(userFacingError(e, 'Usage data could not be loaded. Try again.'));
    } finally {
      setLoading(false);
    }
  };

  // Reload on mount, on filter change, and on manual refresh. The user
  // navigates away and back to this page often, so always fetch fresh
  // numbers rather than relying on a session cache.
  useEffect(() => { void load(); }, []);

  const sortedRecentCalls = useMemo(() => {
    const records = [...(summary?.recent ?? [])];
    const valueFor = (record: RecentCall): string | number => {
      switch (recentSort.key) {
        case 'time': return Date.parse(record.createdAt) || 0;
        case 'kind': return CALL_KIND_LABEL[record.callKind];
        case 'stage': return `${record.stage ?? ''}:${record.roundNumber ?? ''}`;
        case 'model': return record.model;
        case 'input': return record.inputTokens;
        case 'output': return record.outputTokens;
        case 'cache': return record.cacheReadTokens + record.cacheCreationTokens;
      }
    };
    return records.sort((a, b) => {
      const left = valueFor(a);
      const right = valueFor(b);
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      return recentSort.direction === 'asc' ? comparison : -comparison;
    });
  }, [recentSort, summary]);
  const recentPageCount = Math.max(1, Math.ceil(sortedRecentCalls.length / recentPageSize));
  const recentCalls = sortedRecentCalls.slice(recentPage * recentPageSize, (recentPage + 1) * recentPageSize);
  const toggleRecentSort = (key: RecentSortKey) => {
    setRecentSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
    setRecentPage(0);
  };
  const recentHeader = (label: string, key: RecentSortKey, numeric = false) => {
    const active = recentSort.key === key;
    return <th scope="col" className={numeric ? 'usage-num' : undefined} aria-sort={active ? (recentSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="usage-sort-button" onClick={() => toggleRecentSort(key)}>
        {label}<ArrowDownUp size={13} aria-hidden="true" />
      </button>
    </th>;
  };

  return (
    <div className="settings-usage-panel">
      <div className="settings-section-heading settings-usage-heading">
        <h2 id="settings-usage-title"><SectionTitleIcon Icon={ChartNoAxesCombined} />Usage</h2>
        <button className="usage-sync-button" type="button" onClick={load} disabled={loading} aria-label={loading ? 'Syncing usage data' : 'Sync usage data'} title={loading ? 'Syncing usage data' : 'Sync usage data'}>
          <RefreshCw size={16} aria-hidden="true" className={loading ? 'is-spinning' : undefined} />
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {loading && !summary ? (
        <p className="card-empty">Loading usage data...</p>
      ) : summary ? (
        <>
          <div className="usage-summary">
            <div className="usage-total">
              <span className="usage-stat-label">Tokens processed</span>
              <strong className="usage-total-value">
                {formatWholeNumber(summary.totals.input + summary.totals.output + summary.totals.cacheRead + summary.totals.cacheCreation)}
              </strong>
            </div>
            <div className="usage-request-summary">
              <span className="usage-stat-label">Total requests</span>
              <strong className="usage-request-value">{formatWholeNumber(summary.totals.calls)}</strong>
            </div>
          </div>

          <dl className="usage-metric-strip" aria-label="Token metrics">
            <div className="usage-metric">
              <dt>Input</dt>
              <dd>{formatTokenCount(summary.totals.input)}</dd>
            </div>
            <div className="usage-metric">
              <dt>Output</dt>
              <dd>{formatTokenCount(summary.totals.output)}</dd>
            </div>
            <div className="usage-metric">
              <dt>Cache creation</dt>
              <dd>{formatTokenCount(summary.totals.cacheCreation)}</dd>
            </div>
            <div className="usage-metric">
              <dt>Cache reads</dt>
              <dd>{formatTokenCount(summary.totals.cacheRead)}</dd>
            </div>
          </dl>

          {summary.byGroup.length === 0 ? (
            <p className="card-empty">No usage recorded yet. Run a Review, Dynamic Testing activity, or provider test to populate this dashboard.</p>
          ) : (
            <section className="usage-overview" aria-labelledby="usage-overview-title">
              <div className="usage-table-heading">
                <h4 id="usage-overview-title">Usage overview</h4>
              </div>
              <div className="usage-table-scroll">
                <table className="usage-table" aria-label="Usage overview by provider">
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Format</th>
                      <th scope="col">Model</th>
                      <th scope="col" className="usage-num">Requests</th>
                      <th scope="col" className="usage-num">Input</th>
                      <th scope="col" className="usage-num">Output</th>
                      <th scope="col" className="usage-num">Cache</th>
                      <th scope="col" className="usage-num">Total tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byGroup.map((g, idx) => (
                      <tr key={`${g.provider}-${g.apiFormat}-${g.model}-${idx}`}>
                        <td>{g.provider}</td>
                        <td><code>{g.apiFormat}</code></td>
                        <td><code>{g.model}</code></td>
                        <td className="usage-num">{formatWholeNumber(g.totalCalls)}</td>
                        <td className="usage-num">{formatTokenCount(g.totalInput)}</td>
                        <td className="usage-num">{formatTokenCount(g.totalOutput)}</td>
                        <td className="usage-num">{formatTokenCount(g.totalCacheRead + g.totalCacheCreation)}</td>
                        <td className="usage-num">{formatWholeNumber(totalTokensForGroup(g))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="usage-recent" aria-label="AI call log">
            <div className="usage-recent-header">
              {showRecent && <h4 id="usage-recent-title">Recent calls</h4>}
              <button
                type="button"
                className="btn-link"
                onClick={() => setShowRecent(v => !v)}
                aria-expanded={showRecent}
                aria-controls="usage-recent-log"
              >
                {showRecent ? 'Hide' : 'Show'} log ({summary.recent.length})
              </button>
            </div>
            {summary.recent.length === 0 ? (
              <p className="usage-recent-empty">No recent calls recorded.</p>
            ) : showRecent ? (
              <>
                <div className="usage-table-scroll" id="usage-recent-log">
                <table className="usage-table usage-recent-table" aria-label="Recent AI calls">
                  <thead>
                    <tr>
                      {recentHeader('Time', 'time')}
                      {recentHeader('Kind', 'kind')}
                      {recentHeader('Stage', 'stage')}
                      {recentHeader('Model', 'model')}
                      {recentHeader('Input', 'input', true)}
                      {recentHeader('Output', 'output', true)}
                      {recentHeader('Cache', 'cache', true)}
                    </tr>
                  </thead>
                  <tbody>
                    {recentCalls.map(r => (
                      <tr key={r.id}>
                        <td>{formatTimestamp(r.createdAt)}</td>
                        <td>{CALL_KIND_LABEL[r.callKind]}</td>
                        <td>{r.stage ?? '—'}{r.roundNumber !== null ? ` (r${r.roundNumber})` : ''}</td>
                        <td><code>{r.model}</code></td>
                        <td className="usage-num">{formatTokenCount(r.inputTokens)}</td>
                        <td className="usage-num">{formatTokenCount(r.outputTokens)}</td>
                        <td className="usage-num">{formatTokenCount(r.cacheReadTokens + r.cacheCreationTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                {summary.recent.length > recentPageSize && (
                <nav className="usage-pagination" aria-label="Recent calls pagination">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRecentPage(page => Math.max(0, page - 1))}
                    disabled={recentPage === 0}
                  >
                    Previous
                  </button>
                  <span aria-live="polite">Page {recentPage + 1} of {recentPageCount}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRecentPage(page => Math.min(recentPageCount - 1, page + 1))}
                    disabled={recentPage >= recentPageCount - 1}
                  >
                    Next
                  </button>
                </nav>
                )}
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

export function SettingsScreen({ settings, onRefresh }: Props) {
  const textSetting = settings.find(s => s.id === 'text');
  const embeddingSetting = settings.find(s => s.id === 'embedding');
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDefinition | null>(null);
  const [managedConnection, setManagedConnection] = useState<ConnectionDefinition | null>(null);
  const [githubStatus, setGithubStatus] = useState<{ connected: boolean; login: string | null; message: string } | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const pendingConnectionRef = useRef<{ provider: 'github' | 'google_drive' | 'slack'; priorUpdatedAt: string | null } | null>(null);
  const [pendingConnection, setPendingConnection] = useState(false);

  const refreshConnections = async () => {
    try {
      const [github, connected] = await Promise.all([
        typeof api.githubStatus === 'function' ? api.githubStatus() : Promise.resolve({ connected: false, login: null, message: 'Connection status is unavailable.' }),
        typeof api.listIntegrations === 'function' ? api.listIntegrations() : Promise.resolve([]),
      ]);
      setGithubStatus(github);
      setIntegrations(connected.map(item => ({
        provider: item.provider,
        accountLabel: item.accountLabel,
        accountId: item.accountId,
        scopes: item.scopes,
        status: item.status,
        updatedAt: item.updatedAt,
      })));
      const pending = pendingConnectionRef.current;
      const refreshedRecord = connected.find(item => item.provider === pending?.provider && item.status === 'connected');
      if (pending && refreshedRecord && (pending.provider !== 'github' || github.connected)
        && (!pending.priorUpdatedAt || refreshedRecord.updatedAt !== pending.priorUpdatedAt)) {
        pendingConnectionRef.current = null;
        setPendingConnection(false);
        setConnectionDialog(null);
        setManagedConnection(null);
        setConnectionMessage(null);
      }
    } catch (cause) {
      setGithubStatus({ connected: false, login: null, message: userFacingError(cause, 'GitHub connection status is unavailable.') });
      setIntegrations([]);
    }
  };

  useEffect(() => {
    void refreshConnections();
    // OAuth completes in an external browser window. Refresh as soon as the
    // desktop regains focus so the new provider status is visible without a
    // manual page reload.
    const handleWindowFocus = () => { void refreshConnections(); };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, []);

  useEffect(() => {
    if (!pendingConnection) return;
    const timer = window.setInterval(() => { void refreshConnections(); }, 2500);
    return () => window.clearInterval(timer);
  }, [pendingConnection]);

  const backendProvider = (connection: ConnectionDefinition): 'github' | 'google_drive' | 'slack' => connection.id === 'google-drive' ? 'google_drive' : connection.id;
  const isConnected = (connection: ConnectionDefinition): boolean => {
    const provider = backendProvider(connection);
    return provider === 'github' ? Boolean(githubStatus?.connected) : integrations.some(item => item.provider === provider && item.status === 'connected');
  };

  const connectionState = (connection: ConnectionDefinition): ConnectionState => {
    if (!isConnected(connection)) return 'disconnected';
    const record = connectedRecord(connection);
    if (backendProvider(connection) === 'slack' && slackMissingScopes(record?.scopes ?? '').length) return 'reauthorization_required';
    return 'connected';
  };

  const beginConnection = async (connection: ConnectionDefinition) => {
    setConnectionBusy(true);
    setConnectionMessage(null);
    try {
      const result = await api.startIntegration(backendProvider(connection));
      const opened = await openReleasePage(result.authorizeUrl);
      if (opened) {
        const provider = backendProvider(connection);
        pendingConnectionRef.current = { provider, priorUpdatedAt: integrations.find(item => item.provider === provider)?.updatedAt ?? null };
        setPendingConnection(true);
      }
      setConnectionMessage(opened ? `The ${connection.label} authorization page is open. Complete it, then return here.` : `Centinel could not open the ${connection.label} authorization page.`);
    } catch (cause) {
      setConnectionMessage(userFacingError(cause, `${connection.label} is not configured yet.`));
    } finally {
      setConnectionBusy(false);
      void refreshConnections();
    }
  };

  const disconnect = async (connection: ConnectionDefinition) => {
    setConnectionBusy(true);
    try {
      pendingConnectionRef.current = null;
      setPendingConnection(false);
      await api.disconnectIntegration(backendProvider(connection));
      setManagedConnection(null);
      await refreshConnections();
    } catch (cause) {
      setConnectionMessage(userFacingError(cause, `The ${connection.label} connection could not be removed.`));
    } finally {
      setConnectionBusy(false);
    }
  };

  const connectedRecord = (connection: ConnectionDefinition | null): IntegrationSummary | null => {
    if (!connection) return null;
    const provider = backendProvider(connection);
    return integrations.find(item => item.provider === provider && item.status === 'connected') ?? null;
  };

  const accountDetails = (connection: ConnectionDefinition | null): ConnectionAccountDetails => {
    if (!connection) return { primary: null, secondary: null };
    const record = connectedRecord(connection);
    if (backendProvider(connection) === 'github') {
      const login = githubStatus?.login ?? record?.accountLabel ?? null;
      return {
        primary: login ? `@${login.replace(/^@/, '')}` : null,
        secondary: record?.accountId?.includes('@') ? record.accountId : null,
      };
    }
    const accountLabel = record?.accountLabel?.trim() || null;
    const accountId = record?.accountId?.trim() || null;
    return {
      primary: accountLabel,
      secondary: accountId && accountId.includes('@') ? accountId : null,
    };
  };

  return (
    <div className="screen settings-screen animate-fade-in">
      <CommandPageHeader title="Settings" />

      <div className="settings-layout">
        <AppVersionSection />

        <section className="settings-section settings-connectors" aria-labelledby="settings-connections-title">
          <div className="settings-section-heading">
            <h2 id="settings-connections-title"><SectionTitleIcon Icon={Cable} />Connections</h2>
          </div>
          <ConnectionsList onConnect={(connection) => { setConnectionMessage(null); setConnectionDialog(connection); }} onManage={(connection) => { setConnectionMessage(null); setManagedConnection(connection); }} connectionState={connectionState} />
        </section>

        <section className="settings-section settings-provider-section" aria-labelledby="model-provider-title">
          <div className="settings-section-heading">
            <h2 id="model-provider-title"><SectionTitleIcon Icon={Bot} />Model Provider</h2>
          </div>
          <div className="settings-provider-forms">
            {textSetting && <ProviderForm setting={textSetting} onRefresh={onRefresh} />}
            {embeddingSetting && <EmbeddingProviderForm setting={embeddingSetting} onRefresh={onRefresh} />}
            {!textSetting && (
              <p className="card-empty">No model service providers are available in this build.</p>
            )}
          </div>
        </section>

        <section className="settings-section settings-usage-section" aria-labelledby="settings-usage-title">
          <TokenUsagePanel />
        </section>

      </div>

      <Modal
        isOpen={Boolean(connectionDialog)}
        onClose={() => { pendingConnectionRef.current = null; setPendingConnection(false); setConnectionDialog(null); }}
        title={connectionDialog ? `Connect ${connectionDialog.label}` : 'Connect'}
        headerAside={connectionDialog ? <ConnectionStatusTag connected={false} /> : undefined}
        width={520}
      >
        {connectionDialog && <>
          <ConnectionAccessDetails connection={connectionDialog} />
          <p className="connection-dialog-security">You'll finish authorization in your browser. Return to Centinel after granting access.</p>
          {connectionMessage && <p className="connection-dialog-copy" role="status">{connectionMessage}</p>}
          <div className="connection-dialog-actions">
            <button type="button" className="btn-primary connection-primary-button" data-autofocus onClick={() => void beginConnection(connectionDialog)} disabled={connectionBusy}><ExternalLink size={15} aria-hidden="true" /> {connectionBusy ? 'Opening…' : `Connect ${connectionDialog.label}`}</button>
            <button type="button" className="btn-secondary" onClick={() => { pendingConnectionRef.current = null; setPendingConnection(false); setConnectionDialog(null); setConnectionMessage(null); }}>Close</button>
          </div>
        </>}
      </Modal>

      <Modal
        isOpen={Boolean(managedConnection)}
        onClose={() => { pendingConnectionRef.current = null; setPendingConnection(false); setManagedConnection(null); }}
        title={managedConnection ? `Manage ${managedConnection.label}` : 'Manage connection'}
        headerAside={managedConnection ? <ConnectionStatusTag state={connectionState(managedConnection)} /> : undefined}
        width={520}
      >
        {managedConnection && <>
          <ConnectionAccountSummary connection={managedConnection} details={accountDetails(managedConnection)} />
          {connectionState(managedConnection) === 'reauthorization_required' && <p className="connection-dialog-security" role="alert">Reconnect Slack to grant the missing read scopes: {slackMissingScopes(connectedRecord(managedConnection)?.scopes ?? '').join(', ')}. Sync stays disabled until authorization is updated.</p>}
          <ConnectionAccessDetails connection={managedConnection} />
          <p className="connection-dialog-security">You can reconnect to update access or disconnect this account from Centinel.</p>
        </>}
        {connectionMessage && <p className="connection-dialog-copy" role="status">{connectionMessage}</p>}
        <div className="connection-dialog-actions">
          {managedConnection && <button type="button" className="btn-danger" onClick={() => void disconnect(managedConnection)} disabled={connectionBusy}>Disconnect</button>}
          {managedConnection && <button type="button" className="btn-primary connection-primary-button" data-autofocus onClick={() => void beginConnection(managedConnection)} disabled={connectionBusy}><ExternalLink size={15} aria-hidden="true" /> {connectionBusy ? 'Opening…' : 'Reconnect'}</button>}
          <button type="button" className="btn-secondary" onClick={() => { pendingConnectionRef.current = null; setPendingConnection(false); setManagedConnection(null); }}>Close</button>
        </div>
      </Modal>
    </div>
  );
}

function SectionTitleIcon({ Icon }: { Icon: typeof PackageCheck }) {
  return <span className="settings-section-title-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>;
}

type ConnectionDefinition = {
  id: 'google-drive' | 'github' | 'slack';
  label: string;
  description: string;
  asset: string;
  access: readonly string[];
  connected?: boolean;
};

type IntegrationSummary = {
  provider: 'github' | 'google_drive' | 'slack';
  accountLabel: string;
  accountId: string;
  scopes: string;
  status: string;
  updatedAt: string;
};

type ConnectionState = 'connected' | 'disconnected' | 'reauthorization_required';

const SLACK_REQUIRED_READ_SCOPES = ['channels:history', 'channels:read', 'groups:history', 'groups:read', 'users:read', 'files:read'] as const;

function slackMissingScopes(scopes: string): string[] {
  const granted = new Set(scopes.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean));
  return SLACK_REQUIRED_READ_SCOPES.filter(scope => !granted.has(scope));
}

type ConnectionAccountDetails = {
  primary: string | null;
  secondary: string | null;
};

const CONNECTIONS: ConnectionDefinition[] = [
  {
    id: 'google-drive',
    label: 'Google Drive',
    description: 'Import and review shared documents and requirements.',
    asset: '/assets/connectors/google-drive.svg',
    access: [
      'Read files and folders so you can import Drive content as project sources.',
      'Read file metadata such as names, owners, and modified dates to identify sources.',
      'Centinel does not edit or delete your Google Drive content.',
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Connect repositories and pull request context to reviews.',
    asset: '/assets/connectors/github.svg',
    access: [
      'Read repository files and metadata for repositories you choose to import.',
      'Read pull-request context and GitHub account information for review workflows.',
      'Centinel can invite collaborators to a selected project repository only when you explicitly request it.',
    ],
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Share review updates and collaborate with your team.',
    asset: '/assets/connectors/slack.svg',
    access: [
      'Read public channel names and metadata to identify collaboration context.',
      'Read messages in channels the connected Slack app can access.',
      'Read basic user information; the current connection does not send Slack messages.',
    ],
  },
];

function ConnectionsList({ onConnect, onManage, connectionState }: { onConnect: (connection: ConnectionDefinition) => void; onManage: (connection: ConnectionDefinition) => void; connectionState: (connection: ConnectionDefinition) => ConnectionState }) {
  return <div className="connection-list" role="list">
    {CONNECTIONS.map(connection => <ConnectionOption key={connection.id} connection={{ ...connection, connected: connectionState(connection) !== 'disconnected' }} state={connectionState(connection)} onConnect={onConnect} onManage={onManage} />)}
  </div>;
}

function ConnectionOption({ connection, state, onConnect, onManage }: { connection: ConnectionDefinition; state: ConnectionState; onConnect: (connection: ConnectionDefinition) => void; onManage: (connection: ConnectionDefinition) => void }) {
  return (
    <div className="connection-option" role="listitem">
      <span className="connection-brand-icon"><img src={connection.asset} alt="" aria-hidden="true" /></span>
      <div className="connection-copy">
        <div className="connection-copy-heading">
          <strong>{connection.label}</strong>
          <ConnectionStatusTag state={state} />
        </div>
        <p>{connection.description}</p>
      </div>
      {connection.connected ? (
        <button type="button" className="connection-action" aria-label={`Manage ${connection.label} connection`} title={`Manage ${connection.label} connection`} onClick={() => onManage(connection)}><Ellipsis size={20} aria-hidden="true" /></button>
      ) : (
        <button type="button" className="connection-action" aria-label={`Connect ${connection.label}`} title={`Connect ${connection.label}`} onClick={() => onConnect(connection)}><Plus size={20} aria-hidden="true" /></button>
      )}
    </div>
  );
}

function ConnectionStatusTag({ connected, state }: { connected?: boolean; state?: ConnectionState }) {
  const resolved = state ?? (connected ? 'connected' : 'disconnected');
  return <StatusBadge label={resolved === 'connected' ? 'Connected' : resolved === 'reauthorization_required' ? 'Reconnect required' : 'Disconnected'} tone={resolved === 'connected' ? 'success' : 'warning'} />;
}

function ConnectionAccessDetails({ connection }: { connection: ConnectionDefinition }) {
  return (
    <section className="connection-access-details" aria-labelledby={`${connection.id}-access-title`}>
      <h4 id={`${connection.id}-access-title`}>What Centinel can access</h4>
      <ul>
        {connection.access.map(item => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

function ConnectionAccountSummary({ connection, details }: { connection: ConnectionDefinition; details: ConnectionAccountDetails }) {
  return (
    <section className="connection-account-summary" aria-labelledby={`${connection.id}-account-title`}>
      <h4 id={`${connection.id}-account-title`}>Connected account</h4>
      <dl>
        {details.primary && <div><dt>Account</dt><dd>{details.primary}</dd></div>}
        {details.secondary && <div><dt>Email</dt><dd>{details.secondary}</dd></div>}
        {!details.primary && !details.secondary && <div><dt>Account</dt><dd>Account details unavailable</dd></div>}
      </dl>
    </section>
  );
}
