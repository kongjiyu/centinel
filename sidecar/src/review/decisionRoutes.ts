import {
  ReviewDecisionServiceError,
  type ReviewDecision,
  type SupabaseReviewDecisionService,
} from './decisionService.js';
import type { ReviewIterationSourceChoice } from './types.js';

/**
 * HTTP-independent route adapter for the decision command seam. The server
 * supplies the already-authenticated service and actor; this module never
 * parses bearer tokens or constructs a privileged client.
 */

export type ReviewDecisionRouteRequest = {
  method: string;
  pathname: string;
  searchParams?: URLSearchParams;
  readBody(): Promise<Record<string, unknown>>;
};

export type ReviewDecisionRouteResponse = { status: number; body: unknown };

export type ReviewDecisionRouteDependencies = {
  actorId: string;
  service: SupabaseReviewDecisionService;
  requireProjectMember(projectId: string): Promise<void>;
};

export function isReviewDecisionRoutePath(pathname: string): boolean {
  return [
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/decision$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/decisions$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/decisions\/[^/]+\/attachments$/,
    /^\/projects\/[^/]+\/static-sessions\/[^/]+\/decisions\/[^/]+\/attachments\/[^/]+$/,
  ].some(pattern => pattern.test(pathname));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asAttachmentInputs(value: unknown): Array<{ fileName: string; mimeType: string; contentBase64?: string; content?: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ReviewDecisionServiceError('attachments must be an array.', { code: 'invalid_request' });
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ReviewDecisionServiceError('Each attachment must be an object.', { code: 'invalid_request' });
    }
    const row = item as Record<string, unknown>;
    const contentBase64 = typeof row.contentBase64 === 'string' ? row.contentBase64 : undefined;
    const content = typeof row.content === 'string' ? row.content : undefined;
    if (!contentBase64 && !content) throw new ReviewDecisionServiceError('Each attachment requires base64 content.', { code: 'invalid_request' });
    return {
      fileName: stringValue(row.fileName),
      mimeType: stringValue(row.mimeType),
      ...(contentBase64 ? { contentBase64 } : {}),
      ...(content ? { content } : {}),
    };
  });
}

function errorResponse(error: unknown): ReviewDecisionRouteResponse {
  if (error instanceof ReviewDecisionServiceError) {
    const status = error.code === 'not_found' ? 404
      : error.code === 'idempotency_conflict' ? 409
      : error.code === 'invalid_request' || error.code === 'invalid_decision' || error.code === 'invalid_attachment' ? 400
        : error.code === 'cleanup_incomplete' ? 503
          : 502;
    return { status, body: { error: error.message, code: error.code, cleanupIncomplete: error.cleanupIncomplete } };
  }
  throw error;
}

/**
 * Handle decisions, metadata listing, and short-lived signed retrieval. The
 * route is intentionally separate from index.ts so the authenticated root can
 * compose it after its existing bearer gateway and membership check.
 */
export async function handleReviewDecisionRoute(
  request: ReviewDecisionRouteRequest,
  dependencies: ReviewDecisionRouteDependencies,
): Promise<ReviewDecisionRouteResponse | null> {
  if (!isReviewDecisionRoutePath(request.pathname)) return null;
  const decisionMatch = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/decision$/);
  const historyMatch = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/decisions$/);
  const attachmentListMatch = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/decisions\/([^/]+)\/attachments$/);
  const attachmentDownloadMatch = request.pathname.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/decisions\/([^/]+)\/attachments\/([^/]+)$/);
  const projectId = decisionMatch?.[1] ?? historyMatch?.[1] ?? attachmentListMatch?.[1] ?? attachmentDownloadMatch?.[1];
  const reviewId = decisionMatch?.[2] ?? historyMatch?.[2] ?? attachmentListMatch?.[2] ?? attachmentDownloadMatch?.[2];
  if (!projectId || !reviewId) return null;

  try {
    await dependencies.requireProjectMember(projectId);
    if (decisionMatch && request.method === 'POST') {
      const body = await request.readBody();
      const decision = body.decision;
      if (decision !== 'approved' && decision !== 'changes_requested' && decision !== 'commented') {
        throw new ReviewDecisionServiceError('Invalid decision. Must be approved, changes_requested, or commented.', { code: 'invalid_decision' });
      }
      const sourceChoice = body.sourceChoice;
      if (sourceChoice !== undefined && sourceChoice !== 'reuse' && sourceChoice !== 'refresh') {
        throw new ReviewDecisionServiceError('sourceChoice must be "reuse" or "refresh".', { code: 'invalid_request' });
      }
      const result = await dependencies.service.submit({
        projectId,
        reviewId,
        actorId: dependencies.actorId,
        decision: decision as ReviewDecision,
        ...(typeof body.comment === 'string' ? { comment: body.comment } : {}),
        ...(typeof body.reviewer === 'string' ? { reviewer: body.reviewer } : {}),
        ...(typeof body.idempotencyKey === 'string' ? { idempotencyKey: body.idempotencyKey } : {}),
        ...(sourceChoice === 'reuse' || sourceChoice === 'refresh' ? { sourceChoice: sourceChoice as ReviewIterationSourceChoice } : {}),
        attachments: asAttachmentInputs(body.attachments),
      });
      return { status: 201, body: result };
    }

    if (historyMatch && request.method === 'GET') {
      const rawLimit = request.searchParams?.get('limit');
      const limit = rawLimit === null || rawLimit === undefined || rawLimit === '' ? 50 : Number(rawLimit);
      const rawOffset = request.searchParams?.get('offset');
      const offset = rawOffset === null || rawOffset === undefined || rawOffset === '' ? 0 : Number(rawOffset);
      return { status: 200, body: await dependencies.service.listReviewDecisions(projectId, reviewId, limit, offset) };
    }

    if (attachmentListMatch && request.method === 'GET') {
      return { status: 200, body: await dependencies.service.listDecisionAttachments(projectId, reviewId, attachmentListMatch[3]) };
    }

    if (attachmentDownloadMatch && request.method === 'GET') {
      const rawExpiresIn = request.searchParams?.get('expiresIn');
      const expiresIn = rawExpiresIn === null || rawExpiresIn === undefined || rawExpiresIn === ''
        ? undefined
        : Number(rawExpiresIn);
      return {
        status: 200,
        body: await dependencies.service.createDecisionAttachmentDownload(projectId, reviewId, attachmentDownloadMatch[3], attachmentDownloadMatch[4], expiresIn),
      };
    }

    return null;
  } catch (error) {
    return errorResponse(error);
  }
}
