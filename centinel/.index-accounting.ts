import { getSupabaseBrowserClient, restoreSupabaseSession } from './src/auth/supabaseAuth';
const status = document.querySelector('#status')!;
const button = document.querySelector<HTMLButtonElement>('#inspect')!;
button.onclick = async () => {
  button.disabled = true;
  try {
    if (!await restoreSupabaseSession()) throw Error('Sign in to Centinel first.');
    const client = getSupabaseBrowserClient();
    if (!client) throw Error('Authenticated client unavailable.');
    const result = await client.from('model_usage_records').select('id,stage,outcome,usageContext:metadata->usageContext')
      .eq('project_id','3c66cb23-9805-471d-97e6-719182787d94').eq('review_session_id','c379b1dd-2171-4b22-96d2-319921c0a46f').order('created_at');
    if (result.error) throw Error('Saved attribution query failed.');
    status.textContent = JSON.stringify(result.data, null, 2);
    const saved = await fetch('http://127.0.0.1:37813/event', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'candidate-attribution-check',data:result.data})});
    if (!saved.ok) throw Error('Evidence recording failed.');
  } catch (cause) { status.textContent = cause instanceof Error ? cause.message : 'Check failed.'; }
  finally { button.disabled=false; }
};
