import crypto from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { throwIfAborted } from './abort.js';
import { encryptSecret, decryptSecret } from '../tokenVault.js';
import type { CandidateSupportRecord } from './assessmentValidation.js';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_BUCKET = 'project-artifacts';
const CACHE_EVENT = 'review_batch_cache_saved';
const CACHE_ENTITY = 'static_review';
const MAX_CACHE_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_ARCHIVE_BYTES = 4 * 1024 * 1024;
const compress = promisify(gzip);
const decompress = promisify(gunzip);
const sha256 = (value: Buffer | string) => crypto.createHash('sha256').update(value).digest('hex');
const UUID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SHA256_PATTERN = /^[a-f\d]{64}$/i;

/**
 * A strict subset memoization record. Callers only save clean batches whose
 * generation and supported semantic records have already passed the Review
 * validators. The caller must rerun all validators and cross-batch
 * reconciliation when it loads a record.
 */
export type ValidatedBatchCacheRecord = {
  version: 1;
  projectId: string;
  ownerId: string;
  originReviewId: string;
  requestHash: string;
  policyVersion: string;
  validationVersion: string;
  providerFingerprint: string;
  generation: unknown;
  supportRecords: CandidateSupportRecord[];
};

export interface ValidatedBatchCache {
  load(projectId: string, requestHash: string, signal?: AbortSignal): Promise<ValidatedBatchCacheRecord | null>;
  save(record: ValidatedBatchCacheRecord, signal?: AbortSignal): Promise<void>;
}

/** Codex-only installations do not otherwise require a server encryption key. */
export function optionalValidatedBatchCache(clientSource: ClientSource, ownerId: string): ValidatedBatchCache | undefined {
  return process.env.CENTINEL_TOKEN_ENCRYPTION_KEY?.trim() ? new SupabaseValidatedBatchCache(clientSource, ownerId) : undefined;
}

export class ValidatedBatchCacheError extends Error {
  constructor(message: string, readonly code: 'invalid_record' | 'owner_mismatch' | 'authorization' | 'persistence' | 'invalid_receipt' | 'invalid_archive') {
    super(message);
    this.name = 'ValidatedBatchCacheError';
  }
}

type ClientSource = SupabaseClient | (() => SupabaseClient);
type CacheReceipt = {
  version: 1;
  ownerId: string;
  projectId: string;
  originReviewId: string;
  requestHash: string;
  archivePath: string;
  archiveSha256: string;
  archiveBytes: number;
  recordSha256: string;
};
type ReceiptRow = {
  id?: unknown;
  project_id?: unknown;
  actor_id?: unknown;
  event_type?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  payload?: unknown;
  created_at?: unknown;
};

const domains = new Set(['security', 'business', 'technical', 'personnel']);
const findingSeverities = new Set(['critical', 'high', 'medium', 'low', 'info']);
const confidences = new Set(['high', 'medium', 'low']);
const outcomes = new Set(['potential_gap', 'no_issue_identified', 'not_applicable', 'unverified']);
const supportBoundaries = new Set(['local_source', 'selected_call_path', 'runtime_dependent']);
const supportRoles = new Set(['entry', 'guard', 'sink', 'counterevidence', 'contract']);
const authorityKinds = new Set(['requirement', 'standard_rule', 'reviewer_disposition', 'traceability_mapping']);
const requiredFindingKeys = ['title', 'description', 'category', 'severity', 'filePath', 'lineNumber', 'evidence', 'recommendation', 'confidence'];
const allowedFindingKeys = new Set([
  ...requiredFindingKeys, 'domain', 'issueType', 'logicFlow', 'relatedLocations', 'artifactId', 'requirementId',
  'standardId', 'standardRuleId', 'ruleId', 'sourceIdentity', 'sourceVersion', 'sourceLocator',
]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertObject(value: unknown, label: string, allowed?: ReadonlySet<string>, required?: readonly string[]): Record<string, unknown> {
  if (!object(value)) throw new ValidatedBatchCacheError(`${label} must be a JSON object.`, 'invalid_record');
  if (allowed && Object.keys(value).some(key => !allowed.has(key))) throw new ValidatedBatchCacheError(`${label} contains unsupported fields.`, 'invalid_record');
  if (required && required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new ValidatedBatchCacheError(`${label} is missing required fields.`, 'invalid_record');
  return value;
}

function assertString(value: unknown, label: string, maxLength = 16_384, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new ValidatedBatchCacheError(`${label} is invalid.`, 'invalid_record');
  }
  return value;
}

function assertNullableString(value: unknown, label: string, maxLength = 2_048): string | null {
  return value === null ? null : assertString(value, label, maxLength, true);
}

function assertLine(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ValidatedBatchCacheError(`${label} is invalid.`, 'invalid_record');
  return value;
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new ValidatedBatchCacheError(`${label} must be a UUID.`, 'invalid_record');
  return value.toLowerCase();
}

function assertHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new ValidatedBatchCacheError(`${label} must be a SHA-256 hash.`, 'invalid_record');
  return value.toLowerCase();
}

function assertEnum(value: unknown, choices: ReadonlySet<string>, label: string): string {
  if (typeof value !== 'string' || !choices.has(value)) throw new ValidatedBatchCacheError(`${label} is unsupported.`, 'invalid_record');
  return value;
}

function sanitizeDomainEvidence(value: unknown): Record<string, unknown> {
  const item = assertObject(value, 'Domain evidence', new Set(['artifactId', 'filePath', 'lineNumber', 'sourceVersion']),
    ['artifactId', 'filePath', 'lineNumber', 'sourceVersion']);
  return {
    artifactId: assertString(item.artifactId, 'Evidence artifact id', 256),
    filePath: assertString(item.filePath, 'Evidence file path', 2_048),
    lineNumber: assertLine(item.lineNumber, 'Evidence line number'),
    sourceVersion: assertNullableString(item.sourceVersion, 'Evidence source version', 256),
  };
}

function sanitizeAssessment(value: unknown): Record<string, unknown> {
  const item = assertObject(value, 'Feature assessment', new Set(['domain', 'status', 'outcome', 'summary', 'evidence']),
    ['domain', 'status', 'outcome', 'summary', 'evidence']);
  if (item.status !== 'assessed' && item.status !== 'unverified') throw new ValidatedBatchCacheError('Feature assessment status is invalid.', 'invalid_record');
  if (!Array.isArray(item.evidence) || item.evidence.length > 256) throw new ValidatedBatchCacheError('Feature assessment evidence is invalid.', 'invalid_record');
  return {
    domain: assertEnum(item.domain, domains, 'Assessment domain'),
    status: item.status,
    outcome: assertEnum(item.outcome, outcomes, 'Assessment outcome'),
    summary: assertString(item.summary, 'Assessment summary', 16_384),
    evidence: item.evidence.map(sanitizeDomainEvidence),
  };
}

function sanitizeFeatureAssessment(value: unknown): Record<string, unknown> {
  const item = assertObject(value, 'Feature assessment row', new Set(['featureId', 'assessments']), ['featureId', 'assessments']);
  if (!Array.isArray(item.assessments) || item.assessments.length !== 4) throw new ValidatedBatchCacheError('Feature assessment domains are incomplete.', 'invalid_record');
  const assessments = item.assessments.map(sanitizeAssessment);
  if (new Set(assessments.map(assessment => assessment.domain)).size !== 4) throw new ValidatedBatchCacheError('Feature assessment domains are duplicated.', 'invalid_record');
  return { featureId: assertString(item.featureId, 'Feature id', 256), assessments };
}

function sanitizeRelatedLocation(value: unknown): Record<string, unknown> {
  const item = assertObject(value, 'Related location', new Set(['filePath', 'lineNumber', 'evidence', 'artifactId', 'sourceVersion']),
    ['filePath', 'lineNumber', 'evidence']);
  return {
    filePath: assertString(item.filePath, 'Related location path', 2_048),
    lineNumber: assertLine(item.lineNumber, 'Related location line'),
    evidence: assertString(item.evidence, 'Related location excerpt', 65_536),
    ...(Object.prototype.hasOwnProperty.call(item, 'artifactId') ? { artifactId: assertNullableString(item.artifactId, 'Related artifact id', 256) } : {}),
    ...(Object.prototype.hasOwnProperty.call(item, 'sourceVersion') ? { sourceVersion: assertNullableString(item.sourceVersion, 'Related source version', 256) } : {}),
  };
}

function sanitizeSourceLocator(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  const item = assertObject(value, 'Finding source locator', new Set(['analysis']), ['analysis']);
  if (item.analysis === null) return { analysis: null };
  const analysis = assertObject(item.analysis, 'Finding analysis locator', new Set(['featureId', 'pathId', 'domain']), ['featureId', 'pathId', 'domain']);
  return { analysis: {
    featureId: assertString(analysis.featureId, 'Analysis feature id', 256),
    pathId: assertString(analysis.pathId, 'Analysis path id', 256),
    domain: assertEnum(analysis.domain, domains, 'Analysis domain'),
  } };
}

function sanitizeFinding(value: unknown): Record<string, unknown> {
  const item = assertObject(value, 'Structured finding', allowedFindingKeys, requiredFindingKeys);
  const finding: Record<string, unknown> = {
    title: assertString(item.title, 'Finding title', 4_096),
    description: assertString(item.description, 'Finding description', 65_536),
    category: assertString(item.category, 'Finding category', 256),
    severity: assertEnum(item.severity, findingSeverities, 'Finding severity'),
    filePath: assertString(item.filePath, 'Finding file path', 2_048),
    lineNumber: assertLine(item.lineNumber, 'Finding line number'),
    evidence: assertString(item.evidence, 'Finding evidence excerpt', 65_536),
    recommendation: assertString(item.recommendation, 'Finding recommendation', 16_384),
    confidence: assertEnum(item.confidence, confidences, 'Finding confidence'),
  };
  if (Object.prototype.hasOwnProperty.call(item, 'domain')) finding.domain = assertEnum(item.domain, domains, 'Finding domain');
  if (Object.prototype.hasOwnProperty.call(item, 'issueType')) finding.issueType = assertString(item.issueType, 'Finding issue type', 256);
  if (Object.prototype.hasOwnProperty.call(item, 'logicFlow')) {
    if (!Array.isArray(item.logicFlow) || item.logicFlow.length > 10) throw new ValidatedBatchCacheError('Finding logic flow is invalid.', 'invalid_record');
    finding.logicFlow = item.logicFlow.map(step => assertString(step, 'Finding logic flow step', 500));
  }
  if (Object.prototype.hasOwnProperty.call(item, 'relatedLocations')) {
    if (!Array.isArray(item.relatedLocations) || item.relatedLocations.length > 16) throw new ValidatedBatchCacheError('Finding related locations are invalid.', 'invalid_record');
    finding.relatedLocations = item.relatedLocations.map(sanitizeRelatedLocation);
  }
  for (const key of ['artifactId', 'requirementId', 'standardId', 'standardRuleId', 'ruleId', 'sourceIdentity', 'sourceVersion'] as const) {
    if (Object.prototype.hasOwnProperty.call(item, key)) finding[key] = assertNullableString(item[key], `Finding ${key}`, 2_048);
  }
  if (Object.prototype.hasOwnProperty.call(item, 'sourceLocator')) finding.sourceLocator = sanitizeSourceLocator(item.sourceLocator);
  return finding;
}

function sanitizeGeneration(value: unknown): { findings: Record<string, unknown>[]; featureAssessments: Record<string, unknown>[] } {
  const generation = assertObject(value, 'Structured generation', new Set(['findings', 'featureAssessments']), ['findings', 'featureAssessments']);
  if (!Array.isArray(generation.findings) || generation.findings.length > 32
    || !Array.isArray(generation.featureAssessments) || generation.featureAssessments.length > 128) {
    throw new ValidatedBatchCacheError('Structured generation exceeds its bounded schema.', 'invalid_record');
  }
  return {
    findings: generation.findings.map(sanitizeFinding),
    featureAssessments: generation.featureAssessments.map(sanitizeFeatureAssessment),
  };
}

function sanitizeSupportReference(value: unknown): CandidateSupportRecord['references'][number] {
  const item = assertObject(value, 'Semantic-support reference', new Set(['role', 'artifactId', 'filePath', 'sourceVersion', 'lineNumber', 'evidence']),
    ['role', 'artifactId', 'filePath', 'sourceVersion', 'lineNumber', 'evidence']);
  return {
    role: assertEnum(item.role, supportRoles, 'Semantic-support reference role') as CandidateSupportRecord['references'][number]['role'],
    artifactId: assertString(item.artifactId, 'Semantic-support artifact id', 256),
    filePath: assertString(item.filePath, 'Semantic-support file path', 2_048),
    sourceVersion: assertString(item.sourceVersion, 'Semantic-support source version', 256),
    lineNumber: assertLine(item.lineNumber, 'Semantic-support line number'),
    evidence: assertString(item.evidence, 'Semantic-support validated excerpt', 2_000),
  };
}

function sanitizeAuthorityReference(value: unknown): CandidateSupportRecord['authorityReferences'][number] {
  const keys = ['kind', 'id', 'version', 'secondaryVersion', 'reviewedVersionId', 'reviewedContentHash'] as const;
  const item = assertObject(value, 'Semantic-support authority reference', new Set(keys), keys);
  return {
    kind: assertEnum(item.kind, authorityKinds, 'Authority reference kind') as CandidateSupportRecord['authorityReferences'][number]['kind'],
    id: assertString(item.id, 'Authority reference id', 256),
    version: assertNullableString(item.version, 'Authority version', 256),
    secondaryVersion: assertNullableString(item.secondaryVersion, 'Authority secondary version', 256),
    reviewedVersionId: assertNullableString(item.reviewedVersionId, 'Reviewed authority version id', 256),
    reviewedContentHash: assertNullableString(item.reviewedContentHash, 'Reviewed authority content hash', 256),
  };
}

function sanitizeSupportRecords(value: unknown, findingCount: number): CandidateSupportRecord[] {
  if (!Array.isArray(value) || value.length > 32 || value.length !== findingCount) {
    throw new ValidatedBatchCacheError('Semantic-support records do not cover every generated finding.', 'invalid_record');
  }
  const ids = new Set<string>();
  return value.map(raw => {
    const keys = ['candidateId', 'claimBoundary', 'disposition', 'trigger', 'consequence', 'references', 'authorityReferences', 'limitation'] as const;
    const item = assertObject(raw, 'Semantic-support record', new Set(keys), keys);
    const candidateId = assertHash(item.candidateId, 'Semantic-support candidate id');
    if (ids.has(candidateId)) throw new ValidatedBatchCacheError('Semantic-support candidate ids must be unique.', 'invalid_record');
    ids.add(candidateId);
    if (item.disposition !== 'supported') throw new ValidatedBatchCacheError('Only fully supported candidates can be cached.', 'invalid_record');
    if (!Array.isArray(item.references) || item.references.length < 1 || item.references.length > 12
      || !Array.isArray(item.authorityReferences) || item.authorityReferences.length > 16) {
      throw new ValidatedBatchCacheError('Semantic-support evidence is incomplete or oversized.', 'invalid_record');
    }
    const claimBoundary = assertEnum(item.claimBoundary, supportBoundaries, 'Semantic-support claim boundary') as CandidateSupportRecord['claimBoundary'];
    const references = item.references.map(sanitizeSupportReference);
    const roles = new Set(references.map(reference => reference.role));
    if (claimBoundary === 'selected_call_path' && (!roles.has('entry') || !roles.has('sink'))
      || claimBoundary === 'runtime_dependent' && !roles.has('contract')) {
      throw new ValidatedBatchCacheError('Semantic-support boundary evidence is incomplete.', 'invalid_record');
    }
    return {
      candidateId,
      claimBoundary,
      disposition: 'supported',
      trigger: assertString(item.trigger, 'Semantic-support trigger', 500),
      consequence: assertString(item.consequence, 'Semantic-support consequence', 500),
      references,
      authorityReferences: item.authorityReferences.map(sanitizeAuthorityReference),
      limitation: assertNullableString(item.limitation, 'Semantic-support limitation', 500),
    };
  });
}

function sanitizeRecord(value: unknown, expected?: { projectId: string; ownerId: string; requestHash: string }): ValidatedBatchCacheRecord {
  const keys = ['version', 'projectId', 'ownerId', 'originReviewId', 'requestHash', 'policyVersion', 'validationVersion', 'providerFingerprint', 'generation', 'supportRecords'] as const;
  const item = assertObject(value, 'Validated batch cache record', new Set(keys), keys);
  if (item.version !== CACHE_SCHEMA_VERSION) throw new ValidatedBatchCacheError('Validated batch cache version is incompatible.', 'invalid_record');
  const projectId = assertUuid(item.projectId, 'Cache project id');
  const ownerId = assertUuid(item.ownerId, 'Cache owner id');
  const originReviewId = assertUuid(item.originReviewId, 'Cache origin Review id');
  const requestHash = assertHash(item.requestHash, 'Cache request hash');
  const policyVersion = assertString(item.policyVersion, 'Cache policy version', 256);
  const validationVersion = assertString(item.validationVersion, 'Cache validation version', 256);
  const providerFingerprint = assertHash(item.providerFingerprint, 'Cache provider fingerprint');
  if (expected && (projectId !== expected.projectId || ownerId !== expected.ownerId || requestHash !== expected.requestHash)) {
    throw new ValidatedBatchCacheError('Validated batch cache identity does not match the requested identity.', 'invalid_record');
  }
  const generation = sanitizeGeneration(item.generation);
  const supportRecords = sanitizeSupportRecords(item.supportRecords, generation.findings.length);
  return { version: 1, projectId, ownerId, originReviewId, requestHash, policyVersion, validationVersion,
    providerFingerprint, generation, supportRecords };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidatedBatchCacheError('Cache JSON contains a non-finite number.', 'invalid_record');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new ValidatedBatchCacheError('Cache record is not canonical JSON.', 'invalid_record');
}

function objectPath(ownerId: string, projectId: string, requestHash: string, archiveSha256: string): string {
  return `${projectId}/_review-batch-cache/v1/${ownerId}/${projectId}/${requestHash}/${archiveSha256}.json.gz`;
}

function receiptId(ownerId: string, projectId: string, requestHash: string): string {
  const bytes = Buffer.from(sha256(`centinel:review-batch-cache-receipt:v1:${ownerId}:${projectId}:${requestHash}`).slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isDuplicate(error: unknown): boolean {
  if (!object(error)) return false;
  return String(error.statusCode ?? error.status ?? error.code ?? '') === '409'
    || /already exists|duplicate/i.test(String(error.message ?? ''));
}

function isMissingObject(error: unknown): boolean {
  if (!object(error)) return false;
  return String(error.statusCode ?? error.status ?? '') === '404' || /object not found/i.test(String(error.message ?? ''));
}

function validReceipt(value: unknown, expected: { id: string; ownerId: string; projectId: string; requestHash: string }): CacheReceipt {
  const row = value as ReceiptRow;
  if (!row || row.id !== expected.id || row.project_id !== expected.projectId || row.actor_id !== expected.ownerId
    || row.event_type !== CACHE_EVENT || row.entity_type !== CACHE_ENTITY || typeof row.entity_id !== 'string'
    || !UUID_PATTERN.test(row.entity_id)) throw new ValidatedBatchCacheError('Validated batch cache receipt is incompatible.', 'invalid_receipt');
  const payload = assertObject(row.payload, 'Validated batch cache receipt payload');
  const receipt: CacheReceipt = {
    version: payload.version as 1,
    ownerId: assertUuid(payload.ownerId, 'Receipt owner id'),
    projectId: assertUuid(payload.projectId, 'Receipt project id'),
    originReviewId: assertUuid(payload.originReviewId, 'Receipt origin Review id'),
    requestHash: assertHash(payload.requestHash, 'Receipt request hash'),
    archivePath: assertString(payload.archivePath, 'Receipt archive path', 1_024),
    archiveSha256: assertHash(payload.archiveSha256, 'Receipt archive hash'),
    archiveBytes: typeof payload.archiveBytes === 'number' ? payload.archiveBytes : -1,
    recordSha256: assertHash(payload.recordSha256, 'Receipt record hash'),
  };
  if (receipt.version !== 1 || receipt.ownerId !== expected.ownerId || receipt.projectId !== expected.projectId
    || receipt.originReviewId !== row.entity_id.toLowerCase() || receipt.requestHash !== expected.requestHash
    || receipt.archivePath !== objectPath(expected.ownerId, expected.projectId, expected.requestHash, receipt.archiveSha256)
    || !Number.isSafeInteger(receipt.archiveBytes) || receipt.archiveBytes < 1 || receipt.archiveBytes > MAX_CACHE_ARCHIVE_BYTES) {
    throw new ValidatedBatchCacheError('Validated batch cache receipt identity is invalid.', 'invalid_receipt');
  }
  const receiptKeys = new Set(['version', 'ownerId', 'projectId', 'originReviewId', 'requestHash', 'archivePath', 'archiveSha256', 'archiveBytes', 'recordSha256']);
  if (Object.keys(payload).some(key => !receiptKeys.has(key))) throw new ValidatedBatchCacheError('Validated batch cache receipt contains unsupported fields.', 'invalid_receipt');
  return receipt;
}

/**
 * Stores only public, structured results under an owner/project/request key.
 * Production callers should pass a callback backed by RefreshableSupabaseRuntime
 * so every operation obtains the latest verified same-owner bearer client.
 */
export class SupabaseValidatedBatchCache implements ValidatedBatchCache {
  private readonly ownerId: string;

  constructor(private readonly clientSource: ClientSource, ownerId: string) {
    if (!UUID_PATTERN.test(ownerId)) throw new ValidatedBatchCacheError('An authenticated cache owner UUID is required.', 'owner_mismatch');
    if (!process.env.CENTINEL_TOKEN_ENCRYPTION_KEY?.trim()) throw new ValidatedBatchCacheError('Validated batch cache encryption is unavailable.', 'persistence');
    this.ownerId = ownerId.toLowerCase();
  }

  async load(projectId: string, requestHash: string, signal?: AbortSignal): Promise<ValidatedBatchCacheRecord | null> {
    const project = assertUuid(projectId, 'Cache project id');
    const hash = assertHash(requestHash, 'Cache request hash');
    const key = { ownerId: this.ownerId, projectId: project, requestHash: hash };
    const receiptClient = await this.authorizedClient(project, signal);
    const receiptResult = await this.receiptQuery(receiptClient, key, signal);
    if (receiptResult.error) throw new ValidatedBatchCacheError('Validated batch cache receipt could not be read.', 'persistence');
    if (!receiptResult.data) return null;
    const receipt = validReceipt(receiptResult.data, { id: receiptId(key.ownerId, project, hash), ...key });

    const storageClient = await this.authorizedClient(project, signal);
    throwIfAborted(signal);
    const download = await storageClient.storage.from(CACHE_BUCKET).download(receipt.archivePath, {}, signal ? { signal } : undefined);
    throwIfAborted(signal);
    if (download.error) {
      if (isMissingObject(download.error)) throw new ValidatedBatchCacheError('Validated batch cache object is missing its receipt-backed archive.', 'invalid_archive');
      throw new ValidatedBatchCacheError('Validated batch cache archive could not be read.', 'persistence');
    }
    if (!download.data || download.data.size < 1 || download.data.size > MAX_CACHE_ARCHIVE_BYTES || download.data.size !== receipt.archiveBytes) {
      throw new ValidatedBatchCacheError('Validated batch cache archive size is invalid.', 'invalid_archive');
    }
    let archive: Buffer;
    try { archive = Buffer.from(await download.data.arrayBuffer()); }
    catch { throw new ValidatedBatchCacheError('Validated batch cache archive could not be read.', 'persistence'); }
    if (archive.length !== receipt.archiveBytes || sha256(archive) !== receipt.archiveSha256) {
      throw new ValidatedBatchCacheError('Validated batch cache archive hash does not match its receipt.', 'invalid_archive');
    }

    let json: Buffer;
    try { json = await decompress(archive, { maxOutputLength: MAX_CACHE_JSON_BYTES }); }
    catch { throw new ValidatedBatchCacheError('Validated batch cache archive is corrupt or oversized.', 'invalid_archive'); }
    if (json.length > MAX_CACHE_JSON_BYTES || sha256(json) !== receipt.recordSha256) {
      throw new ValidatedBatchCacheError('Validated batch cache record does not match its receipt.', 'invalid_archive');
    }
    let decoded: unknown;
    let plaintext: string;
    try { plaintext = decryptSecret(json.toString('utf8')); decoded = JSON.parse(plaintext); }
    catch { throw new ValidatedBatchCacheError('Validated batch cache record authentication failed.', 'invalid_archive'); }
    let record: ValidatedBatchCacheRecord;
    try { record = sanitizeRecord(decoded, key); }
    catch { throw new ValidatedBatchCacheError('Validated batch cache record is incompatible.', 'invalid_archive'); }
    if (record.originReviewId !== receipt.originReviewId || canonicalJson(record) !== plaintext) {
      throw new ValidatedBatchCacheError('Validated batch cache record identity does not match its receipt.', 'invalid_archive');
    }
    return record;
  }

  async save(value: ValidatedBatchCacheRecord, signal?: AbortSignal): Promise<void> {
    const record = sanitizeRecord(value);
    if (record.ownerId !== this.ownerId) throw new ValidatedBatchCacheError('A different owner cannot write this validated batch cache.', 'owner_mismatch');
    const existing = await this.load(record.projectId, record.requestHash, signal);
    if (existing) return; // First valid receipt wins; never overwrite a memoized result.

    const json = Buffer.from(canonicalJson(record), 'utf8');
    if (json.length < 1 || json.length > MAX_CACHE_JSON_BYTES) throw new ValidatedBatchCacheError('Validated batch cache JSON exceeds 4 MiB.', 'invalid_record');
    // Storage RLS is project-member scoped. Authenticated encryption protects
    // result confidentiality and provenance even against direct member writes.
    // The complete owner/project/request identity remains inside the ciphertext.
    let encrypted: Buffer;
    try { encrypted = Buffer.from(encryptSecret(json.toString('utf8')), 'utf8'); }
    catch { throw new ValidatedBatchCacheError('Validated batch cache encryption is unavailable.', 'persistence'); }
    if (encrypted.length > MAX_CACHE_JSON_BYTES) throw new ValidatedBatchCacheError('Validated batch cache encrypted envelope exceeds 4 MiB.', 'invalid_record');
    const archive = await compress(encrypted, { level: 9 });
    if (archive.length < 1 || archive.length > MAX_CACHE_ARCHIVE_BYTES) throw new ValidatedBatchCacheError('Validated batch cache archive exceeds 4 MiB.', 'invalid_record');
    const archiveSha256 = sha256(archive);
    const recordSha256 = sha256(encrypted);
    const archivePath = objectPath(this.ownerId, record.projectId, record.requestHash, archiveSha256);
    const receipt: CacheReceipt = { version: 1, ownerId: this.ownerId, projectId: record.projectId,
      originReviewId: record.originReviewId, requestHash: record.requestHash, archivePath, archiveSha256,
      archiveBytes: archive.length, recordSha256 };

    const uploadClient = await this.authorizedClient(record.projectId, signal);
    throwIfAborted(signal);
    const upload = await uploadClient.storage.from(CACHE_BUCKET).upload(archivePath, archive, {
      contentType: 'application/gzip', cacheControl: '31536000', upsert: false,
      metadata: { schemaVersion: CACHE_SCHEMA_VERSION, requestHash: record.requestHash, archiveSha256 },
    });
    throwIfAborted(signal);
    if (upload.error) {
      if (isDuplicate(upload.error)) {
        const winner = await this.load(record.projectId, record.requestHash, signal);
        if (winner) return;
        // The object name includes the compressed-content hash. A prior writer
        // may have uploaded these exact bytes and stopped before its receipt;
        // verify them byte-for-byte before allowing this writer to finish.
        await this.verifyExistingArchive(record.projectId, archivePath, archive, archiveSha256, signal);
      } else {
        throw new ValidatedBatchCacheError('Validated batch cache archive could not be saved.', 'persistence');
      }
    }

    const eventId = receiptId(this.ownerId, record.projectId, record.requestHash);
    const row = {
      id: eventId,
      project_id: record.projectId,
      actor_id: this.ownerId,
      event_type: CACHE_EVENT,
      entity_type: CACHE_ENTITY,
      entity_id: record.originReviewId,
      idempotency_key: `review-batch-cache:${record.projectId}:${record.requestHash}`,
      payload: receipt,
    };
    const receiptClient = await this.authorizedClient(record.projectId, signal);
    throwIfAborted(signal);
    const inserted = await receiptClient.from('audit_events').insert(row);
    throwIfAborted(signal);
    if (!inserted.error) return;

    // A request timeout can arrive after the insert committed. Only accept the
    // write if a fresh member-scoped read verifies the immutable winner.
    const winner = await this.load(record.projectId, record.requestHash, signal);
    if (winner) return;
    throw new ValidatedBatchCacheError('Validated batch cache receipt could not be saved.', 'persistence');
  }

  private currentClient(): SupabaseClient {
    try { return typeof this.clientSource === 'function' ? this.clientSource() : this.clientSource; }
    catch { throw new ValidatedBatchCacheError('The authenticated Supabase client is unavailable.', 'authorization'); }
  }

  private async authorizedClient(projectId: string, signal?: AbortSignal): Promise<SupabaseClient> {
    throwIfAborted(signal);
    const client = this.currentClient();
    let user: { id?: string } | null = null;
    try {
      const result = await client.auth.getUser();
      if (result.error || !result.data?.user) throw new Error('not authenticated');
      user = result.data.user;
    } catch {
      throw new ValidatedBatchCacheError('The current Supabase client could not verify the cache owner.', 'authorization');
    }
    if (user.id?.toLowerCase() !== this.ownerId) throw new ValidatedBatchCacheError('The current Supabase client belongs to a different cache owner.', 'owner_mismatch');
    try { await new CentinelApplicationRepository(client, this.ownerId).requireProjectMember(projectId, signal); }
    catch { throw new ValidatedBatchCacheError('Project membership could not be verified for the batch cache.', 'authorization'); }
    throwIfAborted(signal);
    return client;
  }

  private async receiptQuery(client: SupabaseClient, key: { ownerId: string; projectId: string; requestHash: string }, signal?: AbortSignal) {
    let query = client.from('audit_events').select('id,project_id,actor_id,event_type,entity_type,entity_id,payload,created_at')
      .eq('id', receiptId(key.ownerId, key.projectId, key.requestHash))
      .eq('project_id', key.projectId).eq('actor_id', key.ownerId)
      .eq('event_type', CACHE_EVENT).eq('entity_type', CACHE_ENTITY);
    if (signal) query = query.abortSignal(signal);
    return query.maybeSingle();
  }

  private async verifyExistingArchive(projectId: string, archivePath: string, expected: Buffer, expectedHash: string, signal?: AbortSignal): Promise<void> {
    const client = await this.authorizedClient(projectId, signal);
    throwIfAborted(signal);
    const result = await client.storage.from(CACHE_BUCKET).download(archivePath, {}, signal ? { signal } : undefined);
    throwIfAborted(signal);
    if (result.error || !result.data) {
      throw new ValidatedBatchCacheError('An immutable batch cache object exists without a valid receipt.', 'invalid_archive');
    }
    let stored: Buffer;
    try { stored = Buffer.from(await result.data.arrayBuffer()); }
    catch { throw new ValidatedBatchCacheError('The existing immutable batch cache object could not be read.', 'persistence'); }
    if (stored.length !== expected.length || sha256(stored) !== expectedHash || !stored.equals(expected)) {
      throw new ValidatedBatchCacheError('An immutable batch cache object does not match its content identity.', 'invalid_archive');
    }
  }
}

export const VALIDATED_BATCH_CACHE_LIMITS = {
  jsonBytes: MAX_CACHE_JSON_BYTES,
  archiveBytes: MAX_CACHE_ARCHIVE_BYTES,
} as const;
