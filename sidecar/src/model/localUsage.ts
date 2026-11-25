import { localReviewUsageProjection, summarizeModelUsageRows, type UsageRecord } from '../modelUsageSummary.js';
import type { ModelUsageRecord } from '../review/usageAudit.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import type { StoreModelUsage } from '../store/types.js';
import type { TokenUsageListFilter } from '../tokenUsage.js';

function usageRow(item: StoreModelUsage): UsageRecord {
  return { id: item.id, project_id: item.projectId, review_session_id: item.reviewSessionId, stage: item.stage,
    attempt: item.attempt, apiFormat: String(item.metadata.apiFormat ?? 'unknown'), provider: item.provider, model: item.model,
    outcome: item.outcome, input_tokens: item.inputTokens, output_tokens: item.outputTokens, cache_read_tokens: item.cacheReadTokens,
    cache_creation_tokens: item.cacheCreationTokens, created_at: item.createdAt, duration_ms: item.durationMs,
    error_code: item.errorCode, metadata: item.metadata };
}

function attemptRow(owner: string, item: ModelUsageRecord, review: boolean): UsageRecord {
  const usage = item.usage;
  return usageRow({ id: item.id!, ownerId: owner, projectId: item.projectId, reviewSessionId: review ? item.reviewId : null,
    stage: item.stage, attempt: item.attempt, provider: item.provider, model: item.model, outcome: item.outcome,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheCreationTokens: usage?.cacheCreationTokens ?? null, durationMs: item.durationMs, errorCode: item.errorCode ?? null,
    cost: null, createdAt: item.createdAt, metadata: { apiFormat: item.apiFormat, callKind: 'review',
      scope: item.stage === 'source_indexing' ? 'embedding' : item.stage.startsWith('model_analysis:pdf_visual:') ? 'vision' : 'text',
      responseReceived: item.responseReceived, usageObservation: item.usageObservation ?? usage?.usageObservation,
      usageAccounting: item.usageAccounting, usageContext: item.usageContext, statusCode: item.statusCode,
      providerReportedTotalTokens: usage?.providerReportedTotalTokens, normalizedTotalTokens: usage?.totalTokens,
      normalizedTotalTokensSource: usage?.totalTokensSource,
    } });
}

export async function getLocalModelUsageSummary(workspace: LocalWorkspace, owner: string, filter: TokenUsageListFilter = {}) {
  const { reviews, conversation, grounding, direct, index, archived } = workspace.modelUsageRecords(owner, filter.projectId, filter.sessionId, filter.callKind === 'dynamic');
  const archivedIds = new Set(archived.map(item => item.id));
  const rows = [...reviews.filter(item => !archivedIds.has(item.id!)).map(item => attemptRow(owner, item, true)),
    ...[...conversation, ...grounding].map(item => attemptRow(owner, item, false)), ...[...direct, ...index, ...archived].map(usageRow)]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const { result, reviewRows } = summarizeModelUsageRows(rows, filter);
  if (filter.projectId && filter.sessionId && (filter.callKind ?? 'review') === 'review') {
    const repository = workspace.reviews(owner);
    const review = await repository.getReview(filter.sessionId);
    if (review?.projectId === filter.projectId) {
      const artifacts = review.sourceManifestId ? await repository.loadSourceManifestArtifacts(review.sourceManifestId) : null;
      const audit = await repository.listAudit(filter.projectId, review.id);
      result.reviewUsage = localReviewUsageProjection(reviewRows, artifacts, audit.map((item, index) => ({
        id: String(index), event_type: item.event, created_at: item.createdAt, payload: { detail: item.detail },
      })), review.status, review.progress);
    }
  }
  return result;
}
