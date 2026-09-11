/**
 * Convert transport/provider failures into copy that is useful to a person.
 * Keep short, already-human messages intact so domain-specific explanations
 * remain useful, while hiding credentials, stack traces, and raw protocol
 * payloads from the UI.
 */
export function userFacingError(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : '';
  const normalized = raw.replace(/^Error:\s*/i, '').trim();
  if (!normalized) return fallback;
  const lower = normalized.toLowerCase();

  if (/http\s*401|authentication_error|invalid api key|unauthorized/.test(lower)) {
    return 'Centinel could not authenticate with the configured AI service. Check the provider connection in Settings, then try again.';
  }
  if (/http\s*429|rate[_ -]?limit|token plan|usage limit|too many requests/.test(lower)) {
    return 'The AI service is temporarily rate-limited. Wait a moment or review your usage in Settings before trying again.';
  }
  if (/failed to fetch|fetch failed|network|econnrefused|etimedout|timeout|connection refused/.test(lower)) {
    return 'Centinel could not reach the local service. Check that it is running, then try again.';
  }
  if (/permission|access denied|http\s*403/.test(lower)) {
    return 'Centinel does not have permission to access that resource. Check the workspace or connection settings.';
  }
  if (/http\s*404|not found/.test(lower)) {
    return 'The requested resource could not be found. Refresh the page and try again.';
  }

  // Never expose a stack trace, serialized provider payload, or very large
  // implementation error. Short prose from the domain is safe to preserve.
  if (normalized.length > 500 || /\bat\s+\w[\w$]*\s*\(/i.test(normalized) || /[{}]{2,}/.test(normalized)) {
    return fallback;
  }
  return normalized;
}

export function reviewFailureMessage(reason?: string | null): string {
  return userFacingError(
    reason || '',
    'The review could not finish. Check the project sources and AI connection, then rerun the review.',
  );
}
