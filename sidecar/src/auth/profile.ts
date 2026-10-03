import type { SupabaseClient, User } from '@supabase/supabase-js';

export type StoreProfile = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

function text(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

/**
 * Ensure exactly one public profile without replacing user-edited presentation
 * fields on every sign-in. The database trigger covers new users; this helper
 * is intentionally idempotent for existing OAuth/email sessions.
 */
export async function ensureProfile(client: SupabaseClient, user: Pick<User, 'id' | 'user_metadata'>): Promise<StoreProfile> {
  const metadata = user.user_metadata ?? {};
  const displayName = text(metadata.full_name ?? metadata.name);
  const avatarUrl = text(metadata.avatar_url ?? metadata.picture);
  const { error: writeError } = await client.from('profiles').upsert(
    { id: user.id, display_name: displayName, avatar_url: avatarUrl },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (writeError) throw new Error(`Profile ensure failed: ${writeError.message}`);

  const { data, error } = await client.from('profiles').select('id,display_name,avatar_url,created_at,updated_at').eq('id', user.id).single();
  if (error || !data) throw new Error(`Profile read failed: ${error?.message ?? 'no profile returned'}`);
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
