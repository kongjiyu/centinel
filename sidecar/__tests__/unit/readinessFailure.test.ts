import { describe, expect, it } from 'vitest';
import { ModelConfigurationError } from '../../src/review/modelProviderResolver.js';
import { ModelProviderError } from '../../src/review/retry.js';
import {
  classifyReadinessFailure,
  ReadinessPersistenceError,
  ReadinessSourceChangesError,
} from '../../src/readiness/failure.js';

describe('readiness failure classification', () => {
  it.each([
    [new ModelProviderError('private provider body', { code: 'assessment_paused' }), 'assessment_paused'],
    [new ModelConfigurationError('private config detail', 'not_configured'), 'not_configured'],
    [new ModelConfigurationError('private credential detail', 'secret_unavailable'), 'secret_unavailable'],
    [new ModelProviderError('private provider body', { code: 'provider_not_configured' }), 'not_configured'],
    [new ModelProviderError('private provider body', { code: 'invalid_credentials' }), 'secret_unavailable'],
    [new ModelProviderError('private provider body', { code: 'codex_not_connected' }), 'codex_not_connected'],
    [new ModelProviderError('private provider body', { code: 'codex_rate_limited', statusCode: 429 }), 'rate_limited'],
    [new ModelProviderError('private provider body', { code: 'http_429' }), 'rate_limited'],
    [new ModelProviderError('private provider body', { code: 'context_length_exceeded' }), 'context_limit'],
    [new ModelProviderError('private provider body', { code: 'http_413' }), 'context_limit'],
    [new ModelProviderError('private provider body', { code: 'malformed_response' }), 'malformed_response'],
    [new ModelProviderError('private provider body', { code: 'codex_timeout' }), 'timeout'],
    [new DOMException('private timeout detail', 'AbortError'), 'timeout'],
    [new ReadinessPersistenceError(), 'persistence'],
    [new ReadinessSourceChangesError(), 'source_changes'],
  ] as const)('maps approved error classes and codes to safe guidance', (error, expectedCode) => {
    const result = classifyReadinessFailure(error);
    expect(result.code).toBe(expectedCode);
    expect(result.message).not.toContain('private');
    expect(result.message).not.toContain(error.message);
  });

  it('uses generic guidance for unknown classes and unapproved codes without copying their messages', () => {
    const result = classifyReadinessFailure(new ModelProviderError('token=secret private body', { code: 'provider_private_code' }));
    expect(result).toEqual({
      code: 'assessment_failed',
      message: 'Readiness could not finish. Check source access and Model Provider configuration, then select Start to retry.',
    });
  });
});
