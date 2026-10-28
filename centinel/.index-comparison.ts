import { api } from './src/api/client';
import { restoreSupabaseSession, subscribeToSupabaseAuth } from './src/auth/supabaseAuth';

const projectId = '3c66cb23-9805-471d-97e6-719182787d94';
const historicalReview = '4cf606de-7bc7-482d-aee2-8df0f3cbdb97';
const recorder = 'http://127.0.0.1:37814/event';
const status = document.querySelector('#status')!;
const baselineButton = document.querySelector<HTMLButtonElement>('#baseline')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const collectButton = document.querySelector<HTMLButtonElement>('#collect')!;
let optimizedReview: string | null = null;
let baselineManifest: Awaited<ReturnType<typeof api.getReviewSourceManifest>> | null = null;
let baselineSession: Awaited<ReturnType<typeof api.getStaticSession>> | null = null;
const log = (text: string) => { status.textContent += `\n${new Date().toISOString()} ${text}`; };
async function record(kind: string, data: unknown) {
  const response = await fetch(recorder, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, projectId, data }) });
  if (!response.ok) throw Error('Evidence recording failed; stopped.');
}
async function collect(id: string, prefix: string) {
  for (const [name, call] of [
    ['session', () => api.getStaticSession(projectId, id)],
    ['manifest', () => api.getReviewSourceManifest(projectId, id)],
    ['usage', () => api.getReviewModelUsage(projectId, id)],
    ['findings', () => api.listStaticFindings(projectId, id)],
    ['traceability', () => api.getReviewTraceability(projectId, id)],
    ['harness', () => api.getReviewHarness(projectId, id)],
    ['evidence', () => api.getReviewEvidenceSufficiency(projectId, id)],
  ] as const) await record(`${prefix}-${name}`, await call());
  await record(`${prefix}-project-embedding-usage`, await api.getAiUsage({ projectId, scope: 'embedding' }));
}
async function act(button: HTMLButtonElement, operation: () => Promise<void>) {
  button.disabled = true;
  try { await operation(); } catch (cause) { log(cause instanceof Error ? cause.message : 'Evaluation failed.'); }
  finally { button.disabled = false; }
}
baselineButton.onclick = () => void act(baselineButton, async () => {
  baselineManifest = await api.getReviewSourceManifest(projectId, historicalReview);
  baselineSession = await api.getStaticSession(projectId, historicalReview);
  if (baselineManifest.status !== 'available' || baselineManifest.artifacts?.length !== 52) throw Error('Historical frozen 52-file scope is not available.');
  await collect(historicalReview, 'baseline');
  await record('source-index-preflight', await api.getSourceIndexStatus(projectId));
  const settings = await api.aiSettings();
  await record('model-configuration', settings.map(item => ({ id: item.id, provider: item.provider, model: item.model,
    embeddingProvider: item.embeddingProvider, embeddingDimensions: item.embeddingDimensions, configured: item.hasApiKey })));
  const text = settings.find(item => item.id === 'text');
  const embedding = settings.find(item => item.id === 'embedding');
  if (text?.model !== 'gpt-6.1-sol' || embedding?.embeddingProvider !== 'voyage' || !embedding.hasApiKey) throw Error('Expected Review model or saved Voyage embedding configuration is unavailable.');
  runButton.disabled = false;
  log('Baseline captured: 52 exact frozen source versions. Optimized review can now be started.');
});
runButton.onclick = () => void act(runButton, async () => {
  if (!baselineManifest || !baselineSession) throw Error('Capture the baseline first.');
  const currentArtifacts = await api.listArtifacts(projectId);
  const selected = baselineManifest.artifacts!;
  for (const frozen of selected) {
    const current = currentArtifacts.find(item => item.id === frozen.id);
    if (!current || current.versionId !== frozen.artifactVersionId || current.contentHash !== frozen.contentHash || current.filePath !== frozen.filePath)
      throw Error('Current source versions differ from the historical baseline. No review was started.');
  }
  await record('optimized-preflight', { selectedArtifacts: selected, authorityScope: baselineSession.scope,
    workflow: 'saved_source_retry_same_versions', baselineReviewId: historicalReview });
  // Explicit retry after confidence/continuation and accounting corrections. Preserve the failed
  // execution and exact frozen snapshot; never retry model calls automatically.
  await collect('1deb8b4b-10b5-4da3-b627-0e7a50ed4d8b', 'previous-reference-failed');
  const response = await api.retryStaticSession(projectId, '1deb8b4b-10b5-4da3-b627-0e7a50ed4d8b', {
    refreshSourceManifest: false, reuseValidatedBatches: true, idempotencyKey: 'local-index-v20-axios-validated-batch-cache-readback-fix-2026-10-28-4',
  });
  optimizedReview = response.id;
  if (!optimizedReview) throw Error('Review start returned no execution ID.');
  collectButton.disabled = false;
  await record('optimized-started', { reviewId: optimizedReview, baselineReviewId: historicalReview, frozenArtifacts: baselineManifest.artifacts });
  log(`Full-scope comparison started: ${optimizedReview}`);
  // Polling observes one saved execution; it never retries model calls or starts another review.
  while (true) {
    const review = await api.getStaticSession(projectId, optimizedReview);
    await record('optimized-progress', review);
    const progress = JSON.parse(review.progressJson || '{}');
    log(`${review.status}: ${progress.stage ?? 'unknown'} — ${progress.message ?? ''}`);
    if (!['queued', 'running', 'created', 'prepared'].includes(review.status)) {
      await collect(optimizedReview, 'optimized');
      log(`Terminal execution saved: ${review.status}. Quality acceptance requires independent comparison.`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
});
collectButton.onclick = () => void act(collectButton, async () => {
  if (!optimizedReview) throw Error('No optimized review execution is registered.');
  await collect(optimizedReview, 'optimized');
  log('Saved execution evidence collected.');
});
if (!await restoreSupabaseSession()) {
  baselineButton.disabled = true;
  log('Sign in to Centinel in the other tab, then reload this local evaluation page.');
} else {
  subscribeToSupabaseAuth(() => undefined);
  status.textContent = 'Authenticated. Baseline collection performs no assessment or embedding requests.';
}
