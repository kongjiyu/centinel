import { useState } from 'react';
import type { AiProviderSetting, AiProvider, AiApiFormat, AiTestResult } from '../types';
import { api } from '../api/client';

type ProviderPreset = {
  id: string;
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  baseUrl: string;
  model: string;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'mimo-openai',
    label: 'MiMo (OpenAI-compatible)',
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5',
  },
  {
    id: 'mimo-anthropic',
    label: 'MiMo (Anthropic-compatible)',
    provider: 'mimo',
    apiFormat: 'anthropic-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages',
    model: 'mimo-v2.5',
  },
  {
    id: 'mimo-pro-openai',
    label: 'MiMo Pro (OpenAI-compatible)',
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-pro',
  },
  {
    id: 'mimo-pro-anthropic',
    label: 'MiMo Pro (Anthropic-compatible)',
    provider: 'mimo',
    apiFormat: 'anthropic-compatible',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages',
    model: 'mimo-v2.5-pro',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    apiFormat: 'google-native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.5-flash',
  },
  {
    id: 'custom-openai',
    label: 'Custom (OpenAI-compatible)',
    provider: 'custom',
    apiFormat: 'openai-compatible',
    baseUrl: '',
    model: '',
  },
  {
    id: 'custom-anthropic',
    label: 'Custom (Anthropic-compatible)',
    provider: 'custom',
    apiFormat: 'anthropic-compatible',
    baseUrl: '',
    model: '',
  },
];

function findMatchingPreset(setting: AiProviderSetting): ProviderPreset | null {
  return PROVIDER_PRESETS.find(p =>
    p.provider === setting.provider &&
    p.apiFormat === setting.apiFormat &&
    p.baseUrl === setting.baseUrl &&
    p.model === setting.model
  ) || null;
}

type Props = {
  settings: AiProviderSetting[];
  onRefresh: () => Promise<void>;
};

function ProviderForm({ setting, onRefresh }: { setting: AiProviderSetting; onRefresh: () => Promise<void> }) {
  const matchingPreset = findMatchingPreset(setting);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(matchingPreset?.id || 'custom-openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl);
  const [model, setModel] = useState(setting.model);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selectedPreset = PROVIDER_PRESETS.find(p => p.id === selectedPresetId);
  const isCustom = selectedPresetId.startsWith('custom-');

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PROVIDER_PRESETS.find(p => p.id === presetId);
    if (preset && !presetId.startsWith('custom-')) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    if (!apiKey && !setting.hasApiKey) {
      setError('API key is required');
      return;
    }
    if (!baseUrl.trim()) {
      setError('Base URL is required');
      return;
    }
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      setError('Base URL must start with http:// or https://');
      return;
    }
    if (!model.trim()) {
      setError('Model is required');
      return;
    }
    setSaving(true);
    try {
      await api.updateAiSetting(setting.id, {
        provider: selectedPreset?.provider || 'custom',
        apiFormat: selectedPreset?.apiFormat || 'openai-compatible',
        apiKey: apiKey || '', // empty means keep existing
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      });
      setApiKey('');
      setSaved(true);
      await onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testAiProvider(setting.id);
      setTestResult(result);
    } catch (e) {
      setTestResult({ status: 'fail', message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="provider-form">
      <h3>{setting.label}</h3>

      <div className="form-field">
        <label>Provider</label>
        <select value={selectedPresetId} onChange={e => handlePresetChange(e.target.value)}>
          <optgroup label="MiMo">
            {PROVIDER_PRESETS.filter(p => p.provider === 'mimo').map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="Google">
            {PROVIDER_PRESETS.filter(p => p.provider === 'gemini').map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="Custom">
            {PROVIDER_PRESETS.filter(p => p.provider === 'custom').map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="form-field">
        <label>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={setting.hasApiKey ? `Current: ${setting.apiKeyPreview}` : 'Enter API key'}
        />
      </div>

      <div className="form-field">
        <label>Base URL</label>
        <input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1/messages"
          disabled={!isCustom}
        />
      </div>

      <div className="form-field">
        <label>Model</label>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="model-name"
          disabled={!isCustom}
        />
      </div>

      <div className="form-field">
        <label>API Format</label>
        <input
          value={selectedPreset?.apiFormat || 'openai-compatible'}
          disabled
          className="readonly-field"
        />
      </div>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-success">Saved.</p>}

      <div className="form-actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={handleTest} disabled={testing}>
          {testing ? 'Testing...' : 'Test'}
        </button>
      </div>

      {testResult && (
        <div className={`test-result ${testResult.status}`}>
          <strong>{testResult.status === 'pass' ? 'Success' : 'Failed'}</strong>
          {testResult.message && <span>: {testResult.message}</span>}
        </div>
      )}
    </div>
  );
}

export function SettingsScreen({ settings, onRefresh }: Props) {
  const textSetting = settings.find(s => s.id === 'text');
  const visionSetting = settings.find(s => s.id === 'vision');

  return (
    <div className="screen">
      <h1>Settings</h1>

      <p className="settings-hint">
        Configure AI providers for text generation and multimodal vision.
        Select a provider preset or configure a custom endpoint.
        Keys are stored locally in SQLite.
      </p>

      {textSetting && (
        <div className="settings-section">
          <h2>Text Generation</h2>
          <p className="settings-section-hint">
            Used for static analysis, code review, and requirement traceability.
          </p>
          <ProviderForm setting={textSetting} onRefresh={onRefresh} />
        </div>
      )}

      {visionSetting && (
        <div className="settings-section">
          <h2>Multimodal Vision</h2>
          <p className="settings-section-hint">
            Used for dynamic testing with screenshot analysis.
            Requires a vision-capable model (e.g., MiMo, Gemini).
          </p>
          <ProviderForm setting={visionSetting} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}
