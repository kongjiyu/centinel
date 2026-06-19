import { FolderOpen, CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import type { Project, AiProviderSetting, Screen } from '../types';

type Props = {
  projects: Project[];
  aiSettings: AiProviderSetting[];
  onNavigate: (screen: Screen) => void;
};

export function DashboardScreen({ projects, aiSettings, onNavigate }: Props) {
  const textOk = aiSettings.some(s => s.id === 'text' && s.hasApiKey);
  const visionOk = aiSettings.some(s => s.id === 'vision' && s.hasApiKey);

  const readiness = [
    { label: 'Project created', done: projects.length > 0 },
    { label: 'Text AI configured', done: textOk },
    { label: 'Vision AI configured', done: visionOk },
  ];

  const allReady = readiness.every(r => r.done);

  return (
    <div className="screen">
      <h1>Dashboard</h1>

      {/* Operational Stats */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-icon">
            <FolderOpen size={20} />
          </div>
          <div className="stat-content">
            <span className="stat-value">{projects.length}</span>
            <span className="stat-label">Projects</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon text">
            <span className="stat-icon-text">T</span>
          </div>
          <div className="stat-content">
            <span className={`stat-value ${textOk ? 'ok' : 'err'}`}>
              {textOk ? 'Ready' : '—'}
            </span>
            <span className="stat-label">Text AI</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon vision">
            <span className="stat-icon-text">V</span>
          </div>
          <div className="stat-content">
            <span className={`stat-value ${visionOk ? 'ok' : 'err'}`}>
              {visionOk ? 'Ready' : '—'}
            </span>
            <span className="stat-label">Vision AI</span>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="dashboard-columns">
        {/* Left: Readiness */}
        <div className="panel">
          <div className="panel-header">
            <h3>System Readiness</h3>
          </div>
          <div className="readiness-list">
            {readiness.map((item, i) => (
              <div key={i} className="readiness-item">
                {item.done ? (
                  <CheckCircle2 size={16} className="readiness-check done" />
                ) : (
                  <Circle size={16} className="readiness-check pending" />
                )}
                <span className={item.done ? 'done' : 'pending'}>{item.label}</span>
              </div>
            ))}
          </div>
          {!allReady && (
            <div className="panel-footer">
              <span className="readiness-hint">
                Configure missing providers in Settings to enable all features.
              </span>
            </div>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="panel">
          <div className="panel-header">
            <h3>Quick Actions</h3>
          </div>
          <div className="quick-actions">
            <button className="quick-action" onClick={() => onNavigate({ name: 'projects' })}>
              <FolderOpen size={16} />
              <span>View Projects</span>
              <ArrowRight size={14} className="quick-action-arrow" />
            </button>
            <button className="quick-action" onClick={() => onNavigate({ name: 'settings' })}>
              <span className="quick-action-icon-text">⚙</span>
              <span>AI Settings</span>
              <ArrowRight size={14} className="quick-action-arrow" />
            </button>
          </div>
        </div>
      </div>

      {/* Recent Projects */}
      {projects.length > 0 && (
        <div className="panel" style={{ marginTop: '16px' }}>
          <div className="panel-header">
            <h3>Recent Projects</h3>
            <button className="btn-link" onClick={() => onNavigate({ name: 'projects' })}>
              View all →
            </button>
          </div>
          <div className="project-list">
            {projects.slice(0, 5).map(p => (
              <div
                key={p.id}
                className="project-row"
                onClick={() => onNavigate({ name: 'project-detail', projectId: p.id })}
              >
                <div className="project-info">
                  <span className="project-name">{p.name}</span>
                  {p.description && (
                    <span className="project-desc">{p.description}</span>
                  )}
                </div>
                <span className="project-date">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="empty-state">
          <FolderOpen size={40} strokeWidth={1.5} />
          <p>No projects yet</p>
          <button className="btn-primary" onClick={() => onNavigate({ name: 'projects' })}>
            Create your first project
          </button>
        </div>
      )}
    </div>
  );
}
