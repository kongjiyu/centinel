import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseClient } from '../../src/supabase.js';

const encoder = new TextEncoder();

function headersOnly(onCancel?: () => void): Response {
  // Headers arrive, but the body never delivers a chunk: what a decompression
  // step waiting behind a starved thread pool looks like to the caller.
  return new Response(new ReadableStream<Uint8Array>({ cancel: onCancel }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Supabase response body deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('fails a request whose body never arrives instead of waiting forever', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return headersOnly();
    });
    const client = createSupabaseClient('session-token', { fetchImpl })!;

    let settled = false;
    const pending = client.from('audit_events').upsert([{ id: 'event-1' }], { onConflict: 'id' })
      .then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await pending;

    expect(result.error?.message).toMatch(/Supabase response body timed out/);
    expect(signal?.aborted).toBe(true);
  });

  it('keeps a slow body alive while chunks keep arriving', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    const parts = ['[{"id":', '"row-1"', '}]'];
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = parts.shift();
        if (next === undefined) { controller.close(); return; }
        await new Promise(resolve => setTimeout(resolve, 10_000));
        controller.enqueue(encoder.encode(next));
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createSupabaseClient('session-token', { fetchImpl })!;

    let settled = false;
    const pending = client.from('artifacts').select('id').then(result => { settled = true; return result; });
    for (let step = 0; step < 60 && !settled; step++) await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'row-1' }]);
  });

  it('returns bodiless responses unchanged', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createSupabaseClient('session-token', { fetchImpl })!;

    const result = await client.from('audit_events').upsert([{ id: 'event-1' }], { onConflict: 'id' });

    expect(result.error).toBeNull();
    expect(result.status).toBe(204);
  });
});
