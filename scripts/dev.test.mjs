import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeService } from './dev.mjs';

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
