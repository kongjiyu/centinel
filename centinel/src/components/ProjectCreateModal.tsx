import { useState } from 'react';
import { Folder } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { Modal } from './Modal';
import type { Project } from '../types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, workspacePath: string) => Promise<Project | void>;
  onCreated?: (project: Project) => void;
};

/**
 * The project creation form is shared by the directory and New review entry
 * flows. Keeping it in a dialog means a reviewer can create a project without
 * losing the review objective they have already entered.
 */
export function ProjectCreateModal({ isOpen, onClose, onCreate, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setWorkspacePath('');
    setError(null);
  };

  const close = () => {
    if (creating) return;
    reset();
    onClose();
  };

  const chooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose project workspace' });
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
    if (!workspacePath) {
      setError('Workspace folder is required');
      return;
    }

    setCreating(true);
    try {
      const created = await onCreate(trimmedName, trimmedDescription, workspacePath);
      reset();
      if (created) onCreated?.(created);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Create project" width={620}>
      <form className="project-create-modal-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p className="modal-intro">Create a workspace first, then add sources before starting a review.</p>
        <div className="form-field">
          <label htmlFor="project-modal-name">Project name <span aria-hidden="true">*</span></label>
          <input id="project-modal-name" data-autofocus value={name} onChange={event => setName(event.target.value)} maxLength={80} required />
        </div>
        <div className="form-field">
          <label htmlFor="project-modal-description">Description <span className="field-optional">Optional</span></label>
          <textarea id="project-modal-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} rows={3} />
        </div>
        <div className="form-field">
          <label htmlFor="project-modal-folder">Workspace folder <span aria-hidden="true">*</span></label>
          <div className="workspace-picker">
            <input id="project-modal-folder" value={workspacePath} readOnly placeholder="No folder selected" />
            <button type="button" className="btn-secondary" onClick={() => void chooseFolder()}>
              <Folder size={15} aria-hidden="true" /> Choose folder
            </button>
          </div>
          <p className="field-help">Selecting a folder does not import its files. Add sources after creating the project.</p>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={creating}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={creating || !name.trim() || !workspacePath}>
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

