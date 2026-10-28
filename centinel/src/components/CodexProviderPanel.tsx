import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AiProviderSetting } from '../types';
import { StatusBadge } from './CommandUI';
import { Select } from './Select';
import { openExternalUrl } from '../utils/openExternalUrl';
import { userFacingError } from '../utils/userFacingError';
import './CodexProviderPanel.css';

type Status = Awaited<ReturnType<typeof api.codexStatus>>;
type Model = Awaited<ReturnType<typeof api.codexModels>>[number];
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
    ...catalog.map(item => ({ value: item.id, label: item.label })),
  ];
}

function describeSavedModel(settings: AiProviderSetting[], role: Role): string {
  const setting = settings.find(item => item.id === role);
  if (!setting || (!setting.hasApiKey && setting.provider !== 'codex')) return 'Not configured';
  if (setting.provider === 'codex') return setting.model.trim() ? `Codex · ${setting.model.trim()}` : 'Codex · no model saved';
  const provider = setting.provider === 'mimo' ? 'MiMo' : setting.provider === 'gemini' ? 'Google Gemini' : 'API provider';
  return setting.model.trim() ? `${provider} · ${setting.model.trim()}` : `${provider} · no model saved`;
}

function modelSupportDescription(model: Model | undefined, role: Role): string {
  if (!model) return 'Choose a model from the available account list.';
  const imageSupportKnown = (model as Model & { imageSupportKnown?: boolean }).imageSupportKnown;
  if (imageSupportKnown === false) return 'Screenshot support could not be confirmed. Dynamic testing requires a model with confirmed screenshot support.';
  if (model.supportsImages) return 'This model supports text and screenshots.';
  if (imageSupportKnown === true) return role === 'vision'
    ? 'This model supports text only. Dynamic testing requires screenshot support.'
    : 'This model supports text only.';
  return 'Screenshot support could not be confirmed. Dynamic testing requires confirmed screenshot support.';
}

function supportsDynamicScreenshots(model: Model | undefined): boolean {
  return model?.supportsImages === true && (model as (Model & { imageSupportKnown?: boolean }) | undefined)?.imageSupportKnown !== false;
}

export function CodexProviderPanel({ settings, onRefresh }: { settings: AiProviderSetting[]; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [modelCatalogState, setModelCatalogState] = useState<ModelCatalogState>('idle');
  const [modelError, setModelError] = useState('');
  const [reviewModel, setReviewModel] = useState(() => savedCodexModel(settings, 'text'));
  const [dynamicModel, setDynamicModel] = useState(() => savedCodexModel(settings, 'vision'));
  const [loginId, setLoginId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const loginStarted = useRef(0);

  const textSetting = settings.find(item => item.id === 'text');
  const visionSetting = settings.find(item => item.id === 'vision');

  useEffect(() => {
    if (textSetting?.provider === 'codex') setReviewModel(textSetting.model.trim());
  }, [textSetting?.provider, textSetting?.model]);

  useEffect(() => {
    if (visionSetting?.provider === 'codex') setDynamicModel(visionSetting.model.trim());
  }, [visionSetting?.provider, visionSetting?.model]);

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
      if (next.connected) {
        setLoginId(null);
        await loadModels();
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
    const timer = setInterval(() => {
      if (Date.now() - loginStarted.current > 10 * 60_000) {
        setLoginId(null);
        void api.codexCancelLogin(loginId).catch(() => {});
        setError('Sign-in timed out. Connect again to open a new browser sign-in.');
        return;
      }
      void refresh().catch(() => { /* Keep pending sign-in retryable. */ });
    }, 2000);
    return () => clearInterval(timer);
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
    setMessage('Finish ChatGPT sign-in in your browser. This page will update automatically.');
  }

  async function selectFor(role: Role, selectedModel: string) {
    const selected = models.find(item => item.id === selectedModel);
    if (!status?.connected || !selected) return;
    if (role === 'vision' && !supportsDynamicScreenshots(selected)) return;
    await api.updateAiSetting(role, { provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: selected.id, fallbackEnabled: false });
    await onRefresh();
    setMessage(`Codex is selected for ${role === 'text' ? 'Review' : 'Dynamic testing'}.`);
  }

  const reviewSelection = models.find(item => item.id === reviewModel);
  const dynamicSelection = models.find(item => item.id === dynamicModel);
  const disabled = !!busy;
  const canChooseModel = modelCatalogState === 'ready' && !disabled;

  return <section className="provider-form codex-provider-panel" aria-labelledby="codex-provider-heading">
    <div className="provider-form-header">
      <h4 id="codex-provider-heading">Codex with ChatGPT</h4>
      <StatusBadge label={statusLoading ? 'Checking' : !status ? 'Unavailable' : status.connected ? 'Connected' : status.available ? 'Not connected' : 'Unavailable'} tone={status?.connected ? 'success' : 'warning'} />
    </div>
    <p className="form-hint">Use your ChatGPT account for Review and Dynamic testing. Sign-in is saved for your Centinel account on this device. No API key is needed.</p>
    <dl className="codex-saved-assignments" aria-label="Saved model assignments">
      <div><dt>Review</dt><dd><code>{describeSavedModel(settings, 'text')}</code></dd></div>
      <div><dt>Dynamic testing</dt><dd><code>{describeSavedModel(settings, 'vision')}</code></dd></div>
    </dl>
    {status?.accountLabel
      ? <p className="form-hint">Connected as {status.accountLabel}</p>
      : status?.message && <p className="form-hint">{status.message}</p>}
    <div className="form-actions">
      {!status?.connected && !loginId && <button className="btn-primary" type="button" disabled={disabled || statusLoading || !status?.available} onClick={() => void act('connect', connect)}>Connect Codex</button>}
      {loginId && <button className="btn-secondary" type="button" disabled={disabled} onClick={() => void act('cancel', async () => { await api.codexCancelLogin(loginId); setLoginId(null); setMessage('Sign-in cancelled.'); })}>Cancel sign-in</button>}
      {status?.connected && <button className="btn-secondary" type="button" disabled={disabled} onClick={() => void act('disconnect', async () => { await api.codexLogout(); await refresh(true); setMessage('Codex disconnected on this device. Saved model selections need a new connection.'); })}>Disconnect Codex</button>}
      <button className="btn-secondary" type="button" disabled={disabled || statusLoading} onClick={() => void act('refresh', () => refresh(true))}>Refresh connection</button>
    </div>
    {statusError && <p role="alert" className="form-error">{statusError}</p>}
    {status?.connected && <>
      <div className="codex-model-catalog-heading">
        <div>
          <h5>Available models</h5>
          <p className="form-hint">Models come from the connected Codex account. The selected model is saved separately for each workflow.</p>
        </div>
        <button className="btn-secondary" type="button" disabled={disabled || modelCatalogState === 'loading'} onClick={() => void act('models', loadModels)}>
          {modelCatalogState === 'loading' ? 'Refreshing…' : 'Refresh models'}
        </button>
      </div>
      {modelCatalogState === 'loading' && <p className="codex-catalog-status" role="status">Loading available Codex models…</p>}
      {modelCatalogState === 'empty' && <p className="codex-catalog-status" role="status">No Codex models are available for this account.</p>}
      {modelCatalogState === 'error' && <p className="codex-catalog-status codex-catalog-error" role="alert">{modelError}</p>}
      {modelCatalogState === 'ready' && models.some(model => model.catalogWarning === 'account_catalog_unavailable') && <p className="codex-catalog-status" role="status">Showing models reported by the installed Codex CLI. The live account catalog is unavailable, so newer choices may be missing.</p>}
      <div className="codex-model-grid">
        <section className="codex-model-choice" aria-labelledby="codex-review-model-heading">
          <h5 id="codex-review-model-heading">Review</h5>
          <div className="form-field">
            <label htmlFor="codex-review-model">Review model</label>
            <Select id="codex-review-model" value={reviewSelection ? reviewModel : NO_MODEL_SELECTED} onChange={setReviewModel} disabled={!canChooseModel} placeholder="Choose an available model" options={modelOptions(models, reviewSelection)} />
            <p className="form-hint">{modelSupportDescription(reviewSelection, 'text')}</p>
            {textSetting?.provider === 'codex' && textSetting.model.trim() && modelCatalogState === 'ready' && !models.some(item => item.id === textSetting.model) && <p className="codex-model-unavailable" role="status">Saved model <code>{textSetting.model}</code> is not in this account’s current list. Choose an available model to change it.</p>}
          </div>
          <div className="form-actions codex-model-actions">
            <button className="btn-secondary" type="button" disabled={disabled || !reviewSelection} onClick={() => void act('test-text', async () => { const result = await api.testCodex(reviewModel); if (result.status === 'fail') setError(result.message); else setMessage(result.message); })}>Test text</button>
            <button className="btn-primary" type="button" disabled={disabled || !reviewSelection} onClick={() => void act('save-review', () => selectFor('text', reviewModel))}>Use for Review</button>
          </div>
        </section>

        <section className="codex-model-choice" aria-labelledby="codex-dynamic-model-heading">
          <h5 id="codex-dynamic-model-heading">Dynamic testing</h5>
          <div className="form-field">
            <label htmlFor="codex-dynamic-model">Dynamic testing model</label>
            <Select id="codex-dynamic-model" value={dynamicSelection ? dynamicModel : NO_MODEL_SELECTED} onChange={setDynamicModel} disabled={!canChooseModel} placeholder="Choose an available model" options={modelOptions(models, dynamicSelection)} />
            <p className="form-hint">{modelSupportDescription(dynamicSelection, 'vision')}</p>
            {visionSetting?.provider === 'codex' && visionSetting.model.trim() && modelCatalogState === 'ready' && !models.some(item => item.id === visionSetting.model) && <p className="codex-model-unavailable" role="status">Saved model <code>{visionSetting.model}</code> is not in this account’s current list. Choose an available model to change it.</p>}
          </div>
          <div className="form-actions codex-model-actions">
            <button className="btn-secondary" type="button" disabled={disabled || !supportsDynamicScreenshots(dynamicSelection)} onClick={() => void act('test-image', async () => { const result = await api.testCodex(dynamicModel, true); if (result.status === 'fail') setError(result.message); else setMessage(result.message); })}>Test screenshot</button>
            <button className="btn-primary" type="button" disabled={disabled || !supportsDynamicScreenshots(dynamicSelection)} onClick={() => void act('save-dynamic', () => selectFor('vision', dynamicModel))}>Use for Dynamic</button>
          </div>
        </section>
      </div>
    </>}
    {busy && <p role="status" className="form-hint">{busy.startsWith('test') ? 'Testing Codex…' : busy === 'models' ? 'Refreshing the account model list…' : 'Updating Codex…'}</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
