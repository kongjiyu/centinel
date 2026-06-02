import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import type { Project, DynamicSession, Screen } from '../types';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function ProjectDetailScreen({ project, onNavigate }: Props) {
  const [sessions, setSessions] = useState<DynamicSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.listDynamicSessions(project.id);
      setSessions(data);
    } catch {
      // ignore
    }
  }, [project.id]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Poll for active sessions
  useEffect(() => {
    const hasActive = sessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActive) return;
    const interval = setInterval(loadSessions, 2000);
    return () => clearInterval(interval);
  }, [sessions, loadSessions]);

  const handleCreate = async (data: {
    targetUrl: string;
    goal: string;
    missionType: 'user_journey' | 'smoke';
    maxSteps: number;
  }) => {
    setError(null);
    try {
      const session = await api.createDynamicSession(project.id, data);
      setShowForm(false);
      onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: session.id });
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

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
        <div className="card">
          <h3>Dynamic Testing</h3>
          {!showForm && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              New Dynamic Test
            </button>
          )}
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

      {showForm && (
        <DynamicTestForm onSubmit={handleCreate} onCancel={() => { setShowForm(false); setError(null); }} />
      )}

      {error && <p className="form-error">{error}</p>}

      {sessions.length > 0 && (
        <div className="section">
          <h2>Dynamic Test Sessions</h2>
          <div className="project-list">
            {sessions.map(s => (
              <div
                key={s.id}
                className="project-row"
                onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}
              >
                <div className="project-info">
                  <span className="project-name">{s.name}</span>
                  <span className="project-desc">{s.targetUrl}</span>
                </div>
                <div className="project-meta">
                  <StatusBadge status={s.status} />
                  <span className="project-date">{new Date(s.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
