import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewActivityScreen } from './ReviewActivityScreen';
import type { Artifact, Finding, Project, Requirement, ReviewDecisionRecord, ReviewModelUsage, ReviewSourceManifest, ReviewTraceabilitySnapshot, StaticSession } from '../types';

vi.mock('@tauri-apps/api/dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/api/fs', () => ({ writeTextFile: vi.fn() }));

vi.mock('../api/client', () => ({
  api: {
    project: vi.fn(),
    exportProjectReport: vi.fn(),
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
    getReviewSourceManifest: vi.fn(),
    getReviewTraceability: vi.fn(),
    getReviewArtifactContent: vi.fn(),
    saveContradictionDisposition: vi.fn(),
    getReviewCorrelations: vi.fn(),
    getReviewModelUsage: vi.fn(),
    getReviewHarness: vi.fn(),
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
  verifier: 'model',
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
  vi.mocked(api.listStaticFindings).mockResolvedValue([{ ...finding, sessionId: session.id }]);
  vi.mocked(api.listReviewDecisions).mockResolvedValue(decisions);
  vi.mocked(api.submitReviewDecision).mockResolvedValue(approvedDecision);
  vi.mocked(api.getReviewModelUsage).mockResolvedValue(reviewUsage);
  vi.mocked(api.getReviewHarness).mockRejectedValue(new Error('Trace not recorded'));
  vi.mocked(api.retryStaticSession).mockResolvedValue({ ...session, id: `${session.id}-retry`, status: 'queued' });
  vi.mocked(api.listStaticSessions).mockResolvedValue([session]);
  vi.mocked(api.startPreparedReviewIteration).mockResolvedValue({ ...session, id: 'review-child', status: 'queued', parentSessionId: session.id });
  vi.mocked(api.getReviewEvidenceSufficiency).mockRejectedValue(new Error('not captured'));
  vi.mocked(api.getReviewSourceManifest).mockResolvedValue({ projectId: project.id, sessionId: session.id, status: 'unavailable', sources: [], artifactCount: null });
  vi.mocked(api.getReviewTraceability).mockResolvedValue({ projectId: project.id, sessionId: session.id, status: 'unavailable', records: [], summary: null });
  vi.mocked(api.saveContradictionDisposition).mockResolvedValue({ contradictionId: 'a'.repeat(64), decision: 'authoritative_left', rationale: 'Approved source is authoritative.', actorId: 'reviewer-1', updatedAt: '2026-09-23T00:00:00Z' });
  vi.mocked(api.getReviewCorrelations).mockRejectedValue(new Error('not an iteration'));
  vi.mocked(api.listRequirements).mockResolvedValue([]);
  vi.mocked(api.listArtifacts).mockResolvedValue([]);
  vi.mocked(api.listRequirementMappings).mockResolvedValue([]);
}

function availableManifest(sessionId: string, projectId = project.id): ReviewSourceManifest {
  return { projectId, sessionId, status: 'available', sources: [], artifactCount: 0, artifacts: [] };
}

function availableTraceability(sessionId: string, projectId = project.id, records: ReviewTraceabilitySnapshot['records'] = []): ReviewTraceabilitySnapshot {
  const counts = { complete: 0, incomplete: 0, missing: 0, attention: 0 };
  for (const record of records) {
    counts[record.state] += 1;
    if (record.state !== 'complete') counts.attention += 1;
  }
  return { projectId, sessionId, status: 'available', records, summary: counts };
}

describe('ReviewActivityScreen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    setup();
  });

  it('reopens the same Review on focus after the local service returns', async () => {
    vi.mocked(api.getStaticSession).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const navigate = vi.fn();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the local service');
    fireEvent.focus(window);

    expect(await screen.findByLabelText('Review metrics')).toBeInTheDocument();
    expect(api.getStaticSession).toHaveBeenLastCalledWith(project.id, baseSession.id);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the saved source inventory off the Overview', async () => {
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue({ ...availableManifest(baseSession.id), artifactCount: 2, artifacts: undefined });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    const metrics = await screen.findByLabelText('Review metrics');
    expect(within(metrics).queryByText('Sources in scope')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Review sources' })).not.toBeInTheDocument();
  });

  it('shows a provider pause and an explicit manual resume without approval actions', async () => {
    const user = userEvent.setup();
    const paused = { ...baseSession, status: 'blocked' as const, modelStatus: 'partial' as const,
      progressJson: JSON.stringify({ stage: 'provider_paused', completedStages: ['freezing_sources', 'indexing_context', 'deterministic_analysis'], pauseCode: 'rate_limited' }),
      failureReason: 'Paused: the Model Provider rejected the request because of a rate limit. Remaining account allowance may still be available. Check provider access, then retry manually. No automatic retry will run.' };
    setup(paused);
    render(<ReviewActivityScreen projectId={project.id} sessionId={paused.id} onNavigate={vi.fn()} />);
    expect((await screen.findAllByText('Paused', { exact: true })).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Resume review' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Approve review' })).not.toBeInTheDocument();
    expect(screen.getByText('Paused at', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Completed', { exact: true })).not.toBeInTheDocument();
    expect(api.retryStaticSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Resume review' }));
    expect(await screen.findByRole('dialog', { name: 'Retry review?' })).toHaveTextContent('latest available versions');
    expect(api.retryStaticSession).not.toHaveBeenCalled();
  });

  it('renders the activity stages without a duplicate information rail while running', async () => {
    const running = { ...baseSession, status: 'running' as const };
    setup(running);
    render(<ReviewActivityScreen projectId={project.id} sessionId={running.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Review activity' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Review information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Supportive documents' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Review stages' })).toBeInTheDocument();
    expect(screen.getByText(/Context understood/)).toBeInTheDocument();
    expect(screen.queryByText('Loaded project sources')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-decision-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-decision-reject')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate findings')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write feedback about this review' })).not.toBeInTheDocument();
    // No correlation snapshot exists until the Review finishes.
    expect(api.getReviewCorrelations).not.toHaveBeenCalled();
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

  it('opens an available finding while running without allowing status changes', async () => {
    const user = userEvent.setup();
    setup({ ...baseSession, status: 'running' });
    const navigate = vi.fn();
    const view = render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);
    await screen.findByRole('heading', { name: 'Review activity' });
    expect(screen.queryByRole('button', { name: `View finding: ${finding.title}` })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    await user.click(await screen.findByRole('button', { name: `See more about ${finding.title}` }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'review-finding', findingId: finding.id }));
    view.rerender(<ReviewActivityScreen key="finding" findingId={finding.id} projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);
    const details = await screen.findByRole('article', { name: 'Finding details' });
    expect(details).toHaveTextContent(finding.description);
    expect(details).toHaveTextContent('updates become available when the review stops');
    expect(within(details).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('reconstructs the saved runner activity instead of rendering only complete', async () => {
    const user = userEvent.setup();
    setup({ ...baseSession, progressJson: JSON.stringify({ stage: 'complete', completedStages: ['freezing_sources'] }) });
    vi.mocked(api.listStaticFindings).mockResolvedValue([finding, { ...finding, id: 'repeat-finding', filePath: 'src/second.ts' }]);
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue({
      ...availableManifest(baseSession.id), artifactCount: 1,
      artifacts: [{ id: 'artifact-1', filePath: 'src/checkout.ts', fileName: 'checkout.ts', contentHash: 'saved' }],
    });
    vi.mocked(api.getReviewHarness).mockResolvedValue({
      workflow: { version: 'v1', reference: '', stages: [] },
      review: { id: baseSession.id, name: baseSession.name, status: 'pending_approval', modelStatus: 'succeeded', progress: { stage: 'complete', completedStages: ['freezing_sources'] }, updatedAt: baseSession.updatedAt },
      events: [
        { reviewId: baseSession.id, stage: 'freezing_sources', event: 'harness_step_started', createdAt: baseSession.createdAt, detail: { step: 'read_source', executionId: 'read-1', input: { artifactId: 'artifact-1', fileName: 'checkout.ts' } } },
        ...Array.from({ length: 5 }, (_, index) => ({
          reviewId: baseSession.id, stage: 'freezing_sources', event: 'harness_step_started', createdAt: baseSession.createdAt,
          detail: { step: 'read_source', executionId: 'read-1', input: { filePath: `src/extra-${index}.ts` } },
        })),
        { reviewId: baseSession.id, stage: 'freezing_sources', event: 'harness_step_completed', createdAt: baseSession.updatedAt, detail: { step: 'read_source', executionId: 'read-1', output: { hashChecked: true } } },
        { reviewId: baseSession.id, stage: 'freezing_sources', event: 'harness_step_completed', createdAt: baseSession.updatedAt, detail: { step: 'load_grounding', executionId: 'grounding-1', output: { confirmedRequirements: 0 } } },
        { reviewId: baseSession.id, stage: 'model_analysis', event: 'review_retry_scheduled', createdAt: baseSession.updatedAt, detail: { kind: 'ai', attempt: 5, maxAttempts: 5, delayMs: 15000 } },
      ],
    });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText(/I could read 1 selected file/)).toBeInTheDocument();
    expect(screen.queryByText(/AI request: retry attempt/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Check the documents' })).toBeInTheDocument();
    const source = await screen.findByRole('link', { name: 'checkout.ts' });
    expect(source).toHaveAttribute('href', expect.stringContaining('initialSection=source&sourceArtifactId=artifact-1'));
    expect(source).toHaveAccessibleDescription('src/checkout.ts');
    expect(screen.queryByText('extra-4.ts')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 more file' }));
    expect(screen.getByText('extra-4.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer files' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Review details' })).toHaveTextContent('Source files reviewed');
    expect(screen.getAllByRole('button', { name: `View finding: ${finding.title}` })).toHaveLength(1);
    const evidenceTable = screen.getByRole('table', { name: `${finding.title} evidence` });
    expect(within(evidenceTable).getAllByRole('row')).toHaveLength(2);
    expect(within(evidenceTable).getByRole('button', { name: 'src/second.ts' })).toBeInTheDocument();
    expect(screen.queryByText(finding.description)).not.toBeInTheDocument();
    expect(screen.queryByText('Check details (1)')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'complete' })).not.toBeInTheDocument();
    expect(api.getReviewHarness).toHaveBeenCalledWith(project.id, baseSession.id);
  });

  it('combines features and requirements with conservative traceability states and recorded evidence', async () => {
    const user = userEvent.setup();
    setup({ ...baseSession, status: 'running' });
    const evidence = { artifactId: 'artifact-1', filePath: 'src/checkout.ts', lineNumber: 12, sourceVersion: 'saved-version' };
    vi.mocked(api.listStaticFindings).mockResolvedValue([
      { ...finding, requirementId: 'req-checkout', location: { sourceLocator: { analysis: { featureId: 'feature-009477c6e051', pathId: 'reject-quantity', domain: 'business' } } } },
      { ...finding, id: 'unlinked', title: 'Unlinked observation' },
    ]);
    vi.mocked(api.getReviewTraceability).mockResolvedValue(availableTraceability(baseSession.id, project.id, [{
      requirementId: 'req-checkout', title: 'Check the quantity', description: 'Reject invalid quantities.',
      category: 'Business', state: 'complete', mappingIds: ['mapping-1'],
      sourceArtifactIds: ['artifact-1'], evidenceStatus: 'verified', confidence: 1, capturedAt: baseSession.createdAt,
    }, {
      requirementId: 'req-cancel', title: 'Cancel order', description: 'Allow order cancellation.',
      category: 'Business', state: 'missing', mappingIds: [],
      sourceArtifactIds: [], confidence: null, capturedAt: baseSession.createdAt,
    }]));
    vi.mocked(api.getReviewHarness).mockResolvedValue({
      workflow: { version: 'v1', reference: '', stages: [] },
      review: { id: baseSession.id, name: baseSession.name, status: 'running', modelStatus: 'running', progress: null, updatedAt: baseSession.updatedAt },
      events: [],
      analysisMap: {
        schemaVersion: 1, status: 'partial',
        coverage: { sourceArtifacts: 1, parsedArtifacts: 1, exhaustive: false, unresolvedEdgeCount: 0, limitations: [], unsupportedArtifacts: [] },
        features: [{
          id: 'feature-009477c6e051', label: 'Exported operation createPizzaOrder', provisional: true, entryPoints: [evidence],
          paths: [{ id: 'reject-quantity', kind: 'failure', label: 'Reject invalid quantity', status: 'inferred', evidence: [evidence] }],
          assessments: [], unresolved: [],
        }, {
          id: 'round', label: 'Internal operation roundMoney called by createPizzaOrder', provisional: true, entryPoints: [evidence],
          paths: [{ id: 'rounding', kind: 'normal', label: 'Round the order total', status: 'inferred', evidence: [evidence] }],
          assessments: [], unresolved: [],
        }, {
          id: 'callback', label: 'Callback operation <anonymous@22> registered within createPizzaOrder', provisional: true, entryPoints: [evidence],
          paths: [], assessments: [], unresolved: [],
        }, {
          id: 'payment', label: 'Internal operation processPayment called by createPizzaOrder', provisional: true, entryPoints: [evidence],
          paths: [], assessments: [], unresolved: [],
        }, {
          id: 'feature-e6966c2a1e34', label: 'Exported operation findPizzaOrder', provisional: true, entryPoints: [evidence],
          paths: [], assessments: [], unresolved: [],
        }, {
          id: 'list-products', label: 'Exported operation listProducts', provisional: true, entryPoints: [],
          paths: [], assessments: [], unresolved: [],
        }],
      },
    });
    const navigate = vi.fn();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);
    await screen.findByRole('heading', { name: 'Review activity' });
    expect(screen.queryByText('Create pizza order')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Traceability' }));
    const matrix = await screen.findByRole('table', { name: 'Traceability matrix' });
    expect(within(matrix).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['ID', 'Feature', 'State']);
    expect(within(matrix).getByRole('row', { name: /#009477c6 Create pizza order Complete/ })).toBeInTheDocument();
    expect(within(matrix).getByRole('row', { name: /#e6966c2a Find pizza order Incomplete/ })).toBeInTheDocument();
    expect(within(matrix).getByRole('row', { name: /List products Missing/ })).toBeInTheDocument();
    expect(within(matrix).getByRole('row', { name: /Cancel order Missing/ })).toBeInTheDocument();
    expect(within(matrix).queryByRole('button', { name: /round money|callback/i })).not.toBeInTheDocument();
    expect(within(matrix).getByRole('button', { name: 'Process payment' })).toBeInTheDocument();
    expect(within(matrix).queryByRole('button', { name: 'Check the quantity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Traceability details' })).not.toBeInTheDocument();
    await user.click(within(matrix).getByRole('button', { name: 'Create pizza order' }));
    const details = screen.getByRole('complementary', { name: 'Traceability details' });
    expect(within(details).getByText('Check the quantity')).toBeInTheDocument();
    expect(within(details).getByText('Reject invalid quantity')).toBeInTheDocument();
    expect(within(details).getByText('Round the order total')).toBeInTheDocument();
    expect(within(details).queryByText('Unlinked observation')).not.toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: finding.title }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'review-finding', findingId: finding.id }));
  });

  it('fills all three action slots with blockers before lower-priority risks', async () => {
    setup(baseSession);
    vi.mocked(api.listStaticFindings).mockResolvedValue([
      ...[1, 2, 3].map(index => ({ ...finding, id: `blocker-${index}`, recommendation: `Fix blocker ${index}` })),
      { ...finding, id: 'risk', severity: 'medium', recommendation: 'Address lower risk' },
    ]);
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    const actions = await screen.findByRole('region', { name: 'Next actions' });
    await within(actions).findByRole('button', { name: 'Fix blocker 3' });
    expect(within(actions).getAllByRole('listitem')).toHaveLength(3);
    expect(within(actions).queryByText('Address lower risk')).not.toBeInTheDocument();
  });

  it('presents sentence objectives and an overall result, blockers and next action', async () => {
    setup({ ...baseSession, status: 'failed', failureReason: 'The selected source cannot be read.', configJson: JSON.stringify({ instructions: 'Verify N1 in src/checkout.ts. Require approval before persistence.' }) });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    const objectives = screen.getByRole('heading', { name: 'Objective' }).closest('section')!;
    expect(within(objectives).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Verify N1 in src/checkout.ts.', 'Require approval before saving data.']);
    const summary = screen.getByRole('region', { name: 'Review summary' });
    expect(within(summary).getByText('Why it stopped')).toBeInTheDocument();
    expect(within(summary).getByText('The selected source cannot be read.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next actions' })).toHaveTextContent('Evidence gap');
    expect(screen.queryByRole('button', { name: 'Approve review' })).not.toBeInTheDocument();
  });

  it('keeps finding explanations available when execution history is unavailable', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const view = render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);
    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText(/Saved execution details could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(finding.description)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `View finding: ${finding.title}` }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'review-finding', findingId: finding.id }));
    view.rerender(<ReviewActivityScreen key="finding" findingId={finding.id} projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);
    expect(await screen.findByRole('article', { name: 'Finding details' })).toHaveTextContent(finding.description);
  });

  it('submits attached supportive documents with review feedback', async () => {
    const user = userEvent.setup();
    const approvalSession = baseSession;
    setup(approvalSession);
    render(<ReviewActivityScreen projectId={project.id} sessionId={approvalSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
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

  it('requires confirmation before approving and shows open blockers', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    const approve = await screen.findByRole('button', { name: 'Approve review' });
    await user.click(approve);
    const dialog = screen.getByRole('dialog', { name: 'Approve review?' });
    expect(within(dialog).getByText('1 confirmed blocker will remain open after approval.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(approve).toHaveFocus();
    expect(api.submitReviewDecision).not.toHaveBeenCalled();

    await user.click(approve);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() => expect(api.submitReviewDecision).toHaveBeenCalledExactlyOnceWith(project.id, baseSession.id, { decision: 'approved' }));
  });

  it('keeps decision actions available while the reviewer inspects evidence tabs', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('table', { name: 'Review findings' })).toBeInTheDocument();
    expect(screen.getByTestId('review-decision-approve')).toBeEnabled();

    await user.click(screen.getByRole('tab', { name: 'Traceability' }));
    expect(screen.getByRole('heading', { name: 'Traceability' })).toBeInTheDocument();
    expect(screen.getByTestId('review-decision-approve')).toBeEnabled();
  });

  it('omits Request changes and Dynamic Testing actions from the Review', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const view = render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);

    await screen.findByRole('region', { name: 'Review decision actions' });
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test in Dynamic Testing' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    await user.click(screen.getByRole('button', { name: `See more about ${finding.title}` }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'review-finding', findingId: finding.id }));
    view.rerender(<ReviewActivityScreen key="finding" findingId={finding.id} projectId={project.id} sessionId={baseSession.id} onNavigate={navigate} />);
    const details = await screen.findByRole('article', { name: 'Finding details' });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(details).getByText('Reported confidence')).toBeInTheDocument();
    expect(within(details).getAllByRole('region').map(region => region.getAttribute('aria-labelledby')).filter(Boolean))
      .toEqual(expect.arrayContaining(['finding-overview-heading', 'finding-evidence-heading', 'finding-action-heading']));
    expect(screen.queryByRole('button', { name: 'Verify with Dynamic Testing' })).not.toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: 'Back to findings' }));
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'review-activity', initialTab: 'Findings' }));
  });

  it('saves a Review export as Markdown in the desktop app and respects save cancellation', async () => {
    const user = userEvent.setup();
    const markdown = '# Release review\n';
    const destination = 'C:/reports/review.md';
    vi.stubGlobal('__TAURI_IPC__', vi.fn());
    vi.mocked(api.exportProjectReport).mockResolvedValue({
      reportId: 'export-1', markdown, generatedAt: baseSession.updatedAt, generatorVersion: 'test', riskPolicyVersion: 'test',
      storage: 'private-supabase', expiresAt: null, downloads: { markdown: null, pdf: null, json: null },
      checksums: { markdown: '', pdf: '', snapshot: '', package: '' },
    });
    vi.mocked(save).mockResolvedValueOnce(null).mockResolvedValueOnce(destination);
    try {
      render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
      const exportButton = await screen.findByRole('button', { name: 'Export report' });
      await user.click(exportButton);
      await waitFor(() => expect(exportButton).toBeEnabled());
      expect(api.exportProjectReport).toHaveBeenCalledWith(project.id, { reviewId: baseSession.id });
      expect(save).toHaveBeenCalledWith({
        title: 'Save Review report', defaultPath: `Centinel_${project.name}_${baseSession.name}_report.md`, filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      expect(writeTextFile).not.toHaveBeenCalled();

      await user.click(exportButton);
      await waitFor(() => expect(writeTextFile).toHaveBeenCalledExactlyOnceWith(destination, markdown));
      expect(screen.queryByRole('heading', { name: 'Review report ready' })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retrieves a fresh private download link for recorded decision feedback', async () => {
    const user = userEvent.setup();
    setup(baseSession, [{ ...approvedDecision, attachments: [{ id: 'attachment-1', fileName: 'notes.md', mimeType: 'text/markdown', createdAt: '2026-09-07T10:04:00.000Z' }] }]);
    vi.mocked(api.getReviewDecisionAttachmentDownload).mockResolvedValue({
      id: 'attachment-1', fileName: 'notes.md', signedUrl: 'https://storage.example.test/notes.md', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
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

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
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

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
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

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
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

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const loadMore = screen.getByRole('button', { name: 'Load older decisions' });
    await user.click(loadMore);
    expect(await screen.findByRole('alert')).toHaveTextContent('Older decisions could not be loaded');
    await user.click(loadMore);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Load older decisions' })).not.toBeInTheDocument();
    expect(api.listReviewDecisions).toHaveBeenLastCalledWith(project.id, baseSession.id, 50, 50);
  });

  it('shows actionable evidence gaps without the parent comparison section', async () => {
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
    expect(screen.queryByRole('heading', { name: 'Changes since parent review' })).not.toBeInTheDocument();
    expect(api.getReviewCorrelations).not.toHaveBeenCalled();
  });

  it('shows Completed with gaps with plain-language unverified parts and keeps the approval actions', async () => {
    const gaps = { ...baseSession, status: 'pending_approval' as const, progressJson: JSON.stringify({ stage: 'complete', completedStages: ['model_analysis'], coverage: 'partial', unverifiedPartCount: 1,
      unverifiedParts: [{ reason: 'semantic_support', files: ['src/cart.ts'], features: ['addToCart'] }] }) };
    setup(gaps);
    render(<ReviewActivityScreen projectId={project.id} sessionId={gaps.id} onNavigate={vi.fn()} />);

    const panel = await screen.findByRole('status', { name: 'Completed with gaps' });
    expect(within(panel).getByRole('list', { name: 'Parts that could not be verified' })).toHaveTextContent('src/cart.ts');
    expect(panel).toHaveTextContent('The conclusions could not be backed up with evidence from the code.');
    expect(panel).toHaveTextContent('cannot close earlier findings');
    expect(screen.getAllByText('Completed with gaps').length).toBeGreaterThan(1);
    expect(screen.getByTestId('review-decision-approve')).toBeInTheDocument();
  });

  it('replaces per-requirement coverage warnings with one link to confirm suggested links', async () => {
    const onNavigate = vi.fn();
    const requirement: Requirement = { id: 'req-1', projectId: project.id, title: 'Pay once', description: '', category: 'Business', priority: 'High', createdAt: baseSession.createdAt };
    vi.mocked(api.listRequirements).mockResolvedValue([requirement, { ...requirement, id: 'req-2', title: 'Refund' }]);
    vi.mocked(api.listRequirementMappings).mockImplementation(async (_projectId, reqId) => reqId === 'req-1' ? [
      { id: 'map-1', requirementId: 'req-1', fileId: 'artifact-1', symbolId: null, coverageStatus: 'suggested', confidence: 0.8 },
      { id: 'map-2', requirementId: 'req-1', fileId: 'artifact-2', symbolId: null, coverageStatus: 'suggested', confidence: 0.7 },
    ] : []);
    vi.mocked(api.getReviewEvidenceSufficiency).mockResolvedValue({
      id: 'assessment-3', reviewId: baseSession.id, projectId: project.id, reviewType: 'code_review', readiness: 'ready_with_warnings',
      gaps: ['req-1', 'req-2'].map(id => ({ id: `gap-${id}`, code: 'traceability_mappings_incomplete', severity: 'warning' as const, title: 'Incomplete Requirement Coverage', requirementId: id,
        detail: `${id} has missing implementation mapping evidence.`, remediation: 'Link the relevant versioned sources.', affectedStages: ['model_analysis'] })),
      contradictions: [], artifactCount: 1, availableArtifactCount: 1, staleArtifactCount: 0, confirmedRequirementCount: 2, enabledStandardRuleCount: 0, assessedAt: baseSession.createdAt,
    });
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={onNavigate} />);

    const readiness = await screen.findByRole('status', { name: 'Evidence needs attention' });
    await waitFor(() => expect(readiness).toHaveTextContent('Centinel suggested 2 links'));
    expect(readiness).not.toHaveTextContent('req-1 has missing implementation mapping evidence.');
    await user.click(within(readiness).getByRole('button', { name: 'Confirm suggested links' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'requirements', projectId: project.id });
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

    expect(await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review objective' })).not.toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Risk Assessment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sources in scope' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1].id);

    await user.click(tabs[0]);
    expect(screen.queryByRole('button', { name: 'Export review report' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('table', { name: 'Review findings' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Risk' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'High' })).toBeInTheDocument();
  });

  it('removes model usage and its request from review Overview', async () => {
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    expect(screen.queryByRole('heading', { name: 'Model usage' })).not.toBeInTheDocument();
    expect(screen.queryByText('Input tokens')).not.toBeInTheDocument();
    expect(api.getReviewModelUsage).not.toHaveBeenCalled();
  });

  it('keeps technical history and usage out of Activity', async () => {
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    expect(api.getReviewModelUsage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.queryByText('Model usage')).not.toBeInTheDocument();
    expect(screen.queryByText('Technical execution details')).not.toBeInTheDocument();
    expect(screen.queryByText('Features and paths checked')).not.toBeInTheDocument();
    expect(api.getReviewModelUsage).not.toHaveBeenCalled();
  });

  it('shows missing requirements as a coverage state rather than a finding', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewEvidenceSufficiency).mockResolvedValue({
      id: 'assessment-1', reviewId: baseSession.id, projectId: project.id, reviewType: 'code_review', readiness: 'ready',
      gaps: [], contradictions: [], artifactCount: 1, availableArtifactCount: 1, staleArtifactCount: 0,
      confirmedRequirementCount: 0, enabledStandardRuleCount: 1, assessedAt: baseSession.createdAt,
    });
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    expect(await screen.findByText('Requirements not identified. Code checks are reported separately.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.queryByText('Unconfirmed Business Requirements')).not.toBeInTheDocument();
  });

  it.each(['failure', 'failed'] as const)('offers Retry for %s execution and opens the child review with refreshed sources after confirmation', async status => {
    const user = userEvent.setup();
    const failed = { ...baseSession, status, failureReason: 'The provider timed out.' };
    const child = { ...baseSession, id: 'review-2', name: 'Release review retry', status: 'queued' as const };
    setup(failed);
    vi.mocked(api.retryStaticSession).mockResolvedValue(child);
    const onNavigate = vi.fn();
    render(<ReviewActivityScreen projectId={project.id} sessionId={failed.id} onNavigate={onNavigate} />);

    const retry = await screen.findByRole('button', { name: 'Retry review' });
    expect(screen.queryByRole('button', { name: 'Approve review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel review' })).not.toBeInTheDocument();
    await user.click(retry);
    const dialog = await screen.findByRole('dialog', { name: 'Retry review?' });
    expect(api.retryStaticSession).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Retry review' }));

    await waitFor(() => expect(api.retryStaticSession).toHaveBeenCalledWith(project.id, failed.id, { refreshSourceManifest: true, idempotencyKey: expect.any(String) }));
    expect((vi.mocked(api.retryStaticSession).mock.calls[0][2] as { idempotencyKey: string }).idempotencyKey).not.toHaveLength(0);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: child.id, reviewName: child.name });
  });

  it.each(['findings', 'sourceManifest', 'traceability'] as const)('blocks decisions after a %s read failure and recovers with Retry evidence', async failedRead => {
    const user = userEvent.setup();
    setup({ ...baseSession, modelStatus: 'succeeded' });
    if (failedRead === 'findings') {
      vi.mocked(api.listStaticFindings).mockRejectedValueOnce(new Error('HTTP 500'));
    } else if (failedRead === 'sourceManifest') {
      vi.mocked(api.getReviewSourceManifest).mockImplementationOnce(async () => { throw new Error('HTTP 500'); }).mockResolvedValue(availableManifest(baseSession.id));
    } else {
      vi.mocked(api.getReviewTraceability).mockImplementationOnce(async () => { throw new Error('HTTP 500'); }).mockResolvedValue(availableTraceability(baseSession.id));
    }
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    const approve = await screen.findByRole('button', { name: 'Approve review' });
    expect(approve).toBeDisabled();
    expect(screen.getByRole('alert', { name: 'Decision evidence status' })).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Retry evidence' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve review' })).toBeEnabled());
    expect(api.retryStaticSession).not.toHaveBeenCalled();
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
  });

  it('keeps actions locked during evidence loading, then rechecks before decisions', async () => {
    setup({ ...baseSession, modelStatus: 'succeeded' });
    let resolveTraceability!: (value: ReviewTraceabilitySnapshot) => void;
    vi.mocked(api.getReviewTraceability).mockReturnValue(new Promise(resolve => { resolveTraceability = resolve; }));
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Approve review' })).toBeDisabled();
    await act(async () => { resolveTraceability(availableTraceability(baseSession.id)); });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve review' })).toBeEnabled());
    expect(api.submitReviewDecision).not.toHaveBeenCalled();
  });

  it('treats an identity-mismatched manifest as a failed read, not legacy unavailability', async () => {
    setup({ ...baseSession, modelStatus: 'succeeded' });
    vi.mocked(api.getReviewSourceManifest).mockResolvedValueOnce(availableManifest('another-review'));
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('alert', { name: 'Decision evidence status' })).toHaveTextContent('could not be loaded');
    expect(screen.getByRole('button', { name: 'Approve review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry evidence' })).toBeInTheDocument();
  });
  it('explains unavailable implementation-version evidence without substituting current project filenames', async () => {
    const user = userEvent.setup();
    setup({ ...baseSession, modelStatus: 'succeeded' });
    vi.mocked(api.getReviewTraceability).mockResolvedValue(availableTraceability(baseSession.id, project.id, [{
      requirementId: 'saved-requirement', title: 'Saved ownership rule', description: 'Account reads require ownership.', category: 'Security',
      state: 'incomplete', mappingIds: ['mapping-old'], sourceArtifactIds: ['artifact-1'], confidence: null, capturedAt: baseSession.createdAt,
      evidenceStatus: 'unavailable', evidenceReason: 'mapping_version_proof_missing',
    }]));
    vi.mocked(api.listArtifacts).mockResolvedValue([{ id: 'artifact-1', projectId: project.id, fileName: 'RENAMED-CURRENT.ts', filePath: 'RENAMED-CURRENT.ts',
      contentHash: 'current', type: 'source_code', source: 'repository', originalPath: null, createdAt: baseSession.createdAt }]);
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('tab', { name: 'Traceability' }));
    expect(await screen.findByText(/Implementation evidence is unavailable/)).toHaveTextContent('does not prove coverage of the reviewed source version');
    expect(screen.queryByText('RENAMED-CURRENT.ts')).not.toBeInTheDocument();
  });

  it('uses a fresh key for a separate intentional retry after reusing the same request key', async () => {
    const user = userEvent.setup();
    const failed = { ...baseSession, status: 'failed' as const, failureReason: 'The provider timed out.' };
    setup(failed);
    vi.mocked(api.retryStaticSession)
      .mockRejectedValueOnce(new Error('The connection closed before a response arrived.'))
      .mockRejectedValueOnce(new Error('The connection is still unavailable.'))
      .mockResolvedValueOnce({ ...baseSession, id: 'review-retry-2', status: 'queued' });
    render(<ReviewActivityScreen projectId={project.id} sessionId={failed.id} onNavigate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Retry review' }));
    let dialog = await screen.findByRole('dialog', { name: 'Retry review?' });
    await user.click(within(dialog).getByRole('button', { name: 'Retry review' }));
    await within(dialog).findByRole('alert');
    const firstKey = (vi.mocked(api.retryStaticSession).mock.calls[0][2] as { idempotencyKey: string }).idempotencyKey;

    await user.click(within(dialog).getByRole('button', { name: 'Retry review' }));
    await within(dialog).findByRole('alert');
    expect((vi.mocked(api.retryStaticSession).mock.calls[1][2] as { idempotencyKey: string }).idempotencyKey).toBe(firstKey);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Retry review' }));
    dialog = await screen.findByRole('dialog', { name: 'Retry review?' });
    await user.click(within(dialog).getByRole('button', { name: 'Retry review' }));
    await waitFor(() => expect(api.retryStaticSession).toHaveBeenCalledTimes(3));
    const thirdRequest = vi.mocked(api.retryStaticSession).mock.calls[2][2] as { refreshSourceManifest: boolean; idempotencyKey: string; reuseValidatedBatches?: boolean };
    expect(thirdRequest.refreshSourceManifest).toBe(true);
    expect(thirdRequest.reuseValidatedBatches).toBeUndefined();
    expect(thirdRequest.idempotencyKey).not.toBe(firstKey);
  });

  it('allows explicit legacy-unavailable evidence only for an unscoped Review', async () => {
    setup({ ...baseSession, modelStatus: 'succeeded' });
    const first = render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Approve review' })).toBeEnabled();
    first.unmount();

    setup({ ...baseSession, id: 'review-explicit-scope', modelStatus: 'succeeded', scope: { artifactIds: ['artifact-1'], requirementIds: [], standardIds: [] } });
    const view = render(<ReviewActivityScreen projectId={project.id} sessionId="review-explicit-scope" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Approve review' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('status', { name: 'Decision evidence status' })).toHaveTextContent('explicit artifact selection'));
    view.unmount();
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
    vi.mocked(api.getReviewTraceability).mockResolvedValue(availableTraceability(baseSession.id, project.id, [{
      requirementId: requirement.id, title: requirement.title, description: requirement.description, category: requirement.category,
      state: 'complete', mappingIds: ['mapping-1'], sourceArtifactIds: [artifact.id], confidence: 0.95, capturedAt: baseSession.createdAt,
    }]));
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('tab', { name: 'Traceability' }));
    const table = screen.getByRole('table', { name: 'Traceability matrix' });
    expect(within(table).getByRole('columnheader', { name: 'State' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Completeness' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Correctness' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Consistency' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Findings' })).not.toBeInTheDocument();
    expect(within(table).getByText('Complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open finding #finding-1: Checkout requirement is not represented' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search traceability' }), 'no-match');
    expect(within(table).getByText('No traceability items match the current filters.')).toBeInTheDocument();
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
    vi.mocked(api.getReviewTraceability).mockResolvedValue(availableTraceability(baseSession.id, project.id, [
      { requirementId: requirement.id, title: requirement.title, description: requirement.description, category: requirement.category, state: 'incomplete', mappingIds: ['mapping-1'], sourceArtifactIds: ['artifact-1'], confidence: 0.5, capturedAt: baseSession.createdAt },
      { requirementId: 'requirement-2', title: 'Order cancellation is documented', description: 'Cancellation outcome is defined.', category: 'Business', state: 'missing', mappingIds: [], sourceArtifactIds: [], confidence: null, capturedAt: baseSession.createdAt },
    ]));
    const user = userEvent.setup();
    render(<ReviewActivityScreen projectId={project.id} sessionId={baseSession.id} onNavigate={vi.fn()} />);

    await screen.findByRole('heading', { name: /Insufficient evidence|Changes needed|Ready within scope/ });
    await user.click(screen.getByRole('button', { name: 'View incomplete and missing requirements in Traceability' }));

    expect(screen.getByRole('tab', { name: 'Traceability' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Traceability state' })).toHaveTextContent('Incomplete and missing');
    expect(screen.getAllByText('Missing')).not.toHaveLength(0);
  });
});
