import { describe, expect, it } from 'vitest';
import { sourceCurrencyState } from './sourceCurrency';

const now = Date.parse('2026-10-30T12:00:00Z');
const currency = (confirmedAt: string | null, deprecated = false) => ({ currency: { confirmedAt, confirmedBy: confirmedAt ? 'user-1' : null, deprecated, deprecatedAt: null, deprecatedBy: null } });

describe('source currency', () => {
  it('distinguishes never confirmed, current, due and deprecated sources', () => {
    expect(sourceCurrencyState({}, now).kind).toBe('unconfirmed');
    expect(sourceCurrencyState(currency('2026-10-20T12:00:00Z'), now)).toMatchObject({ kind: 'current', days: 10 });
    expect(sourceCurrencyState(currency('2026-07-01T12:00:00Z'), now)).toMatchObject({ kind: 'due' });
    expect(sourceCurrencyState(currency('2026-10-20T12:00:00Z', true), now).kind).toBe('deprecated');
  });
});
