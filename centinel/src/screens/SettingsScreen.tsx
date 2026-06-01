import { useState } from 'react';
import type { AiProviderSetting, AiCompatibilityMode, AiTestResult } from '../types';
import { api } from '../api/client';

type Props = {
  settings: AiProviderSetting[];
  onRefresh: () => Promise<void>;
};

function ProviderForm({ setting, onRefresh }: { setting: AiProviderSetting; onRefresh: () => Promise<void> }) {
  const [compatMode, setCompatMode] = useState<AiCompatibilityMode>(setting.compatibilityMode);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl);
  const [model, setModel] = useState(setting.model);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
        compatibilityMode: compatMode,
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
        <label>Compatibility Mode</label>
        <select value={compatMode} onChange={e => setCompatMode(e.target.value as AiCompatibilityMode)}>
          <option value="anthropic">Anthropic-compatible</option>
          <option value="openai">OpenAI-compatible</option>
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
        />
      </div>

      <div className="form-field">
        <label>Model</label>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="model-name"
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
        Keys are stored locally in SQLite.
      </p>

      {textSetting && (
        <div className="settings-section">
          <h2>Text Generation</h2>
          <ProviderForm setting={textSetting} onRefresh={onRefresh} />
        </div>
      )}

      {visionSetting && (
        <div className="settings-section">
          <h2>Multimodal Vision</h2>
          <ProviderForm setting={visionSetting} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}
