import { describe, expect, it, vi } from 'vitest';
import {
  ModelProviderError,
  ReviewCancelledError,
  calculateBackoffMs,
  classifyModelError,
  runAiRequest,
  runExternalOperation,
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
    expect(classifyModelError({ status: 429, message: 'rate limited' }).kind).toBe('paused');
    expect(classifyModelError(new TypeError('network timeout')).kind).toBe('retryable');
  });

  it('bounds a non-AI request to three attempts and records each fixed wait before sleeping', async () => {
    const order: string[] = [];
    const waits: number[] = [];
    const events: Array<Record<string, unknown>> = [];
    let calls = 0;
    await expect(runExternalOperation(async () => {
      calls++;
      throw Object.assign(new Error('temporary upstream failure'), { status: 503 });
    }, {
      service: 'storage', operation: 'read frozen artifact',
      now: () => new Date('2026-10-13T00:00:00.000Z'),
      sleep: async delayMs => { order.push('wait'); waits.push(delayMs); },
      onRetry: event => { order.push('event'); events.push(event); },
    })).rejects.toMatchObject({ status: 503 });

    expect(calls).toBe(3);
    expect(waits).toEqual([1_000, 3_000]);
    expect(order).toEqual(['event', 'wait', 'event', 'wait']);
    expect(events).toEqual([
      { service: 'storage', operation: 'read frozen artifact', attempt: 2, maxAttempts: 3, delayMs: 1_000, nextAttemptAt: '2026-10-13T00:00:01.000Z', errorCode: 'http_503' },
      { service: 'storage', operation: 'read frozen artifact', attempt: 3, maxAttempts: 3, delayMs: 3_000, nextAttemptAt: '2026-10-13T00:00:03.000Z', errorCode: 'http_503' },
    ]);
  });

  it.each([
    ['authentication rejection', { status: 401, retryable: true }],
    ['database schema violation', { code: '23502', message: 'iteration violates not-null constraint', retryable: true }],
  ])('does not retry a permanent external failure (%s)', async (_label, failure) => {
    let calls = 0;
    await expect(runExternalOperation(async () => {
      calls++;
      throw Object.assign(new Error('external request failed'), failure);
    }, { service: 'supabase', operation: 'create review', sleep: async () => undefined }))
      .rejects.toBeInstanceOf(Error);
    expect(calls).toBe(1);
  });

  it('does not exceed five AI attempts and emits the fixed waits before each retry', async () => {
    const calls: number[] = [];
    const attempts: string[] = [];
    const waits: number[] = [];
    const retryEvents: Array<Record<string, unknown>> = [];
    const order: string[] = [];
    const failing = provider(async () => {
      calls.push(calls.length + 1);
      throw new ModelProviderError('temporary', { code: 'server_busy', retryable: true });
    });
    await expect(runModelOperation(request, failing, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'primary',
      now: () => new Date('2026-10-13T00:00:00.000Z'),
      sleep: async delayMs => { order.push('wait'); waits.push(delayMs); },
      onRetry: event => { order.push('event'); retryEvents.push(event); },
      onAttempt: attempt => { attempts.push(`${attempt.attempt}:${attempt.outcome}`); },
    })).rejects.toMatchObject({ code: 'retry_exhausted' });
    expect(calls).toHaveLength(5);
    expect(waits).toEqual([1_000, 3_000, 7_000, 15_000]);
    expect(order).toEqual(['event', 'wait', 'event', 'wait', 'event', 'wait', 'event', 'wait']);
    expect(attempts).toEqual(['1:retryable_error', '2:retryable_error', '3:retryable_error', '4:retryable_error', '5:retryable_error']);
    expect(retryEvents.map(event => [event.attempt, event.maxAttempts, event.delayMs])).toEqual([
      [2, 5, 1_000], [3, 5, 3_000], [4, 5, 7_000], [5, 5, 15_000],
    ]);
  });

  it('bounds one embedding-like AI request to five total calls and reserves before each paid call', async () => {
    const order: string[] = [];
    const waits: number[] = [];
    const scheduled: Array<Record<string, unknown>> = [];
    await expect(runAiRequest(async attempt => {
      order.push(`request:${attempt}`);
      throw new ModelProviderError('busy', { code: 'overloaded', retryable: true });
    }, {
      service: 'Source indexing provider', operation: 'embedding chunk',
      now: () => new Date('2026-10-13T00:00:00.000Z'),
      sleep: async delayMs => { order.push('wait'); waits.push(delayMs); },
      onAttemptStarted: attempt => { order.push(`reserved:${attempt}`); },
      onRetry: event => { scheduled.push(event); },
    })).rejects.toMatchObject({ code: 'overloaded' });

    expect(order.filter(item => item.startsWith('request:'))).toHaveLength(5);
    expect(order.filter(item => item.startsWith('reserved:'))).toHaveLength(5);
    expect(waits).toEqual([1_000, 3_000, 7_000, 15_000]);
    expect(scheduled.map(event => [event.attempt, event.maxAttempts, event.delayMs])).toEqual([
      [2, 5, 1_000], [3, 5, 3_000], [4, 5, 7_000], [5, 5, 15_000],
    ]);
    expect(order.slice(0, 3)).toEqual(['reserved:1', 'request:1', 'wait']);
  });

  it('does not send a paid AI request if attempt reservation fails', async () => {
    let calls = 0;
    await expect(runAiRequest(async () => { calls++; return 'ok'; }, {
      service: 'Model provider', operation: 'embedding',
      onAttemptStarted: async () => { throw new Error('usage ledger unavailable'); },
    })).rejects.toThrow('usage ledger unavailable');
    expect(calls).toBe(0);
  });

  it('uses fallback only after primary eligible attempts are exhausted', async () => {
    const calls: string[] = [];
    const primary = provider(async () => {
      calls.push('primary');
      throw new ModelProviderError('temporary', { code: 'server_busy', retryable: true });
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
    expect(calls).toEqual(['primary', 'primary', 'primary', 'primary', 'fallback']);
    expect(result.attempts.map(item => item.outcome)).toEqual(['retryable_error', 'retryable_error', 'retryable_error', 'retryable_error', 'success']);
  });

  it('reserves each persisted AI attempt before making its paid provider request', async () => {
    const order: string[] = [];
    const model = provider(async () => {
      order.push('provider');
      return { result: { findings: [] }, settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo' } };
    });
    await runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
      onAttemptStarted: attempt => { order.push(`reserved:${attempt.outcome}:${attempt.attempt}`); },
      onAttempt: attempt => { order.push(`finished:${attempt.outcome}:${attempt.attempt}`); },
    });
    expect(order).toEqual(['reserved:in_progress:1', 'provider', 'finished:success:1']);
  });

  it('does not retry an authentication status even when an adapter marks it retryable', async () => {
    let calls = 0;
    const model = provider(async () => {
      calls++;
      throw Object.assign(new Error('authentication failed'), { status: 401, retryable: true });
    });
    await expect(runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
    })).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
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

  it('binds per-request logical phase metadata without changing the operation key or attempt budget', async () => {
    const phases: string[] = [];
    const reservations: Array<{ stage: string; attempt: number; phase?: string }> = [];
    let sourceEvidenceInvalid = false;
    let calls = 0;
    const model = provider(async input => {
      calls++;
      phases.push(input.usageContext?.phase ?? 'missing');
      if (calls === 1) throw new ModelProviderError('invalid json', { code: 'malformed_response', malformed: true, retryable: true });
      if (calls === 2) throw new ModelProviderError('temporary network failure', { code: 'timeout', retryable: true });
      return { result: { findings: [] }, settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo' } };
    });
    const result = await runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis:batch-a',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'mimo',
      maxTotalAttempts: 3,
      usageContextForAttempt: input => ({ phase: sourceEvidenceInvalid ? 'citation_repair' : input.repair ? 'response_repair' : 'initial_analysis', sources: [] }),
      onAttemptStarted: attempt => reservations.push({ stage: attempt.stage, attempt: attempt.attempt, phase: attempt.usageContext?.phase }),
      onAttempt: attempt => { if (attempt.attempt === 1) sourceEvidenceInvalid = true; },
      baseDelayMs: 0, jitterRatio: 0, sleep: async () => undefined,
    });

    expect(calls).toBe(3);
    expect(result.attempts.map(attempt => attempt.attempt)).toEqual([1, 2, 3]);
    expect(reservations).toEqual([
      { stage: 'model_analysis:batch-a', attempt: 1, phase: 'initial_analysis' },
      { stage: 'model_analysis:batch-a', attempt: 2, phase: 'citation_repair' },
      { stage: 'model_analysis:batch-a', attempt: 3, phase: 'citation_repair' },
    ]);
    expect(phases).toEqual(['initial_analysis', 'citation_repair', 'citation_repair']);
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

  it('records returned provider usage when cancellation arrives before the result is accepted', async () => {
    const controller = new AbortController();
    const attemptRecords: Array<{ outcome: string; usage?: unknown }> = [];
    const model = provider(async () => {
      controller.abort();
      return {
        result: { findings: [] },
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110,
          providerReportedTotalTokens: 110, totalTokensSource: 'provider_reported' },
        settings: { provider: 'mimo', apiFormat: 'openai-compatible', model: 'fixture' },
      };
    });

    await expect(runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis:batch-a',
      provider: 'mimo', apiFormat: 'openai-compatible', model: 'fixture',
      signal: controller.signal,
      onAttempt: attempt => attemptRecords.push({ outcome: attempt.outcome, usage: attempt.usage }),
    })).rejects.toBeInstanceOf(ReviewCancelledError);

    expect(attemptRecords).toEqual([{ outcome: 'cancelled', usage: {
      inputTokens: 100, outputTokens: 10, totalTokens: 110,
      providerReportedTotalTokens: 110, totalTokensSource: 'provider_reported',
    } }]);
  });

  it.each([
    ['no response', { code: 'network_error', retryable: false, responseReceived: false }, false,
      { basis: 'assumed_zero_no_response', accountedTokens: 0 }],
    ['HTTP response without usage', { code: 'http_500', retryable: false, responseReceived: true, statusCode: 500 }, true, undefined],
  ] as const)('separates assumed zero from unknown actual usage for %s', async (_label, options, responseReceived, usageAccounting) => {
    const records: Array<{ outcome: string; responseReceived?: boolean; usage?: unknown; usageAccounting?: unknown }> = [];
    const model = provider(async () => { throw new ModelProviderError('provider failure', options); });
    await expect(runModelOperation(request, model, {
      reviewId: 'review-1', projectId: 'project-1', stage: 'model_analysis',
      provider: 'custom', apiFormat: 'openai-compatible', model: 'fixture',
      onAttemptStarted: attempt => records.push({ outcome: attempt.outcome, responseReceived: attempt.responseReceived, usage: attempt.usage, usageAccounting: attempt.usageAccounting }),
      onAttempt: attempt => records.push({ outcome: attempt.outcome, responseReceived: attempt.responseReceived, usage: attempt.usage, usageAccounting: attempt.usageAccounting }),
    })).rejects.toMatchObject({ code: options.code });

    expect(records[0]).toEqual({ outcome: 'in_progress', responseReceived: undefined, usage: undefined, usageAccounting: undefined });
    expect(records[1]).toEqual({ outcome: 'permanent_error', responseReceived, usage: undefined, usageAccounting });
  });

  it('calculates bounded exponential backoff with provider hints', () => {
    expect(calculateBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0, random: () => 0.5 })).toBe(100);
    expect(calculateBackoffMs(4, { baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0, random: () => 0.5 }, 2000)).toBe(1000);
  });
});
