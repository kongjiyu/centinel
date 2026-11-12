import { useCallback, useEffect, useRef, useState } from 'react';
import { setVisibleInterval } from '../hooks/usePageVisible';
import { api } from '../api/client';
import type { AiProviderSetting } from '../types';
import { IconButton, StatusBadge } from './CommandUI';
import { Stethoscope, RefreshCw } from 'lucide-react';
import { Select } from './Select';
import { openExternalUrl } from '../utils/openExternalUrl';
import { userFacingError } from '../utils/userFacingError';
import './CodexProviderPanel.css';

type Status = Awaited<ReturnType<typeof api.codexStatus>>;
type Model = Awaited<ReturnType<typeof api.codexModels>>[number];
type Subscription = Awaited<ReturnType<typeof api.codexSubscriptionUsage>>;
type Role = 'text' | 'vision';
type ModelCatalogState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
const NO_MODEL_SELECTED = '__codex_model_not_selected__';

function savedCodexModel(settings: AiProviderSetting[], role: Role): string {
  const setting = settings.find(item => item.id === role);
  return setting?.provider === 'codex' ? setting.model.trim() : '';
}

function modelOptions(catalog: Model[], selected: Model | undefined) {
  return [
    ...(!selected ? [{ value: NO_MODEL_SELECTED, label: 'Choose an available model', disabled: true }] : []),
    ...catalog.map(item => ({
      value: item.id,
      label: item.imageSupportKnown === false ? `${item.label} (screenshot support unverified)`
        : !item.supportsImages ? `${item.label} (text only)` : item.label,
    })),
  ];
}

function supportsDynamicScreenshots(model: Model | undefined): boolean {
  return model?.supportsImages === true && model.imageSupportKnown !== false;
}

export function CodexProviderPanel({ settings, onRefresh }: { settings: AiProviderSetting[]; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelCatalogState, setModelCatalogState] = useState<ModelCatalogState>('idle');
  const [modelError, setModelError] = useState('');
  const [reviewModel, setReviewModel] = useState(() => savedCodexModel(settings, 'text'));
  const [loginId, setLoginId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const loginStarted = useRef(0);

  const textSetting = settings.find(item => item.id === 'text');

  useEffect(() => {
    if (textSetting?.provider === 'codex') setReviewModel(textSetting.model.trim());
  }, [textSetting?.provider, textSetting?.model]);


  const loadModels = useCallback(async () => {
    if (mounted.current) {
      setModelCatalogState('loading');
      setModelError('');
    }
    try {
      const catalog = await api.codexModels();
      if (!mounted.current) return;
      setModels(catalog);
      setModelCatalogState(catalog.length ? 'ready' : 'empty');
    } catch (cause) {
      if (!mounted.current) return;
      setModels([]);
      setModelCatalogState('error');
      setModelError(userFacingError(cause, 'Available Codex models could not be loaded.'));
    }
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    if (mounted.current && showLoading) {
      setStatusLoading(true);
      setStatusError('');
    }
    try {
      const next = await api.codexStatus();
      if (!mounted.current) return;
      setStatus(next);
      setStatusError('');
      setSubscription(null);
      if (next.connected) {
        setLoginId(null);
        await Promise.all([
          loadModels(),
          api.codexSubscriptionUsage().then(result => { if (mounted.current) setSubscription(result); }).catch(() => {}),
        ]);
      } else {
        setModels([]);
        setModelCatalogState('idle');
        setModelError('');
      }
    } catch (cause) {
      if (mounted.current) setStatusError(userFacingError(cause, 'Codex connection status could not be loaded.'));
    } finally {
      refreshing.current = false;
      if (mounted.current && showLoading) setStatusLoading(false);
    }
  }, [loadModels]);

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => { mounted.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (!loginId) return;
    return setVisibleInterval(() => {
      if (Date.now() - loginStarted.current > 10 * 60_000) {
        setLoginId(null);
        void api.codexCancelLogin(loginId).catch(() => {});
        setError('Sign-in timed out. Connect again to open a new browser sign-in.');
        return;
      }
      void refresh().catch(() => { /* Keep pending sign-in retryable. */ });
    }, 2000);
  }, [loginId, refresh]);

  async function act(name: string, task: () => Promise<void>) {
    setBusy(name); setMessage(''); setError('');
    try { await task(); }
    catch (cause) { if (mounted.current) setError(userFacingError(cause, 'Codex could not complete this action.')); }
    finally { if (mounted.current) setBusy(''); }
  }

  async function connect() {
    const login = await api.codexLogin();
    if (!mounted.current) return;
    loginStarted.current = Date.now(); setLoginId(login.loginId);
    if (!await openExternalUrl(login.authUrl)) {
      await api.codexCancelLogin(login.loginId); setLoginId(null);
      throw new Error('The browser could not open. Check your default browser and try again.');
    }
    setMessage('Finish signing in in your browser.');
  }

  const selection = models.find(item => item.id === reviewModel);
  const supportsScreenshots = supportsDynamicScreenshots(selection);
  const disabled = Boolean(busy);

  return <section className="provider-form codex-provider-panel" aria-labelledby="codex-provider-heading">
    <div className="provider-form-header">
      <h4 id="codex-provider-heading">Codex</h4>
      <StatusBadge label={statusLoading ? 'Checking' : status?.connected ? 'Connected' : status?.available ? 'Not connected' : 'Unavailable'} tone={status?.connected ? 'success' : 'warning'} />
    </div>
    <dl className="oauth-quota">
      {([['5-hour remaining', subscription?.fiveHour], ['Weekly remaining', subscription?.weekly]] as const).map(([label, quota]) => {
        const reset = quota?.resetsAt ? new Date(quota.resetsAt * 1000) : null;
        return <div key={label}><dt>{label}</dt>
          <dd>{quota ? `${Math.round(100 - quota.usedPercent)}%` : 'Unavailable'}</dd>
          {reset && Number.isFinite(reset.getTime()) && <dd className="oauth-quota-reset">Resets <time dateTime={reset.toISOString()}>{reset.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd>}
        </div>;
      })}
    </dl>
    {statusError && <p role="alert" className="form-error">{statusError}</p>}
    {status && !status.available && !statusError && <p role="status" className="form-error">{status.message}</p>}
    {status?.connected && <>
      <div className="form-field">
        <label htmlFor="codex-shared-model">Model</label>
        <Select id="codex-shared-model" value={selection ? selection.id : NO_MODEL_SELECTED} onChange={setReviewModel}
          disabled={disabled || modelCatalogState !== 'ready'} options={modelOptions(models, selection)} />
      </div>
      {modelError && <p role="alert" className="form-error">{modelError}</p>}
      {modelCatalogState === 'loading' && <p role="status">Loading models…</p>}
      {modelCatalogState === 'empty' && <p role="status">No Codex models are available.</p>}
      {selection && !supportsScreenshots && <p role="status">This model can be used for text reviews. Dynamic Testing requires confirmed screenshot support.</p>}
      {reviewModel && modelCatalogState === 'ready' && !selection && <p role="status">Saved model unavailable: {reviewModel}</p>}
      {modelCatalogState === 'ready' && models.some(model => model.catalogSource === 'codex') && <span className="codex-catalog-status">Installed CLI catalog</span>}
    </>}
    <div className="form-actions oauth-provider-footer">
      {status?.connected
        ? <button className="btn-secondary" type="button" disabled={disabled} onClick={() => void act('disconnect', async () => { await api.codexLogout(); await refresh(true); })}>Disconnect</button>
        : <button className="btn-secondary" type="button" disabled={disabled || statusLoading || !status?.available || Boolean(loginId)} onClick={() => void act('connect', connect)}>{loginId ? 'Waiting for sign-in…' : 'Connect Codex'}</button>}
      <IconButton icon={RefreshCw} label="Refresh Codex connection" onClick={() => void act('refresh', () => refresh(true))} disabled={disabled || statusLoading} />
      {loginId && <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void act('cancel', async () => {
        await api.codexCancelLogin(loginId);
        setLoginId(null);
      })}>Cancel sign-in</button>}
      {status?.connected && <>
        <IconButton icon={Stethoscope} label="Test connection" disabled={disabled || !selection} onClick={() => void act('test', async () => {
          const result = await api.testCodex(selection!.id, supportsScreenshots);
          if (result.status === 'fail') setError(result.message); else setMessage(result.message);
        })} />
        <button type="button" className="btn-primary" disabled={disabled || !selection} onClick={() => void act('save', async () => {
          await api.updateSharedAiSetting({ provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: selection!.id });
          await onRefresh();
          setMessage('Settings saved.');
        })}>Save</button>
      </>}
    </div>
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
