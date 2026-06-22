import { useState, useEffect, useCallback } from 'react';
import { Download, Plus, FolderOpen, Play, BarChart3, Search, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import { ReviewModal } from '../components/ReviewModal';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ActiveSessionInline } from '../components/ActiveSessionInline';
import { ActiveSessionComplete } from '../components/ActiveSessionComplete';
import type { Project, DynamicSession, StaticSession, Artifact, Screen, ReviewType, Finding } from '../types';

type Props = { project: Project; onNavigate: (screen: Screen) => void };

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Traceability',
  cross_artifact_consistency: 'Consistency',
};

export function ProjectDetailScreen({ project, onNavigate }: Props) {
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [showDynamicForm, setShowDynamicForm] = useState(false);
  const [showStaticForm, setShowStaticForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [findingsBySession, setFindingsBySession] = useState<Record<string, Finding[]>>({});

  useActiveReviewState(); // ensures context exists; actual reading happens in children

  const loadDynamicSessions = useCallback(async () => {
    try { setDynamicSessions(await api.listDynamicSessions(project.id)); } catch {}
  }, [project.id]);

  const loadStaticSessions = useCallback(async () => {
    try { setStaticSessions(await api.listStaticSessions(project.id)); } catch {}
  }, [project.id]);

  const loadArtifacts = useCallback(async () => {
    try { setArtifacts(await api.listArtifacts(project.id)); } catch {}
  }, [project.id]);

  const ensureFindingsLoaded = useCallback(async (sessionId: string) => {
    if (findingsBySession[sessionId]) return;
    try {
      const findings = await api.listStaticFindings(project.id, sessionId);
      setFindingsBySession(prev => ({ ...prev, [sessionId]: findings }));
    } catch {}
  }, [findingsBySession, project.id]);

  useEffect(() => { loadDynamicSessions(); loadStaticSessions(); loadArtifacts(); }, [loadDynamicSessions, loadStaticSessions, loadArtifacts]);

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
      await api.createStaticSession(project.id, data);
      setShowStaticForm(false);
    } catch (e) { setError(String(e)); throw e; }
  };

  const handleExportReport = async () => {
    setExporting(true);
    try { const result = await api.exportProjectReport(project.id); alert(`Report exported to:\n${result.reportPath}`); }
    catch (e) { alert(`Export failed: ${e}`); }
    finally { setExporting(false); }
  };

  return (
    <div className="screen command-project-detail animate-fade-in">
      <CommandPageHeader
        eyebrow="Project Workspace"
        title={project.name}
        description={project.description || 'Static review, autonomous UI testing, evidence, and findings in one workspace.'}
        onBack={() => onNavigate({ name: 'projects' })}
        meta={(
          <>
            <span className="workspace"><FolderOpen size={12} /> {project.workspacePath}</span>
            <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
          </>
        )}
        actions={(
          <>
          <button className="btn-secondary" onClick={() => onNavigate({ name: 'evidence-browser', projectId: project.id })}>
            <Search size={14} /> Evidence
          </button>
          <button className="btn-secondary" onClick={handleExportReport} disabled={exporting}>
            <Download size={14} /> {exporting ? 'Exporting...' : 'Export Report'}
          </button>
          </>
        )}
      />

      {error && <p className="form-error command-inline-alert"><AlertCircle size={14} /> {error}</p>}

      <div className="detail-grid">
        {/* Artifacts */}
        <div className="card detail-card sources-card">
          <ArtifactsPanel projectId={project.id} />
        </div>

        {/* Static Review */}
        <div className="card detail-card">
          <div className="panel-header">
            <h3>
              <BarChart3 size={14} /> Static Review
            </h3>
            {!showStaticForm && (
              <button className="btn-primary" onClick={() => setShowStaticForm(true)}>
                <Plus size={14} /> New Review
              </button>
            )}
          </div>
          {showStaticForm && (
            <ReviewModal projectId={project.id} artifacts={artifacts} onSubmit={handleCreateStatic}
              onClose={() => { setShowStaticForm(false); setError(null); }} />
          )}
          {staticSessions.length > 0 ? (
            <div className="session-list">
              {staticSessions.map(s => {
                const isActive = s.status === 'running' || s.status === 'queued';
                const isOpen = openSessionId === s.id;
                const handleClick = async () => {
                  if (isOpen) { setOpenSessionId(null); return; }
                  setOpenSessionId(s.id);
                  if (!isActive) await ensureFindingsLoaded(s.id);
                };
                return (
                  <div key={s.id} className={`session-block ${isOpen ? 'open' : ''}`}>
                    <div className="session-row" onClick={handleClick}>
                      <div className="session-info-compact">
                        <span className="session-name">{s.name}</span>
                        <span className="session-type">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
                      </div>
                      <div className="session-meta">
                        <StatusBadge label={s.status} />
                        <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {isOpen && (
                      isActive ? (
                        <ActiveSessionInline projectId={project.id} sessionId={s.id} />
                      ) : (
                        <ActiveSessionComplete
                          projectId={project.id}
                          sessionId={s.id}
                          findings={findingsBySession[s.id] ?? []}
                        />
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            !showStaticForm && <p className="card-empty">No reviews yet.</p>
          )}
        </div>

        {/* Dynamic Testing */}
        <div className="card detail-card dynamic-card">
          <div className="panel-header">
            <h3>
              <Play size={14} /> Dynamic Testing
            </h3>
            {!showDynamicForm && (
              <button className="btn-primary" onClick={() => setShowDynamicForm(true)}>
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
                    <StatusBadge label={s.status} />
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
        <div className="card detail-card findings-card">
          <FindingsPanel projectId={project.id} />
        </div>
      </div>
    </div>
  );
}
