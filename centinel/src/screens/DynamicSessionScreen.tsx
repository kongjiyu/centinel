import { useState, useEffect, useCallback } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, X, Copy, Check, Image, FileText, Terminal, Bug, Activity, Clock } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader } from '../components/CommandUI';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';

type Props = { projectId: string; sessionId: string; onNavigate: (screen: Screen) => void };

function evidenceImageSrc(filePath: string): string {
  return `http://localhost:37701/evidence-file?path=${encodeURIComponent(filePath)}`;
}

const EVIDENCE_ICONS: Record<string, typeof Image> = {
  screenshot: Image,
  action_trace: Activity,
  ai_request: FileText,
  ai_response: FileText,
  console_log: Terminal,
  debug_log: Bug,
  session_summary: FileText,
};

const EVIDENCE_GROUPS: { type: DynamicEvidence['type']; label: string }[] = [
  { type: 'screenshot', label: 'Screenshots' },
  { type: 'action_trace', label: 'Action Trace' },
  { type: 'ai_response', label: 'AI Responses' },
  { type: 'ai_request', label: 'AI Requests' },
  { type: 'console_log', label: 'Console Logs' },
  { type: 'debug_log', label: 'Debug Log' },
  { type: 'session_summary', label: 'Session Summary' },
];

export function DynamicSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<DynamicSession | null>(null);
  const [evidence, setEvidence] = useState<DynamicEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScreenshot, setSelectedScreenshot] = useState<DynamicEvidence | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportResult, setExportResult] = useState<{
    success: boolean; message: string; reportPath?: string; markdown?: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        api.getDynamicSession(projectId, sessionId),
        api.listDynamicEvidence(projectId, sessionId),
      ]);
      setSession(s); setEvidence(e);
    } catch (err) { console.error('Failed to load dynamic session:', err); }
    finally { setLoading(false); }
  }, [projectId, sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'queued')) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedScreenshot) setSelectedScreenshot(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedScreenshot]);

  const handleCancel = async () => {
    try { await api.cancelDynamicSession(projectId, sessionId); await load(); } catch {}
  };

  const handleExport = async () => {
    setExporting(true); setExportResult(null);
    try {
      const result = await api.exportDynamicSessionReport(projectId, sessionId);
      setExportResult({ success: true, message: 'Report exported successfully', reportPath: result.reportPath, markdown: result.markdown });
    } catch (e) { setExportResult({ success: false, message: `Export failed: ${String(e)}` }); }
    finally { setExporting(false); }
  };

  const handleCopyPath = async (path: string) => {
    try { await writeText(path); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch (err) { console.error('Failed to copy path:', err); }
  };

  if (loading) return <div className="screen command-loading"><Activity size={20} /> Loading session...</div>;
  if (!session) return <div className="screen"><CommandEmptyState icon={Bug} title="Session not found" description="This dynamic session is unavailable or has been removed." /></div>;

  const isActive = session.status === 'running' || session.status === 'queued';

  return (
    <div className="screen command-dynamic-session animate-fade-in">
      <CommandPageHeader
        eyebrow="Autonomous UI Validation"
        title={session.name || 'Dynamic Test'}
        description={session.goal}
        status={{ label: session.status }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<><span>{session.missionType === 'smoke' ? 'Smoke test' : 'User journey'}</span><span>{new Date(session.createdAt).toLocaleString()}</span></>}
        actions={(
          <>
          {!isActive && (
            <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Exporting...' : 'Export Summary'}
            </button>
          )}
          {isActive && (
            <button className="btn-delete" onClick={handleCancel}>
              <X size={14} /> Cancel
            </button>
          )}
          </>
        )}
      />

      {exportResult && (
        <div className={`export-result ${exportResult.success ? 'success' : 'error'} animate-slide-up`}>
          <div className="export-result-message">{exportResult.message}</div>

          {exportResult.markdown && (
            <div className="report-preview">
              <h3 className="command-section-heading">
                <FileText size={14} /> Report Preview
              </h3>
              <div className="report-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{exportResult.markdown}</ReactMarkdown>
              </div>
            </div>
          )}

          {exportResult.reportPath && (
            <div className="export-result-path">
              <span className="export-result-path-label">File Location:</span>
              <code>{exportResult.reportPath}</code>
              <button className="btn-copy" onClick={() => handleCopyPath(exportResult.reportPath!)}>
                {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Path</>}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="session-info">
        <div className="info-row"><span className="info-label">Goal</span><span>{session.goal}</span></div>
        <div className="info-row"><span className="info-label">Target</span><code>{session.targetUrl}</code></div>
        <div className="info-row"><span className="info-label">Mission</span><span>{session.missionType === 'smoke' ? 'Smoke Test' : 'User Journey'}</span></div>
        <div className="info-row"><span className="info-label">Max Steps</span><span>{session.maxSteps}</span></div>
        <div className="info-row"><span className="info-label">Started</span><span>{new Date(session.createdAt).toLocaleString()}</span></div>
      </div>

      {session.finalSummary && (
        <div className="section">
          <h2 className="command-section-heading"><FileText size={16} /> Summary</h2>
          <div className="summary-box">{session.finalSummary}</div>
        </div>
      )}

      {session.failureReason && (
        <div className="section">
          <h2 className="command-section-heading"><Bug size={16} /> Failure Reason</h2>
          <div className="summary-box error">{session.failureReason}</div>
        </div>
      )}

      {EVIDENCE_GROUPS.map(group => {
        const items = evidence.filter(e => e.type === group.type);
        if (items.length === 0) return null;
        const Icon = EVIDENCE_ICONS[group.type] || FileText;

        return (
          <div key={group.type} className="section">
            <h2 className="command-section-heading">
              <Icon size={16} /> {group.label} ({items.length})
            </h2>
            {group.type === 'screenshot' ? (
              <div className="screenshot-grid stagger-children">
                {items.map(s => {
                  const imgSrc = evidenceImageSrc(s.filePath);
                  return (
                    <div key={s.id} className="screenshot-item clickable"
                      onClick={() => setSelectedScreenshot(s)} role="button" tabIndex={0}
                      aria-label={`Open ${s.summary}`}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedScreenshot(s); } }}
                    >
                      <img src={imgSrc} alt={s.summary} className="screenshot-img"
                        onError={(e) => {
                          console.error('Failed to load screenshot:', { filePath: s.filePath, attemptedUrl: imgSrc });
                          const container = (e.target as HTMLImageElement).parentElement;
                          if (container) {
                            (e.target as HTMLImageElement).style.display = 'none';
                            container.classList.add('screenshot-load-error');
                          }
                        }}
                      />
                      <span className="screenshot-label">{s.summary}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="evidence-list stagger-children">
                {items.map(item => (
                  <div key={item.id} className="evidence-item">
                    <div className="evidence-header">
                      <span className="evidence-type">{item.type}</span>
                      <span className="evidence-time">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="evidence-summary">{item.summary}</div>
                    <code className="evidence-path">{item.filePath}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {isActive && (
        <div className="section">
          <p className="running-hint command-running-hint">
            <Clock size={16} className="status-pulse" />
            Test is running... evidence will appear here as it is captured.
          </p>
        </div>
      )}

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div className="screenshot-modal-overlay" onClick={() => setSelectedScreenshot(null)}>
          <div className="screenshot-modal" onClick={e => e.stopPropagation()}>
            <div className="screenshot-modal-header">
              <span className="screenshot-modal-title">{selectedScreenshot.summary}</span>
              <button className="screenshot-modal-close" onClick={() => setSelectedScreenshot(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="screenshot-modal-body">
              <img src={evidenceImageSrc(selectedScreenshot.filePath)} alt={selectedScreenshot.summary} className="screenshot-modal-img"
                onError={(e) => {
                  console.error('Failed to load modal screenshot:', selectedScreenshot.filePath);
                  const container = (e.target as HTMLImageElement).parentElement;
                  if (container) {
                    (e.target as HTMLImageElement).style.display = 'none';
                    container.classList.add('screenshot-load-error');
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
