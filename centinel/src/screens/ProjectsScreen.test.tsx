import { render, screen, waitFor, within } from '@testing-library/react';
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
    listArtifacts: vi.fn(),
  },
}));

describe('Project creation', () => {
  beforeEach(() => {
    folderPicker.mockReset();
    vi.mocked(api.listStaticSessions).mockResolvedValue([]);
    vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
  });

  it('submits the chosen workspace and preserves values when creation fails', async () => {
    const user = userEvent.setup();
    folderPicker.mockResolvedValue('C:\\Projects\\banking');
    const onCreate = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    render(<ProjectsScreen projects={[]} onCreate={onCreate} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.type(screen.getByLabelText('Project name *'), 'Banking');
    await user.type(screen.getByLabelText(/Description/), 'Payment verification');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Banking', 'Payment verification', 'C:\\Projects\\banking'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(screen.getByLabelText('Project name *')).toHaveValue('Banking');
    expect(screen.getByLabelText('Workspace folder *')).toHaveValue('C:\\Projects\\banking');
  });

  it('reports folder-picker failures without discarding the project name', async () => {
    const user = userEvent.setup();
    folderPicker.mockRejectedValue(new Error('Desktop bridge unavailable'));
    render(<ProjectsScreen projects={[]} onCreate={vi.fn()} onDelete={vi.fn()} onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.type(screen.getByLabelText('Project name *'), 'Banking');
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('folder picker could not open');
    expect(screen.getByLabelText('Project name *')).toHaveValue('Banking');
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
    vi.mocked(api.listStaticSessions).mockImplementation(async projectId => projectId === 'review-project' ? [review] : []);
    vi.mocked(api.listDynamicSessions).mockImplementation(async projectId => projectId === 'dynamic-project' ? [test] : []);
    vi.mocked(api.listArtifacts).mockImplementation(async projectId => [{
      id: `artifact-${projectId}`,
      projectId,
      type: 'source_code',
      source: 'documents',
      fileName: 'source.ts',
      filePath: `C:/work/${projectId}/source.ts`,
      originalPath: null,
      contentHash: projectId,
      createdAt: '2026-09-01T08:00:00.000Z',
    }]);
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
        initialActivityFilter="dynamic"
      />,
    );

    const table = await screen.findByRole('table', { name: 'Projects' });
    expect(table).toHaveTextContent('Checkout regression');
    expect(table).toHaveTextContent('Test blocked');
    expect(table).not.toHaveTextContent('Release review');
    expect(screen.getByRole('combobox', { name: 'Current state' })).toHaveTextContent('Needs attention');
    expect(screen.getByRole('combobox', { name: 'Activity type' })).toHaveTextContent('Dynamic Testing');

    await user.type(screen.getByRole('searchbox', { name: 'Find projects' }), 'missing project');
    expect(screen.getByText('No projects match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('table', { name: 'Projects' })).toHaveTextContent('Release review');
    expect(screen.getByRole('table', { name: 'Projects' })).toHaveTextContent('Checkout regression');
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
    const firstPageProjectLabels = within(table).getAllByRole('button', { name: /Open project for Page project/i })
      .map(button => button.getAttribute('aria-label'));

    await user.click(screen.getByRole('button', { name: 'Next project page' }));

    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const secondPageProjectLabel = within(table).getByRole('button', { name: /Open project for Page project/i }).getAttribute('aria-label');
    expect(secondPageProjectLabel).not.toBeNull();
    expect(firstPageProjectLabels).not.toContain(secondPageProjectLabel);
    expect(screen.getByText('6–6 of 6')).toBeInTheDocument();
  });
});
