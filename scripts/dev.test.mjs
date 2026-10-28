import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test('Tauri launches over a reused Vite server without starting a second frontend', () => {
  const app = { name: 'app', args: ['--filter', 'centinel', 'tauri', 'dev'] };
  const sidecar = { name: 'sidecar', args: ['--filter', '@centinel/sidecar', 'start'] };

  assert.deepEqual(getServiceArgs(app), app.args);
  assert.deepEqual(getServiceArgs(sidecar, true), sidecar.args);

  const args = getServiceArgs(app, true);
  assert.deepEqual(args.slice(0, app.args.length), app.args);
  assert.equal(args[app.args.length], '--config');
  assert.deepEqual(JSON.parse(args[app.args.length + 1]), {
    build: { beforeDevCommand: null },
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
