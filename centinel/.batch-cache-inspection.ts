import { api } from './src/api/client';
import { restoreSupabaseSession, subscribeToSupabaseAuth, getSupabaseBrowserClient } from './src/auth/supabaseAuth';
const projectId = '3c66cb23-9805-471d-97e6-719182787d94';
const requestedReview = new URLSearchParams(location.search).get('reviewId');
if (requestedReview && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(requestedReview)) throw Error('Invalid Review identifier.');
const reviewId = requestedReview ?? '3a197f7e-1a42-42a7-9306-4aa0213016ec';
const button = document.querySelector<HTMLButtonElement>('#inspect')!;
const status = document.querySelector('#status')!;
document.querySelector<HTMLButtonElement>('#cancel')!.onclick = async () => {
  try { await api.cancelStaticSession(projectId, reviewId); status.textContent = `Cancellation requested for ${reviewId}.`; }
  catch { status.textContent = 'Cancellation failed; inspect saved status before any retry.'; }
};
const record = async (kind: string, data: unknown) => {
  const response = await fetch('http://127.0.0.1:37814/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, projectId, data }) });
  if (!response.ok) throw Error('Evidence capture failed.');
};
if (!await restoreSupabaseSession()) { button.disabled = true; status.textContent = 'Sign in to Centinel first.'; }
else subscribeToSupabaseAuth(() => undefined);
button.onclick = async () => {
  button.disabled = true;
  try {
    const client = getSupabaseBrowserClient();
    if (!client) throw Error('Authenticated client unavailable.');
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user) throw Error('Authenticated owner unavailable.');
    const rows = await client.from('audit_events').select('id,entity_id,payload').eq('project_id', projectId)
      .eq('actor_id', verified.data.user.id).eq('entity_type', 'static_review').eq('entity_id', reviewId)
      .eq('event_type', 'review_batch_cache_saved').limit(128);
    if (rows.error) throw Error('Cache receipts could not be read.');
    const archives = [];
    for (const row of rows.data ?? []) {
      const p = row.payload;
      const expected = `${projectId}/_review-batch-cache/v1/${verified.data.user.id}/${projectId}/${p.requestHash}/${p.archiveSha256}.json.gz`;
      if (p.archivePath !== expected || !/^[a-f0-9]{64}$/.test(p.requestHash) || !/^[a-f0-9]{64}$/.test(p.archiveSha256)) throw Error('Receipt identity mismatch.');
      const object = await client.storage.from('project-artifacts').download(p.archivePath);
      if (object.error || !object.data || object.data.size > 4 * 1024 * 1024) throw Error('Archive unavailable.');
      const bytes = await object.data.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      const envelope = await new Response(object.data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      archives.push({ originReviewId: row.entity_id, requestHash: p.requestHash, archiveBytes: object.data.size,
        archiveHashMatches: digest === p.archiveSha256 && object.data.size === p.archiveBytes,
        authenticatedEnvelopeShape: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(envelope) });
    }
    await record('batch-cache-storage-inspection', { reviewId, receiptCount: rows.data?.length ?? 0, archives });
    const usage = await api.getReviewModelUsage(projectId, reviewId);
    const harness = await api.getReviewHarness(projectId, reviewId);
    await record('interim-v20-usage', usage);
    await record('interim-v20-harness', harness);
    const session = await api.getStaticSession(projectId, reviewId);
    await record('inspected-session', session);
    if (!['queued', 'running', 'created', 'prepared'].includes(session.status)) {
      await record('inspected-findings', await api.listStaticFindings(projectId, reviewId));
      await record('inspected-manifest', await api.getReviewSourceManifest(projectId, reviewId));
      await record('inspected-traceability', await api.getReviewTraceability(projectId, reviewId));
      await record('inspected-evidence', await api.getReviewEvidenceSufficiency(projectId, reviewId));
    }
    status.textContent = JSON.stringify({ reviewId, receiptCount: rows.data?.length ?? 0, archives, totals: usage.totals,
      reusedAssessments: usage.reviewUsage?.reusedAssessments }, null, 2);
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Inspection failed.'; }
  finally { button.disabled = false; }
};
