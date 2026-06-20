import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, X, Check, FileText, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { ReviewProgressView } from '../components/ReviewProgressView';
import type { StaticSession, Finding, Screen, ReviewProgress, ReviewArtifact } from '../types';

type Props = { projectId: string; sessionId: string; onNavigate: (screen: Screen) => void };

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-severity-${severity}`}>{severity}</span>;
}

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Requirement-to-Code Traceability',
  cross_artifact_consistency: 'Cross-Artifact Consistency',
};

export function StaticSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reviewArtifacts, setReviewArtifacts] = useState<ReviewArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
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

  if (loading) return <div className="screen"><p style={{ color: 'var(--text-muted)' }}>Loading...</p></div>;
  if (!session) return <div className="screen"><p style={{ color: 'var(--text-muted)' }}>Session not found.</p></div>;

  const isActive = session.status === 'running' || session.status === 'queued';
  const progress: ReviewProgress | null = (() => { try { return session.progressJson ? JSON.parse(session.progressJson) : null; } catch { return null; } })();
  const sortedFindings = [...findings].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (order[a.severity] ?? 99) - (order[b.severity] ?? 99);
  });

  return (
    <div className="screen animate-fade-in">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'project-detail', projectId })}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1>Static Review</h1>
        <StatusBadge status={session.status} />
        <div className="header-actions">
          {isActive && (
            <button className="btn-delete" onClick={handleCancel}><X size={14} /> Cancel</button>
          )}
          {session.status === 'success' && (
            <button className="btn-secondary" onClick={handleExportReport} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Exporting...' : 'Export Report'}
            </button>
          )}
        </div>
      </div>

      <div className="session-info">
        <div className="info-row"><span className="info-label">Name</span><span>{session.name}</span></div>
        <div className="info-row"><span className="info-label">Review Type</span><span>{REVIEW_TYPE_LABELS[session.reviewType] || session.reviewType}</span></div>
        <div className="info-row"><span className="info-label">Started</span><span>{new Date(session.createdAt).toLocaleString()}</span></div>
      </div>

      {session.remarks && (
        <div className="section"><h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={16} /> Remarks</h2><div className="summary-box">{session.remarks}</div></div>
      )}
      {session.finalSummary && (
        <div className="section"><h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={16} /> Summary</h2><div className="summary-box">{session.finalSummary}</div></div>
      )}
      {session.failureReason && (
        <div className="section"><h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlertTriangle size={16} /> Failure Reason</h2><div className="summary-box error">{session.failureReason}</div></div>
      )}

      {isActive && <div className="section"><ReviewProgressView progress={progress} /></div>}

      {sortedFindings.length > 0 && (
        <div className="section">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlertTriangle size={16} /> Findings ({sortedFindings.length})</h2>
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
                  {expandedFinding === f.id ? <ChevronUp size={14} style={{ color: 'var(--text-faint)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} />}
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
        <p style={{ color: 'var(--text-faint)', padding: '16px 0' }}>No findings were generated for this review.</p>
      )}

      {reviewArtifacts.length > 0 && (
        <div className="section review-artifacts-section">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={16} /> Generated Artifacts ({reviewArtifacts.length})</h2>
          {reviewArtifacts.map(a => (
            <div key={a.id} className="review-artifact-card">
              <div className="review-artifact-type">{a.artifactType.replace(/_/g, ' ')}</div>
              <h4>{a.title}</h4>
              <pre>{a.content}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
