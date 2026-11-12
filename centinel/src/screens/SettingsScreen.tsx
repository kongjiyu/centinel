import { useState, useEffect, useRef } from 'react';
import { setVisibleInterval } from '../hooks/usePageVisible';
import { Eye, EyeOff, Stethoscope, RefreshCw, ExternalLink, PackageCheck, Cable, Bot, ChartNoAxesCombined, Ellipsis, Plus, AlertTriangle } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { checkForAppUpdate, installUpdateAndRestart } from '../utils/appUpdate';
import type { AiProviderSetting, AiProvider, AiApiFormat } from '../types';
import { ApiError, api } from '../api/client';
import { CommandPageHeader, IconButton, StatusBadge } from '../components/CommandUI';
import { CodexProviderPanel } from '../components/CodexProviderPanel';
import { GeminiOAuthPanel } from '../components/GeminiOAuthPanel';
import { EmbeddingProviderForm } from '../components/EmbeddingProviderForm';
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
  { id: 'claude', label: 'Claude', provider: 'custom', apiFormat: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com/v1/messages', model: '' },
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

function AppVersionSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(true);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'current' | 'error'>('idle');
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [installable, setInstallable] = useState(false);
  const [installing, setInstalling] = useState(false);

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
      const [release, signedUpdate] = await Promise.all([fetchLatestRelease(), checkForAppUpdate()]);
      setLatestRelease(release);
      setInstallable(Boolean(signedUpdate));
      if (isNewerVersion(release.version, version)) {
        setUpdateState('available');
        setUpdateMessage(signedUpdate
          ? `Version ${release.version} is available. Restart to download and install it.`
          : `Version ${release.version} is available on GitHub.`);
      } else {
        setUpdateState('current');
        setUpdateMessage('Centinel is up to date.');
      }
    } catch (cause) {
      setUpdateState('error');
      setUpdateMessage(userFacingError(cause, 'Updates could not be checked. Try again later.'));
    }
  };

  const formatVersion = (value: string | null, missing: string) => value ? `Centinel v${value.replace(/^v/i, '')}` : missing;
  const currentVersion = formatVersion(version, versionLoading ? 'Checking…' : 'Unknown');
  const latestVersion = formatVersion(latestRelease?.version ?? null, updateState === 'checking' ? 'Checking…' : 'Not checked yet');

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
          {updateState === 'available' && installable && (
            <button type="button" className="btn-primary" disabled={installing} onClick={() => {
              setInstalling(true);
              void installUpdateAndRestart().catch(cause => {
                setInstalling(false);
                setUpdateState('error');
                setUpdateMessage(userFacingError(cause, 'The update could not be installed. Download it from GitHub instead.'));
              });
            }}>
              <RefreshCw size={14} aria-hidden="true" /> {installing ? 'Updating…' : 'Restart to update'}
            </button>
          )}
          {updateState === 'available' && !installable && latestRelease && (
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
  const match = findMatchingPreset(setting);
  const [presetId, setPresetId] = useState(match?.id ?? 'custom-openai');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(setting.connectionMethod === 'oauth' ? '' : setting.baseUrl);
  const [model, setModel] = useState(setting.provider === 'codex' || setting.connectionMethod === 'oauth' ? '' : setting.model);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const preset = PROVIDER_PRESETS.find(item => item.id === presetId)!;
  const sameDestination = setting.provider === preset.provider && setting.apiFormat === preset.apiFormat
    && setting.baseUrl.trim().replace(/\/+$/, '') === baseUrl.trim().replace(/\/+$/, '');
  const ready = Boolean((apiKey.trim() || sameDestination && setting.hasApiKey) && baseUrl.trim() && model.trim());

  const changePreset = (id: string) => {
    const next = PROVIDER_PRESETS.find(item => item.id === id);
    if (!next) return;
    setPresetId(id); setBaseUrl(next.baseUrl); setModel(next.model); setApiKey(''); setResult(null);
  };

  const submit = async (save: boolean) => {
    setBusy(true); setResult(null);
    const input = { provider: preset.provider, apiFormat: preset.apiFormat, apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() };
    try {
      if (save) {
        await api.updateSharedAiSetting(input);
        setApiKey('');
        await onRefresh();
        setResult({ ok: true, message: 'Settings saved.' });
      } else {
        // Use the same credential and destination for the screenshot check.
        const test = await api.testAiProvider('text', { ...input, testVision: true });
        const ok = test.status === 'pass';
        setResult({ ok, message: [test.message ?? (ok ? 'Connection successful.' : 'Connection failed.'), !ok && test.hint].filter(Boolean).join(' ') });
      }
    } catch (cause) {
      setResult({ ok: false, message: userFacingError(cause, save ? 'Settings could not be saved.' : 'Connection failed.') });
    } finally { setBusy(false); }
  };

  return <form className="provider-form shared-provider-form" onSubmit={event => { event.preventDefault(); if (ready && !busy) void submit(true); }}>
    <fieldset disabled={busy}>
      <div className="form-field"><label htmlFor="shared-api-provider">Provider</label><Select id="shared-api-provider" value={presetId} onChange={changePreset} options={PROVIDER_PRESETS.map(item => ({ value: item.id, label: item.label }))} /></div>
      <div className="form-field"><label htmlFor="shared-api-key">API key</label><div className="api-key-field">
        <input id="shared-api-key" type={showKey ? 'text' : 'password'} autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={sameDestination && setting.hasApiKey ? 'Saved key' : undefined} />
        <IconButton icon={showKey ? EyeOff : Eye} label={showKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowKey(value => !value)} />
      </div></div>
      <div className="provider-endpoint-fields">
        <div className="form-field"><label htmlFor="shared-api-endpoint">Base URL</label><input id="shared-api-endpoint" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="shared-api-model">Model</label><input id="shared-api-model" value={model} onChange={event => setModel(event.target.value)} /></div>
      </div>
    </fieldset>
    {result && <p className={result.ok ? 'form-success' : 'form-error'} role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
    <div className="form-actions"><IconButton icon={Stethoscope} label="Test connection" onClick={() => void submit(false)} disabled={!ready || busy} /><button type="submit" className="btn-primary" disabled={!ready || busy}>Save</button></div>
  </form>;
}

function SharedModelProvider({ settings, onRefresh }: Props) {
  const setting = settings.find(item => item.id === 'text');
  const [selectedMode, setMode] = useState<'api' | 'oauth' | null>(null);
  const mode = selectedMode ?? (setting?.provider !== 'codex' && setting?.connectionMethod !== 'oauth' && (setting?.hasApiKey || setting?.model) ? 'api' : 'oauth');
  const embedding = settings.find(item => item.id === 'embedding');
  return <section className="settings-section settings-provider-section" aria-labelledby="model-provider-title">
    <div className="settings-section-heading model-provider-heading">
      <h2 id="model-provider-title"><SectionTitleIcon Icon={Bot} />Model Provider</h2>
      <div className="settings-segmented" role="group" aria-label="Model Provider connection method">
        <button type="button" aria-pressed={mode === 'oauth'} onClick={() => setMode('oauth')}>OAuth</button>
        <button type="button" aria-pressed={mode === 'api'} onClick={() => setMode('api')}>API provider</button>
      </div>
    </div>
    <div className="settings-provider-forms">
      {mode === 'oauth' ? <div className="oauth-connection-grid" aria-label="OAuth connections">
        <CodexProviderPanel settings={settings} onRefresh={onRefresh} />
        <GeminiOAuthPanel setting={setting} onRefresh={onRefresh} />
      </div> : setting && <ProviderForm setting={setting} onRefresh={onRefresh} />}
      {embedding && <EmbeddingProviderForm setting={embedding} onRefresh={onRefresh} />}
    </div>
  </section>;
}

// ── Token Usage Dashboard ─────────────────────────────────────────────────
//
// Usage groups include embedding calls and show the latest recorded execution in each group.

type UsageResponse = Awaited<ReturnType<typeof api.getAiUsage>>;
type UsageSummary = Omit<UsageResponse, 'totals' | 'byGroup'> & {
  totals: UsageResponse['totals'] & Partial<{
    totalTokens: number;
    providerReportedTotalTokens: number;
    providerReportedCalls: number;
    unknownTotalCalls: number;
  }>;
  byGroup: Array<UsageResponse['byGroup'][number] & Partial<{
    totalTokens: number;
    providerReportedTotalTokens: number;
    providerReportedCalls: number;
    unknownTotalCalls: number;
  }>>;
};
function formatTokenCount(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? formatUsageNumber(n) : '—';
}

function GroupUsageCount({ value, unknown, calls }: { value: number; unknown?: number; calls: number }) {
  return <>{formatTokenCount(calls > 0 && (unknown === calls || unknown == null && value === 0) ? null : value)}</>;
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

function formatCanonicalTotal(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? formatWholeNumber(n) : '—';
}

function totalTokensForGroup(group: UsageSummary['byGroup'][number]): number | null {
  if (group.totalCalls > 0 && group.unknownTotalCalls === group.totalCalls) return null;
  return typeof group.totalTokens === 'number' && Number.isFinite(group.totalTokens)
    ? Math.max(0, Math.round(group.totalTokens))
    : null;
}

const usageDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function TokenUsagePanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 5;

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getAiUsage();
      setSummary(data);
      setPage(0);
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

  const groups = summary?.byGroup ?? [];
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  const visibleGroups = groups.slice(page * pageSize, (page + 1) * pageSize);

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
                {formatCanonicalTotal(summary.totals.calls > 0 && summary.totals.unknownTotalCalls === summary.totals.calls ? undefined : summary.totals.totalTokens)}
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
              <dd>{formatTokenCount(summary.totals.calls > 0 && summary.totals.unknownInputCalls === summary.totals.calls ? null : summary.totals.input)}</dd>
            </div>
            <div className="usage-metric">
              <dt>Output</dt>
              <dd>{formatTokenCount(summary.totals.calls > 0 && summary.totals.unknownOutputCalls === summary.totals.calls ? null : summary.totals.output)}</dd>
            </div>
            <div className="usage-metric">
              <dt>Cache creation</dt>
              <dd>{formatTokenCount(summary.totals.calls > 0 && summary.totals.unknownCacheCreationCalls === summary.totals.calls ? null : summary.totals.cacheCreation)}</dd>
            </div>
            <div className="usage-metric">
              <dt>Cache reads</dt>
              <dd>{formatTokenCount(summary.totals.calls > 0 && summary.totals.unknownCacheReadCalls === summary.totals.calls ? null : summary.totals.cacheRead)}</dd>
            </div>
          </dl>

          {groups.length > 0 && <section className="usage-overview" aria-labelledby="usage-overview-title">
            <h4 id="usage-overview-title">Usage overview</h4>
            <div className="usage-table-wrap">
              <table className="usage-table" aria-label="Usage overview by provider">
                <thead><tr>{['Provider', 'Model', 'Requests', 'Input', 'Output', 'Cache', 'Total tokens', 'Executed At'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{visibleGroups.map(group => <tr key={`${group.provider}:${group.apiFormat}:${group.model}`}>
                  <td>{group.provider}</td><td><code>{group.model}</code></td><td className="usage-num">{formatWholeNumber(group.totalCalls)}</td>
                  <td className="usage-num"><GroupUsageCount value={group.totalInput} unknown={group.unknownInputCalls} calls={group.totalCalls} /></td>
                  <td className="usage-num"><GroupUsageCount value={group.totalOutput} unknown={group.unknownOutputCalls} calls={group.totalCalls} /></td>
                  <td className="usage-num">{formatTokenCount(group.totalCacheRead + group.totalCacheCreation === 0 && (group.unknownCacheReadCalls !== 0 || group.unknownCacheCreationCalls !== 0) ? null : group.totalCacheRead + group.totalCacheCreation)}</td>
                  <td className="usage-num">{formatTokenCount(totalTokensForGroup(group))}</td>
                  <td>{group.lastExecutedAt && Number.isFinite(Date.parse(group.lastExecutedAt)) ? <time dateTime={group.lastExecutedAt}>{usageDate.format(Date.parse(group.lastExecutedAt)).replace(',', '')}</time> : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {pageCount > 1 && <nav className="usage-pagination" aria-label="Usage overview pagination">
              <button type="button" className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page + 1} of {pageCount}</span>
              <button type="button" className="btn-secondary" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Next</button>
            </nav>}
          </section>}

        </>
      ) : null}
    </div>
  );
}

export function SettingsScreen({ settings, onRefresh, initialSection }: Props & { initialSection?: 'connections' }) {
  useEffect(() => {
    if (initialSection !== 'connections') return;
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById('settings-connections-title');
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection]);
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDefinition | null>(null);
  const [managedConnection, setManagedConnection] = useState<ConnectionDefinition | null>(null);
  const [githubStatus, setGithubStatus] = useState<{ connected: boolean; login: string | null; message: string } | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [hasConnectionSnapshot, setHasConnectionSnapshot] = useState(false);
  const [connectionStatusUnavailable, setConnectionStatusUnavailable] = useState(false);
  const [connectionStatusChecking, setConnectionStatusChecking] = useState(true);
  const [connectionStatusMessage, setConnectionStatusMessage] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const pendingConnectionRef = useRef<{ provider: 'github' | 'google_drive' | 'slack'; priorUpdatedAt: string | null } | null>(null);
  const [pendingConnection, setPendingConnection] = useState(false);

  const refreshConnections = async () => {
    setConnectionStatusChecking(true);
    try {
      const [github, connected] = await Promise.all([
        typeof api.githubStatus === 'function' ? api.githubStatus() : Promise.reject(new Error('GitHub connection status is unavailable.')),
        typeof api.listIntegrations === 'function' ? api.listIntegrations() : Promise.reject(new Error('Integration status is unavailable.')),
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
      setHasConnectionSnapshot(true);
      setConnectionStatusUnavailable(false);
      setConnectionStatusMessage(null);
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
      const message = cause instanceof ApiError && cause.code === 'supabase_jwt_future'
        ? 'Supabase rejected the signed session as not yet valid. Verify that the device date and time are correct, then retry. If the device time is correct, this may be a temporary Supabase Auth/PostgREST time-validation issue.'
        : userFacingError(cause, 'Connection status is unavailable. Retry to check the saved connections.');
      setConnectionStatusUnavailable(true);
      setConnectionStatusMessage(message);
    } finally {
      setConnectionStatusChecking(false);
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
    return setVisibleInterval(() => { void refreshConnections(); }, 2500);
  }, [pendingConnection]);

  const backendProvider = (connection: ConnectionDefinition): 'github' | 'google_drive' | 'slack' => connection.id === 'google-drive' ? 'google_drive' : connection.id;
  const isConnected = (connection: ConnectionDefinition): boolean => {
    const provider = backendProvider(connection);
    return provider === 'github' ? Boolean(githubStatus?.connected) : integrations.some(item => item.provider === provider && item.status === 'connected');
  };

  const connectionState = (connection: ConnectionDefinition): ConnectionState => {
    if (connectionStatusUnavailable) return 'unavailable';
    if (!hasConnectionSnapshot) return connectionStatusChecking ? 'checking' : 'unavailable';
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
            <h2 id="settings-connections-title" tabIndex={-1}><SectionTitleIcon Icon={Cable} />Connections</h2>
          </div>
          {(connectionStatusUnavailable || !hasConnectionSnapshot) && (
            <div className={`connection-dialog-security connection-status-message${connectionStatusUnavailable ? ' is-unavailable' : ''}`} role="status" aria-live="polite">
              {connectionStatusUnavailable && <AlertTriangle size={16} aria-hidden="true" className="connection-status-icon" />}
              <span>{connectionStatusMessage ?? 'Checking saved connection status…'}</span>
              <button type="button" className="btn-secondary" onClick={() => void refreshConnections()} disabled={connectionStatusChecking}>
                {connectionStatusChecking ? 'Checking…' : 'Check status'}
              </button>
            </div>
          )}
          <ConnectionsList onConnect={(connection) => { setConnectionMessage(null); setConnectionDialog(connection); }} onManage={(connection) => { setConnectionMessage(null); setManagedConnection(connection); }} connectionState={connectionState} isConnected={isConnected} />
        </section>

        <SharedModelProvider settings={settings} onRefresh={onRefresh} />

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

type ConnectionState = 'connected' | 'disconnected' | 'reauthorization_required' | 'checking' | 'unavailable';

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

function ConnectionsList({ onConnect, onManage, connectionState, isConnected }: { onConnect: (connection: ConnectionDefinition) => void; onManage: (connection: ConnectionDefinition) => void; connectionState: (connection: ConnectionDefinition) => ConnectionState; isConnected: (connection: ConnectionDefinition) => boolean }) {
  return <div className="connection-list" role="list">
    {CONNECTIONS.map(connection => <ConnectionOption key={connection.id} connection={{ ...connection, connected: isConnected(connection) }} state={connectionState(connection)} onConnect={onConnect} onManage={onManage} />)}
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
  const label = resolved === 'connected' ? 'Connected'
    : resolved === 'reauthorization_required' ? 'Reconnect required'
      : resolved === 'checking' ? 'Checking…'
        : resolved === 'unavailable' ? 'Status unavailable'
          : 'Disconnected';
  const tone = resolved === 'connected' ? 'success'
    : resolved === 'checking' ? 'running'
      : resolved === 'unavailable' ? 'neutral'
        : 'warning';
  return <StatusBadge label={label} tone={tone} />;
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
