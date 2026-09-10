import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewActivityScreen } from './ReviewActivityScreen';
import type { Finding, Project, ReviewDecisionRecord, StaticSession } from '../types';

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
}

describe('ReviewActivityScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it('renders a sticky objective and the review stages as a conversation', async () => {
    const running = { ...baseSession, status: 'running' as const };
    setup(running);
    render(<ReviewActivityScreen projectId={project.id} sessionId={running.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Review activity' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Review objective' })).toHaveTextContent('Check traceability');
    expect(screen.getByRole('group', { name: 'Supportive documents' })).toHaveTextContent('checkout-requir…');
    expect(screen.getByRole('list', { name: 'Centinel review stages' })).toBeInTheDocument();
    expect(screen.getByText('Loaded project sources')).toBeInTheDocument();
    expect(screen.queryByTestId('review-decision-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-decision-reject')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate findings')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Feedback' })).toBeInTheDocument();
  });

  it('records feedback from the fixed composer without changing review state', async () => {
    const user = userEvent.setup();
    const running = { ...baseSession, status: 'running' as const };
    setup(running);
    render(<ReviewActivityScreen projectId={project.id} sessionId={running.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review activity' });
    await user.type(screen.getByRole('textbox', { name: 'Feedback' }), 'Please verify the empty state.');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(api.submitReviewDecision).toHaveBeenCalledWith(project.id, running.id, {
      decision: 'commented',
      comment: 'Please verify the empty state.',
      attachments: [],
    });
  });

  it('submits attached supportive documents with review feedback', async () => {
    const user = userEvent.setup();
    const running = { ...baseSession, status: 'running' as const };
    setup(running);
    render(<ReviewActivityScreen projectId={project.id} sessionId={running.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review activity' });
    const document = new File(['support'], 'release-notes.md', { type: 'text/markdown' });
    await user.upload(screen.getByLabelText('Attach supportive documents'), document);
    expect(within(screen.getByRole('group', { name: 'Attached supportive documents' })).getByRole('button', { name: 'Remove release-notes.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(api.submitReviewDecision).toHaveBeenCalledWith(project.id, running.id, {
        decision: 'commented',
        comment: '',
        attachments: [{ fileName: 'release-notes.md', mimeType: 'text/markdown', content: 'c3VwcG9ydA==' }],
      }));
  });

  it('opens direct review decisions from the activity action region, not the header', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Evidence ready for human review' });
    const actions = screen.getByRole('region', { name: 'Review decision actions' });
    await user.click(within(actions).getByRole('button', { name: 'Approve review' }));
    expect(screen.getByRole('complementary', { name: 'Approve review' })).toBeInTheDocument();
  });

  it('requires feedback for request-changes and does not claim automatic reprocessing', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Evidence ready for human review' });
    await user.click(screen.getByTestId('review-decision-reject'));
    const panel = screen.getByRole('complementary', { name: 'Request changes' });
    await user.click(within(panel).getByRole('button', { name: 'Request changes' }));
    expect(within(panel).getByRole('textbox', { name: /Feedback/ })).toBeRequired();
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
    expect(screen.getByText(/does not resolve, dismiss, or automatically reprocess/i)).toBeInTheDocument();
  });

  it('uses accessible result tabs and exports through the existing session API', async () => {
    const user = userEvent.setup();
    const completed = { ...baseSession, currentDecision: approvedDecision };
    setup(completed, [approvedDecision]);
    render(<ReviewActivityScreen projectId={project.id} sessionId={completed.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Review completed' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Risk Assessment' })).not.toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1].id);

    await user.click(tabs[0]);
    await user.click(screen.getByRole('button', { name: 'Export review report' }));
    expect(api.exportSessionReport).toHaveBeenCalledWith(project.id, completed.id);
    expect(await screen.findByText(/Report saved to C:\/reports\/review\.md/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('table', { name: 'Review findings' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: 'High' })).toHaveLength(2);
  });
});
