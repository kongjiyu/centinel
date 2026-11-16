import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { api as realApi } from '../api/client';
import { documentType, folderName, githubRepositoryName, startCheck } from './runner';
import { getCheck, resetCheckStore } from './store';

type Api = typeof realApi;

function fakeApi(overrides: Partial<Record<keyof Api, unknown>> = {}): Api {
  return {
    createProject: vi.fn().mockResolvedValue({ id: 'p-new', name: 'shop', description: '', workspacePath: '/work/shop', createdAt: '', updatedAt: '' }),
    importRepoArtifacts: vi.fn().mockResolvedValue({ imported: [], skipped: ['logo.png'] }),
    uploadArtifact: vi.fn().mockResolvedValue({ id: 'doc' }),
    listArtifacts: vi.fn().mockResolvedValue([{ id: 'a1', type: 'source_code' }, { id: 'a2', type: 'coding_standard' }, { id: 'a3', type: 'other', currency: { deprecated: true } }]),
    listRequirements: vi.fn().mockResolvedValue([{ id: 'req-1' }]),
    createStaticSession: vi.fn().mockResolvedValue({ id: 'review-1' }),
    startAutoTest: vi.fn().mockResolvedValue({ id: 'auto-1' }),
    listConnectedSources: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Api;
}

const until = async (predicate: () => boolean) => { for (let i = 0; i < 50 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 0)); };

describe('check runner', () => {
  beforeEach(() => resetCheckStore());

  it('reads names from folders and GitHub links and labels documents by name only', () => {
    expect(folderName('/Users/me/work/shop/')).toBe('shop');
    expect(folderName('C:\\work\\portal')).toBe('portal');
    expect(githubRepositoryName('https://github.com/cypress-io/cypress-realworld-app.git')).toBe('cypress-io/cypress-realworld-app');
    expect(githubRepositoryName('https://gitlab.com/a/b')).toBeNull();
    expect(documentType('requirements.md')).toBe('requirement');
    expect(documentType('coding-standards.pdf')).toBe('coding_standard');
    expect(documentType('architecture.md')).toBe('design');
    expect(documentType('notes.txt')).toBe('other');
  });

  it('creates the project, adds documents, starts the review with the full scope and the browser tests', async () => {
    const api = fakeApi();
    const onProjectCreated = vi.fn();
    const check = startCheck({ folder: '/work/shop', documents: [{ name: 'requirements.md', base64: 'IyBSZXE=' }], focus: ' sign-in ', mode: 'both' }, { api, projects: () => [], onProjectCreated });
    expect(check.phase).toBe('preparing');
    await until(() => getCheck(check.id)?.phase === 'running');

    expect(api.createProject).toHaveBeenCalledWith('shop', '', '', [{ type: 'local-repository', path: '/work/shop' }]);
    expect(onProjectCreated).toHaveBeenCalled();
    expect(api.uploadArtifact).toHaveBeenCalledWith('p-new', { fileName: 'requirements.md', content: 'IyBSZXE=', type: 'requirement' });
    const payload = vi.mocked(api.createStaticSession).mock.calls[0][1];
    expect(payload).toMatchObject({ instructions: 'sign-in', scopeMode: 'full', artifactIds: ['a1'], standardIds: ['a2'], requirementIds: ['req-1'] });
    expect(api.startAutoTest).toHaveBeenCalledWith('p-new', { folder: '/work/shop' });
    expect(getCheck(check.id)).toMatchObject({ projectId: 'p-new', reviewId: 'review-1', autoTestId: 'auto-1', phase: 'running' });
  });

  it('reuses the project for the same folder and refreshes its files', async () => {
    const api = fakeApi();
    const existing = { id: 'p-old', name: 'shop', description: '', workspacePath: '/work/shop/', createdAt: '', updatedAt: '' };
    const check = startCheck({ folder: '/work/shop', documents: [], focus: '', mode: 'code' }, { api, projects: () => [existing] });
    await until(() => getCheck(check.id)?.phase === 'running');
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.importRepoArtifacts).toHaveBeenCalledWith('p-old', '/work/shop');
    expect(api.startAutoTest).not.toHaveBeenCalled();
    expect(getCheck(check.id)?.notes).toEqual(['1 files in the folder were skipped (unsupported type or too large).']);
  });

  it('reviews a GitHub link only after its import is ready, and explains that browser tests need a folder', async () => {
    const api = fakeApi({ listConnectedSources: vi.fn().mockResolvedValue([{ provider: 'github', syncStatus: 'ready' }]) });
    const check = startCheck({ githubUrl: 'https://github.com/acme/shop', documents: [], focus: '', mode: 'both' }, { api, projects: () => [] });
    await until(() => getCheck(check.id)?.phase === 'running');
    expect(api.createProject).toHaveBeenCalledWith('shop', '', '', [{ type: 'github', repoUrl: 'https://github.com/acme/shop' }]);
    expect(api.startAutoTest).not.toHaveBeenCalled();
    expect(getCheck(check.id)?.notes[0]).toMatch(/Browser tests did not run/);
  });

  it('fails with a plain reason when nothing could start', async () => {
    const api = fakeApi({ listArtifacts: vi.fn().mockResolvedValue([]) });
    const check = startCheck({ folder: '/work/empty', documents: [], focus: '', mode: 'code' }, { api, projects: () => [] });
    await until(() => getCheck(check.id)?.phase === 'failed');
    expect(getCheck(check.id)?.error).toBe('No readable files were found in the project, so nothing could be reviewed.');
  });

  it('keeps the review running when the browser tests cannot start', async () => {
    const api = fakeApi({ startAutoTest: vi.fn().mockRejectedValue(new Error('Auto test is busy')) });
    const check = startCheck({ folder: '/work/shop', documents: [], focus: '', mode: 'both' }, { api, projects: () => [] });
    await until(() => getCheck(check.id)?.phase === 'running');
    expect(getCheck(check.id)?.reviewId).toBe('review-1');
    expect(getCheck(check.id)?.notes[0]).toMatch(/^Browser tests did not start/);
  });
});
