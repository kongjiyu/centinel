// Browser-only fixture: all API/Auth traffic is intercepted, no live data writes.
export async function installConnectionReviewFixture(context) {
  const timestamp = '2026-10-13T12:00:00.000Z';
  const project = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Import verification', description: 'Fixture project', workspacePath: '', createdAt: timestamp, updatedAt: timestamp };
  const run = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', projectId: project.id, sourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'queued', idempotencyKey: 'fixture-job', remoteRevision: null, cursorStart: null, cursorEnd: null, attemptCount: 0, importedCount: 0, updatedCount: 0, unchangedCount: 0, removedCount: 0, inaccessibleCount: 0, errorCode: null, errorMessage: null, retryable: false, startedAt: null, completedAt: null, createdAt: timestamp };
  const source = { id: run.sourceId, projectId: project.id, integrationId: 'fixture-integration', provider: 'github', kind: 'github_repository', remoteId: 'example/repository', remoteUrl: 'https://github.com/example/repository', name: 'repository', selectedScope: {}, remoteRevision: null, syncCursor: null, status: 'active', syncStatus: 'syncing', lastSyncedAt: null, lastSuccessfulSyncAt: null, lastError: null, createdAt: timestamp, updatedAt: timestamp, latestSyncRun: run };
  const session = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', projectId: project.id, name: 'Retry visibility review', reviewType: 'code_review', status: 'running', configJson: '{}', progressJson: JSON.stringify({ currentStage: 'code_review', stages: [{ id: 'understanding_context', label: 'Understanding Context', status: 'done', thoughts: ['Loaded frozen sources'] }, { id: 'code_review', label: 'Code Review', status: 'running', thoughts: [] }], startedAt: timestamp, updatedAt: timestamp }), remarks: '', finalSummary: '', failureReason: '', createdAt: timestamp, updatedAt: timestamp, baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '' };
  const state = { project, source, run, session, requests: [], projects: [project], settingsUnavailable: false };
  const authModule = `const session={access_token:'fixture-only-bearer',user:{id:'fixture-user',email:'reviewer@example.test',app_metadata:{provider:'email'},user_metadata:{}}};
    export const isSupabaseAuthConfigured=()=>true; export const restoreSupabaseSession=async()=>session;
    export const subscribeToSupabaseAuth=()=>()=>{}; export const subscribeToDeepLinkAuth=()=>()=>{};
    export const signOutSupabase=async()=>{}; export const signInWithPassword=async()=>session;
    export const startGoogleSignIn=async()=>{}; export const startGithubSignIn=async()=>{};
    export const getSupabaseBrowserClient=()=>null; export const cacheSession=()=>{};
    export const identityLinkResultEvent='fixture-link'; export const consumeIdentityLinkResult=()=>null;
    export const cancelPendingIdentityLink=()=>{}; export const getLinkedIdentities=async()=>[];
    export const linkIdentity=async()=>{}; export const unlinkIdentity=async()=>{};
    export const completeDeepLinkSignIn=async()=>session; export class IdentityLinkError extends Error {}`;
  await context.route('**/src/auth/supabaseAuth.ts*', route => route.fulfill({ contentType: 'application/javascript', body: authModule }));
  await context.route('https://api.github.com/repos/kongjiyu/centinel/releases/latest', route => route.fulfill({ json: { tag_name: 'v0.0.0', html_url: 'https://github.com/kongjiyu/centinel/releases' } }));
  await context.route('http://localhost:37701/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    state.requests.push({ path, method: request.method() });
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let json = [];
    if (path === '/projects') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        project.name = body.name;
        json = project;
      } else json = state.projects;
    } else if (path === `/projects/${project.id}`) json = project;
    else if (path === '/github/status') json = { connected: true, login: 'fixture-reviewer', message: 'Connected' };
    else if (path === '/settings/ai') json = [{ id: 'text', label: 'Text AI', provider: 'custom', apiFormat: 'openai-compatible', hasApiKey: true, apiKeyPreview: 'Configured', baseUrl: 'https://provider.example.test/v1', model: 'fixture-model', updatedAt: timestamp }];
    else if (path === '/integrations') json = [{ id: source.integrationId, provider: 'github', accountLabel: 'fixture-reviewer', accountId: '42', scopes: 'repo', expiresAt: null, status: 'connected', createdAt: timestamp, updatedAt: timestamp }];
    else if (path.endsWith('/sources')) json = [source];
    else if (path.endsWith('/sync-history')) json = [run];
    else if (path.endsWith('/sync')) json = { source, run, complete: run.status === 'success', imported: run.importedCount, updated: run.updatedCount, unchanged: run.unchangedCount, removed: run.removedCount, inaccessible: run.inaccessibleCount };
    else if (path.endsWith('/static-sessions')) json = [];
    else if (path.includes(`/static-sessions/${session.id}`) && !/\/(findings|decisions|harness|evidence-sufficiency|correlations|source-manifest|traceability|model-usage)$/.test(path)) json = session;
    else if (path.endsWith('/assessment')) json = { status: 'unavailable' };
    else if (path.startsWith('/settings/ai/usage')) json = { totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 }, byGroup: [], recent: [] };
    return route.fulfill({ status: request.method() === 'POST' && path === '/projects' ? 201 : 200, headers, json });
  });
  return state;
}
