import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TokenUsage } from '../aiClient.js';
import { ModelProviderError } from '../review/retry.js';

type ObjectValue = Record<string, any>;
export type CodexStatus = { available: boolean; connected: boolean; accountLabel: string | null; message: string };
export type CodexModel = { id: string; label: string; supportsImages: boolean; isDefault: boolean };
export type CodexGeneration = { text: string; usage?: TokenUsage; model: string };
export type CodexRequest = { model: string; prompt: string; systemPrompt: string; imagePaths?: string[]; signal?: AbortSignal; outputSchema?: Record<string, unknown> };
export interface CodexBackend {
  status(): Promise<CodexStatus>;
  login(): Promise<{ loginId: string; authUrl: string }>;
  cancelLogin(loginId: string): Promise<void>;
  logout(): Promise<void>;
  models(): Promise<CodexModel[]>;
  generate(request: CodexRequest): Promise<CodexGeneration>;
  close(): void;
}

export const CODEX_ARGS = ['app-server', '--listen', 'stdio://', '--disable', 'shell_tool', '--disable', 'unified_exec', '-c', 'web_search="disabled"', '-c', 'tools.view_image=false', '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"'];
const abortError = () => new DOMException('The operation was aborted', 'AbortError');
const failure = (message: string, code = 'codex_unavailable') => new ModelProviderError(message, { code, retryable: false });

/** One local Codex home per verified Centinel user. Never reads the desktop
 * assistant's ~/.codex credentials, config, tools, history, or API-key env. */
export class CodexAppServer implements CodexBackend {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(method: string, params: ObjectValue) => void>();
  private nextId = 0;
  private buffer = '';
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer?: ReturnType<typeof setTimeout>;
  private active = 0;
  readonly workspace: string;

  constructor(readonly home: string, private readonly launch: typeof spawn = spawn, private readonly timeoutMs = 120_000) {
    this.workspace = path.join(home, 'workspace');
  }

  private touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.active) this.close(); else this.touch(); }, 10 * 60_000);
    this.idleTimer.unref();
  }

  private async ready() {
    this.touch();
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.start();
    try { await this.starting; } finally { this.starting = null; }
  }

  private async start() {
    fs.mkdirSync(this.workspace, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.home, 0o700);
    // Pass only the OS environment needed to start Codex. Repository .env and
    // parent API credentials must not accidentally change authentication mode.
    const env: NodeJS.ProcessEnv = { CODEX_HOME: this.home };
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const child = this.launch(process.env.CENTINEL_CODEX_BIN || 'codex', CODEX_ARGS, { cwd: this.workspace, env, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (this.buffer.length > 8 * 1024 * 1024) { this.close(); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        try { this.receive(JSON.parse(line)); } catch { /* Ignore non-protocol output. */ }
      }
    });
    // Drain diagnostic output without persisting potentially sensitive content.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => { if (this.child === child) this.close(); });
    child.on('error', () => { if (this.child === child) this.close(failure('Codex CLI could not start. Install Codex CLI or configure CENTINEL_CODEX_BIN.', 'codex_not_installed')); });
    child.on('exit', () => { if (this.child === child) this.close(); });
    await this.rpc('initialize', { clientInfo: { name: 'centinel', title: 'Centinel', version: '0.1.0' } });
    this.send({ method: 'initialized', params: {} });
  }

  private send(message: ObjectValue) {
    if (!this.child) throw failure('Codex connection is closed. Reconnect and try again.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(message: ObjectValue) {
    if (message.id !== undefined && message.method) {
      // This adapter is an inference provider, not an execution/approval host.
      this.send({ id: message.id, error: { code: -32601, message: 'Centinel does not permit Codex to execute tools.' } });
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      // Do not surface raw upstream errors which may echo private requests.
      if (message.error) pending.reject(failure('Codex rejected the request. Check sign-in, model access, and CLI compatibility.', 'codex_request_failed'));
      else pending.resolve(message.result);
    } else if (typeof message.method === 'string') {
      for (const listener of this.listeners) listener(message.method, message.params ?? {});
    }
  }

  private rpc(method: string, params: ObjectValue): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.close(failure('Codex request timed out. Reconnect and try again.', 'codex_timeout')), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async status(): Promise<CodexStatus> {
    try {
      await this.ready();
      const result = await this.rpc('account/read', { refreshToken: false });
      const connected = result.account?.type === 'chatgpt';
      return { available: true, connected, accountLabel: connected ? result.account.email ?? null : null,
        message: connected ? 'Codex is connected on this device.' : 'Sign in to Codex with ChatGPT on this device.' };
    } catch (error) {
      return { available: false, connected: false, accountLabel: null, message: error instanceof Error ? error.message : 'Codex is unavailable.' };
    }
  }

  async login(): Promise<{ loginId: string; authUrl: string }> {
    await this.ready();
    const result = await this.rpc('account/login/start', { type: 'chatgpt' });
    if (typeof result.loginId !== 'string' || typeof result.authUrl !== 'string') throw failure('Codex did not return a browser sign-in link.', 'codex_invalid_response');
    const url = new URL(result.authUrl);
    if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth.chatgpt.com'].includes(url.hostname)) throw failure('Codex returned an unsupported sign-in address.', 'codex_invalid_response');
    return { loginId: result.loginId, authUrl: result.authUrl };
  }

  async cancelLogin(loginId: string) { await this.ready(); await this.rpc('account/login/cancel', { loginId }); }
  async logout() { await this.ready(); await this.rpc('account/logout', {}); this.close(); }

  async models(): Promise<CodexModel[]> {
    await this.ready();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await this.rpc('model/list', { limit: 100, includeHidden: false, cursor });
      for (const model of result.data ?? []) {
        if (typeof model.model !== 'string' || model.hidden) continue;
        models.push({ id: model.model, label: model.displayName ?? model.model,
          supportsImages: !model.inputModalities || model.inputModalities.includes('image'), isDefault: model.isDefault === true });
      }
      cursor = result.nextCursor;
      if (!cursor) return models;
    }
    throw failure('Codex model catalog could not be read completely.', 'codex_invalid_response');
  }

  generate(request: CodexRequest): Promise<CodexGeneration> {
    const pending = this.queue.then(() => this.run(request));
    this.queue = pending.catch(() => {});
    const signal = request.signal;
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const abort = () => reject(abortError());
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  private async run(request: CodexRequest): Promise<CodexGeneration> {
    if (request.signal?.aborted) throw abortError();
    this.active++;
    const abort = () => this.close(abortError());
    request.signal?.addEventListener('abort', abort, { once: true });
    let dispose: (() => void) | undefined;
    try {
      const status = await this.status();
      if (request.signal?.aborted) throw abortError();
      if (!status.connected) throw failure(status.message, status.available ? 'codex_not_connected' : 'codex_unavailable');
      const model = (await this.models()).find(item => item.id === request.model);
      if (request.signal?.aborted) throw abortError();
      if (!model) throw failure('The selected Codex model is unavailable. Refresh models in Settings.', 'codex_model_unavailable');
      if (request.imagePaths?.length && !model.supportsImages) throw failure('This Codex model does not support screenshots.', 'codex_vision_unsupported');
      const thread = await this.rpc('thread/start', { model: request.model, cwd: this.workspace, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
        baseInstructions: 'You are a model provider for Centinel. Analyze only the supplied content. Never use tools, read files, run commands, or change data. Return only the requested JSON.',
        developerInstructions: request.systemPrompt,
      });
      if (request.signal?.aborted) throw abortError();
      const threadId = thread.thread?.id;
      if (typeof threadId !== 'string') throw failure('Codex returned an invalid thread.', 'codex_invalid_response');
      let usage: TokenUsage | undefined;
      const messages = new Map<string, string>();
      let finished: ((value: CodexGeneration) => void) | undefined;
      let failed: ((error: Error) => void) | undefined;
      const done = new Promise<CodexGeneration>((resolve, reject) => { finished = resolve; failed = reject; });
      // Attach a handler immediately: process/abort events may precede turn/start's response.
      void done.catch(() => {});
      const listener = (method: string, params: ObjectValue) => {
        if (params.threadId !== threadId) return;
        if (method === 'thread/tokenUsage/updated' && params.tokenUsage?.last) {
          const last = params.tokenUsage.last;
          if (Number.isFinite(last.inputTokens) && Number.isFinite(last.outputTokens)) usage = {
            inputTokens: last.inputTokens, outputTokens: last.outputTokens,
            cacheReadTokens: last.cachedInputTokens ?? 0, totalTokens: last.totalTokens,
          };
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') {
          messages.set(params.item.id, params.item.text ?? '');
        }
        if (method === 'turn/completed') {
          if (params.turn?.status !== 'completed') failed?.(failure('Codex could not complete this operation. Check model access and account usage limits.', 'codex_turn_failed'));
          else {
            const text = [...messages.values()].join('\n').trim();
            if (!text) failed?.(failure('Codex returned an empty response.', 'codex_invalid_response'));
            else finished?.({ text, usage, model: request.model });
          }
        }
      };
      this.listeners.add(listener);
      const closed = (method: string, params: ObjectValue) => { if (method === '__closed') failed?.(params.error); };
      this.listeners.add(closed);
      const timer = setTimeout(() => this.close(failure('Codex generation exceeded its time limit.', 'codex_timeout')), this.timeoutMs);
      dispose = () => { clearTimeout(timer); this.listeners.delete(listener); this.listeners.delete(closed); };
      const input: ObjectValue[] = [{ type: 'text', text: request.prompt }];
      for (const imagePath of request.imagePaths ?? []) {
        const file = path.resolve(imagePath);
        if (!fs.statSync(file).isFile()) throw failure('A screenshot could not be read.', 'codex_image_unavailable');
        input.push({ type: 'localImage', path: file });
      }
      await this.rpc('turn/start', { threadId, input, ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}) });
      return await done;
    } finally {
      dispose?.(); request.signal?.removeEventListener('abort', abort); this.active--; this.touch();
    }
  }

  close(error: Error = failure('Codex connection ended. Reconnect and try again.')) {
    const child = this.child; this.child = null;
    clearTimeout(this.idleTimer);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener('__closed', { error });
    if (child) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000); kill.unref();
    }
  }
}

const clients = new Map<string, CodexBackend>();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/codex');
export function getCodexBackend(ownerId: string): CodexBackend {
  if (!ownerId.trim()) throw failure('A verified Centinel user is required.', 'codex_identity_required');
  let client = clients.get(ownerId);
  if (!client) {
    if (clients.size >= 32) throw failure('Too many local Codex accounts are open. Restart Centinel.', 'codex_capacity');
    // Hashing prevents path traversal; authorization still comes from AuthGateway.
    client = new CodexAppServer(path.join(root, createHash('sha256').update(ownerId).digest('hex')));
    clients.set(ownerId, client);
  }
  return client;
}
export function closeCodexBackends() { for (const client of clients.values()) client.close(); clients.clear(); }
