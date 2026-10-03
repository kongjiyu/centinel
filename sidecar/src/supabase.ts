import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from './config.js';

/**
 * Create a Supabase client in the caller's RLS context.
 *
 * The sidecar deliberately does not fall back to SUPABASE_SERVICE_ROLE_KEY.
 * That key is reserved for migrations/admin tooling and must never be used by
 * a packaged desktop runtime.
 */
export function createSupabaseClient(accessToken?: string | null): SupabaseClient | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
}

export function requireSupabaseClient(accessToken?: string | null): SupabaseClient {
  const client = createSupabaseClient(accessToken);
  if (!client) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.');
  }
  return client;
}

/** Resolve the authenticated Supabase subject without exposing any token or
 * profile data to the renderer. RLS still remains the enforcement boundary
 * for every table/storage operation. */
export async function getSupabaseUserId(accessToken: string): Promise<string | null> {
  const client = createSupabaseClient(accessToken);
  if (!client) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user.id;
}
