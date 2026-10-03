import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DECISION_ATTACHMENT_BUCKET,
  DECISION_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  ReviewDecisionServiceError,
  SupabaseReviewDecisionService,
} from '../../src/review/decisionService.js';

type Row = Record<string, any>;

class Query implements PromiseLike<any> {
  private filters: Array<[string, string, any]> = [];
  private maxRows: number | undefined;
  private rowRange: [number, number] | undefined;
  constructor(private readonly db: FakeClient, private readonly table: string) {}
  select(_columns?: string) { return this; }
  eq(key: string, value: any) { this.filters.push(['eq', key, value]); return this; }
  order() { return this; }
  limit(value: number) { this.maxRows = value; return this; }
  range(from: number, to: number) { this.rowRange = [from, to]; return this; }
  maybeSingle() { return this.execute(true); }
  then<TResult1 = any, TResult2 = never>(resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute(false).then(resolve ?? undefined, reject ?? undefined);
  }
  private async execute(single: boolean): Promise<any> {
    const rows = (this.db.rows.get(this.table) ?? []).filter(row => this.filters.every(([kind, key, value]) => kind !== 'eq' || row[key] === value));
    const selected = this.rowRange ? rows.slice(this.rowRange[0], this.rowRange[1] + 1)
      : this.maxRows === undefined ? rows : rows.slice(0, this.maxRows);
    return { data: single ? (selected[0] ?? null) : selected, error: null };
  }
}

class FakeClient {
  readonly rows = new Map<string, Row[]>();
  readonly uploads: Array<{ path: string; content: Buffer; options: any }> = [];
  readonly removed: string[][] = [];
  uploadErrorAt: number | null = null;
  cleanupError = false;
  rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
  readonly rpc = vi.fn(async () => this.rpcResult);
  private uploadCount = 0;

  from(table: string) { return new Query(this, table); }

  storage = {
    from: vi.fn((_bucket: string) => ({
      upload: async (path: string, content: Buffer, options: any) => {
        this.uploadCount += 1;
        if (this.uploadErrorAt === this.uploadCount) return { data: null, error: { message: 'upload rejected' } };
        this.uploads.push({ path, content, options });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        this.removed.push(paths);
        return { data: null, error: this.cleanupError ? { message: 'cleanup rejected' } : null };
      },
      createSignedUrl: async (path: string, ttl: number, options: any) => ({
        data: { signedUrl: `https://signed.example.test/${path}?ttl=${ttl}&download=${options.download}` },
        error: null,
      }),
    })),
  };
}

function service(fake: FakeClient): SupabaseReviewDecisionService {
  return new SupabaseReviewDecisionService(fake as unknown as SupabaseClient);
}

const command = {
  projectId: 'project-1',
  reviewId: 'review-1',
  actorId: 'actor-1',
  decision: 'changes_requested' as const,
  comment: 'Please recheck authorization.',
  reviewer: 'Reviewer',
  sourceChoice: 'reuse' as const,
  idempotencyKey: 'request-1',
};

const rpcResult = {
  operation: { operation: 'request_changes', idempotencyKey: 'request-1', projectId: 'project-1', reviewId: 'child-1', parentReviewId: 'review-1', decisionId: 'decision-1', createdAt: '2026-09-22T00:00:00.000Z' },
  decision: { id: 'decision-1', projectId: 'project-1', reviewId: 'review-1', decision: 'changes_requested', comment: command.comment, reviewer: command.reviewer, createdAt: '2026-09-22T00:00:00.000Z', attachments: [] },
  parent: { id: 'review-1', projectId: 'project-1', status: 'changes_requested', revision: 1 },
  preparedChild: {
    id: 'child-1', projectId: 'project-1', name: 'Review (Revision)', reviewType: 'code_review', status: 'prepared',
    idempotencyKey: 'request-1:child', scope: {}, config: {}, lineage: { parentReviewId: 'review-1' },
    iteration: { decisionId: 'decision-1' }, sourceManifestId: 'manifest-1', createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
  },
};

describe('SupabaseReviewDecisionService', () => {
  it('uploads private attachments and submits one atomic Request Changes command', async () => {
    const fake = new FakeClient();
    fake.rpcResult = { data: rpcResult, error: null };
    const result = await service(fake).submit({
      ...command,
      attachments: [{ fileName: 'auth-notes.md', mimeType: 'text/markdown', contentBase64: 'c3VwcG9ydA==' }],
    });

    expect(fake.storage.from).toHaveBeenCalledWith(DECISION_ATTACHMENT_BUCKET);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0].path).toMatch(/^project-1\/review-1\/[0-9a-f-]+\/[0-9a-f-]+-auth-notes\.md$/);
    expect(fake.uploads[0].options).toMatchObject({ contentType: 'text/markdown', upsert: false });
    expect(fake.rpc).toHaveBeenCalledWith('submit_review_decision', expect.objectContaining({
      p_project_id: 'project-1', p_review_id: 'review-1', p_decision: 'changes_requested',
      p_source_choice: 'reuse', p_child_review_id: expect.any(String),
      p_attachment_metadata: [expect.objectContaining({ file_name: 'auth-notes.md', byte_size: 7, mime_type: 'text/markdown' })],
    }));
    expect(result.decision.attachments).toEqual([]);
    expect(result.preparedChild?.status).toBe('prepared');
    expect(fake.removed).toEqual([]);
  });

  it('compensates uploaded objects when the atomic RPC fails', async () => {
    const fake = new FakeClient();
    fake.rpcResult = { data: null, error: { message: 'parent transition rejected' } };
    await expect(service(fake).submit({
      ...command,
      attachments: [
        { fileName: 'one.txt', mimeType: 'text/plain', contentBase64: 'MQ==' },
        { fileName: 'two.txt', mimeType: 'text/plain', contentBase64: 'Mg==' },
      ],
    })).rejects.toMatchObject({ code: 'decision_persistence_failed', cleanupIncomplete: false });
    expect(fake.removed).toHaveLength(1);
    expect(fake.removed[0]).toHaveLength(2);
  });

  it('reports incomplete compensation honestly', async () => {
    const fake = new FakeClient();
    fake.rpcResult = { data: null, error: { message: 'insert rejected' } };
    fake.cleanupError = true;
    await expect(service(fake).submit({
      ...command,
      attachments: [{ fileName: 'one.txt', mimeType: 'text/plain', contentBase64: 'MQ==' }],
    })).rejects.toMatchObject({ code: 'cleanup_incomplete', cleanupIncomplete: true });
  });

  it('does not delete an object when the first upload is rejected', async () => {
    const fake = new FakeClient();
    fake.uploadErrorAt = 1;
    await expect(service(fake).submit({
      ...command,
      attachments: [{ fileName: 'one.txt', mimeType: 'text/plain', contentBase64: 'MQ==' }],
    })).rejects.toBeInstanceOf(ReviewDecisionServiceError);
    expect(fake.removed).toEqual([]);
  });

  it('recovers an existing idempotent operation before uploading again', async () => {
    const fake = new FakeClient();
    fake.rows.set('review_operations', [{ operation: 'request_changes', idempotency_key: 'request-1', project_id: 'project-1', review_id: 'child-1', parent_review_id: 'review-1', decision_id: 'decision-1', created_at: '2026-09-22T00:00:00.000Z' }]);
    fake.rows.set('review_decisions', [{ id: 'decision-1', project_id: 'project-1', review_session_id: 'review-1', decision: 'changes_requested', comment: command.comment, reviewer: command.reviewer, created_at: '2026-09-22T00:00:00.000Z' }]);
    fake.rows.set('review_sessions', [{ id: 'review-1', project_id: 'project-1', status: 'changes_requested', revision: 1 }, { id: 'child-1', project_id: 'project-1', status: 'prepared' }]);
    const result = await service(fake).submit({
      ...command,
      attachments: [{ fileName: 'would-not-upload.txt', mimeType: 'text/plain', contentBase64: 'MQ==' }],
    });
    expect(result.decision.id).toBe('decision-1');
    expect(fake.uploads).toEqual([]);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('lists metadata and creates a short-lived signed download under the same project scope', async () => {
    const fake = new FakeClient();
    fake.rows.set('review_decisions', [{ id: 'decision-1', project_id: 'project-1', review_session_id: 'review-1', decision: 'commented', comment: 'note', reviewer: 'Reviewer', created_at: '2026-09-22T00:00:00.000Z' }]);
    fake.rows.set('review_decision_attachments', [{ id: 'attachment-1', project_id: 'project-1', review_session_id: 'review-1', decision_id: 'decision-1', storage_path: 'project-1/review-1/decision-1/attachment.txt', file_name: 'attachment.txt', mime_type: 'text/plain', byte_size: 7, content_hash: 'hash', created_at: '2026-09-22T00:00:00.000Z' }]);
    const instance = service(fake);
    const listed = await instance.listDecisionAttachments('project-1', 'review-1', 'decision-1');
    expect(listed).toMatchObject([{ id: 'attachment-1', fileName: 'attachment.txt', byteSize: 7, storagePath: 'project-1/review-1/decision-1/attachment.txt' }]);
    const download = await instance.createDecisionAttachmentDownload('project-1', 'review-1', 'decision-1', 'attachment-1');
    expect(download.signedUrl).toContain('attachment.txt');
    expect(fake.storage.from).toHaveBeenCalledWith(DECISION_ATTACHMENT_BUCKET);
    expect(download.expiresAt).toBeTruthy();
    expect(DECISION_ATTACHMENT_SIGNED_URL_TTL_SECONDS).toBe(900);
  });

  it('pages decision history within the requested Review and rejects invalid offsets', async () => {
    const fake = new FakeClient();
    fake.rows.set('review_sessions', [{ id: 'review-1', project_id: 'project-1' }]);
    fake.rows.set('review_decisions', Array.from({ length: 105 }, (_, index) => ({
      id: `decision-${index}`, project_id: 'project-1', review_session_id: 'review-1',
      decision: 'commented', comment: `Note ${index}`, reviewer: 'Reviewer', created_at: '2026-09-22T00:00:00.000Z',
    })));
    const instance = service(fake);
    const first = await instance.listReviewDecisions('project-1', 'review-1', 50, 0);
    const second = await instance.listReviewDecisions('project-1', 'review-1', 50, 50);
    const third = await instance.listReviewDecisions('project-1', 'review-1', 50, 100);
    expect([first.length, second.length, third.length]).toEqual([50, 50, 5]);
    expect(new Set([...first, ...second, ...third].map(row => row.id)).size).toBe(105);
    await expect(instance.listReviewDecisions('project-1', 'review-1', 50, -1)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('validates attachment type, source choice, and count before touching Storage', async () => {
    const fake = new FakeClient();
    await expect(service(fake).submit({ ...command, sourceChoice: undefined })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service(fake).submit({ ...command, attachments: [{ fileName: 'bad.exe', mimeType: 'application/x-msdownload', contentBase64: 'MQ==' }] })).rejects.toMatchObject({ code: 'invalid_attachment' });
    await expect(service(fake).submit({ ...command, attachments: Array.from({ length: 6 }, (_, i) => ({ fileName: `${i}.txt`, mimeType: 'text/plain', contentBase64: 'MQ==' })) })).rejects.toMatchObject({ code: 'invalid_attachment' });
    expect(fake.uploads).toEqual([]);
  });

  it('supports atomic approved/commented commands without preparing a child', async () => {
    const fake = new FakeClient();
    fake.rpcResult = {
      data: {
        operation: { operation: 'record_decision', idempotencyKey: 'approval-1', projectId: 'project-1', reviewId: 'review-1', decisionId: 'decision-2', createdAt: '2026-09-22T00:00:00.000Z' },
        decision: { id: 'decision-2', projectId: 'project-1', reviewId: 'review-1', decision: 'approved', comment: 'accepted', reviewer: 'Reviewer', createdAt: '2026-09-22T00:00:00.000Z', attachments: [] },
        parent: { id: 'review-1', projectId: 'project-1', status: 'approved', revision: 2 },
        preparedChild: null,
      }, error: null,
    };
    const result = await service(fake).submit({ projectId: 'project-1', reviewId: 'review-1', actorId: 'actor-1', decision: 'approved', comment: 'accepted', reviewer: 'Reviewer', idempotencyKey: 'approval-1' });
    expect(result.parent.status).toBe('approved');
    expect(result.preparedChild).toBeNull();
    expect(fake.rpc).toHaveBeenCalledWith('submit_review_decision', expect.objectContaining({ p_child_review_id: null, p_source_choice: null }));
  });
});
