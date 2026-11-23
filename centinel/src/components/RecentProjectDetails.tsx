import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/api/dialog';
import { userFacingError } from '../utils/userFacingError';
import { api } from '../api/client';
import type { Project } from '../types';
import { FolderOpen, Settings } from 'lucide-react';
import { Modal } from './Modal';
import { OverflowText } from './OverflowText';
import './RecentProjectDetails.css';

type ImportSource = { id: string; name: string; location?: string; importedAt?: string };
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function formatDate(value?: string) {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? 'Unavailable' : dateFormat.format(date);
}

type SourceResult = { sources: ImportSource[]; incomplete: boolean };

export function useImportSources(projectId?: string) {
  const [result, setResult] = useState<SourceResult | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setResult(null);
    void Promise.allSettled([api.listConnectedSources(projectId), api.listArtifacts(projectId)])
      .then(([connected, artifacts]) => {
        if (!active) return;
        const sources = new Map<string, ImportSource>();
        if (connected.status === 'fulfilled') {
          for (const source of connected.value) {
            if (source.status !== 'removed') {
              sources.set(source.id, { id: source.id, name: source.name, location: source.remoteUrl ?? undefined, importedAt: source.lastSuccessfulSyncAt ?? undefined });
            }
          }
        }
        if (artifacts.status === 'fulfilled') {
          const connectedIds = new Set(sources.keys());
          for (const artifact of artifacts.value) {
            if (artifact.source === 'repository' && artifact.sourceId && artifact.localRepositoryName) {
              const existing = sources.get(artifact.sourceId);
              if (!existing) {
                sources.set(artifact.sourceId, { id: artifact.sourceId, name: artifact.localRepositoryName,
                  location: artifact.originalPath ?? artifact.filePath, importedAt: artifact.createdAt });
              } else if (!existing.importedAt || (!connectedIds.has(artifact.sourceId) && artifact.createdAt && artifact.createdAt < existing.importedAt)) {
                existing.importedAt = artifact.createdAt;
                if (!connectedIds.has(artifact.sourceId)) existing.location = artifact.originalPath ?? artifact.filePath;
              }
            }
          }
        }
        setResult({ sources: [...sources.values()], incomplete: connected.status === 'rejected' || artifacts.status === 'rejected' });
      });
    return () => { active = false; };
  }, [projectId]);
  return result;
}

export function RecentProjectDetails({ project, anchor, onClose, onEdit, onUpdated, onPreviewEnter }: {
  project: Project;
  anchor: DOMRect | null;
  onClose: () => void;
  onEdit: () => void;
  onPreviewEnter: () => void;
  onUpdated?: (project: Project) => void;
}) {
  const result = useImportSources(project.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const formId = useId();
  const workspace = project.workspacePath.trim();
  const selectedWorkspace = workspace && workspace !== project.managedWorkspacePath ? workspace : '';
  const draftWorkspace = draft.workspacePath === draft.managedWorkspacePath ? '' : draft.workspacePath;
  const created = <time dateTime={project.createdAt}>{formatDate(project.createdAt)}</time>;
  const startEdit = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDraft(project);
    setError('');
    setEditing(true);
    if (anchor) onEdit();
  };
  const chooseFolder = async () => {
    try {
      const folder = await open({ directory: true, multiple: false, title: 'Choose workspace folder' });
      if (typeof folder === 'string') {
        setDraft(value => ({ ...value, workspacePath: folder }));
        setError('');
      }
    } catch {
      setError('The folder picker could not open. Try again in the desktop app.');
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !draft.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateProject(project.id, {
        name: draft.name.trim(), description: draft.description.trim(),
        ...(draftWorkspace ? { workspacePath: draftWorkspace } : {}),
      });
      onUpdated?.(updated);
      setEditing(false);
    } catch (cause) {
      setError(userFacingError(cause, 'The project could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };
  const summary = (
    <dl className="recent-project-details">
      <dt>Project name</dt>
      <dd className="recent-project-description">{project.name}</dd>
      <dt>Description</dt>
      <dd className="recent-project-description">{project.description.trim() || 'No description added.'}</dd>
      <dt>Workspace</dt>
      <dd className="recent-project-workspace" tabIndex={selectedWorkspace ? 0 : undefined}>
        {selectedWorkspace ? <OverflowText text={selectedWorkspace} /> : <span className="recent-project-workspace-note">Workspace is not selected</span>}
      </dd>
      <dt>Created</dt>
      <dd>{created}</dd>
      <dt>Source</dt>
      <dd className="recent-project-sources" data-clipped={(result?.sources.length ?? 0) > 2 || undefined}>
        {!!result?.sources.length && <table aria-label="Sources and import times"><tbody>
          {result.sources.map(source => <tr key={source.id}>
            <th scope="row"><span>{source.name}</span>{source.location && <small>{source.location}</small>}</th>
            <td><time dateTime={source.importedAt}>{formatDate(source.importedAt)}</time></td>
          </tr>)}
        </tbody></table>}
        {!result && <p role="status">Loading sources…</p>}
        {result?.incomplete && <p role="status">Some sources could not be loaded.</p>}
        {result && !result.incomplete && !result.sources.length && <p>No sources recorded.</p>}
      </dd>
    </dl>
  );
  const editAction = <button key="edit-project" type="button" className="recent-project-edit-action" onClick={startEdit}><Settings size={17} aria-hidden="true" />Edit project</button>;
  if (anchor) {
    const rightSpace = window.innerWidth - anchor.right - 12;
    const leftSpace = anchor.left - 12;
    const placeRight = rightSpace >= 360 || rightSpace >= leftSpace;
    const width = Math.min(360, placeRight ? rightSpace : leftSpace);
    const left = placeRight ? anchor.right : anchor.left - width;
    const maxHeight = Math.min(430, window.innerHeight - 24);
    const top = Math.max(12, Math.min(anchor.top, window.innerHeight - maxHeight - 12));
    return createPortal(
      <section aria-label="Project details preview" className="recent-project-preview"
        style={{ left, top, width, height: maxHeight }} onPointerEnter={onPreviewEnter} onPointerLeave={onClose}>
        <div className="recent-project-preview-body">{summary}</div>
        <footer className="modal-footer is-project-action">{editAction}</footer>
      </section>, document.body,
    );
  }
  return (
    <Modal isOpen onClose={() => { if (!saving) onClose(); }} title={editing ? 'Edit project' : 'Project details'}
      overlayClassName="recent-project-dialog" footer={editing ? <>
        <button key="save-project" type="submit" form={formId} className="btn-primary" disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </> : editAction}>
      {editing ? <form id={formId} className="recent-project-edit" onSubmit={save}>
        <label>Project name<input autoFocus required value={draft.name} disabled={saving}
          onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
        <label>Description<textarea rows={3} value={draft.description} disabled={saving}
          onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></label>
        <div className="recent-project-edit-row">
          <div>Workspace{!draftWorkspace && <p className="recent-project-workspace-note">Workspace is not selected</p>}</div>
          <button type="button" className="recent-project-picker" aria-label={`Choose workspace folder${draftWorkspace ? ': ' + draftWorkspace : ''}`}
            aria-haspopup="dialog" disabled={saving} onClick={() => void chooseFolder()}>
            <OverflowText text={draftWorkspace || 'Choose workspace folder'} /><FolderOpen size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="recent-project-edit-row"><span>Created</span>{created}</div>
        {error && <p role="alert">{error}</p>}
      </form> : summary}
    </Modal>
  );
}
