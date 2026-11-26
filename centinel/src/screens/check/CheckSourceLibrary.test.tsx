import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/tauri';
import type { Artifact, ConnectedSource } from '../../types';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { CheckLibraryGroups, CheckLibraryList } from './CheckSourceLibrary';

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn() }));
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('groups repository artifacts and attaches only the selected file after browsing', async () => {
  const file = (id: string, relative: string): Artifact => ({ id, projectId: 'project', sourceId: 'repo',
    source: 'repository', type: 'source_code', localRepositoryName: 'Sample Shop', fileName: relative.split('/').at(-1)!,
    filePath: `local-repositories/repo/${relative}`, originalPath: `C:\\projects\\sample-shop\\${relative.replaceAll('/', '\\')}`,
    contentHash: 'fixture', createdAt: '2026-11-01T12:00:00Z' });
  const product = file('product', 'src/product.js');
  const app = file('app', 'public/app.js');
  const onAttach = vi.fn();
  render(<CheckLibraryList library={{ items: [product, app], error: false, refresh: vi.fn() }} onAttach={onAttach} />);
  expect(screen.getAllByRole('button', { name: 'Open Sample Shop' })).toHaveLength(1);
  expect(screen.queryByText(product.filePath)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Browse files in Sample Shop' }));
  await userEvent.click(screen.getByRole('button', { name: product.filePath }));
  expect(onAttach).toHaveBeenCalledExactlyOnceWith(product);
});

it('opens saved documents, connected destinations, and the local repository from the row', async () => {
  vi.stubGlobal('__TAURI_IPC__', vi.fn());
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(openExternalUrl).mockResolvedValue(true);
  const report: Artifact = { id: 'report', projectId: 'project', source: 'documents', type: 'other', fileName: 'report.pdf',
    filePath: 'uploads/report.pdf', originalPath: null, contentHash: 'fixture', createdAt: '' };
  const local: Artifact = { ...report, id: 'app', source: 'repository', sourceId: 'local', localRepositoryName: 'Sample Shop',
    fileName: 'app.js', filePath: 'local-repositories/local/src/app.js', originalPath: 'C:\\projects\\sample-shop\\src\\app.js' };
  const source = (id: string, name: string, kind: ConnectedSource['kind'], remoteUrl: string | null): ConnectedSource => ({
    id, name, projectId: 'project', integrationId: 'connection', provider: kind === 'google_drive' ? 'google_drive' : 'github', kind,
    remoteId: id, remoteUrl, selectedScope: { resourceKind: 'folder' }, remoteRevision: null, syncCursor: null,
    status: 'active', syncStatus: 'ready', lastSyncedAt: null, lastSuccessfulSyncAt: null, lastError: null, createdAt: '', updatedAt: '',
  });
  const openArtifact = vi.fn();
  render(<CheckLibraryGroups library={{ items: [report, local], error: false, refresh: vi.fn(), connected: [
    source('drive-id', 'Drive folder', 'google_drive', null),
    source('git', 'GitHub repo', 'github_repository', 'https://github.com/example/shop'),
    source('invalid', 'Invalid link', 'github_repository', 'https://github.com.example.com/example/shop'),
  ] }} onOpenArtifact={openArtifact} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }));
  expect(openArtifact).toHaveBeenCalledExactlyOnceWith(report);
  await userEvent.click(screen.getByRole('button', { name: 'Open Drive folder' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open GitHub repo' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open Sample Shop' }));
  expect(openExternalUrl).toHaveBeenCalledWith('https://drive.google.com/drive/folders/drive-id');
  expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/example/shop');
  expect(invoke).toHaveBeenCalledWith('open_workspace_folder', { folder: 'C:/projects/sample-shop' });
  expect(screen.queryByRole('button', { name: 'Open Invalid link' })).not.toBeInTheDocument();
});
