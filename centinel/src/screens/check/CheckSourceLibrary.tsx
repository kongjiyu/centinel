import { useCallback, useEffect, useState } from 'react';
import { FileText, GitBranch, Plus, Search } from 'lucide-react';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { ProjectCreateModal } from '../../components/ProjectCreateModal';
import { uploadLocalSources, type LocalSourceFile } from '../../components/projectLocalFiles';
import { githubRepositoryName, saveCheckDocuments } from '../../check/runner';
import type { Artifact, ProjectRepositoryInput } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { CheckDocumentPicker } from './CheckDocumentPicker';

export function useCheckLibrary(projectId?: string) {
  const [result, setResult] = useState<{ projectId: string; items: Artifact[] | null; error: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void api.listArtifacts(projectId).then(result => {
      if (!active) return;
      setResult({ projectId, items: result.filter(item => item.projectId === projectId && !item.currency?.deprecated), error: false });
    }).catch(() => {
      if (active) setResult(current => ({ projectId, items: current?.projectId === projectId ? current.items : null, error: true }));
    });
    return () => { active = false; };
  }, [projectId, revision]);
  const current = result?.projectId === projectId ? result : null;
  return { items: current?.items ?? null, error: current?.error ?? false, refresh };
}

export type CheckLibrary = ReturnType<typeof useCheckLibrary>;

export function CheckLibraryList({ library, onAttach, attached = [], filter, compact = false }: {
  library: CheckLibrary;
  onAttach?: (artifact: Artifact) => void;
  attached?: Pick<Artifact, 'id'>[];
  filter?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const search = (filter ?? query).trim().toLowerCase();
  const matches = library.items?.filter(item => [item.fileName, item.filePath].some(value => value?.toLowerCase().includes(search))) ?? [];
  if (library.error && !library.items) return <p role="status">Source library could not be loaded.</p>;
  if (!library.items) return <p role="status">Loading library…</p>;
  if (!library.items.length) return <p>No sources in this project yet.</p>;
  return <>
    {filter === undefined && (compact || library.items.length > 10) && <label className="ck-popover-search"><Icon icon={Search} /><input type="search" aria-label="Search library" placeholder="Search library" value={query} onChange={event => setQuery(event.target.value)} /></label>}
    {!matches.length && <p>No matching sources.</p>}
    <ul className={compact ? "ck-library-list is-compact" : "ck-library-list"}>
      {matches.slice(0, 80).map(item => <li key={item.id}>
        {onAttach ? <button type="button" disabled={attached.some(source => source.id === item.id)} onClick={() => onAttach(item)}>
          <Icon icon={Plus} /><span>{item.filePath || item.fileName}</span>
        </button> : compact ? <div className="ck-source-row" title={item.filePath || item.fileName}>
          <Icon icon={FileText} /><div><strong>{(item.fileName || item.filePath || 'Source').split(/[\\/]/).filter(Boolean).at(-1)}</strong></div>
        </div> : <span title={item.filePath || item.fileName}>{item.filePath || item.fileName}</span>}
      </li>)}
    </ul>
    {matches.length > 80 && <p>Search to find more files.</p>}
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
