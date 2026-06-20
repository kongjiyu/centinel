import { useState } from 'react';
import { Save, Play, Check, X, Eye, EyeOff, Zap } from 'lucide-react';
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
  { id: 'mimo-openai', label: 'MiMo (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5' },
  { id: 'mimo-anthropic', label: 'MiMo (Anthropic-compatible)', provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages', model: 'mimo-v2.5' },
  { id: 'mimo-pro-openai', label: 'MiMo Pro (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-pro' },
  { id: 'mimo-pro-anthropic', label: 'MiMo Pro (Anthropic-compatible)', provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages', model: 'mimo-v2.5-pro' },
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

type Props = { settings: AiProviderSetting[]; onRefresh: () => Promise<void> };

function ProviderForm({ setting, onRefresh }: { setting: AiProviderSetting; onRefresh: () => Promise<void> }) {
  const matchingPreset = findMatchingPreset(setting);
  const [selectedPresetId, setSelectedPresetId] = useState(matchingPreset?.id || 'custom-openai');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(setting.baseUrl);
  const [model, setModel] = useState(setting.model);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selectedPreset = PROVIDER_PRESETS.find(p => p.id === selectedPresetId);
  const isCustom = selectedPresetId.startsWith('custom-');
  const isConfigured = setting.hasApiKey;

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PROVIDER_PRESETS.find(p => p.id === presetId);
    if (preset && !presetId.startsWith('custom-')) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const handleSave = async () => {
    setError(null); setSaved(false);
    if (!apiKey && !isConfigured) { setError('API key is required'); return; }
    if (!baseUrl.trim()) { setError('Base URL is required'); return; }
    if (!model.trim()) { setError('Model is required'); return; }
    setSaving(true);
    try {
      await api.updateAiSetting(setting.id, {
        provider: selectedPreset?.provider || 'custom',
        apiFormat: selectedPreset?.apiFormat || 'openai-compatible',
        apiKey: apiKey || '',
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      });
      setApiKey(''); setSaved(true); await onRefresh();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try { const result = await api.testAiProvider(setting.id); setTestResult(result); }
    catch (e) { setTestResult({ status: 'fail', message: String(e) }); }
    finally { setTesting(false); }
  };

  const Icon = setting.id === 'text' ? Zap : Eye;

  return (
    <div className="panel" style={{ marginBottom: '16px' }}>
      <div className="panel-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon size={16} style={{ color: 'var(--accent)' }} />
          {setting.label}
        </h3>
        {isConfigured && (
          <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Check size={12} /> Configured
          </span>
        )}
      </div>

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
        <div style={{ position: 'relative' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={isConfigured ? `Current: ${setting.apiKeyPreview}` : 'Enter API key'}
            style={{ paddingRight: '36px' }}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px',
            }}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="form-field">
        <label>Base URL</label>
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1/messages" disabled={!isCustom} />
      </div>

      <div className="form-field">
        <label>Model</label>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="model-name" disabled={!isCustom} />
      </div>

      <div className="form-field">
        <label>API Format</label>
        <input value={selectedPreset?.apiFormat || 'openai-compatible'} disabled className="readonly-field" />
      </div>

      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-success"><Check size={14} /> Settings saved</p>}

      <div className="form-actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={handleTest} disabled={testing || !isConfigured}>
          <Play size={14} /> {testing ? 'Testing...' : 'Test'}
        </button>
      </div>

      {testResult && (
        <div className={`test-result ${testResult.status}`}>
          <strong>{testResult.status === 'pass' ? '✓ Success' : '✗ Failed'}</strong>
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
    <div className="screen animate-fade-in">
      <h1>Settings</h1>

      <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px', lineHeight: '1.5' }}>
        Configure AI providers for text generation and multimodal vision.
        Select a provider preset or configure a custom endpoint.
        Keys are stored locally in SQLite.
      </p>

      {textSetting && (
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Text Generation
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-faint)', marginBottom: '12px', fontStyle: 'italic' }}>
            Used for static analysis, code review, and requirement traceability.
          </p>
          <ProviderForm setting={textSetting} onRefresh={onRefresh} />
        </div>
      )}

      {visionSetting && (
        <div>
          <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Multimodal Vision
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-faint)', marginBottom: '12px', fontStyle: 'italic' }}>
            Used for dynamic testing with screenshot analysis.
          </p>
          <ProviderForm setting={visionSetting} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}
