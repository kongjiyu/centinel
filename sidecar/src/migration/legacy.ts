import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import initSqlJs, { type Database } from 'sql.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type LegacyRecord = Record<string, unknown> & { id?: string | null };

export type LegacyObject = {
  bucket: 'project-artifacts' | 'review-evidence' | 'decision-attachments' | 'project-reports' | string;
  projectId: string;
  path: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
  checksum?: string;
};

export type LegacySnapshot = {
  projects?: LegacyRecord[];
  members?: LegacyRecord[];
  sources?: LegacyRecord[];
  artifacts?: LegacyRecord[];
  artifactVersions?: LegacyRecord[];
  requirements?: LegacyRecord[];
  standards?: LegacyRecord[];
  requirementMappings?: LegacyRecord[];
  reviews?: LegacyRecord[];
  evidence?: LegacyRecord[];
  findings?: LegacyRecord[];
  findingStateHistory?: LegacyRecord[];
  decisions?: LegacyRecord[];
  assessments?: LegacyRecord[];
  modelConfigurations?: LegacyRecord[];
  modelUsage?: LegacyRecord[];
  integrations?: LegacyRecord[];
  reports?: LegacyRecord[];
  dynamicSessions?: LegacyRecord[];
  objects?: LegacyObject[];
};

export type MigrationEntity = keyof Omit<LegacySnapshot, 'objects'>;

export type MigrationRecordState = {
  entity: MigrationEntity;
  sourceKey: string;
  checksum: string;
  targetId: string;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
  updatedAt: string;
};

export type MigrationState = {
  version: 1;
  records: Record<string, MigrationRecordState>;
  objects: Record<string, { checksum: string; status: 'pending' | 'completed' | 'failed'; error?: string; updatedAt: string }>;
};

export type MigrationFailure = {
  entity: MigrationEntity | 'object';
  sourceKey: string;
  message: string;
};

export type ReconciliationRow = {
  entity: MigrationEntity;
  expectedCount: number;
  actualCount: number | null;
  expectedChecksum: string;
  actualChecksum: string | null;
  matches: boolean;
};

export type MigrationResult = {
  dryRun: boolean;
  planned: number;
  migrated: number;
  skipped: number;
  uploaded: number;
  failures: MigrationFailure[];
  reconciliation: ReconciliationRow[];
  state: MigrationState;
};

export type MigrationOptions = {
  statePath?: string;
  state?: MigrationState;
  dryRun?: boolean;
  reconcile?: boolean;
  /** Map a legacy local/session owner id to an auth.users UUID. */
  identityMap?: Record<string, string>;
  /** Applied to legacy project rows that had no owner_id column. */
  defaultOwnerId?: string;
};

export interface MigrationTarget {
  upsert(entity: MigrationEntity, record: LegacyRecord): Promise<void>;
  uploadObject?(object: LegacyObject, safePath: string): Promise<void>;
  count?(entity: MigrationEntity): Promise<number>;
  checksum?(entity: MigrationEntity): Promise<string>;
}

const ENTITY_ORDER: MigrationEntity[] = [
  'projects', 'members', 'sources', 'artifacts', 'artifactVersions', 'requirements', 'standards', 'requirementMappings',
  'reviews', 'evidence', 'findings', 'findingStateHistory', 'decisions', 'assessments', 'modelConfigurations', 'modelUsage',
  'integrations', 'reports', 'dynamicSessions',
];

const ENTITY_TABLE: Record<MigrationEntity, string> = {
  projects: 'projects', members: 'project_members', sources: 'project_sources', artifacts: 'artifacts', artifactVersions: 'artifact_versions', requirements: 'requirements', standards: 'project_standards', requirementMappings: 'requirement_mappings', reviews: 'review_sessions', evidence: 'review_evidence', findings: 'findings', findingStateHistory: 'finding_state_history', decisions: 'review_decisions', assessments: 'review_assessments', modelConfigurations: 'model_configurations', modelUsage: 'model_usage_records', integrations: 'integrations', reports: 'report_exports', dynamicSessions: 'dynamic_sessions',
};

const ID_REFERENCE: Record<string, MigrationEntity> = {
  source_id: 'sources', artifact_id: 'artifacts', artifact_version_id: 'artifactVersions', requirement_id: 'requirements', standard_id: 'standards', project_id: 'projects', review_session_id: 'reviews', session_id: 'reviews', parent_review_id: 'reviews', finding_id: 'findings', decision_id: 'decisions', dynamic_session_id: 'dynamicSessions',
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function checksum(value: unknown): string {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable UUID for legacy IDs that were not UUIDs, so a second run upserts. */
export function stableMigrationId(entity: string, sourceId: string): string {
  if (UUID_PATTERN.test(sourceId)) return sourceId.toLowerCase();
  const digest = crypto.createHash('sha256').update(`centinel:legacy:${entity}:${sourceId}`).digest('hex');
  const bytes = Buffer.from(digest.slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sourceKey(entity: MigrationEntity, record: LegacyRecord, index: number): string {
  const id = record.id == null || record.id === '' ? checksum({ entity, record, index }) : String(record.id);
  return `${entity}:${id}`;
}

function mapFieldName(key: string): string {
  const aliases: Record<string, string> = {
    ownerId: 'owner_id', projectId: 'project_id', userId: 'user_id', sourceId: 'source_id', integrationId: 'integration_id',
    artifactId: 'artifact_id', artifactVersionId: 'artifact_version_id', requirementId: 'requirement_id', standardId: 'standard_id',
    reviewSessionId: 'review_session_id', reviewId: 'review_session_id', sessionId: 'review_session_id', session_id: 'review_session_id', parentReviewId: 'parent_review_id', parent_session_id: 'parent_review_id',
    parentSessionId: 'parent_review_id',
    dynamicSessionId: 'dynamic_session_id', findingId: 'finding_id', decisionId: 'decision_id', idempotencyKey: 'idempotency_key',
    versionNumber: 'version_number', contentHash: 'content_hash', byteSize: 'byte_size', storagePath: 'storage_path', sourceRevision: 'source_revision',
    mimeType: 'mime_type', remoteId: 'remote_id', remoteUrl: 'remote_url', syncStatus: 'sync_status', lastSyncedAt: 'last_synced_at', filePath: 'path', file_path: 'path', fileName: 'name', file_name: 'name',
    workspacePath: 'workspace_path', reviewType: 'review_type', finalSummary: 'final_summary', failureReason: 'failure_reason',
    createdAt: 'created_at', updatedAt: 'updated_at', cancelledAt: 'cancelled_at', completedAt: 'completed_at', sourceManifestHash: 'source_manifest_hash',
    displayName: 'display_name', avatarUrl: 'avatar_url', reviewTypeName: 'review_type', evidenceText: 'evidence_text', correlationFingerprint: 'correlation_fingerprint',
    artifactVersion: 'artifact_version_id', contentType: 'content_type', inputTokens: 'input_tokens', outputTokens: 'output_tokens', cacheReadTokens: 'cache_read_tokens', cacheCreationTokens: 'cache_creation_tokens', durationMs: 'duration_ms', errorCode: 'error_code', fallbackProvider: 'fallback_provider', fallbackModel: 'fallback_model', secretCiphertext: 'secret_ciphertext',
  };
  return aliases[key] ?? key;
}

function storageRecord(entity: MigrationEntity, raw: LegacyRecord, idMap: Map<string, string>, options: MigrationOptions = {}): LegacyRecord {
  const mapped: LegacyRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    const storageKey = mapFieldName(key);
    if (storageKey.endsWith('_json') && typeof value === 'string') {
      try { mapped[storageKey.slice(0, -5)] = JSON.parse(value); } catch { mapped[storageKey] = value; }
      continue;
    }
    mapped[storageKey] = value;
  }
  if (mapped.owner_id == null && entity === 'projects' && options.defaultOwnerId) mapped.owner_id = options.defaultOwnerId;
  for (const key of ['owner_id', 'user_id', 'actor_id', 'created_by']) {
    const value = mapped[key];
    if (value != null && options.identityMap?.[String(value)]) mapped[key] = options.identityMap[String(value)];
  }
  const sourceId = raw.id == null || raw.id === '' ? checksum(raw) : String(raw.id);
  mapped.id = idMap.get(`${entity}:${sourceId}`) ?? stableMigrationId(entity, sourceId);
  for (const [key, refEntity] of Object.entries(ID_REFERENCE)) {
    if (mapped[key] == null || refEntity === 'projects' && entity === 'projects') continue;
    const rawRef = String(mapped[key]);
    mapped[key] = idMap.get(`${refEntity}:${rawRef}`) ?? (UUID_PATTERN.test(rawRef) ? rawRef : stableMigrationId(refEntity, rawRef));
  }
  if (entity === 'evidence') {
    if (mapped.kind == null && mapped.type != null) mapped.kind = mapped.type;
    if (mapped.locator == null && (mapped.path != null || mapped.file_path != null || mapped.line_number != null)) mapped.locator = { filePath: mapped.path ?? mapped.file_path ?? null, lineNumber: mapped.line_number ?? null };
    if (mapped.content == null && mapped.summary != null) mapped.content = mapped.summary;
  }
  if (entity === 'findings' && mapped.location == null && (mapped.path != null || mapped.file_path != null || mapped.line_number != null)) {
    mapped.location = { filePath: mapped.path ?? mapped.file_path ?? null, lineNumber: mapped.line_number ?? null };
  }
  if (entity === 'modelUsage') {
    if (mapped.stage == null) mapped.stage = mapped.scope ?? 'unknown';
    if (mapped.attempt == null) mapped.attempt = mapped.round_number ?? 1;
    if (mapped.outcome == null) mapped.outcome = 'success';
    if (mapped.metadata == null) mapped.metadata = { scope: mapped.scope ?? null, callKind: mapped.call_kind ?? null, apiFormat: mapped.api_format ?? null };
  }
  // SQLite rows contain a few implementation-era columns that are not part
  // of the Supabase Phase 1 tables. Projecting known fields prevents an
  // otherwise valid import from failing on an unknown-column error.
  const allowed: Partial<Record<MigrationEntity, string[]>> = {
    projects: ['id', 'owner_id', 'name', 'description', 'workspace_path', 'created_at', 'updated_at'],
    members: ['id', 'project_id', 'user_id', 'role', 'created_at'],
    sources: ['id', 'project_id', 'integration_id', 'kind', 'name', 'remote_id', 'remote_url', 'sync_status', 'last_synced_at', 'created_at', 'updated_at'],
    artifacts: ['id', 'project_id', 'source_id', 'path', 'name', 'kind', 'mime_type', 'metadata', 'created_at', 'updated_at'],
    artifactVersions: ['id', 'project_id', 'artifact_id', 'version_number', 'content_hash', 'byte_size', 'storage_path', 'source_revision', 'content_type', 'metadata', 'created_at'],
    requirements: ['id', 'project_id', 'title', 'description', 'category', 'priority', 'created_at', 'updated_at'],
    standards: ['id', 'project_id', 'code', 'title', 'description', 'source', 'version', 'metadata', 'created_at', 'updated_at'],
    requirementMappings: ['id', 'project_id', 'requirement_id', 'standard_id', 'artifact_id', 'file_id', 'symbol_id', 'coverage_status', 'confidence', 'created_at'],
    reviews: ['id', 'project_id', 'name', 'review_type', 'status', 'config', 'progress', 'remarks', 'final_summary', 'failure_reason', 'parent_review_id', 'idempotency_key', 'source_manifest_hash', 'cancelled_at', 'completed_at', 'created_at', 'updated_at'],
    evidence: ['id', 'project_id', 'review_session_id', 'artifact_version_id', 'kind', 'locator', 'content', 'storage_path', 'content_hash', 'metadata', 'immutable', 'created_at'],
    findings: ['id', 'project_id', 'review_session_id', 'dynamic_session_id', 'source', 'severity', 'priority', 'title', 'description', 'status', 'category', 'evidence_text', 'recommendation', 'confidence', 'artifact_id', 'artifact_version_id', 'evidence_id', 'requirement_id', 'standard_id', 'verifier', 'location', 'correlation_fingerprint', 'created_at', 'updated_at'],
    findingStateHistory: ['id', 'project_id', 'finding_id', 'from_status', 'to_status', 'actor_id', 'comment', 'created_at'],
    decisions: ['id', 'project_id', 'review_session_id', 'decision', 'comment', 'reviewer', 'created_at'],
    assessments: ['id', 'project_id', 'review_session_id', 'risk_level', 'score', 'policy_version', 'summary', 'details', 'created_at'],
    modelConfigurations: ['id', 'owner_id', 'project_id', 'purpose', 'provider', 'model', 'base_url', 'secret_ciphertext', 'fallback_provider', 'fallback_model', 'enabled', 'metadata', 'created_at', 'updated_at'],
    modelUsage: ['id', 'project_id', 'review_session_id', 'owner_id', 'stage', 'attempt', 'provider', 'model', 'outcome', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'duration_ms', 'error_code', 'cost', 'metadata', 'created_at'],
    integrations: ['id', 'owner_id', 'provider', 'account_label', 'account_id', 'scopes', 'token_reference', 'expires_at', 'status', 'created_at', 'updated_at'],
    reports: ['id', 'project_id', 'actor_id', 'policy_version', 'generator_version', 'snapshot', 'markdown_storage_path', 'json_storage_path', 'checksum', 'created_at'],
    dynamicSessions: ['id', 'project_id', 'name', 'target_url', 'goal', 'mission_type', 'browser_mode', 'max_steps', 'status', 'final_summary', 'failure_reason', 'created_at', 'updated_at'],
  };
  const fields = allowed[entity];
  if (fields) {
    for (const key of Object.keys(mapped)) if (!fields.includes(key)) delete mapped[key];
  }
  return mapped;
}

function defaultState(): MigrationState {
  return { version: 1, records: {}, objects: {} };
}

export function readMigrationState(filePath: string): MigrationState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MigrationState>;
    return { version: 1, records: parsed.records ?? {}, objects: parsed.objects ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultState();
    throw new Error(`Migration state could not be read: ${String(error)}`);
  }
}

export function writeMigrationState(filePath: string, state: MigrationState): void {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function safeObjectPath(object: LegacyObject, idMap?: Map<string, string>): string {
  const clean = object.path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some(part => part === '..' || part === '.')) throw new Error(`Unsafe legacy storage path: ${object.path}`);
  const sourceProject = object.projectId.trim();
  const project = idMap?.get(`projects:${sourceProject}`) ?? sourceProject;
  if (!UUID_PATTERN.test(project)) throw new Error(`Legacy storage object has an invalid project id: ${object.projectId}`);
  return clean.startsWith(`${project}/`) ? clean : `${project}/${clean}`;
}

function recordsFor(snapshot: LegacySnapshot, entity: MigrationEntity): LegacyRecord[] {
  return (snapshot[entity] ?? []) as LegacyRecord[];
}

/**
 * Execute a resumable, idempotent migration. A record is skipped only when
 * the previous state contains the same checksum and completed status; changed
 * legacy rows are upserted again. Dry-run never calls the target or writes the
 * state file.
 */
export async function migrateLegacy(
  snapshot: LegacySnapshot,
  target: MigrationTarget,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const dryRun = options.dryRun ?? false;
  const state = options.state ?? (options.statePath ? readMigrationState(options.statePath) : defaultState());
  const failures: MigrationFailure[] = [];
  const idMap = new Map<string, string>();
  let planned = 0;
  let migrated = 0;
  let skipped = 0;
  let uploaded = 0;

  for (const entity of ENTITY_ORDER) {
    for (const [index, raw] of recordsFor(snapshot, entity).entries()) {
      const key = sourceKey(entity, raw, index);
      const recordChecksum = checksum(raw);
      const rawId = raw.id == null || raw.id === '' ? checksum({ entity, raw, index }) : String(raw.id);
      const targetId = stableMigrationId(entity, rawId);
      idMap.set(key, targetId);
      planned += 1;
      const previous = state.records[key];
      if (!dryRun && previous?.status === 'completed' && previous.checksum === recordChecksum) {
        skipped += 1;
        continue;
      }
      if (dryRun) continue;
      const entry: MigrationRecordState = { entity, sourceKey: key, checksum: recordChecksum, targetId, status: 'pending', updatedAt: new Date().toISOString() };
      state.records[key] = entry;
      try {
        await target.upsert(entity, storageRecord(entity, raw, idMap, options));
        entry.status = 'completed';
        entry.updatedAt = new Date().toISOString();
        migrated += 1;
      } catch (error) {
        entry.status = 'failed';
        entry.error = error instanceof Error ? error.message : String(error);
        entry.updatedAt = new Date().toISOString();
        failures.push({ entity, sourceKey: key, message: entry.error });
      }
      if (options.statePath) writeMigrationState(options.statePath, state);
    }
  }

  for (const object of snapshot.objects ?? []) {
    planned += 1;
    let objectKey = `${object.bucket}:${object.path}`;
    let objectEntry: MigrationState['objects'][string] | undefined;
    try {
      const safePath = safeObjectPath(object, idMap);
      const bytes = Buffer.isBuffer(object.content) ? object.content : Buffer.from(object.content);
      const objectChecksum = object.checksum ?? checksum(bytes);
      objectKey = `${object.bucket}:${safePath}`;
      const previous = state.objects[objectKey];
      if (!dryRun && previous?.status === 'completed' && previous.checksum === objectChecksum) {
        skipped += 1;
        continue;
      }
      if (dryRun) continue;
      objectEntry = { checksum: objectChecksum, status: 'pending', updatedAt: new Date().toISOString() };
      state.objects[objectKey] = objectEntry;
      if (!target.uploadObject) throw new Error('Migration target does not support storage uploads.');
      await target.uploadObject({ ...object, content: bytes }, safePath);
      objectEntry.status = 'completed';
      objectEntry.updatedAt = new Date().toISOString();
      uploaded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (objectEntry) {
        objectEntry.status = 'failed';
        objectEntry.error = message;
        objectEntry.updatedAt = new Date().toISOString();
      }
      failures.push({ entity: 'object', sourceKey: objectKey, message });
    }
    if (options.statePath) writeMigrationState(options.statePath, state);
  }

  const reconciliation: ReconciliationRow[] = [];
  if (options.reconcile && !dryRun) {
    for (const entity of ENTITY_ORDER) {
      const rows = recordsFor(snapshot, entity);
      const expectedChecksum = checksum(rows.map((row, index) => storageRecord(entity, row, idMap, options)));
      const actualCount = target.count ? await target.count(entity) : null;
      const actualChecksum = target.checksum ? await target.checksum(entity) : null;
      reconciliation.push({ entity, expectedCount: rows.length, actualCount, expectedChecksum, actualChecksum, matches: actualCount === rows.length && (!actualChecksum || actualChecksum === expectedChecksum) });
    }
  }

  if (options.statePath && !dryRun) writeMigrationState(options.statePath, state);
  return { dryRun, planned, migrated, skipped, uploaded, failures, reconciliation, state };
}

function tableRows(db: Database, table: string): LegacyRecord[] {
  try {
    const result = db.exec(`select * from ${table}`)[0];
    if (!result) return [];
    return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])) as LegacyRecord);
  } catch {
    return [];
  }
}

function parseJsonColumns(rows: LegacyRecord[], columns: string[]): LegacyRecord[] {
  return rows.map(row => {
    const copy = { ...row };
    for (const column of columns) {
      if (typeof copy[column] === 'string') {
        try { copy[column] = JSON.parse(String(copy[column])); } catch { /* retain malformed legacy JSON for reconciliation */ }
      }
    }
    return copy;
  });
}

/** Read the known SQLite tables without mutating the legacy database. */
export function readLegacySqliteSnapshot(db: Database): LegacySnapshot {
  return {
    projects: tableRows(db, 'projects'),
    artifacts: tableRows(db, 'artifacts'),
    artifactVersions: tableRows(db, 'artifact_versions'),
    requirements: tableRows(db, 'requirements'),
    requirementMappings: tableRows(db, 'requirement_mappings'),
    reviews: parseJsonColumns([...tableRows(db, 'static_sessions'), ...tableRows(db, 'review_sessions')], ['config_json', 'progress_json', 'config', 'progress']),
    evidence: tableRows(db, 'evidence'),
    findings: tableRows(db, 'findings'),
    decisions: tableRows(db, 'review_decisions'),
    integrations: tableRows(db, 'integrations'),
    modelUsage: tableRows(db, 'token_usage'),
    dynamicSessions: tableRows(db, 'dynamic_sessions'),
  };
}

export async function loadLegacySqliteSnapshot(filePath: string): Promise<LegacySnapshot> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(filePath)));
  try { return readLegacySqliteSnapshot(db); } finally { db.close(); }
}

export class SupabaseMigrationTarget implements MigrationTarget {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(entity: MigrationEntity, record: LegacyRecord): Promise<void> {
    const { error } = await this.client.from(ENTITY_TABLE[entity]).upsert(record as never, { onConflict: 'id' });
    if (error) throw new Error(`${entity} upsert failed: ${error.message}`);
  }

  async uploadObject(object: LegacyObject, safePath: string): Promise<void> {
    const result = await this.client.storage.from(object.bucket).upload(safePath, object.content, { contentType: object.contentType ?? 'application/octet-stream', upsert: true });
    if (result.error) throw new Error(`${object.bucket} upload failed: ${result.error.message}`);
  }

  async count(entity: MigrationEntity): Promise<number> {
    const { count, error } = await this.client.from(ENTITY_TABLE[entity]).select('id', { count: 'exact', head: true });
    if (error) throw new Error(`${entity} count failed: ${error.message}`);
    return count ?? 0;
  }

  async checksum(entity: MigrationEntity): Promise<string> {
    const { data, error } = await this.client.from(ENTITY_TABLE[entity]).select('*').order('id');
    if (error) throw new Error(`${entity} checksum failed: ${error.message}`);
    return checksum((data ?? []) as unknown[]);
  }
}

function parseArgs(argv: string[]): { input: string; state: string; dryRun: boolean; reconcile: boolean; identityMapPath: string | null; defaultOwnerId: string | null } {
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] ?? null : null;
  };
  const input = value('--input');
  if (!input) throw new Error('Usage: pnpm migrate:legacy --input <snapshot.json> [--state <state.json>] [--dry-run] [--reconcile]');
  return { input, state: value('--state') ?? path.resolve('data/centinel-migration-state.json'), dryRun: argv.includes('--dry-run'), reconcile: argv.includes('--reconcile'), identityMapPath: value('--identity-map'), defaultOwnerId: value('--default-owner-id') };
}

/** CLI entry point; kept separate from index.ts so route startup cannot run a migration accidentally. */
export async function runLegacyMigrationCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const snapshot = JSON.parse(fs.readFileSync(args.input, 'utf8')) as LegacySnapshot;
  const identityMap = args.identityMapPath ? JSON.parse(fs.readFileSync(args.identityMapPath, 'utf8')) as Record<string, string> : undefined;
  if (args.dryRun) {
    const result = await migrateLegacy(snapshot, { upsert: async () => undefined }, { dryRun: true, reconcile: false, identityMap, defaultOwnerId: args.defaultOwnerId ?? undefined });
    process.stdout.write(`${JSON.stringify({ dryRun: true, planned: result.planned, failures: result.failures }, null, 2)}\n`);
    return 0;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run a legacy migration.');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await migrateLegacy(snapshot, new SupabaseMigrationTarget(client), { statePath: args.state, reconcile: args.reconcile, identityMap, defaultOwnerId: args.defaultOwnerId ?? undefined });
  process.stdout.write(`${JSON.stringify({ ...result, state: undefined }, null, 2)}\n`);
  return result.failures.length || result.reconciliation.some(item => !item.matches) ? 1 : 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runLegacyMigrationCli().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
