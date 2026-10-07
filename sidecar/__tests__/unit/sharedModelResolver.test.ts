import { describe, expect, it, vi } from 'vitest';
import { resolveModelProviderChain } from '../../src/review/modelProviderResolver.js';

describe('shared Codex model configuration resolution', () => {
  const record = { ownerId: 'verified-user', provider: 'codex', apiFormat: 'codex-app-server', model: 'account-model', secretCiphertext: null, baseUrl: '' };
  it('resolves keyless text and image configurations with the verified account', async () => {
    const repository = { getModelConfiguration: vi.fn(async () => record) };
    for (const purpose of ['static_review', 'vision']) {
      const chain = await resolveModelProviderChain(repository, { ownerId: 'verified-user', projectId: 'project-1', purpose });
      expect(chain.primary).toMatchObject({ ownerId: 'verified-user', provider: 'codex', apiKey: '', model: 'account-model' });
      expect(chain.fallback).toBeNull();
      expect(repository.getModelConfiguration).toHaveBeenLastCalledWith({ ownerId: 'verified-user', projectId: 'project-1', purpose }, undefined);
    }
  });
  it('rejects owner mismatch and mismatched formats before launching Codex', async () => {
    await expect(resolveModelProviderChain({ getModelConfiguration: async () => ({ ...record, ownerId: 'other-user' }) }, { ownerId: 'verified-user' })).rejects.toMatchObject({ code: 'invalid_configuration' });
    await expect(resolveModelProviderChain({ getModelConfiguration: async () => ({ ...record, apiFormat: 'openai-compatible' }) }, { ownerId: 'verified-user' })).rejects.toMatchObject({ code: 'invalid_configuration' });
  });
});
