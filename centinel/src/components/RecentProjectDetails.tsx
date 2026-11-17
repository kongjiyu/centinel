import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Project } from '../types';
import { Modal } from './Modal';

type ImportSource = { id: string; name: string; location?: string };
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
              sources.set(source.id, { id: source.id, name: source.name, location: source.remoteUrl ?? undefined });
            }
          }
        }
        if (artifacts.status === 'fulfilled') {
          for (const artifact of artifacts.value) {
            if (artifact.source === 'repository' && artifact.sourceId && artifact.localRepositoryName && !sources.has(artifact.sourceId)) {
              sources.set(artifact.sourceId, { id: artifact.sourceId, name: artifact.localRepositoryName });
            }
          }
        }
        setResult({ sources: [...sources.values()], incomplete: connected.status === 'rejected' || artifacts.status === 'rejected' });
      });
    return () => { active = false; };
  }, [projectId]);
  return result;
}

export function RecentProjectDetails({ project, onClose, onEdit }: {
  project: Project;
  onClose: () => void;
  onEdit: () => void;
}) {
  const result = useImportSources(project.id);

  const workspace = project.managedWorkspacePath ? '' : project.workspacePath.trim();

  return (
    <Modal isOpen onClose={onClose} title="Project details">
      <div className="recent-project-details">
        <dl>
          <dt>Project name</dt>
          <dd>{project.name}</dd>
          <dt>Description</dt>
          <dd className="recent-project-description">{project.description.trim() || 'No description added.'}</dd>
          {project.managedWorkspacePath && <>
            <dt>App-managed folder</dt>
            <dd><code>{project.managedWorkspacePath}</code></dd>
          </>}
          <dt>Import sources</dt>
          <dd>
            {(workspace || !!result?.sources.length) && <ul>
              {workspace && <li><strong>Local workspace</strong><span>{workspace}</span></li>}
              {result?.sources.map(source => (
                <li key={source.id}><strong>{source.name}</strong>{source.location && <span>{source.location}</span>}</li>
              ))}
            </ul>}
            {!result && <p role="status">Loading import sources…</p>}
            {result?.incomplete && <p role="status">Some import sources could not be loaded.</p>}
            {result && !result.incomplete && !workspace && !result.sources.length && <p>No import sources recorded.</p>}
          </dd>
        </dl>
        <button type="button" className="btn-secondary" onClick={onEdit}>Edit project</button>
      </div>
    </Modal>
  );
}
