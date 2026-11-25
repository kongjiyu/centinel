import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauri = join(root, 'centinel', 'src-tauri');
const windows = process.platform === 'win32';
const target = windows ? 'x86_64-pc-windows-msvc' : process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
if (!windows && process.platform !== 'darwin') throw new Error('The package smoke runs on Windows or macOS.');
const resources = process.argv[2] ? resolve(process.argv[2]) : join(tauri, 'resources', 'sidecar');
const node = process.argv[3] ? resolve(process.argv[3])
  : join(tauri, 'binaries', 'centinel-node-' + target + (windows ? '.exe' : ''));
const temp = await realpath(tmpdir());
const home = await mkdtemp(join(temp, 'orin-packaged-smoke-'));
const key = randomBytes(32);
const owner = randomUUID();
const outsider = randomUUID();
const denied = [];
let connectionReads = 0;
const host = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && url.pathname === '/auth/v1/user' && /^Bearer (owner|outsider)$/.test(req.headers.authorization ?? '')) {
    res.end(JSON.stringify({ id: req.headers.authorization === 'Bearer owner' ? owner : outsider, role: 'authenticated' }));
  } else if (req.method === 'GET' && url.pathname === '/rest/v1/integrations' && url.searchParams.get('owner_id') === `eq.${owner}`) {
    connectionReads++;
    res.end('[]');
  } else {
    denied.push({ method: req.method, pathname: url.pathname });
    res.writeHead(403).end('{}');
  }
});
const listen = async server => {
  server.listen(0, 'localhost');
  await once(server, 'listening');
  return `http://localhost:${server.address().port}`;
};
const close = server => new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
const ports = createServer();
let worker;
let output = '';
async function stop() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  const closed = once(worker, 'exit');
  worker.kill();
  await closed;
}
try {
  const auth = await listen(host);
  const base = await listen(ports);
  await close(ports);
  const env = { ...process.env, CENTINEL_HOME: home, CENTINEL_PACKAGED: '1', CENTINEL_MODEL_KEY_PIPE: '1',
    CENTINEL_LOCAL_WORKSPACE_PILOT: '1', CENTINEL_AI_ASSESSMENT_PAUSED: '1', CENTINEL_SIDECAR_PORT: new URL(base).port,
    CENTINEL_RUNTIME_ENV: join(resources, 'runtime.env'), SUPABASE_URL: auth, SUPABASE_ANON_KEY: 'fixture-publishable-key' };
  delete env.CENTINEL_TOKEN_ENCRYPTION_KEY;
  const start = async () => {
    worker = spawn(node, [join(resources, 'dist', 'index.mjs')], { cwd: resources, env, windowsHide: true });
    worker.on('error', error => { output = (output + error.message).slice(-4000); });
    const remember = chunk => { output = (output + chunk).slice(-4000); };
    worker.stderr.on('data', remember);
    worker.stdout.on('data', remember);
    worker.stdin.on('error', () => undefined);
    worker.stdin.end(key);
    for (let i = 0; i < 300 && worker.exitCode === null; i++) {
      if (await fetch(base + '/health', { signal: AbortSignal.timeout(500) }).then(res => res.ok, () => false)) return;
      await delay(100);
    }
    throw new Error(`Bundled sidecar did not start (exit ${worker.exitCode}, signal ${worker.signalCode}). ${output}`);
  };
  const call = async (path, status, { method = 'GET', body, account = 'owner' } = {}) => {
    const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + account, 'content-type': 'application/json' },
      body: body && JSON.stringify(body), signal: AbortSignal.timeout(7000) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${result?.error ?? ''}`);
    return result;
  };
  await start();
  const project = await call('/projects', 201, { method: 'POST', body: { name: 'Packaged workspace fixture', sources: [] } });
  const url = '/projects/' + project.id;
  const text = Buffer.from('export const fixture = 1;\r\n').toString('base64');
  const artifact = await call(url + '/artifacts', 201, { method: 'POST', body: { fileName: 'fixture.ts', content: text, type: 'source_code' } });
  assert.equal(await call('/integrations/github', 200), null);
  assert.equal(connectionReads, 1);
  assert.equal((await fetch(base + '/integrations/github/callback', { signal: AbortSignal.timeout(7000) })).status, 400);
  await call('/settings/ai/shared', 200, { method: 'PUT', body: { provider: 'custom', apiFormat: 'openai-compatible',
    model: 'fixture', baseUrl: auth, apiKey: 'synthetic-model-key', saveOnly: true } });
  await stop();
  await start();
  assert.equal((await call('/projects', 200))[0].id, project.id);
  assert.equal((await call(url + '/artifacts/' + artifact.id + '/content', 200)).content, text);
  const settings = await call('/settings/ai', 200);
  assert.equal(settings.find(row => row.id === 'text')?.savedProviders?.api?.hasApiKey, true);
  await call('/settings/ai/shared/use', 200, { method: 'POST', body: { slot: 'api', model: 'fixture' } });
  await call(url, 404, { account: 'outsider' });
  assert.deepEqual(denied, [], 'Packaged local routes must not use hosted workspace storage.');
  console.log('Packaged sidecar smoke passed on ' + process.platform + ': local fetch after restart, owner isolation, Auth, App Connection and callback routing.');
} finally {
  key.fill(0);
  await stop();
  if (ports.listening) await close(ports);
  if (host.listening) await close(host);
  if (home.startsWith(temp + sep) && dirname(home) === temp) await rm(home, { recursive: true, force: true, maxRetries: 8 });
}
