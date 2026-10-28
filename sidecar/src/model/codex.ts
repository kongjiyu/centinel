import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TokenUsage, TokenUsageObservation, UsageCounter } from '../aiClient.js';
import { localCodexTokenSource } from './localCodexAuth.js';
import { securePrivateDirectory } from './privateDirectory.js';
import { ModelProviderError } from '../review/retry.js';
import { providerPause } from '../review/providerPause.js';
import { AccountModelCatalogError, readAccountModelCatalog } from './accountModelCatalog.js';

type ObjectValue = Record<string, any>;
export type ExternalChatgptTokens = { accessToken: string; chatgptAccountId: string; chatgptPlanType?: string | null };
export type CodexStatus = { available: boolean; connected: boolean; accountLabel: string | null; message: string };
export type CodexModel = { id: string; label: string; supportsImages: boolean; isDefault: boolean; imageSupportKnown?: boolean; catalogSource?: 'account' | 'codex'; catalogWarning?: 'account_catalog_unavailable' };
export type CodexGeneration = { text: string; usage?: TokenUsage; model: string };
export type CodexRequest = { model: string; prompt: string; systemPrompt: string; imagePaths?: string[]; signal?: AbortSignal; outputSchema?: Record<string, unknown> };
export interface CodexBackend {
  status(): Promise<CodexStatus>;
  login(): Promise<{ loginId: string; authUrl: string }>;
  cancelLogin(loginId: string): Promise<void>;
  logout(): Promise<void>;
  models(refresh?: boolean): Promise<CodexModel[]>;
  generate(request: CodexRequest): Promise<CodexGeneration>;
  close(): void;
}

export const CODEX_ARGS = ['app-server', '--listen', 'stdio://', '--disable', 'shell_tool', '--disable', 'unified_exec', '-c', 'web_search="disabled"', '-c', 'tools.view_image=false', '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"'];
const abortError = () => new DOMException('The operation was aborted', 'AbortError');
const failure = (message: string, code = 'codex_unavailable') => new ModelProviderError(message, { code, retryable: false });

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function codexUsage(value: unknown, source: 'codex_thread_total' | 'codex_turn_last'): TokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as ObjectValue;
  const inputTokens = count(usage.inputTokens);
  const outputTokens = count(usage.outputTokens);
  const cacheReadTokens = count(usage.cachedInputTokens);
  const cacheCreationTokens = count(usage.cacheCreationTokens);
  const reportedTotal = count(usage.totalTokens);
  const totalTokens = reportedTotal ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  const fields: Array<[UsageCounter, unknown]> = [
    ['inputTokens', usage.inputTokens], ['outputTokens', usage.outputTokens],
    ['cacheReadTokens', usage.cachedInputTokens], ['cacheCreationTokens', usage.cacheCreationTokens], ['totalTokens', usage.totalTokens],
  ];
  const missingCounters = fields.filter(([, raw]) => count(raw) === undefined).map(([name]) => name);
  const usageObservation: TokenUsageObservation = {
    source,
    completeness: missingCounters.length ? 'partial' : 'complete',
    ...(missingCounters.length ? { missingCounters } : {}),
  };
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens, totalTokensSource: reportedTotal === undefined ? 'adapter_derived' as const : 'provider_reported' as const }),
    ...(reportedTotal === undefined ? {} : { providerReportedTotalTokens: reportedTotal }),
    usageObservation,
  };
}

function withCodexUsage(error: unknown, usage: TokenUsage | undefined, observedResponse = false): Error {
  const existingResponse = error !== null && typeof error === 'object'
    && (error as { responseReceived?: unknown }).responseReceived === true;
  const responseReceived = Boolean(usage) || observedResponse || existingResponse;
  const observation = usage?.usageObservation;
  if (error instanceof ModelProviderError) return new ModelProviderError(error.message, {
    code: error.code, statusCode: error.statusCode, retryAfterMs: error.retryAfterMs, retryable: error.retryable,
    malformed: error.malformed, usage: usage ?? error.usage, usageObservation: observation ?? error.usageObservation,
    responseReceived,
  });
  const wrapped = error instanceof Error ? error : new Error('Codex generation failed.');
  try {
    Object.assign(wrapped, { usage, usageObservation: observation, responseReceived });
    return wrapped;
  } catch {
    return new ModelProviderError(wrapped.message, { code: wrapped.name === 'AbortError' ? 'cancelled' : 'codex_turn_failed',
      retryable: false, usage, usageObservation: observation, responseReceived });
  }
}

export function codexGenerationTimeoutMs(): number {
  const configured = Number(process.env.CENTINEL_CODEX_GENERATION_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured >= 120_000 && configured <= 1_800_000 ? configured : 600_000;
}

function turnFailure(turn: ObjectValue): ModelProviderError {
  const errorInfo = turn.error?.codexErrorInfo;
  const usageLimit = typeof errorInfo === 'string' && errorInfo.toLowerCase() === 'usagelimitexceeded'
    || errorInfo && typeof errorInfo === 'object' && Object.hasOwn(errorInfo, 'usageLimitExceeded');
  if (usageLimit) return new ModelProviderError(providerPause({ code: 'usage_limit_exceeded' })!.message, {
    code: 'quota_exhausted', retryable: false,
  });
  const attemptsError = errorInfo && typeof errorInfo === 'object' && !Array.isArray(errorInfo)
    ? errorInfo.responseTooManyFailedAttempts ?? errorInfo.httpConnectionFailed ?? errorInfo.responseStreamConnectionFailed ?? errorInfo
    : undefined;
  if (attemptsError && typeof attemptsError === 'object' && !Array.isArray(attemptsError)
    && attemptsError.httpStatusCode === 429) {
    return new ModelProviderError(providerPause({ statusCode: 429 })!.message, {
      code: 'rate_limited', statusCode: 429, retryable: false,
    });
  }
  // Retain a bounded structured subtype, never error messages/additionalDetails.
  // A transport/server failure is not proof of exhausted account allowance.
  const known: Record<string, string> = {
    contextwindowexceeded: 'codex_context_window_exceeded', httpconnectionfailed: 'codex_http_connection_failed',
    responsestreamconnectionfailed: 'codex_stream_connection_failed', responsestreamdisconnected: 'codex_stream_disconnected',
    responsetoomanyfailedattempts: 'codex_attempts_exhausted', badrequest: 'codex_bad_request',
    unauthorized: 'codex_unauthorized', sandboxerror: 'codex_sandbox_error', internalservererror: 'codex_internal_error', other: 'codex_other_error',
  };
  let subtype: string | undefined;
  if (typeof errorInfo === 'string') subtype = known[errorInfo.toLowerCase()];
  else if (errorInfo && typeof errorInfo === 'object' && !Array.isArray(errorInfo) && Object.keys(errorInfo).length === 1) {
    const [key] = Object.keys(errorInfo);
    const detail = errorInfo[key!];
    if (detail && typeof detail === 'object' && !Array.isArray(detail)
      && Number.isInteger(detail.httpStatusCode) && detail.httpStatusCode >= 400 && detail.httpStatusCode <= 599
      && detail.httpStatusCode !== 429 && detail.httpStatusCode !== 402) subtype = known[key!.toLowerCase()];
  }
  return failure(subtype ? `Codex reported ${subtype.replace(/^codex_/, '').replace(/_/g, ' ')}. No automatic retry will run.`
    : 'Codex could not complete this operation. Check model access and account usage limits.', subtype ?? 'codex_turn_failed');
}

/** One local Codex home per verified Centinel user. Desktop auth is read only
 * when explicitly configured for that owner; config/tools/history are isolated. */
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
  private desktopAuthDisabled = false;
  private modelCatalog?: {accountId:string; expiresAt:number; models:CodexModel[]};
  readonly workspace: string;

  constructor(readonly home: string, private readonly launch: typeof spawn = spawn, private readonly timeoutMs = 120_000, private readonly externalTokens?: () => ExternalChatgptTokens, private readonly catalogFetch: typeof fetch = fetch, private readonly generationTimeoutMs = timeoutMs) {
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
    securePrivateDirectory(this.home);
    fs.mkdirSync(this.workspace, { recursive: true, mode: 0o700 });
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
    await this.rpc('initialize', { clientInfo: { name: 'centinel', title: 'Centinel', version: '0.1.0' }, ...(this.externalTokens ? { capabilities: { experimentalApi: true } } : {}) });
    this.send({ method: 'initialized', params: {} });
    if (this.externalTokens && !this.desktopAuthDisabled) {
      try { await this.rpc('account/login/start', { type: 'chatgptAuthTokens', ...this.externalTokens() }); }
      catch { this.close(); throw failure('The configured desktop Codex login could not be used. Sign in to desktop Codex and retry.', 'codex_not_connected'); }
    }
  }

  private send(message: ObjectValue) {
    if (!this.child) throw failure('Codex connection is closed. Reconnect and try again.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(message: ObjectValue) {
    if (message.id !== undefined && message.method) {
      if (message.method === 'account/chatgptAuthTokens/refresh' && this.externalTokens && !this.desktopAuthDisabled) {
        try { this.send({ id: message.id, result: this.externalTokens() }); }
        catch { this.send({ id: message.id, error: { code: -32000, message: 'Refresh the desktop Codex login and retry.' } }); }
        return;
      }
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
  async logout() {
    this.desktopAuthDisabled = true;
    if (this.externalTokens) { this.close(); return; }
    await this.ready(); await this.rpc('account/logout', {}); this.close();
  }

  private accountCatalogTokens(): ExternalChatgptTokens | undefined {
    if (this.desktopAuthDisabled) return undefined;
    if (this.externalTokens) return this.externalTokens();
    // Native Codex login belongs to this user's private home. Other owners'
    // profiles and desktop credentials are never searched here.
    try {
      const file = path.join(this.home, 'auth.json');
      if (fs.statSync(file).size > 65_536) return undefined;
      const value = JSON.parse(fs.readFileSync(file,'utf8'));
      if (value.auth_mode!=='chatgpt' || typeof value.tokens?.access_token!=='string' || !value.tokens.access_token
        || typeof value.tokens?.account_id!=='string' || !value.tokens.account_id) return undefined;
      return {accessToken:value.tokens.access_token,chatgptAccountId:value.tokens.account_id};
    } catch { return undefined; }
  }

  async models(refresh = false): Promise<CodexModel[]> {
    await this.ready();
    const tokens = this.accountCatalogTokens();
    if (tokens && !refresh && this.modelCatalog?.accountId===tokens.chatgptAccountId && this.modelCatalog.expiresAt>Date.now()) {
      return structuredClone(this.modelCatalog.models);
    }
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await this.rpc('model/list', { limit: 100, includeHidden: false, cursor });
      for (const model of result.data ?? []) {
        if (typeof model.model !== 'string' || model.hidden) continue;
        models.push({ id: model.model, label: model.displayName ?? model.model,
          supportsImages: Array.isArray(model.inputModalities) && model.inputModalities.includes('image'),
          ...(!Array.isArray(model.inputModalities) ? {imageSupportKnown:false} : {}), isDefault: model.isDefault === true });
      }
      cursor = result.nextCursor;
      if (!cursor) {
        if (!tokens) return models;
        try {
          const current = await readAccountModelCatalog(tokens,models,this.catalogFetch);
          this.modelCatalog = {accountId:tokens.chatgptAccountId,expiresAt:Date.now()+60_000,models:current};
          return structuredClone(current);
        } catch (error) {
          // Older Codex OAuth sessions may not authorize the public catalog.
          // Preserve the CLI's real choices and disclose their limited freshness;
          // never invent a requested model or disable an existing working one.
          if (models.length) {
            const fallback = models.map(model => ({...model, catalogSource:'codex' as const, catalogWarning:'account_catalog_unavailable' as const}));
            this.modelCatalog = {accountId:tokens.chatgptAccountId,expiresAt:Date.now()+60_000,models:fallback};
            return structuredClone(fallback);
          }
          this.modelCatalog=undefined;
          const reason = error instanceof AccountModelCatalogError && error.diagnostic === 'http' ? ` (HTTP ${error.status})` : '';
          throw failure(`Current account models could not be loaded${reason}. Refresh models after checking the Codex connection.`, 'codex_model_catalog_unavailable');
        }
      }
    }
    throw failure('Codex model catalog could not be read completely.', 'codex_invalid_response');
  }

  generate(request: CodexRequest): Promise<CodexGeneration> {
    let started = false;
    const pending = this.queue.then(() => {
      started = true;
      return this.run(request);
    });
    this.queue = pending.catch(() => {});
    const signal = request.signal;
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      // Queued calls reject immediately; active calls wait for run() to close
      // and decorate the cancellation with any correlated streamed usage.
      const abort = () => { if (!started) reject(abortError()); };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  private async run(request: CodexRequest): Promise<CodexGeneration> {
    if (request.signal?.aborted) throw abortError();
    this.active++;
    let latestUsage: TokenUsage | undefined;
    let responseObserved = false;
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
      if (request.imagePaths?.length && !model.supportsImages) throw failure(model.imageSupportKnown===false
        ? 'Screenshot support has not been confirmed for this Codex model.' : 'This Codex model does not support screenshots.', 'codex_vision_unsupported');
      const thread = await this.rpc('thread/start', { model: request.model, cwd: this.workspace, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
        baseInstructions: 'You are a model provider for Centinel. Analyze only the supplied content. Never use tools, read files, run commands, or change data. Return only the requested JSON.',
        developerInstructions: request.systemPrompt,
      });
      if (request.signal?.aborted) throw abortError();
      const threadId = thread.thread?.id;
      if (typeof threadId !== 'string') throw failure('Codex returned an invalid thread.', 'codex_invalid_response');
      const messages = new Map<string, string>();
      let finished: ((value: CodexGeneration) => void) | undefined;
      let failed: ((error: Error) => void) | undefined;
      const done = new Promise<CodexGeneration>((resolve, reject) => { finished = resolve; failed = reject; });
      // Attach a handler immediately: process/abort events may precede turn/start's response.
      void done.catch(() => {});
      const listener = (method: string, params: ObjectValue) => {
        if (params.threadId !== threadId) return;
        if (method.startsWith('item/')) responseObserved = true;
        if (method === 'error') {
          const error = turnFailure({ error: params.error });
          responseObserved = true;
          if (providerPause(error)) {
            // Stop even a CLI-internal retry before waiting for turn/completed.
            failed?.(withCodexUsage(error, latestUsage, responseObserved));
            this.close(error);
            return;
          }
        }
        if (method === 'thread/tokenUsage/updated' && (params.tokenUsage?.total || params.tokenUsage?.last)) {
          // Each generation owns a fresh ephemeral thread. Its cumulative total
          // includes any internal model work; last-only is a legacy fallback.
          const current = params.tokenUsage.total ?? params.tokenUsage.last;
          const source = params.tokenUsage.total ? 'codex_thread_total' : 'codex_turn_last';
          const observed = codexUsage(current, source);
          if (observed) { latestUsage = observed; responseObserved = true; }
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') {
          messages.set(params.item.id, params.item.text ?? '');
        }
        if (method === 'turn/completed') {
          responseObserved = true;
          if (params.turn?.status !== 'completed') failed?.(withCodexUsage(turnFailure(params.turn ?? {}), latestUsage, responseObserved));
          else {
            const text = [...messages.values()].join('\n').trim();
            if (!text) failed?.(withCodexUsage(failure('Codex returned an empty response.', 'codex_invalid_response'), latestUsage, responseObserved));
            else finished?.({ text, usage: latestUsage, model: request.model });
          }
        }
      };
      this.listeners.add(listener);
      const closed = (method: string, params: ObjectValue) => {
        if (method === '__closed') failed?.(withCodexUsage(params.error, latestUsage, responseObserved));
      };
      this.listeners.add(closed);
      const timer = setTimeout(() => this.close(failure('Codex generation exceeded its time limit.', 'codex_timeout')), this.generationTimeoutMs);
      dispose = () => { clearTimeout(timer); this.listeners.delete(listener); this.listeners.delete(closed); };
      const input: ObjectValue[] = [{ type: 'text', text: request.prompt }];
      for (const imagePath of request.imagePaths ?? []) {
        const file = path.resolve(imagePath);
        if (!fs.statSync(file).isFile()) throw failure('A screenshot could not be read.', 'codex_image_unavailable');
        input.push({ type: 'localImage', path: file });
      }
      await this.rpc('turn/start', { threadId, input, ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}) });
      return await done;
    } catch (error) {
      throw withCodexUsage(error, latestUsage, responseObserved);
    } finally {
      dispose?.(); request.signal?.removeEventListener('abort', abort); this.active--; this.touch();
    }
  }

  /** Read-only capacity diagnostics; never infer account exhaustion from a 429.
   * Omit auth, account IDs and opaque reset-credit details from this response. */
  async capacity() {
    await this.ready();
    const result = await this.rpc('account/rateLimits/read', {});
    const rows = result?.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
      ? Object.values(result.rateLimitsByLimitId) : result?.rateLimits ? [result.rateLimits] : [];
    const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const window = (value: any) => value && finite(value.usedPercent) !== null
      ? { usedPercent: value.usedPercent, windowDurationMins: finite(value.windowDurationMins), resetsAt: finite(value.resetsAt) } : null;
    return rows.filter((row): row is ObjectValue => !!row && typeof row === 'object').map(row => ({
      primary: window(row.primary), secondary: window(row.secondary),
      hasCredits: typeof row.credits?.hasCredits === 'boolean' ? row.credits.hasCredits : null,
      limitReached: typeof row.rateLimitReachedType === 'string' ? true : row.rateLimitReachedType === null ? false : null,
    }));
  }

  close(error: Error = failure('Codex connection ended. Reconnect and try again.')) {
    this.modelCatalog=undefined;
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
    client = new CodexAppServer(path.join(root, createHash('sha256').update(ownerId).digest('hex')), spawn, 120_000, localCodexTokenSource(ownerId), fetch, codexGenerationTimeoutMs());
    clients.set(ownerId, client);
  }
  return client;
}
export function closeCodexBackends() { for (const client of clients.values()) client.close(); clients.clear(); }
