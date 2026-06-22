import { describe, it, expect } from 'vitest';
import { findMatchingPreset, PROVIDER_PRESETS } from './SettingsScreen';
import type { AiProviderSetting } from '../types';

const baseSetting: AiProviderSetting = {
  id: 'vision',
  label: 'Multimodal Vision',
  provider: 'custom',
  apiFormat: 'openai-compatible',
  hasApiKey: true,
  apiKeyPreview: '****',
  baseUrl: 'https://api.example.com/v1/chat/completions',
  model: 'some-model',
  updatedAt: new Date().toISOString(),
};

const anthropicSetting: AiProviderSetting = {
  ...baseSetting,
  apiFormat: 'anthropic-compatible',
  baseUrl: 'https://api.example.com/v1/messages',
};

// Mirror the exact sync logic used inside the ProviderForm useEffect so we can
// verify the resolved selectedPresetId for any persisted setting.
function resolvePresetId(setting: AiProviderSetting): string {
  const match = findMatchingPreset(setting);
  return (
    match?.id ??
    (setting.apiFormat === 'anthropic-compatible' ? 'custom-anthropic' : 'custom-openai')
  );
}

describe('SettingsScreen — provider format preservation', () => {
  it('PROVIDER_PRESETS contains both custom-openai and custom-anthropic presets with the right apiFormats', () => {
    const openai = PROVIDER_PRESETS.find(p => p.id === 'custom-openai');
    const anthropic = PROVIDER_PRESETS.find(p => p.id === 'custom-anthropic');
    expect(openai?.apiFormat).toBe('openai-compatible');
    expect(anthropic?.apiFormat).toBe('anthropic-compatible');
  });

  it('resolves to custom-anthropic when persisted apiFormat is anthropic-compatible (with a custom URL)', () => {
    // After the user picks "Custom (Anthropic-compatible)" and types their own URL, the preset
    // no longer matches exactly, so the sync logic must fall back to apiFormat to choose the
    // presetId. This is the bug the useEffect fix addresses.
    expect(resolvePresetId(anthropicSetting)).toBe('custom-anthropic');
  });

  it('resolves to custom-openai when persisted apiFormat is openai-compatible (with a custom URL)', () => {
    expect(resolvePresetId(baseSetting)).toBe('custom-openai');
  });

  it('does NOT fall back to custom-openai for an anthropic-compatible setting', () => {
    // Guards the bug directly: previously, after save the form could display "openai-compatible"
    // even though the persisted apiFormat was "anthropic-compatible".
    expect(resolvePresetId(anthropicSetting)).not.toBe('custom-openai');
  });

  it('resolves to the exact preset id when all four fields match a built-in preset', () => {
    const mimoOpenai: AiProviderSetting = {
      ...baseSetting,
      provider: 'mimo',
      apiFormat: 'openai-compatible',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
      model: 'mimo-v2.5',
    };
    expect(resolvePresetId(mimoOpenai)).toBe('mimo-openai');
  });
});
