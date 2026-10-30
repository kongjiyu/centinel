import { throwIfAborted } from './abort.js';

type Reservation = { timestamp: number; tokens: number };
const windows = new Map<string, Reservation[]>();
type Limits = { requestsPerMinute: number; tokensPerMinute: number };

export function configuredVoyageLimits(): Limits {
  const positive = (value: string | undefined, fallback: number) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
  };
  return { requestsPerMinute: positive(process.env.CENTINEL_VOYAGE_EMBEDDING_RPM, 3),
    tokensPerMinute: positive(process.env.CENTINEL_VOYAGE_EMBEDDING_TPM, 200_000) };
}

/** Admission estimate only, never provider usage or remaining account balance.
 * Source batching is bounded conservatively; actual totals replace reservations. */
export const embeddingAdmissionEstimate = (inputs: string[]) => Math.ceil(inputs.reduce((sum, input) => sum + Buffer.byteLength(input, 'utf8'), 0) / 2) + inputs.length * 16;

export function partitionEmbeddingInputs(inputs: string[], maxEstimate: number): string[][] {
  const batches: string[][] = []; let batch: string[] = [];
  for (const input of inputs) {
    if (embeddingAdmissionEstimate([input]) > maxEstimate) throw new Error('An embedding chunk exceeds the configured admission budget. No input was truncated.');
    if (batch.length && embeddingAdmissionEstimate([...batch, input]) > maxEstimate) { batches.push(batch); batch = []; }
    batch.push(input);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export const sleep = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});

/** Schedules a first attempt; never retries a failed provider request. The
 * bridge serializes requests for each operation. Cross-operation reservations
 * use one process-local owner/model window and cannot observe other apps. */
export async function waitForEmbeddingBudget(key: string, estimate: number, signal?: AbortSignal, overrides: {
  limits?: Limits; now?: () => number; sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
} = {}): Promise<{ reconcile: (actual: number | null) => void }> {
  const limits = overrides.limits ?? configuredVoyageLimits();
  const now = overrides.now ?? (() => performance.now());
  const delay = overrides.sleep ?? sleep;
  if (estimate > limits.tokensPerMinute) throw new Error('Embedding input exceeds the configured per-minute admission budget.');
  while (true) {
    throwIfAborted(signal);
    const timestamp = now();
    const active = (windows.get(key) ?? []).filter(item => timestamp - item.timestamp < 60_100);
    if (active.length < limits.requestsPerMinute && active.reduce((sum, item) => sum + item.tokens, 0) + estimate <= limits.tokensPerMinute) {
      const reservation = { timestamp, tokens: estimate };
      active.push(reservation); windows.set(key, active);
      return { reconcile: actual => { if (typeof actual === 'number' && Number.isSafeInteger(actual) && actual >= 0) reservation.tokens = actual; } };
    }
    windows.set(key, active);
    await delay(Math.max(1, 60_100 - (timestamp - active[0]!.timestamp)), signal);
  }
}
