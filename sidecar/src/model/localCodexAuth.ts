import fs from 'node:fs';
import type { ExternalChatgptTokens } from './codex.js';

/** Explicit local opt-in, bound to one verified Centinel user. Reads access tokens
 * only; the desktop Codex app retains ownership of token refresh and logout. */
export function localCodexTokenSource(ownerId: string): (() => ExternalChatgptTokens) | undefined {
  const owner = process.env.CENTINEL_CODEX_LOCAL_AUTH_OWNER_ID?.trim();
  const file = process.env.CENTINEL_CODEX_LOCAL_AUTH_FILE?.trim();
  if (!owner || !file || owner !== ownerId) return undefined;
  let accountId: string | undefined;
  return () => {
    let value: any;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('The explicitly configured desktop Codex login is unavailable.'); }
    const tokens = value.tokens;
    if (value.auth_mode !== 'chatgpt' || typeof tokens?.access_token !== 'string' || !tokens.access_token || typeof tokens?.account_id !== 'string' || !tokens.account_id) throw new Error('Sign in to desktop Codex with ChatGPT first.');
    if (accountId && accountId !== tokens.account_id) throw new Error('Desktop Codex account changed. Reconfigure the explicit local binding.');
    accountId = tokens.account_id;
    return { accessToken: tokens.access_token, chatgptAccountId: tokens.account_id };
  };
}
