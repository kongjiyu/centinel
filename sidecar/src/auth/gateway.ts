import type { IncomingHttpHeaders } from 'node:http';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseClient, isSupabaseJwtIssuedAtFuture } from '../supabase.js';

const FUTURE_JWT_MESSAGE = 'Supabase rejected the signed session as not yet valid. Verify that the device date and time are correct, then retry. If the device time is correct, this may be a temporary Supabase Auth/PostgREST time-validation issue.';

export type AuthHeaders = Partial<Pick<IncomingHttpHeaders, 'authorization' | 'x-centinel-user-id'>> & Record<string, string | string[] | undefined>;

export type AuthenticatedRequest = {
  /** Canonical auth.users.id resolved from the signed bearer token. */
  userId: string;
  /** The exact access token used to validate this request. Never log it. */
  accessToken: string;
  /** Client carrying the same user's Authorization header for RLS queries. */
  client: SupabaseClient;
  /** Supabase's verified user object. */
  user: User;
  /** Transitional diagnostic only; never use this value for authorization. */
  suppliedUserId: string | null;
  /** Ordering hint decoded only after exact-token user verification; never authorization. */
  verifiedIssuedAt?: number | null;
};

export class AuthGatewayError extends Error {
  readonly statusCode: 401 | 403 | 404 | 503;
  readonly code: 'unauthenticated' | 'forbidden' | 'not_found' | 'auth_unavailable' | 'supabase_jwt_future';

  constructor(message: string, statusCode: 401 | 403 | 404 | 503, code: AuthGatewayError['code']) {
    super(message);
    this.name = 'AuthGatewayError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type AuthGatewayOptions = {
  /** Injectable factory used by integration tests and alternate Supabase hosts. */
  clientFactory?: (accessToken: string) => SupabaseClient | null;
};

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] ?? null : null;
  return value?.trim() || null;
}

/**
 * Parse exactly one bearer token. Missing and malformed credentials are both
 * deliberately represented as 401; route code does not need to duplicate
 * token parsing or accidentally accept a caller-controlled identity header.
 */
export function extractBearerToken(headers: AuthHeaders): string {
  const authorization = headerValue(headers.authorization);
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new AuthGatewayError('Authentication is required.', 401, 'unauthenticated');
  return match[1];
}

function suppliedUserId(headers: AuthHeaders): string | null {
  const raw = headerValue(headers['x-centinel-user-id']);
  return raw && raw.length <= 128 ? raw : null;
}

function verifiedIssuedAt(accessToken: string, userId: string): number | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.sub === userId && Number.isSafeInteger(claims.iat) && claims.iat >= 0 ? claims.iat : null;
  } catch { return null; }
}

/** A single authentication seam for all protected sidecar routes. */
export class AuthGateway {
  constructor(private readonly options: AuthGatewayOptions = {}) {}

  async authenticate(headers: AuthHeaders): Promise<AuthenticatedRequest> {
    const accessToken = extractBearerToken(headers);
    const client = (this.options.clientFactory ?? createSupabaseClient)(accessToken);
    if (!client) {
      throw new AuthGatewayError('Authentication service is not configured.', 503, 'auth_unavailable');
    }

    let result: { data: { user: User | null }; error: { message?: string; code?: string; status?: number } | null };
    try {
      result = await client.auth.getUser(accessToken);
    } catch (cause) {
      if (isSupabaseJwtIssuedAtFuture(cause)) {
        throw new AuthGatewayError(FUTURE_JWT_MESSAGE, 503, 'supabase_jwt_future');
      }
      // A transport failure cannot establish that the bearer is invalid. Keep
      // the user signed in and report the verification service as unavailable.
      throw new AuthGatewayError('Authentication verification is temporarily unavailable. Retry in a moment.', 503, 'auth_unavailable');
    }
    if (result.error && isSupabaseJwtIssuedAtFuture(result.error)) {
      throw new AuthGatewayError(FUTURE_JWT_MESSAGE, 503, 'supabase_jwt_future');
    }
    if (result.error) {
      const status = result.error.status;
      const message = result.error.message?.toLowerCase() ?? '';
      if (status === 0 || status === 429 || (typeof status === 'number' && status >= 500)
        || /fetch failed|network|timeout|temporarily unavailable/.test(message)) {
        throw new AuthGatewayError('Authentication verification is temporarily unavailable. Retry in a moment.', 503, 'auth_unavailable');
      }
      throw new AuthGatewayError('Your session is missing or expired. Sign in again.', 401, 'unauthenticated');
    }
    if (!result.data?.user) {
      throw new AuthGatewayError('Your session is missing or expired. Sign in again.', 401, 'unauthenticated');
    }

    return {
      userId: result.data.user.id,
      accessToken,
      client,
      user: result.data.user,
      suppliedUserId: suppliedUserId(headers),
      verifiedIssuedAt: verifiedIssuedAt(accessToken, result.data.user.id),
    };
  }

  /** Optional auth is useful for public health/OAuth callback routes. */
  async optional(headers: AuthHeaders): Promise<AuthenticatedRequest | null> {
    if (!headerValue(headers.authorization)) return null;
    return this.authenticate(headers);
  }

  /**
   * Check project membership using the RLS-scoped client. The owner row is
   * visible through the projects policy, so this works for both owners and
   * members without a service-role lookup.
   */
  async requireProjectMember(context: AuthenticatedRequest, projectId: string): Promise<void> {
    const { data, error } = await context.client.from('projects').select('id').eq('id', projectId).maybeSingle();
    if (error && isSupabaseJwtIssuedAtFuture(error)) throw new AuthGatewayError(FUTURE_JWT_MESSAGE, 503, 'supabase_jwt_future');
    if (error) throw new AuthGatewayError('Authorization service is unavailable.', 503, 'auth_unavailable');
    if (!data) throw new AuthGatewayError('You do not have access to this project.', 403, 'forbidden');
  }
}

export function createAuthGateway(options: AuthGatewayOptions = {}): AuthGateway {
  return new AuthGateway(options);
}

/** Convenience function for handlers that do not need to retain a gateway. */
export async function authenticateRequest(headers: AuthHeaders, options: AuthGatewayOptions = {}): Promise<AuthenticatedRequest> {
  return createAuthGateway(options).authenticate(headers);
}
