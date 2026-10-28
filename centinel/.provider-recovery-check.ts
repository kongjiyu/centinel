import { api, ApiError } from './src/api/client';
import { restoreSupabaseSession, subscribeToSupabaseAuth } from './src/auth/supabaseAuth';
const button = document.querySelector<HTMLButtonElement>('#check')!;
const status = document.querySelector('#status')!;
const record = async (data: unknown) => {
  const response = await fetch('http://127.0.0.1:37814/event', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'provider-recovery-test', data }) });
  if (!response.ok) throw Error('Evidence capture failed.');
};
if (!await restoreSupabaseSession()) { button.disabled = true; status.textContent = 'Sign in to Centinel first.'; }
else { subscribeToSupabaseAuth(() => undefined); status.textContent = 'Authenticated. No provider request has been made.'; }
button.onclick = async () => {
  button.disabled = true;
  const started = performance.now();
  try {
    const result = await api.testCodex('gpt-6.1-sol');
    await record({ model: 'gpt-6.1-sol', status: result.status, durationMs: Math.round(performance.now() - started) });
    status.textContent = `${result.status}: ${result.message}`;
  } catch (error) {
    const detail = { model: 'gpt-6.1-sol', status: 'fail', durationMs: Math.round(performance.now() - started),
      code: error instanceof ApiError ? error.code : null, httpStatus: error instanceof ApiError ? error.status : null };
    await record(detail);
    status.textContent = JSON.stringify(detail, null, 2);
  }
};
