import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { spawn } from 'node:child_process';
import { CodexAppServer } from '../../src/model/codex.js';
import { testCodexProvider } from '../../src/model/codexTest.js';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.unstubAllEnvs(); });
function fixture(options: { hold?: boolean; error?: boolean; images?: boolean; account?: string; hang?: boolean } = {}) {
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
      if (message.method === 'thread/start') result = { thread: { id: 'thread-1' } };
      if (message.method === 'turn/start' && !options.hold) {
        send({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'comment', type: 'agentMessage', phase: 'commentary', text: 'private commentary' } } });
        send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { last: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 3, totalTokens: 12 } } } });
        send({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '{"answer":"ready"}' } } });
        send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { status: 'completed' } } });
      }
      send({ id: message.id, result });
    });
    return child;
  });
  const client = new CodexAppServer(home, launch as unknown as typeof spawn, options.hang ? 20 : 2000);
  cleanup.push(() => { client.close(); fs.rmSync(home, { recursive: true, force: true }); });
  return { client, launch, calls, children, home };
}
const input = { model: 'model-1', prompt: 'Return JSON', systemPrompt: 'Analyze supplied content.' };

describe('isolated Codex app-server transport', () => {
  it('initializes once, scopes credentials, and excludes inherited provider secrets', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'secret'); vi.stubEnv('GEMINI_API_KEY', 'secret');
    const { client, launch, home, calls } = fixture();
    expect(await client.status()).toMatchObject({ available: true, connected: true });
    await client.status();
    expect(launch).toHaveBeenCalledTimes(1);
    const env = launch.mock.calls[0][2].env;
    expect(env.CODEX_HOME).toBe(home); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(calls.filter(call => call.method === 'initialize')).toHaveLength(1);
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
  });
  it('does not mistake API authentication for ChatGPT sign-in', async () => {
    expect(await fixture({ account: 'apiKey' }).client.status()).toMatchObject({ connected: false, accountLabel: null });
  });
  it('handles chunked and early completion notifications, ignores commentary, and reports actual usage', async () => {
    const { client, calls } = fixture();
    expect(await client.generate(input)).toMatchObject({ text: '{"answer":"ready"}', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 } });
    expect(calls.find(call => call.method === 'thread/start').params).toMatchObject({ ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never' });
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
    await client.status(); expect(launch).toHaveBeenCalledTimes(2);
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
