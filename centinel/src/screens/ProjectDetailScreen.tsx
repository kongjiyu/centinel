import { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, Plus, FolderOpen, Play, BarChart3, Search, AlertCircle, FileText, GitBranch, RotateCw, Clock3, ChevronRight, Users, Settings, ShieldAlert } from 'lucide-react';
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
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import type { Project, DynamicSession, StaticSession, Artifact, Screen, Finding } from '../types';
import './ProjectDetailScreen.css';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
  initialAction?: 'static' | 'dynamic';
  initialStaticSessionId?: string;
};

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Traceability',
  cross_artifact_consistency: 'Consistency',
};

export function ProjectDetailScreen({ project, onNavigate, initialAction, initialStaticSessionId }: Props) {
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [showDynamicForm, setShowDynamicForm] = useState(initialAction === 'dynamic');
  const [showStaticForm, setShowStaticForm] = useState(initialAction === 'static');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(initialStaticSessionId ?? null);
  const [findingsBySession, setFindingsBySession] = useState<Record<string, Finding[]>>({});
  const [activeSection, setActiveSection] = useState('project-overview');
  const [reReviewSession, setReReviewSession] = useState<StaticSession | null>(null);
  const [reReviewName, setReReviewName] = useState('');
  const [reReviewInstructions, setReReviewInstructions] = useState('');
  const [creatingReReview, setCreatingReReview] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [activityQuery, setActivityQuery] = useState('');
  const [activityType, setActivityType] = useState<'all' | 'review' | 'dynamic'>('all');
  const [activityDate, setActivityDate] = useState('');
  const [projectFindings, setProjectFindings] = useState<Finding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError, setFindingsError] = useState<string | null>(null);

  const { state: activeReviewState, controls: activeReviewControls } = useActiveReviewState();

  useEffect(() => {
    setShowStaticForm(initialAction === 'static');
    setShowDynamicForm(initialAction === 'dynamic');
    if (!initialAction) return;
    const sectionId = 'project-overview';
    setActiveSection(sectionId);
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }, [initialAction, project.id]);

  const loadDynamicSessions = useCallback(async () => {
    try { setDynamicSessions(await api.listDynamicSessions(project.id)); } catch {}
  }, [project.id]);

  const loadStaticSessions = useCallback(async () => {
    try { setStaticSessions(await api.listStaticSessions(project.id)); } catch {}
  }, [project.id]);

  const loadArtifacts = useCallback(async () => {
    try { setArtifacts(await api.listArtifacts(project.id)); } catch {}
  }, [project.id]);

  const loadProjectFindings = useCallback(async () => {
    setFindingsLoading(true);
    setFindingsError(null);
    try {
      setProjectFindings(await api.listFindings(project.id));
    } catch (cause) {
      setProjectFindings([]);
      setFindingsError(String(cause));
    } finally {
      setFindingsLoading(false);
    }
  }, [project.id]);

  const ensureFindingsLoaded = useCallback(async (sessionId: string) => {
    if (findingsBySession[sessionId]) return;
    try {
      const findings = await api.listStaticFindings(project.id, sessionId);
      setFindingsBySession(prev => ({ ...prev, [sessionId]: findings }));
    } catch {}
  }, [findingsBySession, project.id]);

  useEffect(() => {
    setOpenSessionId(initialStaticSessionId ?? null);
    if (initialStaticSessionId) void ensureFindingsLoaded(initialStaticSessionId);
  }, [ensureFindingsLoaded, initialStaticSessionId, project.id]);

  useEffect(() => { loadDynamicSessions(); loadStaticSessions(); loadArtifacts(); loadProjectFindings(); }, [loadDynamicSessions, loadStaticSessions, loadArtifacts, loadProjectFindings]);

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

  const onReReviewClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    s: StaticSession
  ) => {
    e.stopPropagation();
    setReReviewSession(s);
    setReReviewName(`Re-review of ${s.name}`);
    setReReviewInstructions(s.remarks || '');
  };

  const handleCreateReReview = async () => {
    if (!reReviewSession || !reReviewName.trim()) return;
    setCreatingReReview(true);
    try {
      await handleCreateStatic({
        name: reReviewName.trim(),
        instructions: reReviewInstructions.trim(),
        baseRef: reReviewSession.baseRef,
        headRef: reReviewSession.headRef,
        parentSessionId: reReviewSession.id,
      });
      setReReviewSession(null);
    } finally {
      setCreatingReReview(false);
    }
  };

  const handleExportReport = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const result = await api.exportProjectReport(project.id);
      setExportNotice({ tone: 'success', text: `Report saved to ${result.reportPath}` });
    } catch (e) {
      setExportNotice({ tone: 'danger', text: `Export failed: ${String(e)}` });
    }
    finally { setExporting(false); }
  };

  const moveToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const staleSourceCount = artifacts.filter(artifact => {
    if (artifact.source !== 'documents' && artifact.source !== 'drive') return false;
    const ingestedAt = Date.parse(artifact.createdAt);
    return Number.isFinite(ingestedAt) && Date.now() - ingestedAt > 90 * 24 * 60 * 60 * 1000;
  }).length;

  const projectActivities = useMemo(() => [...staticSessions.map(session => ({
    id: session.id,
    name: session.name,
    kind: 'Review' as const,
    status: session.status,
    createdAt: session.updatedAt || session.createdAt,
  })), ...dynamicSessions.map(session => ({
    id: session.id,
    name: session.name,
    kind: 'Dynamic Testing' as const,
    status: session.status,
    createdAt: session.updatedAt || session.createdAt,
  }))]
    .filter(activity => activityType === 'all' || (activityType === 'review' ? activity.kind === 'Review' : activity.kind === 'Dynamic Testing'))
    .filter(activity => !activityDate || activity.createdAt.slice(0, 10) === activityDate)
    .filter(activity => !activityQuery.trim() || (activity.name + ' ' + activity.kind + ' ' + activity.status).toLowerCase().includes(activityQuery.trim().toLowerCase()))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [activityDate, activityQuery, activityType, dynamicSessions, staticSessions]);

  const unresolvedFindings = useMemo(() => {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return projectFindings
      .filter(finding => !['accepted', 'dismissed', 'fixed'].includes(finding.status))
      .sort((a, b) => (severityOrder[a.severity.toLowerCase()] ?? 99) - (severityOrder[b.severity.toLowerCase()] ?? 99) || Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  }, [projectFindings]);

  const nextProjectStep = useMemo(() => {
    const running = [...staticSessions, ...dynamicSessions].find(session => session.status === 'running' || session.status === 'queued');
    if (running) return { label: 'Work in progress', detail: `${running.name} is still being processed.`, action: null };
    const blocked = [...staticSessions, ...dynamicSessions].find(session => session.status === 'blocked' || session.status === 'failure');
    if (blocked) return { label: 'Needs attention', detail: blocked.failureReason || `${blocked.name} needs inspection before the next run.`, action: 'activity' as const };
    if (artifacts.length === 0) return { label: 'Add sources', detail: 'Add the files or repository that a Review can inspect.', action: 'source' as const };
    if (unresolvedFindings.length > 0) return { label: 'Triage findings', detail: `${unresolvedFindings.length} unresolved finding${unresolvedFindings.length === 1 ? '' : 's'} need a decision.`, action: 'findings' as const };
    if (staticSessions.length === 0 && dynamicSessions.length === 0) return { label: 'Start a review', detail: 'The project is ready for its first Review.', action: 'review' as const };
    return { label: 'Run another check', detail: 'Review the latest sources or verify a live website.', action: 'review' as const };
  }, [artifacts.length, dynamicSessions, staticSessions, unresolvedFindings.length]);

  return (
    <div className="screen command-project-detail animate-fade-in">
      <CommandPageHeader
        eyebrow="Project"
        title={project.name}
        description={project.description || 'Review sources and verify a live website in one workspace.'}
        onBack={() => onNavigate({ name: 'projects' })}
        meta={(
          <>
            <span className="workspace"><FolderOpen size={12} /> {project.workspacePath}</span>
            <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
          </>
        )}
        actions={(
          <>
            <button className="btn-primary" onClick={() => onNavigate({ name: 'review-entry', projectId: project.id })}>
              <Plus size={14} /> New review
            </button>
            <button className="btn-secondary" onClick={() => setShowDynamicForm(true)}>
              <Play size={14} /> New test
            </button>
            <button className="btn-secondary" onClick={() => onNavigate({ name: 'evidence-browser', projectId: project.id })}>
              <Search size={14} /> Evidence
            </button>
          </>
        )}
      />

      <nav className="project-section-nav" aria-label="Project sections">
        <button className={activeSection === 'project-overview' ? 'active' : ''} aria-current={activeSection === 'project-overview' ? 'page' : undefined} onClick={() => moveToSection('project-overview')}>Overview</button>
        <button className={activeSection === 'project-source' ? 'active' : ''} aria-current={activeSection === 'project-source' ? 'page' : undefined} onClick={() => moveToSection('project-source')}>Source</button>
        <button className={activeSection === 'project-findings' ? 'active' : ''} aria-current={activeSection === 'project-findings' ? 'page' : undefined} onClick={() => moveToSection('project-findings')}>Findings</button>
        <button className={activeSection === 'project-collaborations' ? 'active' : ''} aria-current={activeSection === 'project-collaborations' ? 'page' : undefined} onClick={() => moveToSection('project-collaborations')}>Collaborations</button>
        <button className={activeSection === 'project-settings' ? 'active' : ''} aria-current={activeSection === 'project-settings' ? 'page' : undefined} onClick={() => moveToSection('project-settings')}>Settings</button>
      </nav>

      {error && <p className="form-error command-inline-alert"><AlertCircle size={14} /> {error}</p>}
      {exportNotice && (
        <div className={`command-inline-notice ${exportNotice.tone}`} role={exportNotice.tone === 'danger' ? 'alert' : 'status'}>
          <span>{exportNotice.text}</span>
          <button type="button" className="notice-dismiss" onClick={() => setExportNotice(null)} aria-label="Dismiss report export message">×</button>
        </div>
      )}

      <div className="detail-grid" id="project-overview">
        {/* Artifacts */}
        {activeSection === 'project-source' && <section className="card detail-card sources-card" id="project-source">
          <ArtifactsPanel projectId={project.id} />
        </section>}

        {activeSection === 'project-overview' && <section className="card detail-card project-activity-summary" id="project-recent-activity">
          <div className="panel-header">
            <div>
              <h3><Clock3 size={18} /> Recent activity</h3>
              <p className="panel-description">Review and Dynamic Testing activity for this project.</p>
            </div>
            <span className="panel-description">{Math.min(5, projectActivities.length)} of {projectActivities.length} shown</span>
          </div>
          <div className="project-activity-filters" aria-label="Filter recent activity">
            <label>Search<input type="search" value={activityQuery} onChange={event => setActivityQuery(event.target.value)} placeholder="Search activity" /></label>
            <label htmlFor="project-activity-type">Type<Select id="project-activity-type" value={activityType} onChange={value => setActivityType(value as 'all' | 'review' | 'dynamic')} options={[{ value: 'all', label: 'All types' }, { value: 'review', label: 'Review' }, { value: 'dynamic', label: 'Dynamic Testing' }]} /></label>
            <label>Date<input type="date" value={activityDate} onChange={event => setActivityDate(event.target.value)} /></label>
          </div>
          {projectActivities.slice(0, 5)
            .map(activity => <button key={`${activity.kind}-${activity.id}`} type="button" className="project-activity-row" onClick={() => activity.kind === 'Review' ? onNavigate({ name: 'review-activity', projectId: project.id, sessionId: activity.id }) : onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: activity.id })}>
              <span className="project-activity-main"><strong>{activity.name}</strong><small>{activity.kind}</small></span>
              <StatusBadge label={activity.status} />
              <time dateTime={activity.createdAt}>{new Date(activity.createdAt).toLocaleString()}</time>
              <ChevronRight size={15} aria-hidden="true" />
            </button>)}
          {projectActivities.length === 0 && <p className="card-empty">{staticSessions.length + dynamicSessions.length === 0 ? 'No activity yet. Start a Review or Dynamic Testing from the actions below.' : 'No activity matches these filters.'}</p>}
        </section>}

        {activeSection === 'project-overview' && <section className="card detail-card project-next-step" id="project-next-step">
          <div className="panel-header">
            <div>
              <h3><AlertCircle size={18} /> Next step</h3>
              <p className="panel-description">A concise condition for this project, based on persisted sources and activity.</p>
            </div>
          </div>
          <div className="project-next-step-body">
            <div><strong>{nextProjectStep.label}</strong><p>{nextProjectStep.detail}</p></div>
            {nextProjectStep.action === 'source' && <button type="button" className="btn-primary" onClick={() => moveToSection('project-source')}>Add sources</button>}
            {nextProjectStep.action === 'findings' && <button type="button" className="btn-primary" onClick={() => moveToSection('project-findings')}>Open findings</button>}
            {nextProjectStep.action === 'activity' && <button type="button" className="btn-secondary" onClick={() => setActivityType('all')}>Review activity</button>}
            {nextProjectStep.action === 'review' && <button type="button" className="btn-primary" onClick={() => onNavigate({ name: 'review-entry', projectId: project.id })}>Start review</button>}
          </div>
        </section>}

        {/* Static Review: review runs open from Recent activity or Review entry. */}
        {false && <section className="card detail-card" id="project-review">
          <div className="panel-header">
            <h3>
              <BarChart3 size={18} /> Review
            </h3>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={() => onNavigate({ name: 'requirements', projectId: project.id })}>
                Requirements
              </button>
              {!showStaticForm && (
                <button className="btn-primary" onClick={() => setShowStaticForm(true)}>
                  <Plus size={16} /> New review
                </button>
              )}
            </div>
          </div>
          {showStaticForm && (
            <ReviewModal projectId={project.id} onSubmit={handleCreateStatic}
              staleSourceCount={staleSourceCount}
              onClose={() => { setShowStaticForm(false); setError(null); }} />
          )}
          {staticSessions.length > 0 ? (
            <div className="session-list">
              {staticSessions.map(s => {
                const isActive = s.status === 'running' || s.status === 'queued';
                const isOpen = openSessionId === s.id;
                const handleClick = () => {
                  onNavigate({ name: 'review-activity', projectId: project.id, sessionId: s.id });
                };
                return (
                  <div key={s.id} className={`session-block ${isOpen ? 'open' : ''}`}>
                    <div className="session-row">
                      <button
                      type="button"
                      className="session-row-main"
                      onClick={handleClick}
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
                        <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                      </div>
                      </button>
                      {s.status === 'success' && !s.parentSessionId && (
                        <button
                          className="btn-ghost btn-re-review"
                          onClick={(e) => onReReviewClick(e, s)}
                          data-testid="re-review-button"
                          title="Start a new review that carries over unresolved findings from this one"
                          type="button"
                        >
                          <RotateCw size={13} /> Re-review
                        </button>
                      )}
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
        </section>}

        {/* Dynamic Testing: test runs open from Recent activity or the header action. */}
        {false && <section className="card detail-card dynamic-card" id="project-dynamic">
          <div className="panel-header">
            <h3>
              <Play size={18} /> Dynamic Testing
            </h3>
            {!showDynamicForm && (
              <button className="btn-primary" onClick={() => setShowDynamicForm(true)}>
                <Plus size={16} /> New test
              </button>
            )}
          </div>
          {showDynamicForm && (
            <Modal
              isOpen={showDynamicForm}
              onClose={() => { setShowDynamicForm(false); setError(null); }}
              title="New test"
              width={520}
            >
              <DynamicTestForm
                onSubmit={handleCreateDynamic}
                onCancel={() => { setShowDynamicForm(false); setError(null); }}
              />
            </Modal>
          )}
          {dynamicSessions.length > 0 ? (
            <div className="session-list">
              {dynamicSessions.map(s => (
                <button key={s.id} type="button" className="session-row session-row-link"
                  onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}>
                  <div className="session-info-compact">
                    <span className="session-name">{s.name}</span>
                    <span className="session-type">{s.targetUrl}</span>
                  </div>
                  <div className="session-meta">
                    <StatusBadge label={s.status} />
                    <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !showDynamicForm && <p className="card-empty">No tests yet.</p>
          )}
        </section>}

        {/* Findings */}
        {activeSection === 'project-overview' && <section className="card detail-card findings-preview-card" id="project-findings-preview">
          <div className="panel-header">
            <div>
              <h3><ShieldAlert size={18} /> Findings preview</h3>
              <p className="panel-description">Up to three unresolved findings, ordered by severity and recency.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => moveToSection('project-findings')}>View all findings</button>
          </div>
          {findingsLoading && <p className="card-empty">Loading findings…</p>}
          {findingsError && <p className="command-inline-alert" role="alert"><AlertCircle size={14} /> Findings are unavailable: {findingsError}</p>}
          {!findingsLoading && !findingsError && unresolvedFindings.length === 0 && <p className="card-empty">No unresolved findings are available for this project.</p>}
          {!findingsLoading && !findingsError && unresolvedFindings.slice(0, 3).map(finding => (
            <button type="button" className="project-finding-preview-row" key={finding.id} onClick={() => moveToSection('project-findings')}>
              <span><strong>{finding.title}</strong><small>{finding.source === 'static' ? 'Review' : 'Dynamic Testing'} · {finding.filePath || 'Location not supplied'}</small></span>
              <StatusBadge label={finding.severity} />
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
        </section>}

        {activeSection === 'project-findings' && <section className="card detail-card findings-card" id="project-findings">
          <FindingsPanel
            projectId={project.id}
            refreshKey={
              activeReviewState?.session.projectId === project.id
                ? `${activeReviewState.session.id}:${activeReviewState.session.status}`
                : undefined
            }
          />
        </section>}

        {activeSection === 'project-collaborations' && <section className="card detail-card project-collaboration-card" id="project-collaborations">
          <div className="panel-header"><div><h3><Users size={18} /> Collaborations</h3><p className="panel-description">Project access and review participation.</p></div></div>
          <div className="capability-unavailable" role="status">
            <Users size={22} aria-hidden="true" />
            <div>
              <strong>Collaboration data is not connected</strong>
              <p>This build does not connect to a collaboration service, so no invitations or roles are represented here.</p>
            </div>
          </div>
        </section>}

        {activeSection === 'project-settings' && <section className="card detail-card project-settings-card" id="project-settings">
          <div className="panel-header"><div><h3><Settings size={18} /> Project settings</h3><p className="panel-description">Persisted details for this project.</p></div></div>
          <dl className="project-settings-facts">
            <div><dt>Project name</dt><dd>{project.name}</dd></div>
            <div><dt>Workspace location</dt><dd className="project-workspace">{project.workspacePath}</dd></div>
            <div><dt>Created</dt><dd><time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString()}</time><span className="project-settings-time">{new Date(project.createdAt).toLocaleTimeString()}</span></dd></div>
          </dl>
          <div className="capability-unavailable" role="status">
            <Settings size={22} aria-hidden="true" />
            <div><strong>Editable project policies are not available</strong><p>Project details above are read-only in this build; terminology persistence is not connected.</p></div>
          </div>
          <div className="project-settings-sections">
            <section className="project-settings-subsection" aria-labelledby="project-severity-terms-title">
              <div><h4 id="project-severity-terms-title">Severity terminology</h4><p>Severity describes the impact of a finding.</p></div>
              <div className="capability-unavailable" role="status">
                <Settings size={19} aria-hidden="true" />
                <div><strong>Project terminology is not connected</strong><p>Severity terms use the service defaults until project settings persistence is available.</p></div>
              </div>
            </section>
            <section className="project-settings-subsection" aria-labelledby="project-priority-terms-title">
              <div><h4 id="project-priority-terms-title">Priority terminology</h4><p>Priority describes the order in which findings should be addressed.</p></div>
              <div className="capability-unavailable" role="status">
                <Settings size={19} aria-hidden="true" />
                <div><strong>Project terminology is not connected</strong><p>Priority terms are read-only until a real persistence contract is available.</p></div>
              </div>
            </section>
          </div>
        </section>}

        {false && <section className="card detail-card project-report-card" id="project-reports">
          <div className="panel-header">
            <div>
              <h3><FileText size={18} /> Reports</h3>
              <p className="panel-description">Export a combined project report with the latest Review and Dynamic Testing results.</p>
            </div>
            <button className="btn-primary" onClick={handleExportReport} disabled={exporting}>
              <Download size={16} /> {exporting ? 'Exporting…' : 'Export report'}
            </button>
          </div>
        </section>}

        {/* Test Plan (Group 2c) — module-grouped test items derived
            from the static review. Mounts below findings so the
            reviewer can scan defects and the test plan to address
            them in one pass. */}
        {false && <section className="card detail-card test-plan-card" id="project-suggested-tests">
          <TestPlanPanel
            projectId={project.id}
            sessionId={
              activeReviewState?.session?.projectId === project.id
                ? activeReviewState?.session?.id
                : staticSessions.find(s => s.status === 'success')?.id
            }
          />
        </section>}
      </div>

      {showStaticForm && (
        <ReviewModal
          projectId={project.id}
          onSubmit={handleCreateStatic}
          staleSourceCount={staleSourceCount}
          onClose={() => { setShowStaticForm(false); setError(null); }}
        />
      )}

      {showDynamicForm && (
        <Modal
          isOpen={showDynamicForm}
          onClose={() => { setShowDynamicForm(false); setError(null); }}
          title="New test"
          width={520}
        >
          <DynamicTestForm
            onSubmit={handleCreateDynamic}
            onCancel={() => { setShowDynamicForm(false); setError(null); }}
          />
        </Modal>
      )}

      <Modal
        isOpen={reReviewSession !== null}
        onClose={creatingReReview ? () => undefined : () => setReReviewSession(null)}
        title="Start re-review"
        width={520}
      >
        <p className="modal-intro">Carry the existing scope into a new review and update the instructions if needed.</p>
        <div className="form-field">
          <label htmlFor="re-review-name">Review name</label>
          <input
            id="re-review-name"
            value={reReviewName}
            onChange={event => setReReviewName(event.target.value)}
            maxLength={120}
          />
        </div>
        <div className="form-field">
          <label htmlFor="re-review-instructions">Instructions <span className="field-optional">Optional</span></label>
          <textarea
            id="re-review-instructions"
            value={reReviewInstructions}
            onChange={event => setReReviewInstructions(event.target.value)}
            rows={4}
          />
        </div>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => setReReviewSession(null)} disabled={creatingReReview}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void handleCreateReReview()} disabled={creatingReReview || !reReviewName.trim()}>
            {creatingReReview ? 'Starting…' : 'Start re-review'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
