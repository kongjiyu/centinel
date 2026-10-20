import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from './config.js';

const FUTURE_ISSUED_JWT_CODE = 'PGRST303';
const FUTURE_ISSUED_JWT_MESSAGE = 'JWT issued at future';
const POSTGREST_READ_RETRY_DELAYS_MS = [1000, 3000] as const;
const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

export type SupabaseTransportOptions = {
  /** Injectable transport and clock for deterministic tests. */
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  /** Called before an internal future-JWT retry wait; safe for Review progress instrumentation. */
  onFutureJwtRetry?: (event: SupabaseFutureJwtRetryEvent) => void | Promise<void>;
};

export type SupabaseFutureJwtRetryEvent = {
  service: 'Supabase PostgREST';
  operation: 'bearer-scoped read';
  attempt: 2 | 3;
  maxAttempts: 3;
  delayMs: 1000 | 3000;
  errorCode: 'supabase_jwt_future';
};

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError(signal?.reason));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function hasFutureIssuedJwtShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { code?: unknown; message?: unknown };
  if (candidate.code === FUTURE_ISSUED_JWT_CODE) {
    return typeof candidate.message === 'string' && candidate.message.trim() === FUTURE_ISSUED_JWT_MESSAGE;
  }
  // A few Supabase wrappers retain the message but discard PostgREST's code.
  // Keep this fallback anchored to the exact terminal phrase.
  return typeof candidate.message === 'string'
    && /(?:^|:\s*)JWT issued at future\.?$/i.test(candidate.message.trim());
}

/** Recognize only the specific PostgREST time-validation rejection. */
export function isSupabaseJwtIssuedAtFuture(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (hasFutureIssuedJwtShape(current)) return true;
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return false;
}

function requestUrl(input: RequestInfo | URL, baseUrl: string): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input !== 'string') return new URL(input.url, baseUrl);
    return new URL(input, baseUrl);
  } catch {
    return null;
  }
}

function requestAuthorization(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  const headers = new Headers(typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return headers.get('authorization');
}

export function isBearerScopedPostgrestRead(input: RequestInfo | URL, init: RequestInit | undefined, accessToken: string, baseUrl: string): boolean {
  const url = requestUrl(input, baseUrl);
  let baseOrigin: string;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return false;
  }
  if (!url || url.origin !== baseOrigin || !url.pathname.startsWith('/rest/v1/')) return false;
  const method = (init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
  return (method === 'GET' || method === 'HEAD')
    && requestAuthorization(input, init) === `Bearer ${accessToken}`;
}

function requestSignal(input: RequestInfo | URL, init: RequestInit | undefined): AbortSignal | undefined {
  return init?.signal ?? (typeof input === 'object' && !(input instanceof URL) ? input.signal ?? undefined : undefined);
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {
  const controller = new AbortController();
  const inheritedSignal = init?.signal ?? (typeof input === 'object' && !(input instanceof URL) ? input.signal : null);
  const forwardAbort = () => controller.abort(inheritedSignal?.reason);
  if (inheritedSignal?.aborted) forwardAbort();
  else inheritedSignal?.addEventListener('abort', forwardAbort, { once: true });

  const timer = setTimeout(() => controller.abort(new Error('Supabase request timed out.')), SUPABASE_REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    inheritedSignal?.removeEventListener('abort', forwardAbort);
  }
}

function createBearerFetch(accessToken: string, baseUrl: string, transport: SupabaseTransportOptions): typeof fetch {
  const fetchImpl = transport.fetchImpl ?? fetch;
  const wait = transport.sleep ?? sleep;
  return async (input, init) => {
    const retryableRead = isBearerScopedPostgrestRead(input, init, accessToken, baseUrl);
    const signal = requestSignal(input, init);
    let response = await fetchWithTimeout(fetchImpl, input, init);
    if (!retryableRead) return response;

    for (const [retryIndex, delayMs] of POSTGREST_READ_RETRY_DELAYS_MS.entries()) {
      let body: unknown;
      if (response.status === 401) {
        try {
          body = await response.clone().json();
        } catch {
          body = null;
        }
      }
      if (!isSupabaseJwtIssuedAtFuture(body)) return response;
      if (signal?.aborted) throw abortError(signal.reason);
      await transport.onFutureJwtRetry?.({
        service: 'Supabase PostgREST',
        operation: 'bearer-scoped read',
        attempt: (retryIndex + 2) as 2 | 3,
        maxAttempts: 3,
        delayMs,
        errorCode: 'supabase_jwt_future',
      });
      await wait(delayMs, signal);
      response = await fetchWithTimeout(fetchImpl, input, init);
    }
    return response;
  };
}

/**
 * Create a Supabase client in the caller's RLS context.
 *
 * The sidecar deliberately does not fall back to SUPABASE_SERVICE_ROLE_KEY.
 * That key is reserved for migrations/admin tooling and must never be used by
 * a packaged desktop runtime.
 */
export function createSupabaseClient(accessToken?: string | null, transport: SupabaseTransportOptions = {}): SupabaseClient | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: accessToken
      ? {
          headers: { Authorization: `Bearer ${accessToken}` },
          fetch: createBearerFetch(accessToken, url, transport),
        }
      : undefined,
  });
}

export function requireSupabaseClient(accessToken?: string | null): SupabaseClient {
  const client = createSupabaseClient(accessToken);
  if (!client) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.');
  }
  return client;
}

/** Resolve the authenticated Supabase subject without exposing any token or
 * profile data to the renderer. RLS still remains the enforcement boundary
 * for every table/storage operation. */
export async function getSupabaseUserId(accessToken: string): Promise<string | null> {
  const client = createSupabaseClient(accessToken);
  if (!client) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user.id;
}
