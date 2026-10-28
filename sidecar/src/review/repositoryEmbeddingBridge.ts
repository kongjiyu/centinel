import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../artifacts.js';
import type { SavedEmbeddingConfiguration } from '../modelSettings.js';
import { SupabaseCentinelStore } from '../store/supabase.js';
import type { StoreModelUsage } from '../store/types.js';
import { createEmbeddingBatch, EmbeddingProviderError, embeddingFailureUsage } from './embeddingProvider.js';
import type { ReviewSourcePacketReference } from './usageContext.js';
import { throwIfAborted } from './abort.js';
import { configuredVoyageLimits, embeddingAdmissionEstimate, partitionEmbeddingInputs, waitForEmbeddingBudget } from './embeddingRateLimit.js';

type Usage = Omit<StoreModelUsage, 'id' | 'createdAt'> & { id?: string };
export type RepositoryBridgeOptions = {
  client: SupabaseClient;
  ownerId: string;
  projectId: string;
  reviewId?: string;
  configuration: SavedEmbeddingConfiguration;
  inputType: 'document' | 'query';
  sources: Array<{ relativePath: string; artifact: Artifact }>;
  stagingRoot?: string;
  signal?: AbortSignal;
  beforeProvider?: () => Promise<void>;
  indexTrigger?: 'source_changed' | 'review';
  indexFingerprint?: string;
  embed?: typeof createEmbeddingBatch;
  saveUsage?: (input: Usage) => Promise<unknown>;
  admit?: (estimate: number) => Promise<{ reconcile: (actual: number | null) => void }>;
};

/** Attributes only upstream-generated header paths that match the frozen
 * staging manifest. Unknown attribution remains incomplete, never all files. */
function sourceReferences(inputs: string[], options: RepositoryBridgeOptions): { sources: ReviewSourcePacketReference[]; sourcesComplete: boolean } {
  if (options.inputType === 'query') return { sources: [], sourcesComplete: true };
  const sources = new Map<string, ReviewSourcePacketReference>();
  let complete = true;
  for (const input of inputs) {
    const header = input.split(/\r?\n\r?\n/, 1)[0] ?? '';
    const candidate = header.split(/\r?\n/).find(line => line.startsWith('in '))?.slice(3).replace(/\\/g, '/');
    // Pinned upstream uses the final three '/'-separated path components.
    // On Windows its header can instead carry a complete backslash path.
    // Reproduce that presentation from trusted frozen paths; accept only a
    // unique match, never a basename guess or an arbitrary external path.
    const matched = options.sources.filter(source => {
      const relative = source.relativePath.replace(/\\/g, '/');
      const absolute = options.stagingRoot ? path.join(options.stagingRoot, source.relativePath) : null;
      const expected = [relative, ...(absolute ? [absolute, absolute.split('/').slice(-3).join('/')] : [])]
        .map(value => value.replace(/\\/g, '/'));
      return candidate !== undefined && expected.some(value => process.platform === 'win32'
        ? value.toLowerCase() === candidate.toLowerCase() : value === candidate);
    });
    if (matched.length !== 1) { complete = false; continue; }
    const artifact = matched[0]!.artifact;
    sources.set(artifact.id, { artifactId: artifact.id, artifactVersionId: artifact.versionId ?? null,
      filePath: artifact.filePath, contentHash: artifact.contentHash, lineStart: null, lineEnd: null });
  }
  return { sources: [...sources.values()], sourcesComplete: complete };
}

/** A capability-protected, operation-scoped loopback bridge. The upstream
 * child never receives the real provider key or a Supabase bearer token. */
export async function openRepositoryEmbeddingBridge(options: RepositoryBridgeOptions): Promise<{
  baseUrl: string; token: string; failure: () => unknown; close: () => Promise<void>;
}> {
  throwIfAborted(options.signal);
  const token = crypto.randomBytes(32).toString('hex');
  let failure: unknown;
  let failed = false;
  let serial = Promise.resolve();
  const saveUsage = options.saveUsage ?? (input => new SupabaseCentinelStore(options.client).saveModelUsage(input));
  const embed = options.embed ?? createEmbeddingBatch;
  const send = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/embeddings'
      || request.headers.authorization !== `Bearer ${token}`) {
      send(response, 403, { error: 'Embedding bridge access denied.' }); return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 2_000_000) chunks.push(chunk);
      else { send(response, 413, { error: 'Embedding bridge request is too large.' }); request.destroy(); }
    });
    request.on('end', () => {
      serial = serial.then(async () => {
        if (response.destroyed) return;
        if (failed || options.signal?.aborted) { send(response, 400, { error: 'Embedding operation stopped.' }); return; }
        let inputs: string[];
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          if (body.model !== options.configuration.model || !Array.isArray(body.input) || !body.input.length || body.input.length > 128
            || body.input.some(item => typeof item !== 'string' || !item.trim())
            || body.input.reduce((sum: number, item) => sum + String(item).length, 0) > 1_000_000) throw Error();
          inputs = body.input as string[];
        } catch { send(response, 400, { error: 'Invalid embedding bridge request.' }); return; }
        const voyage = options.configuration.embeddingProvider === 'voyage';
        const limit = voyage ? Math.min(9_000, configuredVoyageLimits().tokensPerMinute) : 64_000;
        const groups = partitionEmbeddingInputs(inputs, limit);
        const embeddings: number[][] = [];
        let reportedTotal: number | null = 0;
        let responseModel = options.configuration.model;
        for (const group of groups) {
        const estimate = embeddingAdmissionEstimate(group);
        const waitStarted = Date.now();
        const reservation = options.admit ? await options.admit(estimate) : voyage
          ? await waitForEmbeddingBudget(`${options.ownerId}:${options.configuration.baseUrl}:${options.configuration.model}`, estimate, options.signal)
          : { reconcile: (_actual: number | null) => undefined };
        throwIfAborted(options.signal);
        if (response.destroyed) throw new Error('The local embedding client closed before a provider request.');
        await options.beforeProvider?.();
        throwIfAborted(options.signal);
        const admissionWaitMs = Date.now() - waitStarted;
        const started = Date.now();
        const usageId = crypto.randomUUID();
        const usageBase = {
          id: usageId, projectId: options.projectId, reviewSessionId: options.reviewId ?? null, ownerId: options.ownerId,
          stage: options.inputType === 'document' ? 'source_indexing' : 'context_retrieval', attempt: 1,
          provider: 'custom', model: options.configuration.model, cost: null,
          metadata: { apiFormat: 'openai-compatible', embeddingProtocol: options.configuration.embeddingProvider,
            embeddingDimensions: options.configuration.dimensions, callKind: 'review', scope: 'embedding',
            indexTrigger: options.indexTrigger ?? 'review',
            ...(/^[a-f\d]{64}$/.test(options.indexFingerprint ?? '') ? { indexFingerprint: options.indexFingerprint } : {}),
            embeddingInputType: options.inputType, inputCount: group.length, admissionWaitMs,
            usageContext: { phase: options.inputType === 'document' ? 'source_indexing' : 'context_retrieval', ...sourceReferences(group, options) } },
        };
        // Reserve a durable unknown-usage row before a paid request. If the
        // final write fails, the request stays visible with unknown totals.
        try {
          await saveUsage({ ...usageBase, outcome: 'in_progress', inputTokens: null, outputTokens: null,
            cacheReadTokens: null, cacheCreationTokens: null, durationMs: null, errorCode: null });
        } catch {
          throw new Error('Embedding usage could not be reserved; no provider request was made for this batch.');
        }
        let result: Awaited<ReturnType<typeof createEmbeddingBatch>> | undefined;
        let errorCode: string | null = null;
        let knownUsage: EmbeddingProviderError['safeUsage'];
        let responseReceived: boolean | undefined;
        let usageObservation: EmbeddingProviderError['usageObservation'];
        let cancelled = false;
        try {
          result = await embed(options.configuration, group, options.inputType, options.signal);
          reservation.reconcile(result.providerReportedTotalTokens ?? result.inputTokens);
        } catch (cause) {
          failure = cause; failed = true;
          errorCode = cause instanceof EmbeddingProviderError ? cause.code : 'embedding_provider_unavailable';
          const observed = embeddingFailureUsage(cause);
          knownUsage = observed.safeUsage;
          responseReceived = observed.responseReceived;
          usageObservation = observed.usageObservation;
          cancelled = options.signal?.aborted === true || cause instanceof Error && cause.name === 'AbortError';
        }
        try {
          await saveUsage({
            ...usageBase, model: result?.model ?? options.configuration.model,
            outcome: result ? 'success' : cancelled ? 'cancelled' : 'permanent_error', inputTokens: result?.inputTokens ?? knownUsage?.inputTokens ?? null,
            outputTokens: result ? 0 : null, cacheReadTokens: result ? 0 : null, cacheCreationTokens: result ? 0 : null,
            durationMs: Date.now() - started, errorCode, cost: null,
            metadata: { ...usageBase.metadata,
              providerReportedTotalTokens: result?.providerReportedTotalTokens ?? knownUsage?.providerReportedTotalTokens ?? null,
              responseReceived: result ? true : responseReceived,
              usageObservation,
              ...(!result && responseReceived === false && knownUsage?.inputTokens == null && knownUsage?.providerReportedTotalTokens == null
                ? { usageAccounting: { basis: 'assumed_zero_no_response', accountedTokens: 0 } } : {}),
            },
          });
        } catch {
          if (!failed) failure = new Error('Embedding usage could not be recorded; the repository operation stopped.');
          failed = true;
        }
        if (failed || !result) { send(response, 400, { error: 'The embedding operation stopped. Inspect the saved provider status.' }); return; }
        responseModel = result.model;
        embeddings.push(...result.embeddings);
        reportedTotal = reportedTotal === null || result.providerReportedTotalTokens == null ? null : reportedTotal + result.providerReportedTotalTokens;
        }
        // Do not return estimated usage when the provider left it unknown.
        send(response, 200, { model: responseModel, data: embeddings.map((embedding, index) => ({ index, embedding })),
          usage: reportedTotal == null ? {} : { total_tokens: reportedTotal } });
      }).catch(cause => {
        failed = true; if (!failure) failure = cause instanceof Error ? cause : new Error('Embedding bridge operation failed.');
        if (!response.headersSent) send(response, 400, { error: 'Embedding operation stopped.' });
      });
    });
    request.on('error', () => { /* Request bodies and network diagnostics are never logged. */ });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local embedding bridge could not start.');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, token,
    failure: () => failed ? failure : undefined,
    close: async () => { await serial; await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); },
  };
}
