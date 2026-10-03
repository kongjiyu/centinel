export type SourceHttpClient = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export const fetchSourceHttpClient: SourceHttpClient = {
  fetch: (input, init) => fetch(input, init),
};

export class ConnectedSourceHttpError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly code: string;

  constructor(message: string, options: { statusCode?: number; retryable?: boolean; code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConnectedSourceHttpError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? 'provider_error';
  }
}

function retryableStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504, 507, 529].includes(status);
}

export async function requestResponse(
  client: SourceHttpClient,
  input: RequestInfo | URL,
  init: RequestInit = {},
  label = 'Connected source provider',
): Promise<Response> {
  let response: Response;
  try {
    response = await client.fetch(input, init);
  } catch (cause) {
    throw new ConnectedSourceHttpError(`${label} could not be reached. Check the connection and retry.`, { retryable: true, code: 'network_error', cause });
  }
  if (!response.ok) {
    throw new ConnectedSourceHttpError(`${label} request failed (HTTP ${response.status}).`, {
      statusCode: response.status,
      retryable: retryableStatus(response.status),
      code: `http_${response.status}`,
    });
  }
  return response;
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
