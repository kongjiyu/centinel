import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRepoDigest, extractForms, isSecretLikePath } from '../../src/dynamic/autonomous/repoDigest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleShop = path.resolve(here, '../../../examples/sample-shop');
const temps: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-digest-'));
  temps.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

afterEach(() => { for (const root of temps.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('autonomous repository digest', () => {
  it('digests examples/sample-shop with its routes, sign-in form, requirements and demo accounts', async () => {
    const digest = await buildRepoDigest(sampleShop);
    expect(digest.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/api/login', kind: 'server', file: 'server.js' }),
      expect.objectContaining({ method: 'GET', path: '/api/products', kind: 'server', file: 'server.js' }),
      expect.objectContaining({ path: '/', kind: 'page', file: 'public/index.html' }),
    ]));
    const signIn = digest.forms.find(form => form.id === 'signin-form');
    expect(signIn).toMatchObject({ file: 'public/index.html' });
    expect(signIn!.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'input', name: 'email', type: 'email', label: 'Email' }),
      expect.objectContaining({ tag: 'input', name: 'password', type: 'password', label: 'Password' }),
      expect.objectContaining({ tag: 'button', type: 'submit', label: 'Sign in' }),
    ]));
    const paths = digest.entries.map(entry => entry.path);
    expect(paths[0]).toBe('README.md');
    expect(paths).toContain('docs/requirements.md');
    expect(paths).toContain('package.json');
    expect(digest.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'route', path: 'server.js' }),
      expect.objectContaining({ kind: 'form', path: 'public/index.html' }),
      expect.objectContaining({ kind: 'fixture', path: 'src/users.js' }),
    ]));
    expect(digest.fixtures).toEqual(expect.arrayContaining([{ path: 'src/users.js', reason: 'seed_or_fixture_file' },
      { path: 'README.md', reason: 'demo_accounts_mentioned' }]));
    expect(digest.requirementsText).toContain('REQ-1 Sign-in');
    expect(paths.some(entry => entry.includes('sample-shop-answers'))).toBe(false);
    expect(JSON.stringify(digest)).not.toContain('Sample Shop: answer key');
    expect(digest.persistenceHints).toEqual([]);
    expect(digest.truncated).toBe(false);
    expect(digest.omittedCount).toBe(0);
    expect(digest.entries.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(60_000);
    expect(digest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await buildRepoDigest(sampleShop)).fingerprint).toBe(digest.fingerprint);
  });

  it('keeps original line numbers on route excerpts', async () => {
    const digest = await buildRepoDigest(sampleShop);
    const login = digest.routes.find(route => route.path === '/api/login' && route.kind === 'server')!;
    const entry = digest.entries.find(item => item.kind === 'route' && item.path === 'server.js'
      && item.startLine <= login.line && item.endLine >= login.line)!;
    const source = fs.readFileSync(path.join(sampleShop, 'server.js'), 'utf8').split('\n');
    expect(entry.text.split('\n')[login.line - entry.startLine]).toBe(source[login.line - 1]);
  });

  it('flags truncation and counts omitted entries when the budget is exceeded', async () => {
    const root = fixture({
      'README.md': '# App\n' + 'Long description line.\n'.repeat(400),
      'docs/requirements.md': '# Requirements\n' + '- REQ text\n'.repeat(400),
      'docs/spec.md': '# Spec\n' + 'spec\n'.repeat(400),
      'package.json': '{"name":"app"}',
      'server.js': "app.get('/api/a', h);\n",
    });
    const digest = await buildRepoDigest(root, { maxChars: 3_000 });
    expect(digest.truncated).toBe(true);
    expect(digest.omittedCount).toBeGreaterThan(0);
    expect(digest.entries.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(3_000);
    const readme = digest.entries.find(entry => entry.path === 'README.md')!;
    expect(readme.startLine).toBe(1);
    expect(readme.endLine).toBe(readme.text.split('\n').length);
    expect((await buildRepoDigest(root)).truncated).toBe(false);
  });

  it('never reads .env values or secret-looking files, but keeps .env.example names and persistence hints', async () => {
    const root = fixture({
      'README.md': '# App',
      '.env': 'DATABASE_URL=postgres://real-user:real-pass@db/prod\n',
      '.env.local': 'API_TOKEN=local-secret-value\n',
      '.env.example': 'DATABASE_URL=postgres://user:example-pass@localhost/app\nPORT=3000\n',
      'config/secrets.json': '{"apiKey":"secret-json-value"}',
      'certs/server.key': 'PRIVATE KEY MATERIAL',
      'credentials.txt': 'admin:credential-value',
      'package.json': '{"dependencies":{"pg":"8.0.0","express":"4"}}',
      'data/app.db': 'binary',
    });
    const digest = await buildRepoDigest(root);
    const dump = JSON.stringify(digest);
    for (const secret of ['real-pass', 'local-secret-value', 'secret-json-value', 'PRIVATE KEY MATERIAL', 'credential-value', 'example-pass']) {
      expect(dump).not.toContain(secret);
    }
    const example = digest.entries.find(entry => entry.path === '.env.example')!;
    expect(example.text).toContain('DATABASE_URL=');
    expect(example.text).toContain('PORT=');
    expect(digest.persistenceHints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'database_url', file: '.env.example' }),
      expect.objectContaining({ kind: 'dependency', detail: 'pg' }),
      expect.objectContaining({ kind: 'database_file', file: 'data/app.db' }),
    ]));
    expect(isSecretLikePath('.env.production')).toBe(true);
    expect(isSecretLikePath('.env.example')).toBe(false);
    expect(isSecretLikePath('id_rsa')).toBe(true);
    expect(isSecretLikePath('src/users.js')).toBe(false);
  });

  it('rejects symlinks that escape the repository root', async () => {
    const outside = fixture({ 'outside-secret.md': '# Outside requirements\nescaped-content-marker' });
    const root = fixture({ 'README.md': '# App', 'docs/inside.md': 'inside text' });
    fs.symlinkSync(path.join(outside, 'outside-secret.md'), path.join(root, 'docs', 'requirements.md'));
    fs.symlinkSync(outside, path.join(root, 'linked-dir'));
    fs.symlinkSync(path.join(root, 'docs', 'inside.md'), path.join(root, 'docs', 'alias.md'));
    const digest = await buildRepoDigest(root);
    const dump = JSON.stringify(digest);
    expect(dump).not.toContain('escaped-content-marker');
    expect(digest.requirementsText).toBeUndefined();
    expect(digest.entries.map(entry => entry.path)).toContain('docs/alias.md');
  });

  it('extracts JSX forms with labels', () => {
    const forms = extractForms({ path: 'src/Login.tsx', text: [
      '<form onSubmit={submit} method="post">',
      '  <label htmlFor="user">Username</label>',
      '  <input id="user" name="username" />',
      '  <input type="hidden" name="csrf" />',
      '  <select name="role" aria-label="Role"></select>',
      '  <button type="submit">Log in</button>',
      '</form>',
    ].join('\n') });
    expect(forms).toEqual([expect.objectContaining({ line: 1, endLine: 7, method: 'post', fields: [
      { tag: 'input', id: 'user', name: 'username', label: 'Username' },
      { tag: 'select', name: 'role', label: 'Role' },
      { tag: 'button', type: 'submit', label: 'Log in' },
    ] })]);
  });

  it('requires an absolute folder', async () => {
    await expect(buildRepoDigest('relative/path')).rejects.toThrow(/absolute/);
  });
});
