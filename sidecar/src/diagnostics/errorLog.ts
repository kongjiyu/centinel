/**
 * In-memory record of recent error *codes* for the diagnostics export.
 *
 * Only allowlisted shapes are kept: an HTTP status, a snake_case code, the
 * request method and a route template with identifiers replaced. No messages,
 * bodies, query strings or user identifiers are stored, and nothing is written
 * to disk or sent anywhere.
 */
export type DiagnosticErrorRecord = { at: string; status: number; code: string; method: string; route: string };

const MAXIMUM_RECORDS = 200;
const records: DiagnosticErrorRecord[] = [];
const SAFE_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const SAFE_METHOD = /^(GET|POST|PUT|PATCH|DELETE)$/;

/** Replaces every path segment that could identify a user, project or resource. */
export function routeTemplate(pathname: string): string {
  return pathname.split('?')[0].split('/').slice(0, 12).map(segment => {
    if (!segment) return segment;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
    if (/^[a-z][a-z0-9-]{0,39}$/.test(segment)) return segment;
    return ':value';
  }).join('/') || '/';
}

export function recordDiagnosticError(input: { status: number; code?: string | null; method?: string; pathname?: string }, now = new Date()): void {
  const code = input.code && SAFE_CODE.test(input.code) ? input.code : input.status >= 500 ? 'internal_error' : 'unclassified';
  records.push({
    at: now.toISOString(),
    status: Number.isInteger(input.status) ? input.status : 0,
    code,
    method: input.method && SAFE_METHOD.test(input.method) ? input.method : 'OTHER',
    route: routeTemplate(input.pathname ?? '/'),
  });
  if (records.length > MAXIMUM_RECORDS) records.splice(0, records.length - MAXIMUM_RECORDS);
}

export function recentDiagnosticErrors(): DiagnosticErrorRecord[] {
  return records.map(record => ({ ...record }));
}

export function clearDiagnosticErrors(): void {
  records.length = 0;
}
