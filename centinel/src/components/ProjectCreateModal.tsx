import './ProjectCreateModal.css';
import { useState } from 'react';
import { FolderGit2, GitBranch, Plus } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { GitHubRepositoryPicker } from './GitHubRepositoryPicker';
import { Modal } from './Modal';
import type { Project, ProjectCreationResult, ProjectRepositoryInput } from '../types';
import { userFacingError } from '../utils/userFacingError';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, sources: ProjectRepositoryInput[]) => Promise<ProjectCreationResult | void>;
  onCreated?: (project: Project) => void;
  onRepositorySelected?: (source: ProjectRepositoryInput) => void;
};

/**
 * The project creation form is shared by the directory and New review entry
 * flows. Keeping it in a dialog means a reviewer can create a project without
 * losing the review objective they have already entered.
 */
export function ProjectCreateModal({ isOpen, onClose, onCreate, onCreated, onRepositorySelected }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sources, setSources] = useState<ProjectRepositoryInput[]>([]);
  const [method, setMethod] = useState<'local' | 'link' | 'account' | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [createdWithWarnings, setCreatedWithWarnings] = useState<ProjectCreationResult | null>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setSources([]);
    setMethod(null);
    setRepoUrl('');
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
        onClose();
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
      onClose();
      return;
    }
    setSources(appendGitHub(github));
    setRepoUrl('');
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
      if (created?.sourceImportWarnings?.length) {
        setCreatedWithWarnings(created);
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
          <legend>Source repositories {!onRepositorySelected && <span className="field-optional">Optional</span>}</legend>
          <div className="project-source-methods">
            <div className="project-source-actions">
              <button type="button" className="btn-secondary project-source-action" aria-label="Add local folders" aria-pressed={method === "local"} onClick={() => { setMethod("local"); void chooseFolder(); }}><FolderGit2 size={18} aria-hidden="true" /><span><strong>Add local folders</strong><small>Choose folders from this device</small></span></button>
              <button type="button" className="btn-secondary project-source-action" aria-label="Add GitHub link" aria-expanded={method === "link"} aria-controls="project-github-fields" onClick={() => { setMethod("link"); setError(null); }}><GitBranch size={18} aria-hidden="true" /><span><strong>Add GitHub link</strong><small>Paste a repository URL</small></span></button>
            </div>
            <button type="button" className="btn-secondary project-github-account" aria-expanded={method === "account"} onClick={() => { setMethod("account"); setError(null); }}>Select from GitHub account</button>
            {method === 'account' && <GitHubRepositoryPicker onSelect={addGitHub} />}
            {method === 'link' && <div className="project-source-link" id="project-github-fields">
              <label htmlFor="project-github-url">GitHub repository URL</label>
              <input id="project-github-url" type="url" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addGitHub(); } }} placeholder="https://github.com/owner/repository" />
              <button type="button" className="btn-secondary" disabled={!repoUrl.trim()} onClick={() => addGitHub()}><Plus size={16} aria-hidden="true" /> Add link</button>
            </div>}
          </div>
          {sources.length > 0 && <ul className="project-source-list">{sources.map((source, index) => {
            const location = source.type === 'github' ? source.repoUrl : source.path;
            const Icon = source.type === 'github' ? GitBranch : FolderGit2;
            return <li key={location}><Icon size={16} aria-hidden="true" /><span>{location}</span><button type="button" className="btn-link" aria-label={`Remove ${location}`} onClick={() => setSources(current => current.filter((_, item) => item !== index))}>Remove</button></li>;
          })}</ul>}
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={creating || picking}>Cancel</button>
          {!onRepositorySelected && <button type="submit" className="btn-primary" disabled={creating || picking || !name.trim()}>
            {creating ? 'Adding…' : 'Add project'}
          </button>}
        </div>
      </form>}
    </Modal>
  );
}
