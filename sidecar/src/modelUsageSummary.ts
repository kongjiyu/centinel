import type { SupabaseClient } from '@supabase/supabase-js';
import type { TokenUsageSummary, TokenUsageRow, TokenUsageListFilter } from './tokenUsage.js';
import {
  canonicalProviderTotal,
  projectReviewUsageAccounting,
  type PhysicalSourceRead,
  type ReviewUsageProjection,
  type ReviewUsageStageState,
  type ReviewUsageAttemptRow,
} from './review/stageUsageProjection.js';
import { sourceManifestReference, type ReviewSourcePacketReference } from './review/usageContext.js';
import { projectBatchCacheUsage } from './review/batchCacheUsage.js';

type UsageRecord = ReviewUsageAttemptRow & {
  project_id: string | null;
  review_session_id: string | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  error_code?: unknown;
  duration_ms?: unknown;
};

type AuditRecord = {
  id?: string;
  event_type?: unknown;
  payload?: unknown;
  created_at?: unknown;
};

const SAFE_OUTCOMES = new Set(['in_progress', 'success', 'retryable_error', 'permanent_error', 'malformed_response', 'cancelled']);
const SAFE_NO_RESPONSE_OUTCOMES = new Set(['retryable_error', 'permanent_error', 'malformed_response', 'cancelled']);
const SAFE_ERROR_CODES = new Set([
  'assessment_paused', 'provider_not_configured', 'not_configured', 'secret_unavailable', 'invalid_credentials',
  'quota_exhausted', 'rate_limited', 'credits_exhausted', 'billing_required', 'context_limit', 'context_length_exceeded',
  'malformed_response', 'timeout', 'network_error', 'attempt_budget_exhausted',
  'codex_not_connected', 'codex_unavailable', 'codex_turn_failed', 'codex_timeout', 'codex_invalid_response',
  'codex_identity_required', 'codex_model_unavailable', 'codex_vision_unsupported', 'codex_capacity',
  'codex_context_window_exceeded', 'codex_http_connection_failed', 'codex_stream_connection_failed', 'codex_stream_disconnected',
  'codex_attempts_exhausted', 'codex_bad_request', 'codex_unauthorized', 'codex_sandbox_error', 'codex_internal_error', 'codex_other_error',
]);
const WORKFLOW_STAGES = ['freezing_sources', 'indexing_context', 'deterministic_analysis', 'model_analysis', 'persisting_evidence'];
const HARNESS_EVENTS = ['harness_step_started', 'harness_step_completed', 'harness_step_failed', 'harness_step_cancelled'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonNegativeInteger(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

const SAFE_USAGE_SOURCES = new Set(['provider_response', 'provider_error_response', 'codex_thread_total', 'codex_turn_last']);
const SAFE_USAGE_COUNTERS = new Set(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens']);

function safeUsageObservation(value: unknown): TokenUsageRow['usageObservation'] {
  const observation = asRecord(value);
  if (!SAFE_USAGE_SOURCES.has(String(observation.source))
    || observation.completeness !== 'complete' && observation.completeness !== 'partial') return null;
  const missingCounters = Array.isArray(observation.missingCounters)
    ? [...new Set(observation.missingCounters.filter((counter): counter is string => typeof counter === 'string' && SAFE_USAGE_COUNTERS.has(counter)))] : [];
  return { source: observation.source as NonNullable<TokenUsageRow['usageObservation']>['source'],
    completeness: observation.completeness,
    ...(missingCounters.length ? { missingCounters: missingCounters as NonNullable<TokenUsageRow['usageObservation']>['missingCounters'] } : {}) };
}

function safeUsageAccounting(value: unknown, row: UsageRecord): TokenUsageRow['accountingBasis'] {
  const metadata = row.metadata ?? {};
  const accounting = asRecord(value);
  const noActualUsage = row.input_tokens == null && row.output_tokens == null
    && row.cache_read_tokens == null && row.cache_creation_tokens == null
    && metadata.usageObservation == null && metadata.providerReportedTotalTokens == null
    && metadata.normalizedTotalTokens == null;
  return typeof row.outcome === 'string' && SAFE_NO_RESPONSE_OUTCOMES.has(row.outcome)
    && metadata.responseReceived === false && noActualUsage
    && accounting.basis === 'assumed_zero_no_response' && accounting.accountedTokens === 0
    ? 'assumed_zero_no_response' : null;
}

function safeDiagnostics(row: UsageRecord): Pick<TokenUsageRow, 'outcome' | 'errorCode' | 'durationMs' | 'statusCode' | 'responseReceived' | 'usageObservation' | 'accountingBasis' | 'accountedTokens' | 'indexTrigger' | 'indexFingerprint'> {
  const metadata = row.metadata ?? {};
  const accountingBasis = safeUsageAccounting(metadata.usageAccounting, row);
  return {
    outcome: typeof row.outcome === 'string' && SAFE_OUTCOMES.has(row.outcome) ? row.outcome as TokenUsageRow['outcome'] : null,
    errorCode: typeof row.error_code === 'string' && (SAFE_ERROR_CODES.has(row.error_code) || /^http_[1-5]\d{2}$/.test(row.error_code)) ? row.error_code : null,
    durationMs: typeof row.duration_ms === 'number' && Number.isFinite(row.duration_ms) && row.duration_ms >= 0 ? row.duration_ms : null,
    statusCode: typeof metadata.statusCode === 'number' && Number.isInteger(metadata.statusCode) && metadata.statusCode >= 100 && metadata.statusCode <= 599 ? metadata.statusCode : null,
    responseReceived: typeof metadata.responseReceived === 'boolean' ? metadata.responseReceived : null,
    usageObservation: safeUsageObservation(metadata.usageObservation),
    accountingBasis,
    accountedTokens: accountingBasis === 'assumed_zero_no_response' ? 0 : null,
    indexTrigger: metadata.indexTrigger === 'source_changed' || metadata.indexTrigger === 'review' ? metadata.indexTrigger : null,
    indexFingerprint: typeof metadata.indexFingerprint === 'string' && /^[a-f\d]{64}$/.test(metadata.indexFingerprint) ? metadata.indexFingerprint : null,
  };
}

function usageKind(row: UsageRecord): TokenUsageRow['callKind'] {
  const value = row.metadata?.callKind;
  return value === 'test' || value === 'dynamic' ? value : 'review';
}

function usageScope(row: UsageRecord): TokenUsageRow['scope'] {
  return row.metadata?.scope === 'embedding' || row.stage === 'embedding-provider-test' ? 'embedding'
    : row.metadata?.scope === 'vision' || row.stage === 'vision-provider-test' ? 'vision' : 'text';
}

function sourceDescriptors(value: unknown): Map<string, ReviewSourcePacketReference> {
  const snapshot = asRecord(value);
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
  const result = new Map<string, ReviewSourcePacketReference>();
  for (const artifact of artifacts) {
    const reference = sourceManifestReference(artifact);
    if (reference && !result.has(reference.artifactId)) result.set(reference.artifactId, reference);
  }
  return result;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function physicalReadsFromAudit(events: AuditRecord[], sources: Map<string, ReviewSourcePacketReference>): PhysicalSourceRead[] {
  const executions = new Map<string, { artifactId: string | null; outcome: PhysicalSourceRead['outcome']; characters: number | null; lines: number | null; hashChecked: boolean | null }>();
  for (const event of events) {
    const eventType = typeof event.event_type === 'string' ? event.event_type : '';
    if (!HARNESS_EVENTS.includes(eventType)) continue;
    const payload = asRecord(event.payload);
    const detail = asRecord(payload.detail);
    if (detail.step !== 'read_source') continue;
    const executionId = typeof detail.executionId === 'string' ? detail.executionId : `missing-execution:${String(event.id ?? executions.size)}`;
    const input = asRecord(detail.input);
    const output = asRecord(detail.output);
    const prior = executions.get(executionId) ?? {
      artifactId: typeof input.artifactId === 'string' ? input.artifactId : null,
      outcome: 'in_progress' as const,
      characters: null,
      lines: null,
      hashChecked: null,
    };
    if (typeof input.artifactId === 'string') prior.artifactId = input.artifactId;
    if (eventType === 'harness_step_completed') {
      prior.outcome = 'success';
      prior.characters = safeInteger(output.characters);
      prior.lines = safeInteger(output.lines);
      prior.hashChecked = typeof output.hashChecked === 'boolean' ? output.hashChecked : null;
    } else if (eventType === 'harness_step_failed') prior.outcome = 'failed';
    else if (eventType === 'harness_step_cancelled') prior.outcome = 'cancelled';
    executions.set(executionId, prior);
  }
  return [...executions.values()].map(read => ({
    source: read.artifactId ? sources.get(read.artifactId) ?? null : null,
    outcome: read.outcome,
    characters: read.characters,
    lines: read.lines,
    hashChecked: read.hashChecked,
  }));
}

function progressStageStates(
  status: unknown,
  progressValue: unknown,
  records: ReviewUsageAttemptRow[] = [],
  physicalReads: PhysicalSourceRead[] | null = null,
): Record<string, ReviewUsageStageState> {
  const progress = asRecord(progressValue);
  const current = typeof progress.stage === 'string' ? progress.stage : null;
  const providerPaused = current === 'provider_paused' || typeof progress.pauseCode === 'string';
  const completed = new Set(Array.isArray(progress.completedStages)
    ? progress.completedStages.filter((item): item is string => typeof item === 'string') : []);
  const successful = ['pending_approval', 'completed', 'approved', 'changes_requested'].includes(String(status));
  const stopped = ['failed', 'blocked', 'cancelled'].includes(String(status));
  const terminalProgress = ['failed', 'blocked', 'cancelled'].includes(String(current));
  const observedStages = new Set<string>();
  for (const row of records) {
    const operation = row.stage;
    observedStages.add(operation === 'source_indexing' || operation === 'context_retrieval' ? 'indexing_context'
      : operation === 'model_analysis' || operation.startsWith('model_analysis:') ? 'model_analysis' : operation);
  }
  if (physicalReads?.length) observedStages.add('freezing_sources');
  const pausedObservedStage = providerPaused
    ? WORKFLOW_STAGES.find(stage => !completed.has(stage) && observedStages.has(stage))
    : undefined;
  const result: Record<string, ReviewUsageStageState> = {};
  for (const stage of WORKFLOW_STAGES) {
    result[stage] = completed.has(stage) ? 'completed'
      : providerPaused && stage === pausedObservedStage ? 'stopped'
      : current === stage ? successful ? 'completed' : stopped ? 'stopped' : 'running'
        : successful && current === 'complete' ? 'completed'
          : stopped && (terminalProgress || current === null) && observedStages.has(stage) ? 'stopped'
            : 'not_reached';
  }
  return result;
}

async function reviewUsageProjection(
  client: SupabaseClient,
  projectId: string,
  sessionId: string,
  records: ReviewUsageAttemptRow[],
): Promise<ReviewUsageProjection> {
  let physicalReads: PhysicalSourceRead[] | null = null;
  let stageStates: Record<string, ReviewUsageStageState> | undefined;
  let sessionStatus: unknown;
  let sessionProgress: unknown;
  let sourceManifestId: string | null = null;
  let hasManifest = false;
  let manifestSources = new Map<string, ReviewSourcePacketReference>();
  let sawHarnessEvents = false;

  try {
    const sessionResult = await client.from('review_sessions').select('status,progress,source_manifest_id')
      .eq('project_id', projectId).eq('id', sessionId).maybeSingle();
    if (!sessionResult.error && sessionResult.data) {
      const session = asRecord(sessionResult.data);
      sessionStatus = session.status;
      sessionProgress = session.progress;
      sourceManifestId = typeof session.source_manifest_id === 'string' && session.source_manifest_id.trim()
        ? session.source_manifest_id : null;
    }
  } catch { /* The enclosing authenticated route already validated the session. */ }

  try {
    const manifestQuery = client.from('review_source_snapshots').select('snapshot').eq('project_id', projectId);
    // Saved-source retries own the parent's immutable snapshot by ID. That
    // snapshot's original review_session_id does not become the child's ID.
    const manifestResult = await (sourceManifestId ? manifestQuery.eq('id', sourceManifestId)
      : manifestQuery.eq('review_session_id', sessionId)).maybeSingle();
    if (!manifestResult.error && manifestResult.data) {
      manifestSources = sourceDescriptors(asRecord(manifestResult.data).snapshot);
      hasManifest = true;
    }
  } catch { /* Missing historical snapshots stay unavailable in the projection. */ }

  const auditRows: AuditRecord[] = [];
  let auditComplete = false;
  try {
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const result = await client.from('audit_events').select('id,event_type,payload,created_at')
        .eq('project_id', projectId).eq('entity_type', 'review').eq('entity_id', sessionId)
        .in('event_type', [...HARNESS_EVENTS, 'review_batch_cache_reused'])
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      const page = (result.data ?? []) as AuditRecord[];
      auditRows.push(...page);
      if (page.length < pageSize) break;
    }
    auditComplete = true;
    sawHarnessEvents = auditRows.length > 0;
    if (sawHarnessEvents) physicalReads = physicalReadsFromAudit(auditRows, manifestSources);
    else if (hasManifest && manifestSources.size === 0 && stageStates?.freezing_sources === 'completed') physicalReads = [];
  } catch { /* We expose physical inventory as unavailable instead of guessing. */ }

  if (sessionStatus !== undefined) stageStates = progressStageStates(sessionStatus, sessionProgress, records, physicalReads);

  return { ...projectReviewUsageAccounting({ records, physicalReads, stageStates, knownWorkflowStages: WORKFLOW_STAGES,
    allowedSourceFiles: hasManifest ? manifestSources : null }),
    reusedAssessments: projectBatchCacheUsage(auditComplete ? auditRows : null, hasManifest ? manifestSources : null) };
}

/** Account-scoped Settings usage is read from the same Supabase ledger that
 * Review execution writes. Review-specific details join only safe, scoped
 * manifest and harness metadata; source bodies are never queried. */
export async function getSupabaseModelUsageSummary(
  client: SupabaseClient,
  ownerId: string,
  filter: TokenUsageListFilter = {},
): Promise<TokenUsageSummary & { reviewUsage?: ReviewUsageProjection }> {
  const rows: UsageRecord[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('model_usage_records').select('*').eq('owner_id', ownerId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (filter.projectId) query = query.eq('project_id', filter.projectId);
    if (filter.sessionId) query = query.eq(filter.callKind === 'dynamic' ? 'metadata->>dynamicSessionId' : 'review_session_id', filter.sessionId);
    const result = await query;
    if (result.error) throw new Error(`Supabase model usage query failed: ${result.error.message}`);
    const page = (result.data ?? []) as UsageRecord[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  // Stable ordering plus ID deduplication prevents overlapping offset pages
  // from inflating token totals when rows change during pagination.
  const uniqueRows = [...new Map(rows.map(row => [row.id, row])).values()];

  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0,
    totalTokens: 0, providerReportedTotalTokens: 0, providerReportedCalls: 0, unknownTotalCalls: 0,
    unknownInputCalls: 0, unknownOutputCalls: 0, unknownCacheReadCalls: 0, unknownCacheCreationCalls: 0,
    assumedZeroNoResponseCalls: 0, assumedZeroNoResponseTokens: 0, accountedTokens: 0 };
  const groups = new Map<string, TokenUsageSummary['byGroup'][number]>();
  const recent: TokenUsageRow[] = [];
  const reviewRows: ReviewUsageAttemptRow[] = [];
  for (const row of uniqueRows) {
    const callKind = usageKind(row);
    const scope = usageScope(row);
    if (filter.sessionId && callKind === 'review') {
      const metadata = row.metadata ?? {};
      reviewRows.push({ ...row, apiFormat: typeof metadata.apiFormat === 'string' ? metadata.apiFormat : 'unknown' });
    }
    if (filter.scope && filter.scope !== scope) continue;
    if (filter.callKind && filter.callKind !== callKind) continue;
    const inputTokens = nonNegativeInteger(row.input_tokens) ?? 0;
    const outputTokens = nonNegativeInteger(row.output_tokens) ?? 0;
    const cacheReadValue = nonNegativeInteger(row.cache_read_tokens);
    const cacheCreationValue = nonNegativeInteger(row.cache_creation_tokens);
    const cacheReadTokens = cacheReadValue ?? 0;
    const cacheCreationTokens = cacheCreationValue ?? 0;
    const metadata = row.metadata ?? {};
    const apiFormat = typeof metadata.apiFormat === 'string' ? metadata.apiFormat : 'openai';
    const provider = row.provider as TokenUsageRow['provider'];
    const canonical = canonicalProviderTotal({ ...row, apiFormat, metadata });
    const providerReportedTotal = nonNegativeInteger(metadata.providerReportedTotalTokens);
    const key = `${row.provider}\u0000${apiFormat}\u0000${row.model}`;
    const group = groups.get(key) ?? {
      provider,
      apiFormat: apiFormat as TokenUsageRow['apiFormat'],
      model: row.model,
      totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheCreation: 0, totalCalls: 0,
      totalTokens: 0, providerReportedTotalTokens: 0, providerReportedCalls: 0, unknownTotalCalls: 0,
      unknownInputCalls: 0, unknownOutputCalls: 0, unknownCacheReadCalls: 0, unknownCacheCreationCalls: 0,
      assumedZeroNoResponseCalls: 0, assumedZeroNoResponseTokens: 0, accountedTokens: 0,
    };
    group.totalInput += inputTokens;
    group.totalOutput += outputTokens;
    group.totalCacheRead += cacheReadTokens;
    group.totalCacheCreation += cacheCreationTokens;
    group.totalCalls++;
    if (nonNegativeInteger(row.input_tokens) === null) {
      group.unknownInputCalls = (group.unknownInputCalls ?? 0) + 1;
      totals.unknownInputCalls++;
    }
    if (nonNegativeInteger(row.output_tokens) === null) {
      group.unknownOutputCalls = (group.unknownOutputCalls ?? 0) + 1;
      totals.unknownOutputCalls++;
    }
    if (cacheReadValue === null) {
      group.unknownCacheReadCalls = (group.unknownCacheReadCalls ?? 0) + 1;
      totals.unknownCacheReadCalls++;
    }
    if (cacheCreationValue === null) {
      group.unknownCacheCreationCalls = (group.unknownCacheCreationCalls ?? 0) + 1;
      totals.unknownCacheCreationCalls++;
    }
    if (canonical.totalTokens === null) { group.unknownTotalCalls = (group.unknownTotalCalls ?? 0) + 1; totals.unknownTotalCalls++; }
    else { group.totalTokens = (group.totalTokens ?? 0) + canonical.totalTokens; totals.totalTokens += canonical.totalTokens; }
    const accountingBasis = safeUsageAccounting(metadata.usageAccounting, row);
    if (accountingBasis === 'assumed_zero_no_response') {
      group.assumedZeroNoResponseCalls = (group.assumedZeroNoResponseCalls ?? 0) + 1;
      group.assumedZeroNoResponseTokens = (group.assumedZeroNoResponseTokens ?? 0) + 0;
      totals.assumedZeroNoResponseCalls++;
      totals.assumedZeroNoResponseTokens += 0;
    }
    if (canonical.totalTokens !== null) {
      group.accountedTokens = (group.accountedTokens ?? 0) + canonical.totalTokens;
      totals.accountedTokens += canonical.totalTokens;
    }
    if (providerReportedTotal === null) { /* provider total remains explicitly unknown */ }
    else {
      group.providerReportedTotalTokens = (group.providerReportedTotalTokens ?? 0) + providerReportedTotal;
      group.providerReportedCalls = (group.providerReportedCalls ?? 0) + 1;
      totals.providerReportedTotalTokens += providerReportedTotal;
      totals.providerReportedCalls++;
    }
    groups.set(key, group);
    totals.input += inputTokens;
    totals.output += outputTokens;
    totals.cacheRead += cacheReadTokens;
    totals.cacheCreation += cacheCreationTokens;
    totals.calls++;
    if (recent.length < 50) recent.push({
      id: row.id,
      projectId: row.project_id,
      sessionId: row.review_session_id ?? (typeof metadata.dynamicSessionId === 'string' ? metadata.dynamicSessionId : null),
      scope,
      callKind,
      stage: row.stage,
      roundNumber: row.attempt,
      provider,
      apiFormat: apiFormat as TokenUsageRow['apiFormat'],
      model: row.model,
      inputTokens: nonNegativeInteger(row.input_tokens), outputTokens: nonNegativeInteger(row.output_tokens),
      cacheReadTokens: cacheReadValue, cacheCreationTokens: cacheCreationValue,
      totalTokens: canonical.totalTokens,
      canonicalTotalTokens: canonical.totalTokens,
      providerReportedTotalTokens: nonNegativeInteger(metadata.providerReportedTotalTokens),
      totalTokensStatus: canonical.status,
      createdAt: row.created_at,
      ...safeDiagnostics(row),
    });
  }

  const result: TokenUsageSummary & { reviewUsage?: ReviewUsageProjection } = {
    totals,
    byGroup: [...groups.values()].sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0)),
    recent,
  };
  if (filter.sessionId && filter.projectId && filter.callKind !== 'dynamic' && (filter.callKind ?? 'review') === 'review') {
    result.reviewUsage = await reviewUsageProjection(client, filter.projectId, filter.sessionId, reviewRows);
  }
  return result;
}
