import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { DynamicSession, Project, StaticSession } from '../types';
import { ProjectsScreen } from './ProjectsScreen';

const folderPicker = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/dialog', () => ({ open: folderPicker }));
vi.mock('../api/client', () => ({
  api: {
    listStaticSessions: vi.fn(),
    listDynamicSessions: vi.fn(),
    listArtifacts: vi.fn(), getSourcePresence: vi.fn(), uploadArtifact: vi.fn(),
  },
}));

describe('Project creation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    folderPicker.mockReset();
    vi.mocked(api.listStaticSessions).mockResolvedValue([]);
    vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
    vi.mocked(api.getSourcePresence).mockResolvedValue({ hasSources: false });
  });

  it('submits the chosen workspace and preserves values when creation fails', async () => {
    const user = userEvent.setup();
    folderPicker.mockResolvedValue('C:\\Projects\\banking');
    const onCreate = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    render(<ProjectsScreen projects={[]} onCreate={onCreate} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await user.type(screen.getByLabelText('Project name *'), 'Banking');
    await user.type(screen.getByLabelText(/Description/), 'Payment verification');
    await user.click(screen.getByRole('button', { name: 'Choose folders' }));
    await user.click(screen.getByRole('dialog', { name: 'Add Project' }).querySelector('button[type=submit]')!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Banking', 'Payment verification', [{ type: 'local-repository', path: 'C:\\Projects\\banking' }]));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(screen.getByLabelText('Project name *')).toHaveValue('Banking');
    expect(screen.getByText('C:\\Projects\\banking')).toBeInTheDocument();
  });

  it('creates a project without a selected repository so it can use a managed folder', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProjectsScreen projects={[]} onCreate={onCreate} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await user.type(screen.getByLabelText('Project name *'), 'New workspace');
    await user.click(within(screen.getByRole('dialog', { name: 'Add Project' })).getByRole('button', { name: 'Add project' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('New workspace', '', []));
  });

  it('reports folder-picker failures without discarding the project name', async () => {
    const user = userEvent.setup();
    folderPicker.mockRejectedValue(new Error('Desktop bridge unavailable'));
    render(<ProjectsScreen projects={[]} onCreate={vi.fn()} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await user.type(screen.getByLabelText('Project name *'), 'Banking');
    await user.click(screen.getByRole('button', { name: 'Choose folders' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('folder picker could not open');
    expect(screen.getByLabelText('Project name *')).toHaveValue('Banking');
  });

  it('creates a GitHub-backed project in the Centinel default workspace', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProjectsScreen projects={[]} onCreate={onCreate} onDelete={vi.fn()} onNavigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await user.type(screen.getByLabelText('Project name *'), 'Remote project');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(screen.getByLabelText('GitHub repository URL'), 'https://github.com/example/remote-project');
    await user.click(screen.getByRole('dialog', { name: 'Add Project' }).querySelector('button[type=submit]')!);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Remote project', '', [{
      type: 'github',
      repoUrl: 'https://github.com/example/remote-project',
    }]));
    expect(folderPicker).not.toHaveBeenCalled();
  });

  it('submits several local folders and GitHub links in one project', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    folderPicker.mockResolvedValue(['C:\\Projects\\api', 'C:\\Projects\\web']);
    render(<ProjectsScreen projects={[]} onCreate={onCreate} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    await user.type(screen.getByLabelText('Project name *'), 'Mixed');
    await user.click(screen.getByRole('button', { name: 'Choose folders' }));
    expect(folderPicker).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: true }));
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(screen.getByLabelText('GitHub repository URL'), 'https://github.com/example/first.git');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('GitHub repository URL'), 'https://github.com/example/second');
    await user.click(screen.getByRole('dialog', { name: 'Add Project' }).querySelector('button[type=submit]')!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Mixed', '', [
      { type: 'local-repository', path: 'C:\\Projects\\api' },
      { type: 'local-repository', path: 'C:\\Projects\\web' },
      { type: 'github', repoUrl: 'https://github.com/example/first' },
      { type: 'github', repoUrl: 'https://github.com/example/second' },
    ]));
  });

  it('stages the contents of a dropped folder and an individually chosen file before creating the project', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ id: 'new-project', name: 'Local sources' });
    vi.mocked(api.uploadArtifact).mockClear();
    render(<ProjectsScreen projects={[]} onCreate={onCreate} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add Project' }));
    await user.type(dialog.getByLabelText('Project name *'), 'Local sources');
    const drop = dialog.getByText('Drop files or a folder here').parentElement!;
    const nestedFile = new File(['let x = 1'], 'item.ts');
    const droppedEntry = { isFile: true, fullPath: '/folder/item.ts', file: (success: (file: File) => void) => success(nestedFile) };
    const readEntries = vi.fn().mockImplementationOnce(success => success([droppedEntry])).mockImplementation(success => success([]));
    const root = { isDirectory: true, fullPath: '/folder', createReader: () => ({ readEntries }) };
    fireEvent.drop(drop, { dataTransfer: { types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => root }], files: [] } });
    expect(await dialog.findByText('folder/item.ts')).toBeInTheDocument();
    await user.upload(dialog.getByLabelText('Local source files'), new File(['test'], 'notes.md'));
    expect(dialog.getByText('notes.md')).toBeInTheDocument();
    expect(api.uploadArtifact).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Add project' }));
    await waitFor(() => expect(api.uploadArtifact).toHaveBeenCalledTimes(2));
    expect(api.uploadArtifact).toHaveBeenCalledWith('new-project', { fileName: 'folder/item.ts', content: 'bGV0IHggPSAx' });
    expect(api.uploadArtifact).toHaveBeenCalledWith('new-project', { fileName: 'notes.md', content: 'dGVzdA==' });
  });
});

describe('Project directory', () => {
  const projects: Project[] = [
    {
      id: 'review-project',
      name: 'Release review',
      description: 'Approved customer portal changes',
      workspacePath: 'C:/work/release-review',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-03T08:00:00.000Z',
    },
    {
      id: 'dynamic-project',
      name: 'Checkout regression',
      description: 'Blocked payment journey',
      workspacePath: 'C:/work/checkout-regression',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-04T08:00:00.000Z',
    },
  ];
  const review: StaticSession = {
    id: 'review-1',
    projectId: 'review-project',
    name: 'Release readiness',
    reviewType: 'code_review',
    status: 'success',
    configJson: '{}',
    progressJson: '{}',
    remarks: '',
    finalSummary: '',
    failureReason: '',
    createdAt: '2026-09-03T08:00:00.000Z',
    updatedAt: '2026-09-03T09:00:00.000Z',
    baseRef: '',
    headRef: '',
    changedFilesJson: '[]',
    parentSessionId: '',
    reviewDiffJson: '',
    currentDecision: {
      id: 'decision-1',
      sessionId: 'review-1',
      projectId: 'review-project',
      decision: 'approved',
      comment: '',
      reviewer: 'Reviewer',
      createdAt: '2026-09-03T09:00:00.000Z',
    },
  };
  const test: DynamicSession = {
    id: 'test-1',
    projectId: 'dynamic-project',
    type: 'dynamic',
    name: 'Payment journey',
    status: 'blocked',
    targetUrl: 'http://localhost:3000',
    goal: 'Complete payment',
    missionType: 'smoke',
    browserMode: 'headed',
    maxSteps: 15,
    finalSummary: '',
    failureReason: 'The sign-in step could not continue.',
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T09:00:00.000Z',
  };

  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.listStaticSessions).mockImplementation(async projectId => projectId === 'review-project' ? [review] : []);
    vi.mocked(api.listDynamicSessions).mockImplementation(async projectId => projectId === 'dynamic-project' ? [test] : []);
    vi.mocked(api.getSourcePresence).mockResolvedValue({ hasSources: true });
  });

  it('shows activity skeletons inside the rows while projects stay openable', async () => {
    vi.mocked(api.listStaticSessions).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<ProjectsScreen projects={projects} onCreate={vi.fn()} onDelete={vi.fn()} onNavigate={onNavigate} />);
    const row = await screen.findByRole('row', { name: 'Open Release review overview' });
    expect(within(row).getByRole('status', { name: 'Loading activity for Release review' })).toBeInTheDocument();
    expect(screen.queryByText(/Updating project activity/)).not.toBeInTheDocument();
    await user.click(row);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'project-detail', projectId: 'review-project' });
  });

  it('uses the shared table and honors carried state and activity filters', async () => {
    const user = userEvent.setup();
    render(
      <ProjectsScreen
        projects={projects}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onNavigate={vi.fn()}
        initialStateFilter="needs_attention"
      />,
    );

    const table = await screen.findByRole('table', { name: 'Projects' });
    expect(table).toHaveTextContent('Checkout regression');
    expect(table).toHaveTextContent('Needs attention');
    expect(table).not.toHaveTextContent('Release review');
    expect(screen.getByRole('combobox', { name: 'Current state' })).toHaveTextContent('Needs attention');
    expect(screen.queryByRole('combobox', { name: 'Activity type' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search your projects' }), 'missing project');
    expect(screen.getByText('No projects match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('table', { name: 'Projects' })).toHaveTextContent('Release review');
    expect(screen.getByRole('table', { name: 'Projects' })).toHaveTextContent('Checkout regression');
  });

  it('pins and unpins projects from the full directory with a local preference', async () => {
    const user = userEvent.setup();
    render(<ProjectsScreen projects={projects} onCreate={vi.fn()} onDelete={vi.fn()} onNavigate={vi.fn()} />);

    const pinButton = await screen.findByRole('button', { name: 'Pin Release review' });
    expect(pinButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(pinButton);
    expect(screen.getByRole('button', { name: 'Unpin Release review' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('centinel:pinned-project-ids')).toBe(JSON.stringify(['review-project']));

    await user.click(screen.getByRole('button', { name: 'Unpin Release review' }));
    expect(screen.getByRole('button', { name: 'Pin Release review' })).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('centinel:pinned-project-ids')).toBe(JSON.stringify([]));
  });

  it('limits the directory to five rows per page without descriptions or removal controls', async () => {
    const user = userEvent.setup();
    const paginatedProjects: Project[] = Array.from({ length: 6 }, (_, index) => ({
      id: `page-project-${index + 1}`,
      name: `Page project ${index + 1}`,
      description: `Private description ${index + 1}`,
      workspacePath: `C:/work/page-project-${index + 1}`,
      createdAt: `2026-09-0${Math.min(index + 1, 9)}T08:00:00.000Z`,
      updatedAt: `2026-09-0${Math.min(index + 1, 9)}T08:00:00.000Z`,
    }));

    render(<ProjectsScreen projects={paginatedProjects} onCreate={vi.fn()} onDelete={vi.fn()} onNavigate={vi.fn()} />);

    const table = await screen.findByRole('table', { name: 'Projects' });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('1–5 of 6')).toBeInTheDocument();
    expect(table).not.toHaveTextContent('Private description 1');
    expect(screen.queryByRole('button', { name: /Remove page project/i })).not.toBeInTheDocument();
    const firstPageProjectLabels = within(table).getAllByRole('button', { name: /Edit project Page project/i })
      .map(button => button.getAttribute('aria-label'));

    await user.click(screen.getByRole('button', { name: 'Next project page' }));

    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const secondPageProjectLabel = within(table).getByRole('button', { name: /Edit project Page project/i }).getAttribute('aria-label');
    expect(secondPageProjectLabel).not.toBeNull();
    expect(firstPageProjectLabels).not.toContain(secondPageProjectLabel);
    expect(screen.getByText('6–6 of 6')).toBeInTheDocument();
  });
});
