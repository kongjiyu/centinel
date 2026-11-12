import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { getServiceArgs, probeService, resolveAppAction } from './dev.mjs';

test('reuse a recognized service, reject an unrelated listener, and detect a free port', async () => {
  const server = http.createServer((_req, res) => res.end('centinel-fixture'));
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const port = server.address().port;
  try {
    assert.equal(await probeService({ port, pathname: '/', match: body => body === 'centinel-fixture' }), 'reuse');
    assert.equal(await probeService({ port, pathname: '/', match: () => false }), 'conflict');
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await probeService({ port, pathname: '/', match: () => true }), 'available');
});

test('Windows requires a matching service and a listener owned by this checkout', { skip: process.platform !== 'win32', timeout: 20000 }, async (t) => {
  const serve = `
    const server = require('node:http').createServer((_req, res) => res.end('centinel-fixture'));
    server.listen(0, 'localhost', () => process.send(server.address().port));
    process.on('disconnect', () => server.close());
  `;
  const workspaceFixture = fileURLToPath(import.meta.url);
  for (const [marker, expected] of [[workspaceFixture, 'reuse'], ['other-checkout', 'conflict']]) {
    const child = spawn(process.execPath, ['-e', serve, marker], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    t.after(() => { if (child.connected) child.disconnect(); });
    const [port] = await once(child, 'message', { signal: t.signal });
    assert.equal(await probeService({ port, pathname: '/', workspace: true, match: body => body === 'centinel-fixture' }), expected);
  }
});

test('Tauri launches over a reused Vite server without starting a second frontend', () => {
  const app = { name: 'app', args: ['--filter', 'centinel', 'tauri', 'dev'] };
  const sidecar = { name: 'sidecar', args: ['--filter', '@centinel/sidecar', 'start'] };

  assert.deepEqual(getServiceArgs(sidecar, true), sidecar.args);

  const bundle = { externalBin: [], resources: [] };
  const freshArgs = getServiceArgs(app);
  assert.deepEqual(freshArgs.slice(0, app.args.length + 1), [...app.args, '--config']);
  assert.deepEqual(JSON.parse(freshArgs.at(-1)), { tauri: { bundle } });

  const args = getServiceArgs(app, true);
  assert.deepEqual(args.slice(0, app.args.length), app.args);
  assert.equal(args[app.args.length], '--config');
  assert.deepEqual(JSON.parse(args[app.args.length + 1]), {
    build: { beforeDevCommand: null },
    tauri: { bundle },
  });
});

test('unknown or inconsistent native-process state never launches a second desktop window', () => {
  assert.equal(resolveAppAction('reuse', true), 'reuse');
  assert.equal(resolveAppAction('reuse', false), 'launch-shell');
  assert.equal(resolveAppAction('available', false), 'launch');
  assert.equal(resolveAppAction('reuse', null), 'unknown');
  assert.equal(resolveAppAction('available', null), 'unknown');
  assert.equal(resolveAppAction('available', true), 'conflict');
  assert.equal(resolveAppAction('conflict', false), 'conflict');
});
