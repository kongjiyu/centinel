import type { Project } from '../types';

export function projectLocalFolder(project?: Project): string | undefined {
  return project?.workspacePath || (project?.managedWorkspaceReady ? project.managedWorkspacePath : undefined);
}
