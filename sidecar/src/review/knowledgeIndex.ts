import crypto from 'node:crypto';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact } from '../artifacts.js';
import type { RetrievedContext } from './contextTypes.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { readClientArtifactContent } from '../applicationApi.js';
import { SupabaseCentinelStore } from '../store/supabase.js';
import { resolveSavedEmbeddingProvider } from '../modelSettings.js';
import { throwIfAborted } from './abort.js';
import { createEmbedding, EMBEDDING_DIMENSIONS, EmbeddingProviderError } from './embeddingProvider.js';
import { providerPause } from './providerPause.js';
import { sourceManifestReference } from './usageContext.js';
import { chunkFrozenSource, SOURCE_CHUNK_MAX_CHARS, SOURCE_CHUNK_POLICY, type SourceChunk } from './sourceChunks.js';
import { rankHybridChunks } from './retrievalRanking.js';

const INDEX_ORDINAL_BASE = 2_000_000;
const MAX_LOGICAL_CHUNKS = 100_000;
const EMBEDDING_LOOKUP_PAGE_SIZE = 500;
const MAX_RETRIEVAL_SCAN_ROWS = 5_000;
const MAX_RETRIEVAL_QUERY_CHARS = 8_000;
const MAX_SEMANTIC_CANDIDATES = 32;

type ExistingChunk = {
  ordinal: number;
  contentHash: string;
  embeddingModel: string | null;
  metadata: Record<string, unknown>;
};

type ExistingVersionIndex = {
  byContentHash: Map<string, ExistingChunk>;
  byOrdinal: Map<number, ExistingChunk>;
  realVectorKeys: Set<string>;
};

type FrozenIndexCandidate = {
  key: string;
  artifact: Artifact;
  row: Record<string, unknown>;
  metadata: Record<string, unknown>;
  content: string;
  actualChunkContentHash: string;
  startOffset: number;
  endOffset: number;
  logicalOrdinal: number;
};

function embeddingConfigKey(configuration: { baseUrl: string; model: string }): string {
  const endpoint = new URL(configuration.baseUrl);
  endpoint.username = '';
  endpoint.password = '';
  endpoint.search = '';
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  return crypto.createHash('sha256').update(JSON.stringify({
    provider: 'custom', apiFormat: 'openai-compatible', endpoint: endpoint.toString(), model: configuration.model,
    dimensions: EMBEDDING_DIMENSIONS, policy: SOURCE_CHUNK_POLICY,
  })).digest('hex');
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizedSourceHash(value: string): string | null {
  const normalized = value.replace(/^sha256:/i, '').toLowerCase();
  return /^[a-f\d]{64}$/.test(normalized) ? normalized : null;
}

function chunkIndexKey(ordinal: number, contentHash: string): string {
  return `${ordinal}\u0000${contentHash}`;
}

function chunkIdentity(policy: string, startOffset: number, actualChunkContentHash: string): string {
  return crypto.createHash('sha256').update(JSON.stringify([policy, startOffset, actualChunkContentHash])).digest('hex');
}

function hasSameChunkIdentity(
  row: ExistingChunk,
  artifact: Artifact,
  chunk: SourceChunk,
  actualChunkContentHash: string,
  contentHash: string,
): boolean {
  const metadata = row.metadata;
  return row.contentHash === contentHash
    && row.ordinal === INDEX_ORDINAL_BASE + chunk.ordinal
    && metadata.artifactId === artifact.id
    && metadata.filePath === artifact.filePath
    && metadata.sourceHash === artifact.contentHash
    && metadata.chunkPolicy === SOURCE_CHUNK_POLICY
    && metadata.actualChunkContentHash === actualChunkContentHash
    && metadata.logicalOrdinal === chunk.ordinal
    && metadata.indexOrdinal === INDEX_ORDINAL_BASE + chunk.ordinal
    && metadata.startOffset === chunk.startOffset
    && metadata.endOffset === chunk.endOffset
    && metadata.lineStart === chunk.lineStart
    && metadata.lineEnd === chunk.lineEnd
    && metadata.kind === chunk.kind
    && metadata.symbol === (chunk.symbol ?? null)
    && metadata.isFragment === chunk.isFragment
    && metadata.fragmentIndex === (chunk.fragmentIndex ?? null)
    && metadata.fragmentCount === (chunk.fragmentCount ?? null);
}

/** Load only vector metadata for this exact frozen version, under the already
 * member-checked project client. Source bodies and vectors are not read back. */
async function existingVectorsForVersion(
  client: SupabaseClient,
  projectId: string,
  artifactVersionId: string,
  signal?: AbortSignal,
): Promise<ExistingVersionIndex> {
  const existing: ExistingVersionIndex = { byContentHash: new Map(), byOrdinal: new Map(), realVectorKeys: new Set() };
  let offset = 0;
  while (true) {
    throwIfAborted(signal);
    let query = client.from('artifact_chunks').select('ordinal,content_hash,embedding_model,metadata')
      .eq('project_id', projectId).eq('artifact_version_id', artifactVersionId)
      .order('ordinal').order('id').range(offset, offset + EMBEDDING_LOOKUP_PAGE_SIZE - 1);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    throwIfAborted(signal);
    if (result.error) throw new Error(`Frozen embedding lookup failed: ${result.error.message ?? 'unknown error'}`);
    const rows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    for (const row of rows) {
      const hash = typeof row.content_hash === 'string' ? row.content_hash : '';
      const ordinal = safeInteger(row.ordinal);
      if (!hash || ordinal === null) continue;
      const chunk: ExistingChunk = {
        ordinal,
        contentHash: hash,
        embeddingModel: typeof row.embedding_model === 'string' ? row.embedding_model : null,
        metadata: objectMetadata(row.metadata),
      };
      existing.byContentHash.set(hash, chunk);
      existing.byOrdinal.set(ordinal, chunk);
    }
    if (rows.length < EMBEDDING_LOOKUP_PAGE_SIZE) break;
    offset += rows.length;
  }

  // Metadata alone cannot prove a vector is present. Ask PostgREST for only
  // rows whose vector column is non-null, without transferring the vectors.
  offset = 0;
  while (true) {
    throwIfAborted(signal);
    let query = client.from('artifact_chunks').select('ordinal,content_hash')
      .eq('project_id', projectId).eq('artifact_version_id', artifactVersionId)
      .not('embedding', 'is', null).order('ordinal').order('id')
      .range(offset, offset + EMBEDDING_LOOKUP_PAGE_SIZE - 1);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    throwIfAborted(signal);
    if (result.error) throw new Error(`Frozen vector-presence lookup failed: ${result.error.message ?? 'unknown error'}`);
    const rows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    for (const row of rows) {
      const ordinal = safeInteger(row.ordinal);
      const hash = typeof row.content_hash === 'string' ? row.content_hash : '';
      if (ordinal !== null && hash) existing.realVectorKeys.add(chunkIndexKey(ordinal, hash));
    }
    if (rows.length < EMBEDDING_LOOKUP_PAGE_SIZE) break;
    offset += rows.length;
  }
  return existing;
}

function hasCompatibleEmbedding(
  existing: ExistingChunk | undefined,
  userId: string,
  configurationKey: string,
  requestedModel: string,
  artifact: Artifact,
  chunk: SourceChunk,
  actualChunkContentHash: string,
  contentHash: string,
  hasRealVector: boolean,
): boolean {
  return Boolean(hasRealVector
    && existing?.embeddingModel
    && existing.embeddingModel === existing.metadata.embeddingModel
    && existing.metadata.embeddingRequestedModel === requestedModel
    && existing.metadata.embeddingStatus === 'available'
    && existing.metadata.embeddingOwnerId === userId
    && existing.metadata.indexOwnerId === userId
    && existing.metadata.embeddingConfigKey === configurationKey
    && existing.metadata.embeddingDimensions === EMBEDDING_DIMENSIONS
    && existing.metadata.embeddingPolicy === SOURCE_CHUNK_POLICY
    && existing.metadata.chunkPolicy === SOURCE_CHUNK_POLICY
    && existing.metadata.artifactId === artifact.id
    && existing.metadata.filePath === artifact.filePath
    && existing.metadata.sourceHash === artifact.contentHash
    && existing.metadata.actualChunkContentHash === actualChunkContentHash
    && existing.metadata.logicalOrdinal === chunk.ordinal
    && existing.metadata.indexOrdinal === INDEX_ORDINAL_BASE + chunk.ordinal
    && existing.metadata.startOffset === chunk.startOffset
    && existing.metadata.endOffset === chunk.endOffset
    && existing.metadata.lineStart === chunk.lineStart
    && existing.metadata.lineEnd === chunk.lineEnd
    && existing.metadata.kind === chunk.kind
    && existing.metadata.symbol === (chunk.symbol ?? null)
    && existing.metadata.isFragment === chunk.isFragment
    && existing.metadata.fragmentIndex === (chunk.fragmentIndex ?? null)
    && existing.metadata.fragmentCount === (chunk.fragmentCount ?? null)
    && existing.contentHash === contentHash
    && existing.ordinal === INDEX_ORDINAL_BASE + chunk.ordinal);
}

/** Build a durable, rebuildable index from frozen artifact versions. An
 * unconfigured or unavailable embedding provider leaves honest lexical
 * chunks, never fabricated vectors or a failed Review. */
export async function indexFrozenArtifacts(
  client: SupabaseClient,
  userId: string,
  projectId: string,
  artifacts: Artifact[],
  signal?: AbortSignal,
  reviewId?: string,
  frozenReader?: (artifact: Artifact, signal?: AbortSignal) => Promise<string>,
): Promise<void> {
  const repository = new CentinelApplicationRepository(client, userId);
  throwIfAborted(signal);
  await repository.requireProjectMember(projectId, signal);
  throwIfAborted(signal);
  const store = new SupabaseCentinelStore(client);
  let embeddingConfig: Awaited<ReturnType<typeof resolveSavedEmbeddingProvider>> = null;
  let embeddingErrorCode: string | null = null;
  try {
    embeddingConfig = await resolveSavedEmbeddingProvider(client, userId, signal);
  } catch {
    throwIfAborted(signal);
    embeddingErrorCode = 'configuration_unavailable';
  }
  throwIfAborted(signal);
  for (const artifact of artifacts) {
    throwIfAborted(signal);
    if (artifact.projectId !== projectId || !artifact.versionId) throw new Error('Index input must be a frozen project artifact version.');
    const content = frozenReader ? await frozenReader(artifact, signal)
      : await readClientArtifactContent(client, userId, artifact.id, artifact.versionId, signal, artifact.projectId, artifact.contentHash);
    throwIfAborted(signal);
    const expectedSourceHash = normalizedSourceHash(artifact.contentHash);
    const actualSourceHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    if (!expectedSourceHash || actualSourceHash !== expectedSourceHash) {
      throw new Error('Frozen artifact content does not match the selected source version hash.');
    }
    // The version-scoped lookup returns identity/provenance metadata only;
    // embedding vectors and source bodies are never fetched for cache validation.
    let existing: ExistingVersionIndex;
    try {
      existing = await existingVectorsForVersion(client, projectId, artifact.versionId, signal);
    } catch {
      throwIfAborted(signal);
      // Without the occupied-ordinal inventory, writes could overwrite a
      // different or historical row. Leave this version untouched and let
      // retrieval use any already-saved compatible chunks.
      continue;
    }
    const configurationKey = embeddingConfig ? embeddingConfigKey(embeddingConfig) : null;
    const pieces = chunkFrozenSource({ id: artifact.id, filePath: artifact.filePath, type: artifact.type }, content);
    if (pieces.length > MAX_LOGICAL_CHUNKS) continue;
    const prepared = pieces.map(chunk => {
      const actualChunkContentHash = crypto.createHash('sha256').update(chunk.content).digest('hex');
      return {
        chunk,
        actualChunkContentHash,
        contentHash: chunkIdentity(SOURCE_CHUNK_POLICY, chunk.startOffset, actualChunkContentHash),
      };
    });
    const namespaceCollision = prepared.some(({ chunk, actualChunkContentHash, contentHash }) => {
      const expectedOrdinal = INDEX_ORDINAL_BASE + chunk.ordinal;
      const byOrdinal = existing.byOrdinal.get(expectedOrdinal);
      const byHash = existing.byContentHash.get(contentHash);
      return (byOrdinal && !hasSameChunkIdentity(byOrdinal, artifact, chunk, actualChunkContentHash, contentHash))
        || (byHash && !hasSameChunkIdentity(byHash, artifact, chunk, actualChunkContentHash, contentHash));
    });
    if (namespaceCollision) {
      // Frozen versions are immutable. A conflicting reserved ordinal means
      // this policy cannot safely write; do not call the provider or mutate it.
      continue;
    }
    for (const { chunk, actualChunkContentHash, contentHash } of prepared) {
      throwIfAborted(signal);
      const part = chunk.content;
      const indexOrdinal = INDEX_ORDINAL_BASE + chunk.ordinal;
      const cached = existing.byContentHash.get(contentHash);
      const cachedHasVector = !!cached && existing.realVectorKeys.has(chunkIndexKey(cached.ordinal, cached.contentHash));
      if (configurationKey && embeddingConfig
        && hasCompatibleEmbedding(cached, userId, configurationKey, embeddingConfig.model, artifact, chunk,
          actualChunkContentHash, contentHash, cachedHasVector)) {
        // This exact owner/config/version/policy/range already has a real vector.
        continue;
      }
      if (!configurationKey && cached) {
        // Keep an existing vector intact when embeddings are not configured.
        // Retrieval in this run stays lexical, and a later configured owner
        // must still pass the exact compatibility checks above.
        continue;
      }
      let embedding: number[] | null = null;
      let embeddingModel: string | null = null;
      const hasEmbeddableText = part.trim().length > 0;
      if (embeddingConfig && !embeddingErrorCode && hasEmbeddableText) {
        const started = Date.now();
        let result: Awaited<ReturnType<typeof createEmbedding>> | null = null;
        let capacityFailure: unknown;
        try {
          result = await createEmbedding(embeddingConfig, part, signal);
          throwIfAborted(signal);
          embedding = result.embedding;
          embeddingModel = result.model;
        } catch (cause) {
          throwIfAborted(signal);
          embeddingErrorCode = cause instanceof EmbeddingProviderError ? cause.code : 'indexing_provider_unavailable';
          if (providerPause(cause)) capacityFailure = cause;
        }
        try {
          await store.saveModelUsage({
            projectId, reviewSessionId: reviewId ?? null, ownerId: userId,
            stage: 'source_indexing', attempt: 1, provider: 'custom', model: result?.model ?? embeddingConfig.model,
            outcome: result ? 'success' : 'failure',
            inputTokens: result?.inputTokens ?? null, outputTokens: result ? 0 : null,
            cacheReadTokens: result ? 0 : null, cacheCreationTokens: result ? 0 : null,
            durationMs: Date.now() - started, errorCode: embeddingErrorCode, cost: null,
            metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'embedding', artifactVersionId: artifact.versionId,
              providerReportedTotalTokens: result?.providerReportedTotalTokens ?? null,
              normalizedTotalTokens: result?.inputTokens ?? null,
              normalizedTotalTokensSource: result?.inputTokens == null ? null : 'adapter_derived',
              usageContext: { phase: 'source_indexing', sources: [sourceManifestReference(artifact)].filter(Boolean),
                components: { sourceCharacters: part.length } } },
          });
        } catch {
          throwIfAborted(signal);
          // Usage persistence cannot turn a successful embedding into a
          // fabricated provider failure; the durable chunk is still saved.
        }
        if (capacityFailure) throw capacityFailure;
      }
      await store.saveEmbeddingChunk({
        projectId,
        parentType: 'artifact_version',
        parentId: artifact.versionId,
        ordinal: indexOrdinal,
        content: part,
        contentHash,
        embedding,
        embeddingModel,
        metadata: {
          artifactId: artifact.id,
          filePath: artifact.filePath,
          sourceHash: artifact.contentHash,
          actualChunkContentHash,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          kind: chunk.kind,
          symbol: chunk.symbol ?? null,
          isFragment: chunk.isFragment,
          fragmentIndex: chunk.fragmentIndex ?? null,
          fragmentCount: chunk.fragmentCount ?? null,
          chunkPolicy: SOURCE_CHUNK_POLICY,
          logicalOrdinal: chunk.ordinal,
          indexOrdinal,
          indexOwnerId: userId,
          embeddingConfigKey: configurationKey,
          embeddingRequestedModel: embeddingConfig?.model ?? null,
          embeddingModel,
          embeddingPolicy: SOURCE_CHUNK_POLICY,
          embeddingDimensions: configurationKey ? EMBEDDING_DIMENSIONS : null,
          ...(embedding ? { embeddingOwnerId: userId } : {}),
          embeddingStatus: embedding ? 'available' : embeddingErrorCode ? 'unavailable'
            : embeddingConfig ? 'empty' : 'not_configured',
          ...(embeddingErrorCode ? { embeddingErrorCode } : {}) },
      }, signal);
      throwIfAborted(signal);
    }
  }
}

function candidateKey(versionId: string, startOffset: number, endOffset: number): string {
  return `${versionId}\u0000${startOffset}\u0000${endOffset}`;
}

function toFrozenIndexCandidate(
  row: Record<string, unknown>,
  projectId: string,
  artifact: Artifact,
  userId: string,
  configurationKey: string | null,
  requestedModel: string | null,
): FrozenIndexCandidate | null {
  const versionId = typeof row.artifact_version_id === 'string' ? row.artifact_version_id : '';
  const storedOrdinal = safeInteger(row.ordinal);
  const content = typeof row.content === 'string' ? row.content : '';
  const metadata = objectMetadata(row.metadata);
  const startOffset = safeInteger(metadata.startOffset);
  const endOffset = safeInteger(metadata.endOffset);
  const logicalOrdinal = safeInteger(metadata.logicalOrdinal);
  if (!artifact.versionId || row.project_id !== projectId || versionId !== artifact.versionId || storedOrdinal === null || !content
    || content.length > SOURCE_CHUNK_MAX_CHARS
    || startOffset === null || endOffset === null || endOffset <= startOffset || endOffset - startOffset !== content.length
    || logicalOrdinal === null || logicalOrdinal >= MAX_LOGICAL_CHUNKS
    || storedOrdinal !== INDEX_ORDINAL_BASE + logicalOrdinal || metadata.indexOrdinal !== storedOrdinal
    || metadata.artifactId !== artifact.id || metadata.filePath !== artifact.filePath
    || metadata.sourceHash !== artifact.contentHash || metadata.indexOwnerId !== userId
    || metadata.chunkPolicy !== SOURCE_CHUNK_POLICY || metadata.embeddingPolicy !== SOURCE_CHUNK_POLICY
    || (configurationKey !== null && (metadata.embeddingConfigKey !== configurationKey
      || metadata.embeddingRequestedModel !== requestedModel
      || metadata.embeddingDimensions !== EMBEDDING_DIMENSIONS
      || metadata.embeddingStatus === 'not_configured'))) return null;
  const lineStart = safeInteger(metadata.lineStart);
  const lineEnd = safeInteger(metadata.lineEnd);
  const actualChunkContentHash = crypto.createHash('sha256').update(content).digest('hex');
  if (lineStart === null || lineStart < 1 || lineEnd === null || lineEnd < lineStart
    || metadata.actualChunkContentHash !== actualChunkContentHash
    || typeof row.content_hash !== 'string'
    || row.content_hash !== chunkIdentity(SOURCE_CHUNK_POLICY, startOffset, actualChunkContentHash)) return null;
  if (!['code', 'function', 'class', 'doc_section', 'text'].includes(String(metadata.kind))
    || typeof metadata.isFragment !== 'boolean'
    || (metadata.symbol !== null && typeof metadata.symbol !== 'string')
    || !['available', 'unavailable', 'not_configured', 'empty'].includes(String(metadata.embeddingStatus))
    || (metadata.embeddingStatus === 'empty' && content.trim().length > 0)) return null;
  const fragmentIndex = metadata.fragmentIndex === null ? null : safeInteger(metadata.fragmentIndex);
  const fragmentCount = metadata.fragmentCount === null ? null : safeInteger(metadata.fragmentCount);
  if (metadata.isFragment
    ? fragmentIndex === null || fragmentCount === null || fragmentCount < 2 || fragmentIndex >= fragmentCount
    : fragmentIndex !== null || fragmentCount !== null) return null;
  if (metadata.embeddingStatus === 'available') {
    if (typeof metadata.embeddingModel !== 'string' || !metadata.embeddingModel
      || row.embedding_model !== metadata.embeddingModel || metadata.embeddingOwnerId !== userId
      || metadata.embeddingDimensions !== EMBEDDING_DIMENSIONS) return null;
  } else if (row.embedding_model !== null && row.embedding_model !== undefined) {
    return null;
  }
  return {
    key: candidateKey(versionId, startOffset, endOffset),
    artifact,
    row,
    metadata,
    content,
    actualChunkContentHash,
    startOffset,
    endOffset,
    logicalOrdinal,
  };
}

function semanticRowMatches(
  semanticRow: Record<string, unknown>,
  candidate: FrozenIndexCandidate,
  userId: string,
  configurationKey: string,
  requestedModel: string,
  model: string,
): boolean {
  const semanticMetadata = objectMetadata(semanticRow.metadata);
  return semanticRow.artifact_version_id === candidate.artifact.versionId
    && semanticRow.ordinal === candidate.row.ordinal
    && semanticRow.content === candidate.content
    && semanticMetadata.artifactId === candidate.artifact.id
    && semanticMetadata.filePath === candidate.artifact.filePath
    && semanticMetadata.sourceHash === candidate.artifact.contentHash
    && semanticMetadata.indexOwnerId === userId
    && semanticMetadata.embeddingOwnerId === userId
    && semanticMetadata.embeddingConfigKey === configurationKey
    && semanticMetadata.embeddingRequestedModel === requestedModel
    && semanticMetadata.embeddingPolicy === SOURCE_CHUNK_POLICY
    && semanticMetadata.chunkPolicy === SOURCE_CHUNK_POLICY
    && semanticMetadata.embeddingDimensions === EMBEDDING_DIMENSIONS
    && semanticMetadata.embeddingStatus === 'available'
    && semanticMetadata.embeddingModel === model
    && semanticMetadata.indexOrdinal === candidate.row.ordinal
    && semanticMetadata.lineStart === candidate.metadata.lineStart
    && semanticMetadata.lineEnd === candidate.metadata.lineEnd
    && semanticMetadata.kind === candidate.metadata.kind
    && semanticMetadata.symbol === candidate.metadata.symbol
    && candidate.row.embedding_model === model
    && candidate.metadata.embeddingModel === model
    && candidate.metadata.embeddingRequestedModel === requestedModel
    && semanticMetadata.actualChunkContentHash === candidate.actualChunkContentHash
    && semanticMetadata.startOffset === candidate.startOffset
    && semanticMetadata.endOffset === candidate.endOffset
    && semanticMetadata.logicalOrdinal === candidate.logicalOrdinal
    && semanticMetadata.isFragment === candidate.metadata.isFragment
    && semanticMetadata.fragmentIndex === candidate.metadata.fragmentIndex
    && semanticMetadata.fragmentCount === candidate.metadata.fragmentCount
    && semanticRow.distance != null && Number.isFinite(Number(semanticRow.distance));
}

/** Select only chunks associated with this Review's immutable versions. */
export async function retrieveFrozenContext(
  client: SupabaseClient,
  userId: string,
  projectId: string,
  artifacts: Artifact[],
  maxTokens: number,
  signal?: AbortSignal,
  reviewId?: string,
  queryText?: string,
): Promise<RetrievedContext> {
  const repository = new CentinelApplicationRepository(client, userId);
  throwIfAborted(signal);
  await repository.requireProjectMember(projectId, signal);
  throwIfAborted(signal);
  const selectedArtifacts = artifacts.filter(item => item.projectId === projectId && !!item.versionId
    && normalizedSourceHash(item.contentHash) !== null);
  const versionIds = Array.from(new Set(selectedArtifacts.map(item => item.versionId!)));
  if (!versionIds.length) return { files: [], totalSymbols: 0, estimatedTokens: 0, reason: 'No frozen artifact versions are available.' };
  throwIfAborted(signal);
  const tokenBudget = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 100_000;
  const maxChunks = Math.min(16, Math.max(1, Math.ceil(tokenBudget / 600)));
  const rawQuery = queryText?.trim() ?? '';
  const queryTooLong = rawQuery.length > MAX_RETRIEVAL_QUERY_CHARS;
  const boundedQuery = rawQuery.slice(0, MAX_RETRIEVAL_QUERY_CHARS);
  let configuration: Awaited<ReturnType<typeof resolveSavedEmbeddingProvider>> = null;
  let configurationKey: string | null = null;
  let semanticEmbedding: Awaited<ReturnType<typeof createEmbedding>> | null = null;
  const semanticKeys: string[] = [];
  let semanticPartialReason: string | null = null;
  let retrievalDetail = '';
  if (rawQuery) {
    try {
      configuration = await resolveSavedEmbeddingProvider(client, userId, signal);
    } catch {
      throwIfAborted(signal);
      retrievalDetail = 'The source-indexing configuration is unavailable.';
    }
    throwIfAborted(signal);
    if (configuration) configurationKey = embeddingConfigKey(configuration);
    if (configuration && !queryTooLong) {
      const started = Date.now();
      let embedded: Awaited<ReturnType<typeof createEmbedding>> | null = null;
      let errorCode: string | null = null;
      let capacityFailure: unknown;
      try {
        embedded = await createEmbedding(configuration, boundedQuery, signal);
        semanticEmbedding = embedded;
      } catch (cause) {
        throwIfAborted(signal);
        errorCode = cause instanceof EmbeddingProviderError ? cause.code : 'retrieval_provider_unavailable';
        if (providerPause(cause)) capacityFailure = cause;
        retrievalDetail = 'The source-indexing provider is unavailable.';
      }
      try {
        await new SupabaseCentinelStore(client).saveModelUsage({
          projectId, reviewSessionId: reviewId ?? null, ownerId: userId,
          stage: 'context_retrieval', attempt: 1, provider: 'custom', model: embedded?.model ?? configuration.model,
          outcome: embedded ? 'success' : 'failure', inputTokens: embedded?.inputTokens ?? null,
          outputTokens: embedded ? 0 : null, cacheReadTokens: embedded ? 0 : null,
          cacheCreationTokens: embedded ? 0 : null, durationMs: Date.now() - started,
          errorCode, cost: null, metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'embedding',
            providerReportedTotalTokens: embedded?.providerReportedTotalTokens ?? null,
            normalizedTotalTokens: embedded?.inputTokens ?? null,
            normalizedTotalTokensSource: embedded?.inputTokens == null ? null : 'adapter_derived',
            usageContext: { phase: 'context_retrieval', sources: [] } },
        });
      } catch {
        throwIfAborted(signal);
        // Retrieval remains available even if the usage ledger is temporarily unavailable.
      }
      if (capacityFailure) throw capacityFailure;
    } else if (configuration && queryTooLong) {
      retrievalDetail = 'The query exceeded the embedding length limit; bounded lexical retrieval was used.';
    }
  }
  if (queryTooLong && !retrievalDetail) {
    retrievalDetail = 'The query exceeded the retrieval length limit and was truncated for lexical matching.';
  }

  const scannedRows: Array<Record<string, unknown>> = [];
  let offset = 0;
  let scanLimitReached = false;
  while (offset < MAX_RETRIEVAL_SCAN_ROWS) {
    throwIfAborted(signal);
    const pageSize = Math.min(EMBEDDING_LOOKUP_PAGE_SIZE, MAX_RETRIEVAL_SCAN_ROWS - offset);
    let query = client.from('artifact_chunks').select('id,project_id,artifact_version_id,ordinal,content,content_hash,embedding_model,metadata')
      .eq('project_id', projectId).in('artifact_version_id', versionIds)
      .order('artifact_version_id').order('ordinal').order('id').range(offset, offset + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    throwIfAborted(signal);
    if (result.error) throw new Error(`Durable Review context lookup failed: ${result.error.message}`);
    const page = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    scannedRows.push(...page);
    offset += page.length;
    if (page.length < pageSize) break;
    if (offset >= MAX_RETRIEVAL_SCAN_ROWS) {
      // One-row sentinel distinguishes an exactly full inventory from a
      // truncated scan while keeping the total database read bounded.
      let sentinel = client.from('artifact_chunks').select('id')
        .eq('project_id', projectId).in('artifact_version_id', versionIds)
        .order('artifact_version_id').order('ordinal').order('id').range(offset, offset);
      if (signal) sentinel = sentinel.abortSignal(signal);
      const extra = await sentinel;
      throwIfAborted(signal);
      if (extra.error) throw new Error(`Durable Review context lookup failed: ${extra.error.message}`);
      scanLimitReached = Array.isArray(extra.data) && extra.data.length > 0;
      break;
    }
  }

  const artifactByVersion = new Map(selectedArtifacts.map(item => [item.versionId!, item]));
  const candidates: FrozenIndexCandidate[] = [];
  const candidateByVersionOrdinal = new Map<string, FrozenIndexCandidate>();
  const candidatesByKey = new Map<string, FrozenIndexCandidate>();
  const ambiguousCandidateKeys = new Set<string>();
  for (const row of scannedRows) {
    throwIfAborted(signal);
    const versionId = typeof row.artifact_version_id === 'string' ? row.artifact_version_id : '';
    const artifact = artifactByVersion.get(versionId);
    if (!artifact) continue;
    const candidate = toFrozenIndexCandidate(row, projectId, artifact, userId, configurationKey, configuration?.model ?? null);
    if (!candidate) continue;
    const existingAtPosition = candidatesByKey.get(candidate.key);
    if (existingAtPosition) {
      if (existingAtPosition.row.ordinal !== candidate.row.ordinal
        || existingAtPosition.actualChunkContentHash !== candidate.actualChunkContentHash) {
        candidatesByKey.delete(candidate.key);
        ambiguousCandidateKeys.add(candidate.key);
        candidateByVersionOrdinal.delete(`${versionId}\u0000${String(existingAtPosition.row.ordinal)}`);
      }
      continue;
    }
    if (ambiguousCandidateKeys.has(candidate.key)) continue;
    candidatesByKey.set(candidate.key, candidate);
    candidateByVersionOrdinal.set(`${versionId}\u0000${String(row.ordinal)}`, candidate);
  }
  candidates.push(...candidatesByKey.values());

  if (semanticEmbedding && configuration && configurationKey) {
    throwIfAborted(signal);
    try {
      let semanticQuery = client.rpc('match_frozen_artifact_chunks', {
        p_project_id: projectId, p_version_ids: versionIds,
        p_embedding: `[${semanticEmbedding.embedding.join(',')}]`,
        p_embedding_model: semanticEmbedding.model, p_limit: MAX_SEMANTIC_CANDIDATES,
      });
      if (signal) semanticQuery = semanticQuery.abortSignal(signal);
      const semantic = await semanticQuery;
      throwIfAborted(signal);
      if (semantic.error) {
        retrievalDetail = `${retrievalDetail ? `${retrievalDetail} ` : ''}The similarity lookup is unavailable; lexical rankings were used.`;
      } else if (Array.isArray(semantic.data)) {
        const semanticSeen = new Set<string>();
        const semanticRows = semantic.data as Array<Record<string, unknown>>;
        let semanticMatchCount = 0;
        for (let rankIndex = 0; rankIndex < semanticRows.length; rankIndex += 1) {
          const item = semanticRows[rankIndex]!;
          const versionId = typeof item.artifact_version_id === 'string' ? item.artifact_version_id : '';
          const candidate = candidateByVersionOrdinal.get(`${versionId}\u0000${String(item.ordinal)}`);
          if (!candidate || semanticSeen.has(candidate.key)
            || !semanticRowMatches(item, candidate, userId, configurationKey, configuration.model, semanticEmbedding.model)) {
            // Keep rejected RPC rows as rank placeholders. Compacting after
            // provenance filtering would incorrectly promote lower-ranked hits.
            semanticKeys.push(`\u0000filtered-semantic-rank:${rankIndex}`);
            continue;
          }
          semanticSeen.add(candidate.key);
          semanticKeys.push(candidate.key);
          semanticMatchCount += 1;
        }
        if (semanticRows.length >= MAX_SEMANTIC_CANDIDATES) {
          semanticPartialReason = `The semantic lookup reached its ${MAX_SEMANTIC_CANDIDATES}-row limit before provenance filtering; additional compatible matches may have been omitted.`;
          retrievalDetail = `${retrievalDetail ? `${retrievalDetail} ` : ''}${semanticPartialReason}`;
        }
        if (!semanticMatchCount) {
          retrievalDetail = `${retrievalDetail ? `${retrievalDetail} ` : ''}No current owner/config/policy-matched vectors were available; lexical rankings were used.`;
        }
      }
    } catch {
      throwIfAborted(signal);
      retrievalDetail = `${retrievalDetail ? `${retrievalDetail} ` : ''}The similarity lookup is unavailable; lexical rankings were used.`;
    }
  }

  if (!candidates.length) {
    const partialReason = [
      scanLimitReached ? 'The durable scan limit was reached; some frozen chunks were not inspected.' : null,
      semanticPartialReason,
    ].filter((item): item is string => !!item).join(' ') || undefined;
    return {
      files: [], totalSymbols: 0, estimatedTokens: 0,
      reason: `No current-policy chunks with matching owner, source and frozen-version provenance were available.${partialReason ? ` ${partialReason}` : ''}${retrievalDetail ? ` ${retrievalDetail}` : ''}`,
      ...(partialReason ? { retrievalPartialReason: partialReason } : {}),
    };
  }

  const ranked = boundedQuery
    ? rankHybridChunks(candidates.map((candidate, order) => ({ key: candidate.key, order, content: candidate.content, candidate })), boundedQuery, semanticKeys, maxChunks)
    : [];
  if (boundedQuery && ranked.length === 0) {
    const partialReason = [
      scanLimitReached ? 'The durable scan limit was reached; some frozen chunks were not inspected.' : null,
      semanticPartialReason,
    ].filter((item): item is string => !!item).join(' ') || undefined;
    return {
      files: [], totalSymbols: 0, estimatedTokens: 0, selectedChunks: [],
      reason: `No lexical or compatible semantic matches were found; no retrieval chunks were selected.${retrievalDetail ? ` ${retrievalDetail}` : ''}${scanLimitReached ? ' The durable scan limit was reached; some frozen chunks were not inspected.' : ''}`,
      ...(partialReason ? { retrievalPartialReason: partialReason } : {}),
    };
  }
  const selected = ranked.length
    ? ranked.map(item => ({ candidate: item.candidate.candidate, score: item.score, mode: item.mode }))
    : candidates.slice().sort((left, right) => left.artifact.versionId!.localeCompare(right.artifact.versionId!)
      || left.startOffset - right.startOffset)
      .slice(0, maxChunks)
      .map(candidate => ({ candidate, score: 0, mode: 'lexical' as const }));
  if (!boundedQuery) retrievalDetail = `${retrievalDetail ? `${retrievalDetail} ` : ''}No retrieval query was supplied; current chunks were returned in source order.`;

  throwIfAborted(signal);
  const byVersion = new Map<string, { artifact: Artifact; text: string; tokens: number }>();
  let totalTokens = 0;
  const selectedChunks: NonNullable<RetrievedContext['selectedChunks']> = [];
  for (const item of selected) {
    throwIfAborted(signal);
    const { candidate, score, mode } = item;
    const versionId = candidate.artifact.versionId!;
    const artifact = candidate.artifact;
    const remaining = Math.max(0, tokenBudget - totalTokens);
    if (!remaining) break;
    const content = candidate.content;
    const tokens = Math.ceil(content.length / 4);
    // Do not truncate exact frozen chunks: the downstream evidence packet
    // validates their complete source range and body hash.
    if (tokens > remaining) continue;
    const previous = byVersion.get(versionId) ?? { artifact, text: '', tokens: 0 };
    previous.text += content;
    previous.tokens += tokens;
    byVersion.set(versionId, previous);
    selectedChunks.push({
      artifactVersionId: versionId,
      filePath: artifact.filePath,
      ordinal: candidate.logicalOrdinal,
      content,
      artifactId: artifact.id,
      contentHash: candidate.actualChunkContentHash,
      lineStart: Number(candidate.metadata.lineStart),
      lineEnd: Number(candidate.metadata.lineEnd),
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      kind: String(candidate.metadata.kind),
      ...(typeof candidate.metadata.symbol === 'string' ? { symbol: candidate.metadata.symbol } : {}),
      isFragment: candidate.metadata.isFragment === true,
      ...(safeInteger(candidate.metadata.fragmentIndex) !== null ? { fragmentIndex: safeInteger(candidate.metadata.fragmentIndex)! } : {}),
      ...(safeInteger(candidate.metadata.fragmentCount) !== null ? { fragmentCount: safeInteger(candidate.metadata.fragmentCount)! } : {}),
      retrievalScore: score,
      retrievalMode: mode,
      indexOrdinal: Number(candidate.row.ordinal),
    });
    totalTokens += tokens;
  }
  const now = new Date().toISOString();
  const files = Array.from(byVersion.values()).map(({ artifact, text }) => ({
    id: artifact.versionId!, projectId, filePath: artifact.filePath,
    parentPath: path.dirname(artifact.filePath).replaceAll('\\', '/'),
    fileType: path.extname(artifact.filePath).toLowerCase(), language: '',
    fileSize: Buffer.byteLength(text, 'utf8'), symbolCount: 0, indexedAt: now,
    module: artifact.filePath.split(/[\\/]/)[0] ?? '',
  }));
  const partialReason = [
    scanLimitReached ? 'The durable scan limit was reached; some frozen chunks were not inspected.' : null,
    semanticPartialReason,
  ].filter((item): item is string => !!item).join(' ') || undefined;
  return {
    files,
    totalSymbols: 0,
    estimatedTokens: totalTokens,
    selectedChunks,
    reason: `Retrieved ${selectedChunks.length} ${selectedChunks.some(chunk => chunk.retrievalMode === 'hybrid') ? 'hybrid-ranked' : selectedChunks.some(chunk => chunk.retrievalMode === 'semantic') ? 'semantic-ranked' : 'lexical-ranked'} chunk${selectedChunks.length === 1 ? '' : 's'} from ${byVersion.size} frozen artifact version${byVersion.size === 1 ? '' : 's'} in Supabase.${retrievalDetail ? ` ${retrievalDetail}` : ''}${scanLimitReached ? ' The durable scan limit was reached; some frozen chunks were not inspected.' : ''}`,
    ...(partialReason ? { retrievalPartialReason: partialReason } : {}),
  };
}
