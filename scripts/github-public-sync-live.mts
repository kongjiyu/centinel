/** Read-only public GitHub transport probe. No credentials, app data or upstream writes.
 * This verifies the real adapter, not a signed-in scheduler/Storage acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { GitHubConnectedSourceAdapter } from '../sidecar/src/integrations/providers/github.js';
import type { ConnectedSource, IntegrationCredential } from '../sidecar/src/integrations/types.js';

const results = [];
for (const remoteId of ['expressjs/cors', 'expressjs/serve-static']) {
  const requests: string[] = [];
  const http = { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.delete('Authorization');
    const url = String(input); assert.equal(new URL(url).hostname, 'api.github.com');
    requests.push(new URL(url).pathname);
    return fetch(input, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  } };
  const adapter = new GitHubConnectedSourceAdapter({ http, pageSize: 1 });
  const now = new Date().toISOString();
  const source: ConnectedSource = { id: 'read-only-probe', projectId: 'not-persisted', integrationId: 'none', provider: 'github', kind: 'github_repository', remoteId,
    remoteUrl: `https://github.com/${remoteId}`, name: remoteId, selectedScope: {}, remoteRevision: null, syncCursor: null,
    status: 'active', syncStatus: 'ready', lastSyncedAt: now, lastSuccessfulSyncAt: now, lastError: null, createdAt: now, updatedAt: now };
  const credential: IntegrationCredential = { accessToken: '', refreshToken: null, expiresAt: null, scopes: '' };
  const snapshot = await adapter.prepareSync(credential, source);
  const headOnlyRequests = requests.splice(0);
  assert(!headOnlyRequests.some(url => /\/(?:trees|blobs)\//.test(url)));
  assert(snapshot.remoteRevision);
  assert.equal(adapter.isSourceRevisionUnchanged({ ...source, remoteRevision: snapshot.remoteRevision }, snapshot), true);
  const response = await http.fetch(`https://api.github.com/repos/${remoteId}/commits/${snapshot.remoteRevision}`);
  assert(response.ok, `Public commit lookup returned ${response.status}`);
  const commit = await response.json() as { parents: Array<{ sha: string }> };
  const parent = commit.parents[0]?.sha; assert(parent);
  const comparison = await http.fetch(`https://api.github.com/repos/${remoteId}/compare/${parent}...${snapshot.remoteRevision}`);
  assert(comparison.ok, `Public ancestry lookup returned ${comparison.status}`);
  const ancestry = await comparison.json() as { status: string; ahead_by: number };
  assert.equal(ancestry.status, 'ahead'); assert(ancestry.ahead_by >= 1);
  assert.equal(adapter.isSourceRevisionUnchanged({ ...source, remoteRevision: parent }, snapshot), false);
  const beforeContent = requests.length;
  const page = await adapter.listItems(credential, source, snapshot, snapshot.cursor);
  assert(page.items.length > 0);
  const contentRequests = requests.slice(beforeContent);
  assert(contentRequests.some(url => url.includes('/git/trees/')));
  results.push({ repository: remoteId, currentHead: snapshot.remoteRevision, previousCommit: parent, aheadBy: ancestry.ahead_by,
    unchangedSkipsContent: true, headOnlyRequests, changedRevisionFetchesContent: true, sampledItems: page.items.length, contentRequests });
}
const report = { mode: 'live-public-github-adapter-read-only', recordedAt: new Date().toISOString(), authenticatedAppSchedulerVerified: false, durableStorageVerified: false, results };
const output = new URL('../evidence/github-live-2026-10-20/public-adapter-probe.json', import.meta.url);
await fs.mkdir(new URL('.', output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
