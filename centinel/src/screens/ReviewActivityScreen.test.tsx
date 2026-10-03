import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewActivityScreen } from './ReviewActivityScreen';
import type { Artifact, Finding, Project, Requirement, ReviewDecisionRecord, ReviewModelUsage, StaticSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    project: vi.fn(),
    getStaticSession: vi.fn(),
    listStaticFindings: vi.fn(),
    listReviewDecisions: vi.fn(),
    getReviewDecisionAttachmentDownload: vi.fn(),
    submitReviewDecision: vi.fn(),
    cancelStaticSession: vi.fn(),
    retryStaticSession: vi.fn(),
    listStaticSessions: vi.fn(),
    startPreparedReviewIteration: vi.fn(),
    getReviewEvidenceSufficiency: vi.fn(),
    saveContradictionDisposition: vi.fn(),
    getReviewCorrelations: vi.fn(),
    getReviewModelUsage: vi.fn(),
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
  artifactId: 'artifact-1',
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

const reviewUsage: ReviewModelUsage = {
  totals: { input: 1024, output: 256, cacheRead: 128, cacheCreation: 64, calls: 3 },
  byGroup: [{
    provider: 'mimo',
    apiFormat: 'openai-compatible',
    model: 'gpt-review',
    totalInput: 1024,
    totalOutput: 256,
    totalCacheRead: 128,
    totalCacheCreation: 64,
    totalCalls: 3,
  }],
  recent: [],
};

function setup(session: StaticSession = baseSession, decisions: ReviewDecisionRecord[] = []) {
  vi.mocked(api.project).mockResolvedValue(project);
  vi.mocked(api.getStaticSession).mockResolvedValue(session);
  vi.mocked(api.listStaticFindings).mockResolvedValue([finding]);
  vi.mocked(api.listReviewDecisions).mockResolvedValue(decisions);
  vi.mocked(api.submitReviewDecision).mockResolvedValue({ ...approvedDecision, decision: 'changes_requested' });
  vi.mocked(api.getReviewModelUsage).mockResolvedValue(reviewUsage);
  vi.mocked(api.retryStaticSession).mockResolvedValue({ ...session, id: `${session.id}-retry`, status: 'queued' });
  vi.mocked(api.listStaticSessions).mockResolvedValue([session]);
  vi.mocked(api.startPreparedReviewIteration).mockResolvedValue({ ...session, id: 'review-child', status: 'queued', parentSessionId: session.id });
  vi.mocked(api.getReviewEvidenceSufficiency).mockRejectedValue(new Error('not captured'));
  vi.mocked(api.saveContradictionDisposition).mockResolvedValue({ contradictionId: 'a'.repeat(64), decision: 'authoritative_left', rationale: 'Approved source is authoritative.', actorId: 'reviewer-1', updatedAt: '2026-09-23T00:00:00Z' });
  vi.mocked(api.getReviewCorrelations).mockRejectedValue(new Error('not an iteration'));
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
    expect(screen.queryByRole('button', { name: 'Retry review' })).not.toBeInTheDocument();
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

  it('opens Request Changes with an explicit frozen-source choice and no model execution', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByTestId('review-decision-reject'));
    const panel = screen.getByRole('complementary', { name: 'Request changes' });
    expect(within(panel).getByRole('radio', { name: 'Reuse the frozen source manifest' })).toBeChecked();
    expect(within(panel).getByText(/will not call a model until you explicitly start it/i)).toBeInTheDocument();
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
  });

  it('retrieves a fresh private download link for recorded decision feedback', async () => {
    const user = userEvent.setup();
    setup(baseSession, [{ ...approvedDecision, attachments: [{ id: 'attachment-1', fileName: 'notes.md', mimeType: 'text/markdown', createdAt: '2026-09-07T10:04:00.000Z' }] }]);
    vi.mocked(api.getReviewDecisionAttachmentDownload).mockResolvedValue({
      id: 'attachment-1', fileName: 'notes.md', signedUrl: 'https://storage.example.test/notes.md', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Get download link for notes.md' }));

    expect(api.getReviewDecisionAttachmentDownload).toHaveBeenCalledWith(project.id, baseSession.id, approvedDecision.id, 'attachment-1');
    expect(await screen.findByRole('link', { name: 'Download notes.md' })).toHaveAttribute('href', 'https://storage.example.test/notes.md');
  });

  it('keeps attachment retrieval recoverable after a signed-link failure', async () => {
    const user = userEvent.setup();
    setup(baseSession, [{ ...approvedDecision, attachments: [{ id: 'attachment-1', fileName: 'notes.md', mimeType: 'text/markdown', createdAt: '2026-09-07T10:04:00.000Z' }] }]);
    vi.mocked(api.getReviewDecisionAttachmentDownload)
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce({ id: 'attachment-1', fileName: 'notes.md', signedUrl: 'https://storage.example.test/notes.md', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const button = screen.getByRole('button', { name: 'Get download link for notes.md' });
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not prepare the download link. Try again.');
    expect(screen.queryByRole('link', { name: 'Download notes.md' })).not.toBeInTheDocument();

    await user.click(button);
    expect(await screen.findByRole('link', { name: 'Download notes.md' })).toHaveAttribute('href', 'https://storage.example.test/notes.md');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps earlier recorded feedback visible beyond the latest three decisions', async () => {
    const decisions = Array.from({ length: 4 }, (_, index) => ({
      ...approvedDecision,
      id: `decision-${index + 1}`,
      comment: `Decision note ${index + 1}`,
    }));
    setup(baseSession, decisions);
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText('Decision note 4')).toBeInTheDocument();
  });

  it('loads older decision history beyond the first 50 records', async () => {
    const user = userEvent.setup();
    const records = Array.from({ length: 51 }, (_, index) => ({
      ...approvedDecision, id: `decision-${index + 1}`, decision: 'commented' as const,
      comment: `Decision note ${index + 1}`,
    }));
    setup();
    vi.mocked(api.listReviewDecisions).mockResolvedValueOnce(records.slice(0, 50)).mockResolvedValueOnce(records.slice(50));
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Load older decisions' }));
    expect(await screen.findByText('Decision note 51')).toBeInTheDocument();
    expect(api.listReviewDecisions).toHaveBeenLastCalledWith(project.id, baseSession.id, 50, 50);
    expect(screen.queryByRole('button', { name: 'Load older decisions' })).not.toBeInTheDocument();
  });

  it('lets the reviewer retry loading older decisions after a page failure', async () => {
    const user = userEvent.setup();
    const records = Array.from({ length: 50 }, (_, index) => ({
      ...approvedDecision, id: `decision-${index + 1}`, decision: 'commented' as const,
      comment: `Decision note ${index + 1}`,
    }));
    setup();
    vi.mocked(api.listReviewDecisions).mockResolvedValueOnce(records).mockRejectedValueOnce(new Error('Temporary outage')).mockResolvedValueOnce([]);
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const loadMore = screen.getByRole('button', { name: 'Load older decisions' });
    await user.click(loadMore);
    expect(await screen.findByRole('alert')).toHaveTextContent('Older decisions could not be loaded');
    await user.click(loadMore);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Load older decisions' })).not.toBeInTheDocument();
    expect(api.listReviewDecisions).toHaveBeenLastCalledWith(project.id, baseSession.id, 50, 50);
  });

  it('shows actionable evidence gaps and a persisted iteration comparison', async () => {
    vi.mocked(api.getReviewEvidenceSufficiency).mockResolvedValue({
      id: 'assessment-1', reviewId: baseSession.id, projectId: project.id, reviewType: 'code_review', readiness: 'blocked',
      gaps: [{ id: 'gap-1', code: 'source_inaccessible', severity: 'blocking', title: 'Source is inaccessible', detail: 'Repository access expired.', remediation: 'Reconnect GitHub and refresh the source.', affectedStages: ['source_freeze'] }],
      contradictions: [], artifactCount: 2, availableArtifactCount: 1, staleArtifactCount: 0, confirmedRequirementCount: 1, enabledStandardRuleCount: 2, assessedAt: '2026-09-07T10:00:00.000Z',
    });
    vi.mocked(api.getReviewCorrelations).mockResolvedValue({
      parentReviewId: 'review-parent', childReviewId: baseSession.id, correlations: [], ambiguities: [],
      counts: { new: 1, recurring: 2, carried_over: 0, resolved: 3, regressed: 1 }, createdAt: '2026-09-07T10:01:00.000Z',
    });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence blocks this review');
    expect(screen.getByText(/Next: Reconnect GitHub and refresh the source/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Changes since parent review' })).toBeInTheDocument();
    expect(screen.getByText('regressed').nextSibling).toHaveTextContent('1');
  });

  it('records an attributable decision for a blocked evidence conflict', async () => {
    const user = userEvent.setup();
    const blocked = { ...baseSession, status: 'blocked' as const };
    setup(blocked);
    vi.mocked(api.getReviewEvidenceSufficiency).mockResolvedValue({
      id: 'assessment-2', reviewId: blocked.id, projectId: project.id, reviewType: 'code_review', readiness: 'blocked',
      gaps: [{ id: 'gap-2', code: 'contradictory_evidence', severity: 'blocking', title: 'Conflicting evidence needs review', detail: 'Claims disagree.', remediation: 'Resolve the conflict.', affectedStages: ['model_analysis'] }],
      contradictions: [{ id: 'a'.repeat(64), left: { id: 'left', text: 'Access must require authentication.', locator: { filePath: 'requirements.md', lineStart: 5 } }, right: { id: 'right', text: 'Access must not require authentication.', locator: { filePath: 'design.md', lineStart: 9 } }, detail: 'Opposite polarity.', affectedStages: ['model_analysis'] }],
      artifactCount: 2, availableArtifactCount: 2, staleArtifactCount: 0, confirmedRequirementCount: 1, enabledStandardRuleCount: 0, assessedAt: '2026-09-23T00:00:00Z',
    });
    render(<ReviewActivityScreen projectId={project.id} sessionId={blocked.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Conflict 1' });
    await user.click(screen.getByRole('radio', { name: 'Claim A is authoritative' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason for this decision' }), 'Approved source is authoritative.');
    await user.click(screen.getByRole('button', { name: 'Save evidence decision' }));
    await waitFor(() => expect(api.saveContradictionDisposition).toHaveBeenCalledWith(project.id, blocked.id, 'a'.repeat(64), { decision: 'authoritative_left', rationale: 'Approved source is authoritative.' }));
    expect(screen.getByText(/Retry the review to reassess/i)).toBeInTheDocument();
  });

  it('starts a prepared child only after the reviewer presses Start revised review', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const prepared = { ...baseSession, id: 'review-child', status: 'prepared' as const, parentSessionId: baseSession.id };
    vi.mocked(api.listStaticSessions).mockResolvedValue([baseSession, prepared]);
    vi.mocked(api.startPreparedReviewIteration).mockResolvedValue({ ...prepared, status: 'queued' });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);

    await user.click(await screen.findByRole('button', { name: 'Start revised review' }));
    expect(api.startPreparedReviewIteration).toHaveBeenCalledWith(project.id, prepared.id, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(navigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: prepared.id, reviewName: prepared.name });
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
    expect(screen.queryByRole('tab', { name: 'Source' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1].id);

    await user.click(tabs[0]);
    expect(screen.queryByRole('button', { name: 'Export review report' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('table', { name: 'Review findings' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Risk' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'High' })).toBeInTheDocument();
  });

  it('shows provider-reported model usage for the review without exposing credentials', async () => {
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Model usage' })).toBeInTheDocument();
    const usage = screen.getByRole('region', { name: 'Model usage' });
    expect(within(usage).getByText(text => text.replace(/\D/g, '') === '1024')).toBeInTheDocument();
    expect(within(usage).getByText('Input tokens')).toBeInTheDocument();
    expect(within(usage).getByText('256')).toBeInTheDocument();
    expect(within(usage).getByText(/gpt-review/)).toBeInTheDocument();
    expect(screen.queryByText(/api key/i)).not.toBeInTheDocument();
  });

  it('offers Retry only for a failed review and opens the child review', async () => {
    const user = userEvent.setup();
    const failed = { ...baseSession, status: 'failure' as const, failureReason: 'The provider timed out.' };
    const child = { ...baseSession, id: 'review-2', name: 'Release review retry', status: 'queued' as const };
    setup(failed);
    vi.mocked(api.retryStaticSession).mockResolvedValue(child);
    const onNavigate = vi.fn();
    render(<ReviewActivityScreen projectId={project.id} sessionId={failed.id} onNavigate={onNavigate} />);

    const retry = await screen.findByRole('button', { name: 'Retry review' });
    expect(screen.queryByRole('button', { name: 'Cancel review' })).not.toBeInTheDocument();
    await user.click(retry);

    await waitFor(() => expect(api.retryStaticSession).toHaveBeenCalledWith(project.id, failed.id, { refreshSourceManifest: false }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: child.id, reviewName: child.name });
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
    expect(within(table).queryByRole('columnheader', { name: 'Findings' })).not.toBeInTheDocument();
    expect(within(table).getByText('Complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open finding #finding-1: Checkout requirement is not represented' })).toBeInTheDocument();
  });

  it('opens Traceability with incomplete and missing requirements selected from the overview', async () => {
    const requirement: Requirement = {
      id: 'requirement-1',
      projectId: project.id,
      title: 'Checkout must be protected',
      description: 'The checkout route requires authorization.',
      category: 'Security',
      priority: 'High',
      createdAt: '2026-09-07T10:00:00.000Z',
    };
    vi.mocked(api.listRequirements).mockResolvedValue([requirement]);
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review Overview' });
    await user.click(screen.getByRole('button', { name: 'View incomplete and missing requirements in Traceability' }));

    expect(screen.getByRole('tab', { name: 'Traceability' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Traceability state' })).toHaveTextContent('Incomplete and missing');
    expect(screen.getAllByText('Missing')).not.toHaveLength(0);
  });
});
