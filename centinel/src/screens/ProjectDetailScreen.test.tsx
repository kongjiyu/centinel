import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatProjectDateTime, ProjectDetailScreen } from './ProjectDetailScreen';
import { api } from '../api/client';
import type { DynamicRun, MissionRevision } from '../dynamic/types';
import type { Artifact, CollaborationStatus, DynamicSession, Finding, GithubCollaboratorSnapshot, Project, ProjectReadinessStatus, ReviewSourceManifest, Screen, StaticSession } from '../types';

const folderPicker = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/dialog', () => ({ open: folderPicker }));
vi.mock('../api/client', () => ({
  api: {
    listDynamicSessions: vi.fn(),
    listProjectMembers: vi.fn().mockResolvedValue({ viewerUserId: 'owner-1', members: [{ userId: 'owner-1', email: 'owner@example.com', role: 'owner', addedAt: '' }] }),
    addProjectMember: vi.fn(),
    removeProjectMember: vi.fn(),
    dynamicRuns: vi.fn(),
    listStaticSessions: vi.fn(),
    listArtifacts: vi.fn(),
    getReviewSourceManifest: vi.fn(),
    getReviewEvidenceSufficiency: vi.fn().mockResolvedValue(null),
    listFindings: vi.fn(),
    getProjectAssessment: vi.fn(),
    deleteProject: vi.fn(),
    updateProject: vi.fn(),
    exportProjectReport: vi.fn(),
    listProjectReportHistory: vi.fn(),
    renewProjectReportLinks: vi.fn(),
    getCollaborationStatus: vi.fn(),
    getProjectReadiness: vi.fn(),
    startProjectReadiness: vi.fn(),
    getProjectCollaborators: vi.fn(),
    syncGithubCollaborators: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const emptyReadinessStatus: ProjectReadinessStatus = {
  projectId: project.id, requestId: null, status: 'idle', trigger: null,
  requestedAt: null, startedAt: null, completedAt: null, error: null, snapshot: null, stale: false,
};

function sourceCurrencyReview(id = 'review-1', status: StaticSession['status'] = 'success', updatedAt = '2026-10-01T10:00:00.000Z'): StaticSession {
  return {
    id, projectId: project.id, name: 'Latest review', reviewType: 'code_review', status,
    configJson: '{}', progressJson: '{}', remarks: '', finalSummary: '', failureReason: '',
    createdAt: '2026-09-30T10:00:00.000Z', updatedAt, baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '',
  };
}

function sourceCurrencyManifest(
  reviewId = 'review-1',
  status: ReviewSourceManifest['status'] = 'available',
  artifactIds = ['source-1'],
  contentHashes = ['old-hash'],
): ReviewSourceManifest {
  return {
    sessionId: reviewId, projectId: project.id, status, capturedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
    sources: artifactIds.length ? [{
      id: 'manifest-source-1', sessionId: reviewId, sourceId: 'manifest-source-1', sourceKind: 'document', label: 'Requirements',
      artifactIds, filesReviewed: artifactIds.length, contentHashes, capturedAt: '2026-10-01T10:00:00.000Z',
    }] : [],
    artifactCount: artifactIds.length,
  };
}

function sourceCurrencyArtifact(id: string, contentHash: string, source: Artifact['source'] = 'documents', type: Artifact['type'] = 'requirement'): Artifact {
  return {
    id, projectId: project.id, type, source, fileName: `${id}.md`, filePath: `${id}.md`, originalPath: null, contentHash, createdAt: '2026-10-01T10:00:00.000Z',
  };
}

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
  vi.mocked(api.getProjectCollaborators).mockResolvedValue({ repository: collaborationStatus.repository, collaborators: [], syncedAt: null });

  return render(<ProjectDetailScreen project={project} onNavigate={onNavigate} onProjectUpdated={onProjectUpdated} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  folderPicker.mockReset();
  vi.mocked(api.getReviewSourceManifest).mockImplementation(async (projectId, reviewId) => ({
    sessionId: reviewId, projectId, status: 'unavailable', sources: [], artifactCount: null,
  }));
  vi.mocked(api.listProjectReportHistory).mockResolvedValue([]);
  vi.mocked(api.dynamicRuns).mockResolvedValue([]);
  vi.mocked(api.getProjectAssessment).mockResolvedValue({ projectId: project.id, status: 'unavailable' } as never);
  vi.mocked(api.getProjectReadiness).mockResolvedValue(emptyReadinessStatus);
  vi.mocked(api.startProjectReadiness).mockResolvedValue({ ...emptyReadinessStatus, status: 'queued', requestId: 'request-1', trigger: 'manual' });
  vi.mocked(api.syncGithubCollaborators).mockResolvedValue({ repository: null, collaborators: [], syncedAt: null });
});

describe('ProjectDetailScreen refinement surfaces', () => {
  it('opens Source without unrelated Findings, Assessment, Review history or report requests', async () => {
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
    render(<ProjectDetailScreen project={project} onNavigate={vi.fn()} initialSection="source" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument());
    expect(api.listArtifacts).toHaveBeenCalledTimes(1);
    expect(api.listStaticSessions).not.toHaveBeenCalled();
    expect(api.listDynamicSessions).not.toHaveBeenCalled();
    expect(api.listFindings).not.toHaveBeenCalled();
    expect(api.getProjectAssessment).not.toHaveBeenCalled();
    expect(api.listProjectReportHistory).not.toHaveBeenCalled();
  });

  it('requests Assessment once on opening its tab, not as initial arrays load', async () => {
    const user = userEvent.setup();
    renderProject(vi.fn());
    await waitFor(() => expect(api.listStaticSessions).toHaveBeenCalled());
    expect(api.getProjectAssessment).not.toHaveBeenCalled();
    expect(api.listProjectReportHistory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    await waitFor(() => expect(api.getProjectAssessment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listFindings).toHaveBeenCalledTimes(2));
    expect(api.getProjectAssessment).toHaveBeenCalledTimes(1);
  });

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

    await user.click(screen.getByRole('button', { name: 'Members' }));

    expect(screen.getByRole('heading', { name: 'GitHub collaborators' })).toBeInTheDocument();
    expect(await screen.findByText('No collaborators synced yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Search collaborators')).toBeInTheDocument();
    expect(screen.getByText('Collaboration data is not connected')).toBeInTheDocument();
    expect(screen.queryByText('You · Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned reviewers')).not.toBeInTheDocument();
    expect(screen.queryByText('Developers')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add collaborator' })).toBeInTheDocument();
    expect(api.syncGithubCollaborators).not.toHaveBeenCalled();
  });

  it('shows overview skeletons instead of empty states during initial reads', async () => {
    const dynamic = deferred<DynamicSession[]>();
    const statics = deferred<StaticSession[]>();
    const findings = deferred<Finding[]>();
    const artifacts = deferred<Artifact[]>();
    vi.mocked(api.listDynamicSessions).mockReturnValue(dynamic.promise);
    vi.mocked(api.listStaticSessions).mockReturnValue(statics.promise);
    vi.mocked(api.listFindings).mockReturnValue(findings.promise);
    vi.mocked(api.listArtifacts).mockReturnValue(artifacts.promise);

    renderProject();

    expect(screen.getByRole('status', { name: 'Loading project overview' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading recent activity' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No items need attention right now.')).not.toBeInTheDocument();
    expect(screen.queryByText('No activity yet. Start a Review or Dynamic Testing from Action.')).not.toBeInTheDocument();

    dynamic.resolve([]);
    statics.resolve([]);
    findings.resolve([]);
    artifacts.resolve([]);
    expect(await screen.findByText('No activity yet. Start a Review or Dynamic Testing from Action.')).toBeInTheDocument();
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

  it('automatically syncs GitHub once on load and retains the explicit invite flow', async () => {
    const user = userEvent.setup();
    const syncedSnapshot: GithubCollaboratorSnapshot = {
      repository: availableCollaboration.repository,
      collaborators: [{ id: 7, login: 'dev', avatarUrl: '', htmlUrl: 'https://github.com/dev', type: 'User', permission: 'pull' }],
      syncedAt: '2026-09-26T00:00:00.000Z',
    };
    vi.mocked(api.syncGithubCollaborators).mockResolvedValue(syncedSnapshot);
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

    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(await screen.findByText('@dev')).toBeInTheDocument();
    expect(api.syncGithubCollaborators).toHaveBeenCalledTimes(1);
    expect(api.syncGithubCollaborators).toHaveBeenCalledWith(project.id);
    expect(screen.queryByRole('button', { name: 'Sync from GitHub' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync collaborators from GitHub' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(api.syncGithubCollaborators).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add collaborator' }));
    const dialog = screen.getByRole('dialog', { name: 'Add collaborator' });
    expect(within(dialog).getByText('acme/website')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Repository information' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /sync/i })).not.toBeInTheDocument();
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

  it('keeps the last collaborator snapshot visible after sync failure without retrying automatically', async () => {
    const user = userEvent.setup();
    const savedSnapshot: GithubCollaboratorSnapshot = {
      repository: availableCollaboration.repository,
      collaborators: [{ id: 8, login: 'saved', avatarUrl: '', htmlUrl: 'https://github.com/saved', type: 'User', permission: 'push' }],
      syncedAt: '2026-09-25T00:00:00.000Z',
    };
    renderProject(vi.fn(), [], undefined, [], [], [], availableCollaboration);
    vi.mocked(api.getProjectCollaborators).mockResolvedValue(savedSnapshot);
    vi.mocked(api.syncGithubCollaborators).mockRejectedValue(new Error(''));

    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(await screen.findByText('@saved')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be synced/i);
    expect(api.syncGithubCollaborators).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(await screen.findByText('@saved')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be synced/i);
    expect(api.syncGithubCollaborators).toHaveBeenCalledTimes(1);
  });

  it('opens the durable Dynamic Testing workspace from the project action without a direct-session dialog',async()=>{
    const user=userEvent.setup();const navigate=vi.fn();renderProject(navigate);await user.click(screen.getByRole('button',{name:'Action'}));await user.click(screen.getByRole('menuitem',{name:'Dynamic testing'}));expect(navigate).toHaveBeenCalledWith({name:'dynamic-testing',projectId:project.id});expect(screen.queryByRole('dialog',{name:'New test'})).not.toBeInTheDocument();
  });

  it('exposes Export report as the third project action and reuses the report handler', async () => {
    const user = userEvent.setup();
    vi.mocked(api.exportProjectReport).mockResolvedValue({
      reportId: 'report-123',
      generatedAt: '2026-09-21T00:00:00.000Z',
      generatorVersion: 'project-report-v3',
      riskPolicyVersion: 'centinel-risk-v1',
      expiresAt: '2026-09-21T00:15:00.000Z',
      storage: 'private-supabase',
      downloads: {
        json: 'https://reports.example.test/snapshot?token=json',
        markdown: 'https://reports.example.test/markdown?token=md',
        pdf: 'https://reports.example.test/pdf?token=pdf',
      },
      markdown: '# Project report\n',
      checksums: { snapshot: 'a'.repeat(64), markdown: 'b'.repeat(64), pdf: 'c'.repeat(64), package: 'd'.repeat(64) },
    });
    renderProject();

    await user.click(screen.getByRole('button', { name: 'Action' }));
    const menu = screen.getByRole('menu', { name: 'Project actions' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Start Review');
    expect(items[2]).toHaveTextContent('Export report');
    await user.click(items[2]);
    await waitFor(() => expect(api.exportProjectReport).toHaveBeenCalledWith(project.id));
    expect(await screen.findByRole('heading', { name: 'Project report generated' })).toBeInTheDocument();
    const downloads = screen.getByRole('navigation', { name: 'Report downloads' });
    expect(within(downloads).getByRole('link', { name: 'Download JSON' })).toHaveAttribute('href', 'https://reports.example.test/snapshot?token=json');
    expect(within(downloads).getByRole('link', { name: 'Download Markdown' })).toHaveAttribute('href', 'https://reports.example.test/markdown?token=md');
    expect(within(downloads).getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', 'https://reports.example.test/pdf?token=pdf');
    await user.click(screen.getByText('Integrity checksums'));
    expect(screen.getByText('d'.repeat(64))).toBeInTheDocument();
  });

  it('shows immutable report history and renews short-lived download links', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listProjectReportHistory).mockResolvedValue([{
      id: 'report-history-123',
      projectId: project.id,
      actorId: 'user-1',
      policyVersion: 'centinel-risk-v1',
      generatorVersion: 'project-report-v3',
      checksum: 'a'.repeat(64),
      createdAt: '2026-09-22T10:30:00.000Z',
      storage: { json: 'reports/report.json', markdown: 'reports/report.md', pdf: 'reports/report.pdf' },
    }]);
    vi.mocked(api.renewProjectReportLinks).mockResolvedValue({
      reportId: 'report-history-123',
      expiresAt: '2026-09-22T10:45:00.000Z',
      downloads: {
        json: 'https://reports.example.test/report.json',
        markdown: 'https://reports.example.test/report.md',
        pdf: 'https://reports.example.test/report.pdf',
      },
    });
    renderProject();

    expect(screen.queryByRole('button', { name: 'Reports' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Action' }));
    await user.click(screen.getByRole('menuitem', { name: 'Report history' }));
    expect(await screen.findByRole('dialog', { name: 'Report history' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Report history' })).queryByRole('button', { name: 'Export report' })).not.toBeInTheDocument();
    expect(screen.getByText(/Policy centinel-risk-v1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get download links' }));
    await waitFor(() => expect(api.renewProjectReportLinks).toHaveBeenCalledWith(project.id, 'report-history-123'));
    const links = screen.getByLabelText(/Downloads for report/);
    expect(within(links).getByRole('link', { name: 'JSON' })).toHaveAttribute('href', 'https://reports.example.test/report.json');
    expect(within(links).getByRole('link', { name: 'Markdown' })).toHaveAttribute('href', 'https://reports.example.test/report.md');
    expect(within(links).getByRole('link', { name: 'PDF' })).toHaveAttribute('href', 'https://reports.example.test/report.pdf');
  });

  it('provides the overview readiness and risk-derived assessment surfaces', async () => {
    const user = userEvent.setup();
    const projectArtifacts: Artifact[] = [
      { id: 'a-1', projectId: project.id, type: 'requirement', source: 'documents', fileName: 'requirements.md', filePath: 'requirements.md', originalPath: null, contentHash: 'a', createdAt: project.updatedAt },
    ];
    vi.mocked(api.listFindings).mockResolvedValue([]);
    renderProject(vi.fn(), projectArtifacts);

    expect(await screen.findByRole('heading', { name: 'Need attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Readiness' })).toBeInTheDocument();
    expect(screen.getByText('Requirement specification')).toBeInTheDocument();
    const readinessCard = screen.getByRole('heading', { name: 'Readiness' }).closest('section');
    expect(readinessCard).not.toBeNull();
    expect(within(readinessCard as HTMLElement).getAllByText('—')).toHaveLength(4);
    expect(within(readinessCard as HTMLElement).getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(within(readinessCard as HTMLElement).queryByText(/source[s]? available/i)).not.toBeInTheDocument();
    expect(screen.getByText('Start the first Review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByRole('heading', { name: 'Assessment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Risk Summary' })).toBeInTheDocument();
    expect(screen.queryByText(/Current unresolved project risk derived from persisted Severity and Priority/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Risk Level is derived using the Centinel Severity \+ Priority policy/i)).not.toBeInTheDocument();
    expect(screen.getByText('Requirement traceability attention')).toBeInTheDocument();
  });

  it.each([
    ['document', sourceCurrencyArtifact('source-1', 'new-hash', 'documents', 'requirement')],
    ['repository file', sourceCurrencyArtifact('source-1', 'new-hash', 'repository', 'source_code')],
  ])('reminds the project member to review an updated %s', async (_kind, currentArtifact) => {
    const onNavigate = vi.fn();
    const successfulReview = sourceCurrencyReview();
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(sourceCurrencyManifest());
    renderProject(onNavigate, [currentArtifact], undefined, [successfulReview]);

    expect(await screen.findByText('Sources changed')).toBeInTheDocument();
    expect(screen.getByText(/1 reviewed source version changed or were removed/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start Review' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-entry', projectId: project.id, comparisonParentReviewId: successfulReview.id });
  });

  it('does not remind when every source in the frozen manifest has the same version', async () => {
    const successfulReview = sourceCurrencyReview();
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(sourceCurrencyManifest());
    renderProject(vi.fn(), [sourceCurrencyArtifact('source-1', 'old-hash')], undefined, [successfulReview]);

    await waitFor(() => expect(api.getReviewSourceManifest).toHaveBeenCalledWith(project.id, successfulReview.id));
    await waitFor(() => expect(screen.queryByText('Sources changed')).not.toBeInTheDocument());
    expect(screen.queryByText('Review needs checking')).not.toBeInTheDocument();
  });

  it('refreshes the currency check after returning from Source', async () => {
    const user = userEvent.setup();
    const successfulReview = sourceCurrencyReview();
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(sourceCurrencyManifest());
    renderProject(vi.fn(), [sourceCurrencyArtifact('source-1', 'old-hash')], undefined, [successfulReview]);
    await waitFor(() => expect(api.listArtifacts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listStaticSessions).toHaveBeenCalledTimes(1));
    vi.mocked(api.listArtifacts).mockResolvedValue([sourceCurrencyArtifact('source-1', 'new-hash')]);

    await user.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(api.listArtifacts).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(await screen.findByText('Sources changed')).toBeInTheDocument();
    await waitFor(() => expect(api.listStaticSessions).toHaveBeenCalledTimes(2));
  });

  it('labels sources added after the manifest without implying they were in the Review scope', async () => {
    const successfulReview = sourceCurrencyReview();
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(sourceCurrencyManifest());
    renderProject(vi.fn(), [
      sourceCurrencyArtifact('source-1', 'old-hash'),
      { ...sourceCurrencyArtifact('new-source', 'new-hash', 'repository', 'source_code'), createdAt: '2026-10-02T10:00:00.000Z' },
    ], undefined, [successfulReview]);

    expect(await screen.findByText('New sources need review')).toBeInTheDocument();
    expect(screen.queryByText('Sources changed')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /See More/ }));
    const detailDialog = screen.getByRole('dialog', { name: 'New sources need review' });
    expect(detailDialog).toHaveTextContent(/1 new project source was imported after/);
    expect(detailDialog).toHaveTextContent(/may not be covered by that Review/);
  });

  it.each([
    ['unavailable historical manifest', sourceCurrencyManifest('review-1', 'unavailable', [], [])],
    ['empty manifest', sourceCurrencyManifest('review-1', 'available', [], [])],
    ['manifest without hashes', sourceCurrencyManifest('review-1', 'available', ['source-1'], [])],
    ['incomplete manifest', sourceCurrencyManifest('review-1', 'incomplete', ['source-1'], ['old-hash'])],
  ])('says source currency cannot be verified for an %s', async (_label, savedManifest) => {
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(savedManifest);
    renderProject(vi.fn(), [sourceCurrencyArtifact('source-1', 'old-hash')], undefined, [sourceCurrencyReview()]);

    expect(await screen.findByText('Review needs checking')).toBeInTheDocument();
    expect(screen.getByText(/Source currency cannot be verified from the saved Review evidence/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Review' })).toBeInTheDocument();
  });

  it('keeps the older successful source basis when a newer Review failed', async () => {
    const successfulReview = sourceCurrencyReview('review-success', 'success', '2026-10-01T10:00:00.000Z');
    const failedReview = sourceCurrencyReview('review-failed', 'failure', '2026-10-10T10:00:00.000Z');
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(sourceCurrencyManifest(successfulReview.id));
    renderProject(vi.fn(), [sourceCurrencyArtifact('source-1', 'new-hash')], undefined, [successfulReview, failedReview]);

    expect(await screen.findByText('Sources changed')).toBeInTheDocument();
    expect(api.getReviewSourceManifest).toHaveBeenCalledTimes(1);
    expect(api.getReviewSourceManifest).toHaveBeenCalledWith(project.id, successfulReview.id);
  });

  it('loads only the latest saved Review document findings when Findings opens', async () => {
    const user = userEvent.setup();
    const review = sourceCurrencyReview();
    vi.mocked(api.getReviewEvidenceSufficiency).mockResolvedValue({
      id: 'assessment', projectId: project.id, reviewId: review.id, assessedAt: review.updatedAt, confirmedRequirementCount: 1,
      gaps: [{ id: 'gap', code: 'traceability_mappings_incomplete', requirementId: 'pay-once', title: 'Incomplete Requirement Coverage', detail: 'A payment requirement has incomplete mapping evidence.', remediation: 'Review the requirement and link its code.', severity: 'warning', affectedStages: [], references: [{ artifactId: 'doc', filePath: 'requirements.md', relation: 'requirement' }] }],
    } as never);
    renderProject(vi.fn(), [], undefined, [review]);
    expect(api.getReviewEvidenceSufficiency).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Findings' }));
    expect(await screen.findByRole('row', { name: /Incomplete Requirement Coverage/ })).toBeInTheDocument();
    expect(api.getReviewEvidenceSufficiency).toHaveBeenCalledWith(project.id, review.id);
  });

  it('shows current readiness gaps in Project Findings as immutable readiness-origin items', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listFindings).mockResolvedValue([]);
    vi.mocked(api.getProjectReadiness).mockResolvedValue({
      ...emptyReadinessStatus,
      status: 'completed',
      completedAt: '2026-10-19T10:00:08.000Z',
      snapshot: {
        id: 'readiness-snapshot-1', projectId: project.id, sourceFingerprint: 'fingerprint-1', assessedAt: '2026-10-19T10:00:08.000Z',
        categories: [
          { id: 'repository', label: 'Repository', state: 'completed', sourceCount: 1, checksPassed: 2, checksTotal: 2, gapIds: [] },
          { id: 'requirements', label: 'Requirement specification', state: 'incomplete', sourceCount: 1, checksPassed: 1, checksTotal: 2, gapIds: ['gap-requirements'] },
          { id: 'design', label: 'Design documentation', state: 'missing', sourceCount: 0, checksPassed: 0, checksTotal: 1, gapIds: ['gap-design'] },
          { id: 'standards', label: 'Coding standards', state: 'missing', sourceCount: 0, checksPassed: 0, checksTotal: 1, gapIds: ['gap-standards'] },
        ],
        findings: [{
          id: 'gap-requirements', category: 'requirements', title: 'Clarify acceptance criteria',
          description: 'The expected result cannot be verified.', recommendation: 'Add an observable pass condition.',
          severity: 'blocking', references: [{ artifactId: 'artifact-1', path: 'requirements.md', excerpt: 'Make the page easy to use.' }],
        }],
      },
    });
    renderProject();

    const readinessCard = screen.getByRole('heading', { name: 'Readiness' }).closest('section');
    expect(readinessCard).not.toBeNull();
    await within(readinessCard as HTMLElement).findByText('Incomplete');
    await user.click(screen.getByRole('button', { name: 'Findings' }));

    const gapRow = await screen.findByRole('row', { name: /Clarify acceptance criteria/i });
    await user.click(within(gapRow).getByRole('button', { name: /See more about Clarify acceptance criteria/i }));
    expect(screen.getByText(/Readiness · Document quality/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clarify acceptance criteria' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Related sources' })).getByText('requirements.md')).toBeInTheDocument();
    expect(screen.getByText(/immutable snapshot from Project Readiness/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    expect(screen.getByText('0 classified')).toBeInTheDocument();
    expect(screen.getByText('No classified unresolved risk items.')).toBeInTheDocument();
  });

  it('labels stale readiness as previous and hides old gaps while preserving Review findings', async () => {
    const user = userEvent.setup();
    const currentFinding: Finding = {
      id: 'finding-current', projectId: project.id, sessionId: 'review-1', source: 'static', verifier: 'deterministic',
      severity: 'medium', priority: 'Medium', title: 'Current Review finding', description: 'This finding belongs to the current project inventory.',
      status: 'new', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z', artifactId: 'artifact-1',
      category: 'Quality', evidenceText: 'fixture evidence', recommendation: 'Review the issue.', confidence: 'high', fromRemarks: false,
      filePath: 'src/current.ts', lineNumber: 3,
    };
    vi.mocked(api.listFindings).mockResolvedValue([currentFinding]);
    vi.mocked(api.getProjectReadiness).mockResolvedValue({
      ...emptyReadinessStatus,
      status: 'idle',
      stale: true,
      snapshot: {
        id: 'readiness-stale', projectId: project.id, sourceFingerprint: 'previous-fingerprint', assessedAt: '2026-10-19T10:00:00.000Z',
        categories: [
          { id: 'repository', label: 'Repository', state: 'completed', sourceCount: 1, checksPassed: 1, checksTotal: 1, gapIds: [] },
          { id: 'requirements', label: 'Requirement specification', state: 'incomplete', sourceCount: 1, checksPassed: 1, checksTotal: 2, gapIds: ['old-gap'] },
          { id: 'design', label: 'Design documentation', state: 'completed', sourceCount: 1, checksPassed: 1, checksTotal: 1, gapIds: [] },
          { id: 'standards', label: 'Coding standards', state: 'completed', sourceCount: 1, checksPassed: 1, checksTotal: 1, gapIds: [] },
        ],
        findings: [{ id: 'old-gap', category: 'requirements', title: 'Previous acceptance gap', description: 'Old result.', recommendation: 'Reassess.', severity: 'blocking', references: [] }],
      },
    });
    renderProject(vi.fn(), [], undefined, [], [], [currentFinding]);

    expect(await screen.findByText('Previous assessment — sources have changed')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Awaiting manual assessment.');
    await user.click(screen.getByRole('button', { name: 'Findings' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Readiness findings describe previous sources and are hidden until a current assessment is available.');
    expect(await screen.findByRole('row', { name: /Current Review finding/ })).toBeInTheDocument();
    expect(screen.queryByText('Previous acceptance gap')).not.toBeInTheDocument();
    expect(api.startProjectReadiness).not.toHaveBeenCalled();
  });

  it('shows the four highest-risk unresolved findings in Assessment', async () => {
    const user = userEvent.setup();
    const riskFindings = [
      ['critical', 'High', 'Critical finding'],
      ['high', 'High', 'High finding'],
      ['medium', 'Medium', 'Medium finding'],
      ['low', 'Low', 'Low finding'],
      ['low', 'Low', 'Zeta finding'],
    ].map(([severity, priority, title], index) => ({
      id: `finding-${index}`,
      projectId: project.id,
      sessionId: 'review-1',
      source: 'static' as const,
      severity,
      priority,
      title,
      description: 'Risk finding',
      status: 'new' as const,
      createdAt: project.updatedAt,
      artifactId: null,
      category: 'quality',
      evidenceText: '',
      recommendation: '',
      confidence: 'medium',
      fromRemarks: false,
      filePath: 'src/example.ts',
      lineNumber: 1,
    }));
    renderProject(vi.fn(), [], undefined, [], [], riskFindings);

    await user.click(screen.getByRole('button', { name: 'Assessment' }));
    const table = await screen.findByRole('table', { name: 'Current risk items' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('Critical finding')).toBeInTheDocument();
    expect(within(table).queryByText('Zeta finding')).not.toBeInTheDocument();
  });

  it('excludes review-verified resolutions and persisted resolved or dismissed findings from current risk', async () => {
    const user = userEvent.setup();
    const makeFinding = (id: string, status: Finding['status'], title: string): Finding => ({
      id,
      projectId: project.id,
      sessionId: 'review-1',
      source: 'static',
      severity: 'high',
      priority: 'High',
      title,
      description: title,
      status,
      createdAt: project.updatedAt,
      artifactId: null,
      category: 'security',
      evidenceText: '',
      recommendation: '',
      confidence: 'medium',
      fromRemarks: false,
      filePath: 'src/example.ts',
      lineNumber: 1,
    });
    const findings: Finding[] = [
      {
        ...makeFinding('derived-resolved', 'carryover', 'Not reproduced after source update'),
        resolutionEvidence: {
          status: 'resolved',
          basis: 'not_reproduced_in_comparable_review',
          reviewId: 'review-new',
          reviewName: 'Re-review',
          sourceManifestId: 'manifest-new',
          previousSourceVersion: 'sha256:old',
          reviewedSourceVersion: 'sha256:new',
        },
      },
      makeFinding('manual-resolved', 'fixed', 'Manually resolved'),
      makeFinding('dismissed', 'dismissed', 'Dismissed finding'),
      makeFinding('active', 'new', 'Still active'),
    ];
    renderProject(vi.fn(), [], undefined, [], [], findings);

    await user.click(screen.getByRole('button', { name: 'Assessment' }));

    const table = await screen.findByRole('table', { name: 'Current risk items' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Still active')).toBeInTheDocument();
    expect(within(table).queryByText('Not reproduced after source update')).not.toBeInTheDocument();
    expect(within(table).queryByText('Manually resolved')).not.toBeInTheDocument();
    expect(within(table).queryByText('Dismissed finding')).not.toBeInTheDocument();
    expect(screen.getByText('1 classified')).toBeInTheDocument();
  });

  it('opens the comparable Review attached to derived resolution evidence', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const reReview = { ...sourceCurrencyReview('review-new'), name: 'Re-review' };
    const finding: Finding = {
      id: 'derived-resolved',
      projectId: project.id,
      sessionId: 'review-1',
      source: 'static',
      severity: 'high',
      priority: 'High',
      title: 'Not reproduced after source update',
      description: 'The comparable re-review did not reproduce this issue.',
      status: 'carryover',
      createdAt: project.updatedAt,
      artifactId: null,
      category: 'security',
      evidenceText: '',
      recommendation: '',
      confidence: 'medium',
      fromRemarks: false,
      filePath: 'src/example.ts',
      lineNumber: 1,
      resolutionEvidence: {
        status: 'resolved',
        basis: 'not_reproduced_in_comparable_review',
        reviewId: reReview.id,
        reviewName: reReview.name,
        sourceManifestId: 'manifest-new',
        previousSourceVersion: 'sha256:old',
        reviewedSourceVersion: 'sha256:new',
      },
    };
    renderProject(onNavigate, [], undefined, [reReview], [], [finding]);

    await user.click(screen.getByRole('button', { name: 'Findings' }));
    await user.click(await screen.findByRole('button', { name: /See more about Not reproduced after source update/i }));
    await user.click(screen.getByRole('button', { name: 'Open review Re-review' }));

    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: 'review-new', reviewName: 'Re-review' });
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

describe('ProjectDetailScreen shared Dynamic Runs', () => {
  it('lists shared Runs by saved test name with their verified state and opens the Run result', async () => {
    const revision = { id: 'revision-1', missionId: 'mission-1', revision: 1, name: 'Demo todo add', goal: 'Add a todo', targetUrl: 'http://localhost:37702/', maxSteps: 15, checks: [] } as unknown as MissionRevision;
    const run = (id: string, patch: Partial<DynamicRun>): DynamicRun => ({
      id, projectId: project.id, missionId: 'mission-1', revision, idempotencyKey: id, createdBy: 'actor',
      createdAt: '2026-10-29T04:14:12.000Z', updatedAt: '2026-10-29T04:14:48.000Z', state: 'completed', verdict: 'passed',
      reason: null, checks: [], evidence: [], legacySessionId: null, ...patch,
    });
    vi.mocked(api.dynamicRuns).mockResolvedValue([
      run('run-passed', {}),
      run('run-blocked', { state: 'blocked', verdict: 'not_tested', reason: 'No interactions are approved.', createdAt: '2026-10-29T04:11:05.000Z', updatedAt: '2026-10-29T04:11:40.000Z' }),
    ]);
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderProject(onNavigate);

    const passedRow = (await screen.findAllByRole('button', { name: /Demo todo add/ })).find(row => row.textContent?.includes('Completed'));
    expect(passedRow).toBeDefined();
    expect(screen.getAllByRole('button', { name: /Demo todo add/ }).some(row => row.textContent?.includes('Needs attention'))).toBe(true);
    // The later passing Run supersedes the earlier blocked one in Need attention.
    expect(screen.queryByText('Demo todo add needs attention')).not.toBeInTheDocument();

    await user.click(passedRow!);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'dynamic-testing', projectId: project.id, runId: 'run-passed' });
  });
});
