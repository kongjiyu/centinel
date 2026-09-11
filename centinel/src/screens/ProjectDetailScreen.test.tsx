import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatProjectDateTime, ProjectDetailScreen } from './ProjectDetailScreen';
import { api } from '../api/client';
import type { Artifact, CollaborationStatus, DynamicSession, Finding, Project, Screen, StaticSession } from '../types';

const folderPicker = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/dialog', () => ({ open: folderPicker }));
vi.mock('../api/client', () => ({
  api: {
    listDynamicSessions: vi.fn(),
    listStaticSessions: vi.fn(),
    listArtifacts: vi.fn(),
    listFindings: vi.fn(),
    deleteProject: vi.fn(),
    updateProject: vi.fn(),
    exportProjectReport: vi.fn(),
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

const availableCollaboration: CollaborationStatus = { available: true, repository: { owner: 'acme', repo: 'website', remoteUrl: 'https://github.com/acme/website.git' } };
const unavailableCollaboration: CollaborationStatus = { available: false, repository: null, message: 'Collaboration data is not connected' };

function renderProject(
  onNavigate: (screen: Screen) => void = vi.fn(),
  projectArtifacts: Artifact[] = [],
  onProjectUpdated?: (updatedProject: Project) => void,
  staticSessions: StaticSession[] = [],
  dynamicSessions: DynamicSession[] = [],
  projectFindings: Finding[] = [],
  collaborationStatus = unavailableCollaboration,
) {
  vi.mocked(api.listDynamicSessions).mockResolvedValue(dynamicSessions);
  vi.mocked(api.listStaticSessions).mockResolvedValue(staticSessions);
  vi.mocked(api.listArtifacts).mockResolvedValue(projectArtifacts);
  vi.mocked(api.listFindings).mockResolvedValue(projectFindings);
  vi.mocked(api.getCollaborationStatus).mockResolvedValue(collaborationStatus);

  return render(<ProjectDetailScreen project={project} onNavigate={onNavigate} onProjectUpdated={onProjectUpdated} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  folderPicker.mockReset();
});

describe('ProjectDetailScreen refinement surfaces', () => {
  it('keeps project settings read-only until Edit and uses fixed finding defaults', async () => {
    const user = userEvent.setup();
    const onProjectUpdated = vi.fn();
    const updatedProject = { ...project, name: 'Website refresh v2', description: 'Updated description' };
    vi.mocked(api.updateProject).mockResolvedValue(updatedProject);
    renderProject(vi.fn(), [], onProjectUpdated);

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const settingsCard = screen.getByRole('heading', { name: 'Settings' }).closest('section');
    expect(settingsCard).not.toBeNull();
    const settings = within(settingsCard as HTMLElement);
    expect(settings.getByLabelText('Project name')).toHaveValue(project.name);
    expect(settings.getByLabelText('Description')).toHaveTextContent(project.description);
    expect(settings.getByLabelText('Workspace')).toHaveTextContent(project.workspacePath);
    expect(settings.getByLabelText('Project name')).toBeDisabled();
    expect(settings.getByText(formatProjectDateTime(project.createdAt))).toBeInTheDocument();
    expect(settings.queryByRole('button', { name: 'Add priority' })).not.toBeInTheDocument();
    expect(settings.queryByRole('button', { name: 'Add severity' })).not.toBeInTheDocument();
    expect(settings.queryByRole('button', { name: 'Choose workspace folder' })).not.toBeInTheDocument();
    expect(settings.getByLabelText('Workspace')).toHaveAttribute('aria-readonly', 'true');
    expect(settings.queryByRole('list', { name: 'Findings Priority values' })).not.toBeInTheDocument();
    expect(settings.queryByRole('list', { name: 'Findings Severity values' })).not.toBeInTheDocument();
    expect(settings.queryByRole('button', { name: /finding defaults/i })).not.toBeInTheDocument();
    await user.click(settings.getByRole('button', { name: 'Edit' }));
    expect(settings.getByLabelText('Description')).toHaveAttribute('placeholder', 'enter your description here');
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
    expect(settings.getByText(formatProjectDateTime(project.createdAt))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Findings Severity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Findings Priority' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove project' })).toBeInTheDocument();
  });

  it('shows the collaborator search and honest empty state without inventing users', async () => {
    const user = userEvent.setup();
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Collaborators' }));

    expect(screen.getByRole('heading', { name: 'Collaborators' })).toBeInTheDocument();
    expect(screen.getByText('Collaborator not found')).toBeInTheDocument();
    expect(screen.getByLabelText('Search collaborators')).toBeInTheDocument();
    expect(screen.getByText(/Add a collaborator or sync from GitHub/i)).toBeInTheDocument();
    expect(screen.queryByText('You · Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned reviewers')).not.toBeInTheDocument();
    expect(screen.queryByText('Developers')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add collaborator' })).toBeInTheDocument();
  });

  it('opens the native workspace picker only in edit mode and restores local drafts on Cancel', async () => {
    const user = userEvent.setup();
    folderPicker.mockResolvedValue('D:/workspace-renamed');
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const settingsCard = screen.getByRole('heading', { name: 'Settings' }).closest('section') as HTMLElement;
    const settings = within(settingsCard);
    expect(folderPicker).not.toHaveBeenCalled();
    await user.click(settings.getByRole('button', { name: 'Edit' }));
    await user.click(settings.getByRole('button', { name: 'Choose workspace folder' }));
    await waitFor(() => expect(folderPicker).toHaveBeenCalledWith({ directory: true, multiple: false, title: 'Choose workspace folder' }));
    expect(settings.getByLabelText('Workspace')).toHaveValue('D:/workspace-renamed');

    await user.click(settings.getByRole('button', { name: 'Cancel' }));
    expect(settings.getByLabelText('Workspace')).toHaveTextContent(project.workspacePath);
    expect(settings.queryByRole('button', { name: 'Choose workspace folder' })).not.toBeInTheDocument();
  });

  it('does not expose a per-project priority or severity configuration surface', async () => {
    const user = userEvent.setup();
    renderProject();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const settingsCard = screen.getByRole('heading', { name: 'Settings' }).closest('section') as HTMLElement;
    const settings = within(settingsCard);
    expect(settings.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    await user.click(settings.getByRole('button', { name: 'Edit' }));
    expect(settings.queryByRole('button', { name: 'Add priority' })).not.toBeInTheDocument();
    expect(settings.queryByRole('button', { name: 'Add severity' })).not.toBeInTheDocument();
  });

  it('debounces GitHub search, offers safe sync, and requires confirmation before inviting', async () => {
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
    renderProject(vi.fn(), [], undefined, [], [], [], availableCollaboration);

    await user.click(screen.getByRole('button', { name: 'Collaborators' }));
    await waitFor(() => expect(screen.getByText('Collaborator not found')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add collaborator' }));
    const dialog = screen.getByRole('dialog', { name: 'Add collaborator' });
    expect(within(dialog).getByText('acme/website')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Repository information' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sync collaborators from GitHub' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Sync collaborators from GitHub' }));
    expect(within(dialog).getByText(/existing collaborator data was not changed/i)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('GitHub account email'), 'dev@example.com');
    expect(await within(dialog).findByText('dev')).toBeInTheDocument();
    expect(api.searchCollaborators).toHaveBeenCalledWith(project.id, 'dev@example.com');
    expect(within(dialog).queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
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

  it('exposes Export report as the third project action and reuses the report handler', async () => {
    const user = userEvent.setup();
    vi.mocked(api.exportProjectReport).mockResolvedValue({ path: 'C:/reports/project.md' } as never);
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Action' }));
    const menu = screen.getByRole('menu', { name: 'Project actions' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent('Export report');
    await user.click(items[2]);
    await waitFor(() => expect(api.exportProjectReport).toHaveBeenCalledWith(project.id));
  });

  it('provides the overview readiness and paged attention surfaces', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('heading', { name: 'Assessment' })).toBeInTheDocument();
    expect(screen.getByText(/Evidence-led risk context from the latest Review and Dynamic Testing runs/i)).toBeInTheDocument();
  });

  it('filters recent activity by the type toggle and datetime, with stable timestamp formatting', async () => {
    const staticSession = {
      id: 'review-1', projectId: project.id, name: 'Review activity', reviewType: 'code_review', status: 'success',
      configJson: '{}', progressJson: '{}', remarks: '', finalSummary: '', failureReason: '',
      createdAt: '2026-08-30T10:11:12.000Z', updatedAt: '2026-08-30T10:11:12.000Z', baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '',
    } as StaticSession;
    const dynamicSession = {
      id: 'dynamic-1', projectId: project.id, type: 'dynamic', name: 'Dynamic activity', status: 'success', targetUrl: 'https://example.com', goal: 'Check home', missionType: 'smoke', browserMode: 'headed', maxSteps: 4, finalSummary: '', failureReason: '',
      createdAt: '2026-09-02T10:11:12.000Z', updatedAt: '2026-09-02T10:11:12.000Z',
    } as DynamicSession;
    const user = userEvent.setup();
    renderProject(vi.fn(), [], undefined, [staticSession], [dynamicSession]);

    expect(await screen.findByText('Review activity')).toBeInTheDocument();
    expect(screen.getByText(`done at ${formatProjectDateTime(staticSession.updatedAt)}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Review activity')).toBeInTheDocument();
    expect(screen.queryByText('Dynamic activity')).not.toBeInTheDocument();
    const datetime = screen.getByLabelText('Datetime');
    fireEvent.change(datetime, { target: { value: '2026-09-01T00:00' } });
    expect(screen.queryByText('Review activity')).not.toBeInTheDocument();
    expect(screen.getByText('No activity matches these filters.')).toBeInTheDocument();
  });

  it('opens long attention details in an accessible modal with the row action', async () => {
    const longFailure = 'This activity needs a careful review before it can continue. '.repeat(5);
    const failedSession = {
      id: 'review-failed', projectId: project.id, name: 'Long failure', reviewType: 'code_review', status: 'failure',
      configJson: '{}', progressJson: '{}', remarks: '', finalSummary: '', failureReason: longFailure,
      createdAt: '2026-08-30T10:11:12.000Z', updatedAt: '2026-08-30T10:11:12.000Z', baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '',
    } as StaticSession;
    const user = userEvent.setup();
    renderProject(vi.fn(), [], undefined, [failedSession]);
    const seeMore = await screen.findByRole('button', { name: /See More/ });
    expect(screen.queryByText(longFailure)).not.toBeInTheDocument();
    await user.click(seeMore);
    const dialog = screen.getByRole('dialog', { name: 'Long failure needs attention' });
    expect(dialog).toHaveTextContent(longFailure.trim());
    expect(within(dialog).getByRole('button', { name: 'Inspect' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Long failure needs attention' })).not.toBeInTheDocument();
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
