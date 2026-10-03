/** Runtime configuration shared by the sidecar and its adapters.
 *
 * This module intentionally returns variable names and booleans only. Secret
 * values are never included in diagnostics or API responses.
 */

export type RuntimeConfigStatus = {
  supabaseConfigured: boolean;
  missingSupabaseVariables: string[];
  missingOAuthVariables: string[];
  tokenEncryptionConfigured: boolean;
};

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function getSupabaseUrl(): string | null {
  const value = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  return value || null;
}

export function getSupabaseAnonKey(): string | null {
  const value = process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim();
  return value || null;
}

export function getOAuthCallbackBaseUrl(): string {
  return process.env.OAUTH_CALLBACK_BASE_URL?.trim() || 'http://localhost:37701';
}

export function getRuntimeConfigStatus(): RuntimeConfigStatus {
  const supabaseVariables = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const oauthGroups = [
    ['GITHUB_REPO_CLIENT_ID', 'GITHUB_REPO_CLIENT_SECRET'],
    ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'],
    ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  ];
  const missingSupabaseVariables = supabaseVariables.filter(name => !present(name) && !present(name === 'SUPABASE_URL' ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_ANON_KEY'));
  const missingOAuthVariables = oauthGroups.flatMap(group => group.filter(name => !present(name)));
  return {
    supabaseConfigured: missingSupabaseVariables.length === 0,
    missingSupabaseVariables,
    missingOAuthVariables,
    tokenEncryptionConfigured: present('CENTINEL_TOKEN_ENCRYPTION_KEY'),
  };
}

/** Log only configuration state, never a key, token, or client secret. */
export function logRuntimeConfigStatus(logger: (message: string) => void = console.warn): RuntimeConfigStatus {
  const status = getRuntimeConfigStatus();
  if (!status.supabaseConfigured) {
    logger(`[config] Supabase is not configured. Set: ${status.missingSupabaseVariables.join(', ')}`);
  }
  if (status.missingOAuthVariables.length > 0) {
    logger(`[config] OAuth providers are not fully configured. Missing variable names: ${status.missingOAuthVariables.join(', ')}`);
  }
  if (!status.tokenEncryptionConfigured) {
    logger('[config] Provider token encryption is not configured. Set: CENTINEL_TOKEN_ENCRYPTION_KEY');
  }
  return status;
}
