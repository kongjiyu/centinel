import { useCallback, useEffect, useState } from 'react';
import { Cloud, ExternalLink, FileText, Folder, GitBranch, MessageSquare, Plus, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { ProjectCreateModal } from '../../components/ProjectCreateModal';
import { uploadLocalSources, type LocalSourceFile } from '../../components/projectLocalFiles';
import { githubRepositoryName, saveCheckDocuments } from '../../check/runner';
import type { Artifact, ConnectedSource, ProjectRepositoryInput } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { CheckDocumentPicker } from './CheckDocumentPicker';

export function useCheckLibrary(projectId?: string) {
  const [result, setResult] = useState<{ projectId: string; items: Artifact[] | null; connected: ConnectedSource[]; error: boolean; connectedError: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void Promise.allSettled([api.listArtifacts(projectId), Promise.resolve().then(() => api.listConnectedSources(projectId))]).then(([artifacts, connected]) => {
      if (!active) return;
      setResult(current => ({ projectId, items: artifacts.status === 'fulfilled' ? artifacts.value.filter(item => item.projectId === projectId && !item.currency?.deprecated)
        : current?.projectId === projectId ? current.items : null,
      connected: connected.status === 'fulfilled' ? connected.value.filter(source => source.projectId === projectId && source.status !== 'removed')
        : current?.projectId === projectId ? current.connected : [],
      error: artifacts.status === 'rejected', connectedError: connected.status === 'rejected' }));
    });
    return () => { active = false; };
  }, [projectId, revision]);
  const current = result?.projectId === projectId ? result : null;
  return { items: current?.items ?? null, connected: current?.connected ?? [], error: current?.error ?? false, connectedError: current?.connectedError ?? false, refresh };
}

export type CheckLibrary = Pick<ReturnType<typeof useCheckLibrary>, 'items' | 'error' | 'refresh'> & Partial<Pick<ReturnType<typeof useCheckLibrary>, 'connected' | 'connectedError'>>;

function documentName(item: Artifact) {
  return (item.fileName || item.filePath).split(/[\\/]/).at(-1) || 'Document';
}

function localRoot(item: Artifact) {
  const path = item.originalPath?.replaceAll('\\', '/');
  if (!path || !/^[a-z]:\//i.test(path) || path.split('/').includes('..')) return undefined;
  const prefix = item.sourceId ? `local-repositories/${item.sourceId}/` : '';
  const relative = item.filePath.replaceAll('\\', '/');
  if (prefix && !relative.startsWith(prefix)) return undefined;
  const suffix = relative.slice(prefix.length);
  return suffix && !suffix.split('/').some(part => part === '..' || !part) && path.endsWith(`/${suffix}`)
    ? path.slice(0, -suffix.length - 1) : undefined;
}

export function githubDestination(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
        && /^\/[a-z\d][a-z\d-]*\/[a-z\d_.-]+\/?$/i.test(url.pathname)) return url.href;
  } catch { /* Unavailable saved destination. */ }
  return undefined;
}

function providerDestination(value: string | null | undefined, provider: 'google_drive' | 'slack') {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return undefined;
    if (provider === 'google_drive' && ['drive.google.com', 'docs.google.com'].includes(url.hostname)
      && /^\/(?:file\/d\/|drive\/(?:u\/\d+\/)?folders\/|(?:document|spreadsheets|presentation|forms|drawings)\/d\/)/.test(url.pathname)) return url.href;
    if (provider === 'google_drive' && url.hostname === 'drive.google.com' && url.pathname === '/open' && /^[\w-]+$/.test(url.searchParams.get('id') ?? '')) {
      const id = url.searchParams.get('id');
      return `https://drive.google.com/open?id=${id}`;
    }
    if (provider === 'slack' && /^[a-z\d-]+\.slack\.com$/i.test(url.hostname) && /^\/(?:archives\/|client\/)/.test(url.pathname)) return url.href;
  } catch { /* Unavailable saved destination. */ }
  return undefined;
}

function connectedDestination(source: ConnectedSource) {
  if (source.kind === 'google_drive') {
    return providerDestination(source.remoteUrl, 'google_drive') ?? (/^[\w-]+$/.test(source.remoteId)
      ? source.selectedScope.resourceKind === 'folder' ? `https://drive.google.com/drive/folders/${source.remoteId}`
        : `https://drive.google.com/open?id=${source.remoteId}` : undefined);
  }
  return providerDestination(source.remoteUrl, 'slack');
}

function repositoryGroups(library: CheckLibrary) {
  const groups = new Map<string, { name: string; files: Artifact[]; folder?: string; url?: string }>();
  for (const source of library.connected ?? []) {
    if (source.kind === 'github_repository') groups.set(source.id, { name: source.name, files: [], url: githubDestination(source.remoteUrl) });
  }
  for (const item of library.items ?? []) {
    if (item.source !== 'repository') continue;
    const folder = localRoot(item);
    const key = item.sourceId ?? folder ?? (item.git?.repository ? `git:${item.git.repository}` : 'unidentified-repository');
    const group = groups.get(key);
    if (group) group.files.push(item);
    else groups.set(key, { name: item.localRepositoryName || item.git?.repository || folder?.split('/').at(-1) || 'Repository', files: [item], folder });
  }
  return groups;
}

export function CheckLibraryList({ library, onAttach, attached = [], filter, compact = false }: {
  library: CheckLibrary;
  onAttach?: (artifact: Artifact) => void;
  attached?: Pick<Artifact, 'id'>[];
  filter?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [browsing, setBrowsing] = useState<string>();
  const search = (filter ?? query).trim().toLowerCase();
  const repos = repositoryGroups(library);
  const group = browsing ? repos.get(browsing) : undefined;
  const showGroups = Boolean(onAttach && !group && !search);
  const matches = (group?.files ?? library.items?.filter(item => !showGroups || item.source !== 'repository') ?? [])
    .filter(item => [item.fileName, item.filePath].some(value => value?.toLowerCase().includes(search)));
  if (library.error && !library.items) return <p role="status">Source library could not be loaded.</p>;
  if (!library.items) return <p role="status">Loading library…</p>;
  if (!library.items.length) return <p>No sources in this project yet.</p>;
  return <>
    {filter === undefined && (compact || library.items.length > 10) && <label className="ck-popover-search"><Icon icon={Search} /><input type="search" aria-label="Search library" placeholder="Search library" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    {group && <button type="button" className="ck-link" onClick={() => { setBrowsing(undefined); setQuery(''); }}>Back to Library</button>}
    {showGroups && <ul className="ck-library-list">{[...repos].map(([key, repo]) => <li key={key}>
      <RepositorySource repo={repo} />
      <button type="button" disabled={!repo.files.length} onClick={() => setBrowsing(key)}>Browse files in {repo.name}</button>
    </li>)}</ul>}
    {!matches.length && !(showGroups && repos.size) && <p>No matching sources.</p>}
    <ul className={compact ? "ck-library-list is-compact" : "ck-library-list"}>
      {matches.slice(0, 80).map(item => <li key={item.id}>
        {onAttach ? <button type="button" disabled={attached.some(source => source.id === item.id)} onClick={() => onAttach(item)}>
          <Icon icon={Plus} /><span title={item.filePath}>{item.source === 'documents' ? documentName(item) : item.filePath || item.fileName}</span>
        </button> : compact ? <div className="ck-source-row" title={item.filePath || item.fileName}>
          <Icon icon={FileText} /><div><strong>{(item.fileName || item.filePath || 'Source').split(/[\\/]/).filter(Boolean).at(-1)}</strong></div>
        </div> : <span title={item.filePath || item.fileName}>{item.filePath || item.fileName}</span>}
      </li>)}
    </ul>
    {matches.length > 80 && <p>Search to find more files.</p>}
  </>;
}

export function LibrarySourceRow({ name, detail, icon, folder, url, onOpen }: {
  name: string; detail?: string; icon: typeof Folder; folder?: string; url?: string; onOpen?: () => void;
}) {
  const [error, setError] = useState('');
  const open = async () => {
    setError('');
    try {
      if (onOpen) onOpen();
      else if (url) { if (!await openExternalUrl(url)) throw new Error(); }
      else if (folder && '__TAURI_IPC__' in window) await invoke('open_workspace_folder', { folder });
      else throw new Error();
    } catch { setError(folder && !('__TAURI_IPC__' in window) ? 'Open this folder from the desktop app.' : 'This source could not be opened.'); }
  };
  const label = <><Icon icon={icon} /><span className="ck-library-source-label"><strong title={name}>{name}</strong>
    {detail && <small title={detail}>{detail}</small>}</span></>;
  return <>{folder || url || onOpen ? <button type="button" className="ck-source-row ck-library-source-button" aria-label={`Open ${name}`} onClick={() => void open()}>
    {label}<Icon icon={ExternalLink} className="ck-library-source-open" />
  </button> : <div className="ck-source-row ck-library-source-unavailable">{label}<small>Location unavailable</small></div>}
  {error && <p role="status">{error}</p>}</>;
}

function RepositorySource({ repo }: { repo: { name: string; folder?: string; url?: string } }) {
  return <LibrarySourceRow {...repo} icon={GitBranch} />;
}

export function CheckLibraryGroups({ library, onOpenArtifact }: { library: CheckLibrary; onOpenArtifact: (artifact: Artifact) => void }) {
  const repos = repositoryGroups(library);
  const connected = (library.connected ?? []).filter(source => source.kind !== 'github_repository');
  const connectedIds = new Set(connected.map(source => source.id));
  const files = (library.items ?? []).filter(item => item.source !== 'repository' && (!item.sourceId || !connectedIds.has(item.sourceId)));
  return <>
    {[...repos].map(([key, repo]) => <RepositorySource key={key} repo={repo} />)}
    {connected.map(source => {
      const url = connectedDestination(source);
      const copy = !url && source.selectedScope.resourceKind === 'file' ? library.items?.find(item => item.sourceId === source.id) : undefined;
      return <LibrarySourceRow key={source.id} name={source.name} icon={source.kind === 'google_drive' ? Cloud : MessageSquare} url={url}
        onOpen={!url && copy ? () => onOpenArtifact(copy) : undefined} />;
    })}
    {files.map(item => {
      const url = item.source === 'drive' ? providerDestination(item.originalPath, 'google_drive') : undefined;
      return <LibrarySourceRow key={item.id} name={documentName(item)} icon={item.source === 'drive' ? Cloud : FileText} url={url}
        onOpen={url ? undefined : () => onOpenArtifact(item)} />;
    })}
    {library.error || library.connectedError ? <p role="status">Some sources could not be loaded.</p>
      : !library.items ? <p role="status">Loading project sources…</p>
        : !repos.size && !connected.length && !files.length ? <p>No sources in this project yet.</p> : null}
  </>;
}

export type CheckSourceChoice = 'documents' | 'repository';

export function CheckAddSource({ projectId, onClose, onSaved, initialChoice }: { projectId: string; onClose: () => void; onSaved: () => void; initialChoice?: CheckSourceChoice }) {
  const [step, setStep] = useState<'choose' | CheckSourceChoice | 'saving'>(initialChoice ?? 'choose');
  const [message, setMessage] = useState<string | null>(null);
  const save = async (work: () => Promise<string | null>) => {
    setStep('saving');
    setMessage(null);
    try {
      const note = await work();
      onSaved();
      if (note) { setMessage(note); setStep('choose'); } else onClose();
    } catch (cause) {
      onSaved();
      setMessage(userFacingError(cause, 'The source could not be added.'));
      setStep('choose');
    }
  };
  const importRepository = (source: ProjectRepositoryInput) => void save(async () => {
    if (source.type === 'local-repository') {
      const result = await api.importRepoArtifacts(projectId, source.path);
      return result.skipped.length ? `${result.skipped.length} files could not be imported.` : null;
    }
    const repository = githubRepositoryName(source.repoUrl);
    if (!repository) throw new Error('Enter a valid GitHub repository URL.');
    await api.importConnectedSource(projectId, { provider: 'github', kind: 'github_repository', remoteId: repository, remoteUrl: source.repoUrl, name: repository, sync: true });
    return 'GitHub import requested. Files appear once import finishes.';
  });
  const importFiles = (files: LocalSourceFile[]) => void save(async () => {
    const warnings = await uploadLocalSources(projectId, files);
    return warnings.length ? warnings.join(' ') : null;
  });
  return <>
    <Modal isOpen={step === 'choose' || step === 'saving'} onClose={step === 'saving' ? () => undefined : onClose} title="Add source">
      <div className="ck-document-actions">
        <button type="button" className="ck-button" disabled={step === 'saving'} onClick={() => setStep('documents')}><Icon icon={FileText} />Add documents</button>
        <button type="button" className="ck-button" disabled={step === 'saving'} onClick={() => setStep('repository')}><Icon icon={GitBranch} />Add repository</button>
      </div>
      {step === 'saving' && <p role="status">Adding sources…</p>}
      {message && <p role="status">{message}</p>}
    </Modal>
    <CheckDocumentPicker open={step === 'documents'} onClose={onClose} onSelect={({ accepted, message: note }) => save(async () => {
      const { failed } = await saveCheckDocuments(api, projectId, accepted);
      return [note, failed.length ? `Could not add ${failed.join(', ')}.` : null].filter(Boolean).join(' ') || null;
    })} closeOnSelect={false} />
    <ProjectCreateModal isOpen={step === 'repository'} onClose={onClose}
      onCreate={async () => undefined} onRepositorySelected={importRepository} onLocalFilesSelected={importFiles} />
  </>;
}
