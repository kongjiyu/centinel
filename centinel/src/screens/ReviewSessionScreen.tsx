import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { ReviewProgressView } from '../components/ReviewProgressView';
import type { StaticSession, Finding, Screen, ReviewProgress, ReviewArtifact, Requirement } from '../types';

type Props = {
  projectId: string;
  sessionId: string;
  onNavigate: (screen: Screen) => void;
};

type TabId = 'overview' | 'issues' | 'requirements' | 'traceability' | 'testcases' | 'artifacts' | 'activity';

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Requirement-to-Code Traceability',
  cross_artifact_consistency: 'Cross-Artifact Consistency',
};

const SIDEBAR_ITEMS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'issues', label: 'Issues', icon: '⚠️' },
  { id: 'requirements', label: 'Requirements', icon: '📋' },
  { id: 'traceability', label: 'Traceability', icon: '🔗' },
  { id: 'testcases', label: 'Test Cases', icon: '🧪' },
  { id: 'artifacts', label: 'Artifacts', icon: '📄' },
  { id: 'activity', label: 'Activity', icon: '📝' },
];

const TAB_ITEMS: { id: TabId; label: string }[] = SIDEBAR_ITEMS.map(({ id, label }) => ({ id, label }));

// ─── Sub-components ──────────────────────────────────────────────────────────

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
  const links: { tab: TabId; label: string; icon: string }[] = [
    { tab: 'issues', label: `Issues (${issueCount})`, icon: '⚠️' },
    { tab: 'requirements', label: 'Requirements', icon: '📋' },
    { tab: 'traceability', label: 'Traceability Matrix', icon: '🔗' },
    { tab: 'testcases', label: 'Test Cases', icon: '🧪' },
    { tab: 'artifacts', label: 'Artifacts', icon: '📄' },
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

function RecentIssuesTable({ findings }: { findings: Finding[] }) {
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

// ─── Tab Panels ──────────────────────────────────────────────────────────────

function OverviewTab({ session, findings, totalRequirements, onTabChange }: {
  session: StaticSession;
  findings: Finding[];
  totalRequirements: number;
  onTabChange: (tab: TabId) => void;
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

      <RecentIssuesTable findings={findings} />
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
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const sorted = useMemo(() => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...findings]
      .filter(f => filterSeverity === 'all' || f.severity === filterSeverity)
      .filter(f => filterStatus === 'all' || f.status === filterStatus)
      .sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
  }, [findings, filterSeverity, filterStatus]);

  return (
    <div className="rs-overview">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
          Issues ({sorted.length})
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
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
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
              padding: '6px 10px', color: '#e2e8f0', fontSize: 13
            }}
          >
            <option value="all">All Status</option>
            <option value="new">Open</option>
            <option value="accepted">Accepted</option>
            <option value="dismissed">Dismissed</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rs-empty">No issues match the current filters.</div>
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

function RequirementsTab({ requirements, findings }: { requirements: Requirement[]; findings: Finding[] }) {
  const requirementFindings = useMemo(() =>
    findings.filter(f => f.category?.includes('requirement')),
    [findings]
  );

  return (
    <div className="rs-overview">
      <div className="rs-card">
        <h3>Requirements ({requirements.length})</h3>
        {requirements.length === 0 ? (
          <div className="rs-empty">No requirements linked to this project. Add requirements from the project detail page.</div>
        ) : (
          <div className="rs-findings-list">
            {requirements.map((r) => {
              const relatedFindings = requirementFindings.filter(f =>
                f.description?.toLowerCase().includes(r.title.toLowerCase()) ||
                f.title?.toLowerCase().includes(r.title.toLowerCase())
              );
              const hasIssues = relatedFindings.length > 0;
              return (
                <div key={r.id} className="rs-finding-row">
                  <div className="rs-finding-header">
                    <span className={`rs-issue-severity ${hasIssues ? 'high' : 'low'}`}>
                      {hasIssues ? 'Issue' : 'OK'}
                    </span>
                    <span className="rs-finding-title">{r.title}</span>
                    <span className="rs-finding-category">{r.category || '—'}</span>
                    <span className="rs-finding-category">{r.priority || '—'}</span>
                  </div>
                  {hasIssues && (
                    <div className="rs-finding-detail">
                      <p className="rs-finding-description">
                        {relatedFindings.length} issue{relatedFindings.length > 1 ? 's' : ''} found related to this requirement.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TraceabilityTab({ requirements, findings }: { requirements: Requirement[]; findings: Finding[] }) {
  // Build a simple traceability matrix
  const matrix = useMemo(() => {
    return requirements.map(req => {
      const relatedFindings = findings.filter(f =>
        f.description?.toLowerCase().includes(req.title.toLowerCase()) ||
        f.title?.toLowerCase().includes(req.title.toLowerCase())
      );
      const hasCode = true; // placeholder — in real impl, check requirement mappings
      return {
        requirement: req,
        hasCode,
        hasTests: false, // placeholder
        issues: relatedFindings.length,
        status: relatedFindings.some(f => f.severity === 'critical') ? 'blocked'
          : relatedFindings.length > 0 ? 'partial'
          : 'covered',
      };
    });
  }, [requirements, findings]);

  return (
    <div className="rs-overview">
      <div className="rs-card">
        <h3>Traceability Matrix</h3>
        {matrix.length === 0 ? (
          <div className="rs-empty">No requirements to trace. Add requirements first.</div>
        ) : (
          <table className="rs-issues-table">
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Code</th>
                <th>Tests</th>
                <th>Issues</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map(row => (
                <tr key={row.requirement.id}>
                  <td>{row.requirement.title}</td>
                  <td>{row.hasCode ? '✅' : '❌'}</td>
                  <td>{row.hasTests ? '✅' : '❌'}</td>
                  <td>{row.issues}</td>
                  <td>
                    <span className={`rs-issue-status ${row.status === 'covered' ? 'fixed' : row.status === 'partial' ? 'accepted' : 'new'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TestCasesTab() {
  return (
    <div className="rs-placeholder">
      <h2>Test Cases</h2>
      <p>Test case generation and linking coming soon. This tab will show test cases derived from review findings.</p>
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

function ActivityTab({ session, findings }: { session: StaticSession; findings: Finding[] }) {
  const accepted = findings.filter(f => f.status === 'accepted').length;
  const dismissed = findings.filter(f => f.status === 'dismissed').length;
  const fixed = findings.filter(f => f.status === 'fixed').length;

  return (
    <div className="rs-overview">
      <div className="rs-card">
        <h3>Activity Timeline</h3>
        <div className="rs-activity-list">
          <div className="rs-activity-item">
            <div className="rs-activity-dot" />
            <div className="rs-activity-content">
              <div className="rs-activity-text">Review session created</div>
              <div className="rs-activity-time">{new Date(session.createdAt).toLocaleString()}</div>
            </div>
          </div>
          {session.status === 'success' && (
            <>
              <div className="rs-activity-item">
                <div className="rs-activity-dot" style={{ background: '#22c55e' }} />
                <div className="rs-activity-content">
                  <div className="rs-activity-text">Review completed — {findings.length} issues found</div>
                  <div className="rs-activity-time">{new Date(session.updatedAt).toLocaleString()}</div>
                </div>
              </div>
              {accepted > 0 && (
                <div className="rs-activity-item">
                  <div className="rs-activity-dot" style={{ background: '#3b82f6' }} />
                  <div className="rs-activity-content">
                    <div className="rs-activity-text">{accepted} issue{accepted > 1 ? 's' : ''} accepted</div>
                  </div>
                </div>
              )}
              {dismissed > 0 && (
                <div className="rs-activity-item">
                  <div className="rs-activity-dot" style={{ background: '#f59e0b' }} />
                  <div className="rs-activity-content">
                    <div className="rs-activity-text">{dismissed} issue{dismissed > 1 ? 's' : ''} dismissed</div>
                  </div>
                </div>
              )}
              {fixed > 0 && (
                <div className="rs-activity-item">
                  <div className="rs-activity-dot" style={{ background: '#22c55e' }} />
                  <div className="rs-activity-content">
                    <div className="rs-activity-text">{fixed} issue{fixed > 1 ? 's' : ''} marked as fixed</div>
                  </div>
                </div>
              )}
            </>
          )}
          {session.status === 'failure' && (
            <div className="rs-activity-item">
              <div className="rs-activity-dot" style={{ background: '#ef4444' }} />
              <div className="rs-activity-content">
                <div className="rs-activity-text">Review failed: {session.failureReason || 'Unknown error'}</div>
                <div className="rs-activity-time">{new Date(session.updatedAt).toLocaleString()}</div>
              </div>
            </div>
          )}
          {session.status === 'cancelled' && (
            <div className="rs-activity-item">
              <div className="rs-activity-dot" style={{ background: '#f59e0b' }} />
              <div className="rs-activity-content">
                <div className="rs-activity-text">Review cancelled</div>
                <div className="rs-activity-time">{new Date(session.updatedAt).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ReviewSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reviewArtifacts, setReviewArtifacts] = useState<ReviewArtifact[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.getStaticSession(projectId, sessionId),
        api.listStaticFindings(projectId, sessionId),
      ]);
      setSession(s);
      setFindings(f);
      if (s.status === 'success') {
        const [arts, reqs] = await Promise.all([
          api.listReviewArtifacts(projectId, sessionId),
          api.listRequirements(projectId).catch(() => []),
        ]);
        setReviewArtifacts(arts);
        setRequirements(reqs);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionId]);

  useEffect(() => { load(); }, [load]);

  // Poll while running
  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'queued')) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  const handleAccept = async (findingId: string) => {
    try {
      await api.updateFinding(projectId, findingId, 'accepted');
      setFindings(prev => prev.map(f => f.id === findingId ? { ...f, status: 'accepted' } : f));
    } catch { /* ignore */ }
  };

  const handleDismiss = async (findingId: string) => {
    try {
      await api.updateFinding(projectId, findingId, 'dismissed');
      setFindings(prev => prev.map(f => f.id === findingId ? { ...f, status: 'dismissed' } : f));
    } catch { /* ignore */ }
  };

  const handleExportReport = async () => {
    setExporting(true);
    try {
      const result = await api.exportSessionReport(projectId, sessionId);
      alert(`Report exported to:\n${result.reportPath}`);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancelStaticSession(projectId, sessionId);
      await load();
    } catch { /* ignore */ }
  };

  if (loading) return <div className="screen"><p>Loading...</p></div>;
  if (!session) return <div className="screen"><p>Session not found.</p></div>;

  const isActive = session.status === 'running' || session.status === 'queued';
  const progress: ReviewProgress | null = (() => {
    try { return session.progressJson ? JSON.parse(session.progressJson) : null; }
    catch { return null; }
  })();

  const tabCountMap: Record<TabId, number> = {
    overview: 0,
    issues: findings.length,
    requirements: requirements.length,
    traceability: 0,
    testcases: 0,
    artifacts: reviewArtifacts.length,
    activity: 0,
  };

  return (
    <div className="rs-layout">
      {/* Session Sidebar */}
      <aside className="rs-sidebar">
        <nav className="rs-sidebar-nav">
          {SIDEBAR_ITEMS.map(item => (
            <button
              key={item.id}
              className={`rs-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="rs-sidebar-icon">{item.icon}</span>
              {item.label}
              {tabCountMap[item.id] > 0 && (
                <span className="rs-sidebar-count">{tabCountMap[item.id]}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="rs-sidebar-project">
          <div className="rs-sidebar-project-name">Review Session</div>
          <div className="rs-sidebar-project-branch">
            {session.name}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="rs-main">
        {/* Breadcrumbs */}
        <div className="rs-breadcrumbs">
          <button className="rs-breadcrumb-link" onClick={() => onNavigate({ name: 'projects' })}>
            Projects
          </button>
          <span className="rs-breadcrumb-sep">›</span>
          <button className="rs-breadcrumb-link" onClick={() => onNavigate({ name: 'project-detail', projectId })}>
            Project
          </button>
          <span className="rs-breadcrumb-sep">›</span>
          <button className="rs-breadcrumb-link" onClick={() => onNavigate({ name: 'review', projectId })}>
            Reviews
          </button>
          <span className="rs-breadcrumb-sep">›</span>
          <span className="rs-breadcrumb-current">{session.name}</span>
        </div>

        {/* Header */}
        <div className="rs-header">
          <div className="rs-header-left">
            <div className="rs-header-title-row">
              <h1 className="rs-header-title">Review Session: {session.name}</h1>
              <span className={`rs-status-badge ${session.status}`}>
                {session.status === 'success' ? 'Completed' : session.status}
              </span>
            </div>
            <div className="rs-header-meta">
              <span className="rs-meta-item">
                <span className="rs-meta-icon">📅</span>
                {new Date(session.createdAt).toLocaleDateString('en-US', {
                  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                })}
              </span>
              <span className="rs-meta-item">
                <span className="rs-meta-icon">🔀</span>
                {REVIEW_TYPE_LABELS[session.reviewType] || session.reviewType}
              </span>
            </div>
          </div>
          <div className="rs-header-actions">
            {isActive && (
              <button className="rs-btn rs-btn-secondary" onClick={handleCancel}>Cancel</button>
            )}
            {session.status === 'success' && (
              <button className="rs-btn rs-btn-secondary" onClick={handleExportReport} disabled={exporting}>
                <span className="rs-btn-icon">📥</span>
                {exporting ? 'Exporting...' : 'Download Report'}
              </button>
            )}
            {session.status === 'success' && (
              <button className="rs-btn rs-btn-primary">
                <span className="rs-btn-icon">🔄</span>
                Re-run Review
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="rs-tabs">
          {TAB_ITEMS.map(tab => (
            <button
              key={tab.id}
              className={`rs-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tabCountMap[tab.id] > 0 && (
                <span className="rs-tab-count">{tabCountMap[tab.id]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Active running progress */}
        {isActive && progress && (
          <div className="rs-overview">
            <div className="rs-card">
              <ReviewProgressView progress={progress} />
            </div>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'overview' && !isActive && (
          <OverviewTab
            session={session}
            findings={findings}
            totalRequirements={requirements.length}
            onTabChange={setActiveTab}
          />
        )}

        {activeTab === 'issues' && (
          <IssuesTab findings={findings} onAccept={handleAccept} onDismiss={handleDismiss} />
        )}

        {activeTab === 'requirements' && (
          <RequirementsTab requirements={requirements} findings={findings} />
        )}

        {activeTab === 'traceability' && (
          <TraceabilityTab requirements={requirements} findings={findings} />
        )}

        {activeTab === 'testcases' && (
          <TestCasesTab />
        )}

        {activeTab === 'artifacts' && (
          <ArtifactsTab artifacts={reviewArtifacts} />
        )}

        {activeTab === 'activity' && (
          <ActivityTab session={session} findings={findings} />
        )}
      </div>
    </div>
  );
}
