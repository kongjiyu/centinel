import { describe, expect, it, vi } from 'vitest';
import {
  ModelProviderError,
  ReviewCancelledError,
  calculateBackoffMs,
  classifyModelError,
  runModelOperation,
} from '../../src/review/retry.js';
import type { StaticAnalysisModelProvider } from '../../src/review/types.js';

function provider(implementation: StaticAnalysisModelProvider['analyze']): StaticAnalysisModelProvider {
  return { analyze: implementation };
}

const request = {
  reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
  systemPrompt: 'json', prompt: 'inspect',
};

describe('static-review retry policy', () => {
  it('classifies permanent credentials and transient provider statuses', () => {
    expect(classifyModelError(new ModelProviderError('bad key', { code: 'invalid_credentials', retryable: false })).kind).toBe('permanent');
    expect(classifyModelError({ status: 429, message: 'rate limited' }).kind).toBe('retryable');
    expect(classifyModelError(new TypeError('network timeout')).kind).toBe('retryable');
  });

  it('does not exceed three attempts for one configured model', async () => {
    const calls: number[] = [];
    const attempts: string[] = [];
    const failing = provider(async () => {
      calls.push(calls.length + 1);
      throw new ModelProviderError('temporary', { code: 'server_busy', retryable: true });
    });
    await expect(runModelOperation(request, failing, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'primary',
      baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined,
      onAttempt: attempt => { attempts.push(`${attempt.attempt}:${attempt.outcome}`); },
    })).rejects.toMatchObject({ code: 'retry_exhausted' });
    expect(calls).toHaveLength(3);
    expect(attempts).toEqual(['1:retryable_error', '2:retryable_error', '3:retryable_error']);
  });

  it('uses fallback only after primary eligible attempts are exhausted', async () => {
    const calls: string[] = [];
    const primary = provider(async () => {
      calls.push('primary');
      throw new ModelProviderError('temporary', { code: 'rate_limit', retryable: true });
    });
    const fallback = provider(async () => {
      calls.push('fallback');
      return {
        result: { findings: [] },
        settings: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fallback' },
      };
    });
    const result = await runModelOperation(request, primary, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'primary',
      fallback, fallbackContext: { provider: 'custom', apiFormat: 'openai-compatible', model: 'fallback' },
      baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined,
    });
    expect(result.providerUsed).toBe('fallback');
    expect(calls).toEqual(['primary', 'primary', 'fallback']);
    expect(result.attempts.map(item => item.outcome)).toEqual(['retryable_error', 'retryable_error', 'success']);
  });

  it('does not retry a paid provider call when attempt persistence fails', async () => {
    let calls = 0;
    const model = provider(async () => {
      calls++;
      return {
        result: { findings: [] },
        settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo' },
      };
    });
    await expect(runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
      onAttempt: async () => { throw new Error('usage database unavailable'); },
    })).rejects.toThrow('usage database unavailable');
    expect(calls).toBe(1);
  });

  it('turns a malformed response into a counted repair attempt', async () => {
    const repairFlags: boolean[] = [];
    const model = provider(async input => {
      repairFlags.push(input.repair === true);
      if (!input.repair) throw new ModelProviderError('invalid json', { code: 'malformed_response', malformed: true, retryable: true });
      return {
        result: { findings: [] },
        settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo' },
      };
    });
    const result = await runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
      baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined,
    });
    expect(repairFlags).toEqual([false, true]);
    expect(result.attempts).toHaveLength(2);
  });

  it('interrupts retry backoff immediately on cancellation', async () => {
    const controller = new AbortController();
    const model = provider(async () => {
      throw new ModelProviderError('temporary', { code: 'timeout', retryable: true });
    });
    const pending = runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
      signal: controller.signal, baseDelayMs: 60_000, jitterRatio: 0,
    });
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(false));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ReviewCancelledError);
  });

  it('calculates bounded exponential backoff with provider hints', () => {
    expect(calculateBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0, random: () => 0.5 })).toBe(100);
    expect(calculateBackoffMs(4, { baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0, random: () => 0.5 }, 2000)).toBe(1000);
  });
});
