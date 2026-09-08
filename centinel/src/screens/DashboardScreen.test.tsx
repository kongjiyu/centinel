import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardScreen } from './DashboardScreen';
import { api } from '../api/client';
import type { AiProviderSetting, DynamicSession, Project, StaticSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listStaticSessions: vi.fn(),
    listDynamicSessions: vi.fn(),
    listArtifacts: vi.fn(),
    getIndexStatus: vi.fn(),
  },
}));

const project: Project = {
  id: 'project-1',
  name: 'Website refresh',
  description: 'Office website',
  workspacePath: 'C:/work/website-refresh',
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const settings: AiProviderSetting[] = [
  {
    id: 'text',
    label: 'Text AI',
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    hasApiKey: true,
    apiKeyPreview: '••••',
    baseUrl: '',
    model: 'mimo',
    updatedAt: project.updatedAt,
  },
  {
    id: 'vision',
    label: 'Vision AI',
    provider: 'gemini',
    apiFormat: 'google-native',
    hasApiKey: true,
    apiKeyPreview: '••••',
    baseUrl: '',
    model: 'gemini',
    updatedAt: project.updatedAt,
  },
];

const staticSession: StaticSession = {
  id: 'review-1',
  projectId: project.id,
  name: 'Release review',
  reviewType: 'code_review',
  status: 'success',
  configJson: '{}',
  progressJson: '{}',
  remarks: '',
  finalSummary: '',
  failureReason: '',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  baseRef: '',
  headRef: '',
  changedFilesJson: '[]',
  parentSessionId: '',
  reviewDiffJson: '',
  currentDecision: {
    id: 'decision-1',
    sessionId: 'review-1',
    projectId: project.id,
    decision: 'changes_requested',
    comment: 'Please address the form validation issue.',
    reviewer: 'Reviewer',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
};

const dynamicSession: DynamicSession = {
  id: 'test-1',
  projectId: project.id,
  type: 'dynamic',
  name: 'Checkout smoke test',
  status: 'failure',
  targetUrl: 'http://localhost:3000',
  goal: 'Complete checkout',
  missionType: 'smoke',
  browserMode: 'headed',
  maxSteps: 15,
  finalSummary: '',
  failureReason: 'Checkout could not be completed.',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T09:00:00.000Z',
};

describe('DashboardScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listStaticSessions).mockResolvedValue([staticSession]);
    vi.mocked(api.listDynamicSessions).mockResolvedValue([dynamicSession]);
    vi.mocked(api.listArtifacts).mockResolvedValue([
      {
        id: 'artifact-1',
        projectId: project.id,
        type: 'source_code',
        source: 'documents',
        fileName: 'app.ts',
        filePath: 'C:/work/website-refresh/app.ts',
        originalPath: null,
        contentHash: 'hash',
        createdAt: project.updatedAt,
      },
      {
        id: 'artifact-2',
        projectId: project.id,
        type: 'requirement',
        source: 'documents',
        fileName: 'requirements.md',
        filePath: 'C:/work/website-refresh/requirements.md',
        originalPath: null,
        contentHash: 'hash-2',
        createdAt: project.updatedAt,
      },
    ]);
    vi.mocked(api.getIndexStatus).mockResolvedValue({ status: 'ready', fileCount: 12 });
  });

  it('shows actionable highlights and direct quick-action routes', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardScreen
        projects={[project]}
        aiSettings={settings}
        onNavigate={onNavigate}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test failed' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Action required' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recommendations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent projects' })).toBeInTheDocument();
    expect(screen.getAllByText('Website refresh').length).toBeGreaterThan(0);
    expect(screen.getByText('Checkout could not be completed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /inspect/i })).toBeInTheDocument();

    expect(screen.queryByText('Why this is recommended')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /review current sources workflow/i })).not.toBeInTheDocument();

    const failedAction = screen.getAllByRole('article').find(item => item.textContent?.includes('Test failed'));
    if (!failedAction) throw new Error('Expected a failed action row');
    expect(failedAction).toHaveTextContent('Website refresh');
    expect(failedAction).toHaveTextContent('Dynamic Testing');
    expect(failedAction.querySelector('time')).toHaveAttribute('dateTime', dynamicSession.updatedAt);

    await user.click(screen.getByRole('button', { name: /open review: check consistency/i }));
    expect(onNavigate).toHaveBeenCalledWith({
      name: 'review-entry',
      projectId: project.id,
    });

    await user.click(screen.getByRole('button', { name: 'Next recommendation' }));
    await user.click(screen.getByRole('button', { name: 'Next recommendation' }));
    await user.click(screen.getByRole('button', { name: /open project: website refresh/i }));
    expect(onNavigate).toHaveBeenCalledWith({
      name: 'project-detail',
      projectId: project.id,
    });
  });

  it('shows recent projects as a comparable table with explicit activity navigation', async () => {
    render(
      <DashboardScreen
        projects={[project]}
        aiSettings={settings}
        onNavigate={() => {}}
      />,
    );

    const projectRow = await screen.findByRole('row', { name: /website refresh/i });
    expect(within(projectRow).queryByText('Office website')).not.toBeInTheDocument();
    expect(projectRow).toHaveTextContent('Release review');
    expect(projectRow).toHaveTextContent('Test failed');
    expect(projectRow).not.toHaveTextContent(/\d+ review/);
    expect(projectRow).not.toHaveTextContent(/\d+ dynamic/);
    expect(within(projectRow).getByText('Release review').closest('.project-activity-message')).toBeNull();
    expect(within(projectRow).getByText('Release review').closest('.project-activity-stack')).not.toBeNull();
    expect(within(projectRow).getByRole('button', { name: /open review for website refresh/i })).toBeInTheDocument();
  });

  it('keeps four varied project states comparable and carries the activity filter to Projects', async () => {
    const projects: Project[] = [
      { ...project, id: 'completed', name: 'Completed release', description: 'Approved review', updatedAt: '2026-09-04T10:00:00.000Z' },
      { ...project, id: 'running', name: 'Checkout journey', description: 'Live browser verification', updatedAt: '2026-09-03T10:00:00.000Z' },
      { ...project, id: 'blocked', name: 'Billing portal', description: 'Payment regression', updatedAt: '2026-09-02T10:00:00.000Z' },
      { ...project, id: 'new', name: 'Documentation site', description: 'New workspace', updatedAt: '2026-09-01T10:00:00.000Z' },
    ];
    const approvedReview: StaticSession = {
      ...staticSession,
      id: 'approved-review',
      projectId: 'completed',
      name: 'Release readiness',
      updatedAt: '2026-09-04T09:00:00.000Z',
      currentDecision: { ...staticSession.currentDecision!, id: 'approved-decision', sessionId: 'approved-review', projectId: 'completed', decision: 'approved' },
    };
    const runningTest: DynamicSession = {
      ...dynamicSession,
      id: 'running-test',
      projectId: 'running',
      name: 'Checkout journey',
      status: 'running',
      failureReason: '',
      updatedAt: '2026-09-03T09:00:00.000Z',
    };
    const blockedTest: DynamicSession = {
      ...dynamicSession,
      id: 'blocked-test',
      projectId: 'blocked',
      name: 'Payment verification',
      status: 'blocked',
      failureReason: 'The login step could not reach the billing page.',
      updatedAt: '2026-09-02T09:00:00.000Z',
    };
    vi.mocked(api.listStaticSessions).mockImplementation(async projectId => projectId === 'completed' ? [approvedReview] : []);
    vi.mocked(api.listDynamicSessions).mockImplementation(async projectId => {
      if (projectId === 'running') return [runningTest];
      if (projectId === 'blocked') return [blockedTest];
      return [];
    });
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

    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<DashboardScreen projects={projects} aiSettings={settings} onNavigate={onNavigate} />);

    const table = await screen.findByRole('table', { name: 'Recent projects' });
    expect(within(table).getByText('Completed')).toBeInTheDocument();
    expect(within(table).getByText('In progress')).toBeInTheDocument();
    expect(within(table).getByText('Test blocked')).toBeInTheDocument();
    expect(within(table).getByText('No activity')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(5);

    await user.click(screen.getByRole('combobox', { name: 'Activity type' }));
    await user.click(screen.getByRole('option', { name: 'Dynamic Testing' }));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).queryByText('Completed release')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /view more/i }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'projects', activityFilter: 'dynamic' });
  });

  it('opens the exact Static review that needs a decision', async () => {
    vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardScreen
        projects={[project]}
        aiSettings={settings}
        onNavigate={onNavigate}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /resolve/i }));
    expect(onNavigate).toHaveBeenCalledWith({
      name: 'review-activity',
      projectId: project.id,
      sessionId: staticSession.id,
    });
  });
});
