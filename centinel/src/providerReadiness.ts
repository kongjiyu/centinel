import type { AiProviderSetting } from './types';

/** Review uses the text role; Dynamic Testing uses the vision role. */
export type WorkflowRole = 'text' | 'vision';

/**
 * A workflow is ready when its saved setting can be used without an API key
 * (OAuth sign-in with a chosen model) or has a stored API key. This mirrors the
 * Settings summary so Home, Review entry and Settings never disagree.
 */
export function isWorkflowProviderConfigured(settings: AiProviderSetting[], role: WorkflowRole): boolean {
  const setting = settings.find(item => item.id === role);
  if (!setting) return false;
  if (role === 'vision' && setting.provider === 'codex' && setting.codexScreenshots === false) return false;
  if (setting.provider === 'codex' || setting.connectionMethod === 'oauth') return Boolean(setting.model.trim());
  return setting.hasApiKey;
}
