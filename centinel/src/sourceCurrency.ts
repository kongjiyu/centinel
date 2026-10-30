import type { Artifact } from './types';

/** DESIGN.md: currency is re-confirmed every 90 days; this is separate from version approval. */
export const SOURCE_CURRENCY_INTERVAL_DAYS = 90;

export type SourceCurrencyState =
  | { kind: 'deprecated'; label: string }
  | { kind: 'unconfirmed'; label: string }
  | { kind: 'due'; label: string; days: number }
  | { kind: 'current'; label: string; days: number };

export function sourceCurrencyState(artifact: Pick<Artifact, 'currency'>, now = Date.now()): SourceCurrencyState {
  const currency = artifact.currency;
  if (currency?.deprecated) return { kind: 'deprecated', label: 'Deprecated · excluded from new Reviews' };
  const confirmed = currency?.confirmedAt ? Date.parse(currency.confirmedAt) : NaN;
  if (!Number.isFinite(confirmed)) return { kind: 'unconfirmed', label: 'Currency not confirmed yet' };
  const days = Math.max(0, Math.floor((now - confirmed) / 86_400_000));
  const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return days >= SOURCE_CURRENCY_INTERVAL_DAYS
    ? { kind: 'due', label: `Confirmation due · last confirmed ${ago}`, days }
    : { kind: 'current', label: `Confirmed current ${ago}`, days };
}
