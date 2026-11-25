import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { throwIfAborted } from './abort.js';

export const INDEX_RELATIVE_DIRECTORY = path.join('.codebase-index', 'index');
export const OPEN_CODEBASE_INDEX_ENGINE = 'open-codebase-index@0.38.1';
export const OPEN_CODEBASE_INDEX_GRAPH_FORMAT = 'public-call-graph-text-v1';

export type OpenCodebaseIndexOptions = {
  projectRoot: string;
  embedding: { model: string; dimensions: number; baseUrl: string; token: string };
  mode: 'hybrid' | 'structural';
  signal?: AbortSignal;
};

export type OpenCodebaseIndexHit = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content?: string;
  symbol?: string;
  score?: number;
};

export type OpenCodebaseIndexGraphDirection = 'callers' | 'callees';

export type OpenCodebaseIndexSession = {
  index(): Promise<{ ready: boolean; detail: string }>;
  status(): Promise<{ ready: boolean; detail: string }>;
  context(query: string, maxTokens: number): Promise<{ hits: OpenCodebaseIndexHit[]; detail: string }>;
  graph(symbol: string, direction: OpenCodebaseIndexGraphDirection, filePath?: string): Promise<{ hits: OpenCodebaseIndexHit[]; detail: string }>;
  close(): Promise<void>;
};

type McpTextBlock = { type?: unknown; text?: unknown };
type McpResult = { content?: unknown; isError?: unknown; structuredContent?: unknown };

const require = createRequire(import.meta.url);
const UPSTREAM_ENTRY = require.resolve('open-codebase-index');
const UPSTREAM_CLI = path.join(path.dirname(UPSTREAM_ENTRY), 'cli.js');
const TRANSIENT_OR_PRIVATE_NAME = /(?:^|[._-])(?:config|credentials?|secrets?|tokens?|locks?|recovery|failed-batches|tmp|temp|log|shm|journal|mcp-runtime)(?:$|[._-])/i;
const MAX_INDEX_FILES = 64;
const MAX_INDEX_BYTES = 128 * 1024 * 1024;
const MAX_GRAPH_EDGES = 10;

function isLoopbackEmbeddingUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The repository embedding proxy URL must be a valid loopback HTTP URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = hostname.split('.');
  const isIpv4Loopback = ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && Number(ipv4[0]) === 127;
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash
    || !(hostname === '::1' || isIpv4Loopback)) {
    throw new Error('The repository embedding proxy must use plain HTTP on a loopback IP address without URL credentials, query, or fragment.');
  }
  return url;
}

function normalizeSafeFilePath(value: unknown, projectRoot: string): string | null {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  const root = path.resolve(projectRoot);
  const candidate = path.isAbsolute(value) || path.win32.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(root, value);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const pieces = relative.replaceAll('\\', '/').split('/');
  if (pieces.some(piece => piece === '..' || piece === '' || piece === '.')) return null;
  return pieces.join('/');
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textFromMcp(result: McpResult): string {
  if (!Array.isArray(result.content)) return '';
  return (result.content as McpTextBlock[])
    .filter(item => item && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('\n')
    .replaceAll('\0', '')
    .slice(0, 12_000);
}

function sanitizedDiagnostic(value: string, projectRoot: string): string {
  const root = path.resolve(projectRoot);
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    .replace(new RegExp(escapedRoot, 'gi'), '<staging-root>')
    .replace(/https?:\/\/[^\s)]+/gi, '<embedding-endpoint>')
    .replace(/(?:bearer\s+)[\w.-]+/gi, 'Bearer <redacted>')
    .replace(/\b(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, 'credential=<redacted>')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function statusSummary(text: string, projectRoot: string): { ready: boolean; detail: string } {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const notIndexed = lines.some(line => /codebase is not indexed/i.test(line));
  const compatibilityFailure = lines.some(line => /(?:compatibility warning|index warning|indexing warning|failed embedding batch)/i.test(line));
  const compatible = lines.some(line => /^Compatibility: Index is compatible with the current provider and model\.?$/i.test(line));
  const structural = lines.some(line => /^Compatibility: Structural index; no embedding provider required\.?$/i.test(line));
  const ready = !notIndexed && !compatibilityFailure && (compatible || structural);
  const safeLines = lines.filter(line => /^(?:Indexing mode|Indexed chunks(?: \(structural, all branches\))?|Stored chunks \(structural, all branches\)|Provider|Model|Compatibility|COMPATIBILITY WARNING|INDEX WARNING|INDEXING WARNING|Codebase is not indexed)/i.test(line));
  const summary = sanitizedDiagnostic(safeLines.join('; ') || 'Index status did not include a recognized compatibility result.', projectRoot);
  return { ready, detail: summary };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ESRCH' || code === 'EINVAL') return false;
    if (code === 'EPERM') return true;
    throw new Error('The upstream MCP child exit state could not be verified.');
  }
}

async function requireProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (processIsAlive(pid)) throw new Error('The upstream MCP child did not exit cleanly; snapshot publication is unsafe.');
}

function contextResults(value: unknown): unknown[] {
  const outer = asObject(value);
  if (!outer) return [];
  if (Array.isArray(outer.results)) return outer.results;
  const nested = asObject(outer.result);
  const nestedDetails = asObject(nested?.details);
  if (Array.isArray(nestedDetails?.results)) return nestedDetails.results;
  const details = asObject(outer.details);
  return Array.isArray(details?.results) ? details.results : [];
}

function structuredGraphResolution(value: unknown): Record<string, unknown> | null {
  const outer = asObject(value);
  if (!outer) return null;
  if (asObject(outer.resolution)) return outer.resolution as Record<string, unknown>;
  const nested = asObject(outer.result);
  const nestedDetails = asObject(nested?.details);
  return asObject(nestedDetails?.resolution);
}

function parseGraphEdges(text: string, direction: OpenCodebaseIndexGraphDirection, projectRoot: string, rootFilePath: string | null): OpenCodebaseIndexHit[] {
  const hits: OpenCodebaseIndexHit[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (hits.length >= MAX_GRAPH_EDGES) break;
    const edgeLine = /^\[\d+\]\s*(.+)$/.exec(line)?.[1];
    if (!edgeLine) continue;
    const suffix = /\s+at line (\d+)(?: \[(resolved|unresolved)\])?$/i.exec(edgeLine);
    if (!suffix || suffix[2]?.toLowerCase() !== 'resolved') continue;
    const lineNumber = Number(suffix[1]);
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) continue;
    const body = edgeLine.slice(0, suffix.index).trim().replace(/\s+\[[^\]]+\]$/, '').trim();
    let filePath: string | null = null;
    let symbol: string | undefined;
    if (direction === 'callers') {
      if (!body.startsWith('← from ')) continue;
      const caller = body.slice('← from '.length);
      const inIndex = caller.indexOf(' in ');
      const typeIndex = caller.lastIndexOf(' (');
      if (inIndex <= 0 || typeIndex <= inIndex + 4 || !caller.endsWith(')')) continue;
      symbol = caller.slice(0, inIndex).trim();
      filePath = caller.slice(inIndex + 4, typeIndex).trim();
    } else {
      if (!body.startsWith('→ ') || !rootFilePath) continue;
      const typeIndex = body.lastIndexOf(' (');
      if (typeIndex <= 2 || !body.endsWith(')')) continue;
      symbol = body.slice('→ '.length, typeIndex).trim();
      filePath = rootFilePath;
    }
    const safeFilePath = normalizeSafeFilePath(filePath, projectRoot);
    if (!safeFilePath || !symbol || symbol === '<unknown>') continue;
    hits.push({ filePath: safeFilePath, lineStart: lineNumber, lineEnd: lineNumber, symbol: symbol.slice(0, 256) });
  }
  return hits;
}

async function resolveCliPath(): Promise<string> {
  const cliStat = await fs.stat(UPSTREAM_CLI).catch(() => null);
  if (!cliStat?.isFile()) throw new Error('The pinned open-codebase-index MCP CLI could not be located.');
  return UPSTREAM_CLI;
}

async function stagedSourcePaths(projectRoot: string): Promise<string[]> {
  const root = path.resolve(projectRoot);
  const rootInfo = await fs.lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('The repository index root must be a real staging directory.');
  const files: string[] = [];
  const visit = async (directory: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relativePath = relative ? path.posix.join(relative, entry.name) : entry.name;
      if (!relative && (entry.name === '.codebase-index' || entry.name === '.git')) continue;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('The frozen repository staging tree contains a symbolic link.');
      if (stat.isDirectory()) {
        await visit(absolute, relativePath);
      } else if (stat.isFile()) {
        if (stat.size > 1024 * 1024) continue;
        files.push(relativePath.split(path.sep).join('/'));
      } else {
        throw new Error('The frozen repository staging tree contains an unsupported filesystem entry.');
      }
    }
  };
  await visit(root, '');
  return files.sort((left, right) => left.localeCompare(right));
}

export async function openCodebaseIndex(options: OpenCodebaseIndexOptions): Promise<OpenCodebaseIndexSession> {
  throwIfAborted(options.signal);
  if (!path.isAbsolute(options.projectRoot)) throw new Error('The repository index root must be an absolute staging path.');
  const rootStat = await fs.stat(options.projectRoot).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error('The repository index root must be an existing staging directory.');
  if (options.mode !== 'hybrid' && options.mode !== 'structural') throw new Error('Unsupported repository index mode.');
  if (!options.embedding.model || options.embedding.model.length > 160
    || !Number.isSafeInteger(options.embedding.dimensions) || options.embedding.dimensions <= 0 || options.embedding.dimensions > 8192
    || !options.embedding.token || options.embedding.token.length > 4096) {
    throw new Error('Invalid repository embedding proxy configuration.');
  }
  const proxyUrl = isLoopbackEmbeddingUrl(options.embedding.baseUrl);
  const baseUrl = proxyUrl.toString().replace(/\/+$/, '');
  const frozenPaths = await stagedSourcePaths(options.projectRoot);
  if (!frozenPaths.length) throw new Error('The frozen repository staging tree contains no indexable files.');

  const privateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'centinel-open-codebase-index-'));
  const configPath = path.join(privateDirectory, 'config.json');
  const privateConfig = {
    scope: 'project',
    include: frozenPaths,
    exclude: ['.git/**', '.codebase-index/**'],
    additionalInclude: [],
    knowledgeBases: [],
    repositoryHistory: { repositories: [] },
    embeddingProvider: 'custom',
    customProvider: {
      baseUrl,
      apiKey: options.embedding.token,
      model: options.embedding.model,
      dimensions: options.embedding.dimensions,
      maxTokens: 2048,
      // The loopback bridge can pace a batch across free-tier windows.
      // Its remote provider deadline remains 30 seconds per actual request.
      timeoutMs: 15 * 60_000,
      concurrency: 1,
      requestIntervalMs: 0,
      maxBatchSize: 32,
    },
    embeddingFallback: false,
    reranker: { enabled: false },
    indexing: {
      mode: options.mode,
      autoIndex: false,
      autoIndexMaxRetries: 0,
      autoIndexRetryDelayMs: 0,
      watchFiles: false,
      retries: 0,
      retryDelayMs: 0,
      autoGc: false,
      requireProjectMarker: false,
      gitBlame: { enabled: false },
      includeIgnored: frozenPaths,
      includeExcluded: frozenPaths,
    },
    search: { rerankTopN: 0, contextLines: 0, routingHints: false, routingGraphHandoffHints: false, communityBoost: 0 },
    debug: { enabled: false, logLevel: 'error', logSearch: false, logEmbedding: false, logCache: false, logGc: false, logBranch: false, metrics: false },
    effectivenessMetrics: { enabled: false },
    mcp: { stallTimeoutMs: 60 * 60_000 },
  };

  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const close = async (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      const childPid = transport?.pid ?? null;
      try {
        if (client) await client.close();
        else if (transport) await transport.close();
        if (childPid !== null) await requireProcessExit(childPid);
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
        await fs.rm(privateDirectory, { recursive: true, force: true });
      }
    })();
    return closePromise;
  };
  const onAbort = () => { void close().catch(() => undefined); };

  try {
    await fs.writeFile(configPath, JSON.stringify(privateConfig), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    throwIfAborted(options.signal);
    const cliPath = await resolveCliPath();
    const isolatedHome = path.join(privateDirectory, 'home');
    await fs.mkdir(isolatedHome, { recursive: true });
    const childEnvironment = {
      ...getDefaultEnvironment(),
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      APPDATA: path.join(isolatedHome, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(isolatedHome, 'AppData', 'Local'),
    };
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, '--host', 'codex', '--project', path.resolve(options.projectRoot), '--config', configPath, '--mcp-idle-timeout', '0'],
      cwd: path.resolve(options.projectRoot),
      env: childEnvironment,
      stderr: 'ignore',
    });
    client = new Client({ name: 'centinel-repository-index', version: '1.0.0' });
    await client.connect(transport, { signal: options.signal, timeout: 30_000 });
    throwIfAborted(options.signal);
    options.signal?.addEventListener('abort', onAbort, { once: true });
  } catch (error) {
    await close().catch(() => undefined);
    if (options.signal?.aborted) throw error;
    throw new Error(`The repository index MCP process could not start: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`);
  }

  const call = async (name: string, args?: Record<string, unknown>): Promise<McpResult> => {
    throwIfAborted(options.signal);
    if (closed || !client) throw new Error('The repository index session is closed.');
    const result = await client.callTool({ name, arguments: args ?? {} }, undefined, { signal: options.signal, timeout: name === 'index_codebase' ? 60 * 60_000 : name === 'codebase_context' ? 15 * 60_000 : 300_000, resetTimeoutOnProgress: true });
    throwIfAborted(options.signal);
    return result as McpResult;
  };

  const status = async (): Promise<{ ready: boolean; detail: string }> => {
    const result = await call('index_status');
    const text = textFromMcp(result);
    if (result.isError === true) return { ready: false, detail: sanitizedDiagnostic(text || 'Index status failed.', options.projectRoot) };
    return statusSummary(text, options.projectRoot);
  };

  return {
    async index() {
      const result = await call('index_codebase', {});
      const resultText = textFromMcp(result);
      if (result.isError === true || /^Error:\s*/i.test(resultText)) {
        return { ready: false, detail: sanitizedDiagnostic(resultText || 'Index operation failed.', options.projectRoot) };
      }
      const current = await status();
      return { ready: current.ready, detail: sanitizedDiagnostic(`Index operation completed; ${current.detail}`, options.projectRoot) };
    },
    status,
    async context(query, maxTokens) {
      if (!query.trim() || query.length > 8192) throw new Error('The repository context query must contain 1 to 8192 characters.');
      if (!Number.isFinite(maxTokens) || maxTokens <= 0) throw new Error('The repository context token budget must be positive.');
      const tokenBudget = Math.max(128, Math.min(4000, Math.trunc(maxTokens)));
      const result = await call('codebase_context', { query, limit: 12, tokenBudget, diagnostic: true });
      const resultText = textFromMcp(result);
      if (result.isError === true || /^Error:\s*/i.test(resultText)) {
        throw new Error(`Repository context retrieval failed: ${sanitizedDiagnostic(resultText || 'MCP tool error.', options.projectRoot)}`);
      }
      const structured = result.structuredContent;
      const hits: OpenCodebaseIndexHit[] = [];
      for (const raw of contextResults(structured)) {
        const row = asObject(raw);
        const filePath = normalizeSafeFilePath(row?.filePath, options.projectRoot);
        const lineStart = row?.startLine;
        const lineEnd = row?.endLine;
        if (!filePath || !Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd)
          || (lineStart as number) < 1 || (lineEnd as number) < (lineStart as number)) continue;
        hits.push({
          filePath,
          lineStart: lineStart as number,
          lineEnd: lineEnd as number,
          ...(typeof row?.name === 'string' && row.name ? { symbol: row.name.slice(0, 256) } : {}),
          ...(typeof row?.score === 'number' && Number.isFinite(row.score) ? { score: row.score } : {}),
        });
      }
      const details = asObject(structured);
      const selected = Number.isSafeInteger(details?.selectedCount) ? details?.selectedCount as number : hits.length;
      const candidates = Number.isSafeInteger(details?.candidateCount) ? details?.candidateCount as number : selected;
      return { hits, detail: `Retrieved ${hits.length} structured context location(s) (${selected} selected from ${candidates} candidate(s)); source text is resolved from the frozen manifest.` };
    },
    async graph(symbol, direction, filePath) {
      const trimmedSymbol = symbol.trim();
      if (!trimmedSymbol || trimmedSymbol.length > 256) throw new Error('The graph symbol must contain 1 to 256 characters.');
      if (direction !== 'callers' && direction !== 'callees') throw new Error('Unsupported repository graph direction.');
      const selectedPath = filePath === undefined ? undefined : normalizeSafeFilePath(filePath, options.projectRoot);
      if (filePath !== undefined && !selectedPath) throw new Error('The graph file path must identify a file inside the frozen staging root.');
      const result = await call('call_graph', {
        name: trimmedSymbol,
        direction,
        ...(selectedPath ? { filePath: selectedPath } : {}),
      });
      const text = textFromMcp(result);
      if (result.isError === true) {
        return { hits: [], detail: `Public call_graph failed: ${sanitizedDiagnostic(text || 'MCP tool error.', options.projectRoot)}` };
      }
      const resolution = structuredGraphResolution(result.structuredContent);
      if (resolution?.status !== 'resolved') {
        return { hits: [], detail: `Public call_graph did not return a unique structured symbol resolution; 0 graph locations verified (${OPEN_CODEBASE_INDEX_ENGINE}; ${OPEN_CODEBASE_INDEX_GRAPH_FORMAT}).` };
      }
      const rootFilePath = normalizeSafeFilePath(resolution.filePath, options.projectRoot)
        ?? normalizeSafeFilePath(/ at (.+):\d+ (?:is called by|calls) /i.exec(text)?.[1], options.projectRoot);
      const hits = parseGraphEdges(text, direction, options.projectRoot, rootFilePath);
      return {
        hits,
        detail: `Parsed ${hits.length} resolved direct ${direction} edge location(s) from public call_graph text (${OPEN_CODEBASE_INDEX_ENGINE}; ${OPEN_CODEBASE_INDEX_GRAPH_FORMAT}; capped at ${MAX_GRAPH_EDGES}; partial structural context, not proof).`,
      };
    },
    close,
  };
}

/** Return the stable relative file inventory for a closed upstream index. The
 * caller must close MCP first; links and transient/incomplete files fail closed. */
export async function portableIndexFiles(indexDir: string): Promise<string[]> {
  const root = path.resolve(indexDir);
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('The repository index directory must be a real directory.');
  const files: string[] = [];
  let totalBytes = 0;

  const visit = async (directory: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relativeName = relative ? path.posix.join(relative, entry.name) : entry.name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('The repository index contains a symbolic link.');
      if (stat.isFile() && /\.(?:db|sqlite)(?:-journal)$/i.test(entry.name)) {
        throw new Error('The repository index still has an uncheckpointed rollback journal.');
      }
      if (TRANSIENT_OR_PRIVATE_NAME.test(entry.name)) {
        if (stat.isDirectory() && entry.name.toLowerCase() === 'mcp-runtime') continue;
        if (stat.isFile()) continue;
        throw new Error('The repository index contains a transient or private directory.');
      }
      if (stat.isDirectory()) {
        await visit(absolute, relativeName);
        continue;
      }
      if (!stat.isFile()) throw new Error('The repository index contains an unsupported filesystem entry.');
      files.push(relativeName.split(path.sep).join('/'));
      totalBytes += stat.size;
      if (files.length > MAX_INDEX_FILES || totalBytes > MAX_INDEX_BYTES) throw new Error('The repository index exceeds portable snapshot limits.');
    }
  };

  await visit(root, '');
  if (!files.length) throw new Error('The repository index has no portable files.');
  return files.sort((left, right) => left.localeCompare(right));
}
