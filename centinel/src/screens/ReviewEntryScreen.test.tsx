import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewEntryScreen } from './ReviewEntryScreen';
import type { Artifact, Project, Requirement, StaticSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listArtifacts: vi.fn(),
    listRequirements: vi.fn(),
    listActiveStaticSessions: vi.fn(),
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

function setup({ artifacts = [sourceArtifact, standardArtifact], requirements = [requirement], active = [] }: {
  artifacts?: Artifact[];
  requirements?: Requirement[];
  active?: StaticSession[];
} = {}) {
  vi.mocked(api.listArtifacts).mockResolvedValue(artifacts);
  vi.mocked(api.listRequirements).mockResolvedValue(requirements);
  vi.mocked(api.listActiveStaticSessions).mockResolvedValue(active);
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

    expect(await screen.findByRole('heading', { name: 'Review scope' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /checkout\.ts/i })).toBeChecked();
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
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: returnedSession.id, reviewName: returnedSession.name });
  });

  it('keeps Start review unavailable when the project has no reviewable scope', async () => {
    setup({ artifacts: [], requirements: [] });
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    expect(await screen.findByText('No project scope is available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Add at least one artifact, requirement, or coding standard/i);
    expect(api.createStaticSession).not.toHaveBeenCalled();
  });

  it('blocks a second review while an active project review exists', async () => {
    const active: StaticSession = { ...returnedSession, id: 'review-active', status: 'running' };
    setup({ active: [active] });
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review scope' });
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/A review is already active/i);
  });

  it('preserves entered fields and explains authentication failures', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStaticSession).mockRejectedValue(new Error('HTTP 401'));
    render(<ReviewEntryScreen projects={[project]} onNavigate={vi.fn()} onCreateProject={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Review scope' });
    await user.type(screen.getByRole('textbox', { name: 'Review name' }), 'Auth review');
    await user.type(screen.getByRole('textbox', { name: 'Review objective' }), 'Check session handling.');
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again|authenticate/i);
    expect(screen.getByRole('textbox', { name: 'Review name' })).toHaveValue('Auth review');
    expect(screen.getByRole('textbox', { name: 'Review objective' })).toHaveValue('Check session handling.');
  });
});
