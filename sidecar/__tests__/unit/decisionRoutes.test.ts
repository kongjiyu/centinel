import { describe, expect, it, vi } from 'vitest';
import { handleReviewDecisionRoute, isReviewDecisionRoutePath } from '../../src/review/decisionRoutes.js';
import type { SupabaseReviewDecisionService } from '../../src/review/decisionService.js';

function request(method: string, pathname: string, body: Record<string, unknown> = {}, searchParams = new URLSearchParams()) {
  return { method, pathname, searchParams, readBody: async () => body };
}

describe('review decision route adapter', () => {
  it('recognizes command, metadata, and signed retrieval paths without touching index.ts', () => {
    expect(isReviewDecisionRoutePath('/projects/project-1/static-sessions/review-1/decision')).toBe(true);
    expect(isReviewDecisionRoutePath('/projects/project-1/static-sessions/review-1/decisions')).toBe(true);
    expect(isReviewDecisionRoutePath('/projects/project-1/static-sessions/review-1/decisions/decision-1/attachments')).toBe(true);
    expect(isReviewDecisionRoutePath('/projects/project-1/static-sessions/review-1/decisions/decision-1/attachments/attachment-1')).toBe(true);
    expect(isReviewDecisionRoutePath('/health')).toBe(false);
  });

  it('passes the verified actor and request body to the command service', async () => {
    const service = { submit: vi.fn(async (input: any) => ({ operation: { operation: 'request_changes' }, decision: input, parent: {}, preparedChild: {} })) } as unknown as SupabaseReviewDecisionService;
    const requireProjectMember = vi.fn(async () => undefined);
    const response = await handleReviewDecisionRoute(request('POST', '/projects/project-1/static-sessions/review-1/decision', {
      decision: 'changes_requested', comment: 'Please fix this.', sourceChoice: 'refresh', idempotencyKey: 'key-1',
      attachments: [{ fileName: 'notes.md', mimeType: 'text/markdown', contentBase64: 'bm90ZXM=' }],
    }), { actorId: 'authenticated-user', service, requireProjectMember });
    expect(response?.status).toBe(201);
    expect(requireProjectMember).toHaveBeenCalledWith('project-1');
    expect((service.submit as any).mock.calls[0][0]).toMatchObject({
      projectId: 'project-1', reviewId: 'review-1', actorId: 'authenticated-user', sourceChoice: 'refresh',
      attachments: [{ fileName: 'notes.md', mimeType: 'text/markdown', contentBase64: 'bm90ZXM=' }],
    });
  });

  it('returns metadata and renewed signed links through the same project route', async () => {
    const service = {
      listDecisionAttachments: vi.fn(async () => [{ id: 'attachment-1', fileName: 'notes.md' }]),
      createDecisionAttachmentDownload: vi.fn(async () => ({ id: 'attachment-1', signedUrl: 'https://signed.test/attachment-1' })),
    } as unknown as SupabaseReviewDecisionService;
    const deps = { actorId: 'authenticated-user', service, requireProjectMember: vi.fn(async () => undefined) };
    const list = await handleReviewDecisionRoute(request('GET', '/projects/project-1/static-sessions/review-1/decisions/decision-1/attachments'), deps);
    expect(list).toEqual({ status: 200, body: [{ id: 'attachment-1', fileName: 'notes.md' }] });
    const download = await handleReviewDecisionRoute(request('GET', '/projects/project-1/static-sessions/review-1/decisions/decision-1/attachments/attachment-1'), deps);
    expect(download?.status).toBe(200);
    expect((service.createDecisionAttachmentDownload as any).mock.calls[0]).toEqual(['project-1', 'review-1', 'decision-1', 'attachment-1', undefined]);
  });

  it('forwards bounded decision-history paging parameters', async () => {
    const service = { listReviewDecisions: vi.fn(async () => []) } as unknown as SupabaseReviewDecisionService;
    const deps = { actorId: 'authenticated-user', service, requireProjectMember: vi.fn(async () => undefined) };
    const params = new URLSearchParams({ limit: '50', offset: '100' });
    const result = await handleReviewDecisionRoute(request('GET', '/projects/project-1/static-sessions/review-1/decisions', {}, params), deps);
    expect(result).toEqual({ status: 200, body: [] });
    expect(service.listReviewDecisions).toHaveBeenCalledWith('project-1', 'review-1', 50, 100);
  });
});
