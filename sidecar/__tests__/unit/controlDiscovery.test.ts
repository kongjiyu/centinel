import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverControls, discoveryTargetUrl } from '../../src/dynamic/environment/controlDiscovery.js';

const html = fs.readFileSync(path.resolve(__dirname, '../../demo/index.html'), 'utf-8');
let server: http.Server;
let origin = '';

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/private') { response.writeHead(302, { Location: '/signin' }); response.end(); return; }
    if (request.url === '/shop') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<ul id="products"><li><span>Ceramic Mug</span><button type="button">Add to cart</button></li><li><span>Notebook</span><button type="button">Add to cart</button></li></ul>'); return; }
    if (request.url === '/broken') { response.writeHead(500, { 'Content-Type': 'text/html' }); response.end('<script>fetch("/api/fail"); throw new Error("Cannot read token eyJabc.def.ghi at /Users/me/app.js")</script>'); return; }
    if (request.url === '/api/fail') { response.writeHead(503); response.end(); return; }
    if (request.url === '/signin') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<button data-test="signin-submit">Sign In</button>'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('read-only control discovery', () => {
  it('proposes unique selectors with the matching action and no field values', async () => {
    const { controls } = await discoverControls(new URL(`${origin}/`));
    const bySelector = new Map(controls.map(control => [control.selector, control]));
    expect(bySelector.get('#username')).toMatchObject({ actions: ['type'], kind: 'Text field' });
    expect(bySelector.get('#password')).toMatchObject({ actions: ['type'], kind: 'Password field' });
    expect(bySelector.get('#login-btn')).toMatchObject({ actions: ['click'], label: 'Login' });
    expect(bySelector.get('#todo-input')).toMatchObject({ actions: ['type'] });
    expect(bySelector.get('#add-btn')).toMatchObject({ actions: ['click'] });
    expect(controls.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(controls)).not.toContain('password123');
  }, 30_000);

  it('recognises test-id attributes and reports pages that redirect to sign-in', async () => {
    const result = await discoverControls(new URL(`${origin}/`), { paths: ['/private'] });
    expect(result.pages[1]).toMatchObject({ redirected: true, controls: 1 });
    expect(result.pages[1].finalUrl).toMatch(/\/signin$/);
    expect(result.controls.find(control => control.selector === '[data-test="signin-submit"]')).toMatchObject({ actions: ['click'], page: '/signin' });
    await expect(discoverControls(new URL(`${origin}/`), { paths: ['https://example.com/x'] })).rejects.toThrow(/same website/);
  }, 30_000);

  it('names repeated unnamed buttons by their position and row text', async () => {
    const { controls } = await discoverControls(new URL(`${origin}/shop`));
    expect(controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ selector: '#products > li:nth-of-type(1) > button', label: 'Add to cart — Ceramic Mug', actions: ['click'] }),
      expect.objectContaining({ selector: '#products > li:nth-of-type(2) > button', label: 'Add to cart — Notebook' }),
    ]));
  }, 30_000);

  it('rejects non-web addresses and embedded credentials', () => {
    expect(() => discoveryTargetUrl('file:///etc/passwd')).toThrow();
    expect(() => discoveryTargetUrl('http://user:secret@example.com')).toThrow();
    expect(discoveryTargetUrl('http://localhost:37702/').origin).toBe('http://localhost:37702');
  });

  it('records page health only when asked, without tokens or local paths', async () => {
    const plain = await discoverControls(new URL(`${origin}/`), { paths: ['/broken'] });
    expect(plain.pages[0].health).toBeUndefined();
    const result = await discoverControls(new URL(`${origin}/`), { paths: ['/broken'], collectHealth: true });
    expect(result.pages[0].health).toMatchObject({ status: 200, pageErrors: 0, serverErrors: 0 });
    const broken = result.pages[1].health!;
    expect(broken).toMatchObject({ status: 500, pageErrors: 1 });
    expect(broken.serverErrors).toBeGreaterThanOrEqual(1);
    expect(broken.messages.join(' ')).not.toMatch(/eyJabc|\/Users\/me/);
  }, 30_000);
});
