import type { AiProviderSetting } from './types';

/** Review uses the text role; Dynamic Testing uses the vision role. */
export type WorkflowRole = 'text' | 'vision';

/**
 * A workflow is ready when its saved setting can be used without an API key
 * (Codex sign-in with a chosen model) or has a stored API key. This mirrors the
 * Settings summary so Home, Review entry and Settings never disagree.
 */
export function isWorkflowProviderConfigured(settings: AiProviderSetting[], role: WorkflowRole): boolean {
  const setting = settings.find(item => item.id === role);
  if (!setting) return false;
  if (setting.provider === 'codex') return Boolean(setting.model.trim());
  return setting.hasApiKey;
}
