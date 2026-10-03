import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../supabase.js';
import { InMemoryCentinelStore } from './inMemory.js';
import { SupabaseCentinelStore } from './supabase.js';
import type { CentinelStore } from './types.js';

export * from './types.js';
export { InMemoryCentinelStore } from './inMemory.js';
export { SupabaseCentinelStore } from './supabase.js';

/**
 * Select the durable adapter when Supabase is configured. The in-memory
 * adapter is explicit and useful for tests; callers should not treat it as a
 * production persistence fallback.
 */
export function createCentinelStore(options: { accessToken?: string | null; client?: SupabaseClient; allowInMemory?: boolean } = {}): CentinelStore {
  const client = options.client ?? createSupabaseClient(options.accessToken);
  if (client) return new SupabaseCentinelStore(client);
  if (options.allowInMemory) return new InMemoryCentinelStore();
  throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY before creating a durable store.');
}
