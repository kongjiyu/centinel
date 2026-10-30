import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artifact, ArtifactSource, ArtifactType } from '../artifacts.js';
import type { DynamicEvidence, DynamicSession } from '../dynamicSessions.js';
import type { Project } from '../projects.js';
import type { DynamicRun } from '../dynamic/types.js';
import type { Requirement, RequirementMapping } from '../staticDomainTypes.js';
import type { ReviewDecisionRecord } from '../staticDomainTypes.js';
import type { ReviewSourceManifest, ReviewTraceabilitySnapshot } from '../review/evidenceTypes.js';
import type { ProjectAssessment } from '../staticDomainTypes.js';
import { deriveRiskLevel, normalizeRiskPriority, RISK_POLICY_VERSION } from '../riskPolicy.js';
import { calculateProjectRisk } from '../projectRisk.js';
import type { Finding, StaticSession } from '../staticDomainTypes.js';
import type { StoreFinding } from '../store/types.js';
import type { TokenUsageSummary, TokenUsageRow } from '../tokenUsage.js';
import type { ReportActionTrace, ReportCurrentFinding, ReportCurrentFindings, ReportFindingCorrelation, ReportProjectAssessment, ReportStandard, ReportStandardRule } from './types.js';
import type { ReportSnapshotSource } from './snapshot.js';
import { SupabaseCentinelStore } from '../store/supabase.js';
import { loadCurrentProjectFindings } from '../review/currentProjectFindings.js';
import { canonicalProviderTotal } from '../review/stageUsageProjection.js';

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function nullable(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

const SAFE_USAGE_SOURCES = new Set(['provider_response', 'provider_error_response', 'codex_thread_total', 'codex_turn_last']);
const SAFE_USAGE_COUNTERS = new Set(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens']);
const SAFE_USAGE_OUTCOMES = new Set(['in_progress', 'success', 'retryable_error', 'permanent_error', 'malformed_response', 'cancelled']);
const SAFE_NO_RESPONSE_OUTCOMES = new Set(['retryable_error', 'permanent_error', 'malformed_response', 'cancelled']);

function safeUsageObservation(value: unknown): TokenUsageRow['usageObservation'] {
  const source = record(value);
  if (!SAFE_USAGE_SOURCES.has(String(source.source)) || !['complete', 'partial'].includes(String(source.completeness))) return null;
  const missingCounters = Array.isArray(source.missingCounters)
    ? [...new Set(source.missingCounters.filter((item): item is string => typeof item === 'string' && SAFE_USAGE_COUNTERS.has(item)))] : [];
  return { source: source.source as NonNullable<TokenUsageRow['usageObservation']>['source'],
    completeness: source.completeness as NonNullable<TokenUsageRow['usageObservation']>['completeness'],
    ...(missingCounters.length ? { missingCounters: missingCounters as NonNullable<TokenUsageRow['usageObservation']>['missingCounters'] } : {}) };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function traceabilitySummaryFromValue(value: unknown): ReviewTraceabilitySnapshot['summary'] {
  const source = record(json(value, {}));
  const summary: Record<string, number> = {};
  for (const key of ['complete', 'incomplete', 'missing', 'attention', 'unavailable'] as const) {
    const count = source[key];
    if (typeof count === 'number' && Number.isFinite(count)) summary[key] = count;
  }
  return Object.keys(summary).length ? summary as ReviewTraceabilitySnapshot['summary'] : null;
}

function safeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message ?? '');
  return String(error ?? '');
}

/** Keep Supabase's generated generic types out of the adapter's public seam. */
function table(client: SupabaseClient, name: string): any {
  return (client as any).from(name);
}

async function requireRows(client: SupabaseClient, name: string, configure: (query: any) => any): Promise<Row[]> {
  const result = await configure(table(client, name));
  if (result.error) throw new Error(`Supabase ${name} query failed: ${safeError(result.error)}`);
  return Array.isArray(result.data) ? result.data.map(asRow) : [];
}

const REPORT_ROW_PAGE_SIZE = 500;

async function requirePagedRows(client: SupabaseClient, name: string, configure: (query: any) => any): Promise<Row[]> {
  const rows: Row[] = [];
  // A Supabase project can configure a row cap lower than our requested page.
  // Advance by rows actually returned and stop only after an empty page.
  for (let start = 0; ;) {
    const page = await requireRows(client, name, query =>
      configure(query).range(start, start + REPORT_ROW_PAGE_SIZE - 1));
    if (!page.length) return rows;
    rows.push(...page);
    start += page.length;
  }
}

async function requireSingle(client: SupabaseClient, name: string, configure: (query: any) => any): Promise<Row | null> {
  const result = await configure(table(client, name));
  if (result.error) throw new Error(`Supabase ${name} query failed: ${safeError(result.error)}`);
  return result.data ? asRow(result.data) : null;
}

async function assertMember(client: SupabaseClient, userId: string, projectId: string): Promise<void> {
  if (!userId) throw new Error('An authenticated user is required for report snapshots.');
  const result = await table(client, 'projects').select('id').eq('id', projectId).maybeSingle();
  if (result.error) throw new Error(`Supabase project authorization failed: ${safeError(result.error)}`);
  if (!result.data) throw new Error(`You do not have access to project ${projectId}.`);
}

function projectFromRow(row: Row): Project {
  return {
    id: text(row.id), name: text(row.name), description: text(row.description), workspacePath: text(row.workspace_path),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function inferArtifactType(value: unknown, name: string): ArtifactType {
  const normalized = text(value).toLowerCase();
  if (['requirement', 'design', 'source_code', 'coding_standard', 'other'].includes(normalized)) return normalized as ArtifactType;
  if (normalized === 'standard' || normalized === 'coding-standard') return 'coding_standard';
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (['md', 'txt'].includes(extension)) return 'requirement';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cs', 'rs', 'go', 'rb', 'php', 'html', 'css'].includes(extension)) return 'source_code';
  return 'other';
}

function inferArtifactSource(row: Row): ArtifactSource {
  const value = text(row.source || record(row.metadata).source, 'documents');
  if (['documents', 'repository', 'directory', 'drive'].includes(value)) return value as ArtifactSource;
  return 'documents';
}

function artifactFromRow(row: Row, version?: Row): Artifact {
  const metadata = record(row.metadata);
  const name = text(row.name, text(row.path).split('/').pop() ?? 'artifact');
  return {
    id: text(row.id), projectId: text(row.project_id), type: inferArtifactType(row.type ?? row.kind ?? metadata.artifact_type, name),
    source: inferArtifactSource(row), fileName: name, filePath: text(row.path), originalPath: nullable(metadata.original_path),
    contentHash: text(version?.content_hash ?? row.content_hash ?? metadata.content_hash), createdAt: text(row.created_at),
  };
}

function staticSessionFromRow(row: Row): StaticSession {
  return {
    id: text(row.id), projectId: text(row.project_id), name: text(row.name), reviewType: text(row.review_type) as StaticSession['reviewType'],
    status: text(row.status) as StaticSession['status'], configJson: JSON.stringify(row.config ?? {}), progressJson: JSON.stringify(row.progress ?? {}),
    remarks: text(row.remarks), finalSummary: text(row.final_summary ?? row.summary), failureReason: text(row.failure_reason),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at), completedAt: nullable(row.completed_at), sourceManifestId: nullable(row.source_manifest_id), baseRef: text(record(row.scope).baseRef ?? record(row.scope).base_ref),
    headRef: text(record(row.scope).headRef ?? record(row.scope).head_ref), changedFilesJson: JSON.stringify(record(row.scope).changedFiles ?? record(row.scope).changed_files ?? []),
    parentSessionId: text(row.parent_review_id), reviewDiffJson: JSON.stringify(row.lineage ?? {}),
  };
}

function locationOf(row: Row): { filePath: string; lineNumber: number | null } {
  const location = record(row.location);
  const line = location.lineNumber ?? location.line_number ?? row.line_number;
  const number = line == null || line === '' ? null : Number(line);
  return { filePath: text(location.filePath ?? location.file_path ?? location.path ?? row.file_path), lineNumber: Number.isFinite(number) ? number : null };
}

function findingFromRow(row: Row): Finding {
  const location = locationOf(row);
  const priority = normalizeRiskPriority(row.priority);
  return {
    id: text(row.id), projectId: text(row.project_id), sessionId: nullable(row.review_session_id), source: text(row.source, 'static') === 'dynamic' ? 'dynamic' : 'static',
    severity: text(row.severity), priority, riskLevel: deriveRiskLevel(row.severity, priority), title: text(row.title), description: text(row.description),
    status: text(row.status, 'new') as Finding['status'], createdAt: text(row.created_at), artifactId: nullable(row.artifact_id), category: text(row.category),
    evidenceText: text(row.evidence_text), recommendation: text(row.recommendation), confidence: text(row.confidence), fromRemarks: Boolean(row.from_remarks),
    filePath: location.filePath, lineNumber: location.lineNumber,
  };
}

function requirementFromRow(row: Row): Requirement {
  return { id: text(row.id), projectId: text(row.project_id), title: text(row.title), description: text(row.description), category: text(row.category), priority: text(row.priority, 'medium'), createdAt: text(row.created_at) };
}

function mappingFromRow(row: Row): RequirementMapping {
  return {
    id: text(row.id), requirementId: text(row.requirement_id), fileId: nullable(row.file_id ?? row.artifact_id), symbolId: nullable(row.symbol_id),
    coverageStatus: text(row.coverage_status, 'unknown'), confidence: Number(row.confidence ?? 0),
  };
}

function decisionFromRow(row: Row, attachments: ReviewDecisionRecord['attachments']): ReviewDecisionRecord {
  return {
    id: text(row.id), sessionId: text(row.review_session_id), projectId: text(row.project_id), decision: text(row.decision) as ReviewDecisionRecord['decision'],
    comment: text(row.comment), reviewer: text(row.reviewer), createdAt: text(row.created_at), attachments,
  };
}

function usageSummary(rows: Row[], reviewSessionId: string | null): TokenUsageSummary {
  const tokenCount = (value: unknown): number | null => {
    const count = value == null || value === '' ? null : Number(value);
    return count !== null && Number.isSafeInteger(count) && count >= 0 ? count : null;
  };
  const recent: TokenUsageRow[] = rows.map(item => {
    const metadata = record(item.metadata);
    const apiFormat = text(metadata.apiFormat ?? metadata.api_format, 'unknown') as TokenUsageRow['apiFormat'];
    const usage = {
      apiFormat,
      input_tokens: tokenCount(item.input_tokens), output_tokens: tokenCount(item.output_tokens),
      cache_read_tokens: tokenCount(item.cache_read_tokens), cache_creation_tokens: tokenCount(item.cache_creation_tokens), metadata,
    };
    const canonical = canonicalProviderTotal(usage);
    const usageObservation = safeUsageObservation(metadata.usageObservation);
    const accounting = record(metadata.usageAccounting);
    const safeOutcome = typeof item.outcome === 'string' && SAFE_USAGE_OUTCOMES.has(item.outcome)
      ? item.outcome as NonNullable<TokenUsageRow['outcome']> : null;
    const noActualUsage = usage.input_tokens === null && usage.output_tokens === null && usage.cache_read_tokens === null
      && usage.cache_creation_tokens === null && metadata.usageObservation == null
      && metadata.providerReportedTotalTokens == null && metadata.normalizedTotalTokens == null;
    const accountingBasis = metadata.responseReceived === false && safeOutcome !== null
      && SAFE_NO_RESPONSE_OUTCOMES.has(safeOutcome) && noActualUsage
      && accounting.basis === 'assumed_zero_no_response' && accounting.accountedTokens === 0
      ? 'assumed_zero_no_response' as const : null;
    return {
      id: text(item.id), projectId: nullable(item.project_id), sessionId: nullable(item.review_session_id),
      scope: (['text', 'vision', 'embedding'].includes(text(metadata.scope)) ? text(metadata.scope) : 'text') as TokenUsageRow['scope'],
      callKind: 'review', stage: nullable(item.stage), roundNumber: Number(item.attempt ?? 1), provider: text(item.provider) as TokenUsageRow['provider'],
      apiFormat, model: text(item.model),
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_tokens,
      cacheCreationTokens: usage.cache_creation_tokens, totalTokens: canonical.totalTokens, canonicalTotalTokens: canonical.totalTokens,
      providerReportedTotalTokens: tokenCount(metadata.providerReportedTotalTokens),
      totalTokensStatus: canonical.status, createdAt: text(item.created_at),
      outcome: safeOutcome,
      responseReceived: typeof metadata.responseReceived === 'boolean' ? metadata.responseReceived : null,
      usageObservation, accountingBasis, accountedTokens: accountingBasis ? 0 : null,
    };
  });
  const byModel = new Map<string, TokenUsageSummary['byGroup'][number]>();
  for (const item of recent) {
    const key = `${item.provider}|${item.apiFormat}|${item.model}`;
    const current = byModel.get(key) ?? { provider: item.provider, apiFormat: item.apiFormat, model: item.model, totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheCreation: 0, totalCalls: 0,
      totalTokens: 0, providerReportedTotalTokens: 0, providerReportedCalls: 0, unknownTotalCalls: 0, unknownInputCalls: 0, unknownOutputCalls: 0,
      unknownCacheReadCalls: 0, unknownCacheCreationCalls: 0, assumedZeroNoResponseCalls: 0, assumedZeroNoResponseTokens: 0, accountedTokens: 0 };
    current.totalInput += item.inputTokens ?? 0; current.totalOutput += item.outputTokens ?? 0;
    current.totalCacheRead += item.cacheReadTokens ?? 0; current.totalCacheCreation += item.cacheCreationTokens ?? 0; current.totalCalls += 1;
    if (item.inputTokens === null) current.unknownInputCalls = (current.unknownInputCalls ?? 0) + 1;
    if (item.outputTokens === null) current.unknownOutputCalls = (current.unknownOutputCalls ?? 0) + 1;
    if (item.cacheReadTokens === null) current.unknownCacheReadCalls = (current.unknownCacheReadCalls ?? 0) + 1;
    if (item.cacheCreationTokens === null) current.unknownCacheCreationCalls = (current.unknownCacheCreationCalls ?? 0) + 1;
    if (item.totalTokens === null) current.unknownTotalCalls = (current.unknownTotalCalls ?? 0) + 1;
    else { current.totalTokens = (current.totalTokens ?? 0) + item.totalTokens; current.accountedTokens = (current.accountedTokens ?? 0) + item.totalTokens; }
    if (item.accountingBasis === 'assumed_zero_no_response') current.assumedZeroNoResponseCalls = (current.assumedZeroNoResponseCalls ?? 0) + 1;
    const reportedTotal = item.providerReportedTotalTokens ?? null;
    if (reportedTotal !== null) {
      current.providerReportedTotalTokens = (current.providerReportedTotalTokens ?? 0) + reportedTotal;
      current.providerReportedCalls = (current.providerReportedCalls ?? 0) + 1;
    }
    byModel.set(key, current);
  }
  const sumKnown = (field: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'totalTokens') => recent.reduce((sum, item) => sum + (item[field] ?? 0), 0);
  const unknown = (field: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'totalTokens') => recent.filter(item => item[field] === null).length;
  const assumedZeroNoResponseCalls = recent.filter(item => item.accountingBasis === 'assumed_zero_no_response').length;
  const providerReportedTotalTokens = rows.reduce((sum, item) => sum + (tokenCount(record(item.metadata).providerReportedTotalTokens) ?? 0), 0);
  const providerReportedCalls = rows.filter(item => tokenCount(record(item.metadata).providerReportedTotalTokens) !== null).length;
  return {
    totals: {
      input: sumKnown('inputTokens'), output: sumKnown('outputTokens'), cacheRead: sumKnown('cacheReadTokens'), cacheCreation: sumKnown('cacheCreationTokens'), calls: recent.length,
      totalTokens: sumKnown('totalTokens'), providerReportedTotalTokens, providerReportedCalls, unknownTotalCalls: unknown('totalTokens'),
      unknownInputCalls: unknown('inputTokens'), unknownOutputCalls: unknown('outputTokens'),
      unknownCacheReadCalls: unknown('cacheReadTokens'), unknownCacheCreationCalls: unknown('cacheCreationTokens'),
      assumedZeroNoResponseCalls, assumedZeroNoResponseTokens: 0, accountedTokens: sumKnown('totalTokens'),
    }, byGroup: Array.from(byModel.values()), recent,
  };
}

function fallbackAssessment(projectId: string, findings: Finding[]): ProjectAssessment {
  return { projectId, status: 'available', policyVersion: RISK_POLICY_VERSION, ...calculateProjectRisk(findings), traceability: { status: 'unavailable', reviewId: null, summary: null } };
}

function reportCurrentFinding(projected: StoreFinding & Record<string, unknown>, canonical: StoreFinding): ReportCurrentFinding {
  const resolutionEvidence = projected.resolutionEvidence as ReportCurrentFinding['resolutionEvidence'] | undefined;
  const effectiveStatus = (projected.status === 'new' || projected.status === 'carryover')
    && resolutionEvidence?.basis === 'not_reproduced_in_comparable_review'
    ? 'fixed'
    : projected.status;
  const latestOccurrence = projected.latestOccurrence as ReportCurrentFinding['latestOccurrence'] | undefined;
  const lineageHistory = Array.isArray(projected.lineageHistory)
    ? projected.lineageHistory as ReportCurrentFinding['lineageReferences']
    : [];
  const priority = normalizeRiskPriority(projected.priority);
  return {
    id: projected.id,
    projectId: projected.projectId,
    sessionId: text(projected.sessionId ?? projected.reviewSessionId) || null,
    source: projected.source,
    severity: projected.severity,
    priority,
    riskLevel: deriveRiskLevel(projected.severity, priority),
    title: projected.title,
    description: projected.description,
    status: canonical.status,
    persistedStatus: canonical.status,
    effectiveStatus,
    effectiveDisposition: resolutionEvidence ? 'resolved' : effectiveStatus,
    latestOccurrence: latestOccurrence ?? null,
    lineageReferences: lineageHistory.map(item => ({ findingId: item.findingId, reviewId: item.reviewId, classification: item.classification })),
    resolutionEvidence: resolutionEvidence ?? null,
    createdAt: projected.createdAt,
    artifactId: projected.artifactId,
    category: projected.category,
    evidenceText: projected.evidenceText,
    recommendation: projected.recommendation,
    confidence: projected.confidence,
    fromRemarks: false,
    filePath: text(projected.filePath ?? record(projected.location).filePath),
    lineNumber: projected.lineNumber == null ? null : Number(projected.lineNumber),
  };
}

function standardRuleFromRow(row: Row): ReportStandardRule {
  return {
    id: text(row.id), stableKey: text(row.stable_key), title: text(row.title), statement: text(row.statement), category: text(row.category), severity: text(row.severity),
    recommendation: text(row.recommendation), sourceArtifactId: text(row.source_artifact_id), sourceLocator: record(row.source_locator), sourceVersion: text(row.source_version),
    standardVersion: text(row.standard_version), enabled: row.enabled !== false,
  };
}

/** Present a shared Run in the report's Dynamic session shape, following its independent verdict. */
function runReportSession(run: DynamicRun): DynamicSession {
  const status: DynamicSession['status'] = run.state === 'queued' ? 'queued' : run.state === 'running' ? 'running'
    : run.state === 'cancelled' ? 'cancelled'
      : run.state === 'completed' ? (run.verdict === 'passed' ? 'success' : run.verdict === 'failed' ? 'failure' : 'blocked') : 'blocked';
  const passed = run.checks.filter(check => check.verdict === 'passed').length;
  return {
    id: run.id, projectId: run.projectId, type: 'dynamic', name: run.revision.name, status,
    targetUrl: run.environment?.targetUrl ?? run.revision.targetUrl, goal: run.revision.goal,
    missionType: 'user_journey', browserMode: 'headed', maxSteps: run.revision.maxSteps,
    finalSummary: `Revision ${run.revision.revision}: ${passed} of ${run.revision.checks.length} checks passed; verdict ${run.verdict.replace('_', ' ')}.`,
    failureReason: run.reason ?? '', createdAt: run.createdAt, updatedAt: run.updatedAt || run.createdAt,
  };
}

export class SupabaseReportSnapshotSource implements ReportSnapshotSource {
  constructor(readonly client: SupabaseClient, readonly userId: string) {}
  /** Shared Runs read during this snapshot, by ID, so evidence/action reads stay consistent. */
  private readonly runs = new Map<string, DynamicRun>();

  async getProject(projectId: string): Promise<Project | null> {
    await assertMember(this.client, this.userId, projectId);
    const row = await requireSingle(this.client, 'projects', query => query.select('*').eq('id', projectId).maybeSingle());
    return row ? projectFromRow(row) : null;
  }

  async listStaticSessions(projectId: string): Promise<StaticSession[]> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'review_sessions', query => query.select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).order('id'));
    return rows.map(staticSessionFromRow);
  }

  /**
   * Shared Mission/Run records are authoritative; device-local legacy sessions
   * remain only when no shared Run already mirrors them.
   */
  async listDynamicSessions(projectId: string): Promise<DynamicSession[]> {
    await assertMember(this.client, this.userId, projectId);
    const [rows, runRows] = await Promise.all([
      requirePagedRows(this.client, 'dynamic_sessions', query => query.select('*').eq('project_id', projectId)
        .order('created_at', { ascending: false }).order('id')),
      requirePagedRows(this.client, 'dynamic_runs', query => query.select('id,payload').eq('project_id', projectId)
        .order('created_at', { ascending: false }).order('id')),
    ]);
    const runs = runRows.map(row => row.payload as DynamicRun).filter(run => run && typeof run === 'object' && typeof run.id === 'string');
    this.runs.clear();
    for (const run of runs) this.runs.set(run.id, run);
    const mirrored = new Set(runs.map(run => run.legacySessionId).filter((id): id is string => Boolean(id)));
    return [...runs.map(runReportSession), ...rows.filter(row => !mirrored.has(text(row.id))).map(row => ({
      id: text(row.id), projectId: text(row.project_id), type: 'dynamic' as const, name: text(row.name), status: text(row.status) as DynamicSession['status'],
      targetUrl: text(row.target_url), goal: text(row.goal), missionType: text(row.mission_type) as DynamicSession['missionType'], browserMode: text(row.browser_mode, 'headed') as 'headed',
      maxSteps: Number(row.max_steps ?? 20), finalSummary: text(row.final_summary), failureReason: text(row.failure_reason), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
    }))];
  }

  async listDynamicEvidence(projectId: string, sessionId: string): Promise<DynamicEvidence[]> {
    await assertMember(this.client, this.userId, projectId);
    // Run evidence stays on the executing device until explicitly shared; the
    // report lists check outcomes instead of claiming retained files.
    if (this.runs.has(sessionId)) return [];
    const rows = await requirePagedRows(this.client, 'dynamic_evidence', query => query.select('id,type,summary,storage_path,created_at')
      .eq('project_id', projectId).eq('dynamic_session_id', sessionId).order('created_at').order('id'));
    return rows.map(row => ({
      id: text(row.id), type: text(row.type) as DynamicEvidence['type'],
      filePath: text(row.storage_path), summary: text(row.summary), createdAt: text(row.created_at),
    }));
  }

  async listDynamicActions(projectId: string, sessionId: string): Promise<ReportActionTrace[]> {
    await assertMember(this.client, this.userId, projectId);
    const run = this.runs.get(sessionId);
    if (run) {
      const definitions = new Map(run.revision.checks.map(check => [check.id, check]));
      return run.checks.map((result, index) => ({
        step: index + 1, action: 'check',
        target: definitions.get(result.checkId)?.description ?? result.checkId,
        result: `${result.verdict}${result.reason ? `: ${result.reason}` : ''}`,
      }));
    }
    const rows = await requirePagedRows(this.client, 'dynamic_actions', query => query.select('id,step,action,target,result')
      .eq('project_id', projectId).eq('dynamic_session_id', sessionId).order('step').order('id'));
    return rows.map(row => ({
      step: Number(row.step), action: text(row.action), target: text(row.target), result: text(row.result),
    }));
  }

  async listAllFindings(projectId: string): Promise<Finding[]> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'findings', query => query.select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).order('id'));
    return rows.map(findingFromRow);
  }

  async listStaticFindings(projectId: string, reviewId: string): Promise<Finding[]> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'findings', query => query.select('*').eq('project_id', projectId)
      .eq('review_session_id', reviewId).eq('source', 'static').order('created_at', { ascending: false }).order('id'));
    return rows.map(findingFromRow);
  }

  async listArtifacts(projectId: string): Promise<Artifact[]> {
    await assertMember(this.client, this.userId, projectId);
    const [artifactRows, versionRows] = await Promise.all([
      requirePagedRows(this.client, 'artifacts', query => query.select('*').eq('project_id', projectId).order('path').order('id')),
      requirePagedRows(this.client, 'artifact_versions', query => query.select('*').eq('project_id', projectId)
        .order('version_number', { ascending: false }).order('id')),
    ]);
    const latest = new Map<string, Row>();
    for (const version of versionRows) if (!latest.has(text(version.artifact_id))) latest.set(text(version.artifact_id), version);
    // The authoritative report inventory is version-backed. A legacy artifact
    // row without a Storage-backed version cannot supply a reproducible hash,
    // so it is intentionally omitted until it is imported as a version.
    return artifactRows.map(item => artifactFromRow(item, latest.get(text(item.id)))).filter(item => Boolean(item.contentHash));
  }

  async listRequirements(projectId: string): Promise<Requirement[]> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'requirements', query => query.select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).order('id'));
    return rows.map(requirementFromRow);
  }

  async getRequirementMappings(requirementId: string): Promise<RequirementMapping[]> {
    const requirement = await requireSingle(this.client, 'requirements', query => query.select('id, project_id').eq('id', requirementId).maybeSingle());
    if (!requirement) return [];
    await assertMember(this.client, this.userId, text(requirement.project_id));
    const rows = await requirePagedRows(this.client, 'requirement_mappings', query => query.select('*').eq('requirement_id', requirementId)
      .order('created_at').order('id'));
    return rows.map(mappingFromRow);
  }

  async listStandards(projectId: string): Promise<ReportStandard[]> {
    await assertMember(this.client, this.userId, projectId);
    const [standards, rules, artifacts] = await Promise.all([
      requirePagedRows(this.client, 'project_standards', query => query.select('*').eq('project_id', projectId).order('code').order('id')),
      requirePagedRows(this.client, 'project_standard_rules', query => query.select('*').eq('project_id', projectId).order('stable_key').order('id')),
      this.listArtifacts(projectId),
    ]);
    const rulesByStandard = new Map<string, ReportStandardRule[]>();
    for (const source of rules) {
      const item = standardRuleFromRow(source);
      const list = rulesByStandard.get(text(source.standard_id)) ?? [];
      list.push(item);
      rulesByStandard.set(text(source.standard_id), list);
    }
    return standards.map(standard => {
      const standardRules = rulesByStandard.get(text(standard.id)) ?? [];
      const artifact = artifacts.find(item => item.id === text(standard.metadata && record(standard.metadata).artifact_id));
      const metadata = record(standard.metadata);
      return {
        artifactId: artifact?.id ?? text(standard.id), standardId: text(standard.id), code: text(standard.code), title: text(standard.title), source: text(standard.source, 'manual'),
        path: text(metadata.path ?? artifact?.filePath), contentHash: artifact?.contentHash ?? text(metadata.content_hash), version: nullable(standard.version),
        structuredRulesStatus: standardRules.length ? 'available' : 'unavailable', rules: standardRules,
      };
    });
  }

  private async loadProjectAssessment(projectId: string): Promise<ReportProjectAssessment> {
    await assertMember(this.client, this.userId, projectId);
    // Finding dispositions can change after the latest stored Review risk
    // snapshot. Recompute current risk for the dashboard and every export;
    // capture the same reconciled projection for risk and export inventory.
    const saved = await new SupabaseCentinelStore(this.client).listFindings(projectId);
    const projected = await loadCurrentProjectFindings(this.client, projectId, saved);
    const savedById = new Map(saved.map(finding => [finding.id, finding]));
    const currentItems = projected.map(finding => {
      const canonical = savedById.get(finding.id);
      if (!canonical) throw new Error('Current finding projection refers to a missing canonical finding.');
      return reportCurrentFinding(finding as StoreFinding & Record<string, unknown>, canonical);
    });
    const currentFindings: ReportCurrentFindings = { status: 'available', reason: null, items: currentItems };
    const current = fallbackAssessment(projectId, currentItems.map(finding => ({
      id: finding.id, projectId: finding.projectId, sessionId: finding.sessionId,
      source: finding.source, severity: finding.severity, priority: finding.priority,
      title: finding.title, description: finding.description, status: finding.effectiveStatus,
      createdAt: finding.createdAt, artifactId: finding.artifactId, category: finding.category,
      evidenceText: finding.evidenceText, recommendation: finding.recommendation,
      confidence: finding.confidence, fromRemarks: false, filePath: finding.filePath, lineNumber: finding.lineNumber,
    })));
    const assessment = await requireSingle(this.client, 'project_assessments', query => query.select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle());
    if (assessment?.snapshot) {
      const snapshot = json<ProjectAssessment>(assessment.snapshot, current);
      if (snapshot.projectId === projectId || !snapshot.projectId) return { ...current, traceability: snapshot.traceability ?? current.traceability, currentFindings };
    }
    const reviewAssessment = await requireSingle(this.client, 'review_assessments', query => query.select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle());
    if (reviewAssessment) {
      const details = record(reviewAssessment.details);
      const snapshot = json<ProjectAssessment>(details.snapshot, current);
      if (snapshot.projectId === projectId && snapshot.traceability) return { ...current, traceability: snapshot.traceability, currentFindings };
    }
    return { ...current, currentFindings };
  }

  async getProjectAssessment(projectId: string): Promise<ProjectAssessment> {
    const report = await this.loadProjectAssessment(projectId);
    return {
      projectId: report.projectId,
      status: report.status,
      policyVersion: report.policyVersion,
      summary: report.summary,
      riskItems: report.riskItems,
      traceability: report.traceability,
    };
  }

  async getProjectAssessmentWithCurrentFindings(projectId: string): Promise<ReportProjectAssessment> {
    return this.loadProjectAssessment(projectId);
  }

  async getReviewSourceManifest(projectId: string, reviewId: string): Promise<ReviewSourceManifest | null> {
    await assertMember(this.client, this.userId, projectId);
    const review = await requireSingle(this.client, 'review_sessions', query => query.select('source_manifest_id').eq('project_id', projectId).eq('id', reviewId).maybeSingle());
    const sourceManifestId = nullable(review?.source_manifest_id);
    const source = sourceManifestId
      ? await requireSingle(this.client, 'review_source_snapshots', query => query.select('*').eq('project_id', projectId).eq('id', sourceManifestId).maybeSingle())
      : await requireSingle(this.client, 'review_source_snapshots', query => query.select('*').eq('project_id', projectId).eq('review_session_id', reviewId).maybeSingle());
    if (!source) return null;
    const snapshot = json<Record<string, unknown>>(source.snapshot, {});
    const sources = Array.isArray(snapshot.sources) ? snapshot.sources as ReviewSourceManifest['sources'] : [];
    return { sessionId: reviewId, projectId, status: text(source.status, 'available') as ReviewSourceManifest['status'], capturedAt: text(source.created_at), updatedAt: text(source.created_at), sources, artifactCount: snapshot.artifactCount == null ? (sources.length ? new Set(sources.flatMap(item => item.artifactIds)).size : null) : Number(snapshot.artifactCount) };
  }

  async getReviewTraceabilitySnapshot(projectId: string, reviewId: string): Promise<ReviewTraceabilitySnapshot | null> {
    await assertMember(this.client, this.userId, projectId);
    const source = await requireSingle(this.client, 'review_traceability_snapshots', query => query.select('*').eq('project_id', projectId).eq('review_session_id', reviewId).maybeSingle());
    if (!source) return null;
    return { sessionId: reviewId, projectId, status: text(source.status, 'unavailable') as ReviewTraceabilitySnapshot['status'], records: json(source.records, []), summary: traceabilitySummaryFromValue(source.summary), capturedAt: text(source.created_at), updatedAt: text(source.created_at) };
  }

  async getCurrentDecision(projectId: string, reviewId: string): Promise<ReviewDecisionRecord | null> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'review_decisions', query => query.select('*').eq('project_id', projectId)
      .eq('review_session_id', reviewId).order('created_at', { ascending: false }).order('id'));
    const source = rows.find(item => text(item.decision) !== 'commented');
    if (!source) return null;
    const attachments = await requirePagedRows(this.client, 'review_decision_attachments', query => query.select('*')
      .eq('decision_id', text(source.id)).order('created_at').order('id'));
    return decisionFromRow(source, attachments.map(item => ({ id: text(item.id), fileName: text(item.file_name), mimeType: text(item.mime_type), createdAt: text(item.created_at) })));
  }

  async getTokenUsageSummary(projectId: string, reviewId?: string): Promise<TokenUsageSummary> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'model_usage_records', query => {
      const scoped = query.select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id');
      return reviewId ? scoped.eq('review_session_id', reviewId) : scoped;
    });
    return usageSummary(rows, reviewId ?? null);
  }

  async getCorrelations(projectId: string, reviewId: string): Promise<ReportFindingCorrelation[]> {
    await assertMember(this.client, this.userId, projectId);
    const rows = await requirePagedRows(this.client, 'review_finding_correlations', query => query.select('*')
      .eq('project_id', projectId).eq('child_review_id', reviewId).order('created_at').order('id'));
    return rows.map(item => ({
      id: text(item.id), parentReviewId: text(item.parent_review_id), childReviewId: text(item.child_review_id), parentFindingId: nullable(item.parent_finding_id), childFindingId: nullable(item.child_finding_id),
      classification: text(item.classification), method: text(item.method), score: Number(item.score ?? 0), stableFingerprint: text(item.stable_fingerprint), detail: record(item.detail), createdAt: text(item.created_at),
    }));
  }
}

export function createSupabaseReportSnapshotSource(client: SupabaseClient, userId: string): ReportSnapshotSource {
  return new SupabaseReportSnapshotSource(client, userId);
}
