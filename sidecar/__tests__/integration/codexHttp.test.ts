import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSidecarServer } from '../../src/index.js';
import { createAuthGateway } from '../../src/auth/index.js';
import type { CodexBackend } from '../../src/model/codex.js';

describe('Codex authenticated HTTP boundary', () => {
  let server: Server; let base: string;
  const backend: CodexBackend = { status: vi.fn(), login: vi.fn(), cancelLogin: vi.fn(), logout: vi.fn(), models: vi.fn(), generate: vi.fn(), close: vi.fn() };
  const getBackend = vi.fn(() => backend);
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(backend.status).mockResolvedValue({ available: true, connected: false, accountLabel: null, message: 'Sign in.' });
    vi.mocked(backend.login).mockResolvedValue({ loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize' });
    vi.mocked(backend.models).mockResolvedValue([{ id: 'model-1', label: 'Account model', supportsImages: true, isDefault: true }]);
    const gateway = createAuthGateway({ clientFactory: token => ({ auth: { getUser: async () => ({ data: { user: token === 'good-token' ? { id: 'verified-user' } : null }, error: null }) } }) as unknown as SupabaseClient });
    server = createSidecarServer(gateway, { codexBackend: getBackend });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  it('requires a valid bearer before any local provider operation', async () => {
    for (const [url, method] of [['', 'GET'], ['/login', 'POST'], ['/logout', 'POST'], ['/models', 'GET'], ['/test', 'POST']]) {
      expect((await fetch(`${base}/settings/codex${url}`, { method, headers: { 'X-Centinel-User-Id': 'spoofed-user' } })).status).toBe(401);
    }
    expect(getBackend).not.toHaveBeenCalled();
  });
  it('selects the verified identity despite a forged user header', async () => {
    const headers = { Authorization: 'Bearer good-token', 'X-Centinel-User-Id': 'spoofed-user' };
    const result = await fetch(`${base}/settings/codex`, { headers });
    expect(result.status).toBe(200); expect(getBackend).toHaveBeenCalledWith('verified-user');
    expect(await (await fetch(`${base}/settings/codex/login`, { method: 'POST', headers })).json()).toMatchObject({ loginId: 'login-1' });
    expect(await (await fetch(`${base}/settings/codex/models`, { headers })).json()).toHaveLength(1);
    expect((await fetch(`${base}/settings/codex/login/cancel`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: 'login-1' }) })).status).toBe(200);
    expect(backend.cancelLogin).toHaveBeenCalledWith('login-1');
    expect((await fetch(`${base}/settings/codex/logout`, { method: 'POST', headers })).status).toBe(200);
    expect(backend.logout).toHaveBeenCalledOnce();
  });
  it('rejects tests without a model before generating or touching persistence', async () => {
    const response = await fetch(`${base}/settings/codex/test`, { method: 'POST', headers: { Authorization: 'Bearer good-token', 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400); expect(backend.generate).not.toHaveBeenCalled();
  });
});
