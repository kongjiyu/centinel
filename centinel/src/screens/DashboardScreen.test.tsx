import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardScreen } from './DashboardScreen';
import { api } from '../api/client';
import type { AiProviderSetting, DynamicSession, Project, StaticSession } from '../types';
import type { DynamicRun, MissionRevision } from '../dynamic/types';

vi.mock('../api/client', () => ({
  api: {
    listStaticSessions: vi.fn(),
    listDynamicSessions: vi.fn(),
    dynamicRuns: vi.fn(),
    listArtifacts: vi.fn(), getSourcePresence: vi.fn(),
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
    vi.mocked(api.dynamicRuns).mockResolvedValue([]);
    vi.mocked(api.getSourcePresence).mockResolvedValue({ hasSources: true });
  });

  it('does not label an uncertain independent result as a failed application test', async () => {
    vi.mocked(api.listDynamicSessions).mockResolvedValue([{ ...dynamicSession, failureReason: 'Independent checks: uncertain' }]);
    render(<DashboardScreen projects={[project]} aiSettings={settings} onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByText('Independent checks: uncertain')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Failed' })).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /good (morning|afternoon|evening)/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Action required' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recommendations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent projects' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quick actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dynamic Testing' })).toBeInTheDocument();
    const rightRail = document.querySelector('.home-right-rail');
    const recommendations = document.querySelector('.recommendations-panel');
    const quickActions = document.querySelector('.quick-actions-grid');
    expect(rightRail).toContainElement(screen.getByRole('button', { name: 'Create project' }));
    expect(recommendations).not.toBeNull();
    expect(quickActions).not.toBeNull();
    expect(recommendations!.compareDocumentPosition(quickActions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('Website refresh').length).toBeGreaterThan(0);
    expect(screen.getByText('Checkout could not be completed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /inspect/i })).toBeInTheDocument();

    expect(screen.queryByText('Why this is recommended')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /review current sources workflow/i })).not.toBeInTheDocument();

    const failedAction = screen.getAllByRole('article').find(item => item.textContent?.includes('Needs attention'));
    if (!failedAction) throw new Error('Expected a failed action row');
    expect(failedAction).toHaveTextContent('Website refresh');
    expect(failedAction).toHaveTextContent('Dynamic Testing');
    expect(failedAction.querySelector('time')).toHaveAttribute('dateTime', dynamicSession.updatedAt);

    await user.click(screen.getByRole('button', { name: /open review: check consistency/i }));
    expect(onNavigate).toHaveBeenCalledWith({
      name: 'review-entry',
      projectId: project.id,
    });

    const nextRecommendation = screen.getByRole('button', { name: 'Next recommendation' });
    await user.click(nextRecommendation);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    await user.click(nextRecommendation);
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open project: website refresh/i }));
    expect(onNavigate).toHaveBeenCalledWith({
      name: 'project-detail',
      projectId: project.id,
    });
  });

  it('shows dashboard recent projects without directory actions and opens overview by row', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardScreen
        projects={[project]}
        aiSettings={settings}
        onNavigate={onNavigate}
      />,
    );

    const projectRow = await screen.findByRole('row', { name: /website refresh/i });
    expect(within(projectRow).queryByText('Office website')).not.toBeInTheDocument();
    expect(projectRow).toHaveTextContent('Release review');
    expect(projectRow).toHaveTextContent('Needs attention');
    expect(projectRow).not.toHaveTextContent(/\d+ review/);
    expect(projectRow).not.toHaveTextContent(/\d+ dynamic/);
    expect(within(projectRow).getByText('Release review').closest('.project-activity-message')).toBeNull();
    expect(within(projectRow).getByText('Release review').closest('.project-activity-stack')).not.toBeNull();
    expect(within(projectRow).queryByRole('button')).not.toBeInTheDocument();
    await user.click(projectRow);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'project-detail', projectId: project.id });
  });

  it('wraps recommendation navigation and supports keyboard project activation', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<DashboardScreen projects={[project]} aiSettings={settings} onNavigate={onNavigate} />);

    const previousRecommendation = await screen.findByRole('button', { name: 'Previous recommendation' });
    await user.click(previousRecommendation);
    expect(screen.getByText('3 of 3')).toBeInTheDocument();

    const projectRow = screen.getByRole('row', { name: /website refresh/i });
    projectRow.focus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith({ name: 'project-detail', projectId: project.id });
  });

  it('keeps four varied project states comparable and opens an unfiltered Projects directory', async () => {
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
    vi.mocked(api.getSourcePresence).mockResolvedValue({ hasSources: true });

    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<DashboardScreen projects={projects} aiSettings={settings} onNavigate={onNavigate} />);

    const table = await screen.findByRole('table', { name: 'Recent projects' });
    expect(within(table).getByText('Completed')).toBeInTheDocument();
    expect(within(table).getByText('In progress')).toBeInTheDocument();
    expect(within(table).getByText('Needs attention')).toBeInTheDocument();
    expect(within(table).getByText('No activity')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: /view more/i }));
    expect(screen.queryByRole('combobox', { name: 'Activity type' })).not.toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledWith({ name: 'projects' });
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
      reviewName: staticSession.name,
    });
  });

  describe('shared Dynamic Runs', () => {
    const revision = { id: 'revision-2', missionId: 'mission-1', revision: 2, name: 'Demo todo add', goal: "First log in with username 'demo' and password 'demo'.", targetUrl: 'http://localhost:37702/', maxSteps: 15, checks: [] } as unknown as MissionRevision;
    const sharedRun = (patch: Partial<DynamicRun>): DynamicRun => ({
      id: 'run-passed', projectId: project.id, missionId: 'mission-1', revision, idempotencyKey: 'key', createdBy: 'actor',
      createdAt: '2026-10-29T04:14:12.000Z', updatedAt: '2026-10-29T04:14:48.000Z', state: 'completed', verdict: 'passed',
      reason: null, checks: [], evidence: [], legacySessionId: 'local-passed', ...patch,
    });
    const blockedRun = sharedRun({ id: 'run-blocked', state: 'blocked', verdict: 'not_tested', reason: 'No interactions are approved.', legacySessionId: 'local-blocked', createdAt: '2026-10-29T04:11:05.000Z', updatedAt: '2026-10-29T04:11:40.000Z' });
    const localMirror = (id: string): DynamicSession => ({ ...dynamicSession, id, name: "Journey: First log in with username 'demo' and password 'de", status: 'blocked', updatedAt: '2026-10-29T04:14:48.000Z' });

    beforeEach(() => {
      vi.mocked(api.listStaticSessions).mockResolvedValue([]);
      vi.mocked(api.listDynamicSessions).mockResolvedValue([localMirror('local-passed'), localMirror('local-blocked')]);
    });

    it('shows the latest shared Run with its verified state instead of its local mirror', async () => {
      vi.mocked(api.dynamicRuns).mockResolvedValue([blockedRun, sharedRun({})]);
      render(<DashboardScreen projects={[project]} aiSettings={settings} onNavigate={vi.fn()} />);

      const table = await screen.findByRole('table', { name: 'Recent projects' });
      await waitFor(() => expect(table).toHaveTextContent('Demo todo add'));
      expect(table).toHaveTextContent('Completed');
      expect(table).not.toHaveTextContent('Journey:');
      expect(table).not.toHaveTextContent('Needs attention');
      expect(screen.getByText('Nothing needs your attention.')).toBeInTheDocument();
    });

    it('shows Runs recorded on another device and opens the Run result', async () => {
      vi.mocked(api.listDynamicSessions).mockResolvedValue([]);
      vi.mocked(api.dynamicRuns).mockResolvedValue([sharedRun({ state: 'blocked', verdict: 'not_tested', reason: 'No interactions are approved.' })]);
      const onNavigate = vi.fn();
      const user = userEvent.setup();
      render(<DashboardScreen projects={[project]} aiSettings={settings} onNavigate={onNavigate} />);

      expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /inspect/i }));
      expect(onNavigate).toHaveBeenCalledWith({ name: 'dynamic-testing', projectId: project.id, runId: 'run-passed' });
    });
  });
});
