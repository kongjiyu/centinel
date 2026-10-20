export type SourceHttpClient = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Run one idempotent request with the product's bounded retry policy. */
  retry?<T>(
    operation: (attempt: number, signal?: AbortSignal) => Promise<T>,
    service: string,
    operationName: string,
  ): Promise<T>;
};

export const fetchSourceHttpClient: SourceHttpClient = {
  fetch: (input, init) => fetch(input, init),
};

export class ConnectedSourceHttpError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { statusCode?: number; retryable?: boolean; code?: string; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConnectedSourceHttpError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? 'provider_error';
    this.retryAfterMs = options.retryAfterMs;
  }
}

function retryableStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504, 507, 529].includes(status);
}

function requestMethod(input: RequestInfo | URL, init: RequestInit): string {
  const fromInput = typeof input === 'object' && !(input instanceof URL) ? input.method : undefined;
  return (init.method ?? fromInput ?? 'GET').toUpperCase();
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export async function requestResponse(
  client: SourceHttpClient,
  input: RequestInfo | URL,
  init: RequestInit = {},
  label = 'Connected source provider',
): Promise<Response> {
  const send = async (_attempt: number, signal?: AbortSignal): Promise<Response> => {
    let response: Response;
    try {
      response = await client.fetch(input, signal ? { ...init, signal } : init);
    } catch (cause) {
      throw new ConnectedSourceHttpError(`${label} could not be reached. Check the connection and retry.`, { retryable: true, code: 'network_error', cause });
    }
    if (!response.ok) {
      throw new ConnectedSourceHttpError(`${label} request failed (HTTP ${response.status}).`, {
        statusCode: response.status,
        retryable: retryableStatus(response.status),
        retryAfterMs: retryAfterMs(response),
        code: `http_${response.status}`,
      });
    }
    return response;
  };
  // Only repeat GET/HEAD request units. Writes (including rotating OAuth
  // refresh tokens) retain their original single-attempt behavior.
  const method = requestMethod(input, init);
  if ((method === 'GET' || method === 'HEAD') && client.retry) {
    const service = label.startsWith('Google Drive') ? 'Google Drive' : label.split(' ')[0] || 'Connected source provider';
    return client.retry(send, service, label);
  }
  return send(1);
}

export async function requestJson<T = Record<string, unknown>>(
  client: SourceHttpClient,
  input: RequestInfo | URL,
  init: RequestInit = {},
  label = 'Connected source provider',
): Promise<T> {
  const response = await requestResponse(client, input, init, label);
  try {
    return await response.json() as T;
  } catch (cause) {
    throw new ConnectedSourceHttpError(`${label} returned an invalid response.`, { code: 'invalid_response', cause });
  }
}

export function bearerHeaders(accessToken: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

export function urlWithQuery(base: string, values: Record<string, string | number | boolean | undefined | null>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  return url.toString();
}
