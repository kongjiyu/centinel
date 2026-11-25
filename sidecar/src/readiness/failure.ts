import { ModelConfigurationError } from '../review/modelProviderResolver.js';
import { ModelProviderError } from '../review/retry.js';
import { providerPause, PROVIDER_PAUSE_MESSAGES } from '../review/providerPause.js';
import type { ReadinessFailureCode } from './types.js';

export type { ReadinessFailureCode } from './types.js';

export type ReadinessFailure = { code: ReadinessFailureCode; message: string };

/** Safe internal marker. Its public message is static and contains no provider or database details. */
export class ReadinessPersistenceError extends Error {
  readonly code = 'persistence';
  constructor() {
    super('Readiness persistence failed.');
    this.name = 'ReadinessPersistenceError';
  }
}

/** Safe internal marker for cases where the source set could not be verified as stable. */
export class ReadinessSourceChangesError extends Error {
  readonly code = 'source_changes';
  constructor() {
    super('Readiness source set changed or could not be verified.');
    this.name = 'ReadinessSourceChangesError';
  }
}

const MESSAGES: Record<ReadinessFailureCode, string> = {
  assessment_paused: 'AI assessment is paused in local configuration. Source imports can continue. Resume assessment when model usage is available, then select Start.',
  not_configured: 'No Model Provider is configured. Configure one in Settings, then select Start to retry.',
  secret_unavailable: 'The saved Model Provider credential is unavailable. Re-enter or reconnect it in Settings, then select Start to retry.',
  codex_not_connected: 'Codex is not connected on this device. Sign in to Codex, then select Start to retry.',
  ...PROVIDER_PAUSE_MESSAGES,
  context_limit: 'The selected sources exceed the Model Provider context limit. Reduce the selected source set or choose a larger-context model, then select Start to retry.',
  malformed_response: 'The Model Provider returned an unreadable assessment. Retry; if this continues, choose another configured provider.',
  timeout: 'The readiness assessment timed out. Retry, or reduce the selected source set if this continues.',
  persistence: 'Readiness could not be saved. Check the project connection and retry.',
  source_changes: 'Project sources changed or could not be verified while readiness was running. Refresh the source list and select Start to retry.',
  assessment_failed: 'Readiness could not finish. Check source access and Model Provider configuration, then select Start to retry.',
};

/**
 * Turn only known error classes and exact, approved provider codes into UI-safe
 * guidance. Error messages, causes, provider bodies, and arbitrary `.code`
 * values are deliberately never copied into durable readiness state.
 */
export function classifyReadinessFailure(error: unknown): ReadinessFailure {
  let code: ReadinessFailureCode = 'assessment_failed';

  if (error instanceof ReadinessPersistenceError) {
    code = 'persistence';
  } else if (error instanceof ReadinessSourceChangesError) {
    code = 'source_changes';
  } else if (error instanceof ModelConfigurationError) {
    if (error.code === 'not_configured') code = 'not_configured';
    else if (error.code === 'secret_unavailable') code = 'secret_unavailable';
  } else if (error instanceof ModelProviderError) {
    const pause = providerPause(error);
    if (pause) return pause;
    switch (error.code) {
      case 'assessment_paused':
        code = 'assessment_paused';
        break;
      case 'provider_not_configured':
      case 'not_configured':
        code = 'not_configured';
        break;
      case 'invalid_credentials':
      case 'secret_unavailable':
        code = 'secret_unavailable';
        break;
      case 'codex_not_connected':
        code = 'codex_not_connected';
        break;
      case 'codex_rate_limited':
      case 'http_429':
        code = 'rate_limited';
        break;
      case 'context_limit':
      case 'context_length_exceeded':
      case 'http_413':
        code = 'context_limit';
        break;
      case 'malformed_response':
      case 'codex_invalid_response':
        code = 'malformed_response';
        break;
      case 'timeout':
      case 'codex_timeout':
      case 'http_408':
        code = 'timeout';
        break;
    }
    if (error.statusCode === 429) code = 'rate_limited';
    else if (error.statusCode === 413) code = 'context_limit';
    else if (error.statusCode === 408) code = 'timeout';
  } else if (error instanceof Error && error.name === 'AbortError') {
    // The coordinator uses its AbortController only for the assessment deadline.
    code = 'timeout';
  }

  return { code, message: MESSAGES[code] };
}
