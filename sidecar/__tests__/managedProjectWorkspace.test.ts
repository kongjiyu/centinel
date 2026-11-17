import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { projectWorkspaceHome, withManagedProjectWorkspace } from '../src/managedProjectWorkspace.js';

it('chooses a writable user application data location for each platform', () => {
  expect(projectWorkspaceHome('win32', { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' }, 'C:\\Users\\Ada'))
    .toBe('C:\\Users\\Ada\\AppData\\Roaming\\com.centinel.app');
  expect(projectWorkspaceHome('darwin', {}, '/Users/ada')).toBe('/Users/ada/Library/Application Support/com.centinel.app');
  expect(projectWorkspaceHome('linux', { XDG_DATA_HOME: '/home/ada/data' }, '/home/ada')).toBe('/home/ada/data/com.centinel.app');
});

it('creates an account-local folder and treats it as available only after files are added', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'centinel-project-workspace-'));
  try {
    const project = { id: 'project-one', workspacePath: '' };
    const empty = await withManagedProjectWorkspace(project, 'account-one', root);
    const folder = path.join(root, 'projects', 'account-one', 'project-one');
    expect(empty).toEqual({ ...project, managedWorkspacePath: folder, managedWorkspaceReady: false });
    await writeFile(path.join(folder, 'package.json'), '{}');
    expect(await withManagedProjectWorkspace(project, 'account-one', root)).toMatchObject({ managedWorkspaceReady: true, workspacePath: '' });
    expect(await withManagedProjectWorkspace(project, 'account-two', root)).toMatchObject({ managedWorkspaceReady: false });
    const registered = { ...project, workspacePath: '/existing' };
    expect(await withManagedProjectWorkspace(registered, 'account-one', root)).toBe(registered);
    expect(await withManagedProjectWorkspace(project, '../other', root)).toBe(project);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
