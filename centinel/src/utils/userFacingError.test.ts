import { describe, expect, it } from 'vitest';
import { reviewFailureMessage, userFacingError } from './userFacingError';

describe('workspace connection errors', () => {
  it('distinguishes a saved database statement timeout from an unreachable sidecar', () => {
    expect(reviewFailureMessage('Supabase review harness events failed: canceling statement due to statement timeout'))
      .toBe('The workspace database took too long to respond. Try again in a moment.');
    expect(userFacingError(new TypeError('Failed to fetch')))
      .toBe('Centinel could not reach the local service. Check that it is running, then try again.');
  });

  it('explains a frontend request deadline without assuming which service caused it', () => {
    expect(userFacingError(new Error('The request timed out. Please retry.')))
      .toBe('Centinel did not receive a response in time. Try again.');
  });
});
