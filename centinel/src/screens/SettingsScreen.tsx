import { useState, useEffect } from 'react';
import { Save, Play, Check, Eye, EyeOff, Zap, ScanEye, Activity, RefreshCw } from 'lucide-react';
import type { AiProviderSetting, AiProvider, AiApiFormat, AiTestResult } from '../types';
import { api } from '../api/client';
import { CommandPageHeader, IconButton, StatusBadge } from '../components/CommandUI';

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

  // Re-sync local form state whenever the persisted setting changes (e.g. after save + onRefresh).
  // Without this, selectedPresetId is pinned to its initial value on first mount and the API Format
  // input can revert to "openai-compatible" even when the persisted apiFormat is anthropic-compatible.
  // User edits made during the current session still win until the next render with a new setting prop.
  useEffect(() => {
    setBaseUrl(setting.baseUrl);
    setModel(setting.model);
    const match = findMatchingPreset(setting);
    setSelectedPresetId(match?.id ?? (setting.apiFormat === 'anthropic-compatible' ? 'custom-anthropic' : 'custom-openai'));
  }, [setting.id, setting.baseUrl, setting.model, setting.apiFormat, setting.provider]);

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
    catch (e) { setTestResult({ status: 'fail', message: String(e) }); }
    finally { setTesting(false); }
  };

  const Icon = setting.id === 'text' ? Zap : Eye;

  return (
    <div className="provider-form">
      <div className="provider-form-header">
        <h3>
          <Icon size={16} />
          {setting.label}
        </h3>
        <StatusBadge label={isConfigured ? 'Configured' : 'Setup required'} tone={isConfigured ? 'success' : 'warning'} />
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
        <div className="api-key-field">
          <input
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
          <label>Base URL</label>
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1/messages" disabled={!isCustom} />
        </div>

        <div className="form-field">
          <label>Model</label>
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="model-name" disabled={!isCustom} />
        </div>
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
          {testResult.status === 'pass' ? <Check size={14} /> : <ScanEye size={14} />}
          <strong>{testResult.status === 'pass' ? 'Success' : 'Failed'}</strong>
          {testResult.message && <span>: {testResult.message}</span>}
          {testResult.hint && (
            <p className="test-result-hint">{testResult.hint}</p>
          )}
        </div>
      )}
    </div>
  );
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
type UsageScope = 'text' | 'vision';
type UsageCallKind = 'review' | 'test' | 'dynamic';

const SCOPE_LABEL: Record<UsageScope, string> = { text: 'Text', vision: 'Vision' };
const CALL_KIND_LABEL: Record<UsageCallKind, string> = {
  review: 'Static review',
  test: 'Provider test',
  dynamic: 'Dynamic session',
};

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
  const [scopeFilter, setScopeFilter] = useState<UsageScope | 'all'>('all');
  const [showRecent, setShowRecent] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const filter = scopeFilter === 'all' ? undefined : { scope: scopeFilter };
      const data = await api.getAiUsage(filter);
      setSummary(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reload on mount, on filter change, and on manual refresh. The user
  // navigates away and back to this page often, so always fetch fresh
  // numbers rather than relying on a session cache.
  useEffect(() => { void load(); }, [scopeFilter]);

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <div>
          <span className="command-eyebrow">Usage Telemetry</span>
          <h2>Token Usage</h2>
        </div>
        <Activity size={17} />
      </div>
      <p className="settings-section-copy">
        Aggregated token usage across all configured providers. Tracks every AI call (static
        review, dynamic session, and provider test).
      </p>

      <div className="usage-toolbar">
        <div className="form-field">
          <label>Scope</label>
          <select
            value={scopeFilter}
            onChange={e => setScopeFilter(e.target.value as UsageScope | 'all')}
          >
            <option value="all">All</option>
            <option value="text">Text only</option>
            <option value="vision">Vision only</option>
          </select>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {loading && !summary ? (
        <p className="card-empty">Loading usage data...</p>
      ) : summary ? (
        <>
          <div className="usage-totals">
            <div className="usage-stat">
              <span className="usage-stat-label">Input tokens</span>
              <span className="usage-stat-value">{formatTokenCount(summary.totals.input)}</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Output tokens</span>
              <span className="usage-stat-value">{formatTokenCount(summary.totals.output)}</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Cache reads</span>
              <span className="usage-stat-value">{formatTokenCount(summary.totals.cacheRead)}</span>
            </div>
            <div className="usage-stat">
              <span className="usage-stat-label">Total calls</span>
              <span className="usage-stat-value">{summary.totals.calls.toLocaleString()}</span>
            </div>
          </div>

          {summary.byGroup.length === 0 ? (
            <p className="card-empty">No usage recorded yet. Run a static review, dynamic session, or provider test to populate this dashboard.</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Format</th>
                  <th>Model</th>
                  <th className="usage-num">Input</th>
                  <th className="usage-num">Output</th>
                  <th className="usage-num">Cache</th>
                  <th className="usage-num">Calls</th>
                </tr>
              </thead>
              <tbody>
                {summary.byGroup.map((g, idx) => (
                  <tr key={`${g.provider}-${g.apiFormat}-${g.model}-${idx}`}>
                    <td>{g.provider}</td>
                    <td><code>{g.apiFormat}</code></td>
                    <td><code>{g.model}</code></td>
                    <td className="usage-num">{formatTokenCount(g.totalInput)}</td>
                    <td className="usage-num">{formatTokenCount(g.totalOutput)}</td>
                    <td className="usage-num">{formatTokenCount(g.totalCacheRead + g.totalCacheCreation)}</td>
                    <td className="usage-num">{g.totalCalls.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {summary.recent.length > 0 && (
            <div className="usage-recent">
              <button
                className="btn-link"
                onClick={() => setShowRecent(v => !v)}
                aria-expanded={showRecent}
              >
                {showRecent ? 'Hide' : 'Show'} recent calls ({summary.recent.length})
              </button>
              {showRecent && (
                <table className="usage-table usage-recent-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Scope</th>
                      <th>Kind</th>
                      <th>Stage</th>
                      <th>Model</th>
                      <th className="usage-num">Input</th>
                      <th className="usage-num">Output</th>
                      <th className="usage-num">Cache</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map(r => (
                      <tr key={r.id}>
                        <td>{formatTimestamp(r.createdAt)}</td>
                        <td>{SCOPE_LABEL[r.scope]}</td>
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
              )}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

export function SettingsScreen({ settings, onRefresh }: Props) {
  const textSetting = settings.find(s => s.id === 'text');
  const visionSetting = settings.find(s => s.id === 'vision');

  return (
    <div className="screen settings-screen animate-fade-in">
      <CommandPageHeader
        eyebrow="Provider Control"
        title="AI Settings"
        description="Configure text generation and multimodal vision endpoints. Credentials remain in the local SQLite store."
        meta={<><span>{settings.filter(s => s.hasApiKey).length}/{settings.length} providers configured</span><span>Local credential storage</span></>}
      />

      <div className="settings-layout">
        {textSetting && (
          <section className="settings-section">
            <div className="settings-section-heading">
              <div><span className="command-eyebrow">Analysis Channel</span><h2>Text Generation</h2></div>
              <Zap size={17} />
            </div>
            <p className="settings-section-copy">Static analysis, code review, and requirement traceability.</p>
            <ProviderForm setting={textSetting} onRefresh={onRefresh} />
          </section>
        )}

        {visionSetting && (
          <section className="settings-section">
            <div className="settings-section-heading">
              <div><span className="command-eyebrow">Observation Channel</span><h2>Multimodal Vision</h2></div>
              <Eye size={17} />
            </div>
            <p className="settings-section-copy">Dynamic testing and screenshot-based interaction analysis.</p>
            <ProviderForm setting={visionSetting} onRefresh={onRefresh} />
          </section>
        )}

        <TokenUsagePanel />
      </div>
    </div>
  );
}
