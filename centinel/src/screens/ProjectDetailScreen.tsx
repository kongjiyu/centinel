import { useState, useEffect, useCallback } from 'react';
import { Download, Plus, FolderOpen, Play, BarChart3, Search, AlertCircle, GitBranch, RotateCw } from 'lucide-react';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import { ReviewModal } from '../components/ReviewModal';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ActiveSessionInline } from '../components/ActiveSessionInline';
import { ActiveSessionComplete } from '../components/ActiveSessionComplete';
import { ReviewDecisionPill } from '../components/ReviewDecisionBar';
import { TestPlanPanel } from '../components/TestPlanPanel';
import type { Project, DynamicSession, StaticSession, Artifact, Screen, Finding } from '../types';

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

  const { state: activeReviewState, controls: activeReviewControls } = useActiveReviewState();

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
    const snapshot = activeReviewState?.session;
    if (!snapshot || snapshot.projectId !== project.id) return;

    setStaticSessions(prev => prev.map(session => session.id === snapshot.id
      ? {
          ...session,
          status: snapshot.status,
          finalSummary: snapshot.finalSummary,
          failureReason: snapshot.failureReason,
        }
      : session));

    if (snapshot.status === 'success') {
      setFindingsBySession(prev => ({
        ...prev,
        [snapshot.id]: snapshot.findings,
      }));
    }
  }, [activeReviewState?.session, project.id]);

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

  const handleCreateStatic = async (data: { name: string; instructions: string; baseRef?: string; headRef?: string; parentSessionId?: string }) => {
    setError(null);
    try {
      const session = await api.createStaticSession(project.id, data);
      setStaticSessions(prev => [session, ...prev.filter(item => item.id !== session.id)]);
      setOpenSessionId(session.id);
      activeReviewControls.trackSession(session, project.name);
      setShowStaticForm(false);
    } catch (e) { setError(String(e)); throw e; }
  };

  // P1-5: handler for the "Re-review" button on a completed session
  // row. Pulled out of the JSX so the onClick stays small (and the
  // window.prompt calls don't bloat the .tsx). The two prompts run
  // sequentially because we use the parent's base/head refs as the
  // defaults for the new review's scope.
  const onReReviewClick = async (
    e: React.MouseEvent<HTMLButtonElement>,
    s: StaticSession
  ) => {
    e.stopPropagation();
    const child = window.prompt('Re-review name', `Re-review of ${s.name}`);
    if (!child) return;
    const instructions = window.prompt('Instructions for the agent (optional)', s.remarks || '');
    if (instructions === null) return;
    await handleCreateStatic({
      name: child.trim(),
      instructions: instructions.trim(),
      baseRef: s.baseRef,
      headRef: s.headRef,
      parentSessionId: s.id,
    });
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
            <ReviewModal projectId={project.id} onSubmit={handleCreateStatic}
              onClose={() => { setShowStaticForm(false); setError(null); }} />
          )}
          {staticSessions.length > 0 ? (
            <div className="session-list">
              {staticSessions.map(s => {
                const isActive = s.status === 'running' || s.status === 'queued';
                const isOpen = openSessionId === s.id;
                const handleClick = async () => {
                  if (isOpen) {
                    setOpenSessionId(null);
                    return;
                  }
                  setOpenSessionId(s.id);
                  // Load findings for completed sessions
                  if (!isActive) {
                    await ensureFindingsLoaded(s.id);
                  }
                };
                return (
                  <div key={s.id} className={`session-block ${isOpen ? 'open' : ''}`}>
                    <div
                      className="session-row"
                      onClick={handleClick}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void handleClick();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                    >
                      <div className="session-info-compact">
                        <span className="session-name">{s.name}</span>
                        <span className="session-type">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
                        {s.baseRef && s.headRef && (
                          <span
                            className="session-scope-badge"
                            data-testid="session-scope-badge"
                            title={`Scoped to files changed between ${s.baseRef} and ${s.headRef}`}
                          >
                            <GitBranch size={10} /> {s.baseRef} → {s.headRef}
                          </span>
                        )}
                      </div>
                      <div className="session-meta">
                        <StatusBadge label={s.status} />
                        {s.status === 'success' && (
                          <ReviewDecisionPill decision={s.currentDecision ?? null} />
                        )}
                        {s.status === 'success' && !s.parentSessionId && (
                          <button
                            className="btn-ghost btn-re-review"
                            onClick={(e) => { void onReReviewClick(e, s); }}
                            data-testid="re-review-button"
                            title="Start a new review that carries over unresolved findings from this one"
                            type="button"
                          >
                            <RotateCw size={11} /> Re-review
                          </button>
                        )}
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
                          parentSessionId={s.parentSessionId}
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
          <FindingsPanel
            projectId={project.id}
            refreshKey={
              activeReviewState?.session.projectId === project.id
                ? `${activeReviewState.session.id}:${activeReviewState.session.status}`
                : undefined
            }
          />
        </div>

        {/* Test Plan (Group 2c) — module-grouped test items derived
            from the static review. Mounts below findings so the
            reviewer can scan defects and the test plan to address
            them in one pass. */}
        <div className="card detail-card test-plan-card">
          <TestPlanPanel
            projectId={project.id}
            sessionId={
              activeReviewState?.session.projectId === project.id
                ? activeReviewState.session.id
                : staticSessions.find(s => s.status === 'success')?.id
            }
          />
        </div>
      </div>
    </div>
  );
}
