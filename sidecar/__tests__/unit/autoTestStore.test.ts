import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { SupabaseAutoTestStore } from '../../src/dynamic/autonomous/store.js';

it('uses the bounded audit history index order and reports a canceled read as unavailable', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
    code: '57014', message: 'canceling statement due to statement timeout', details: 'private database detail',
  }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  const client = createClient('https://centinel.test', 'fixture-key', { global: { fetch } });
  const store = new SupabaseAutoTestStore(client, 'owner');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(store.list('project', 10)).rejects.toMatchObject({
      status: 503, message: 'Auto test history is temporarily unavailable.',
    });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/rest/v1/audit_events');
    expect(url.searchParams.get('project_id')).toBe('eq.project');
    expect(url.searchParams.get('entity_type')).toBe('eq.dynamic_autonomous');
    expect(url.searchParams.get('event_type')).toBe('eq.dynamic_autonomous_session');
    expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(warn).toHaveBeenCalledExactlyOnceWith('[auto-test] History list failed (57014).');
  } finally {
    warn.mockRestore();
  }
});
