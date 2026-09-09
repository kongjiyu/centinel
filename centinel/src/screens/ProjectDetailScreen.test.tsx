import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectDetailScreen } from './ProjectDetailScreen';
import { api } from '../api/client';
import type { Artifact, Project, Screen } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listDynamicSessions: vi.fn(),
    listStaticSessions: vi.fn(),
    listArtifacts: vi.fn(),
    listFindings: vi.fn(),
    deleteProject: vi.fn(),
    updateProject: vi.fn(),
    getCollaborationStatus: vi.fn(),
    searchCollaborators: vi.fn(),
    inviteCollaborator: vi.fn(),
  },
}));

vi.mock('../context/ActiveReviewContext', () => ({
  useActiveReviewState: () => ({
    state: null,
    controls: {
      setExpanded: vi.fn(),
      setDismissed: vi.fn(),
      trackSession: vi.fn(),
      retry: vi.fn(),
    },
  }),
}));

const project: Project = {
  id: 'project-1',
  name: 'Website refresh',
  description: 'Office website',
  workspacePath: 'C:/work/website-refresh',
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

function renderProject(onNavigate: (screen: Screen) => void = vi.fn(), projectArtifacts: Artifact[] = [], onProjectUpdated?: (updatedProject: Project) => void) {
  vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
  vi.mocked(api.listStaticSessions).mockResolvedValue([]);
  vi.mocked(api.listArtifacts).mockResolvedValue(projectArtifacts);
  vi.mocked(api.listFindings).mockResolvedValue([]);
  vi.mocked(api.getCollaborationStatus).mockResolvedValue({ available: false, repository: null, message: 'Collaboration data is not connected' });

  return render(<ProjectDetailScreen project={project} onNavigate={onNavigate} onProjectUpdated={onProjectUpdated} />);
}

describe('ProjectDetailScreen refinement surfaces', () => {
  it('keeps project settings read-only until Edit and persists the saved contract', async () => {
    const user = userEvent.setup();
    const onProjectUpdated = vi.fn();
    const updatedProject = { ...project, name: 'Website refresh v2', description: 'Updated description' };
    vi.mocked(api.updateProject).mockResolvedValue(updatedProject);
    renderProject(vi.fn(), [], onProjectUpdated);

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const settingsSection = screen.getByRole('heading', { name: 'Project settings' }).closest('section');
    expect(settingsSection).not.toBeNull();
    const settings = within(settingsSection as HTMLElement);
    expect(settings.getByLabelText('Project name')).toHaveValue(project.name);
    expect(settings.getByLabelText('Description')).toHaveValue(project.description);
    expect(settings.getByLabelText('Workspace')).toHaveValue(project.workspacePath);
    expect(settings.getByLabelText('Project name')).toBeDisabled();
    await user.click(settings.getByRole('button', { name: 'Edit' }));
    await user.clear(settings.getByLabelText('Project name'));
    await user.type(settings.getByLabelText('Project name'), updatedProject.name);
    await user.click(settings.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith(project.id, {
      name: updatedProject.name,
      description: project.description,
      workspacePath: project.workspacePath,
    }));
    expect(onProjectUpdated).toHaveBeenCalledWith(updatedProject);
    expect(screen.getByText('Project settings saved.')).toBeInTheDocument();
    expect(settings.getByText(new Date(project.createdAt).toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByText('Default severity')).toBeInTheDocument();
    expect(screen.getByText('Default priority')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove project' })).toBeInTheDocument();
  });

  it('shows the unavailable collaboration state and keeps the invite action explicit', async () => {
    const user = userEvent.setup();
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Collaborations' }));

    expect(screen.getByRole('heading', { name: 'Collaborations' })).toBeInTheDocument();
    expect(screen.getAllByText('Collaboration data is not connected').length).toBeGreaterThan(0);
    expect(screen.queryByText('You · Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned reviewers')).not.toBeInTheDocument();
    expect(screen.queryByText('Developers')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add collaborator' })).toBeInTheDocument();
  });

  it('searches GitHub accounts and requires confirmation before inviting', async () => {
    const user = userEvent.setup();
    vi.mocked(api.searchCollaborators).mockResolvedValue({
      email: 'dev@example.com',
      repository: { owner: 'acme', repo: 'website', remoteUrl: 'https://github.com/acme/website.git' },
      matches: [{ id: 7, login: 'dev', avatarUrl: '', htmlUrl: 'https://github.com/dev', type: 'User' }],
    });
    vi.mocked(api.inviteCollaborator).mockResolvedValue({
      username: 'dev',
      repository: { owner: 'acme', repo: 'website', remoteUrl: 'https://github.com/acme/website.git' },
      status: 'invited',
    });
    renderProject();
    vi.mocked(api.getCollaborationStatus).mockResolvedValue({ available: true, repository: { owner: 'acme', repo: 'website', remoteUrl: 'https://github.com/acme/website.git' } });

    await user.click(screen.getByRole('button', { name: 'Collaborations' }));
    await waitFor(() => expect(screen.getByText('GitHub collaboration is available')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add collaborator' }));
    const dialog = screen.getByRole('dialog', { name: 'Add collaborator' });
    await user.type(within(dialog).getByLabelText('GitHub account email'), 'dev@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Search' }));
    expect(await within(dialog).findByText('dev')).toBeInTheDocument();
    expect(api.inviteCollaborator).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /dev/ }));
    expect(within(dialog).getByText(/This sends an external GitHub invitation/)).toBeInTheDocument();
    expect(api.inviteCollaborator).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(api.inviteCollaborator).toHaveBeenCalledWith(project.id, 'dev'));
  });

  it('opens Dynamic Testing setup in the shared dialog shell without a duplicate form header', async () => {
    const user = userEvent.setup();
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Action' }));
    await user.click(screen.getByRole('menuitem', { name: 'Dynamic testing' }));

    const dialog = await screen.findByRole('dialog', { name: 'New test' });
    expect(dialog).toContainElement(screen.getByLabelText('Website address'));
    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Close test form' })).not.toBeInTheDocument();
    expect(dialog.querySelector('.panel-header')).not.toBeInTheDocument();
  });

  it('provides the overview readiness and paged attention surfaces', async () => {
    const projectArtifacts: Artifact[] = [
      { id: 'a-1', projectId: project.id, type: 'requirement', source: 'documents', fileName: 'requirements.md', filePath: 'requirements.md', originalPath: null, contentHash: 'a', createdAt: project.updatedAt },
    ];
    vi.mocked(api.listFindings).mockResolvedValue([]);
    renderProject(vi.fn(), projectArtifacts);

    expect(await screen.findByRole('heading', { name: 'Need attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Readiness' })).toBeInTheDocument();
    expect(screen.getByText('Requirement specification')).toBeInTheDocument();
    expect(screen.getByText('1 source available')).toBeInTheDocument();
    expect(screen.getByText('Start the first Review')).toBeInTheDocument();
  });

  it('confirms project removal through the existing delete contract', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    vi.mocked(api.deleteProject).mockResolvedValue({ ok: true });
    renderProject(onNavigate);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Remove project' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove project' });
    expect(dialog).toHaveTextContent('Files in C:/work/website-refresh will be retained.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove project' }));

    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith(project.id));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'projects' });
  });
});
