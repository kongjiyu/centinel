import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import { ReviewModal } from '../components/ReviewModal';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import type { Project, DynamicSession, StaticSession, Screen, ReviewType } from '../types';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Traceability',
  cross_artifact_consistency: 'Consistency',
};

export function ProjectDetailScreen({ project, onNavigate }: Props) {
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [showDynamicForm, setShowDynamicForm] = useState(false);
  const [showStaticForm, setShowStaticForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadDynamicSessions = useCallback(async () => {
    try {
      const data = await api.listDynamicSessions(project.id);
      setDynamicSessions(data);
    } catch {
      // ignore
    }
  }, [project.id]);

  const loadStaticSessions = useCallback(async () => {
    try {
      const data = await api.listStaticSessions(project.id);
      setStaticSessions(data);
    } catch {
      // ignore
    }
  }, [project.id]);

  useEffect(() => {
    loadDynamicSessions();
    loadStaticSessions();
  }, [loadDynamicSessions, loadStaticSessions]);

  // Poll for active sessions
  useEffect(() => {
    const hasActiveDynamic = dynamicSessions.some(s => s.status === 'running' || s.status === 'queued');
    const hasActiveStatic = staticSessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActiveDynamic && !hasActiveStatic) return;
    const interval = setInterval(() => {
      loadDynamicSessions();
      loadStaticSessions();
    }, 2000);
    return () => clearInterval(interval);
  }, [dynamicSessions, staticSessions, loadDynamicSessions, loadStaticSessions]);

  const handleCreateDynamic = async (data: {
    targetUrl: string;
    goal: string;
    missionType: 'user_journey' | 'smoke';
    maxSteps: number;
  }) => {
    setError(null);
    try {
      const session = await api.createDynamicSession(project.id, data);
      setShowDynamicForm(false);
      onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: session.id });
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

  const handleCreateStatic = async (data: {
    name: string;
    reviewType: ReviewType;
    artifactIds: string[];
    remarks: string;
  }) => {
    setError(null);
    try {
      const session = await api.createStaticSession(project.id, data);
      setShowStaticForm(false);
      onNavigate({ name: 'static-session', projectId: project.id, sessionId: session.id });
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

  const handleExportReport = async () => {
    setExporting(true);
    try {
      const result = await api.exportProjectReport(project.id);
      alert(`Report exported to:\n${result.reportPath}`);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'projects' })}>
          Back
        </button>
        <h1>{project.name}</h1>
        <button className="btn-secondary" onClick={handleExportReport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export Report'}
        </button>
      </div>

      {project.description && <p className="project-description">{project.description}</p>}

      <div className="detail-meta">
        <span>Workspace: <code>{project.workspacePath}</code></span>
        <span>Created: {new Date(project.createdAt).toLocaleString()}</span>
      </div>

      <div className="detail-grid">
        {/* Artifacts */}
        <div className="card detail-card">
          <ArtifactsPanel projectId={project.id} />
        </div>

        {/* Static Review */}
        <div className="card detail-card">
          <div className="panel-header">
            <h3>Static Review</h3>
            {!showStaticForm && (
              <button className="btn-primary" onClick={() => setShowStaticForm(true)}>
                New Review
              </button>
            )}
          </div>
          {showStaticForm && (
            <ReviewModal
              projectId={project.id}
              onSubmit={handleCreateStatic}
              onClose={() => { setShowStaticForm(false); setError(null); }}
            />
          )}
          {staticSessions.length > 0 ? (
            <div className="session-list">
              {staticSessions.map(s => (
                <div
                  key={s.id}
                  className="session-row"
                  onClick={() => onNavigate({ name: 'static-session', projectId: project.id, sessionId: s.id })}
                >
                  <div className="session-info-compact">
                    <span className="session-name">{s.name}</span>
                    <span className="session-type">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
                  </div>
                  <div className="session-meta">
                    <StatusBadge status={s.status} />
                    <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !showStaticForm && <p className="card-empty">No reviews yet.</p>
          )}
        </div>

        {/* Dynamic Testing */}
        <div className="card detail-card">
          <div className="panel-header">
            <h3>Dynamic Testing</h3>
            {!showDynamicForm && (
              <button className="btn-primary" onClick={() => setShowDynamicForm(true)}>
                New Dynamic Test
              </button>
            )}
          </div>
          {showDynamicForm && (
            <DynamicTestForm onSubmit={handleCreateDynamic} onCancel={() => { setShowDynamicForm(false); setError(null); }} />
          )}
          {dynamicSessions.length > 0 ? (
            <div className="session-list">
              {dynamicSessions.map(s => (
                <div
                  key={s.id}
                  className="session-row"
                  onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}
                >
                  <div className="session-info-compact">
                    <span className="session-name">{s.name}</span>
                    <span className="session-type">{s.targetUrl}</span>
                  </div>
                  <div className="session-meta">
                    <StatusBadge status={s.status} />
                    <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !showDynamicForm && <p className="card-empty">No tests yet.</p>
          )}
        </div>

        {/* Findings */}
        <div className="card detail-card">
          <FindingsPanel projectId={project.id} />
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
