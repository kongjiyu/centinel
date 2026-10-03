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
import { createEmbedding, EmbeddingProviderError } from './embeddingProvider.js';

const CHUNK_SIZE = 2_400;
const CHUNK_OVERLAP = 240;

function chunks(content: string): string[] {
  if (!content) return [];
  const output: string[] = [];
  for (let start = 0; start < content.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(content.length, start + CHUNK_SIZE);
    output.push(content.slice(start, end));
    if (end === content.length) break;
  }
  return output;
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
    const content = await readClientArtifactContent(client, userId, artifact.id, artifact.versionId, signal);
    throwIfAborted(signal);
    const pieces = chunks(content);
    const seen = new Set<string>();
    for (let ordinal = 0; ordinal < pieces.length; ordinal += 1) {
      throwIfAborted(signal);
      const part = pieces[ordinal];
      const contentHash = crypto.createHash('sha256').update(part).digest('hex');
      if (seen.has(contentHash)) continue;
      seen.add(contentHash);
      let embedding: number[] | null = null;
      let embeddingModel: string | null = null;
      if (embeddingConfig && !embeddingErrorCode) {
        const started = Date.now();
        let result: Awaited<ReturnType<typeof createEmbedding>> | null = null;
        try {
          result = await createEmbedding(embeddingConfig, part, signal);
          throwIfAborted(signal);
          embedding = result.embedding;
          embeddingModel = result.model;
        } catch (cause) {
          throwIfAborted(signal);
          embeddingErrorCode = cause instanceof EmbeddingProviderError ? cause.code : 'indexing_provider_unavailable';
        }
        try {
          await store.saveModelUsage({
            projectId, reviewSessionId: reviewId ?? null, ownerId: userId,
            stage: 'source_indexing', attempt: 1, provider: 'custom', model: result?.model ?? embeddingConfig.model,
            outcome: result ? 'success' : 'failure',
            inputTokens: result?.inputTokens ?? null, outputTokens: result ? 0 : null,
            cacheReadTokens: result ? 0 : null, cacheCreationTokens: result ? 0 : null,
            durationMs: Date.now() - started, errorCode: embeddingErrorCode, cost: null,
            metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'embedding', artifactVersionId: artifact.versionId },
          });
        } catch {
          throwIfAborted(signal);
          // Usage persistence cannot turn a successful embedding into a
          // fabricated provider failure; the durable chunk is still saved.
        }
      }
      await store.saveEmbeddingChunk({
        projectId,
        parentType: 'artifact_version',
        parentId: artifact.versionId,
        ordinal,
        content: part,
        contentHash,
        embedding,
        embeddingModel,
        metadata: { artifactId: artifact.id, filePath: artifact.filePath, sourceHash: artifact.contentHash,
          embeddingStatus: embedding ? 'available' : embeddingErrorCode ? 'unavailable' : 'not_configured',
          ...(embeddingErrorCode ? { embeddingErrorCode } : {}) },
      }, signal);
      throwIfAborted(signal);
    }
  }
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
  const versionIds = Array.from(new Set(artifacts.map(item => item.versionId).filter((item): item is string => !!item)));
  if (!versionIds.length) return { files: [], totalSymbols: 0, estimatedTokens: 0, reason: 'No frozen artifact versions are available.' };
  throwIfAborted(signal);
  const tokenBudget = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 100_000;
  const maxChunks = Math.min(16, Math.max(1, Math.ceil(tokenBudget / 600)));
  let rows: Array<Record<string, unknown>> = [];
  let retrievalMode = 'lexical';
  let retrievalDetail = '';
  if (queryText?.trim()) {
    let configuration: Awaited<ReturnType<typeof resolveSavedEmbeddingProvider>> = null;
    try {
      configuration = await resolveSavedEmbeddingProvider(client, userId, signal);
    } catch {
      throwIfAborted(signal);
      retrievalDetail = 'The source-indexing configuration is unavailable.';
    }
    throwIfAborted(signal);
    if (configuration) {
      const started = Date.now();
      let embedded: Awaited<ReturnType<typeof createEmbedding>> | null = null;
      let errorCode: string | null = null;
      try {
        embedded = await createEmbedding(configuration, queryText, signal);
      } catch (cause) {
        throwIfAborted(signal);
        errorCode = cause instanceof EmbeddingProviderError ? cause.code : 'retrieval_provider_unavailable';
        retrievalDetail = 'The source-indexing provider is unavailable.';
      }
      try {
        await new SupabaseCentinelStore(client).saveModelUsage({
          projectId, reviewSessionId: reviewId ?? null, ownerId: userId,
          stage: 'context_retrieval', attempt: 1, provider: 'custom', model: embedded?.model ?? configuration.model,
          outcome: embedded ? 'success' : 'failure', inputTokens: embedded?.inputTokens ?? null,
          outputTokens: embedded ? 0 : null, cacheReadTokens: embedded ? 0 : null,
          cacheCreationTokens: embedded ? 0 : null, durationMs: Date.now() - started,
          errorCode, cost: null, metadata: { apiFormat: 'openai-compatible', callKind: 'review', scope: 'embedding' },
        });
      } catch {
        throwIfAborted(signal);
        // Retrieval remains available even if the usage ledger is temporarily unavailable.
      }
      if (embedded) {
        throwIfAborted(signal);
        try {
          let semanticQuery = client.rpc('match_frozen_artifact_chunks', {
            p_project_id: projectId, p_version_ids: versionIds,
            p_embedding: `[${embedded.embedding.join(',')}]`, p_embedding_model: embedded.model, p_limit: maxChunks,
          });
          if (signal) semanticQuery = semanticQuery.abortSignal(signal);
          const semantic = await semanticQuery;
          throwIfAborted(signal);
          if (!semantic.error && Array.isArray(semantic.data) && semantic.data.length) {
            rows = semantic.data as Array<Record<string, unknown>>;
            retrievalMode = 'similarity';
          } else {
            retrievalDetail = semantic.error
              ? 'The similarity lookup is unavailable; ordered frozen chunks were used.'
              : 'No matching vectors were available; ordered frozen chunks were used.';
          }
        } catch {
          throwIfAborted(signal);
          retrievalDetail = 'The similarity lookup is unavailable; ordered frozen chunks were used.';
        }
      }
    }
  }
  if (!rows.length) {
    let query = client.from('artifact_chunks').select('artifact_version_id,ordinal,content,metadata')
      .eq('project_id', projectId).in('artifact_version_id', versionIds)
      .order('artifact_version_id').order('ordinal').limit(maxChunks);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    throwIfAborted(signal);
    if (result.error) throw new Error(`Durable Review context lookup failed: ${result.error.message}`);
    rows = (result.data ?? []) as Array<Record<string, unknown>>;
  }
  throwIfAborted(signal);
  const byVersion = new Map<string, { artifact: Artifact; text: string; tokens: number }>();
  const artifactByVersion = new Map(artifacts.filter(item => item.versionId).map(item => [item.versionId!, item]));
  let totalTokens = 0;
  const selectedChunks: NonNullable<RetrievedContext['selectedChunks']> = [];
  for (const row of rows) {
    throwIfAborted(signal);
    const versionId = String(row.artifact_version_id ?? '');
    const artifact = artifactByVersion.get(versionId);
    if (!artifact) continue;
    const remaining = Math.max(0, tokenBudget - totalTokens);
    if (!remaining) break;
    const content = String(row.content ?? '').slice(0, remaining * 4);
    const tokens = Math.ceil(content.length / 4);
    const previous = byVersion.get(versionId) ?? { artifact, text: '', tokens: 0 };
    previous.text += content;
    previous.tokens += tokens;
    byVersion.set(versionId, previous);
    selectedChunks.push({ artifactVersionId: versionId, filePath: artifact.filePath, ordinal: Number(row.ordinal ?? 0), content });
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
  return {
    files,
    totalSymbols: 0,
    estimatedTokens: totalTokens,
    selectedChunks,
    reason: `Retrieved ${selectedChunks.length} ${retrievalMode === 'similarity' ? 'similarity-ranked' : 'ordered'} chunk${selectedChunks.length === 1 ? '' : 's'} from ${byVersion.size} frozen artifact version${byVersion.size === 1 ? '' : 's'} in Supabase.${retrievalDetail ? ` ${retrievalDetail}` : ''}`,
  };
}
