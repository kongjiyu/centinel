import './ProjectCreateModal.css';
import { useRef, useState } from 'react';
import { FolderGit2, GitBranch, Plus } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { GitHubRepositoryPicker } from './GitHubRepositoryPicker';
import { Modal } from './Modal';
import type { Project, ProjectCreationResult, ProjectRepositoryInput } from '../types';
import { userFacingError } from '../utils/userFacingError';
import { isSupportedLocalSource, MAX_LOCAL_SOURCE_FILES, readDroppedLocalSources, uploadLocalSources, type LocalSourceFile } from './projectLocalFiles';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, sources: ProjectRepositoryInput[]) => Promise<ProjectCreationResult | void>;
  onCreated?: (project: Project) => void;
  onRepositorySelected?: (source: ProjectRepositoryInput) => void;
  onLocalFilesSelected?: (files: LocalSourceFile[]) => void;
};

/**
 * The project creation form is shared by the directory and New review entry
 * flows. Keeping it in a dialog means a reviewer can create a project without
 * losing the review objective they have already entered.
 */
export function ProjectCreateModal({ isOpen, onClose, onCreate, onCreated, onRepositorySelected, onLocalFilesSelected }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sources, setSources] = useState<ProjectRepositoryInput[]>([]);
  const [localFiles, setLocalFiles] = useState<LocalSourceFile[]>([]);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<'local' | 'link' | 'account'>('local');
  const [repoUrl, setRepoUrl] = useState('');
  const [selectedRepository, setSelectedRepository] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [createdWithWarnings, setCreatedWithWarnings] = useState<ProjectCreationResult | null>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setSources([]);
    setLocalFiles([]);
    setLocalNote(null);
    setDragging(false);
    setMethod('local');
    setRepoUrl('');
    setSelectedRepository('');
    setError(null);
    setCreatedWithWarnings(null);
  };

  const close = () => {
    if (creating || picking) return;
    if (createdWithWarnings) onCreated?.(createdWithWarnings);
    reset();
    onClose();
  };

  const chooseFolder = async () => {
    setPicking(true);
    try {
      const selected = await open({ directory: true, multiple: !onRepositorySelected, title: 'Choose local repositories' });
      const folders = typeof selected === 'string' ? [selected] : selected ?? [];
      if (onRepositorySelected && folders[0]) {
        onRepositorySelected({ type: 'local-repository', path: folders[0] });
        reset();
        return;
      }
      setSources(current => {
        const paths = new Set(current.filter(source => source.type === 'local-repository').map(source => source.path));
        return [...current, ...[...new Set(folders)].filter(path => !paths.has(path)).map(path => ({ type: 'local-repository' as const, path }))];
      });
      setError(null);
    } catch {
      setError('The folder picker could not open. Try again in the desktop app.');
    } finally {
      setPicking(false);
    }
  };

  const stageFiles = (files: LocalSourceFile[], limited = false) => {
    const selected = new Map(localFiles.map(file => [file.path, file]));
    for (const file of files) {
      if (isSupportedLocalSource(file) && !selected.has(file.path)) {
        if (selected.size === MAX_LOCAL_SOURCE_FILES) { limited = true; break; }
        selected.set(file.path, file);
      }
    }
    setLocalFiles([...selected.values()]);
    setLocalNote(limited ? 'Folder limit reached. Choose folders for a full repository import, or add up to 200 individual files.'
      : files.some(file => !isSupportedLocalSource(file)) ? 'Skipped unsupported, empty, or oversized files. Each file can be up to 10 MB.'
        : files.length ? null : 'No readable files were found.');
    setError(null);
  };

  const parseGitHub = (url: string) => {
    const value = url.trim();
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(value)) return null;
    return { type: 'github' as const, repoUrl: `https://github.com/${new URL(value).pathname.slice(1).replace(/\/$/, '').replace(/\.git$/i, '')}` };
  };

  const appendGitHub = (github: Extract<ProjectRepositoryInput, { type: 'github' }>) =>
    sources.some(source => source.type === 'github' && source.repoUrl.toLowerCase() === github.repoUrl.toLowerCase()) ? sources : [...sources, github];

  const addGitHub = (url = repoUrl) => {
    const github = parseGitHub(url);
    if (!github) return setError('Enter a valid GitHub repository URL');
    if (onRepositorySelected) {
      onRepositorySelected(github);
      reset();
      return;
    }
    setSources(appendGitHub(github));
    setRepoUrl('');
    setSelectedRepository('');
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setError('Project name is required');
      return;
    }
    if (trimmedName.length > 80) {
      setError('Name must be 80 characters or less');
      return;
    }
    if (trimmedDescription.length > 500) {
      setError('Description must be 500 characters or less');
      return;
    }
    const github = repoUrl.trim() ? parseGitHub(repoUrl) : null;
    if (repoUrl.trim() && !github) {
      setError('Enter a valid GitHub repository URL');
      return;
    }
    const selected = github ? appendGitHub(github) : sources;

    setCreating(true);
    try {
      const created = await onCreate(trimmedName, trimmedDescription, selected);
      const warnings = created ? await uploadLocalSources(created.id, localFiles) : [];
      if (created && (created.sourceImportWarnings?.length || warnings.length)) {
        setCreatedWithWarnings({ ...created, sourceImportWarnings: [...(created.sourceImportWarnings ?? []), ...warnings] });
        return;
      }
      reset();
      if (created) onCreated?.(created);
      onClose();
    } catch (cause) {
      setError(userFacingError(cause, 'The project could not be created. Try again.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={onRepositorySelected ? "Add Repository" : "Add Project"} width={620}>
      {createdWithWarnings ? <div className="project-create-modal-form">
        <p role="status">{createdWithWarnings.name} was created. Some sources need attention.</p>
        <ul>{createdWithWarnings.sourceImportWarnings?.map(warning => <li key={warning}>{warning}</li>)}</ul>
        <div className="form-actions"><button type="button" className="btn-primary" onClick={close}>Done</button></div>
      </div> :
      <form className="project-create-modal-form" onSubmit={event => { event.preventDefault(); if (!onRepositorySelected) void submit(); }}>
        {!onRepositorySelected && <>
        <div className="form-field">
          <label htmlFor="project-modal-name">Project name <span className="project-required-mark" aria-hidden="true">*</span></label>
          <input id="project-modal-name" data-autofocus value={name} onChange={event => setName(event.target.value)} maxLength={80} required />
        </div>
        <div className="form-field">
          <label htmlFor="project-modal-description">Description <span className="field-optional">Optional</span></label>
          <textarea id="project-modal-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} />
        </div>
        </>}
        <fieldset className="project-source-choice" disabled={creating || picking}>
          <legend>Source repositories</legend>
          <div className="project-source-methods">
            <div className="project-source-tabs" role="group" aria-label="Repository source">
              {([['local', 'Local'], ['account', 'GitHub'], ['link', 'Link']] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={method === key} onClick={() => {
                  if (method !== key) setSelectedRepository('');
                  setMethod(key);
                  setError(null);
                }}>{label}</button>
              ))}
            </div>
            {method === 'local' && <div className="project-source-drop" data-dragging={dragging || undefined}
              onDragOver={event => {
                if ((!onRepositorySelected || onLocalFilesSelected) && event.dataTransfer.types.includes('Files')) {
                  event.preventDefault();
                  if (!creating && !picking) setDragging(true);
                }
              }}
              onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
              onDrop={event => {
                if (onRepositorySelected && !onLocalFilesSelected) return;
                event.preventDefault();
                setDragging(false);
                if (creating || picking || !event.dataTransfer.types.includes('Files')) return;
                setPicking(true);
                void readDroppedLocalSources(event.dataTransfer).then(({ files, limited }) => stageFiles(files, limited))
                  .catch(() => setError('The dropped files could not be read. Choose files or folders instead.'))
                  .finally(() => setPicking(false));
              }}>
              <FolderGit2 size={20} aria-hidden="true" />
              <span>{onRepositorySelected && !onLocalFilesSelected ? 'Select a local repository folder' : 'Drop files or a folder here'}</span>
              <div className="project-source-pickers">
                {(!onRepositorySelected || onLocalFilesSelected) && <button type="button" className="btn-link" onClick={() => fileInput.current?.click()}>Choose files</button>}
                <button type="button" className="btn-link" data-autofocus={onRepositorySelected ? true : undefined} onClick={() => void chooseFolder()}>{onRepositorySelected ? 'Choose folder' : 'Choose folders'}</button>
              </div>
              <input ref={fileInput} type="file" multiple hidden aria-label="Local source files" onChange={event => {
                stageFiles(Array.from(event.target.files ?? [], file => ({ file, path: file.name })));
                event.target.value = '';
              }} />
            </div>}
            {method === 'account' && <>
              <GitHubRepositoryPicker selection={selectedRepository} onSelect={setSelectedRepository} />
              {!onRepositorySelected && <button type="button" className="btn-secondary project-repository-add" disabled={!selectedRepository}
                onClick={() => addGitHub(selectedRepository)}>Add repository</button>}
            </>}
            {method === 'link' && <div className="project-source-link" id="project-github-fields">
              <label htmlFor="project-github-url">GitHub repository URL</label>
              <input id="project-github-url" type="url" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addGitHub(); } }} placeholder="https://github.com/owner/repository" />
              <button type="button" className="btn-secondary" disabled={!repoUrl.trim()} onClick={() => addGitHub()}><Plus size={16} aria-hidden="true" /> Add link</button>
            </div>}
          </div>
          {(sources.length > 0 || localFiles.length > 0) && <ul className="project-source-list">{sources.map((source, index) => {
            const location = source.type === 'github' ? source.repoUrl : source.path;
            const Icon = source.type === 'github' ? GitBranch : FolderGit2;
            return <li key={location}><Icon size={16} aria-hidden="true" /><span>{location}</span><button type="button" className="btn-link" aria-label={`Remove ${location}`} onClick={() => setSources(current => current.filter((_, item) => item !== index))}>Remove</button></li>;
          })}{localFiles.map(({ path }) => <li key={path}><FolderGit2 size={16} aria-hidden="true" /><span>{path}</span>
            <button type="button" className="btn-link" aria-label={`Remove ${path}`} onClick={() => setLocalFiles(files => files.filter(file => file.path !== path))}>Remove</button></li>)}</ul>}
        </fieldset>
        {localNote && <p className="project-source-note" role="status">{localNote}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={creating || picking}>Cancel</button>
          {onRepositorySelected && method === 'account' && <button type="button" className="btn-primary" disabled={!selectedRepository || picking}
            onClick={() => addGitHub(selectedRepository)}>Add repository</button>}
          {!onRepositorySelected && <button type="submit" className="btn-primary" disabled={creating || picking || !name.trim()}>
            {creating ? 'Adding…' : 'Add project'}
          </button>}
          {onLocalFilesSelected && localFiles.length > 0 && <button type="button" className="btn-primary" disabled={picking} onClick={() => {
            onLocalFilesSelected(localFiles);
            reset();
          }}>Add files</button>}
        </div>
      </form>}
    </Modal>
  );
}
