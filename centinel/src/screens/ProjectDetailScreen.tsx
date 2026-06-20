import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, Plus, FolderOpen, Play, BarChart3, Bug, Search, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import { ReviewModal } from '../components/ReviewModal';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import type { Project, DynamicSession, StaticSession, Screen, ReviewType } from '../types';

type Props = { project: Project; onNavigate: (screen: Screen) => void };

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
    try { setDynamicSessions(await api.listDynamicSessions(project.id)); } catch {}
  }, [project.id]);

  const loadStaticSessions = useCallback(async () => {
    try { setStaticSessions(await api.listStaticSessions(project.id)); } catch {}
  }, [project.id]);

  useEffect(() => { loadDynamicSessions(); loadStaticSessions(); }, [loadDynamicSessions, loadStaticSessions]);

  useEffect(() => {
    const hasActive = dynamicSessions.some(s => s.status === 'running' || s.status === 'queued') ||
      staticSessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActive) return;
    const interval = setInterval(() => { loadDynamicSessions(); loadStaticSessions(); }, 2000);
    return () => clearInterval(interval);
  }, [dynamicSessions, staticSessions, loadDynamicSessions, loadStaticSessions]);

  const handleCreateDynamic = async (data: { targetUrl: string; goal: string; missionType: 'user_journey' | 'smoke'; maxSteps: number }) => {
    setError(null);
    try {
      const session = await api.createDynamicSession(project.id, data);
      setShowDynamicForm(false);
      onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: session.id });
    } catch (e) { setError(String(e)); throw e; }
  };

  const handleCreateStatic = async (data: { name: string; reviewType: ReviewType; artifactIds: string[]; remarks: string }) => {
    setError(null);
    try {
      const session = await api.createStaticSession(project.id, data);
      setShowStaticForm(false);
      onNavigate({ name: 'static-session', projectId: project.id, sessionId: session.id });
    } catch (e) { setError(String(e)); throw e; }
  };

  const handleExportReport = async () => {
    setExporting(true);
    try { const result = await api.exportProjectReport(project.id); alert(`Report exported to:\n${result.reportPath}`); }
    catch (e) { alert(`Export failed: ${e}`); }
    finally { setExporting(false); }
  };

  return (
    <div className="screen animate-fade-in">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'projects' })}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1>{project.name}</h1>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => onNavigate({ name: 'evidence-browser', projectId: project.id })}>
            <Search size={14} /> Evidence
          </button>
          <button className="btn-secondary" onClick={handleExportReport} disabled={exporting}>
            <Download size={14} /> {exporting ? 'Exporting...' : 'Export Report'}
          </button>
        </div>
      </div>

      {project.description && <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>{project.description}</p>}

      <div className="detail-meta" style={{ display: 'flex', gap: '20px', fontSize: '13px', color: 'var(--text-faint)', marginBottom: '20px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FolderOpen size={13} /> {project.workspacePath}</span>
        <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
      </div>

      {error && <p className="form-error" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlertCircle size={14} /> {error}</p>}

      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {/* Artifacts */}
        <div className="card detail-card">
          <ArtifactsPanel projectId={project.id} />
        </div>

        {/* Static Review */}
        <div className="card detail-card">
          <div className="panel-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BarChart3 size={14} /> Static Review
            </h3>
            {!showStaticForm && (
              <button className="btn-primary" onClick={() => setShowStaticForm(true)} style={{ fontSize: '12px', padding: '6px 12px' }}>
                <Plus size={14} /> New Review
              </button>
            )}
          </div>
          {showStaticForm && (
            <ReviewModal projectId={project.id} onSubmit={handleCreateStatic}
              onClose={() => { setShowStaticForm(false); setError(null); }} />
          )}
          {staticSessions.length > 0 ? (
            <div className="session-list">
              {staticSessions.map(s => (
                <div key={s.id} className="session-row"
                  onClick={() => onNavigate({ name: 'static-session', projectId: project.id, sessionId: s.id })}>
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
            !showStaticForm && <p className="card-empty" style={{ padding: '16px 0', color: 'var(--text-faint)' }}>No reviews yet.</p>
          )}
        </div>

        {/* Dynamic Testing */}
        <div className="card detail-card">
          <div className="panel-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Play size={14} style={{ color: 'var(--accent)' }} /> Dynamic Testing
            </h3>
            {!showDynamicForm && (
              <button className="btn-primary" onClick={() => setShowDynamicForm(true)} style={{ fontSize: '12px', padding: '6px 12px' }}>
                <Plus size={14} /> New Test
              </button>
            )}
          </div>
          {showDynamicForm && (
            <DynamicTestForm onSubmit={handleCreateDynamic} onCancel={() => { setShowDynamicForm(false); setError(null); }} />
          )}
          {dynamicSessions.length > 0 ? (
            <div className="session-list">
              {dynamicSessions.map(s => (
                <div key={s.id} className="session-row"
                  onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}>
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
            !showDynamicForm && <p className="card-empty" style={{ padding: '16px 0', color: 'var(--text-faint)' }}>No tests yet.</p>
          )}
        </div>

        {/* Findings */}
        <div className="card detail-card">
          <FindingsPanel projectId={project.id} />
        </div>
      </div>
    </div>
  );
}
