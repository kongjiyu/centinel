import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './SettingsScreen';
import { api } from '../api/client';
import type { AiProviderSetting } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getAiUsage: vi.fn(),
  },
}));

const settings: AiProviderSetting[] = [
  {
    id: 'text',
    label: 'Text AI',
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    hasApiKey: false,
    apiKeyPreview: '',
    baseUrl: 'https://example.com/text',
    model: 'text-model',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'vision',
    label: 'Vision AI',
    provider: 'gemini',
    apiFormat: 'google-native',
    hasApiKey: false,
    apiKeyPreview: '',
    baseUrl: 'https://example.com/vision',
    model: 'vision-model',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
];

describe('SettingsScreen source capability boundary', () => {
  it('does not present unbacked provider connection statuses', async () => {
    vi.mocked(api.getAiUsage).mockResolvedValue({
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 },
      byGroup: [],
      recent: [],
    });

    render(<SettingsScreen settings={settings} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole('heading', { name: 'Source connections' })).toBeInTheDocument();
    expect(screen.getByText('Source connections are not configurable from Settings in this build.')).toBeInTheDocument();
    expect(screen.getByText("Use a project's Source section")).toBeInTheDocument();
    expect(screen.getByText('For supported local or repository input, open a project and manage its sources there.')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();

    await waitFor(() => expect(api.getAiUsage).toHaveBeenCalled());
  });
});
