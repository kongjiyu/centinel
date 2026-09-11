import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewActivityScreen } from './ReviewActivityScreen';
import type { Artifact, Finding, Project, Requirement, ReviewDecisionRecord, StaticSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    project: vi.fn(),
    getStaticSession: vi.fn(),
    listStaticFindings: vi.fn(),
    listReviewDecisions: vi.fn(),
    submitReviewDecision: vi.fn(),
    cancelStaticSession: vi.fn(),
    exportSessionReport: vi.fn(),
    listReviewArtifacts: vi.fn(),
    listRequirements: vi.fn(),
    listArtifacts: vi.fn(),
    listRequirementMappings: vi.fn(),
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

const progress = JSON.stringify({
  currentStage: 'summarizing',
  stages: [
    { id: 'understanding_context', label: 'Understanding Context', status: 'done', thoughts: ['Loaded project sources'], summary: 'Context understood' },
    { id: 'code_review', label: 'Code Review', status: 'done', thoughts: ['Compared implementation'], summary: 'Facts gathered' },
    { id: 'requirement_validation', label: 'Requirement Validation', status: 'done', thoughts: ['Checked requirement links'], summary: 'Connections reviewed' },
    { id: 'summarizing', label: 'Summarizing Findings', status: 'done', thoughts: ['Prepared candidate findings'], summary: 'Review complete' },
  ],
  startedAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:01:00.000Z',
});

const baseSession: StaticSession = {
  id: 'review-1',
  projectId: project.id,
  name: 'Release review',
  reviewType: 'code_review',
  status: 'success',
  configJson: JSON.stringify({
    instructions: 'Check traceability',
    supportiveDocuments: [
      { id: 'support-1', name: 'checkout-requirements.md' },
      { id: 'support-2', name: 'release-acceptance-criteria.pdf' },
    ],
  }),
  progressJson: progress,
  remarks: '',
  finalSummary: 'The recorded evidence was reviewed.',
  failureReason: '',
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:01:00.000Z',
  baseRef: '',
  headRef: '',
  changedFilesJson: '[]',
  parentSessionId: '',
  reviewDiffJson: '',
  currentDecision: null,
};

const finding: Finding = {
  id: 'finding-1',
  projectId: project.id,
  sessionId: baseSession.id,
  source: 'static',
  severity: 'high',
  priority: 'High',
  title: 'Checkout requirement is not represented',
  description: 'The reviewed implementation does not expose the requirement in the available evidence.',
  status: 'new',
  createdAt: '2026-09-07T10:01:00.000Z',
  artifactId: null,
  category: 'Traceability',
  evidenceText: 'src/checkout.ts:12',
  recommendation: 'Add the requirement mapping.',
  confidence: 'medium',
  fromRemarks: false,
  filePath: 'src/checkout.ts',
  lineNumber: 12,
};

const approvedDecision: ReviewDecisionRecord = {
  id: 'decision-1',
  sessionId: baseSession.id,
  projectId: project.id,
  decision: 'approved',
  comment: 'Reviewed the available evidence.',
  reviewer: 'Current user',
  createdAt: '2026-09-07T10:04:00.000Z',
};

function setup(session: StaticSession = baseSession, decisions: ReviewDecisionRecord[] = []) {
  vi.mocked(api.project).mockResolvedValue(project);
  vi.mocked(api.getStaticSession).mockResolvedValue(session);
  vi.mocked(api.listStaticFindings).mockResolvedValue([finding]);
  vi.mocked(api.listReviewDecisions).mockResolvedValue(decisions);
  vi.mocked(api.submitReviewDecision).mockResolvedValue({ ...approvedDecision, decision: 'changes_requested' });
  vi.mocked(api.exportSessionReport).mockResolvedValue({ reportPath: 'C:/reports/review.md' });
  vi.mocked(api.listReviewArtifacts).mockResolvedValue([]);
  vi.mocked(api.listRequirements).mockResolvedValue([]);
  vi.mocked(api.listArtifacts).mockResolvedValue([]);
  vi.mocked(api.listRequirementMappings).mockResolvedValue([]);
}

describe('ReviewActivityScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    setup();
  });

  it('renders the activity stages without a duplicate information rail while running', async () => {
    const running = { ...baseSession, status: 'running' as const };
    setup(running);
    render(<ReviewActivityScreen projectId={project.id} sessionId={running.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Review activity' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Review information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Supportive documents' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Review stages' })).toBeInTheDocument();
    expect(screen.getByText('Loaded project sources')).toBeInTheDocument();
    expect(screen.queryByTestId('review-decision-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-decision-reject')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate findings')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write feedback about this review' })).not.toBeInTheDocument();
  });

  it('only exposes cancel while the review is running', async () => {
    const running = { ...baseSession, status: 'running' as const };
    setup(running);
    render(<ReviewActivityScreen projectId={project.id} sessionId={running.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review activity' });
    expect(screen.getByRole('button', { name: 'Cancel review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument();
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
  });

  it('submits attached supportive documents with review feedback', async () => {
    const user = userEvent.setup();
    const approvalSession = baseSession;
    setup(approvalSession);
    render(<ReviewActivityScreen projectId={project.id} sessionId={approvalSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const document = new File(['support'], 'release-notes.md', { type: 'text/markdown' });
    await user.upload(screen.getByLabelText('Attach supportive documents'), document);
    expect(within(screen.getByRole('group', { name: 'Attached supportive documents' })).getByRole('button', { name: 'Remove release-notes.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(api.submitReviewDecision).toHaveBeenCalledWith(project.id, approvalSession.id, {
        decision: 'commented',
        comment: '',
        attachments: [{ fileName: 'release-notes.md', mimeType: 'text/markdown', content: 'c3VwcG9ydA==' }],
      }));
  });

  it('opens direct review decisions from the header action region', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    const actions = screen.getByRole('region', { name: 'Review decision actions' });
    await user.click(within(actions).getByRole('button', { name: 'Approve review' }));
    expect(screen.getByRole('complementary', { name: 'Approve review' })).toBeInTheDocument();
  });

  it('keeps decision actions available while the reviewer inspects evidence tabs', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('table', { name: 'Review findings' })).toBeInTheDocument();
    expect(screen.getByTestId('review-decision-approve')).toBeEnabled();

    await user.click(screen.getByRole('tab', { name: 'Traceability' }));
    expect(screen.getByRole('heading', { name: 'Traceability' })).toBeInTheDocument();
    expect(screen.getByTestId('review-decision-approve')).toBeEnabled();
  });

  it('routes request-changes to Activity and focuses the feedback composer without opening a modal', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByTestId('review-decision-reject'));
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('complementary', { name: 'Request changes' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Write feedback about this review' })).toHaveFocus());
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
  });

  it('uses accessible result tabs and the shared project findings workspace', async () => {
    const user = userEvent.setup();
    const completed = { ...baseSession, currentDecision: approvedDecision };
    setup(completed, [approvedDecision]);
    render(<ReviewActivityScreen projectId={project.id} sessionId={completed.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Review Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review objective' })).not.toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Risk Assessment' })).not.toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1].id);

    await user.click(tabs[0]);
    expect(screen.queryByRole('button', { name: 'Export review report' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('table', { name: 'Review findings' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'High' })).toBeInTheDocument();
  });

  it('presents traceability findings as IDs and one derived state column', async () => {
    const requirement: Requirement = {
      id: 'requirement-1',
      projectId: project.id,
      title: 'Checkout must be protected',
      description: 'The checkout route requires authorization.',
      category: 'Security',
      priority: 'High',
      createdAt: '2026-09-07T10:00:00.000Z',
    };
    const artifact: Artifact = {
      id: 'artifact-1',
      projectId: project.id,
      type: 'source_code',
      source: 'repository',
      fileName: 'checkout.ts',
      filePath: 'src/checkout.ts',
      originalPath: 'src/checkout.ts',
      contentHash: 'hash',
      createdAt: '2026-09-07T10:00:00.000Z',
    };
    vi.mocked(api.listRequirements).mockResolvedValue([requirement]);
    vi.mocked(api.listArtifacts).mockResolvedValue([artifact]);
    vi.mocked(api.listRequirementMappings).mockResolvedValue([{
      id: 'mapping-1',
      requirementId: requirement.id,
      fileId: artifact.id,
      symbolId: null,
      coverageStatus: 'complete',
      confidence: 0.95,
    }]);
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Traceability' }));
    const table = screen.getByRole('table', { name: 'Traceability matrix' });
    expect(within(table).getByRole('columnheader', { name: 'State' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Completeness' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Correctness' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Consistency' })).not.toBeInTheDocument();
    expect(within(table).getByText('Complete')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Open finding #finding-1: Checkout requirement is not represented' })).toBeInTheDocument();
  });
});
