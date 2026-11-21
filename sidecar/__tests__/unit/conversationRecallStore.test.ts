import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConversationStore } from '../../src/conversation/store.js';

it('loads one completed earlier reply from the current project and owner via the bearer client', async () => {
  const row = { id: 'synthetic-turn' };
  const chain = {
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [{ payload: { request: row } }], error: null }),
  };
  const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) });
  const source = vi.fn().mockReturnValue({ from } as unknown as SupabaseClient);
  const store = new SupabaseConversationStore(source);
  const cutoff = '2026-01-02T00:00:00.000Z';
  expect(await store.listEarlierCompleted('synthetic-project', 'synthetic-owner', cutoff, 1)).toEqual([row]);
  expect(source).toHaveBeenCalledOnce();
  expect(from).toHaveBeenCalledWith('audit_events');
  expect(chain.eq.mock.calls).toEqual([
    ['entity_type', 'project_conversation'], ['event_type', 'project_conversation_request'],
    ['project_id', 'synthetic-project'], ['actor_id', 'synthetic-owner'], ['payload->request->>state', 'completed'],
  ]);
  expect(chain.lt).toHaveBeenCalledWith('created_at', cutoff);
  expect(chain.order.mock.calls).toEqual([
    ['created_at', { ascending: false }], ['id', { ascending: false }],
  ]);
  expect(chain.limit).toHaveBeenCalledWith(1);
});
