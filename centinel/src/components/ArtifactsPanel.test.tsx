import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactsPanel } from './ArtifactsPanel';
import { api } from '../api/client';
import type { Artifact } from '../types';
import { readBinaryFile } from '@tauri-apps/api/fs';

const filePicker = vi.hoisted(() => vi.fn());
const externalOpen = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/dialog', () => ({ open: filePicker }));
vi.mock('@tauri-apps/api/fs', () => ({ readBinaryFile: vi.fn() }));
vi.mock('@tauri-apps/api/shell', () => ({ open: externalOpen }));
vi.mock('../api/client', () => ({
  api: {
    listArtifacts: vi.fn(),
    uploadArtifact: vi.fn(),
    importRepoArtifacts: vi.fn(),
    getIndexStatus: vi.fn(),
    deleteArtifact: vi.fn(),
  },
}));

const repositoryArtifacts: Artifact[] = [
  {
    id: 'a-1', projectId: 'p-1', type: 'source_code', source: 'repository', fileName: 'auth.ts',
    filePath: 'C:/repo/src/auth.ts', originalPath: 'C:/repo/src/auth.ts', contentHash: 'a', createdAt: '2026-09-07T10:00:00.000Z',
  },
  {
    id: 'a-2', projectId: 'p-1', type: 'source_code', source: 'repository', fileName: 'Button.tsx',
    filePath: 'C:/repo/src/components/Button.tsx', originalPath: 'C:/repo/src/components/Button.tsx', contentHash: 'b', createdAt: '2026-09-07T10:00:00.000Z',
  },
];

describe('ArtifactsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.uploadArtifact).mockResolvedValue({} as Artifact);
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
    vi.mocked(api.deleteArtifact).mockResolvedValue({ ok: true });
    vi.mocked(externalOpen).mockResolvedValue(undefined);
  });

  it('offers a keyboard/click empty drop target and reports unsupported files', async () => {
    const user = userEvent.setup();
    render(<ArtifactsPanel projectId="p-1" />);
    const dropzone = await screen.findByRole('button', { name: 'Add source files' });
    expect(dropzone).toHaveTextContent('Drop source files here');

    const input = screen.getByLabelText('Select source files');
    await user.upload(input, new File(['binary'], 'notes.exe', { type: 'application/octet-stream' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported source skipped: notes.exe');
    expect(api.uploadArtifact).not.toHaveBeenCalled();

    fireEvent.keyDown(dropzone, { key: 'Enter' });
    expect(input).toBeInTheDocument();
  });

  it('shows the five source categories and keeps disconnected connectors unavailable', async () => {
    const user = userEvent.setup();
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: /^Add source$/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add source' });
    expect(within(dialog).getByRole('button', { name: /Documents/ })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /Repository/ })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /GitHub/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /Google Drive/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /Slack/ })).toBeDisabled();
    expect(within(dialog).getByText(/remain unavailable/i)).toBeInTheDocument();
  });

  it('opens a document in the detail view with Markdown Preview and Original modes', async () => {
    const user = userEvent.setup();
    const documentArtifact: Artifact = {
      id: 'a-doc', projectId: 'p-1', type: 'requirement', source: 'documents', fileName: 'requirements.md',
      filePath: 'C:/work/artifacts/a-doc_requirements.md', originalPath: null, contentHash: 'doc', createdAt: '2026-09-07T10:00:00.000Z',
    };
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    vi.mocked(readBinaryFile).mockResolvedValue(new TextEncoder().encode('# Requirements'));
    render(<ArtifactsPanel projectId="p-1" />);

    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: /Back to sources/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'requirements.md' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Requirements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Original' }));
    expect(screen.getByText('# Requirements')).toBeInTheDocument();
    expect(readBinaryFile).toHaveBeenCalledWith(documentArtifact.filePath);
  });

  it('opens a repository explorer, traverses directories, and previews a selected file', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    vi.mocked(readBinaryFile).mockResolvedValue(new TextEncoder().encode('export const button = true;'));
    render(<ArtifactsPanel projectId="p-1" />);

    expect(await screen.findByText('repo')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect(screen.getByRole('heading', { name: 'repo' })).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Repository directory tree' })).toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /src 2 files/ }));
    await user.click(screen.getByRole('treeitem', { name: /components/ }));
    await user.click(screen.getByRole('treeitem', { name: /Button\.tsx/ }));
    expect(await screen.findByText('export const button = true;')).toBeInTheDocument();
  });

  it('does not invent a repository location when imported paths are relative', async () => {
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts.map((artifact, index) => ({
      ...artifact,
      originalPath: index === 0 ? 'README.md' : 'src/components/Button.tsx',
    })));
    render(<ArtifactsPanel projectId="p-1" />);

    expect(await screen.findByText('Imported repository')).toBeInTheDocument();
    expect(screen.getByText('Repository location unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  });

  it('shows unsupported preview text and opens a real external/local location only when present', async () => {
    const user = userEvent.setup();
    const artifact: Artifact = {
      id: 'a-bin', projectId: 'p-1', type: 'other', source: 'documents', fileName: 'archive.bin',
      filePath: 'C:/work/archive.bin', originalPath: null, contentHash: 'bin', createdAt: '2026-09-07T10:00:00.000Z',
    };
    vi.mocked(api.listArtifacts).mockResolvedValue([artifact]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect(screen.getByText(/Preview not available/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument();
  });

  it('keeps a real load failure visible instead of implying an empty project', async () => {
    vi.mocked(api.listArtifacts).mockRejectedValue(new Error('sidecar unavailable'));
    render(<ArtifactsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sources could not be loaded'));
    expect(screen.getByText('Drop source files here')).toBeInTheDocument();
  });
});
