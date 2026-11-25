import { lstat, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const APP_ID = 'com.centinel.app';
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/i;

export function projectWorkspaceHome(platform = process.platform, env = process.env, home = homedir()): string {
  const configured = env.CENTINEL_HOME?.trim();
  if (configured) return path.resolve(configured);
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), APP_ID);
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', APP_ID);
  const xdg = env.XDG_DATA_HOME;
  return path.posix.join(xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.local', 'share'), APP_ID);
}

export async function withManagedProjectWorkspace<T extends { id: string; workspacePath: string }>(
  project: T,
  accountId: string,
  root = projectWorkspaceHome(),
): Promise<T & { managedWorkspacePath?: string; managedWorkspaceReady?: boolean }> {
  if (project.workspacePath || !SAFE_ID.test(accountId) || !SAFE_ID.test(project.id)) return project;
  const directory = path.join(root, 'projects', accountId, project.id);
  try {
    await mkdir(root, { recursive: true });
    let current = root;
    for (const part of ['projects', accountId, project.id]) {
      current = path.join(current, part);
      await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      if (!(await lstat(current)).isDirectory()) return project;
    }
    const files = await readdir(directory, { withFileTypes: true });
    const hasFiles = files.some(file => !file.name.startsWith('.') && file.name !== 'node_modules'
      && (file.isFile() || file.isDirectory()));
    return { ...project, managedWorkspacePath: directory, managedWorkspaceReady: hasFiles };
  } catch {
    return project;
  }
}
