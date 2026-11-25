import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clientArtifact } from '../applicationApi.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import type { AuthenticatedRequest } from '../auth/gateway.js';
import type { ConversationRequest } from '../conversation/types.js';
import type { AutoTestSession } from '../dynamic/autonomous/orchestrator.js';
import type { DynamicHistorySnapshot } from '../dynamic/localHistory.js';
import type { DynamicFinding, FindingDetail, FindingEvent, FindingObservation } from '../dynamic/findings/types.js';
import type { DynamicReportSnapshot } from '../dynamic/reports/types.js';
import type { HookOperation } from '../dynamic/workspace/operations.js';
import type { DynamicUnitRun, UnitDataEvent } from '../dynamic/unit/types.js';
import type { UnitReportSnapshot } from '../dynamic/unit/reports.js';
import { legacyEvidenceImageType, legacyEvidenceMaxBytes, type LegacyDynamicSnapshot } from '../dynamic/localLegacyHistory.js';
import type { DynamicEvidence, DynamicSession } from '../dynamicSessions.js';
import type { EnvironmentHistorySnapshot } from '../dynamic/environment/localRepository.js';
import type { DataEvent, EnvironmentData, EnvironmentProfile } from '../dynamic/environment/types.js';
import { verifyArchivedArtifact, verifyArchivedCopy, verifyArchivedCopyBytes, type EvidenceCopyArchive } from '../dynamic/sharedEvidence/archive.js';
import type { RunArtifact } from '../dynamic/sharedEvidence/artifacts.js';
import { SharedEvidenceRepository } from '../dynamic/sharedEvidence/repository.js';
import { SHARED_EVIDENCE_BUCKET, type EvidenceCopy } from '../dynamic/sharedEvidence/types.js';
import type { DynamicRun, Mission, MissionRevision } from '../dynamic/types.js';
import type { ConnectedSourceSnapshot } from '../integrations/localRepository.js';
import { SupabaseConnectedSourceRepository } from '../integrations/supabaseRepository.js';
import type { ReadinessJob } from '../readiness/service.js';
import { canonicalJson } from '../report/canonical.js';
import { mapReportHistory } from '../report/history.js';
import { reportFormats, verifyArchivedReport, type ArchivedReport, type ReportFormat } from '../report/localArchive.js';
import { REPORT_BUCKET } from '../report/storage.js';
import { DECISION_ATTACHMENT_BUCKET, MAX_DECISION_ATTACHMENT_BYTES } from '../review/decisionService.js';
import type { ReviewHistorySnapshot } from '../review/localReviewRecords.js';
import { sourcesCoverIndex, type PortableIndexArchive } from '../review/localIndexArchive.js';
import { archivedRepositoryIndexPublication } from '../review/repositoryIndexSync.js';
import { downloadRepositorySnapshot, repositoryIndexArchiveSha256, validateRepositorySnapshotArchive } from '../review/repositoryIndexSnapshot.js';
import { batchCacheReceiptId, CACHE_ENTITY, CACHE_EVENT, SupabaseValidatedBatchCache, type PortableBatchCacheArchive } from '../review/batchCheckpoint.js';
import { ownerModelPurposes, portableModelSetting } from '../review/localModelConfigurations.js';
import { mapModelConfigurationRow } from '../review/modelProviderResolver.js';
import { portableUsage } from '../model/archivedUsage.js';
import { mapSnapshotArtifact, SupabaseStaticReviewRepository } from '../review/supabaseRepository.js';
import type { ModelAttemptRecord, ReviewOperationKind } from '../review/types.js';
import type { ReviewDecisionRecord } from '../staticDomainTypes.js';
import type { WorkspaceSource } from '../store/localWorkspace.js';
import { SupabaseCentinelStore } from '../store/supabase.js';
import type { StoreArtifactVersion } from '../store/types.js';

type Row = Record<string, unknown>;
type ExportSource = Omit<WorkspaceSource, 'bytes'> & { contentBase64: string };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const copyColumns = 'id,project_id,run_id,evidence_id,object_path,state,expires_at,updated_at,payload';
const diagnosticColumns = 'id,project_id,run_id,slot,payload';

/** Even a repository helper cannot issue a mutation through the export client. */
export function readOnlyMigrationFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') throw new Error('The migration exporter only permits hosted reads.');
    return fetcher(input, { ...init, redirect: 'error' });
  };
}

async function projectRows(client: SupabaseClient, project: string | null, table: string, columns = '*',
  filters: Readonly<Record<string, string>> = {}, signal?: AbortSignal, key = 'id'): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | undefined;
  for (;;) {
    signal?.throwIfAborted();
    let query = client.from(table).select(columns);
    query = (project === null ? query.is('project_id', null) : query.eq('project_id', project)).order(key);
    if (after) query = query.gt(key, after);
    for (const [field, value] of Object.entries(filters)) query = query.eq(field, value);
    if (signal) query = query.abortSignal(signal);
    const result = await query.limit(500);
    signal?.throwIfAborted();
    if (result.error || !Array.isArray(result.data)) throw new Error(`Could not read ${table} for migration.`);
    if (!result.data.length) return rows;
    const page = result.data as unknown as Row[];
    const last = page.at(-1)?.[key];
    if (typeof last !== 'string' || last === after) throw new Error(`Could not page through ${table} for migration.`);
    rows.push(...page);
    after = last;
  }
}

async function exportModelSettings(client: SupabaseClient, owner: string, project: string, signal?: AbortSignal) {
  const [global, overrides] = await Promise.all([
    projectRows(client, null, 'model_configurations', '*', { owner_id: owner }, signal),
    projectRows(client, project, 'model_configurations', '*', { owner_id: owner }, signal),
  ]);
  for (const [scope, rows] of [[null, global], [project, overrides]] as const) {
    if (rows.some(row => row.owner_id !== owner || row.project_id !== scope)) throw new Error('Provider settings are outside the selected migration scope.');
  }
  const selected = new Map<string, Row>();
  // Hosted Settings uses the most recently updated global row for each purpose.
  for (const row of global.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at))
    || String(b.id).localeCompare(String(a.id)))) {
    if (typeof row.purpose === 'string' && ownerModelPurposes.includes(row.purpose) && !selected.has(row.purpose)) selected.set(row.purpose, row);
  }
  const ownerModelSettings = [...selected.values()].map(portableModelSetting);
  const modelConfigurations = overrides.filter(row => ['static_review', 'vision', 'embedding'].includes(String(row.purpose)))
    .map(row => mapModelConfigurationRow(portableModelSetting(row))!);
  return { ownerModelSettings, modelConfigurations,
    omittedModelSettings: global.length + overrides.length - ownerModelSettings.length - modelConfigurations.length };
}

function ownedPayloads<T extends { projectId: string; ownerId: string }>(rows: Row[], project: string, owner: string, field: string): T[] {
  return rows.map(row => {
    const record = (row.payload as Record<string, unknown> | null)?.[field] as T | null;
    if (!record || record.ownerId !== owner || record.projectId !== project) throw new Error('Saved owner journal does not match its migration scope.');
    return record;
  });
}

function journalRead(client: SupabaseClient, project: string, owner: string, entity: string, event: string, signal?: AbortSignal) {
  return projectRows(client, project, 'audit_events', 'id,payload', { actor_id: owner, entity_type: entity, event_type: event }, signal);
}

async function exportReviewBatchCache(client: SupabaseClient, owner: string, project: string,
  reviews: ReviewHistorySnapshot['reviews'], signal?: AbortSignal): Promise<PortableBatchCacheArchive[]> {
  const inventory = () => projectRows(client, project, 'audit_events', 'id,entity_id,payload', {
    actor_id: owner, entity_type: CACHE_ENTITY, event_type: CACHE_EVENT,
  }, signal);
  const rows = await inventory();
  if (!rows.length) return [];
  const reviewIds = new Set(reviews.map(review => review.id));
  const cache = new SupabaseValidatedBatchCache(client, owner);
  const result: PortableBatchCacheArchive[] = [];
  for (const row of rows) {
    signal?.throwIfAborted();
    const request = (row.payload as { requestHash?: unknown } | undefined)?.requestHash;
    if (typeof request !== 'string' || row.id !== batchCacheReceiptId(owner, project, request)
      || typeof row.entity_id !== 'string' || !reviewIds.has(row.entity_id)) {
      throw new Error('A hosted batch cache receipt is outside the exported Reviews.');
    }
    const item = await cache.exportArchive(project, request, signal);
    if (!item || item.receipt.originReviewId !== row.entity_id || canonicalJson(item.receipt) !== canonicalJson(row.payload)) {
      throw new Error('A hosted Review batch cache receipt changed during export.');
    }
    result.push(item);
  }
  if (canonicalJson(rows) !== canonicalJson(await inventory())) throw new Error('The Review batch cache inventory changed during export.');
  return result;
}

async function exportRepositoryIndexes(client: SupabaseClient, project: string, sources: ExportSource[], signal?: AbortSignal) {
  const inventory = () => projectRows(client, project, 'audit_events', 'id,project_id,event_type,payload',
    { entity_type: 'repository_index', event_type: 'repository_index_published' }, signal);
  const rows = await inventory();
  const sourceVersions = new Map(sources.map(source => [source.artifact.versionId!, source.artifact]));
  const archives: PortableIndexArchive[] = [];
  let incompatible = 0;
  let unavailable = 0;
  for (const row of rows) {
    signal?.throwIfAborted();
    const publication = archivedRepositoryIndexPublication(row);
    if (!publication || publication.identity.projectId !== project || !sourcesCoverIndex(publication.identity, sourceVersions)) {
      incompatible++;
      continue;
    }
    const bytes = await downloadRepositorySnapshot(client, publication.identity, signal);
    if (!bytes) {
      unavailable++;
      continue;
    }
    if (bytes.length !== publication.archiveBytes || repositoryIndexArchiveSha256(bytes) !== publication.archiveSha256) {
      throw new Error('A hosted repository index archive failed its recorded checksum.');
    }
    await validateRepositorySnapshotArchive(bytes, publication.identity, signal);
    archives.push({ identity: publication.identity, archiveSha256: publication.archiveSha256, contentBase64: bytes.toString('base64') });
  }
  if (canonicalJson(rows) !== canonicalJson(await inventory())) throw new Error('The repository index inventory changed during export.');
  return { archives, incompatible, unavailable };
}

async function exportDynamicHistory(client: SupabaseClient, project: string, signal?: AbortSignal): Promise<DynamicHistorySnapshot> {
  const [missions, revisions, rows, copies, artifactRows, findingRows, observationRows, eventRows, reportRows, units, hookRows] = await Promise.all([
    projectRows(client, project, 'dynamic_missions', 'id,payload', {}, signal),
    projectRows(client, project, 'dynamic_mission_revisions', 'id,payload', {}, signal),
    projectRows(client, project, 'dynamic_runs', 'id,payload', {}, signal),
    projectRows(client, project, 'dynamic_evidence_copies', copyColumns, {}, signal),
    projectRows(client, project, 'dynamic_run_artifacts', diagnosticColumns, {}, signal),
    projectRows(client, project, 'dynamic_findings', 'id,payload', {}, signal),
    projectRows(client, project, 'dynamic_finding_observations', 'id,finding_id,payload', {}, signal),
    projectRows(client, project, 'dynamic_finding_events', 'id,finding_id,payload', {}, signal),
    projectRows(client, project, 'dynamic_report_snapshots', 'id,run_id,created_by,payload', {}, signal),
    exportUnitHistory(client, project, signal),
    projectRows(client, project, 'dynamic_hook_operations', 'id,profile_id,actor_id,payload', {}, signal),
  ]);
  const runs = rows.map(row => row.payload as DynamicRun);
  const runById = new Map(runs.map(run => [run.id, run]));
  const reports = reportRows.map(row => {
    const snapshot = row.payload as DynamicReportSnapshot | null;
    const metadata = snapshot?.metadata;
    if (!snapshot || !metadata || metadata.projectId !== project || metadata.reportId !== row.id
      || metadata.runId !== row.run_id || metadata.actorId !== row.created_by || !runById.has(metadata.runId)) {
      throw new Error('An exported Dynamic report does not match its project or Run.');
    }
    return snapshot;
  });
  const findingDetails = new Map<string, FindingDetail>();
  for (const row of findingRows) {
    const finding = row.payload as DynamicFinding | null;
    if (!finding || finding.projectId !== project || finding.id !== row.id || findingDetails.has(finding.id)) {
      throw new Error('An exported Dynamic finding is outside the project scope.');
    }
    findingDetails.set(finding.id, { finding, observations: [], events: [] });
  }
  for (const row of observationRows) {
    const observation = row.payload as FindingObservation | null;
    const detail = observation && findingDetails.get(observation.findingId);
    if (!observation || !detail || observation.id !== row.id || observation.findingId !== row.finding_id
      || observation.projectId !== project || !runById.has(observation.runId)) {
      throw new Error('An exported Dynamic finding observation has no scoped finding or Run.');
    }
    detail.observations.push(observation);
  }
  for (const row of eventRows) {
    const event = row.payload as FindingEvent | null;
    const detail = event && findingDetails.get(event.findingId);
    if (!event || !detail || event.id !== row.id || event.findingId !== row.finding_id || event.projectId !== project
      || (event.regressionRunId && !runById.has(event.regressionRunId))) {
      throw new Error('An exported Dynamic finding decision has no scoped finding or regression Run.');
    }
    detail.events.push(event);
  }
  for (const detail of findingDetails.values()) {
    if (detail.observations.length !== detail.finding.observationCount
      || detail.events.some(event => event.version > detail.finding.version)) {
      throw new Error('Dynamic findings changed during export. Retry from a stable export boundary.');
    }
  }
  const evidence: NonNullable<DynamicHistorySnapshot['evidence']> = [];
  const evidenceCopies: EvidenceCopyArchive = { artifacts: [], copies: [] };
  const registry = new Map<string, RunArtifact>();
  for (const row of artifactRows) {
    const item = row.payload as RunArtifact | null;
    const run = runById.get(String(row.run_id));
    if (!item || !run || run.projectId !== project || row.project_id !== project || row.id !== item.id
        || row.slot !== item.slot || registry.has(item.id)) throw new Error('A saved diagnostic artifact is outside the exported Run.');
    verifyArchivedArtifact(run, item);
    registry.set(item.id, item);
    evidenceCopies.artifacts.push(item);
  }
  const shared = new SharedEvidenceRepository(client);
  const observedAt = Date.now();
  for (const row of copies) {
    signal?.throwIfAborted();
    const run = runById.get(String(row.run_id));
    if (!run || run.projectId !== project) throw new Error('A saved Dynamic evidence copy has no exported run.');
    const payload = row.payload as EvidenceCopy | null;
    if (!payload || row.id !== payload.id || row.project_id !== project || row.evidence_id !== payload.evidenceId
      || typeof row.expires_at !== 'string' || typeof row.updated_at !== 'string'
      || !['pending', 'available', 'failed', 'deleting', 'deleted'].includes(String(row.state))) {
      throw new Error('A saved evidence copy has invalid hosted metadata.');
    }
    const copy: EvidenceCopy = { ...payload, expiresAt: row.expires_at, updatedAt: row.updated_at,
      availability: row.state !== 'deleted' && Date.parse(row.expires_at) <= observedAt ? 'expired' : row.state as EvidenceCopy['availability'] };
    const artifact = registry.get(copy.evidenceId);
    if (artifact && artifact.runId !== run.id) throw new Error('A saved diagnostic copy points to a different Run.');
    verifyArchivedCopy(run, copy, artifact);
    const ext = copy.kind === 'download' ? 'bin' : copy.mimeType === 'image/png' ? 'png' : 'json';
    if (row.object_path !== `${project}/dynamic-v1/${run.id}/${copy.id}/${copy.sha256}.${ext}`) {
      throw new Error('A saved evidence copy has an invalid Storage path.');
    }
    if (copy.availability !== 'available') {
      evidenceCopies.copies.push({ copy });
      continue;
    }
    const bytes = await shared.download(String(row.object_path), copy);
    verifyArchivedCopyBytes(run, copy, bytes);
    const contentBase64 = bytes.toString('base64');
    evidenceCopies.copies.push({ copy, contentBase64 });
    if (!artifact) evidence.push({ runId: run.id, evidenceId: copy.evidenceId, contentBase64 });
  }
  const [finalCopies, finalArtifacts] = await Promise.all([
    projectRows(client, project, 'dynamic_evidence_copies', copyColumns, {}, signal),
    projectRows(client, project, 'dynamic_run_artifacts', diagnosticColumns, {}, signal),
  ]);
  if (canonicalJson(copies) !== canonicalJson(finalCopies) || canonicalJson(artifactRows) !== canonicalJson(finalArtifacts)) {
    throw new Error('The Dynamic evidence inventory changed during export. Retry from a stable export boundary.');
  }
  return {
    missions: missions.map(row => row.payload as Mission),
    revisions: revisions.map(row => row.payload as MissionRevision),
    runs, evidence, evidenceCopies, findings: [...findingDetails.values()], reports, units, hooks: hookRows.map(row => {
      const operation = row.payload as HookOperation | null;
      if (!operation || operation.id !== row.id || operation.environmentId !== row.profile_id
        || operation.createdBy !== row.actor_id || operation.projectId !== project) {
        throw new Error('An exported setup or cleanup record does not match its project or environment.');
      }
      return operation;
    }),
  };
}

async function exportUnitHistory(client: SupabaseClient, project: string, signal?: AbortSignal) {
  const [rows, cleanup, savedReports] = await Promise.all([
    projectRows(client, project, 'dynamic_unit_runs', 'id,profile_id,actor_id,payload', {}, signal),
    projectRows(client, project, 'dynamic_unit_data_events', 'id,unit_run_id,payload', {}, signal),
    projectRows(client, project, 'dynamic_unit_reports', 'id,unit_run_id,actor_id,payload', {}, signal),
  ]);
  const runs = rows.map(row => {
    const run = row.payload as DynamicUnitRun | null;
    if (!run || run.projectId !== project || run.id !== row.id || run.environmentId !== row.profile_id || run.createdBy !== row.actor_id) {
      throw new Error('An exported Unit Run does not match its project or environment.');
    }
    return run;
  });
  const runIds = new Set(runs.map(run => run.id));
  const events = cleanup.map(row => {
    const event = row.payload as UnitDataEvent | null;
    const runId = String(row.unit_run_id);
    if (!event || !runIds.has(runId)) throw new Error('A Unit cleanup record has no exported Run.');
    return { id: String(row.id), runId, event };
  });
  const reports = savedReports.map(row => {
    const report = row.payload as UnitReportSnapshot | null;
    if (!report || report.metadata?.projectId !== project || report.metadata.reportId !== row.id
      || report.metadata.runId !== row.unit_run_id || report.metadata.actorId !== row.actor_id || !runIds.has(report.metadata.runId)) {
      throw new Error('An exported Unit report does not match its project or Run.');
    }
    return report;
  });
  return { runs, events, reports };
}

async function exportLegacyDynamic(client: SupabaseClient, project: string, signal?: AbortSignal): Promise<LegacyDynamicSnapshot> {
  const [sessionRows, actionRows, evidenceRows] = await Promise.all([
    projectRows(client, project, 'dynamic_sessions', '*', {}, signal),
    projectRows(client, project, 'dynamic_actions', 'id,dynamic_session_id,step,action,target,result,created_at', {}, signal),
    projectRows(client, project, 'dynamic_evidence', '*', {}, signal),
  ]);
  const sessions: DynamicSession[] = sessionRows.map(row => ({
    id: String(row.id), projectId: String(row.project_id), type: 'dynamic', name: String(row.name),
    status: row.status as DynamicSession['status'], targetUrl: String(row.target_url), goal: String(row.goal),
    missionType: row.mission_type as DynamicSession['missionType'], browserMode: 'headed', maxSteps: Number(row.max_steps ?? 20),
    finalSummary: String(row.final_summary ?? ''), failureReason: String(row.failure_reason ?? ''),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
  const sessionIds = new Set(sessions.map(session => session.id));
  const actions = actionRows.map(row => ({
    id: String(row.id), sessionId: String(row.dynamic_session_id), step: Number(row.step), action: String(row.action),
    target: String(row.target ?? ''), result: String(row.result ?? ''), createdAt: String(row.created_at),
  }));
  if (actions.some(action => !sessionIds.has(action.sessionId))) throw new Error('A legacy browser action is outside the exported sessions.');
  const evidence: LegacyDynamicSnapshot['evidence'] = [];
  for (const row of evidenceRows) {
    signal?.throwIfAborted();
    const item = { id: String(row.id), sessionId: String(row.dynamic_session_id), type: row.type as DynamicEvidence['type'],
      summary: String(row.summary ?? ''), createdAt: String(row.created_at) };
    if (!sessionIds.has(item.sessionId)) throw new Error('Legacy browser evidence is outside the exported sessions.');
    const path = row.storage_path;
    if (typeof path !== 'string' || !path.startsWith(project + '/')) {
      evidence.push(item);
      continue;
    }
    if (path.split('/').some(part => !part || part === '.' || part === '..' || /[\\%?#\u0000-\u001f]/.test(part))) {
      throw new Error('A legacy browser evidence object has an invalid Storage path.');
    }
    const download = await client.storage.from(SHARED_EVIDENCE_BUCKET).download(path, {}, { signal }).asStream();
    if (download.error && 'statusCode' in download.error && String(download.error.statusCode) === '404') {
      evidence.push(item);
      continue;
    }
    if (download.error || !download.data) throw new Error('Could not download a legacy browser evidence object.');
    const chunks: Buffer[] = [];
    let length = 0;
    const reader = download.data.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > legacyEvidenceMaxBytes) throw new Error('A legacy browser evidence object exceeds the supported size.');
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const checksum = sha256(bytes);
    const expected = (row.metadata as Row | null)?.sha256;
    if (!bytes.length || expected != null && expected !== checksum) throw new Error('A legacy browser evidence object failed checksum verification.');
    const imageType = item.type === 'screenshot' ? legacyEvidenceImageType(bytes) : undefined;
    evidence.push({ ...item, file: { sha256: checksum, contentBase64: bytes.toString('base64'), imageType } });
  }
  return { sessions, actions, evidence };
}

async function exportEnvironments(client: SupabaseClient, project: string, signal?: AbortSignal): Promise<EnvironmentHistorySnapshot> {
  const [profiles, data, events] = await Promise.all([
    projectRows(client, project, 'dynamic_environments', 'id,payload', {}, signal),
    projectRows(client, project, 'dynamic_environment_data', '*', {}, signal, 'profile_id'),
    projectRows(client, project, 'dynamic_environment_events', '*', {}, signal),
  ]);
  const profileList = profiles.map(row => row.payload as EnvironmentProfile);
  const profileById = new Map(profileList.map(profile => [profile.id, profile]));
  const dataIds = new Set(data.map(row => String(row.profile_id)));
  const resourceOwners = new Map(data.filter(row => row.resource_reserved === true && typeof row.resource_key === 'string')
    .map(row => [String(row.resource_key), row]));
  const byProfile = new Map<string, DataEvent[]>();
  for (const event of events) {
    const profileId = String(event.profile_id);
    if (!dataIds.has(profileId)) throw new Error('An environment data event has no exported profile state.');
    const group = byProfile.get(profileId) ?? [];
    group.push({ id: String(event.id), runId: event.run_id == null ? null : String(event.run_id),
      kind: event.kind as DataEvent['kind'], outcome: event.outcome as DataEvent['outcome'], note: String(event.note ?? ''),
      actorId: String(event.actor_id), createdAt: String(event.created_at) });
    byProfile.set(profileId, group);
  }
  return {
    profiles: profileList,
    data: data.map(row => {
      const profileId = String(row.profile_id);
      const profile = profileById.get(profileId);
      if (!profile || profile.projectId !== project) throw new Error('An environment data record has no exported profile.');
      const reserved = row.resource_reserved === true;
      const key = reserved && typeof row.resource_key === 'string' ? row.resource_key
        : profile.dataResourceKey ? 'shared:' + profile.dataResourceKey.toLowerCase() : 'profile:' + profileId;
      const owner = resourceOwners.get(key);
      const ownerId = owner ? String(owner.profile_id) : null;
      return {
        profileId, state: row.state as EnvironmentData['state'],
        preparedVersion: row.prepared_version == null ? null : Number(row.prepared_version),
        preparation: row.preparation as EnvironmentData['preparation'],
        runId: row.run_id == null ? null : String(row.run_id),
        unitRunId: row.unit_run_id == null ? null : String(row.unit_run_id),
        operationId: row.operation_id == null ? null : String(row.operation_id),
        resource: { key, reserved, available: !owner || ownerId === profileId, ownerProfileId: ownerId,
          ownerName: ownerId ? profileById.get(ownerId)?.name ?? null : null, ownerState: owner ? String(owner.state) : null },
        events: (byProfile.get(profileId) ?? []).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)),
      };
    }),
  };
}

async function exportReports(client: SupabaseClient, project: string, signal?: AbortSignal): Promise<ArchivedReport[]> {
  const rows = await projectRows(client, project, 'report_exports', '*', {}, signal);
  const reports: ArchivedReport[] = [];
  for (const row of rows) {
    signal?.throwIfAborted();
    const { storage, ...history } = mapReportHistory(row);
    if (history.projectId !== project || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(history.id)) {
      throw new Error('An exported report is outside the selected project.');
    }
    if (!history.checksum || !/^[a-f\d]{64}$/.test(history.checksum)) {
      reports.push({ history, files: null });
      continue;
    }
    const prefix = `${project}/${history.id}/`;
    const defaults = { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' };
    const bytes: Partial<Record<ReportFormat, Buffer>> = {};
    for (const format of reportFormats) {
      const path = storage[format] ?? prefix + (history.snapshot.metadata?.outputFiles?.[format] ?? defaults[format]);
      const filename = path.slice(prefix.length);
      if (!path.startsWith(prefix) || !filename || filename === '.' || filename === '..' || /[\\/%?#\u0000-\u001f]/.test(filename)) {
        throw new Error('An archived report object is outside its project and report path.');
      }
      const result = await client.storage.from(REPORT_BUCKET).download(path, {}, { signal });
      if (result.error && 'statusCode' in result.error && String(result.error.statusCode) === '404') break;
      if (result.error || !result.data) throw new Error('Could not download an archived report file.');
      bytes[format] = Buffer.from(await result.data.arrayBuffer());
    }
    if (!bytes.json || !bytes.markdown || !bytes.pdf) {
      reports.push({ history, files: null });
      continue;
    }
    const { snapshot } = verifyArchivedReport(history, { json: bytes.json, markdown: bytes.markdown, pdf: bytes.pdf });
    reports.push({ history: { ...history, snapshot }, files: { json: bytes.json.toString('base64'),
      markdown: bytes.markdown.toString('base64'), pdf: bytes.pdf.toString('base64') } });
  }
  return reports;
}

async function exportReviewHistory(client: SupabaseClient, project: string, versions: ReadonlySet<string>,
  ownerUsage: Promise<Row[]>, signal?: AbortSignal): Promise<ReviewHistorySnapshot> {
  const reviews = new SupabaseStaticReviewRepository(client);
  const store = new SupabaseCentinelStore(client);
  const [sessions, manifests, operations, findingRows, decisions, attachments, usage, recovery] = await Promise.all([
    reviews.listReviews(project), projectRows(client, project, 'review_source_snapshots', '*', {}, signal),
    projectRows(client, project, 'review_operations', '*', {}, signal), store.listFindings(project),
    projectRows(client, project, 'review_decisions', '*', {}, signal),
    projectRows(client, project, 'review_decision_attachments', '*', {}, signal),
    ownerUsage,
    projectRows(client, project, 'audit_events', 'id,project_id,entity_id,event_type,payload,created_at',
      { entity_type: 'review', event_type: 'review_lease_recovered' }, signal),
  ]);
  const reviewIds = new Set(sessions.map(review => review.id));
  const findings = new Map(findingRows.map(item => [item.id, item]));
  const usedAttachments = new Set<string>();
  const missingSourceVersionIds = new Set<string>();
  const history: Required<ReviewHistorySnapshot> = {
    reviews: sessions,
    manifests: manifests.map(row => {
      const snapshot = row.snapshot as Row | null;
      if (!Array.isArray(snapshot?.artifacts)) throw new Error('A hosted Review manifest has an unsupported format.');
      const artifacts = snapshot.artifacts.map(mapSnapshotArtifact);
      for (const artifact of artifacts) {
        if (artifact.versionId && !versions.has(artifact.versionId)) missingSourceVersionIds.add(artifact.versionId);
      }
      return { id: String(row.id), reviewId: String(row.review_session_id), mode: snapshot.mode === 'reuse' ? 'reuse' : 'capture',
        artifacts, capturedAt: String(snapshot.capturedAt ?? row.created_at) };
    }),
    operations: operations.map(row => ({ operation: String(row.operation) as ReviewOperationKind, idempotencyKey: String(row.idempotency_key),
      projectId: String(row.project_id), reviewId: String(row.review_id), createdAt: String(row.created_at) })),
    findings: [], attempts: usage.flatMap(row => {
      const attempt = exportReviewAttempt(row, reviewIds);
      return attempt ? [attempt] : [];
    }), audit: [], traceability: [], sufficiency: [], correlations: [], decisions: [], decisionFiles: [],
    missingSourceVersionIds: [...missingSourceVersionIds],
  };
  for (const review of sessions) {
    signal?.throwIfAborted();
    const [items, events, traceability, sufficiency, correlations] = await Promise.all([
      reviews.listReviewFindings(review.id), reviews.getHarnessEvents(project, review.id),
      reviews.getTraceabilitySnapshot(review.id), reviews.getEvidenceSufficiency(review.id), reviews.getFindingCorrelationSnapshot(review.id),
    ]);
    history.audit.push(...events);
    if (traceability) history.traceability.push(traceability);
    if (sufficiency) history.sufficiency.push(sufficiency);
    if (correlations) history.correlations.push(correlations);
    for (const finding of items) {
      const saved = findings.get(finding.id);
      if (!saved || saved.reviewSessionId !== review.id) throw new Error('A saved finding changed while the Review export was running.');
      history.findings.push({ finding, disposition: { status: saved.status, updatedAt: saved.updatedAt },
        stateChanges: await store.listFindingStateHistory(finding.id) });
    }
  }
  for (const row of recovery) {
    const payload = (row.payload as { detail?: Record<string, unknown> } | null)?.detail;
    if (row.project_id !== project || typeof row.entity_id !== 'string' || !reviewIds.has(row.entity_id)) {
      throw new Error('A hosted recovery audit is outside the exported Reviews.');
    }
    // Preserve the recovery gate without exporting unrelated audit payloads.
    history.audit.push({ id: String(row.id), projectId: project, reviewId: row.entity_id, event: 'review_lease_recovered',
      createdAt: String(row.created_at), detail: {
        ...(payload?.action === 'requeued' || payload?.action === 'marked_failed' ? { action: payload.action } : {}),
        leaseAttempt: number(payload?.leaseAttempt), recoveryAttempt: number(payload?.recoveryAttempt),
      } });
  }
  for (const row of decisions) {
    signal?.throwIfAborted();
    const decision: ReviewDecisionRecord = { id: String(row.id), projectId: String(row.project_id), sessionId: String(row.review_session_id),
      decision: row.decision as ReviewDecisionRecord['decision'], comment: String(row.comment ?? ''), reviewer: String(row.reviewer ?? ''),
      createdAt: String(row.created_at), attachments: [] };
    if (!reviewIds.has(decision.sessionId) || decision.projectId !== project) throw new Error('A decision is outside the exported Reviews.');
    for (const attachment of attachments.filter(item => item.decision_id === decision.id)) {
      const id = String(attachment.id);
      decision.attachments.push({ id, fileName: String(attachment.file_name), mimeType: String(attachment.mime_type), createdAt: String(attachment.created_at) });
      usedAttachments.add(id);
      const path = String(attachment.storage_path ?? '');
      const prefix = `${project}/${decision.sessionId}/${decision.id}/`;
      if (attachment.project_id !== project || attachment.review_session_id != null && attachment.review_session_id !== decision.sessionId) {
        throw new Error('A decision attachment is outside the exported Review.');
      }
      const contentHash = attachment.content_hash;
      const size = number(attachment.byte_size);
      // Older rows lack the checksum contract required to promote their bytes.
      if (typeof contentHash !== 'string' || !/^[a-f\d]{64}$/.test(contentHash) || size === undefined) continue;
      if (!path.startsWith(prefix) || !/^[^/\\]+$/.test(path.slice(prefix.length)) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) {
        throw new Error('A decision attachment Storage path is outside the exported Review.');
      }
      if (size < 1 || size > MAX_DECISION_ATTACHMENT_BYTES) throw new Error('A decision file exceeds its supported size.');
      const result = await client.storage.from(DECISION_ATTACHMENT_BUCKET).download(path, {}, { signal });
      if (result.error || !result.data) throw new Error('Could not download an expected Review decision file.');
      const bytes = Buffer.from(await result.data.arrayBuffer());
      if (bytes.length !== size || sha256(bytes) !== contentHash) throw new Error('A Review decision file failed verification.');
      history.decisionFiles.push({ reviewId: decision.sessionId, decisionId: decision.id, attachmentId: id, contentHash,
        contentBase64: bytes.toString('base64') });
    }
    history.decisions.push(decision);
  }
  if (usedAttachments.size !== attachments.length) throw new Error('A Review decision file has no exported decision.');
  return history;
}

function exportReviewAttempt(row: Row, reviewIds: ReadonlySet<string>): ModelAttemptRecord | null {
  if (typeof row.review_session_id !== 'string' || !reviewIds.has(row.review_session_id)) return null;
  const metadata = row.metadata as Row | null;
  if (metadata?.scope === 'embedding' || metadata?.callKind === 'dynamic' || metadata?.callKind === 'test') return null;
  const outcome = row.outcome === 'transient_error' ? 'retryable_error' : row.outcome;
  if (typeof outcome !== 'string' || !['in_progress', 'success', 'retryable_error', 'permanent_error', 'malformed_response', 'cancelled'].includes(outcome)) {
    throw new Error('A hosted Review attempt has an unknown outcome.');
  }
  return {
    id: String(row.id), reviewId: row.review_session_id, projectId: String(row.project_id), stage: String(row.stage),
    attempt: Number(row.attempt ?? 1), provider: String(row.provider), model: String(row.model),
    apiFormat: String(metadata?.apiFormat ?? 'unknown'), outcome: outcome as ModelAttemptRecord['outcome'],
    durationMs: number(row.duration_ms) ?? 0, errorCode: typeof row.error_code === 'string' ? row.error_code : undefined,
    statusCode: number(metadata?.statusCode), retryAfterMs: number(metadata?.retryAfterMs),
    responseReceived: typeof metadata?.responseReceived === 'boolean' ? metadata.responseReceived : undefined,
    usageObservation: metadata?.usageObservation as ModelAttemptRecord['usageObservation'],
    usageAccounting: metadata?.usageAccounting as ModelAttemptRecord['usageAccounting'],
    usageContext: metadata?.usageContext as ModelAttemptRecord['usageContext'],
    usage: { inputTokens: number(row.input_tokens), outputTokens: number(row.output_tokens),
      cacheReadTokens: number(row.cache_read_tokens), cacheCreationTokens: number(row.cache_creation_tokens),
      providerReportedTotalTokens: number(metadata?.providerReportedTotalTokens), totalTokens: number(metadata?.normalizedTotalTokens),
      totalTokensSource: metadata?.normalizedTotalTokensSource as NonNullable<ModelAttemptRecord['usage']>['totalTokensSource'] },
    createdAt: String(row.created_at),
  };
}

function exportUsageRow(row: Row, owner: string, project: string | null) {
  if (row.owner_id !== owner || row.project_id !== project) throw new Error('Model usage is outside the selected export scope.');
  return portableUsage({
    id: String(row.id), ownerId: owner, projectId: project,
    reviewSessionId: typeof row.review_session_id === 'string' ? row.review_session_id : null,
    stage: String(row.stage ?? ''), attempt: Number(row.attempt ?? 1), provider: String(row.provider ?? ''), model: String(row.model ?? ''),
    outcome: String(row.outcome ?? ''), createdAt: String(row.created_at),
    inputTokens: number(row.input_tokens) ?? null, outputTokens: number(row.output_tokens) ?? null,
    cacheReadTokens: number(row.cache_read_tokens) ?? null, cacheCreationTokens: number(row.cache_creation_tokens) ?? null,
    durationMs: number(row.duration_ms) ?? null, cost: number(row.cost) ?? null,
    errorCode: typeof row.error_code === 'string' ? row.error_code : null, metadata: (row.metadata ?? {}) as Row,
  });
}

function interruptConversation(record: ConversationRequest): ConversationRequest {
  if (['completed', 'failed', 'paused', 'interrupted', 'cancelled'].includes(record.state)) return record;
  const { workerId: _worker, leaseUntil: _lease, ...saved } = record;
  return { ...saved, state: 'interrupted' };
}

function interruptAutoTest(record: AutoTestSession): AutoTestSession {
  if (['completed', 'failed', 'cancelled'].includes(record.stage)) return record;
  return { ...record, stage: 'failed', error: { reason: 'interrupted', message: 'The Auto Test was interrupted during migration.' } };
}

export async function exportOwnerWorkspace(auth: AuthenticatedRequest, projectId: string, signal?: AbortSignal) {
  const { client, userId: owner } = auth;
  const application = new CentinelApplicationRepository(client, owner);
  const project = await application.getProject(projectId);
  if (!project || project.id !== projectId || project.ownerId !== owner) throw new Error('Choose a project owned by the authenticated account.');
  const startedAt = new Date().toISOString();
  const [artifacts, versions, requirements] = await Promise.all([
    application.listArtifacts(projectId, signal), application.listProjectArtifactVersions(projectId, signal), application.listRequirements(projectId),
  ]);
  const artifactById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const current = new Map<string, StoreArtifactVersion>();
  const sources = new Array<ExportSource>(versions.length);
  let sourceBytes = 0;
  for (const version of versions) {
    const artifact = artifactById.get(version.artifactId);
    if (!artifact || artifact.projectId !== projectId || version.projectId !== projectId || !/^[a-f\d]{64}$/.test(version.contentHash)) {
      throw new Error('The hosted source inventory contains a version outside its project or with an invalid checksum.');
    }
    const previous = current.get(artifact.id);
    if (!previous || version.versionNumber > previous.versionNumber
      || version.versionNumber === previous.versionNumber && version.id.localeCompare(previous.id) > 0) current.set(artifact.id, version);
  }
  if (current.size !== artifacts.length) throw new Error('One or more hosted artifacts have no saved version. Resolve their inventory before exporting.');
  const sourceDownload = new AbortController();
  const sourceSignal = signal ? AbortSignal.any([signal, sourceDownload.signal]) : sourceDownload.signal;
  let nextSource = 0;
  await Promise.all(Array.from({ length: Math.min(4, versions.length) }, async () => {
    try {
      while (nextSource < versions.length) {
        sourceSignal.throwIfAborted();
        const index = nextSource++;
        const version = versions[index];
        const artifact = artifactById.get(version.artifactId)!;
        const bytes = await application.downloadFrozenArtifactVersion({
          projectId, artifactId: artifact.id, versionId: version.id, expectedContentHash: version.contentHash,
        }, sourceSignal);
        if (sha256(bytes) !== version.contentHash || version.byteSize !== null && bytes.length !== version.byteSize) {
          throw new Error('A hosted source version failed verification.');
        }
        sources[index] = { artifact: { ...clientArtifact(artifact, version), versionId: version.id },
          mimeType: version.contentType ?? artifact.mimeType, contentBase64: bytes.toString('base64') };
        sourceBytes += bytes.length;
      }
    } catch (error) {
      sourceDownload.abort(error);
      throw error;
    }
  }));

  const mappings = [];
  for (const requirement of requirements) mappings.push(...await application.listRequirementMappings(projectId, requirement.id));
  const grounding = new SupabaseStaticReviewRepository(client);
  const connectedRepo = new SupabaseConnectedSourceRepository(client);
  const projectUsage = projectRows(client, projectId, 'model_usage_records', '*', { owner_id: owner }, signal);
  const [candidates, standardRules, connected, readiness, conversations, autoTests, dynamicHistory, environments, reviewHistory, reports, settings, usageRows, ownerUsage, legacyDynamic, indexes] = await Promise.all([
    grounding.listRequirementCandidates(projectId, undefined, signal), grounding.listStandardRules(projectId, undefined, signal),
    connectedRepo.listSources(projectId),
    journalRead(client, projectId, owner, 'project_readiness', 'project_readiness_job', signal),
    journalRead(client, projectId, owner, 'project_conversation', 'project_conversation_request', signal),
    journalRead(client, projectId, owner, 'dynamic_autonomous', 'dynamic_autonomous_session', signal),
    exportDynamicHistory(client, projectId, signal),
    exportEnvironments(client, projectId, signal),
    exportReviewHistory(client, projectId, new Set(versions.map(item => item.id)), projectUsage, signal),
    exportReports(client, projectId, signal),
    exportModelSettings(client, owner, projectId, signal),
    projectUsage, projectRows(client, null, 'model_usage_records', '*', { owner_id: owner }, signal),
    exportLegacyDynamic(client, projectId, signal),
    exportRepositoryIndexes(client, projectId, sources, signal),
  ]);
  const connectedSources: ConnectedSourceSnapshot = { sources: connected, items: [], runs: [] };
  const reviewBatchCache = await exportReviewBatchCache(client, owner, projectId, reviewHistory.reviews, signal);
  for (const source of connected) {
    const [items, runs] = await Promise.all([connectedRepo.listSourceItems(source.id), connectedRepo.listSyncRuns(source.id)]);
    connectedSources.items.push(...items);
    connectedSources.runs.push(...runs);
  }
  const readinessJobs = readiness.map(row => {
    const job = (row.payload as { job?: ReadinessJob } | null)?.job;
    if (!job || job.projectId !== projectId) throw new Error('Readiness history does not match its migration scope.');
    return job;
  });
  const history = {
    conversations: ownedPayloads<ConversationRequest>(conversations, projectId, owner, 'request').map(interruptConversation),
    autoTests: ownedPayloads<AutoTestSession>(autoTests, projectId, owner, 'session').map(interruptAutoTest),
  };
  const [latestProject, latestArtifacts, latestVersions] = await Promise.all([
    application.getProject(projectId), application.listArtifacts(projectId, signal), application.listProjectArtifactVersions(projectId, signal),
  ]);
  if (canonicalJson({ project, artifacts, versions }) !== canonicalJson({ project: latestProject, artifacts: latestArtifacts, versions: latestVersions })) {
    throw new Error('The project or source inventory changed during export. Retry from a stable export boundary.');
  }
  const modelUsage = [...usageRows.map(row => exportUsageRow(row, owner, projectId)), ...ownerUsage.map(row => exportUsageRow(row, owner, null))];
  return {
    schemaVersion: 1, project, sources, currentVersionIds: [...current.values()].map(version => version.id),
    traceability: { requirements, mappings, candidates, standardRules }, connectedSources, readinessJobs, dynamicHistory, environments, reviewHistory, reports, history,
    ownerModelSettings: settings.ownerModelSettings, modelConfigurations: settings.modelConfigurations,
    modelUsage, legacyDynamic, repositoryIndexes: indexes.archives, reviewBatchCache,
    exportReceipt: { startedAt, finishedAt: new Date().toISOString(), sourceBytes, sourceVersions: sources.length,
      reviews: reviewHistory.reviews.length, decisionFiles: reviewHistory.decisionFiles?.length ?? 0,
      repositoryIndexArchives: indexes.archives.length, incompatibleRepositoryIndexes: indexes.incompatible, unavailableRepositoryIndexes: indexes.unavailable,
      reviewBatchCacheRecords: reviewBatchCache.length,
      missingReviewSourceVersions: reviewHistory.missingSourceVersionIds?.length ?? 0,
      missingReviewDecisionFiles: (reviewHistory.decisions ?? []).reduce((count, decision) => count + decision.attachments.length, 0)
        - (reviewHistory.decisionFiles?.length ?? 0),
      dynamicEvidenceReferences: dynamicHistory.runs.reduce((count, run) => count + run.evidence.length, 0),
      dynamicEvidenceFiles: dynamicHistory.evidence?.length ?? 0,
      dynamicCopyRecords: dynamicHistory.evidenceCopies?.copies.length ?? 0,
      dynamicCopyFiles: dynamicHistory.evidenceCopies?.copies.filter(item => item.contentBase64 !== undefined).length ?? 0,
      dynamicArtifactRecords: dynamicHistory.evidenceCopies?.artifacts.length ?? 0,
      dynamicFindings: dynamicHistory.findings?.length ?? 0,
      dynamicFindingObservations: dynamicHistory.findings?.reduce((count, detail) => count + detail.observations.length, 0) ?? 0,
      dynamicFindingEvents: dynamicHistory.findings?.reduce((count, detail) => count + detail.events.length, 0) ?? 0,
      dynamicReports: dynamicHistory.reports?.length ?? 0,
      unitRuns: dynamicHistory.units?.runs.length ?? 0,
      unitCleanupEvents: dynamicHistory.units?.events.length ?? 0,
      unitReports: dynamicHistory.units?.reports?.length ?? 0,
      hookOperations: dynamicHistory.hooks?.length ?? 0,
      reports: reports.length, verifiedReportPackages: reports.filter(report => report.files !== null).length,
      ownerModelSettings: settings.ownerModelSettings.length, projectModelSettings: settings.modelConfigurations.length,
      omittedModelSettings: settings.omittedModelSettings,
      modelUsageRows: modelUsage.length,
      legacyDynamicSessions: legacyDynamic.sessions.length, legacyDynamicEvidence: legacyDynamic.evidence.length,
      legacyDynamicEvidenceFiles: legacyDynamic.evidence.filter(item => item.file).length,
      scope: 'owner-project', consistency: 'multi-read', cutoverReady: false },
  };
}
