import { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { FolderOpen, Plus, Trash2, Folder, ArrowRight } from 'lucide-react';
import { CommandEmptyState, CommandPageHeader, IconButton } from '../components/CommandUI';
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
    if (!name.trim()) { setError('Project name is required'); return; }
    if (name.trim().length > 80) { setError('Name must be 80 characters or less'); return; }
    if (description.trim().length > 500) { setError('Description must be 500 characters or less'); return; }
    if (!workspacePath) { setError('Workspace folder is required'); return; }
    setCreating(true);
    try {
      await onCreate(name.trim(), description.trim(), workspacePath);
      setName(''); setDescription(''); setWorkspacePath(''); setShowForm(false);
    } catch (e) { setError(String(e)); }
    finally { setCreating(false); }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Remove this project from Centinel? Local files will be kept.')) return;
    await onDelete(id);
  };

  const canCreate = name.trim() && workspacePath;

  return (
    <div className="screen command-projects animate-fade-in">
      <CommandPageHeader
        eyebrow="Workspace Registry"
        title="Projects"
        description="Manage local workspaces and enter their static and dynamic testing operations."
        meta={<span>{projects.length} registered project{projects.length === 1 ? '' : 's'}</span>}
        actions={(
          <button className={showForm ? 'btn-secondary' : 'btn-primary'} onClick={() => setShowForm(!showForm)}>
            <Plus size={14} />
            {showForm ? 'Cancel' : 'New Project'}
          </button>
        )}
      />

      {showForm && (
        <div className="form-card animate-slide-up">
          <div className="form-field">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name" maxLength={80} />
          </div>
          <div className="form-field">
            <label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" maxLength={500} rows={3} />
          </div>
          <div className="form-field">
            <label>Workspace Folder</label>
            <div className="workspace-picker">
              <input value={workspacePath} readOnly placeholder="No folder selected" className="workspace-input" />
              <button className="btn-secondary" onClick={handleChooseFolder}>
                <Folder size={14} />
                Choose Folder
              </button>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="btn-primary" onClick={handleCreate} disabled={creating || !canCreate}>
              {creating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      )}

      {projects.length === 0 && !showForm && (
        <CommandEmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Register a local workspace to begin static review and autonomous UI testing."
          action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Create Project</button>}
        />
      )}

      {projects.length > 0 && (
        <div className="project-list stagger-children">
          {projects.map(p => (
            <div
              key={p.id}
              className="project-row"
              onClick={() => onNavigate({ name: 'project-detail', projectId: p.id })}
            >
              <div className="project-icon">
                <FolderOpen size={16} />
              </div>
              <div className="project-info">
                <span className="project-name">{p.name}</span>
                {p.description && <span className="project-desc">{p.description}</span>}
                <span className="project-workspace">{p.workspacePath}</span>
              </div>
              <div className="project-meta">
                <span className="project-date">{new Date(p.createdAt).toLocaleDateString()}</span>
                <IconButton icon={Trash2} label="Delete project" tone="danger" onClick={e => handleDelete(e, p.id)} />
              </div>
              <ArrowRight size={14} className="project-row-arrow" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
