import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactsPanel } from './ArtifactsPanel';
import { api } from '../api/client';
import type { Artifact, ConnectedSource } from '../types';
import { readBinaryFile } from '@tauri-apps/api/fs';

const filePicker = vi.hoisted(() => vi.fn());
const externalOpen = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/dialog', () => ({ open: filePicker }));
vi.mock('@tauri-apps/api/fs', () => ({ readBinaryFile: vi.fn() }));
vi.mock('@tauri-apps/api/shell', () => ({ open: externalOpen }));
vi.mock('../api/client', () => ({
  api: {
    listArtifacts: vi.fn(),
    getArtifactContent: vi.fn(),
    uploadArtifact: vi.fn(),
    importRepoArtifacts: vi.fn(),
    deleteArtifact: vi.fn(),
    listConnectedSources: vi.fn(),
    getConnectedSourceStatus: vi.fn(),
    browseConnectedSources: vi.fn(),
    importConnectedSource: vi.fn(),
    syncConnectedSource: vi.fn(),
    getConnectedSourceSyncHistory: vi.fn(),
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

const documentArtifact: Artifact = {
  id: 'document', projectId: 'p-1', type: 'requirement', source: 'documents', fileName: 'requirements.md',
  filePath: 'C:/project/requirements.md', originalPath: null, contentHash: 'doc', createdAt: '2026-10-21T02:00:00Z',
};
const connectedSource: ConnectedSource = {
  id: 'connection', projectId: 'p-1', integrationId: 'integration', provider: 'github', kind: 'github_repository',
  remoteId: 'example/repo', remoteUrl: 'https://github.com/example/repo', name: 'Connected repository', selectedScope: { branch: 'main' },
  remoteRevision: null, syncCursor: null, status: 'active', syncStatus: 'ready', lastSyncedAt: null,
  lastSuccessfulSyncAt: '2026-10-21T02:00:00Z', lastError: null, createdAt: '2026-10-21T02:00:00Z', updatedAt: '2026-10-21T02:00:00Z',
};

describe('ArtifactsPanel', () => {
  it('exposes an accessible busy skeleton during the initial source read', async () => {
    let resolveArtifacts!: (items: Artifact[]) => void;
    vi.mocked(api.listArtifacts).mockReturnValue(new Promise(resolve => { resolveArtifacts = resolve; }));
    render(<ArtifactsPanel projectId="p-1" />);

    const loadingRegion = screen.getByRole('region', { name: 'Project sources' });
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading project sources');
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();

    await act(async () => { resolveArtifacts([]); });
    expect(await screen.findByRole('heading', { name: 'Add your project materials' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Project sources' })).not.toBeInTheDocument();
  });

  it('uses source rows without column headers and never presents added time as updated time', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T12:00:00.000Z'));
    const user = userEvent.setup();
    const recentlyUpdated = { ...connectedSource, lastSyncedAt: '2026-10-29T11:55:00.000Z' };
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact, ...repositoryArtifacts]);
    vi.mocked(api.listConnectedSources).mockResolvedValue([recentlyUpdated]);
    render(<ArtifactsPanel projectId="p-1" />);

    const sources = await screen.findByRole('list', { name: 'Project sources' });
    expect(within(sources).queryByRole('columnheader')).not.toBeInTheDocument();
    expect(within(sources).getByText('Updated 5 minutes ago')).toBeInTheDocument();
    expect(within(sources).getAllByText('Updated time unavailable').length).toBeGreaterThan(0);
    expect(within(sources).queryByText(/Added/)).not.toBeInTheDocument();
    expect(within(sources).getByRole('button', { name: 'Sync Connected repository' })).toBeVisible();
    expect(within(sources).getByRole('button', { name: 'History for Connected repository' })).toBeVisible();
    expect(within(sources).getByText('Completed')).toBeVisible();

    await user.click(within(sources).getByRole('button', { name: 'View repo' }));
    const directory = screen.getByRole('list', { name: 'Repository files' });
    expect(within(directory).queryByRole('columnheader')).not.toBeInTheDocument();
    expect(within(directory).getByRole('button', { name: 'src 2 files' })).toBeInTheDocument();
    clock.mockRestore();
  });

  it('restores the selected repository file and reader scroll after viewing another source', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([...repositoryArtifacts, documentArtifact]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View repo' }));
    await user.click(screen.getByRole('button', { name: /src 2 files/ }));
    await user.click(screen.getByRole('button', { name: 'auth.ts' }));
    await screen.findByText('Preview content');
    screen.getByLabelText('Scrollable file content').scrollTop = 230;
    await user.click(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'Sources' }));
    await screen.findByRole('button', { name: 'View requirements.md' });
    await user.click(screen.getByRole('button', { name: 'View repo' }));
    await screen.findByRole('heading', { name: 'auth.ts' });
    await waitFor(() => expect(screen.getByLabelText('Scrollable file content').scrollTop).toBe(230));
    expect(within(screen.getByRole('navigation', { name: 'Source location' })).getByText('auth.ts')).toHaveAttribute('aria-current', 'page');
  });

  it('ignores an older response when the same file is opened again', async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: Awaited<ReturnType<typeof api.getArtifactContent>>) => void;
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    vi.mocked(api.getArtifactContent).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ versionId: 'v2', content: btoa('new response'), contentHash: 'new', mimeType: 'text/plain' });
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View requirements.md' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'Sources' }));
    await user.click(screen.getByRole('button', { name: 'View requirements.md' }));
    await screen.findByText('new response');
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    screen.getByRole('main', { name: 'Source content' }).scrollTop = 170;
    await act(async () => resolveOld({ versionId: 'v1', content: btoa('old response'), contentHash: 'old', mimeType: 'text/plain' }));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(screen.getByRole('main', { name: 'Source content' }).scrollTop).toBe(170);
    expect(screen.queryByText('old response')).not.toBeInTheDocument();
    expect(screen.getByText('new response')).toBeInTheDocument();
  });
  it('keeps connected repositories with the same name separate and uses original repository paths', async () => {
    const user = userEvent.setup();
    const remoteFile = (id: string, sourceId: string, fileName: string, originalPath: string): Artifact => ({
      ...repositoryArtifacts[0], id, sourceId, fileName, originalPath, filePath: `connected/${sourceId}/${id}`,
    });
    vi.mocked(api.listArtifacts).mockResolvedValue([
      remoteFile('remote-a', 'source-a', 'first.ts', 'src/first.ts'),
      remoteFile('remote-b', 'source-b', 'second.ts', 'second.ts'),
      ...repositoryArtifacts,
    ]);
    vi.mocked(api.listConnectedSources).mockResolvedValue(['source-a', 'source-b'].map(id => ({ ...connectedSource, id, name: 'Same repository' })));
    render(<ArtifactsPanel projectId="p-1" />);
    const list = await screen.findByRole('list', { name: 'Project sources' });
    const names = within(list).getAllByRole('button', { name: 'View Same repository' });
    expect(names).toHaveLength(2);
    expect(new Set(names.map(button => button.id)).size).toBe(2);
    expect(within(list).getByRole('button', { name: 'View repo' })).toBeInTheDocument();
    await user.click(names[0]);
    const files = screen.getByRole('list', { name: 'Repository files' });
    await user.click(within(files).getByRole('button', { name: /^src 1 file$/ }));
    expect(screen.getByRole('button', { name: 'first.ts' })).toBeInTheDocument();
    expect(within(screen.getByRole('main', { name: 'Source content' })).queryByRole('button', { name: 'second.ts' })).not.toBeInTheDocument();
    expect(api.getArtifactContent).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'Sources' }));
    await user.click(within(screen.getByRole('list', { name: 'Project sources' })).getAllByRole('button', { name: 'View Same repository' })[1]);
    expect(within(screen.getByRole('main', { name: 'Source content' })).getByRole('button', { name: 'second.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'first.ts' })).not.toBeInTheDocument();
  });

  it('uses a neutral repository name when connected-source metadata is unavailable', async () => {
    vi.mocked(api.listArtifacts).mockResolvedValue([{ ...repositoryArtifacts[0], sourceId: 'source-a', originalPath: 'file.ts', filePath: 'connected/source-a/blob-id' }]);
    vi.mocked(api.listConnectedSources).mockRejectedValue(new Error('offline'));
    render(<ArtifactsPanel projectId="p-1" />);
    expect(await screen.findByRole('button', { name: 'View Imported repository' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View source-a' })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.uploadArtifact).mockResolvedValue({} as Artifact);
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
    vi.mocked(api.getArtifactContent).mockResolvedValue({ versionId: 'version-1', content: btoa('Preview content'), contentHash: 'hash', mimeType: 'text/plain' });
    vi.mocked(api.listConnectedSources).mockResolvedValue([]);
    vi.mocked(api.getConnectedSourceStatus).mockResolvedValue({ provider: 'github', connected: false, accountLabel: null, accountId: null, scopes: [], expiresAt: null, status: 'disconnected', reauthorizationRequired: false, missingScopes: [], sources: [] });
    vi.mocked(api.browseConnectedSources).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(api.deleteArtifact).mockResolvedValue({ ok: true });
    vi.mocked(externalOpen).mockResolvedValue(undefined);
  });

  it('refreshes automatic sync outcomes and file counts from an initially idle source without starting a manual sync', async () => {
    vi.useFakeTimers();
    const source = { id: 'source', projectId: 'p-1', name: 'automatic-repository', provider: 'github', kind: 'github_repository', status: 'active', syncStatus: 'ready', lastSyncedAt: '2026-10-20T12:00:00Z', lastSuccessfulSyncAt: '2026-10-20T12:00:00Z', selectedScope: {}, remoteUrl: 'https://github.com/example/repo' } as ConnectedSource;
    vi.mocked(api.listConnectedSources).mockResolvedValue([source]);
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts.slice(0, 1));
    let view: ReturnType<typeof render> | undefined;
    try {
      await act(async () => { view = render(<ArtifactsPanel projectId="p-1" />); });
      expect(screen.getAllByText(/1 file/i).length).toBeGreaterThan(0);
      vi.mocked(api.listConnectedSources).mockResolvedValue([{ ...source, lastSyncedAt: '2026-10-20T12:05:00Z', lastSuccessfulSyncAt: '2026-10-20T12:05:00Z' }]);
      vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.getAllByText(/2 files/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(new Date('2026-10-20T12:05:00Z').toLocaleString()).length).toBeGreaterThan(0);
      expect(api.syncConnectedSource).not.toHaveBeenCalled();
      vi.mocked(api.listConnectedSources).mockRejectedValue(new Error('temporarily offline'));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.getByRole('status')).toHaveTextContent('Showing the last saved progress');
      expect(screen.getAllByText(/2 files/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Sync automatic-repository' })).toBeEnabled();
      vi.mocked(api.listConnectedSources).mockResolvedValue([source]);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.queryByText(/Source status could not be refreshed/)).not.toBeInTheDocument();
      const calls = vi.mocked(api.listConnectedSources).mock.calls.length;
      view!.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(api.listConnectedSources).toHaveBeenCalledTimes(calls);
    } finally { view?.unmount(); vi.useRealTimers(); }
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

  it('groups import choices by location and routes connector setup to Settings', async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    render(<ArtifactsPanel projectId="p-1" onOpenSettings={openSettings} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    const dialog = screen.getByRole('dialog', { name: 'Add source' });
    expect(within(dialog).getByRole('button', { name: /Upload files/ })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /Import local folder/ })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /GitHub/ })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /Google Drive/ })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /Slack/ })).toBeEnabled();
    expect(within(dialog).getByText(/Manage app connections in Settings/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /GitHub/ }));
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it('browses a connected GitHub account, selects a branch, and imports it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getConnectedSourceStatus).mockResolvedValue({
      provider: 'github', connected: true, accountLabel: '@octocat', accountId: '42', scopes: ['repo'], expiresAt: null, status: 'connected', reauthorizationRequired: false, missingScopes: [], sources: [],
    });
    vi.mocked(api.browseConnectedSources)
      .mockResolvedValueOnce({ items: [{ id: 'octo/centinel', name: 'octo/centinel', kind: 'repository', remoteUrl: 'https://github.com/octo/centinel', revision: 'main' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'main', name: 'main', kind: 'branch', revision: 'abc123' }], nextCursor: null });
    vi.mocked(api.importConnectedSource).mockResolvedValue({ source: {} as never, syncResult: null });

    render(<ArtifactsPanel projectId="p-1" onOpenSettings={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Add source' })).getByRole('button', { name: /GitHub/ }));
    const browser = await screen.findByRole('dialog', { name: 'Import from GitHub' });
    await user.click(within(browser).getByRole('button', { name: /octo\/centinel/ }));
    await user.click(await within(browser).findByRole('button', { name: /main/ }));
    await user.click(within(browser).getByRole('button', { name: 'Import and sync' }));

    await waitFor(() => expect(api.importConnectedSource).toHaveBeenCalledWith('p-1', expect.objectContaining({
      provider: 'github', kind: 'github_repository', remoteId: 'octo/centinel', selectedScope: { branch: 'main' }, sync: true,
    })));
  });

  it('opens a document in the detail view with Markdown Preview and Code modes', async () => {
    const user = userEvent.setup();
    const documentArtifact: Artifact = {
      id: 'a-doc', projectId: 'p-1', type: 'requirement', source: 'documents', fileName: 'requirements.md',
      filePath: 'C:/work/artifacts/a-doc_requirements.md', originalPath: null, contentHash: 'doc', createdAt: '2026-09-07T10:00:00.000Z',
    };
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    vi.mocked(api.getArtifactContent).mockResolvedValue({ versionId: 'version-1', content: btoa('# Requirements'), contentHash: 'hash', mimeType: 'text/markdown' });
    render(<ArtifactsPanel projectId="p-1" />);

    await user.click(await screen.findByRole('button', { name: /^View / }));
    expect(screen.getByRole('navigation', { name: 'Source location' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'requirements.md' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Requirements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.getByText('# Requirements')).toBeInTheDocument();
    expect(api.getArtifactContent).toHaveBeenCalledWith(documentArtifact.projectId, documentArtifact.id, undefined);
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it('opens a repository explorer, traverses directories, and previews a selected file', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    vi.mocked(api.getArtifactContent).mockResolvedValue({ versionId: 'version-1', content: btoa('export const button = true;'), contentHash: 'hash', mimeType: 'text/typescript' });
    render(<ArtifactsPanel projectId="p-1" />);

    expect(await screen.findByRole('button', { name: 'View repo' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^View / }));
    expect(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'repo' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Repository files' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /src 2 files/ }));
    await user.click(screen.getByRole('button', { name: /components/ }));
    await user.click(screen.getByRole('button', { name: /Button\.tsx/ }));
    expect(await screen.findByText('export const button = true;')).toBeInTheDocument();
  });

  it('does not invent a repository location when imported paths are relative', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts.map((artifact, index) => ({
      ...artifact,
      originalPath: index === 0 ? 'README.md' : 'src/components/Button.tsx',
    })));
    render(<ArtifactsPanel projectId="p-1" />);

    expect(await screen.findByRole('button', { name: 'View Imported repository' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^View / }));
    await user.click(screen.getByText('Source details'));
    expect(screen.getByText('Repository location unavailable')).toBeInTheDocument();
  });

  it('shows unsupported preview text and opens a real external/local location only when present', async () => {
    const user = userEvent.setup();
    const artifact: Artifact = {
      id: 'a-bin', projectId: 'p-1', type: 'other', source: 'documents', fileName: 'archive.bin',
      filePath: 'C:/work/archive.bin', originalPath: null, contentHash: 'bin', createdAt: '2026-09-07T10:00:00.000Z',
    };
    vi.mocked(api.listArtifacts).mockResolvedValue([artifact]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: /^View / }));
    expect(screen.getByText(/Preview not available/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument();
  });
  it.each(['DeliveryEscrow.sol', 'callback.custom'])('previews imported textual source %s', async fileName => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([{ ...repositoryArtifacts[0], type: fileName.endsWith('.sol') ? 'source_code' : 'other',
      fileName, filePath: `C:/repo/${fileName}`, originalPath: `C:/repo/${fileName}` }]);
    vi.mocked(api.getArtifactContent).mockResolvedValue({ versionId: 'v1', content: btoa('contract DeliveryEscrow {}'), contentHash: 'hash', mimeType: 'text/plain' });
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View repo' }));
    await user.click(screen.getByRole('button', { name: fileName }));
    expect(await screen.findByText('contract DeliveryEscrow {}')).toBeInTheDocument();
    expect(screen.queryByText(/Preview not available/)).not.toBeInTheDocument();
  });
  it.each([btoa('binary\u0000data'), btoa(String.fromCharCode(0xff, 0xfe, 0xff))])('rejects unreadable bytes in repository text previews', async content => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([{ ...repositoryArtifacts[0], type: 'other', fileName: 'callback.custom',
      filePath: 'C:/repo/callback.custom', originalPath: 'C:/repo/callback.custom' }]);
    vi.mocked(api.getArtifactContent).mockResolvedValue({ versionId: 'v1', content, contentHash: 'hash', mimeType: 'text/plain' });
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View repo' }));
    await user.click(screen.getByRole('button', { name: 'callback.custom' }));
    expect(await screen.findByText(/This file could not be previewed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Scrollable file content').querySelector('pre')).toBeNull();
  });

  it('keeps a real load failure visible instead of implying an empty project', async () => {
    vi.mocked(api.listArtifacts).mockRejectedValue(new Error('sidecar unavailable'));
    render(<ArtifactsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Files could not be refreshed'));
    expect(screen.queryByText('Add your project materials')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry loading sources' })).toBeEnabled();
  });

  it('keeps sync on the persistent source row without a bottom updates panel', async () => {
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    vi.mocked(api.listConnectedSources).mockResolvedValue([connectedSource]);
    render(<ArtifactsPanel projectId="p-1" />);
    const list = await screen.findByRole('list', { name: 'Project sources' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('button', { name: 'View Connected repository' })).toBeInTheDocument();
    expect(screen.queryByText('Source updates')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Connected repository' })).toBeVisible();
    expect(within(list).queryByText(documentArtifact.filePath)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('preserves list search and restores keyboard focus after viewing content', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([...repositoryArtifacts, documentArtifact]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.type(await screen.findByRole('searchbox', { name: 'Find a source' }), 'requirements');
    expect(screen.queryByRole('button', { name: 'View repo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View requirements.md' }));
    expect(screen.getByRole('heading', { name: 'requirements.md' })).toHaveFocus();
    expect(screen.getByText('Source details').closest('details')).not.toHaveAttribute('open');
    await user.click(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'Sources' }));
    expect(screen.getByRole('searchbox', { name: 'Find a source' })).toHaveValue('requirements');
    await waitFor(() => expect(screen.getByRole('button', { name: 'View requirements.md' })).toHaveFocus());
    await user.type(screen.getByRole('searchbox', { name: 'Find a source' }), ' unmatched');
    expect(screen.getByRole('status')).toHaveTextContent('No sources match');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('button', { name: 'View repo' })).toBeInTheDocument();
  });

  it('opens Drive content in-app and opens the real original only by explicit action', async () => {
    const user = userEvent.setup();
    const driveFile = { ...documentArtifact, source: 'drive' as const, originalPath: 'https://drive.google.com/file/d/example/view' };
    vi.mocked(api.listArtifacts).mockResolvedValue([driveFile]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View requirements.md' }));
    expect(await screen.findByText('Preview content')).toBeInTheDocument();
    expect(externalOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open original' }));
    expect(externalOpen).toHaveBeenCalledWith(driveFile.originalPath);
  });

  it('searches nested repository files from root and restores the directory when cleared', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View repo' }));
    const search = screen.getByRole('searchbox', { name: 'Find a file' });
    await user.type(search, 'Button');
    const results = screen.getByRole('list', { name: 'Matching repository files' });
    await user.click(within(results).getByRole('button', { name: /Button.tsx/ }));
    expect(await screen.findByText('Preview content')).toBeInTheDocument();
    expect(api.getArtifactContent).toHaveBeenCalledWith('p-1', 'a-2', undefined);
    await user.click(screen.getByRole('button', { name: 'repo' }));
    await user.click(screen.getByRole('button', { name: /src 2 files/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Find a file' }), 'missing-file');
    expect(screen.getByRole('status')).toHaveTextContent('No files match');
    await user.click(screen.getByRole('button', { name: 'Clear file search' }));
    expect(screen.getByRole('button', { name: /components 1 file/ })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'src' })).toHaveAttribute('aria-current', 'page');
  });

  it('reveals failed connection recovery automatically and retries sync', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listConnectedSources).mockResolvedValue([{ ...connectedSource, syncStatus: 'error', lastError: 'The saved source could not be updated.' }]);
    vi.mocked(api.syncConnectedSource).mockResolvedValue({} as never);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'Sync Connected repository' }));
    expect(screen.queryByText('Source updates')).not.toBeInTheDocument();
    expect(screen.getByText('The saved source could not be updated.')).toBeInTheDocument();
    expect(api.syncConnectedSource).toHaveBeenCalledWith('p-1', 'connection', expect.objectContaining({ force: true, idempotencyKey: expect.any(String) }));
  });

  it('offers reconnect for disconnected sources without submitting a sync', async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    vi.mocked(api.listConnectedSources).mockResolvedValue([{ ...connectedSource, status: 'disconnected' }]);
    render(<ArtifactsPanel projectId="p-1" onOpenSettings={openSettings} />);
    await user.click(await screen.findByRole('button', { name: 'Reconnect' }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(api.syncConnectedSource).not.toHaveBeenCalled();
  });

  it('reports failed history inside the dialog and can retry without showing empty success', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listConnectedSources).mockResolvedValue([connectedSource]);
    vi.mocked(api.getConnectedSourceSyncHistory).mockRejectedValueOnce(new Error('History unavailable')).mockResolvedValueOnce([]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'History for Connected repository' }));
    const dialog = screen.getByRole('dialog', { name: 'Connected repository sync history' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('History unavailable');
    expect(within(dialog).queryByText('No synchronization runs have been recorded.')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Retry history' }));
    expect(await within(dialog).findByText('No synchronization runs have been recorded.')).toBeInTheDocument();
  });

  it('retries a failed saved preview and represents an empty file honestly', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    vi.mocked(api.getArtifactContent).mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce({ versionId: 'v1', content: '', contentHash: 'empty', mimeType: 'text/plain' });
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View requirements.md' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(await screen.findByText('This file is empty.')).toBeInTheDocument();
  });

  it('recovers from a failed file load without losing existing materials', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([documentArtifact]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'Retry loading sources' }));
    expect(await screen.findByRole('button', { name: 'View requirements.md' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires a named confirmation before removing a document from details', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View requirements.md' }));
    await user.click(screen.getByText('Source details'));
    await user.click(screen.getByRole('button', { name: 'Remove source' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove source?' });
    expect(within(dialog).getByText(/Remove requirements.md from this project/)).toBeInTheDocument();
    expect(api.deleteArtifact).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'requirements.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove source' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove source' }));
    await waitFor(() => expect(api.deleteArtifact).toHaveBeenCalledWith('p-1', 'document'));
    expect(await screen.findByText('Add your project materials')).toBeInTheDocument();
  });

  it('supports browser upload and keeps native folder picker errors in the import dialog', async () => {
    const user = userEvent.setup();
    render(<ArtifactsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    const dialog = screen.getByRole('dialog', { name: 'Add source' });
    filePicker.mockRejectedValueOnce(new Error('Folder picker unavailable'));
    await user.click(within(dialog).getByRole('button', { name: /Import local folder/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Folder picker unavailable');
    vi.mocked(api.listArtifacts).mockResolvedValue([documentArtifact]);
    const file = new File(['# Notes'], 'requirements.md', { type: 'text/markdown' });
    // jsdom's File does not implement the browser Blob.arrayBuffer API.
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('# Notes').buffer });
    await user.upload(screen.getByLabelText('Select source files'), file);
    await waitFor(() => expect(api.uploadArtifact).toHaveBeenCalledWith('p-1', { fileName: 'requirements.md', content: btoa('# Notes') }));
    expect(await screen.findByRole('button', { name: 'View requirements.md' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('imports a local repository through the existing native folder contract', async () => {
    const user = userEvent.setup();
    filePicker.mockResolvedValueOnce('C:/repo');
    vi.mocked(api.importRepoArtifacts).mockResolvedValue({} as never);
    render(<ArtifactsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.click(screen.getByRole('button', { name: /Import local folder/ }));
    await waitFor(() => expect(api.importRepoArtifacts).toHaveBeenCalledWith('p-1', 'C:/repo'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    { provider: 'google_drive' as const, label: 'Google Drive', entry: { id: 'folder', name: 'Product docs', kind: 'folder' as const }, scope: { resourceKind: 'folder' } },
    { provider: 'slack' as const, label: 'Slack', entry: { id: 'channel', name: 'team-specs', kind: 'channel' as const }, scope: { channelId: 'channel' } },
  ])('preserves $label source selection and import scope', async ({ provider, label, entry, scope }) => {
    const user = userEvent.setup();
    vi.mocked(api.getConnectedSourceStatus).mockResolvedValue({ provider, connected: true, accountLabel: 'Connected account' } as never);
    vi.mocked(api.browseConnectedSources).mockResolvedValue({ items: [entry], nextCursor: null });
    vi.mocked(api.importConnectedSource).mockResolvedValue({} as never);
    render(<ArtifactsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.click(screen.getByRole('button', { name: new RegExp(label) }));
    const dialog = await screen.findByRole('dialog', { name: `Import from ${label}` });
    await user.click(await within(dialog).findByRole('button', { name: new RegExp(entry.name) }));
    await user.click(within(dialog).getByRole('button', { name: 'Import and sync' }));
    await waitFor(() => expect(api.importConnectedSource).toHaveBeenCalledWith('p-1', expect.objectContaining({ provider, remoteId: entry.id, selectedScope: scope, sync: true })));
  });

  it('does not offer to open an invented or unsafe original location', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([{ ...documentArtifact, originalPath: 'javascript:alert(1)' }]);
    render(<ArtifactsPanel projectId="p-1" />);
    await user.click(await screen.findByRole('button', { name: 'View requirements.md' }));
    expect(screen.queryByRole('button', { name: 'Open original' })).not.toBeInTheDocument();
    expect(externalOpen).not.toHaveBeenCalled();
  });

  it('shows a categorized explorer for mixed sources and retains the selected category on return', async () => {
    const user = userEvent.setup();
    const image = { ...documentArtifact, id: 'image', fileName: 'diagram.png', type: 'design' as const };
    vi.mocked(api.listArtifacts).mockResolvedValue([...repositoryArtifacts, documentArtifact, image]);
    render(<ArtifactsPanel projectId="p-1" initialView="repository" />);
    expect(await screen.findByRole('list', { name: 'Project sources' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Images' }));
    expect(screen.getByRole('button', { name: 'View diagram.png' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View repo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Documents' }));
    expect(screen.queryByRole('button', { name: 'View diagram.png' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View requirements.md' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'Sources' }));
    expect(screen.getByRole('button', { name: 'Documents' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Repositories' }));
    expect(screen.getByRole('button', { name: 'View repo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View requirements.md' })).not.toBeInTheDocument();
  });

  it('opens a single repository directly as a directory list and does not prefetch file bodies', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    render(<ArtifactsPanel projectId="p-1" initialView="repository" />);
    expect(await screen.findByRole('list', { name: 'Repository files' })).toBeInTheDocument();
    expect(screen.queryByText('Select a file to preview it.')).not.toBeInTheDocument();
    expect(api.getArtifactContent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /src 2 files/ }));
    expect(api.getArtifactContent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'auth.ts' }));
    expect(await screen.findByText('Preview content')).toBeInTheDocument();
    expect(api.getArtifactContent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('navigation', { name: 'Source location' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Project source navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide files' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: 'Source location' })).getByRole('button', { name: 'src' }));
    expect(screen.getByRole('list', { name: 'Repository files' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'File viewer' })).not.toBeInTheDocument();
  });

  it('uses breadcrumbs to switch files without losing source context', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    render(<ArtifactsPanel projectId="p-1" initialView="repository" />);
    await user.click(await screen.findByRole('button', { name: /src 2 files/ }));
    await user.click(screen.getByRole('button', { name: 'auth.ts' }));
    const location = screen.getByRole('navigation', { name: 'Source location' });
    expect(location).toHaveTextContent('repo');
    expect(location).toHaveTextContent('src');
    expect(location).toHaveTextContent('auth.ts');
    await screen.findByText('Preview content');
    const reader = screen.getByLabelText('Scrollable file content');
    reader.scrollTop = 350;
    reader.scrollLeft = 100;
    await user.click(within(location).getByRole('button', { name: 'src' }));
    await user.click(screen.getByRole('button', { name: /components 1 file/ }));
    await user.click(screen.getByRole('button', { name: 'Button.tsx' }));
    expect(api.getArtifactContent).toHaveBeenLastCalledWith('p-1', 'a-2', undefined);
    expect(screen.getByRole('heading', { name: 'Button.tsx' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Scrollable file content').scrollTop).toBe(0));
    expect(screen.getByLabelText('Scrollable file content').scrollLeft).toBe(0);
  });

  it('navigates compact directory chains using their complete path', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue([...repositoryArtifacts, { ...repositoryArtifacts[0], id: 'workflow', originalPath: 'C:/repo/.github/workflows/build.yml', fileName: 'build.yml' }]);
    render(<ArtifactsPanel projectId="p-1" initialView="repository" />);
    await user.click(await screen.findByRole('button', { name: /.github\/workflows 1 file/ }));
    expect(screen.getByRole('button', { name: 'build.yml' })).toBeInTheDocument();
    expect(api.getArtifactContent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'build.yml' }));
    expect(await screen.findByText('Preview content')).toBeInTheDocument();
  });

  it('numbers long code without creating an element for every source line', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(repositoryArtifacts);
    const content = Array.from({ length: 5000 }, (_, index) => `const item${index} = true;`).join('\n');
    vi.mocked(api.getArtifactContent).mockResolvedValue({ versionId: 'v1', content: btoa(content), contentHash: 'hash', mimeType: 'text/typescript' });
    const { container } = render(<ArtifactsPanel projectId="p-1" initialView="repository" />);
    await user.click(await screen.findByRole('button', { name: /src 2 files/ }));
    await user.click(screen.getByRole('button', { name: 'auth.ts' }));
    expect(await screen.findByText('5000 lines')).toBeInTheDocument();
    expect(container.querySelectorAll('.source-code-grid code')).toHaveLength(1);
    expect(container.querySelector('.source-code-grid code')?.textContent).toBe(content);
    expect(container.querySelector('.source-line-numbers')?.textContent?.split('\n')).toHaveLength(5000);
  });

  it('paginates a large source library and resets pagination when filtering', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listArtifacts).mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ ...documentArtifact, id: `doc-${index}`, fileName: `document-${index}.md` })));
    render(<ArtifactsPanel projectId="p-1" />);
    expect(await screen.findByRole('button', { name: 'View document-0.md' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View document-20.md' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'View document-20.md' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Find a source' }), 'document-0');
    expect(screen.getByRole('button', { name: 'View document-0.md' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });
});
