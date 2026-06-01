import type { Project, Screen } from '../types';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
};

export function ProjectDetailScreen({ project, onNavigate }: Props) {
  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'projects' })}>
          Back
        </button>
        <h1>{project.name}</h1>
      </div>

      {project.description && <p className="project-description">{project.description}</p>}

      <div className="detail-meta">
        <span>Workspace: <code>{project.workspacePath}</code></span>
        <span>Created: {new Date(project.createdAt).toLocaleString()}</span>
      </div>

      <div className="detail-grid">
        <div className="card empty-card">
          <h3>Static Review</h3>
          <p className="card-empty">No reviews yet.</p>
        </div>
        <div className="card empty-card">
          <h3>Dynamic Testing</h3>
          <p className="card-empty">No tests yet.</p>
        </div>
        <div className="card empty-card">
          <h3>Findings</h3>
          <p className="card-empty">No findings yet.</p>
        </div>
        <div className="card empty-card">
          <h3>Reports</h3>
          <p className="card-empty">No reports yet.</p>
        </div>
      </div>
    </div>
  );
}
