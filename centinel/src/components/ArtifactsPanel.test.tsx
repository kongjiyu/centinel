import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactsPanel } from './ArtifactsPanel';
import { api } from '../api/client';
import type { Artifact } from '../types';

const filePicker = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/dialog', () => ({ open: filePicker }));
vi.mock('@tauri-apps/api/fs', () => ({ readBinaryFile: vi.fn() }));
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

  it('renders repository folders as keyboard-operable disclosures', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    render(<ArtifactsPanel projectId="p-1" />);

    const repository = await screen.findByRole('button', { name: /Repository.*src.*2 files/i });
    await user.click(repository);
    const folder = screen.getByRole('button', { name: /components/i });
    expect(screen.queryByText('Button.tsx')).not.toBeInTheDocument();
    await user.click(folder);
    expect(screen.getByText('Button.tsx')).toBeInTheDocument();
  });

  it('keeps a real load failure visible instead of implying an empty project', async () => {
    vi.mocked(api.listArtifacts).mockRejectedValue(new Error('sidecar unavailable'));
    render(<ArtifactsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sources could not be loaded'));
    expect(screen.getByText('Drop source files here')).toBeInTheDocument();
  });
});
