import { describe, expect, it, vi } from 'vitest';
import { providerPause, responseProviderPause, reviewProviderPause } from '../../src/review/providerPause.js';
import { ModelProviderError, runAiRequest, runModelOperation } from '../../src/review/retry.js';

const failures = [
  [{ statusCode: 429, retryable: true }, 'rate_limited'],
  [{ code: 'insufficient_quota', statusCode: 429, retryable: true }, 'quota_exhausted'],
  [{ code: 'credit_balance_exhausted', statusCode: 403, retryable: false }, 'credits_exhausted'],
  [{ code: 'organization_spend_limit_exceeded', statusCode: 429 }, 'billing_required'],
  [{ statusCode: 402 }, 'billing_required'],
] as const;

describe('provider capacity pause', () => {
  it.each(failures)('stops at the first capacity failure without waits or fallback (%j)', async (metadata, code) => {
    const error = new ModelProviderError('private source and credential body', metadata);
    const analyze = vi.fn(async () => { throw error; });
    const fallback = { analyze: vi.fn() };
    const sleep = vi.fn();
    const onRetry = vi.fn();
    const attempts: unknown[] = [];
    await expect(runModelOperation({ reviewId: 'r', projectId: 'p', stage: 'model_analysis', prompt: 'fixture', systemPrompt: 'fixture' }, { analyze }, {
      reviewId: 'r', projectId: 'p', stage: 'model_analysis', provider: 'custom', apiFormat: 'openai-compatible', model: 'fixture',
      fallback, sleep, onRetry, onAttempt: attempt => { attempts.push(attempt); },
    })).rejects.toMatchObject({ code, retryable: false });
    expect(analyze).toHaveBeenCalledOnce();
    expect(fallback.analyze).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
    expect(JSON.stringify(attempts)).not.toContain('private');

    const operation = vi.fn(async () => { throw error; });
    await expect(runAiRequest(operation, { service: 'AI', operation: 'index', sleep, onRetry })).rejects.toMatchObject({ code, retryable: false });
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not infer capacity or exhausted credits from arbitrary messages', () => {
    expect(providerPause(new Error('credit_balance_exhausted and quota in source text'))).toBeNull();
    expect(providerPause({ code: 'not_a_provider_code', statusCode: 503 })).toBeNull();
    expect(providerPause({ code: '__proto__' })).toBeNull();
    expect(providerPause({ code: 'constructor' })).toBeNull();
    expect(providerPause({ statusCode: 429 })?.code).toBe('rate_limited');
  });

  it('keeps provider_unavailable Review-only and requires the internal pause marker', () => {
    const untagged = new ModelProviderError('provider unavailable', { code: 'provider_unavailable', retryable: false });
    const tagged = new ModelProviderError('provider unavailable', { code: 'provider_unavailable', retryable: false, reviewPause: true });

    expect(providerPause(untagged)).toBeNull();
    expect(reviewProviderPause(untagged)).toBeNull();
    expect(reviewProviderPause(tagged)).toEqual({
      code: 'provider_unavailable',
      message: expect.stringContaining('cause is unconfirmed'),
    });
  });

  it.each([
    [{ error: { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'private' } }, 429, 'credits_exhausted'],
    [{ error: { type: 'insufficient_quota', message: 'private' } }, 400, 'quota_exhausted'],
    [{ error: { type: 'rate_limit_error' } }, 429, 'rate_limited'],
    [{ error: { status: 'RESOURCE_EXHAUSTED' } }, 403, 'rate_limited'],
  ] as const)('uses structured capacity metadata without retaining provider text (%j)', async (body, status, code) => {
    const result = await responseProviderPause(new Response(JSON.stringify(body), { status }));
    expect(result?.code).toBe(code);
    expect(result?.message).not.toContain('private');
  });

  it('handles malformed, absent and oversized provider bodies safely', async () => {
    for (const body of [null, '<html>private</html>', 'x'.repeat(20_000)]) {
      expect((await responseProviderPause(new Response(body, { status: 429 })))?.code).toBe('rate_limited');
      expect(await responseProviderPause(new Response(body, { status: 503 }))).toBeNull();
    }
  });

  it('does not wait indefinitely for a stalled capacity error body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.useFakeTimers();
    try {
      const pending = responseProviderPause(new Response(body, { status: 429 }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending)?.code).toBe('rate_limited');
      expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
