import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { ReviewModal } from '../components/ReviewModal';
import { DynamicTestForm } from './DynamicTestForm';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import type { Project, DynamicSession, StaticSession, Finding, Screen, ReviewType } from '../types';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
};

type TabId = 'overview' | 'reviews' | 'dynamic' | 'findings' | 'artifacts';

const SIDEBAR_ITEMS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'dynamic', label: 'Dynamic Testing' },
  { id: 'findings', label: 'Findings' },
  { id: 'artifacts', label: 'Artifacts' },
];

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Traceability',
  cross_artifact_consistency: 'Consistency',
};

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ project, staticSessions, dynamicSessions, findings, onTabChange }: {
  project: Project;
  staticSessions: StaticSession[];
  dynamicSessions: DynamicSession[];
  findings: Finding[];
  onTabChange: (tab: TabId) => void;
}) {
  const openFindings = useMemo(() => findings.filter(f => f.status === 'new'), [findings]);
  const critical = openFindings.filter(f => f.severity === 'critical').length;

  const qualityScore = useMemo(() => {
    if (openFindings.length === 0) return 100;
    const c = critical * 15
      + openFindings.filter(f => f.severity === 'high').length * 8
      + openFindings.filter(f => f.severity === 'medium').length * 3
      + openFindings.filter(f => f.severity === 'low').length * 1;
    return Math.max(0, Math.min(100, 100 - c));
  }, [openFindings, critical]);

  const completedReviews = staticSessions.filter(s => s.status === 'success').length;
  const completedTests = dynamicSessions.filter(s => s.status === 'success').length;
  const testSuccessRate = dynamicSessions.length > 0
    ? Math.round((completedTests / dynamicSessions.length) * 100)
    : 0;

  return (
    <div className="ln-section">
      <div className="ln-stats-row">
        <div className="ln-stat">
          <span className="ln-stat-label">Quality Score</span>
          <span className="ln-stat-value">{qualityScore}</span>
          <span className="ln-stat-sub">{qualityScore >= 80 ? 'Good' : qualityScore >= 50 ? 'Needs work' : 'Poor'}</span>
        </div>
        <div className="ln-stat">
          <span className="ln-stat-label">Reviews</span>
          <span className="ln-stat-value">{staticSessions.length}</span>
          <span className="ln-stat-sub">{completedReviews} completed</span>
        </div>
        <div className="ln-stat">
          <span className="ln-stat-label">Dynamic Tests</span>
          <span className="ln-stat-value">{dynamicSessions.length}</span>
          <span className="ln-stat-sub">{testSuccessRate}% success</span>
        </div>
        <div className="ln-stat">
          <span className="ln-stat-label">Open Issues</span>
          <span className="ln-stat-value">{openFindings.length}</span>
          <span className="ln-stat-sub">{critical} critical</span>
        </div>
      </div>

      <div className="ln-section-header">
        <span className="ln-section-label">Workspace</span>
        <code className="ln-code">{project.workspacePath}</code>
      </div>

      {project.description && (
        <div className="ln-section-header">
          <span className="ln-section-label">Description</span>
          <span className="ln-text-muted">{project.description}</span>
        </div>
      )}

      <div className="ln-section-header">
        <span className="ln-section-label">Created</span>
        <span className="ln-text-muted">{new Date(project.createdAt).toLocaleDateString()}</span>
      </div>

      <div className="ln-nav-list">
        <button className="ln-nav-item" onClick={() => onTabChange('reviews')}>
          <span className="ln-nav-label">Reviews</span>
          <span className="ln-nav-count">{staticSessions.length}</span>
        </button>
        <button className="ln-nav-item" onClick={() => onTabChange('dynamic')}>
          <span className="ln-nav-label">Dynamic Tests</span>
          <span className="ln-nav-count">{dynamicSessions.length}</span>
        </button>
        <button className="ln-nav-item" onClick={() => onTabChange('findings')}>
          <span className="ln-nav-label">Findings</span>
          <span className="ln-nav-count">{openFindings.length}</span>
        </button>
        <button className="ln-nav-item" onClick={() => onTabChange('artifacts')}>
          <span className="ln-nav-label">Artifacts</span>
          <span className="ln-nav-count">{findings.length}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Reviews Tab ─────────────────────────────────────────────────────────────

function ReviewsTab({ project, sessions, findings, onNavigate, onShowCreate }: {
  project: Project;
  sessions: StaticSession[];
  findings: Finding[];
  onNavigate: (screen: Screen) => void;
  onShowCreate: () => void;
}) {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const sessionFindingCounts = useMemo(() => {
    const map: Record<string, { critical: number; high: number; medium: number; low: number; total: number }> = {};
    for (const f of findings) {
      if (!f.sessionId) continue;
      if (!map[f.sessionId]) map[f.sessionId] = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
      const sev = f.severity.toLowerCase();
      if (sev in map[f.sessionId]) (map[f.sessionId] as any)[sev]++;
      map[f.sessionId].total++;
    }
    return map;
  }, [findings]);

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (filterType !== 'all' && s.reviewType !== filterType) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sessions, filterStatus, filterType, searchQuery]);

  // Group by status
  const grouped = useMemo(() => {
    const groups: Record<string, StaticSession[]> = {};
    for (const s of filtered) {
      const key = s.status === 'running' || s.status === 'queued' ? 'active' : s.status;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [filtered]);

  const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'queued');

  return (
    <div className="ln-section">
      {activeSessions.length > 0 && (
        <div className="ln-banner">
          <span className="ln-banner-dot" />
          <span>{activeSessions.length} review in progress</span>
          <button className="ln-btn-link" onClick={() => onNavigate({ name: 'review-session', projectId: project.id, sessionId: activeSessions[0].id })}>
            View
          </button>
        </div>
      )}

      <div className="ln-section-header">
        <span className="ln-section-label">Reviews</span>
        <button className="ln-btn-primary" onClick={onShowCreate}>New Review</button>
      </div>

      <div className="ln-filters">
        <select className="ln-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All status</option>
          <option value="success">Completed</option>
          <option value="running">Running</option>
          <option value="queued">Queued</option>
          <option value="failure">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="ln-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">All types</option>
          <option value="requirement_review">Requirement Review</option>
          <option value="code_review">Code Inspection</option>
          <option value="requirement_to_code_traceability">Traceability</option>
          <option value="cross_artifact_consistency">Consistency</option>
        </select>
        <input className="ln-input" type="text" placeholder="Filter..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="ln-empty">
          {sessions.length === 0 ? 'No reviews yet.' : 'No matches.'}
        </div>
      ) : (
        <div className="ln-list">
          {Object.entries(grouped).map(([status, items]) => (
            <div key={status} className="ln-list-group">
              <div className="ln-list-group-header">
                <span className="ln-list-group-label">
                  {status === 'active' ? 'In Progress' : status === 'success' ? 'Completed' : status}
                </span>
                <span className="ln-list-group-count">{items.length}</span>
              </div>
              {items.map(s => {
                const counts = sessionFindingCounts[s.id];
                return (
                  <div key={s.id} className="ln-list-item"
                    onClick={() => onNavigate({ name: 'review-session', projectId: project.id, sessionId: s.id })}>
                    <div className="ln-list-item-main">
                      <span className="ln-list-item-title">{s.name}</span>
                      <span className="ln-list-item-sub">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
                    </div>
                    <div className="ln-list-item-right">
                      {counts && counts.total > 0 && (
                        <span className="ln-list-item-badge ln-badge-red">{counts.total} issues</span>
                      )}
                      <span className="ln-list-item-date">
                        {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dynamic Testing Tab ─────────────────────────────────────────────────────

function DynamicTab({ project, sessions, onNavigate, onShowCreate }: {
  project: Project;
  sessions: DynamicSession[];
  onNavigate: (screen: Screen) => void;
  onShowCreate: () => void;
}) {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sessions, filterStatus, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<string, DynamicSession[]> = {};
    for (const s of filtered) {
      const key = s.status === 'running' || s.status === 'queued' ? 'active' : s.status;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [filtered]);

  const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'queued');

  return (
    <div className="ln-section">
      {activeSessions.length > 0 && (
        <div className="ln-banner">
          <span className="ln-banner-dot" />
          <span>{activeSessions.length} test in progress</span>
          <button className="ln-btn-link" onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: activeSessions[0].id })}>
            View
          </button>
        </div>
      )}

      <div className="ln-section-header">
        <span className="ln-section-label">Tests</span>
        <button className="ln-btn-primary" onClick={onShowCreate}>New Test</button>
      </div>

      <div className="ln-filters">
        <select className="ln-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All status</option>
          <option value="success">Completed</option>
          <option value="running">Running</option>
          <option value="queued">Queued</option>
          <option value="failure">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input className="ln-input" type="text" placeholder="Filter..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="ln-empty">
          {sessions.length === 0 ? 'No tests yet.' : 'No matches.'}
        </div>
      ) : (
        <div className="ln-list">
          {Object.entries(grouped).map(([status, items]) => (
            <div key={status} className="ln-list-group">
              <div className="ln-list-group-header">
                <span className="ln-list-group-label">
                  {status === 'active' ? 'In Progress' : status === 'success' ? 'Completed' : status}
                </span>
                <span className="ln-list-group-count">{items.length}</span>
              </div>
              {items.map(s => (
                <div key={s.id} className="ln-list-item"
                  onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}>
                  <div className="ln-list-item-main">
                    <span className="ln-list-item-title">{s.name}</span>
                    <span className="ln-list-item-sub">{s.targetUrl}</span>
                  </div>
                  <div className="ln-list-item-right">
                    <span className="ln-list-item-badge">{s.missionType === 'user_journey' ? 'Journey' : 'Smoke'}</span>
                    <span className="ln-list-item-date">
                      {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ProjectDetailScreen({ project, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showDynamicForm, setShowDynamicForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaticSessions = useCallback(async () => {
    try { setStaticSessions(await api.listStaticSessions(project.id)); } catch { /* ignore */ }
  }, [project.id]);

  const loadDynamicSessions = useCallback(async () => {
    try { setDynamicSessions(await api.listDynamicSessions(project.id)); } catch { /* ignore */ }
  }, [project.id]);

  const loadFindings = useCallback(async () => {
    try { setFindings(await api.listFindings(project.id)); } catch { /* ignore */ }
  }, [project.id]);

  useEffect(() => {
    loadStaticSessions();
    loadDynamicSessions();
    loadFindings();
  }, [loadStaticSessions, loadDynamicSessions, loadFindings]);

  useEffect(() => {
    const hasActive = staticSessions.some(s => s.status === 'running' || s.status === 'queued')
      || dynamicSessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActive) return;
    const interval = setInterval(() => {
      loadStaticSessions();
      loadDynamicSessions();
    }, 2000);
    return () => clearInterval(interval);
  }, [staticSessions, dynamicSessions, loadStaticSessions, loadDynamicSessions]);

  const handleCreateReview = async (data: {
    name: string;
    reviewType: ReviewType;
    artifactIds: string[];
    remarks: string;
  }) => {
    setError(null);
    try {
      const session = await api.createStaticSession(project.id, data);
      setShowReviewModal(false);
      onNavigate({ name: 'review-session', projectId: project.id, sessionId: session.id });
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

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

  const openFindings = findings.filter(f => f.status === 'new');

  return (
    <div className="ln-layout">
      {/* Sidebar */}
      <aside className="ln-sidebar">
        <nav className="ln-sidebar-nav">
          {SIDEBAR_ITEMS.map(item => {
            let count = 0;
            if (item.id === 'reviews') count = staticSessions.length;
            else if (item.id === 'dynamic') count = dynamicSessions.length;
            else if (item.id === 'findings') count = openFindings.length;

            return (
              <button
                key={item.id}
                className={`ln-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                {item.label}
                {count > 0 && <span className="ln-sidebar-count">{count}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="ln-main">
        <div className="ln-header">
          <div className="ln-breadcrumb">
            <button className="ln-breadcrumb-link" onClick={() => onNavigate({ name: 'projects' })}>
              Projects
            </button>
            <span className="ln-breadcrumb-sep">/</span>
            <span>{project.name}</span>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <OverviewTab
            project={project}
            staticSessions={staticSessions}
            dynamicSessions={dynamicSessions}
            findings={findings}
            onTabChange={setActiveTab}
          />
        )}

        {activeTab === 'reviews' && (
          <ReviewsTab
            project={project}
            sessions={staticSessions}
            findings={findings}
            onNavigate={onNavigate}
            onShowCreate={() => setShowReviewModal(true)}
          />
        )}

        {activeTab === 'dynamic' && (
          <DynamicTab
            project={project}
            sessions={dynamicSessions}
            onNavigate={onNavigate}
            onShowCreate={() => setShowDynamicForm(true)}
          />
        )}

        {activeTab === 'findings' && (
          <div className="ln-section">
            <FindingsPanel projectId={project.id} />
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="ln-section">
            <ArtifactsPanel projectId={project.id} />
          </div>
        )}
      </div>

      {showReviewModal && (
        <ReviewModal
          projectId={project.id}
          onSubmit={handleCreateReview}
          onClose={() => { setShowReviewModal(false); setError(null); }}
        />
      )}
      {showDynamicForm && (
        <DynamicTestForm onSubmit={handleCreateDynamic}
          onCancel={() => { setShowDynamicForm(false); setError(null); }} />
      )}
      {error && <p className="ln-error">{error}</p>}
    </div>
  );
}
