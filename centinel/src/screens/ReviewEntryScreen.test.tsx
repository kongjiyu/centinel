import { render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ReviewEntryScreen } from './ReviewEntryScreen';
import type { Project, StaticSession } from '../types';

const folderPicker = vi.hoisted(() => vi.fn());
const trackSession = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/dialog', () => ({ open: folderPicker }));
vi.mock('../api/client', () => ({
  api: {
    listArtifacts: vi.fn(),
    listActiveStaticSessions: vi.fn(),
    createStaticSession: vi.fn(),
    uploadArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
  },
}));
vi.mock('../context/ActiveReviewContext', () => ({
  useActiveReviewState: () => ({ controls: { trackSession } }),
}));

const project: Project = {
  id: 'project-1',
  name: 'Website refresh',
  description: 'Office website',
  workspacePath: 'C:/work/website-refresh',
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const session: StaticSession = {
  id: 'review-1',
  projectId: project.id,
  name: 'Release review',
  reviewType: 'code_review',
  status: 'queued',
  configJson: '{}',
  progressJson: '{}',
  remarks: '',
  finalSummary: '',
  failureReason: '',
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
  baseRef: '',
  headRef: '',
  changedFilesJson: '[]',
  parentSessionId: '',
  reviewDiffJson: '',
};

describe('ReviewEntryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listArtifacts).mockResolvedValue([{
      id: 'artifact-1',
      projectId: project.id,
      type: 'source_code',
      source: 'documents',
      fileName: 'source.ts',
      filePath: 'C:/work/website-refresh/source.ts',
      originalPath: null,
      contentHash: 'source-hash',
      createdAt: project.createdAt,
    }]);
    vi.mocked(api.listActiveStaticSessions).mockResolvedValue([]);
    vi.mocked(api.createStaticSession).mockResolvedValue(session);
  });

  it('uses the selected project, shows its compact source status, and opens Review activity', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={onNavigate}
        onCreateProject={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText('Review name')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Start review' })).toBeInTheDocument();
    expect(screen.queryByText('Start with a clear objective')).not.toBeInTheDocument();
    expect(await screen.findByText('Complete source')).toBeInTheDocument();
    expect(screen.queryByText('Inherited project context')).not.toBeInTheDocument();
    const objective = screen.getByLabelText('Review objective');
    const supportiveDocuments = screen.getByLabelText('Supportive Documents (Optional)');
    expect(objective.compareDocumentPosition(supportiveDocuments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Save these documents to the project sources')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Review name'), 'Release review');
    await user.type(objective, 'Check traceability');
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    await waitFor(() => expect(api.createStaticSession).toHaveBeenCalledWith(project.id, {
      name: 'Release review',
      instructions: 'Check traceability',
      reviewMode: 'regular',
      reviewer: 'Project owner',
      pullRequest: undefined,
      temporaryArtifactIds: undefined,
    }));
    expect(trackSession).toHaveBeenCalledWith(session, project.name);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: project.id, sessionId: session.id, reviewName: session.name });
  });

  it('keeps the Review header and form on the same border-box width', () => {
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    const header = screen.getByRole('heading', { name: 'Start your review' }).closest('header');
    const form = screen.getByRole('form', { name: 'Start review' });
    expect(header).not.toBeNull();
    expect(form).toHaveClass('static-review-form');
    expect(form.closest('.review-entry-screen')).toContainElement(header);
  });

  it('treats project creation as the prerequisite and selects the new project', async () => {
    const user = userEvent.setup();
    const createdProject = { ...project, id: 'project-2', name: 'New project' };
    folderPicker.mockResolvedValue('C:/work/new-project');
    const onCreateProject = vi.fn().mockResolvedValue(createdProject);
    function EmptyProjectHarness() {
      const [projects, setProjects] = useState<Project[]>([]);
      const createProject = async (...args: Parameters<typeof onCreateProject>) => {
        const created = await onCreateProject(...args);
        setProjects([createdProject]);
        return created;
      };
      return <ReviewEntryScreen projects={projects} onNavigate={vi.fn()} onCreateProject={createProject} />;
    }
    render(<EmptyProjectHarness />);

    expect(screen.getByText('Create or select a project before starting this review.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await user.type(screen.getByLabelText('Project name *'), 'New project');
    await user.click(screen.getByRole('button', { name: 'Choose repository' }));
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith('New project', '', 'C:/work/new-project', { type: 'local-repository' }));
    expect(await screen.findByRole('combobox', { name: 'Project' })).toHaveTextContent('New project');
    expect(screen.queryByText('Create or select a project before starting this review.')).not.toBeInTheDocument();
  });

  it('requires an objective and focuses the recoverable error summary', async () => {
    const user = userEvent.setup();
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    await screen.findByLabelText('Review name');
    await user.type(screen.getByLabelText('Review name'), 'Objective check');
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    const error = await screen.findByRole('alert', { name: '' });
    expect(error).toHaveTextContent('Review objective is required');
    expect(document.activeElement).toBe(error);
    expect(api.createStaticSession).not.toHaveBeenCalled();
  });

  it('uploads optional review documents without saving them as project sources', async () => {
    const user = userEvent.setup();
    Object.defineProperty(File.prototype, 'arrayBuffer', {
      configurable: true,
      value: vi.fn().mockResolvedValue(new TextEncoder().encode('release notes').buffer),
    });
    vi.mocked(api.uploadArtifact).mockResolvedValueOnce({
      id: 'temporary-document',
      projectId: project.id,
      type: 'other',
      source: 'documents',
      fileName: 'notes.txt',
      filePath: 'C:/work/website-refresh/artifacts/notes.txt',
      originalPath: null,
      contentHash: 'notes-hash',
      createdAt: project.createdAt,
    });
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    await screen.findByLabelText('Review name');
    await user.type(screen.getByLabelText('Review name'), 'Document review');
    await user.type(screen.getByLabelText('Review objective'), 'Check the attached notes.');
    await user.upload(screen.getByLabelText('Supportive Documents (Optional)'), new File(['release notes'], 'notes.txt', { type: 'text/plain' }));
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    await waitFor(() => expect(api.uploadArtifact).toHaveBeenCalledWith(project.id, {
      fileName: 'notes.txt',
      content: expect.any(String),
    }));
    expect(api.createStaticSession).toHaveBeenCalledWith(project.id, expect.objectContaining({
      temporaryArtifactIds: ['temporary-document'],
    }));
    expect(api.deleteArtifact).not.toHaveBeenCalled();
  });

  it('retains the objective after a service error', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStaticSession).mockRejectedValueOnce(new Error('Sidecar unavailable'));
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    await screen.findByLabelText('Review name');
    await user.type(screen.getByLabelText('Review name'), 'Retryable review');
    await user.type(screen.getByLabelText('Review objective'), 'Check the release evidence.');
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sidecar unavailable');
    expect(screen.getByLabelText('Review name')).toHaveValue('Retryable review');
    expect(screen.getByLabelText('Review objective')).toHaveValue('Check the release evidence.');
  });

  it('blocks a second review while a project review is active', async () => {
    vi.mocked(api.listActiveStaticSessions).mockResolvedValueOnce([{ ...session, status: 'running' }]);
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(await screen.findByText(/already in progress for this project/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
  });

  it('keeps valid source context usable when the optional active-review check is unavailable', async () => {
    vi.mocked(api.listActiveStaticSessions).mockRejectedValueOnce(new Error('Active review check unavailable'));
    render(
      <ReviewEntryScreen
        projects={[project]}
        onNavigate={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(await screen.findByText('Complete source')).toBeInTheDocument();
    expect(screen.queryByText(/Sources could not be checked/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeEnabled();
  });
});
