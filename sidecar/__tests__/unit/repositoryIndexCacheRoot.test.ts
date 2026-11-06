import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

describe('repository index cache root', () => {
  const previous = process.env.CENTINEL_HOME;
  afterEach(() => {
    if (previous === undefined) delete process.env.CENTINEL_HOME; else process.env.CENTINEL_HOME = previous;
    vi.resetModules();
  });

  it('stays under CENTINEL_HOME so the packaged app never writes into its signed bundle', async () => {
    process.env.CENTINEL_HOME = '/tmp/centinel-home-test';
    vi.resetModules();
    const { DEFAULT_REPOSITORY_INDEX_CACHE_ROOT } = await import('../../src/review/repositoryIndexSnapshot.js');
    expect(DEFAULT_REPOSITORY_INDEX_CACHE_ROOT).toBe(path.join('/tmp/centinel-home-test', 'data', 'repository-index') + path.sep);
  });

  it('keeps the repository data folder in development', async () => {
    delete process.env.CENTINEL_HOME;
    vi.resetModules();
    const { DEFAULT_REPOSITORY_INDEX_CACHE_ROOT } = await import('../../src/review/repositoryIndexSnapshot.js');
    expect(DEFAULT_REPOSITORY_INDEX_CACHE_ROOT).toBe(path.resolve(import.meta.dirname, '../../../data/repository-index') + path.sep);
  });
});
