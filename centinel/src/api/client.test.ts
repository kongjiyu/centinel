import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

describe('sidecar authentication response handling', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not expire the local session for a Supabase time-validation error', async () => {
    const onExpired = vi.fn();
    window.addEventListener('centinel:auth-expired', onExpired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Supabase rejected the session timestamp. Check the device date and time, then retry.',
      code: 'supabase_jwt_future',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })));

    await expect(api.projects()).rejects.toMatchObject({ status: 503, code: 'supabase_jwt_future' });
    expect(onExpired).not.toHaveBeenCalled();
    window.removeEventListener('centinel:auth-expired', onExpired);
  });

  it('expires the local session only for an explicit unauthenticated response', async () => {
    const onExpired = vi.fn();
    window.addEventListener('centinel:auth-expired', onExpired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Your session is missing or expired. Sign in again.',
      code: 'unauthenticated',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    await expect(api.projects()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('centinel:auth-expired', onExpired);
  });

  it('shares simultaneous reads but performs a fresh read after completion', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = api.projects();
    const second = api.projects();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response('[{"id":"project"}]', { status: 200 }));
    expect(await first).toEqual(await second);
    await expect(api.projects()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out and aborts a stalled shared GET, then permits a fresh read', async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | undefined;
    let calls = 0;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls++;
      if (calls === 1) {
        firstSignal = init?.signal ?? undefined;
        return new Promise(() => undefined);
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const onExpired = vi.fn();
    window.addEventListener('centinel:auth-expired', onExpired);
    try {
      const first = api.projects();
      const second = api.projects();
      expect(second).toBe(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(first).rejects.toMatchObject({ status: 504, code: 'request_timeout' });
      await expect(second).rejects.toMatchObject({ status: 504, code: 'request_timeout' });
      expect(firstSignal?.aborted).toBe(true);
      expect(onExpired).not.toHaveBeenCalled();

      await expect(api.projects()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('centinel:auth-expired', onExpired);
    }
  });

  it('bounds a GET whose response body never finishes', async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | undefined;
    let calls = 0;
    const hangingResponse = { ok: true, status: 200, json: () => new Promise(() => undefined) } as Response;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls++;
      if (calls === 1) {
        firstSignal = init?.signal ?? undefined;
        return Promise.resolve(hangingResponse);
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.projects();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).rejects.toMatchObject({ status: 504, code: 'request_timeout' });
    expect(firstSignal?.aborted).toBe(true);
    await expect(api.projects()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the GET deadline after a successful response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.projects()).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not apply the ordinary GET deadline to writes', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      return new Promise<Response>(resolve => { finish = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);

    let settled = false;
    const write = api.deleteProject('one').then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    finish(new Response('{"ok":true}', { status: 200 }));
    await write;
    expect(settled).toBe(true);
  });

  it('never shares a pending read across a sign-in/token change', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(new Response('[{"id":"second-account"}]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('centinel:supabase-access-token', 'account-one');
    const first = api.projects();
    sessionStorage.setItem('centinel:supabase-access-token', 'account-two');
    expect(await api.projects()).toEqual([{ id: 'second-account' }]);
    finish(new Response('[{"id":"first-account"}]', { status: 200 }));
    expect(await first).toEqual([{ id: 'first-account' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('releases failed reads for retry and never coalesces writes', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Offline'))
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.projects()).rejects.toThrow('Offline');
    await api.projects();
    await Promise.all([api.deleteProject('one'), api.deleteProject('one')]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('requests lightweight presence and Review summary views only when selected', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(url.includes('view=presence') ? '{"hasSources":true}' : '[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.getSourcePresence('project');
    await api.listStaticSessions('project', { summary: true });
    await api.listStaticSessions('project');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('/projects/project/artifacts?view=presence'),
      expect.stringContaining('/projects/project/static-sessions?view=summary'),
      expect.stringMatching(/\/projects\/project\/static-sessions$/),
    ]);
  });

  it('requests all owner-scoped Review usage kinds for one project session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 }, byGroup: [], recent: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.getReviewModelUsage('project one', 'review/one');
    const url = new URL(fetchMock.mock.calls[0][0] as string, window.location.href);
    expect(url.pathname).toBe('/settings/ai/usage');
    expect(url.searchParams.get('callKind')).toBe('review');
    expect(url.searchParams.get('projectId')).toBe('project one');
    expect(url.searchParams.get('sessionId')).toBe('review/one');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('requires a compatible sidecar instead of treating a legacy inventory as missing sources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[{"id":"source"}]', { status: 200 })));
    await expect(api.getSourcePresence('project')).rejects.toMatchObject({ code: 'sidecar_update_required' });
  });

  it('authenticates embedding catalog reads and preserves embedding provider selection on save', async () => {
    sessionStorage.setItem('centinel:supabase-access-token', 'test-owner-token');
    const fetchMock = vi.fn().mockImplementation(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.embeddingModels();
    expect(fetchMock.mock.calls[0][0]).toContain('/settings/ai/embedding/models');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer test-owner-token');
    await api.updateAiSetting('embedding', { provider: 'custom', apiFormat: 'openai-compatible', embeddingProvider: 'voyage',
      model: 'voyage-4-lite', baseUrl: 'https://api.voyageai.com/v1', apiKey: 'test-only-key' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ embeddingProvider: 'voyage', model: 'voyage-4-lite' });
  });

  it('preserves deliberate embedding diagnostic failures and usage warnings', async () => {
    const result = { status: 'fail', code: 'credits_exhausted', message: 'The provider has insufficient credits.', hint: 'Usage could not be recorded.' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 })));
    await expect(api.testAiProvider('embedding')).resolves.toEqual(result);
  });
});
