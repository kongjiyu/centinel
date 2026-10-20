import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { spawn } from 'node:child_process';
import { CodexAppServer, type ExternalChatgptTokens } from '../../src/model/codex.js';
import { localCodexTokenSource } from '../../src/model/localCodexAuth.js';
import { testCodexProvider } from '../../src/model/codexTest.js';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.unstubAllEnvs(); });

function privateDirectoryEnvironment(directory: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
    windir: process.env.windir,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    CENTINEL_CODEX_PRIVATE_HOME: directory,
  };
}

function readWindowsAcl(target: string): {
  currentUserSid: string;
  ownerSid: string;
  protected: boolean;
  rules: Array<{ sid: string; type: string; rights: string; inherited: boolean }>;
} {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('CENTINEL_CODEX_PRIVATE_HOME')
$acl = Get-Acl -LiteralPath $path -ErrorAction Stop
$rules = @($acl.Access | ForEach-Object {
  $sid = $_.IdentityReference
  if ($sid -isnot [System.Security.Principal.SecurityIdentifier]) {
    $sid = $sid.Translate([System.Security.Principal.SecurityIdentifier])
  }
  [PSCustomObject]@{
    sid = $sid.Value
    type = $_.AccessControlType.ToString()
    rights = $_.FileSystemRights.ToString()
    inherited = $_.IsInherited
  }
})
[PSCustomObject]@{
  currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  protected = $acl.AreAccessRulesProtected
  rules = $rules
} | ConvertTo-Json -Depth 4 -Compress
`;
  const output = execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    env: privateDirectoryEnvironment(target),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 10_000,
  }).trim();
  return JSON.parse(output) as ReturnType<typeof readWindowsAcl>;
}

function expectPrivateWindowsAcl(target: string): void {
  const acl = readWindowsAcl(target);
  expect(acl.protected).toBe(true);
  expect(acl.ownerSid).toBe(acl.currentUserSid);
  expect(acl.rules).toHaveLength(2);
  expect(acl.rules.map(rule => rule.sid).sort()).toEqual([acl.currentUserSid, 'S-1-5-18'].sort());
  expect(acl.rules.every(rule => rule.type === 'Allow' && rule.rights === 'FullControl' && !rule.inherited)).toBe(true);
}

function fixture(options: { hold?: boolean; error?: boolean; images?: boolean; account?: string; hang?: boolean; external?: () => ExternalChatgptTokens; turnError?: Record<string, unknown>; earlyError?: Record<string, unknown> } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-codex-unit-'));
  const calls: any[] = [];
  const children: any[] = [];
  const launch = vi.fn((..._args: any[]) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill: vi.fn(() => true) });
    children.push(child);
    const send = (message: any) => { const line = JSON.stringify(message) + '\n'; child.stdout.write(line.slice(0, 5)); child.stdout.write(line.slice(5)); };
    child.stdin.on('data', bytes => {
      const message = JSON.parse(bytes.toString()); calls.push(message);
      if (!message.method || message.id === undefined || options.hang) return;
      if (options.error && message.method !== 'initialize') { send({ id: message.id, error: { message: 'private-secret-prompt' } }); return; }
      let result: any = {};
      if (message.method === 'account/read') result = { account: { type: options.account ?? 'chatgpt', email: 'tester@example.test' } };
      if (message.method === 'account/login/start') result = { loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=test' };
      if (message.method === 'model/list') result = { data: [{ model: 'model-1', displayName: 'Model One', inputModalities: options.images === false ? ['text'] : ['text', 'image'], isDefault: true }], nextCursor: null };
      if (message.method === 'account/rateLimits/read') result = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 123 }, credits: { hasCredits: false, balance: '0', private: 'never-export' }, rateLimitReachedType: null, accountId: 'never-export' } } };
      if (message.method === 'thread/start') result = { thread: { id: 'thread-1' } };
      if (message.method === 'turn/start' && !options.hold) {
        if (options.earlyError) {
          send({ method: 'error', params: { threadId: 'thread-1', willRetry: true, error: options.earlyError } });
          return;
        }
        if (!options.turnError) {
          send({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'comment', type: 'agentMessage', phase: 'commentary', text: 'private commentary' } } });
          send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { last: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 3, totalTokens: 12 } } } });
          send({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '{"answer":"ready"}' } } });
        }
        send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: options.turnError ? 'failed' : 'completed', ...(options.turnError ? { error: options.turnError } : {}) } } });
      }
      send({ id: message.id, result });
    });
    return child;
  });
  const client = new CodexAppServer(home, launch as unknown as typeof spawn, options.hang ? 20 : 2000, options.external);
  cleanup.push(() => { client.close(); fs.rmSync(home, { recursive: true, force: true }); });
  return { client, launch, calls, children, home };
}
const input = { model: 'model-1', prompt: 'Return JSON', systemPrompt: 'Analyze supplied content.' };

describe('isolated Codex app-server transport', () => {
  it('reads only safe capacity fields without inference or treating zero credits as exhausted included usage', async () => {
    const { client, calls } = fixture();
    expect(await client.capacity()).toEqual([{ primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 123 }, secondary: null, hasCredits: false, limitReached: false }]);
    expect(calls.some(call => call.method === 'turn/start')).toBe(false);
  });
  it('stops a CLI-internal capacity retry on its first error notification', async () => {
    const { client, children, calls } = fixture({ earlyError: { message: 'private body', codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 429 } } } });
    await expect(client.generate(input)).rejects.toMatchObject({ code: 'rate_limited', retryable: false });
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  });
  it('recognizes structured exhausted usage separately from a generic rate limit', async () => {
    const { client } = fixture({ turnError: { message: 'private body', codexErrorInfo: 'usageLimitExceeded' } });
    await expect(client.generate(input)).rejects.toMatchObject({ code: 'quota_exhausted', retryable: false });
  });
  it('initializes once, scopes credentials, and excludes inherited provider secrets', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'secret'); vi.stubEnv('GEMINI_API_KEY', 'secret');
    const { client, launch, home, calls } = fixture();
    const authFile = path.join(home, 'auth.json');
    fs.writeFileSync(authFile, '{"fixture":"credential"}');
    expect(await client.status()).toMatchObject({ available: true, connected: true });
    await client.status();
    expect(launch).toHaveBeenCalledTimes(1);
    const env = launch.mock.calls[0][2].env;
    expect(env.CODEX_HOME).toBe(home); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(calls.filter(call => call.method === 'initialize')).toHaveLength(1);
    if (process.platform === 'win32') {
      expectPrivateWindowsAcl(home);
      expectPrivateWindowsAcl(authFile);
    } else {
      expect(fs.statSync(home).mode & 0o777).toBe(0o700);
      expect(fs.statSync(authFile).mode & 0o777).toBe(0o600);
    }
  });
  it('accepts explicitly supplied external OAuth without inheriting desktop config', async () => {
    const external = vi.fn().mockReturnValue({ accessToken: 'fixture-access', chatgptAccountId: 'fixture-account' });
    const { client, calls, launch, home } = fixture({ external });
    expect(await client.status()).toMatchObject({ connected: true });
    expect(calls.find(call => call.method === 'initialize').params.capabilities.experimentalApi).toBe(true);
    expect(calls.find(call => call.method === 'account/login/start').params).toEqual({ type: 'chatgptAuthTokens', accessToken: 'fixture-access', chatgptAccountId: 'fixture-account' });
    expect(launch.mock.calls[0][2].env.CODEX_HOME).toBe(home);
    await client.logout();
    expect(calls.some(call => call.method === 'account/logout')).toBe(false);
  });
  it('binds desktop access-token reads to one explicit verified owner and rejects account swaps', () => {
    const { home } = fixture();
    const file = path.join(home, 'desktop-auth.json');
    fs.writeFileSync(file, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-access', refresh_token: 'never-copy', account_id: 'account-one' } }));
    vi.stubEnv('CENTINEL_CODEX_LOCAL_AUTH_FILE', file);
    expect(localCodexTokenSource('owner')).toBeUndefined();
    vi.stubEnv('CENTINEL_CODEX_LOCAL_AUTH_OWNER_ID', 'owner');
    expect(localCodexTokenSource('other')).toBeUndefined();
    const source = localCodexTokenSource('owner')!;
    expect(source()).toEqual({ accessToken: 'fixture-access', chatgptAccountId: 'account-one' });
    fs.writeFileSync(file, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'changed', account_id: 'account-two' } }));
    expect(() => source()).toThrow('account changed');
  });
  it('does not mistake API authentication for ChatGPT sign-in', async () => {
    expect(await fixture({ account: 'apiKey' }).client.status()).toMatchObject({ connected: false, accountLabel: null });
  });
  it('handles chunked and early completion notifications, ignores commentary, and reports actual usage', async () => {
    const { client, calls } = fixture();
    expect(await client.generate(input)).toMatchObject({ text: '{"answer":"ready"}', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 } });
    expect(calls.find(call => call.method === 'thread/start').params).toMatchObject({ ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never' });
  });
  it('classifies only structured 429 retry metadata and never surfaces upstream turn text', async () => {
    const { client } = fixture({ turnError: {
      message: 'private-secret-prompt',
      additionalDetails: 'private-upstream-details',
      codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } },
    } });
    const error = await client.generate(input).then(() => null, value => value);
    expect(error).toMatchObject({ code: 'rate_limited', statusCode: 429, retryable: false });
    expect((error as Error).message).toContain('Paused:');
    expect((error as Error).message).not.toContain('private-secret-prompt');
    expect((error as Error).message).not.toContain('private-upstream-details');
  });
  it.each([
    { codexErrorInfo: { badRequest: { httpStatusCode: 429 } } },
    { codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: '429' } } },
    { codexErrorInfo: 'responseTooManyFailedAttempts' },
  ])('keeps unknown or malformed turn errors generic', async turnError => {
    const { client } = fixture({ turnError: { message: 'private-secret-prompt', ...turnError } });
    const error = await client.generate(input).then(() => null, value => value);
    expect(error).toMatchObject({ code: 'codex_turn_failed', retryable: false });
    expect((error as Error).message).not.toContain('private-secret-prompt');
    expect((error as { statusCode?: number }).statusCode).toBeUndefined();
  });
  it('rejects models without screenshots before starting a turn', async () => {
    const { client, calls } = fixture({ images: false });
    await expect(client.generate({ ...input, imagePaths: ['/tmp/missing.png'] })).rejects.toMatchObject({ code: 'codex_vision_unsupported' });
    expect(calls.some(call => call.method === 'turn/start')).toBe(false);
  });
  it('cancels an active turn, skips queued cancelled work, and reconnects on next status', async () => {
    const { client, calls, children, launch } = fixture({ hold: true });
    const controller = new AbortController();
    const pending = client.generate({ ...input, signal: controller.signal });
    await vi.waitFor(() => expect(calls.some(call => call.method === 'turn/start')).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    await expect(client.generate({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const reconnectStatus = await client.status();
    expect(reconnectStatus.message).toBe('Codex is connected on this device.');
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it('cancels queued work immediately without interrupting another active operation', async () => {
    const { client, calls } = fixture({ hold: true });
    const firstController = new AbortController();
    const first = client.generate({ ...input, signal: firstController.signal });
    await vi.waitFor(() => expect(calls.some(call => call.method === 'turn/start')).toBe(true));
    const secondController = new AbortController();
    const second = client.generate({ ...input, signal: secondController.signal });
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
    firstController.abort(); await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out a stalled handshake and hides raw upstream errors', async () => {
    const unavailable = await fixture({ hang: true }).client.status();
    expect(unavailable).toMatchObject({ available: false }); expect(unavailable.message).toContain('timed out');
    const rejected = await fixture({ error: true }).client.status();
    expect(rejected.message).not.toContain('private-secret');
  });
  it('rejects server tool requests', async () => {
    const { client, children, calls } = fixture(); await client.status();
    children[0].stdout.write(JSON.stringify({ id: 999, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
    expect(calls.find(call => call.id === 999)).toMatchObject({ error: { code: -32601 } });
  });
  it('uses only browser ChatGPT login and clears the local process on logout', async () => {
    const { client, calls, children } = fixture();
    expect(await client.login()).toMatchObject({ loginId: 'login-1' });
    await client.cancelLogin('login-1'); await client.logout();
    expect(calls.find(call => call.method === 'account/login/start').params).toEqual({ type: 'chatgpt' });
    expect(calls.find(call => call.method === 'account/login/cancel').params).toEqual({ loginId: 'login-1' });
    expect(children[0].kill).toHaveBeenCalled();
  });
  it('does not pass a screenshot test on a text-only response', async () => {
    const { client } = fixture();
    expect(await testCodexProvider(client, 'model-1', true)).toMatchObject({ status: 'fail' });
  });
});
