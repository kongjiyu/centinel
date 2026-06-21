import { useState, useEffect, useCallback } from 'react';
import { Download, X, FileText, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, XCircle, Activity, Bug } from 'lucide-react';
import { api } from '../api/client';
import { ReviewProgressView } from '../components/ReviewProgressView';
import { CommandEmptyState, CommandPageHeader, StatusBadge } from '../components/CommandUI';
import type { StaticSession, Finding, Screen, ReviewProgress, ReviewArtifact } from '../types';

type Props = { projectId: string; sessionId: string; onNavigate: (screen: Screen) => void };

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-severity-${severity}`}>{severity}</span>;
}

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Requirement-to-Code Traceability',
  cross_artifact_consistency: 'Cross-Artifact Consistency',
};

const TAB_ITEMS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'issues', label: 'Issues', icon: '⚠️' },
  { id: 'requirements', label: 'Requirements', icon: '📋' },
  { id: 'traceability', label: 'Traceability', icon: '🔗' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'qa', label: 'QA Validation', icon: '✅' },
  { id: 'artifacts', label: 'Artifacts', icon: '📄' },
  { id: 'activity', label: 'Activity', icon: '📝' },
];

const SIDEBAR_ITEMS = [
  { id: 'overview' as TabId, label: 'Overview', icon: '📊' },
  { id: 'issues' as TabId, label: 'Issues', icon: '⚠️' },
  { id: 'requirements' as TabId, label: 'Requirements', icon: '📋' },
  { id: 'files' as TabId, label: 'Test Cases', icon: '🧪' },
  { id: 'artifacts' as TabId, label: 'Artifacts', icon: '📄' },
  { id: 'qa' as TabId, label: 'Reports', icon: '📊' },
];

function QualityGauge({ score }: { score: number }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const tier = score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const label = score >= 80 ? 'Good' : score >= 50 ? 'Needs Improvement' : 'Poor';

  return (
    <div className="rs-score-card">
      <h3>Overall Quality Score</h3>
      <div className="rs-score-gauge">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle className="rs-score-gauge-bg" cx="60" cy="60" r={radius} />
          <circle
            className={`rs-score-gauge-fill ${tier}`}
            cx="60" cy="60" r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="rs-score-value">
          <div className="rs-score-number">{score}</div>
          <div className="rs-score-max">/100</div>
        </div>
      </div>
      <div className={`rs-score-label ${tier}`}>{label}</div>
    </div>
  );
}

function IssuesSummary({ findings }: { findings: Finding[] }) {
  const counts = useMemo(() => {
    const c = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach(f => {
      const sev = f.severity.toLowerCase();
      if (sev in c) (c as any)[sev]++;
    });
    return c;
  }, [findings]);

  return (
    <div className="rs-issues-card">
      <h3>Issues Summary</h3>
      <div className="rs-issues-grid">
        <div className="rs-issue-stat">
          <span className="rs-issue-stat-label">Total Issues</span>
          <span className="rs-issue-stat-value">{counts.total}</span>
        </div>
        <div className="rs-issue-stat">
          <span className="rs-issue-stat-label">Critical</span>
          <span className="rs-issue-stat-value critical">{counts.critical}</span>
        </div>
        <div className="rs-issue-stat">
          <span className="rs-issue-stat-label">High</span>
          <span className="rs-issue-stat-value high">{counts.high}</span>
        </div>
        <div className="rs-issue-stat">
          <span className="rs-issue-stat-label">Medium</span>
          <span className="rs-issue-stat-value medium">{counts.medium}</span>
        </div>
        <div className="rs-issue-stat">
          <span className="rs-issue-stat-label">Low</span>
          <span className="rs-issue-stat-value low">{counts.low}</span>
        </div>
      </div>
    </div>
  );
}

function RequirementCoverage({ findings, totalRequirements }: { findings: Finding[]; totalRequirements: number }) {
  // Derive coverage from findings
  const coverage = useMemo(() => {
    const mapped = findings.filter(f => f.category?.includes('requirement') || f.category?.includes('traceability'));
    const impl = totalRequirements > 0 ? Math.round(((totalRequirements - mapped.length) / totalRequirements) * 100) : 0;
    return {
      percent: Math.max(0, Math.min(100, impl)),
      implemented: Math.max(0, Math.min(100, impl)),
      partial: Math.min(7, 100 - impl),
      missing: Math.min(3, Math.max(0, 100 - impl - 7)),
    };
  }, [findings, totalRequirements]);

  return (
    <div className="rs-coverage-card">
      <h3>Requirement Coverage</h3>
      <div className="rs-coverage-header">
        <span className="rs-coverage-percent">{coverage.percent}%</span>
        <div className="rs-coverage-bar">
          <div className="rs-coverage-bar-seg implemented" style={{ width: `${coverage.implemented}%` }} />
          <div className="rs-coverage-bar-seg partial" style={{ width: `${coverage.partial}%` }} />
          <div className="rs-coverage-bar-seg missing" style={{ width: `${coverage.missing}%` }} />
        </div>
      </div>
      <div className="rs-coverage-legend">
        <div className="rs-coverage-legend-item">
          <span className="rs-coverage-legend-dot implemented" />
          Implemented {coverage.implemented}%
        </div>
        <div className="rs-coverage-legend-item">
          <span className="rs-coverage-legend-dot partial" />
          Partial {coverage.partial}%
        </div>
        <div className="rs-coverage-legend-item">
          <span className="rs-coverage-legend-dot missing" />
          Missing {coverage.missing}%
        </div>
      </div>
    </div>
  );
}

function ContextUsed() {
  const items = [
    { icon: '📄', label: 'Source Code', value: '—' },
    { icon: '📋', label: 'Requirement Document', value: '—' },
    { icon: '📝', label: 'User Stories', value: '—' },
    { icon: '📐', label: 'Coding Standard', value: '—' },
    { icon: '✅', label: 'Review Checklist', value: '—' },
    { icon: '🧪', label: 'Test Cases', value: '—' },
  ];

  return (
    <div className="rs-card">
      <h3>Context Used in This Review</h3>
      <div className="rs-context-list">
        {items.map(item => (
          <div key={item.label} className="rs-context-item">
            <div className="rs-context-item-left">
              <span className="rs-context-item-icon">{item.icon}</span>
              {item.label}
            </div>
            <div className="rs-context-item-right">
              {item.value}
              <span className="rs-context-check">✓</span>
            </div>
          </div>
        ))}
      </div>
      <button className="rs-context-link">View all context →</button>
    </div>
  );
}

function ScopeInfo({ session, findings }: { session: StaticSession; findings: Finding[] }) {
  return (
    <div className="rs-card">
      <h3>Scope</h3>
      <div className="rs-scope-stats">
        <div className="rs-scope-stat">
          <div className="rs-scope-stat-value">—</div>
          <div className="rs-scope-stat-label">Files Reviewed</div>
        </div>
        <div className="rs-scope-stat">
          <div className="rs-scope-stat-value">{findings.length}</div>
          <div className="rs-scope-stat-label">Changed Files</div>
        </div>
        <div className="rs-scope-stat">
          <div className="rs-scope-stat-value">—</div>
          <div className="rs-scope-stat-label">Files Skipped</div>
        </div>
      </div>
      <div className="rs-scope-details">
        <div className="rs-scope-detail">
          <span className="rs-scope-detail-label">Review Type</span>
          <span className="rs-scope-detail-value">{REVIEW_TYPE_LABELS[session.reviewType] || session.reviewType}</span>
        </div>
        <div className="rs-scope-detail">
          <span className="rs-scope-detail-label">Analysis Scope</span>
          <span className="rs-scope-detail-value">Repository</span>
        </div>
        <div className="rs-scope-detail">
          <span className="rs-scope-detail-label">Total Lines of Code</span>
          <span className="rs-scope-detail-value">—</span>
        </div>
      </div>
    </div>
  );
}

function QuickLinks({ onTabChange, issueCount }: { onTabChange: (tab: TabId) => void; issueCount: number }) {
  const links = [
    { tab: 'issues' as TabId, label: `Issues (${issueCount})`, icon: '⚠️' },
    { tab: 'requirements' as TabId, label: 'Requirements', icon: '📋' },
    { tab: 'traceability' as TabId, label: 'Traceability Matrix', icon: '🔗' },
    { tab: 'qa' as TabId, label: 'QA Validation', icon: '✅' },
    { tab: 'artifacts' as TabId, label: 'Artifacts', icon: '📄' },
  ];

  return (
    <div className="rs-card">
      <h3>Quick Links</h3>
      <div className="rs-quick-links">
        {links.map(link => (
          <button
            key={link.tab}
            className="rs-quick-link"
            onClick={() => onTabChange(link.tab)}
          >
            <span className="rs-quick-link-label">
              <span>{link.icon}</span>
              {link.label}
            </span>
            <span className="rs-quick-link-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RecentIssuesTable({ findings, onNavigate }: { findings: Finding[]; onNavigate: (screen: Screen) => void }) {
  const sorted = useMemo(() => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...findings]
      .sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99))
      .slice(0, 5);
  }, [findings]);

  return (
    <div className="rs-issues-table-card">
      <div className="rs-issues-table-header">
        <h3>Recent Issues</h3>
        <button className="rs-issues-table-header-link">View all issues →</button>
      </div>
      {sorted.length === 0 ? (
        <div className="rs-empty">No issues found for this review session.</div>
      ) : (
        <table className="rs-issues-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Title</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(f => (
              <tr key={f.id}>
                <td>
                  <span className={`rs-issue-severity ${f.severity.toLowerCase()}`}>
                    {f.severity}
                  </span>
                </td>
                <td>{f.title}</td>
                <td style={{ color: '#94a3b8' }}>{f.category?.replace(/_/g, ' ') || '—'}</td>
                <td>
                  <span className={`rs-issue-status ${f.status}`}>
                    {f.status === 'new' ? 'Open' : f.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OverviewTab({ session, findings, totalRequirements, onTabChange, onNavigate }: {
  session: StaticSession;
  findings: Finding[];
  totalRequirements: number;
  onTabChange: (tab: TabId) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const score = useMemo(() => {
    if (findings.length === 0) return 100;
    const critical = findings.filter(f => f.severity === 'critical').length * 15;
    const high = findings.filter(f => f.severity === 'high').length * 8;
    const medium = findings.filter(f => f.severity === 'medium').length * 3;
    const low = findings.filter(f => f.severity === 'low').length * 1;
    return Math.max(0, Math.min(100, 100 - critical - high - medium - low));
  }, [findings]);

  return (
    <div className="rs-overview">
      <div className="rs-top-row">
        <QualityGauge score={score} />
        <IssuesSummary findings={findings} />
        <div className="rs-decision-card">
          <h3>Review Decision</h3>
          {findings.some(f => f.severity === 'critical') ? (
            <>
              <div className="rs-decision-badge rework">⚠ Needs Rework</div>
              <div className="rs-decision-note">
                {findings.filter(f => f.severity === 'critical').length} critical issues must be resolved
              </div>
            </>
          ) : findings.length > 0 ? (
            <>
              <div className="rs-decision-badge pending">⏳ Pending Review</div>
              <div className="rs-decision-note">Review decision pending</div>
            </>
          ) : (
            <>
              <div className="rs-decision-badge approved">✓ Approved</div>
              <div className="rs-decision-note">No issues found</div>
            </>
          )}
          <button className="rs-decision-link">View decision history →</button>
        </div>
      </div>

      <RequirementCoverage findings={findings} totalRequirements={totalRequirements} />

      <div className="rs-middle-row">
        <ContextUsed />
        <ScopeInfo session={session} findings={findings} />
        <QuickLinks onTabChange={onTabChange} issueCount={findings.length} />
      </div>

      <RecentIssuesTable findings={findings} onNavigate={onNavigate} />
    </div>
  );
}

function IssuesTab({ findings, onAccept, onDismiss }: {
  findings: Finding[];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  const sorted = useMemo(() => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...findings]
      .filter(f => filterSeverity === 'all' || f.severity === filterSeverity)
      .sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
  }, [findings, filterSeverity]);

  return (
    <div className="rs-overview">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
          Issues ({sorted.length})
        </h2>
        <select
          value={filterSeverity}
          onChange={e => setFilterSeverity(e.target.value)}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            padding: '6px 10px', color: '#e2e8f0', fontSize: 13
          }}
        >
          <option value="all">All Severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="rs-empty">No issues found.</div>
      ) : (
        <div className="rs-findings-list">
          {sorted.map((f, i) => (
            <div key={f.id} className="rs-finding-row">
              <div
                className="rs-finding-header"
                onClick={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}
              >
                <span className="rs-finding-index">{i + 1}</span>
                <span className={`rs-issue-severity ${f.severity.toLowerCase()}`}>{f.severity}</span>
                <span className="rs-finding-title">{f.title}</span>
                {f.category && (
                  <span className="rs-finding-category">{f.category.replace(/_/g, ' ')}</span>
                )}
                <span className={`rs-issue-status ${f.status}`}>
                  {f.status === 'new' ? 'Open' : f.status}
                </span>
              </div>

              {expandedFinding === f.id && (
                <div className="rs-finding-detail">
                  <p className="rs-finding-description">{f.description}</p>
                  {f.evidenceText && (
                    <div className="rs-finding-evidence">
                      <strong>Evidence:</strong>
                      <pre>{f.evidenceText}</pre>
                    </div>
                  )}
                  {f.recommendation && (
                    <div className="rs-finding-recommendation">
                      <strong>Recommendation:</strong> {f.recommendation}
                    </div>
                  )}
                  {f.confidence && (
                    <div className="rs-finding-meta">Confidence: {f.confidence}</div>
                  )}
                  {f.status === 'new' && (
                    <div className="rs-finding-actions">
                      <button className="rs-btn-accept" onClick={() => onAccept(f.id)}>Accept</button>
                      <button className="rs-btn-dismiss" onClick={() => onDismiss(f.id)}>Dismiss</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactsTab({ artifacts }: { artifacts: ReviewArtifact[] }) {
  if (artifacts.length === 0) {
    return <div className="rs-placeholder"><h2>Artifacts</h2><p>No artifacts generated for this session.</p></div>;
  }
  return (
    <div className="rs-overview">
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', margin: '0 0 16px' }}>
        Generated Artifacts ({artifacts.length})
      </h2>
      {artifacts.map(a => (
        <div key={a.id} className="rs-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
            {a.artifactType.replace(/_/g, ' ')}
          </div>
          <h3 style={{ fontSize: 14, color: '#f1f5f9' }}>{a.title}</h3>
          <pre style={{
            margin: '8px 0 0', fontSize: 12, color: '#94a3b8',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto'
          }}>{a.content}</pre>
        </div>
      ))}
    </div>
  );
}

export function StaticSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reviewArtifacts, setReviewArtifacts] = useState<ReviewArtifact[]>([]);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.getStaticSession(projectId, sessionId),
        api.listStaticFindings(projectId, sessionId),
      ]);
      setSession(s); setFindings(f);
      if (s.status === 'success') {
        setReviewArtifacts(await api.listReviewArtifacts(projectId, sessionId));
      }
    } catch {} finally { setLoading(false); }
  }, [projectId, sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'queued')) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  const handleCancel = async () => { try { await api.cancelStaticSession(projectId, sessionId); await load(); } catch {} };

  const handleAccept = async (findingId: string) => {
    try { await api.updateFinding(projectId, findingId, 'accepted'); setFindings(prev => prev.map(f => f.id === findingId ? { ...f, status: 'accepted' } : f)); } catch {}
  };

  const handleDismiss = async (findingId: string) => {
    try { await api.updateFinding(projectId, findingId, 'dismissed'); setFindings(prev => prev.map(f => f.id === findingId ? { ...f, status: 'dismissed' } : f)); } catch {}
  };

  const handleExportReport = async () => {
    setExporting(true);
    try { const result = await api.exportSessionReport(projectId, sessionId); alert(`Report exported to:\n${result.reportPath}`); }
    catch (e) { alert(`Export failed: ${e}`); }
    finally { setExporting(false); }
  };

  if (loading) return <div className="screen command-loading"><Activity size={20} /> Loading review...</div>;
  if (!session) return <div className="screen"><CommandEmptyState icon={Bug} title="Review not found" description="This static review is unavailable or has been removed." /></div>;

  const isActive = session.status === 'running' || session.status === 'queued';
  const progress: ReviewProgress | null = (() => { try { return session.progressJson ? JSON.parse(session.progressJson) : null; } catch { return null; } })();
  const sortedFindings = [...findings].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (order[a.severity] ?? 99) - (order[b.severity] ?? 99);
  });

  return (
    <div className="screen command-static-session animate-fade-in">
      <CommandPageHeader
        eyebrow="Static Analysis"
        title={session.name || 'Static Review'}
        description={REVIEW_TYPE_LABELS[session.reviewType] || session.reviewType}
        status={{ label: session.status }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<span>{new Date(session.createdAt).toLocaleString()}</span>}
        actions={(
          <>
          {isActive && (
            <button className="btn-delete" onClick={handleCancel}><X size={14} /> Cancel</button>
          )}
          {session.status === 'success' && (
            <button className="btn-secondary" onClick={handleExportReport} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Exporting...' : 'Export Report'}
            </button>
          )}
          </>
        )}
      />

      <div className="session-info">
        <div className="info-row"><span className="info-label">Name</span><span>{session.name}</span></div>
        <div className="info-row"><span className="info-label">Review Type</span><span>{REVIEW_TYPE_LABELS[session.reviewType] || session.reviewType}</span></div>
        <div className="info-row"><span className="info-label">Started</span><span>{new Date(session.createdAt).toLocaleString()}</span></div>
      </div>

      {session.remarks && (
        <div className="section"><h2 className="command-section-heading"><FileText size={16} /> Remarks</h2><div className="summary-box">{session.remarks}</div></div>
      )}
      {session.finalSummary && (
        <div className="section"><h2 className="command-section-heading"><FileText size={16} /> Summary</h2><div className="summary-box">{session.finalSummary}</div></div>
      )}
      {session.failureReason && (
        <div className="section"><h2 className="command-section-heading"><AlertTriangle size={16} /> Failure Reason</h2><div className="summary-box error">{session.failureReason}</div></div>
      )}

      {isActive && <div className="section"><ReviewProgressView progress={progress} /></div>}

      {sortedFindings.length > 0 && (
        <div className="section">
          <h2 className="command-section-heading"><AlertTriangle size={16} /> Findings ({sortedFindings.length})</h2>
          <div className="findings-list stagger-children">
            {sortedFindings.map((f, i) => (
              <div key={f.id} className={`finding-row finding-${f.status}`}>
                <div className="finding-header" onClick={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}>
                  <span className="finding-index">{i + 1}</span>
                  <SeverityBadge severity={f.severity} />
                  <span className="finding-title">{f.title}</span>
                  {f.category && <span className="finding-category">{f.category.replace(/_/g, ' ')}</span>}
                  {f.fromRemarks && <span className="badge-from-remarks">Reviewer Notes</span>}
                  <span className={`finding-status finding-status-${f.status}`}>{f.status}</span>
                  {expandedFinding === f.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>

                {expandedFinding === f.id && (
                  <div className="finding-detail animate-slide-up">
                    <p className="finding-description">{f.description}</p>
                    {f.evidenceText && (
                      <div className="finding-evidence"><strong>Evidence:</strong><pre>{f.evidenceText}</pre></div>
                    )}
                    {f.recommendation && (
                      <div className="finding-recommendation"><strong>Recommendation:</strong> {f.recommendation}</div>
                    )}
                    <div className="finding-meta">{f.confidence && <span>Confidence: {f.confidence}</span>}</div>
                    {f.status === 'new' && (
                      <div className="finding-actions">
                        <button className="btn-accept" onClick={() => handleAccept(f.id)}><CheckCircle2 size={12} /> Accept</button>
                        <button className="btn-dismiss" onClick={() => handleDismiss(f.id)}><XCircle size={12} /> Dismiss</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isActive && findings.length === 0 && session.status === 'success' && (
        <p className="command-compact-empty">No findings were generated for this review.</p>
      )}

      {reviewArtifacts.length > 0 && (
        <div className="section review-artifacts-section">
          <h2 className="command-section-heading"><FileText size={16} /> Generated Artifacts ({reviewArtifacts.length})</h2>
          {reviewArtifacts.map(a => (
            <div key={a.id} className="review-artifact-card">
              <div className="review-artifact-type">{a.artifactType.replace(/_/g, ' ')}</div>
              <h4>{a.title}</h4>
              <pre>{a.content}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
