import type { Project, AiProviderSetting, Screen } from '../types';

type Props = {
  projects: Project[];
  aiSettings: AiProviderSetting[];
  onNavigate: (screen: Screen) => void;
};

export function DashboardScreen({ projects, aiSettings, onNavigate }: Props) {
  const recentProjects = projects.slice(0, 5);
  const textOk = aiSettings.some(s => s.id === 'text' && s.hasApiKey);
  const visionOk = aiSettings.some(s => s.id === 'vision' && s.hasApiKey);

  return (
    <div className="screen">
      <h1>Dashboard</h1>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Projects</h3>
          <p className="card-value">{projects.length}</p>
          <button className="link-btn" onClick={() => onNavigate({ name: 'projects' })}>
            View all
          </button>
        </div>

        <div className="card">
          <h3>Text AI</h3>
          <p className={`card-value ${textOk ? 'pass' : 'fail'}`}>
            {textOk ? 'Configured' : 'Not configured'}
          </p>
        </div>

        <div className="card">
          <h3>Vision AI</h3>
          <p className={`card-value ${visionOk ? 'pass' : 'fail'}`}>
            {visionOk ? 'Configured' : 'Not configured'}
          </p>
        </div>
      </div>

      {recentProjects.length > 0 && (
        <div className="section">
          <h2>Recent Projects</h2>
          <div className="project-list">
            {recentProjects.map(p => (
              <div
                key={p.id}
                className="project-row"
                onClick={() => onNavigate({ name: 'project-detail', projectId: p.id })}
              >
                <span className="project-name">{p.name}</span>
                <span className="project-date">{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <div className="empty-state">
          <p>No projects yet.</p>
          <button className="btn-primary" onClick={() => onNavigate({ name: 'projects' })}>
            Create your first project
          </button>
        </div>
      )}
    </div>
  );
}
