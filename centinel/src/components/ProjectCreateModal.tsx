import { useState } from 'react';
import { FolderGit2, GitBranch } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { Modal } from './Modal';
import type { Project } from '../types';
import { userFacingError } from '../utils/userFacingError';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, workspacePath: string, source: ProjectCreateSource) => Promise<Project | void>;
  onCreated?: (project: Project) => void;
};

export type ProjectCreateSource =
  | { type: 'local-repository' }
  | { type: 'github'; repoUrl: string };

/**
 * The project creation form is shared by the directory and New review entry
 * flows. Keeping it in a dialog means a reviewer can create a project without
 * losing the review objective they have already entered.
 */
export function ProjectCreateModal({ isOpen, onClose, onCreate, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [sourceType, setSourceType] = useState<'local-repository' | 'github'>('local-repository');
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setWorkspacePath('');
    setSourceType('local-repository');
    setRepoUrl('');
    setError(null);
  };

  const close = () => {
    if (creating) return;
    reset();
    onClose();
  };

  const chooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose local Git repository' });
      if (typeof selected === 'string') {
        setWorkspacePath(selected);
        setError(null);
      }
    } catch {
      setError('The folder picker could not open. Try again in the desktop app.');
    }
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
    if (sourceType === 'local-repository' && !workspacePath) {
      setError('Choose a local repository');
      return;
    }
    if (sourceType === 'github' && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(repoUrl.trim())) {
      setError('Enter a valid GitHub repository URL');
      return;
    }

    setCreating(true);
    try {
      const source: ProjectCreateSource = sourceType === 'github'
        ? { type: 'github', repoUrl: repoUrl.trim() }
        : { type: 'local-repository' };
      const created = await onCreate(trimmedName, trimmedDescription, workspacePath, source);
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
    <Modal isOpen={isOpen} onClose={close} title="Create project" width={620}>
      <form className="project-create-modal-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p className="modal-intro">Create a project from a local Git repository or clone one from GitHub.</p>
        <div className="form-field">
          <label htmlFor="project-modal-name">Project name <span aria-hidden="true">*</span></label>
          <input id="project-modal-name" data-autofocus value={name} onChange={event => setName(event.target.value)} maxLength={80} required />
        </div>
        <div className="form-field">
          <label htmlFor="project-modal-description">Description <span className="field-optional">Optional</span></label>
          <textarea id="project-modal-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} />
        </div>
        <fieldset className="project-source-choice">
          <legend>Repository source</legend>
          <div>
            <label className={sourceType === 'local-repository' ? 'is-selected' : ''}><input type="radio" name="project-source" checked={sourceType === 'local-repository'} onChange={() => setSourceType('local-repository')} /><FolderGit2 size={18} aria-hidden="true" /><span><strong>Local repository</strong><small>Use a repository already on this computer.</small></span></label>
            <label className={sourceType === 'github' ? 'is-selected' : ''}><input type="radio" name="project-source" checked={sourceType === 'github'} onChange={() => setSourceType('github')} /><GitBranch size={18} aria-hidden="true" /><span><strong>GitHub</strong><small>Import a repository using your connected GitHub account.</small></span></label>
          </div>
        </fieldset>
        {sourceType === 'local-repository' ? <div className="form-field">
          <label htmlFor="project-modal-folder">Local repository <span aria-hidden="true">*</span></label>
          <div className="workspace-picker"><input id="project-modal-folder" value={workspacePath} readOnly placeholder="No repository selected" /><button type="button" className="btn-secondary" onClick={() => void chooseFolder()}><FolderGit2 size={15} aria-hidden="true" /> Choose repository</button></div>
          <p className="field-help">The project workspace defaults to this repository location.</p>
        </div> : <div className="form-field">
          <label htmlFor="project-github-url">GitHub repository URL <span aria-hidden="true">*</span></label>
          <input id="project-github-url" type="url" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" />
          <p className="field-help">Centinel clones this repository into its default project directory.</p>
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={creating}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={creating || !name.trim() || (sourceType === 'local-repository' ? !workspacePath : !repoUrl.trim())}>
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
