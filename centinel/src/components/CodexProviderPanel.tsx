import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AiProviderSetting } from '../types';
import { StatusBadge } from './CommandUI';
import { Select } from './Select';
import { openExternalUrl } from '../utils/openExternalUrl';
import { userFacingError } from '../utils/userFacingError';

type Status = Awaited<ReturnType<typeof api.codexStatus>>;
type Model = Awaited<ReturnType<typeof api.codexModels>>[number];

export function CodexProviderPanel({ settings, onRefresh }: { settings: AiProviderSetting[]; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [loginId, setLoginId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const loginStarted = useRef(0);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const next = await api.codexStatus();
      if (!mounted.current) return;
      setStatus(next);
      if (next.connected) {
        setLoginId(null);
        const catalog = await api.codexModels();
        if (!mounted.current) return;
        setModels(catalog);
        setModel(current => catalog.some(item => item.id === current) ? current : catalog.find(item => item.isDefault)?.id ?? catalog[0]?.id ?? '');
      } else { setModels([]); }
    } finally { refreshing.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(cause => { if (mounted.current) setError(userFacingError(cause, 'Codex status could not be loaded.')); });
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

  async function selectFor(id: 'text' | 'vision') {
    if (!model || !status?.connected) return;
    await api.updateAiSetting(id, { provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model, fallbackEnabled: false });
    await onRefresh();
    setMessage(`Codex is selected for ${id === 'text' ? 'Review' : 'Dynamic testing'}.`);
  }

  const selected = models.find(item => item.id === model);
  const disabled = !!busy;
  return <div className="provider-form codex-provider-panel" aria-label="Codex provider">
    <div className="provider-form-header">
      <h4>Codex with ChatGPT</h4>
      <StatusBadge label={!status ? 'Checking' : status.connected ? 'Connected' : status.available ? 'Not connected' : 'Unavailable'} tone={status?.connected ? 'success' : 'warning'} />
    </div>
    <p className="form-hint">Use your ChatGPT account for Review and Dynamic testing. Sign-in is saved for your Centinel account on this device. No API key is needed.</p>
    <p className="form-hint">{status?.accountLabel ?? status?.message}</p>
    <div className="form-actions">
      {!status?.connected && !loginId && <button className="btn-primary" type="button" disabled={disabled || !status?.available} onClick={() => void act('connect', connect)}>Connect Codex</button>}
      {loginId && <button className="btn-secondary" type="button" disabled={disabled} onClick={() => void act('cancel', async () => { await api.codexCancelLogin(loginId); setLoginId(null); setMessage('Sign-in cancelled.'); })}>Cancel sign-in</button>}
      {status?.connected && <button className="btn-secondary" type="button" disabled={disabled} onClick={() => void act('disconnect', async () => { await api.codexLogout(); await refresh(); setMessage('Codex disconnected on this device. Saved model selections need a new connection.'); })}>Disconnect Codex</button>}
      <button className="btn-secondary" type="button" disabled={disabled} onClick={() => void act('refresh', refresh)}>Refresh connection</button>
    </div>
    {status?.connected && <>
      <div className="form-field">
        <label htmlFor="codex-model">Codex model</label>
        <Select id="codex-model" value={model} onChange={setModel} disabled={disabled || !models.length} placeholder="Choose a model" options={models.map(item => ({ value: item.id, label: item.label }))} />
        <p className="form-hint">{!selected ? 'No models are available for this account.' : selected.supportsImages ? 'This model supports text and screenshots.' : 'This model supports text only. Dynamic testing requires screenshots.'}</p>
      </div>
      <div className="form-actions">
        <button className="btn-secondary" type="button" disabled={disabled || !selected} onClick={() => void act('test-text', async () => { const result = await api.testCodex(model); if (result.status === 'fail') setError(result.message); else setMessage(result.message); })}>Test text</button>
        <button className="btn-secondary" type="button" disabled={disabled || !selected?.supportsImages} onClick={() => void act('test-image', async () => { const result = await api.testCodex(model, true); if (result.status === 'fail') setError(result.message); else setMessage(result.message); })}>Test screenshot</button>
        <button className="btn-primary" type="button" disabled={disabled || !selected} onClick={() => void act('save-review', () => selectFor('text'))}>Use for Review</button>
        <button className="btn-primary" type="button" disabled={disabled || !selected?.supportsImages} onClick={() => void act('save-dynamic', () => selectFor('vision'))}>Use for Dynamic</button>
      </div>
    </>}
    <p className="form-hint">Review: {settings.find(item => item.id === 'text')?.provider === 'codex' ? `Codex · ${settings.find(item => item.id === 'text')?.model}` : settings.find(item => item.id === 'text')?.hasApiKey ? 'API provider' : 'Not configured'} · Dynamic: {settings.find(item => item.id === 'vision')?.provider === 'codex' ? `Codex · ${settings.find(item => item.id === 'vision')?.model}` : settings.find(item => item.id === 'vision')?.hasApiKey ? 'API provider' : 'Not configured'}</p>
    {busy && <p role="status" className="form-hint">{busy.startsWith('test') ? 'Testing Codex…' : 'Updating Codex…'}</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}
