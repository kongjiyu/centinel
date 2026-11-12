import { useEffect, useState } from 'react';
import { RefreshCw, Stethoscope } from 'lucide-react';
import { api } from '../api/client';
import type { AiProviderSetting } from '../types';
import { userFacingError } from '../utils/userFacingError';
import { IconButton, StatusBadge } from './CommandUI';
import { Select } from './Select';

type GeminiStatus = Awaited<ReturnType<typeof api.geminiOAuthStatus>>;

export function GeminiOAuthPanel({ setting, onRefresh }: {
  setting?: AiProviderSetting;
  onRefresh: () => Promise<void>;
}) {
  const savedModel = setting?.provider === 'gemini' && setting.connectionMethod === 'oauth' ? setting.model : '';
  const [model, setModel] = useState(savedModel);
  const [status, setStatus] = useState<GeminiStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setModel(savedModel); }, [savedModel]);
  useEffect(() => {
    let current = true;
    setChecking(true);
    void api.geminiOAuthStatus().then(result => {
      if (current) setStatus(result);
    }).catch(() => { if (current) setStatus(null); }).finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [refresh]);

  const validModel = status?.models.some(item => item.id === model);
  const submit = async (save: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      if (save) {
        await api.updateSharedAiSetting({ provider: 'gemini', apiFormat: 'google-native', apiKey: '', baseUrl: '', model, geminiOAuth: true });
        await onRefresh();
        setMessage({ ok: true, text: 'Settings saved.' });
      } else {
        const result = await api.testAiProvider('text', { model, geminiOAuth: true, testVision: true });
        setMessage({ ok: result.status === 'pass', text: result.message ?? 'Connection test finished.' });
      }
    } catch (error) {
      setMessage({ ok: false, text: userFacingError(error, 'Gemini OAuth is unavailable.') });
    } finally { setBusy(false); }
  };

  return <section className="provider-form" aria-labelledby="gemini-oauth-title">
    <div className="provider-form-header"><h4 id="gemini-oauth-title">Gemini</h4>
      <StatusBadge label={checking ? 'Checking' : status?.connected ? 'Connected' : status?.available ? 'Disconnected' : status ? 'Setup required' : 'Unavailable'}
        tone={status?.connected ? 'success' : 'warning'} />
    </div>
    <dl className="oauth-quota">
      {['Requests per minute', 'Input tokens per minute', 'Requests per day'].map(label =>
        <div key={label}><dt>{label}</dt><dd>See project limits</dd></div>)}
    </dl>
    <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">Google AI Studio usage</a>
    {!status?.connected && !checking && <p className="oauth-status-note">Gemini OAuth uses Google Cloud Application Default Credentials and a quota project. <a href="https://ai.google.dev/gemini-api/docs/oauth" target="_blank" rel="noreferrer">Google Cloud setup</a></p>}
    {status?.connected && !checking && !status.models.length && <p role="status">No generation models were returned for this Google Cloud project.</p>}
    {status?.connected && !checking && savedModel && !status.models.some(item => item.id === savedModel) && <p role="status">Saved model unavailable: {savedModel}</p>}
    {status?.connected && <>
      <div className="form-field"><label htmlFor="gemini-oauth-model">Gemini model</label>
        <Select id="gemini-oauth-model" value={validModel ? model : ''} placeholder="Choose a Gemini model"
          onChange={setModel} options={status.models.map(item => ({ value: item.id, label: item.label }))} disabled={busy || checking} />
      </div>
    </>}
    <div className="form-actions oauth-provider-footer">
      <IconButton icon={RefreshCw} label="Refresh Gemini connection" disabled={checking || busy} onClick={() => setRefresh(value => value + 1)} />
      {status?.connected && <>
        <IconButton icon={Stethoscope} label="Test Gemini connection" disabled={busy || checking || !validModel} onClick={() => void submit(false)} />
        <button type="button" className="btn-primary" disabled={busy || checking || !validModel} onClick={() => void submit(true)}>Save</button>
      </>}
    </div>
    {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'form-success' : 'form-error'}>{message.text}</p>}
  </section>;
}
