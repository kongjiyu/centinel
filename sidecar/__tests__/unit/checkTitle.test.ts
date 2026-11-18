import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCheckTitle } from '../../src/review/checkTitle.js';

const { held, analyze, resolveChain, saveUsage } = vi.hoisted(() => ({
  held: vi.fn(), analyze: vi.fn(), resolveChain: vi.fn(), saveUsage: vi.fn(),
}));
vi.mock('../../src/review/assessmentHold.js', () => ({ isAssessmentHeld: held }));
vi.mock('../../src/review/modelProviderResolver.js', () => ({
  SupabaseModelConfigurationRepository: class {},
  resolveModelProviderChain: resolveChain,
}));
vi.mock('../../src/store/index.js', () => ({
  SupabaseCentinelStore: class { saveModelUsage = saveUsage; },
}));

const settings = { provider: 'codex', apiFormat: 'codex-app-server', model: 'configured-model' };
const input = {
  client: {} as SupabaseClient, ownerId: 'owner', projectId: 'project', projectName: 'Sample Shop',
  focus: 'Check whether totals update when a coupon is entered', mode: 'browser' as const, documents: ['requirements.md'],
};

describe('check title generation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    held.mockReturnValue(false);
    resolveChain.mockResolvedValue({ primaryMetadata: settings, primaryProvider: { analyze } });
  });

  it('uses the configured provider once and records usage without the title or prompt', async () => {
    analyze.mockResolvedValue({ result: { title: ' Coupon Total Updates ' }, settings });
    await expect(generateCheckTitle(input)).resolves.toBe('Coupon Total Updates');
    expect(resolveChain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: 'vision', projectId: 'project' }), expect.anything());
    expect(analyze).toHaveBeenCalledOnce();
    expect(JSON.parse(analyze.mock.calls[0][0].prompt)).toEqual({
      project: 'Sample Shop', focus: input.focus, mode: 'browser', documents: ['requirements.md'],
    });
    expect(saveUsage.mock.calls.map(([record]) => record.outcome)).toEqual(['in_progress', 'success']);
    expect(saveUsage.mock.calls[0][0].id).toBe(saveUsage.mock.calls[1][0].id);
    expect(JSON.stringify(saveUsage.mock.calls)).not.toContain(input.focus);
  });

  it('honors the assessment hold before looking up a model', async () => {
    held.mockReturnValue(true);
    await expect(generateCheckTitle(input)).resolves.toBeNull();
    expect(resolveChain).not.toHaveBeenCalled();
  });
});
