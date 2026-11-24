import type { AiApiFormat, AiProvider, AiProviderSetting } from '../types';

type ProviderPreset = {
  id: string;
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  baseUrl: string;
  model: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'mimo-payg', label: 'MiMo Pay-as-you-go Pro (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.6-pro' },
  { id: 'mimo-openai', label: 'MiMo Token Plan Flash (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.6-flash' },
  { id: 'mimo-anthropic', label: 'MiMo Token Plan Flash (Anthropic-compatible)', provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic', model: 'mimo-v2.6-flash' },
  { id: 'mimo-pro-openai', label: 'MiMo Token Plan Pro (OpenAI-compatible)', provider: 'mimo', apiFormat: 'openai-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.6-pro' },
  { id: 'mimo-pro-anthropic', label: 'MiMo Token Plan Pro (Anthropic-compatible)', provider: 'mimo', apiFormat: 'anthropic-compatible', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic', model: 'mimo-v2.6-pro' },
  { id: 'gemini', label: 'Google Gemini', provider: 'gemini', apiFormat: 'google-native', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-2.5-flash' },
  { id: 'claude', label: 'Claude', provider: 'custom', apiFormat: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com/v1/messages', model: '' },
  { id: 'custom-openai', label: 'Custom (OpenAI-compatible)', provider: 'custom', apiFormat: 'openai-compatible', baseUrl: '', model: '' },
  { id: 'custom-anthropic', label: 'Custom (Anthropic-compatible)', provider: 'custom', apiFormat: 'anthropic-compatible', baseUrl: '', model: '' },
];

export function findMatchingPreset(setting: AiProviderSetting): ProviderPreset | null {
  return PROVIDER_PRESETS.find(p =>
    p.provider === setting.provider && p.apiFormat === setting.apiFormat &&
    p.baseUrl === setting.baseUrl && p.model === setting.model
  ) || PROVIDER_PRESETS.find(p => p.baseUrl && p.provider === setting.provider && p.apiFormat === setting.apiFormat && p.baseUrl === setting.baseUrl) || null;
}
