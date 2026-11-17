import { useCallback, useEffect, useState } from 'react';
import { FileText, GitBranch, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { ProjectCreateModal } from '../../components/ProjectCreateModal';
import { documentType, githubRepositoryName } from '../../check/runner';
import type { Artifact, ProjectRepositoryInput } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { CheckDocumentPicker, readCheckDocuments } from './CheckDocumentPicker';

export function useCheckLibrary(projectId?: string) {
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void api.listArtifacts(projectId).then(result => {
      if (!active) return;
      setItems(result.filter(item => item.projectId === projectId && !item.currency?.deprecated));
      setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [projectId, revision]);
  return { items, error, refresh };
}

export type CheckLibrary = ReturnType<typeof useCheckLibrary>;

export function CheckLibraryList({ library, onAttach, attached = [], filter }: {
  library: CheckLibrary;
  onAttach?: (artifact: Artifact) => void;
  attached?: Artifact[];
  filter?: string;
}) {
  const [query, setQuery] = useState('');
  const search = (filter ?? query).trim().toLowerCase();
  const matches = library.items?.filter(item => (item.filePath || item.fileName).toLowerCase().includes(search)) ?? [];
  if (library.error && !library.items) return <p role="status">Source library could not be loaded.</p>;
  if (!library.items) return <p role="status">Loading library…</p>;
  if (!library.items.length) return <p>No sources in this project yet.</p>;
  return <>
    {filter === undefined && library.items.length > 10 && <input type="search" aria-label="Search library" placeholder="Search library" value={query} onChange={event => setQuery(event.target.value)} />}
    {!matches.length && <p>No matching sources.</p>}
    <ul className="ck-library-list">
      {matches.slice(0, 80).map(item => <li key={item.id}>
        {onAttach ? <button type="button" disabled={attached.some(source => source.id === item.id)} onClick={() => onAttach(item)}>
          <Icon icon={Plus} /><span>{item.filePath || item.fileName}</span>
        </button> : <span title={item.filePath || item.fileName}>{item.filePath || item.fileName}</span>}
      </li>)}
    </ul>
    {matches.length > 80 && <p>Search to find more files.</p>}
  </>;
}

export function CheckAddSource({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<'choose' | 'documents' | 'repository' | 'saving'>('choose');
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
  return <>
    <Modal isOpen={step === 'choose' || step === 'saving'} onClose={step === 'saving' ? () => undefined : onClose} title="Add source">
      <div className="ck-document-actions">
        <button type="button" className="ck-button" disabled={step === 'saving'} onClick={() => setStep('documents')}><Icon icon={FileText} />Add documents</button>
        <button type="button" className="ck-button" disabled={step === 'saving'} onClick={() => setStep('repository')}><Icon icon={GitBranch} />Add repository</button>
      </div>
      {step === 'saving' && <p role="status">Adding sources…</p>}
      {message && <p role="status">{message}</p>}
    </Modal>
    <CheckDocumentPicker open={step === 'documents'} onClose={onClose} onSelect={files => void save(async () => {
      const { accepted, message: note } = await readCheckDocuments(files);
      for (const document of accepted) await api.uploadArtifact(projectId, { fileName: document.name, content: document.base64, type: documentType(document.name) });
      return note;
    })} closeOnSelect={false} />
    <ProjectCreateModal isOpen={step === 'repository'} onClose={() => setStep(current => current === 'repository' ? 'choose' : current)}
      onCreate={async () => undefined} onRepositorySelected={importRepository} />
  </>;
}
