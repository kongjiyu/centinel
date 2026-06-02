import { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import type { Project, Screen } from '../types';

type Props = {
  projects: Project[];
  onNavigate: (screen: Screen) => void;
  onCreate: (name: string, description: string, workspacePath: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function ProjectsScreen({ projects, onNavigate, onCreate, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleChooseFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose project workspace',
    });
    if (typeof selected === 'string') {
      setWorkspacePath(selected);
    }
  };

  const handleCreate = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    if (name.trim().length > 80) {
      setError('Project name must be 80 characters or less');
      return;
    }
    if (description.trim().length > 500) {
      setError('Description must be 500 characters or less');
      return;
    }
    if (!workspacePath) {
      setError('Workspace folder is required');
      return;
    }
    setCreating(true);
    try {
      await onCreate(name.trim(), description.trim(), workspacePath);
      setName('');
      setDescription('');
      setWorkspacePath('');
      setShowForm(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Remove this project from Centinel? Local files will be kept.')) return;
    await onDelete(id);
  };

  const canCreate = name.trim() && workspacePath;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>Projects</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'New Project'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-field">
            <label>Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Project name"
              maxLength={80}
            />
          </div>
          <div className="form-field">
            <label>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="form-field">
            <label>Workspace Folder</label>
            <div className="workspace-picker">
              <input
                value={workspacePath}
                readOnly
                placeholder="No folder selected"
                className="workspace-input"
              />
              <button className="btn-secondary" onClick={handleChooseFolder}>
                Choose Folder
              </button>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="btn-primary" onClick={handleCreate} disabled={creating || !canCreate}>
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      )}

      {projects.length === 0 && !showForm && (
        <div className="empty-state">
          <p>No projects yet. Create one to get started.</p>
        </div>
      )}

      <div className="project-list">
        {projects.map(p => (
          <div
            key={p.id}
            className="project-row"
            onClick={() => onNavigate({ name: 'project-detail', projectId: p.id })}
          >
            <div className="project-info">
              <span className="project-name">{p.name}</span>
              {p.description && <span className="project-desc">{p.description}</span>}
            </div>
            <div className="project-meta">
              <span className="project-date">{new Date(p.createdAt).toLocaleDateString()}</span>
              <button className="btn-delete" onClick={e => handleDelete(e, p.id)} title="Delete project">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
