import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverControls, discoveryTargetUrl } from '../../src/dynamic/environment/controlDiscovery.js';

const html = fs.readFileSync(path.resolve(__dirname, '../../demo/index.html'), 'utf-8');
let server: http.Server;
let origin = '';

beforeAll(async () => {
  server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('read-only control discovery', () => {
  it('proposes unique selectors with the matching action and no field values', async () => {
    const controls = await discoverControls(new URL(`${origin}/`));
    const bySelector = new Map(controls.map(control => [control.selector, control]));
    expect(bySelector.get('#username')).toMatchObject({ actions: ['type'], kind: 'Text field' });
    expect(bySelector.get('#password')).toMatchObject({ actions: ['type'], kind: 'Password field' });
    expect(bySelector.get('#login-btn')).toMatchObject({ actions: ['click'], label: 'Login' });
    expect(bySelector.get('#todo-input')).toMatchObject({ actions: ['type'] });
    expect(bySelector.get('#add-btn')).toMatchObject({ actions: ['click'] });
    expect(controls.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(controls)).not.toContain('password123');
  }, 30_000);

  it('rejects non-web addresses and embedded credentials', () => {
    expect(() => discoveryTargetUrl('file:///etc/passwd')).toThrow();
    expect(() => discoveryTargetUrl('http://user:secret@example.com')).toThrow();
    expect(discoveryTargetUrl('http://localhost:37702/').origin).toBe('http://localhost:37702');
  });
});
