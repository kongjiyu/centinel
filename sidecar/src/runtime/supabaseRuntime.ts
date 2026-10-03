import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../supabase.js';

export type SupabaseClientFactory = (accessToken: string) => SupabaseClient | null;

export type ScopedClientSnapshot = {
  userId: string;
  tokenFingerprint: string;
  generation: number;
  client: SupabaseClient;
};

export type SupabaseRuntimeState = Pick<ScopedClientSnapshot, 'userId' | 'tokenFingerprint' | 'generation'>;

function fingerprint(accessToken: string): string {
  return crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 24);
}

function requireToken(accessToken: string): string {
  const value = accessToken.trim();
  if (!value) throw new Error('An access token is required for an RLS-scoped Supabase runtime.');
  return value;
}

/**
 * Request/runtime seam for long-running Reviews. A client is bound to the
 * exact bearer token used to construct it. When Supabase refreshes a session,
 * replaceAccessToken creates a new RLS client and increments generation; no
 * caller can silently continue using a stale cached client after asserting a
 * current snapshot.
 */
export class RefreshableSupabaseRuntime {
  private current: ScopedClientSnapshot;
  private readonly factory: SupabaseClientFactory;

  constructor(input: {
    userId: string;
    accessToken: string;
    clientFactory?: SupabaseClientFactory;
    client?: SupabaseClient;
  }) {
    if (!input.userId.trim()) throw new Error('A canonical user id is required for an RLS-scoped Supabase runtime.');
    const token = requireToken(input.accessToken);
    const client = input.client ?? (input.clientFactory ?? createSupabaseClient)(token);
    if (!client) throw new Error('Supabase is not configured for the authenticated runtime.');
    this.factory = input.clientFactory ?? createSupabaseClient;
    this.current = { userId: input.userId, tokenFingerprint: fingerprint(token), generation: 0, client };
  }

  snapshot(): ScopedClientSnapshot {
    return { ...this.current };
  }

  state(): SupabaseRuntimeState {
    const { userId, tokenFingerprint, generation } = this.current;
    return { userId, tokenFingerprint, generation };
  }

  get client(): SupabaseClient {
    return this.current.client;
  }

  /** Replace the client when a refreshed bearer token arrives. Reusing the
   * same token is a no-op; passing a token for another canonical user is not
   * possible here because user identity is supplied by AuthGateway before this
   * runtime is built. */
  replaceAccessToken(accessToken: string, client?: SupabaseClient): boolean {
    const token = requireToken(accessToken);
    const nextFingerprint = fingerprint(token);
    if (nextFingerprint === this.current.tokenFingerprint && !client) return false;
    const nextClient = client ?? this.factory(token);
    if (!nextClient) throw new Error('Supabase is not configured for the refreshed authenticated runtime.');
    this.current = {
      userId: this.current.userId,
      tokenFingerprint: nextFingerprint,
      generation: this.current.generation + 1,
      client: nextClient,
    };
    return true;
  }

  /** Reject a result that began with a stale client before it can persist
   * Review state or publish a successful completion. */
  assertCurrent(snapshot: Pick<ScopedClientSnapshot, 'generation' | 'tokenFingerprint'>): void {
    if (snapshot.generation !== this.current.generation || snapshot.tokenFingerprint !== this.current.tokenFingerprint) {
      throw new Error('The authenticated Supabase client was refreshed while this operation was running. Retry with the current session.');
    }
  }

  async withClient<T>(operation: (client: SupabaseClient, snapshot: ScopedClientSnapshot) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    const result = await operation(snapshot.client, snapshot);
    this.assertCurrent(snapshot);
    return result;
  }
}

/** Bounded cache keyed by canonical user plus access-token fingerprint. It is
 * safe to use in a desktop process because stale token clients are not reused,
 * and invalidateUser removes every generation on sign-out. */
export class SupabaseScopedClientCache {
  private readonly clients = new Map<string, SupabaseClient>();
  private readonly factory: SupabaseClientFactory;

  constructor(factory: SupabaseClientFactory = createSupabaseClient, private readonly maxEntries = 32) {
    this.factory = factory;
  }

  get(userId: string, accessToken: string): SupabaseClient {
    const canonicalUser = userId.trim();
    const token = requireToken(accessToken);
    if (!canonicalUser) throw new Error('A canonical user id is required for an RLS-scoped client cache.');
    const key = `${canonicalUser}:${fingerprint(token)}`;
    const existing = this.clients.get(key);
    if (existing) return existing;
    const client = this.factory(token);
    if (!client) throw new Error('Supabase is not configured for the authenticated client cache.');
    this.clients.set(key, client);
    while (this.clients.size > Math.max(1, this.maxEntries)) {
      const oldest = this.clients.keys().next().value;
      if (oldest === undefined) break;
      this.clients.delete(oldest);
    }
    return client;
  }

  invalidateUser(userId: string): void {
    const prefix = `${userId.trim()}:`;
    for (const key of this.clients.keys()) if (key.startsWith(prefix)) this.clients.delete(key);
  }

  clear(): void {
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }
}

export function accessTokenFingerprint(accessToken: string): string {
  return fingerprint(requireToken(accessToken));
}
