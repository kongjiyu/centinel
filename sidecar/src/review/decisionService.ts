import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewIterationSourceChoice, ReviewOperationKind } from './types.js';

/**
 * The decision service is deliberately constructed with the request's
 * Supabase client.  It does not create a client, read environment credentials,
 * or accept a service-role key.  Storage and database authorization therefore
 * remain in the same bearer-token/RLS context as the rest of the request.
 */

export const DECISION_ATTACHMENT_BUCKET = 'decision-attachments';
export const DECISION_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 15 * 60;
export const MAX_DECISION_ATTACHMENTS = 5;
export const MAX_DECISION_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export const ALLOWED_DECISION_ATTACHMENT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export type ReviewDecision = 'approved' | 'changes_requested' | 'commented';

export type DecisionAttachmentUpload = {
  fileName: string;
  mimeType: string;
  /** Base64 content as sent by the authenticated HTTP client. */
  contentBase64?: string;
  /** Alias accepted by the command seam for callers already using content. */
  content?: string | Uint8Array;
};

export type DecisionAttachmentMetadata = {
  id: string;
  projectId: string;
  reviewId: string;
  decisionId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  /** Internal object path. The bucket itself is DECISION_ATTACHMENT_BUCKET. */
  storagePath: string;
  createdAt: string;
};

export type ReviewDecisionRecord = {
  id: string;
  projectId: string;
  reviewId: string;
  decision: ReviewDecision;
  comment: string;
  reviewer: string;
  createdAt: string;
  attachments: DecisionAttachmentMetadata[];
};

export type ReviewDecisionParentState = {
  id: string;
  projectId: string;
  status: string;
  revision: number;
};

export type PreparedReviewState = {
  id: string;
  projectId: string;
  name: string;
  reviewType: string;
  status: string;
  idempotencyKey: string;
  scope: Record<string, unknown>;
  config: Record<string, unknown>;
  lineage: Record<string, unknown>;
  iteration: Record<string, unknown>;
  sourceManifestId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewDecisionOperation = {
  operation: ReviewOperationKind | string;
  idempotencyKey: string;
  projectId: string;
  reviewId: string;
  parentReviewId: string | null;
  decisionId: string;
  createdAt: string;
};

export type SubmitReviewDecisionCommandInput = {
  projectId: string;
  reviewId: string;
  /** Must be the subject resolved from the bearer token, never a caller header. */
  actorId: string;
  decision: ReviewDecision;
  comment?: string;
  reviewer?: string;
  idempotencyKey?: string;
  /** Required for changes_requested; source reuse/refresh must be explicit. */
  sourceChoice?: ReviewIterationSourceChoice;
  attachments?: DecisionAttachmentUpload[];
};

export type SubmitReviewDecisionCommandResult = {
  operation: ReviewDecisionOperation;
  decision: ReviewDecisionRecord;
  parent: ReviewDecisionParentState;
  preparedChild: PreparedReviewState | null;
};

export type DecisionAttachmentDownload = DecisionAttachmentMetadata & {
  signedUrl: string;
  expiresAt: string;
};

export class ReviewDecisionServiceError extends Error {
  readonly code: string;
  readonly cleanupIncomplete: boolean;

  constructor(message: string, options: { code?: string; cleanupIncomplete?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ReviewDecisionServiceError';
    this.code = options.code ?? 'review_decision_error';
    this.cleanupIncomplete = options.cleanupIncomplete ?? false;
  }
}

type Row = Record<string, unknown>;
type Query = any;

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return String(row[key]);
  }
  return '';
}

function nullableText(row: Row, ...keys: string[]): string | null {
  const value = text(row, ...keys);
  return value ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {};
}

function numberValue(row: Row, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function safeMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message ?? '').slice(0, 500);
  }
  return String(error ?? '').slice(0, 500);
}

function errorFor(label: string, error: unknown): ReviewDecisionServiceError {
  return new ReviewDecisionServiceError(`Supabase ${label} failed: ${safeMessage(error)}`, { cause: error });
}

function isValidDecision(value: unknown): value is ReviewDecision {
  return value === 'approved' || value === 'changes_requested' || value === 'commented';
}

function validSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '.' || normalized === '..' || /[\\/\u0000]/.test(normalized)) {
    throw new ReviewDecisionServiceError(`${label} contains an invalid path segment.`, { code: 'invalid_request' });
  }
  return normalized;
}

function normalizeFileName(value: unknown): string {
  const fileName = typeof value === 'string' ? value.trim() : '';
  if (!fileName || fileName.length > 255 || fileName === '.' || fileName === '..' || /[\\/\u0000]/.test(fileName)) {
    throw new ReviewDecisionServiceError('Supportive document names must be between 1 and 255 characters and may not contain path separators.', { code: 'invalid_attachment' });
  }
  return fileName;
}

function storageFileName(fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 180) || 'attachment';
  return `${crypto.randomUUID()}-${safe}`;
}

function decodeBase64(input: DecisionAttachmentUpload): Buffer {
  const source = input.contentBase64 ?? input.content;
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (typeof source !== 'string' || !source || !/^[A-Za-z0-9+/]+={0,2}$/.test(source) || source.length % 4 === 1) {
    throw new ReviewDecisionServiceError('Supportive document content must be valid non-empty base64.', { code: 'invalid_attachment' });
  }
  const bytes = Buffer.from(source, 'base64');
  // Reject non-canonical encodings and silently ignored trailing characters.
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== source.replace(/=+$/, '')) {
    throw new ReviewDecisionServiceError('Supportive document content must be valid non-empty base64.', { code: 'invalid_attachment' });
  }
  return bytes;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashBytes(value: Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deriveIdempotencyKey(input: SubmitReviewDecisionCommandInput, attachmentHashes: string[]): string {
  return hash(JSON.stringify({
    operation: input.decision === 'changes_requested' ? 'request_changes' : 'record_decision',
    projectId: input.projectId,
    reviewId: input.reviewId,
    actorId: input.actorId,
    decision: input.decision,
    comment: (input.comment ?? '').trim(),
    reviewer: (input.reviewer ?? '').trim(),
    sourceChoice: input.sourceChoice ?? null,
    attachmentHashes,
  }));
}

function mapAttachment(row: Row, fallback: Partial<DecisionAttachmentMetadata> = {}): DecisionAttachmentMetadata {
  return {
    id: text(row, 'id') || fallback.id || '',
    projectId: text(row, 'project_id', 'projectId') || fallback.projectId || '',
    reviewId: text(row, 'review_session_id', 'reviewId') || fallback.reviewId || '',
    decisionId: text(row, 'decision_id', 'decisionId') || fallback.decisionId || '',
    fileName: text(row, 'file_name', 'fileName'),
    mimeType: text(row, 'mime_type', 'mimeType',) || 'application/octet-stream',
    byteSize: numberValue(row, 'byte_size', 'byteSize'),
    contentHash: text(row, 'content_hash', 'contentHash'),
    storagePath: text(row, 'storage_path', 'storagePath'),
    createdAt: text(row, 'created_at', 'createdAt'),
  };
}

function mapDecision(row: Row, attachments: DecisionAttachmentMetadata[] = []): ReviewDecisionRecord {
  const decision = text(row, 'decision') as ReviewDecision;
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id', 'projectId'),
    reviewId: text(row, 'review_session_id', 'reviewId'),
    decision: isValidDecision(decision) ? decision : 'commented',
    comment: text(row, 'comment'),
    reviewer: text(row, 'reviewer'),
    createdAt: text(row, 'created_at', 'createdAt'),
    attachments,
  };
}

function mapParent(row: Row, fallback: { projectId: string; reviewId: string }): ReviewDecisionParentState {
  return {
    id: text(row, 'id') || fallback.reviewId,
    projectId: text(row, 'project_id', 'projectId') || fallback.projectId,
    status: text(row, 'status') || 'unknown',
    revision: numberValue(row, 'revision'),
  };
}

function mapPreparedChild(row: unknown): PreparedReviewState | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const value = asRow(row);
  const id = text(value, 'id');
  if (!id) return null;
  return {
    id,
    projectId: text(value, 'project_id', 'projectId'),
    name: text(value, 'name'),
    reviewType: text(value, 'review_type', 'reviewType'),
    status: text(value, 'status') || 'prepared',
    idempotencyKey: text(value, 'idempotency_key', 'idempotencyKey'),
    scope: objectValue(value.scope),
    config: objectValue(value.config),
    lineage: objectValue(value.lineage),
    iteration: objectValue(value.iteration),
    sourceManifestId: nullableText(value, 'source_manifest_id', 'sourceManifestId'),
    createdAt: text(value, 'created_at', 'createdAt'),
    updatedAt: text(value, 'updated_at', 'updatedAt'),
  };
}

function mapOperation(row: Row, fallback: { operation: string; idempotencyKey: string; projectId: string; reviewId: string; decisionId?: string }): ReviewDecisionOperation {
  return {
    operation: text(row, 'operation') || fallback.operation,
    idempotencyKey: text(row, 'idempotency_key', 'idempotencyKey') || fallback.idempotencyKey,
    projectId: text(row, 'project_id', 'projectId') || fallback.projectId,
    reviewId: text(row, 'review_id', 'reviewId') || fallback.reviewId,
    parentReviewId: nullableText(row, 'parent_review_id', 'parentReviewId'),
    decisionId: text(row, 'decision_id', 'decisionId') || fallback.decisionId || '',
    createdAt: text(row, 'created_at', 'createdAt'),
  };
}

function mapCommandResult(value: unknown, fallback: { operation: string; idempotencyKey: string; projectId: string; reviewId: string; decisionId: string }): SubmitReviewDecisionCommandResult {
  const result = asRow(value);
  const operation = mapOperation(asRow(result.operation), fallback);
  const rawDecision = asRow(result.decision);
  const rawAttachments = Array.isArray(rawDecision.attachments) ? rawDecision.attachments : [];
  const decision = mapDecision(rawDecision, rawAttachments.map(item => mapAttachment(asRow(item), {
    projectId: fallback.projectId,
    reviewId: fallback.reviewId,
    decisionId: fallback.decisionId,
  })));
  const parent = mapParent(asRow(result.parent), { projectId: fallback.projectId, reviewId: fallback.reviewId });
  return {
    operation,
    decision,
    parent,
    preparedChild: mapPreparedChild(result.preparedChild ?? result.prepared_child),
  };
}

type PreparedUpload = {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  contentHash: string;
};

type StoredUpload = PreparedUpload & {
  id: string;
  storagePath: string;
};

export class SupabaseReviewDecisionService {
  constructor(private readonly client: SupabaseClient) {}

  private from(table: string): Query {
    return this.client.from(table);
  }

  private async decisionAttachments(projectId: string, reviewId: string, decisionId: string): Promise<DecisionAttachmentMetadata[]> {
    const result = await this.from('review_decision_attachments')
      .select('id,project_id,review_session_id,decision_id,storage_path,file_name,mime_type,byte_size,content_hash,created_at')
      .eq('project_id', projectId)
      .eq('review_session_id', reviewId)
      .eq('decision_id', decisionId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (result.error) throw errorFor('decision attachment list', result.error);
    return (result.data ?? []).map((row: unknown) => mapAttachment(asRow(row), { projectId, reviewId, decisionId }));
  }

  private async loadDecision(projectId: string, reviewId: string, decisionId: string): Promise<ReviewDecisionRecord | null> {
    const result = await this.from('review_decisions')
      .select('id,project_id,review_session_id,decision,comment,reviewer,created_at')
      .eq('project_id', projectId)
      .eq('review_session_id', reviewId)
      .eq('id', decisionId)
      .maybeSingle();
    if (result.error) throw errorFor('decision lookup', result.error);
    if (!result.data) return null;
    return mapDecision(asRow(result.data), await this.decisionAttachments(projectId, reviewId, decisionId));
  }

  private async existingCommandResult(
    projectId: string,
    reviewId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<SubmitReviewDecisionCommandResult | null> {
    const result = await this.from('review_operations')
      .select('operation,idempotency_key,project_id,review_id,parent_review_id,decision_id,created_at')
      .eq('project_id', projectId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (result.error) throw errorFor('decision idempotency lookup', result.error);
    if (!result.data) return null;
    const operationRow = asRow(result.data);
    const originalReviewId = text(operationRow, 'parent_review_id') || text(operationRow, 'review_id');
    if (originalReviewId !== reviewId) {
      throw new ReviewDecisionServiceError('The idempotency key already belongs to another Review.', { code: 'idempotency_conflict' });
    }
    const decisionId = text(operationRow, 'decision_id');
    const targetReviewId = text(operationRow, 'review_id') || reviewId;
    const decision = decisionId
      ? await this.loadDecision(projectId, reviewId, decisionId)
      : null;
    if (!decision) {
      // A legacy operation row cannot safely be presented as a decision. The
      // RPC will perform the authoritative recovery check under transaction.
      return null;
    }
    const parentResult = await this.from('review_sessions').select('id,project_id,status,revision')
      .eq('id', reviewId).eq('project_id', projectId).maybeSingle();
    if (parentResult.error) throw errorFor('decision parent lookup', parentResult.error);
    const childResult = targetReviewId === reviewId
      ? { data: null, error: null }
      : await this.from('review_sessions').select('*').eq('id', targetReviewId).eq('project_id', projectId).maybeSingle();
    if (childResult.error) throw errorFor('prepared child lookup', childResult.error);
    return {
      operation: mapOperation(operationRow, { operation, idempotencyKey, projectId, reviewId, decisionId }),
      decision,
      parent: mapParent(asRow(parentResult.data), { projectId, reviewId }),
      preparedChild: mapPreparedChild(childResult.data),
    };
  }

  private async cleanup(paths: string[]): Promise<boolean> {
    if (!paths.length) return false;
    try {
      const result = await this.client.storage.from(DECISION_ATTACHMENT_BUCKET).remove(paths);
      return Boolean(result.error);
    } catch {
      return true;
    }
  }

  private async uploadAttachment(projectId: string, reviewId: string, decisionId: string, item: PreparedUpload): Promise<StoredUpload> {
    const id = crypto.randomUUID();
    const storagePath = `${projectId}/${reviewId}/${decisionId}/${storageFileName(item.fileName)}`;
    try {
      const result = await this.client.storage.from(DECISION_ATTACHMENT_BUCKET).upload(storagePath, item.bytes, {
        contentType: item.mimeType,
        cacheControl: '3600',
        upsert: false,
      });
      if (result.error) throw result.error;
    } catch (cause) {
      throw errorFor('decision attachment upload', cause);
    }
    return { ...item, id, storagePath };
  }

  private prepareUploads(input: SubmitReviewDecisionCommandInput): PreparedUpload[] {
    const attachments = input.attachments ?? [];
    if (attachments.length > MAX_DECISION_ATTACHMENTS) {
      throw new ReviewDecisionServiceError(`A maximum of ${MAX_DECISION_ATTACHMENTS} supportive documents can be attached.`, { code: 'invalid_attachment' });
    }
    return attachments.map(attachment => {
      const fileName = normalizeFileName(attachment.fileName);
      const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim().toLowerCase() : '';
      if (!ALLOWED_DECISION_ATTACHMENT_TYPES.has(mimeType)) {
        throw new ReviewDecisionServiceError(`Unsupported supportive document type: ${mimeType || '(missing)'}`, { code: 'invalid_attachment' });
      }
      const bytes = decodeBase64(attachment);
      if (bytes.byteLength > MAX_DECISION_ATTACHMENT_BYTES) {
        throw new ReviewDecisionServiceError(`Supportive document is too large: ${fileName}`, { code: 'invalid_attachment' });
      }
      return { fileName, mimeType, bytes, contentHash: hashBytes(bytes) };
    });
  }

  /**
   * Submit a human decision. Request Changes is one RPC that inserts the
   * decision, transitions the parent, prepares the child, saves lineage, and
   * records idempotency. Objects are uploaded first and metadata is inserted by
   * that RPC only after every upload succeeds; all failure paths compensate.
   */
  async submit(input: SubmitReviewDecisionCommandInput): Promise<SubmitReviewDecisionCommandResult> {
    const projectId = validSegment(input.projectId, 'projectId');
    const reviewId = validSegment(input.reviewId, 'reviewId');
    const actorId = input.actorId.trim();
    if (!actorId) throw new ReviewDecisionServiceError('The authenticated reviewer identity is required.', { code: 'invalid_request' });
    if (!isValidDecision(input.decision)) throw new ReviewDecisionServiceError(`Invalid decision: ${String(input.decision)}`, { code: 'invalid_decision' });
    const comment = (input.comment ?? '').trim();
    const reviewer = (input.reviewer ?? '').trim();
    if (comment.length > 100_000) throw new ReviewDecisionServiceError('Decision feedback is too long.', { code: 'invalid_request' });
    if (input.decision === 'changes_requested' && input.sourceChoice !== 'reuse' && input.sourceChoice !== 'refresh') {
      throw new ReviewDecisionServiceError('Choose whether the prepared child should reuse or refresh its source manifest.', { code: 'invalid_request' });
    }
    if (input.decision !== 'changes_requested' && input.sourceChoice !== undefined) {
      throw new ReviewDecisionServiceError('sourceChoice is only valid for Request Changes.', { code: 'invalid_request' });
    }

    const prepared = this.prepareUploads(input);
    const key = input.idempotencyKey?.trim() || deriveIdempotencyKey(input, prepared.map(item => item.contentHash));
    if (!key || key.length > 255) throw new ReviewDecisionServiceError('idempotencyKey must be between 1 and 255 characters.', { code: 'invalid_request' });
    const operation = input.decision === 'changes_requested' ? 'request_changes' : 'record_decision';

    // Avoid duplicate Storage objects on a retried command. The RPC repeats
    // this check inside the transaction for concurrent callers.
    const existing = await this.existingCommandResult(projectId, reviewId, operation, key);
    if (existing) return existing;

    const decisionId = crypto.randomUUID();
    const childId = input.decision === 'changes_requested' ? crypto.randomUUID() : null;
    const childIdempotencyKey = childId ? `${key}:child` : null;
    const uploaded: StoredUpload[] = [];
    try {
      for (const item of prepared) uploaded.push(await this.uploadAttachment(projectId, reviewId, decisionId, item));

      const attachmentMetadata = uploaded.map(item => ({
        id: item.id,
        storage_path: item.storagePath,
        file_name: item.fileName,
        mime_type: item.mimeType,
        byte_size: item.bytes.byteLength,
        content_hash: item.contentHash,
      }));
      const result = await this.client.rpc('submit_review_decision', {
        p_project_id: projectId,
        p_review_id: reviewId,
        p_actor_id: actorId,
        p_decision_id: decisionId,
        p_decision: input.decision,
        p_comment: comment,
        p_reviewer: reviewer,
        p_idempotency_key: key,
        p_source_choice: input.sourceChoice ?? null,
        p_child_review_id: childId,
        p_child_idempotency_key: childIdempotencyKey,
        p_attachment_metadata: attachmentMetadata,
      });
      if (result.error) throw errorFor('decision command', result.error);
      const committed = mapCommandResult(result.data, { operation, idempotencyKey: key, projectId, reviewId, decisionId });
      if (committed.decision.reviewId !== reviewId || committed.decision.projectId !== projectId) {
        throw new ReviewDecisionServiceError('The idempotency key already belongs to another Review.', { code: 'idempotency_conflict' });
      }
      return committed;
    } catch (cause) {
      // A concurrent caller may have won the idempotency race. Recover its
      // committed result after compensating only this call's object paths.
      const cleanupIncomplete = await this.cleanup(uploaded.map(item => item.storagePath));
      if (!cleanupIncomplete) {
        try {
          const recovered = await this.existingCommandResult(projectId, reviewId, operation, key);
          if (recovered) return recovered;
        } catch (recoveryError) {
          if (recoveryError instanceof ReviewDecisionServiceError && recoveryError.code === 'idempotency_conflict') throw recoveryError;
          // Preserve the original command failure below. A subsequent retry
          // can still use the RPC's idempotent operation record.
        }
      }
      if (cause instanceof ReviewDecisionServiceError && (cause.code === 'invalid_attachment' || cause.code === 'idempotency_conflict')) throw cause;
      throw new ReviewDecisionServiceError(
        cleanupIncomplete
          ? 'Decision persistence failed and attachment cleanup could not be confirmed.'
          : `Decision persistence failed: ${safeMessage(cause)}`,
        { code: cleanupIncomplete ? 'cleanup_incomplete' : 'decision_persistence_failed', cleanupIncomplete, cause },
      );
    }
  }

  async listDecisionAttachments(projectId: string, reviewId: string, decisionId: string): Promise<DecisionAttachmentMetadata[]> {
    validSegment(projectId, 'projectId');
    validSegment(reviewId, 'reviewId');
    validSegment(decisionId, 'decisionId');
    const decision = await this.loadDecision(projectId, reviewId, decisionId);
    if (!decision) throw new ReviewDecisionServiceError('Review decision not found.', { code: 'not_found' });
    return decision.attachments;
  }

  async listReviewDecisions(projectId: string, reviewId: string, limit = 50, offset = 0): Promise<ReviewDecisionRecord[]> {
    validSegment(projectId, 'projectId');
    validSegment(reviewId, 'reviewId');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ReviewDecisionServiceError('limit must be an integer from 1 to 100.', { code: 'invalid_request' });
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
      throw new ReviewDecisionServiceError('offset must be an integer from 0 to 1000000.', { code: 'invalid_request' });
    }
    const review = await this.from('review_sessions')
      .select('id')
      .eq('id', reviewId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (review.error) throw errorFor('decision Review lookup', review.error);
    if (!review.data) throw new ReviewDecisionServiceError('Review not found.', { code: 'not_found' });
    const result = await this.from('review_decisions')
      .select('id,project_id,review_session_id,decision,comment,reviewer,created_at')
      .eq('project_id', projectId)
      .eq('review_session_id', reviewId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (result.error) throw errorFor('decision history list', result.error);
    const output: ReviewDecisionRecord[] = [];
    for (const row of result.data ?? []) {
      const value = asRow(row);
      const id = text(value, 'id');
      output.push(mapDecision(value, await this.decisionAttachments(projectId, reviewId, id)));
    }
    return output;
  }

  async createDecisionAttachmentDownload(
    projectId: string,
    reviewId: string,
    decisionId: string,
    attachmentId: string,
    expiresIn = DECISION_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  ): Promise<DecisionAttachmentDownload> {
    validSegment(projectId, 'projectId');
    validSegment(reviewId, 'reviewId');
    validSegment(decisionId, 'decisionId');
    validSegment(attachmentId, 'attachmentId');
    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 60 * 60) {
      throw new ReviewDecisionServiceError('expiresIn must be between 1 and 3600 seconds.', { code: 'invalid_request' });
    }
    const result = await this.from('review_decision_attachments')
      .select('id,project_id,review_session_id,decision_id,storage_path,file_name,mime_type,byte_size,content_hash,created_at')
      .eq('id', attachmentId)
      .eq('project_id', projectId)
      .eq('review_session_id', reviewId)
      .eq('decision_id', decisionId)
      .maybeSingle();
    if (result.error) throw errorFor('decision attachment lookup', result.error);
    if (!result.data) throw new ReviewDecisionServiceError('Review decision attachment not found.', { code: 'not_found' });
    const attachment = mapAttachment(asRow(result.data), { projectId, reviewId });
    try {
      const signed = await this.client.storage.from(DECISION_ATTACHMENT_BUCKET).createSignedUrl(
        attachment.storagePath,
        expiresIn,
        { download: attachment.fileName },
      );
      if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('no signed URL returned');
      return {
        ...attachment,
        signedUrl: signed.data.signedUrl,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    } catch (cause) {
      throw errorFor('decision attachment signed URL', cause);
    }
  }
}

/** Stable factory for route composition and tests. */
export function createReviewDecisionService(client: SupabaseClient): SupabaseReviewDecisionService {
  return new SupabaseReviewDecisionService(client);
}

/** Command-oriented alias for callers that do not retain a service object. */
export async function submitReviewDecisionCommand(
  client: SupabaseClient,
  input: SubmitReviewDecisionCommandInput,
): Promise<SubmitReviewDecisionCommandResult> {
  return createReviewDecisionService(client).submit(input);
}
