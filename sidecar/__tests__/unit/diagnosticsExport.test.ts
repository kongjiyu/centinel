import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectEnvironmentSecrets, redactDiagnosticText } from '../../src/diagnostics/redaction.js';
import { buildDiagnosticsArchive, readLogTail } from '../../src/diagnostics/export.js';
import { clearDiagnosticErrors, recentDiagnosticErrors, recordDiagnosticError, routeTemplate } from '../../src/diagnostics/errorLog.js';
import { createZip, readZip } from '../../src/diagnostics/zip.js';

// Fixture credentials are assembled at runtime so this file does not itself look like a leaked secret.
const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiJ1c2VyLTEyMyIsImV4cCI6MTk5OTk5OTk5OX0', 'c2lnbmF0dXJlLWZpeHR1cmUtdmFsdWU'].join('.');
const openAiKey = 'sk-' + 'proj-' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
const githubToken = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123';
const voyageKey = 'pa-' + 'fixturevoyagekey0123456789abcdef';

const roots: string[] = [];
afterEach(() => {
  clearDiagnosticErrors();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function home(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-diagnostics-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'logs'));
  return root;
}

describe('diagnostics redaction', () => {
  it('removes bearer tokens, JWTs and provider key formats', () => {
    const text = redactDiagnosticText([
      `Authorization: Bearer ${jwt}`,
      `session ${jwt} refreshed`,
      `openai ${openAiKey} github ${githubToken} voyage ${voyageKey}`,
      'aws AKIAABCDEFGHIJKLMNOP',
    ].join('\n'), [], '/nonexistent-home');
    for (const secret of [jwt, openAiKey, githubToken, voyageKey, 'AKIAABCDEFGHIJKLMNOP']) expect(text).not.toContain(secret);
    expect(text).toContain('Authorization: [REDACTED]');
    expect(text).toContain('[REDACTED JWT]');
  });

  it('removes key=value secrets in plain, quoted and JSON forms', () => {
    const text = redactDiagnosticText([
      'api_key=plain-value-123',
      'client_secret: "quoted value 456"',
      '{"apiKey":"json-value-789","accessToken":"json-token-000"}',
      'password=hunter22&next=1',
    ].join('\n'), [], '/nonexistent-home');
    for (const secret of ['plain-value-123', 'quoted value 456', 'json-value-789', 'json-token-000', 'hunter22']) expect(text).not.toContain(secret);
  });

  it('removes e-mail addresses, URL credentials and query strings but keeps the host and path', () => {
    const text = redactDiagnosticText('fetch https://user:pa55word@db.example.com/rest/v1/items?apikey=abc123#frag failed for person@example.org.', [], '/nonexistent-home');
    expect(text).not.toContain('pa55word');
    expect(text).not.toContain('user:');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('person@example.org');
    expect(text).toContain('https://[REDACTED]@db.example.com/rest/v1/items?[REDACTED]');
    expect(redactDiagnosticText('token Bearer abc.def-123', [], '/nonexistent-home')).toBe('token Bearer [REDACTED]');
    expect(text).toContain('[REDACTED EMAIL]');
  });

  it('removes every .env value, sensitive process variables and their encoded forms', () => {
    const root = home();
    fs.writeFileSync(path.join(root, '.env'), 'SUPABASE_URL=https://project.supabase.co\nCENTINEL_TOKEN_ENCRYPTION_KEY=local-vault-key-0011\nSOME_SETTING=unusual setting value\nSHORT=abc\n');
    const secrets = collectEnvironmentSecrets({ envFiles: [path.join(root, '.env')], env: { GITHUB_REPO_CLIENT_SECRET: 'oauth secret/with+chars', HOME_LABEL: 'not-a-secret-name' } });
    expect(secrets).toEqual(expect.arrayContaining(['local-vault-key-0011', 'unusual setting value', 'oauth secret/with+chars']));
    expect(secrets).not.toContain('abc');
    expect(secrets).not.toContain('not-a-secret-name');
    const text = redactDiagnosticText(`key local-vault-key-0011 / unusual setting value / ${encodeURIComponent('oauth secret/with+chars')}`, secrets, '/nonexistent-home');
    expect(text).not.toContain('local-vault-key-0011');
    expect(text).not.toContain('unusual setting value');
    expect(text).not.toContain(encodeURIComponent('oauth secret/with+chars'));
  });

  it('replaces the home directory, which contains the macOS account name', () => {
    expect(redactDiagnosticText('open /Users/alex/Library/Application Support/com.centinel.app/data', [], '/Users/alex')).toBe('open ~/Library/Application Support/com.centinel.app/data');
  });

  it('leaves ordinary diagnostic text readable', () => {
    const line = '[server] Centinel sidecar listening on 127.0.0.1:37701 (review_provider_paused, 3 tokens used)';
    expect(redactDiagnosticText(line, [], '/nonexistent-home')).toBe(line);
  });
});

describe('diagnostics error codes', () => {
  it('keeps only allowlisted codes and identifier-free route shapes', () => {
    recordDiagnosticError({ status: 403, code: 'project_access_denied', method: 'GET', pathname: '/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/findings' });
    recordDiagnosticError({ status: 500, code: 'Includes a message with person@example.org', method: 'POST', pathname: '/projects/My%20Project/x' });
    const records = recentDiagnosticErrors();
    expect(records[0]).toMatchObject({ status: 403, code: 'project_access_denied', method: 'GET', route: '/projects/:id/findings' });
    expect(records[1]).toMatchObject({ status: 500, code: 'internal_error', route: '/projects/:value/x' });
    expect(JSON.stringify(records)).not.toContain('example.org');
    expect(routeTemplate('/settings/ai/embedding/test')).toBe('/settings/ai/embedding/test');
  });
});

describe('diagnostics archive', () => {
  it('round-trips through the ZIP writer', () => {
    const files = readZip(createZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.json', data: '{"ok":true}' }]));
    expect(files.get('a.txt')).toBe('hello');
    expect(files.get('dir/b.json')).toBe('{"ok":true}');
    expect(() => createZip([{ name: '../escape.txt', data: 'x' }])).toThrow('Unsafe');
  });

  it('keeps only the last 2,000 log lines', () => {
    const root = home();
    const file = path.join(root, 'logs', 'sidecar.log');
    fs.writeFileSync(file, Array.from({ length: 2500 }, (_, index) => `line ${index}`).join('\n') + '\n');
    const tail = readLogTail(file);
    expect(tail.lines).toHaveLength(2000);
    expect(tail.lines[0]).toBe('line 500');
    expect(tail.lines.at(-1)).toBe('line 2499');
    expect(readLogTail(path.join(root, 'missing.log'))).toEqual({ lines: [], available: false });
  });

  it('bundles a redacted log, versions and error codes without secrets', () => {
    const root = home();
    fs.writeFileSync(path.join(root, '.env'), 'CENTINEL_TOKEN_ENCRYPTION_KEY=vault-key-from-env-file\n');
    fs.writeFileSync(path.join(root, 'logs', 'sidecar.log'), [
      '[server] Centinel sidecar listening on 127.0.0.1:37701',
      `[auth] rejected Authorization: Bearer ${jwt}`,
      '[config] loaded vault-key-from-env-file for person@example.org',
      `[review] ${'x'.repeat(5000)}`,
    ].join('\n'));
    const { fileName, archive } = buildDiagnosticsArchive({
      home: root, env: { CENTINEL_PACKAGED: '1' }, appVersion: '0.2.0', accessToken: 'caller-access-token-1234',
      now: new Date('2026-11-05T12:34:56Z'), errors: [{ at: '2026-11-05T12:00:00.000Z', status: 401, code: 'unauthenticated', method: 'GET', route: '/projects' }],
    });
    expect(fileName).toBe('centinel-diagnostics-20261105-123456.zip');
    const files = readZip(archive);
    expect([...files.keys()].sort()).toEqual(['README.txt', 'errors.json', 'sidecar.log', 'system.json']);
    const log = files.get('sidecar.log')!;
    expect(log).toContain('listening on 127.0.0.1:37701');
    expect(log).toContain('[line truncated]');
    for (const value of [jwt, 'vault-key-from-env-file', 'person@example.org', 'x'.repeat(1001)]) expect(log).not.toContain(value);
    const system = JSON.parse(files.get('system.json')!);
    expect(system).toMatchObject({ appVersion: '0.2.0', packaged: true, architecture: os.arch(), platform: process.platform, logFileFound: true, logLinesIncluded: 4 });
    expect(typeof system.sidecarVersion).toBe('string');
    expect(JSON.parse(files.get('errors.json')!)).toEqual([expect.objectContaining({ code: 'unauthenticated', status: 401 })]);
    expect(archive.toString('latin1')).not.toContain('caller-access-token-1234');
  });

  it('rejects an unexpected app version string instead of copying it', () => {
    const root = home();
    const files = readZip(buildDiagnosticsArchive({ home: root, env: {}, appVersion: 'person@example.org' }).archive);
    expect(JSON.parse(files.get('system.json')!).appVersion).toBeNull();
    expect(files.get('sidecar.log')).toContain('No sidecar log file was found');
  });
});
