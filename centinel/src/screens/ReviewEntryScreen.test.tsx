import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewEntryScreen } from './ReviewEntryScreen';
import type { Artifact, ConnectedSource, Project, Requirement, StaticSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listArtifacts: vi.fn(),
    listRequirements: vi.fn(),
    listActiveStaticSessions: vi.fn(),
    listConnectedSources: vi.fn(),
    listStaticSessions: vi.fn(),
    getReviewSourceManifest: vi.fn(),
    createStaticSession: vi.fn(),
  },
}));

const project: Project = {
  id: 'project-1',
  name: 'Checkout app',
  description: 'Checkout application',
  workspacePath: 'C:/work/checkout',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const sourceArtifact: Artifact = {
  id: 'artifact-source',
  projectId: project.id,
  type: 'source_code',
  source: 'repository',
  fileName: 'checkout.ts',
  filePath: 'src/checkout.ts',
  originalPath: 'src/checkout.ts',
  contentHash: 'source-hash',
  createdAt: '2026-09-10T10:00:00.000Z',
};

const standardArtifact: Artifact = {
  id: 'artifact-standard',
  projectId: project.id,
  type: 'coding_standard',
  source: 'documents',
  fileName: 'security.md',
  filePath: 'docs/security.md',
  originalPath: 'docs/security.md',
  contentHash: 'standard-hash',
  createdAt: '2026-09-10T10:00:00.000Z',
};

const attachedDocument: Artifact = {
  ...standardArtifact,
  id: 'artifact-design',
  type: 'design',
  fileName: 'checkout-design.md',
  contentHash: 'design-hash',
};

function connectedRepository(id: string): ConnectedSource {
  return {
    id,
    projectId: project.id,
    integrationId: 'integration-github',
    provider: 'github',
    kind: 'github_repository',
    remoteId: id,
    remoteUrl: `https://github.com/example/${id}`,
    name: 'Team repository',
    selectedScope: {},
    remoteRevision: null,
    syncCursor: null,
    status: 'active',
    syncStatus: 'ready',
    lastSyncedAt: null,
    lastSuccessfulSyncAt: null,
    lastError: null,
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
  };
}

const requirement: Requirement = {
  id: 'requirement-1',
  projectId: project.id,
  title: 'Checkout requires authorization',
  description: 'Only signed-in users can complete checkout.',
  category: 'Security',
  priority: 'High',
  createdAt: '2026-09-10T10:00:00.000Z',
};

const returnedSession: StaticSession = {
  id: 'review-1',
  projectId: project.id,
  name: 'Sprint review',
  reviewType: 'code_review',
  status: 'queued',
  configJson: '{}',
  progressJson: '{}',
  remarks: '',
  finalSummary: '',
  failureReason: '',
  createdAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  baseRef: '',
  headRef: '',
  changedFilesJson: '[]',
  parentSessionId: '',
  reviewDiffJson: '',
};

const comparisonReview: StaticSession = {
  ...returnedSession,
  id: 'review-prior',
  name: 'Sprint 2 review',
  status: 'pending_approval',
  completedAt: '2026-09-20T10:00:00.000Z',
  modelStatus: 'succeeded',
  configJson: JSON.stringify({ instructions: 'Verify changed checkout paths.', baseRef: 'main', headRef: 'feature/review', pullRequest: '#123' }),
  progressJson: JSON.stringify({ stage: 'complete' }),
  scope: { artifactIds: [sourceArtifact.id], requirementIds: [requirement.id], standardIds: [] },
};

const comparisonManifest = {
  sessionId: comparisonReview.id,
  projectId: project.id,
  status: 'available' as const,
  capturedAt: '2026-09-20T10:00:00.000Z',
  sources: [{
    id: 'manifest-source', sessionId: comparisonReview.id, sourceId: 'manifest-source', sourceKind: 'repository' as const,
    label: 'checkout.ts', artifactIds: [sourceArtifact.id], filesReviewed: 1, contentHashes: ['source-hash'], capturedAt: '2026-09-20T10:00:00.000Z',
  }],
  artifactCount: 1,
};

function setup({ artifacts = [sourceArtifact, standardArtifact], requirements = [requirement], active = [], connectedSources = [] }: {
  artifacts?: Artifact[];
  requirements?: Requirement[];
  active?: StaticSession[];
  connectedSources?: ConnectedSource[];
} = {}) {
  vi.mocked(api.listArtifacts).mockResolvedValue(artifacts);
  vi.mocked(api.listRequirements).mockResolvedValue(requirements);
  vi.mocked(api.listActiveStaticSessions).mockResolvedValue(active);
  vi.mocked(api.listConnectedSources).mockResolvedValue(connectedSources);
  vi.mocked(api.listStaticSessions).mockResolvedValue([]);
  vi.mocked(api.getReviewSourceManifest).mockResolvedValue({
    sessionId: 'review-missing', projectId: project.id, status: 'unavailable', sources: [], artifactCount: null,
  });
  vi.mocked(api.createStaticSession).mockResolvedValue(returnedSession);
}

describe('ReviewEntryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it('loads real project scope and starts a review with the selected immutable inputs', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<ReviewEntryScreen projects={[project]} onNavigate={onNavigate} onCreateProject={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Select sources' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Repository Local imported code' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /security\.md/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Checkout requires authorization/i })).toBeChecked();

    await user.type(screen.getByRole('textbox', { name: 'Review name' }), 'Sprint review');
    await user.type(screen.getByRole('textbox', { name: 'Review objective' }), 'Verify checkout authorization and evidence traceability.');
    await user.click(screen.getByRole('checkbox', { name: /security\.md/i }));
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    await waitFor(() => expect(api.createStaticSession).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(api.createStaticSession).mock.calls[0];
    expect(payload).toMatchObject({
      name: 'Sprint review',
      instructions: 'Verify checkout authorization and evidence traceability.',
      artifactIds: ['artifact-source'],
      standardIds: [],
      requirementIds: ['requirement-1'],
      scope: {
        artifactIds: ['artifact-source'],
        standardIds: [],
        requirementIds: ['requirement-1'],
      },
    });
    expect(payload.idempotencyKey).toEqual(expect.any(String));
    expect(payload).not.toHaveProperty('comparisonParentReviewId');
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: returnedSession.id, reviewName: returnedSession.name });
  });

  it('defaults to the first source identity and all eligible supporting inputs', async () => {
    const firstRepo: Artifact = { ...sourceArtifact, id: 'first-file', sourceId: 'source-first', fileName: 'first.ts' };
    const secondRepo: Artifact = { ...sourceArtifact, id: 'second-file', sourceId: 'source-second', fileName: 'second.ts' };
    setup({
      artifacts: [firstRepo, secondRepo, attachedDocument, standardArtifact],
      requirements: [requirement],
      connectedSources: [connectedRepository('source-first'), connectedRepository('source-second')],
    });
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    const repositories = await screen.findAllByRole('checkbox', { name: 'Repository Team repository' });
    expect(repositories).toHaveLength(2);
    expect(repositories[0]).toBeChecked();
    expect(repositories[1]).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /checkout-design\.md/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /security\.md/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Checkout requires authorization/i })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /first\.ts|second\.ts/i })).not.toBeInTheDocument();
  });

  it('keeps Start review unavailable when the project has no reviewable scope', async () => {
    setup({ artifacts: [], requirements: [] });
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    expect(await screen.findByText('No sources or requirements found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Add project sources or requirements/i);
    expect(api.createStaticSession).not.toHaveBeenCalled();
  });

  it('blocks a second review while an active project review exists', async () => {
    const active: StaticSession = { ...returnedSession, id: 'review-active', status: 'running' };
    setup({ active: [active] });
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Select sources' });
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/A review is already active/i);
  });

  it('preserves entered fields and explains authentication failures', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStaticSession).mockRejectedValue(new Error('HTTP 401'));
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Select sources' });
    await user.type(screen.getByRole('textbox', { name: 'Review name' }), 'Auth review');
    await user.type(screen.getByRole('textbox', { name: 'Review objective' }), 'Check session handling.');
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again|authenticate/i);
    expect(screen.getByRole('textbox', { name: 'Review name' })).toHaveValue('Auth review');
    expect(screen.getByRole('textbox', { name: 'Review objective' })).toHaveValue('Check session handling.');
  });

  it('preloads a verified prior Review and links only after explicit submission', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    vi.mocked(api.listStaticSessions).mockResolvedValue([comparisonReview]);
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(comparisonManifest);
    render(<ReviewEntryScreen projects={[project]} comparisonParentReviewId={comparisonReview.id} onNavigate={onNavigate} onCreateProject={vi.fn()} />);

    expect(await screen.findByRole('note')).toHaveTextContent('Comparing updated sources with Sprint 2 review.');
    expect(screen.getByRole('textbox', { name: 'Review name' })).toHaveValue('Sprint 2 review');
    expect(screen.getByRole('textbox', { name: 'Review objective' })).toHaveValue('Verify changed checkout paths.');
    expect(screen.getByRole('checkbox', { name: 'Repository Local imported code' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /security\.md/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Checkout requires authorization/i })).toBeChecked();
    expect(api.createStaticSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start review' }));
    await waitFor(() => expect(api.createStaticSession).toHaveBeenCalledTimes(1));
    const [projectId, payload] = vi.mocked(api.createStaticSession).mock.calls[0];
    expect(projectId).toBe(project.id);
    expect(payload).toMatchObject({
      comparisonParentReviewId: comparisonReview.id,
      name: 'Sprint 2 review',
      instructions: 'Verify changed checkout paths.',
      baseRef: 'main',
      headRef: 'feature/review',
      pullRequest: '#123',
      artifactIds: [sourceArtifact.id],
      standardIds: [],
      requirementIds: [requirement.id],
    });
  });

  it('keeps missing saved members explicit and blocks implicit substitution', async () => {
    const user = userEvent.setup();
    const reviewWithMissingSource = { ...comparisonReview, scope: { ...comparisonReview.scope!, artifactIds: [sourceArtifact.id, 'removed-source-id'] } };
    vi.mocked(api.listStaticSessions).mockResolvedValue([reviewWithMissingSource]);
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(comparisonManifest);
    render(<ReviewEntryScreen projects={[project]} comparisonParentReviewId={comparisonReview.id} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    expect(await screen.findByText('removed-source-id · remove from this Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /source.*removed-source-id/i }));
    expect(screen.getByRole('button', { name: 'Start review' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Start review' }));
    await waitFor(() => expect(api.createStaticSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createStaticSession).mock.calls[0][1].artifactIds).toEqual([sourceArtifact.id]);
  });

  it.each([
    ['missing parent', [], null],
    ['failed model run', [{ ...comparisonReview, modelStatus: 'failed' as const }], comparisonManifest],
    ['partial model run', [{ ...comparisonReview, modelStatus: 'partial' as const }], comparisonManifest],
    ['missing model status', [{ ...comparisonReview, modelStatus: undefined }], comparisonManifest],
    ['unfinished lifecycle', [{ ...comparisonReview, status: 'running' as const }], comparisonManifest],
    ['missing completion record', [{ ...comparisonReview, completedAt: null, progressJson: '{}' }], comparisonManifest],
    ['unavailable manifest', [comparisonReview], { ...comparisonManifest, status: 'unavailable' as const }],
    ['empty saved manifest', [comparisonReview], { ...comparisonManifest, sources: [] }],
  ])('requires an explicit independent Review when the %s cannot be compared', async (_label, reviews, manifest) => {
    const user = userEvent.setup();
    vi.mocked(api.listStaticSessions).mockResolvedValue(reviews as StaticSession[]);
    if (manifest) vi.mocked(api.getReviewSourceManifest).mockResolvedValue(manifest as typeof comparisonManifest);
    render(<ReviewEntryScreen projects={[project]} comparisonParentReviewId={comparisonReview.id} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Comparison unavailable');
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    expect(api.createStaticSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Start an independent Review' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Review name' }), 'Independent review');
    await user.type(screen.getByRole('textbox', { name: 'Review objective' }), 'Check the current project scope.');
    await user.click(screen.getByRole('button', { name: 'Start review' }));
    await waitFor(() => expect(api.createStaticSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createStaticSession).mock.calls[0][1]).not.toHaveProperty('comparisonParentReviewId');
  });

  it('clears the comparison when the user switches projects', async () => {
    const user = userEvent.setup();
    const secondProject: Project = { ...project, id: 'project-2', name: 'Another project' };
    vi.mocked(api.listStaticSessions).mockResolvedValue([comparisonReview]);
    vi.mocked(api.getReviewSourceManifest).mockResolvedValue(comparisonManifest);
    render(<ReviewEntryScreen projects={[project, secondProject]} comparisonParentReviewId={comparisonReview.id} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    await screen.findByRole('note');
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'Another project' }));
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(vi.mocked(api.listArtifacts)).toHaveBeenLastCalledWith(secondProject.id);
  });
});
