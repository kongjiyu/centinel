import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertProviderConfigured, buildAuthorizeUrl, exchangeCode, redirectUri } from '../../src/integrations/oauthConfig.js';

const originalEnv = { ...process.env };

describe('OAuth provider configuration', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OAUTH_CALLBACK_BASE_URL: 'http://localhost:37701',
      GITHUB_REPO_CLIENT_ID: 'github-repo-client',
      GITHUB_REPO_CLIENT_SECRET: 'github-repo-secret',
      GOOGLE_DRIVE_CLIENT_ID: 'google-drive-client',
      GOOGLE_DRIVE_CLIENT_SECRET: 'google-drive-secret',
      SLACK_CLIENT_ID: 'slack-client',
      SLACK_CLIENT_SECRET: 'slack-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('builds provider-specific callback URLs and authorization URLs without secrets', () => {
    expect(redirectUri('github')).toBe('http://localhost:37701/integrations/github/callback');
    expect(redirectUri('google_drive')).toBe('http://localhost:37701/integrations/google_drive/callback');
    expect(redirectUri('slack')).toBe('http://localhost:37701/integrations/slack/callback');
    for (const [provider, host] of [['github', 'github.com'], ['google_drive', 'accounts.google.com'], ['slack', 'slack.com']] as const) {
      const url = buildAuthorizeUrl(provider, 'state-token');
      expect(new URL(url).hostname).toBe(host);
      expect(url).toContain('state=state-token');
      expect(url).not.toContain('client_secret');
    }
    const slackScopes = new URL(buildAuthorizeUrl('slack', 'state-token')).searchParams.get('scope')?.split(',') ?? [];
    expect(slackScopes).toEqual(expect.arrayContaining(['channels:history', 'channels:read', 'groups:history', 'groups:read', 'files:read']));
  });

  it('fails early with the missing variable names', () => {
    delete process.env.SLACK_CLIENT_SECRET;
    expect(() => assertProviderConfigured('slack')).toThrow('SLACK_CLIENT_SECRET');
  });

  it('identifies a Google token-exchange network failure without exposing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(exchangeCode('google_drive', 'one-time-code'))
      .rejects.toThrow('Google Drive token exchange could not reach the provider');
  });
});
