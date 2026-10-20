import { describe, expect, it } from 'vitest';
import { harnessStepState, type HarnessEvent } from './reviewHarness';

const event = (outcome: string, executionId = 'one'): HarnessEvent => ({ reviewId: 'review', event: `harness_step_${outcome}`, detail: { step: 'read_source', executionId }, createdAt: '2026-10-11T00:00:00Z' });

describe('harness execution status', () => {
  it('handles tied timestamps and multiple artifact executions', () => {
    expect(harnessStepState([event('completed'), event('started')], 'read_source', true)).toBe('Completed');
    expect(harnessStepState([event('completed'), event('started', 'two')], 'read_source', false)).toBe('In progress');
    expect(harnessStepState([event('completed'), event('started', 'two')], 'read_source', true)).toBe('Interrupted');
    expect(harnessStepState([event('completed'), event('failed', 'two')], 'read_source', true)).toBe('Failed');
    expect(harnessStepState([], 'read_source', true)).toBe('Not recorded');
  });
});
