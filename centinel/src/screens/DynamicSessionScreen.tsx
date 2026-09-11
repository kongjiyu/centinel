import { useState, useEffect, useCallback } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, X, Copy, Check, Image, FileText, Terminal, Bug, Activity, Clock, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader } from '../components/CommandUI';
import { EvidenceScreenshotThumbnail, EvidenceScreenshotViewer } from '../components/EvidenceScreenshot';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';
import { userFacingError } from '../utils/userFacingError';

type Props = { projectId: string; sessionId: string; onNavigate: (screen: Screen) => void };

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
  { type: 'action_trace', label: 'Action trace' },
  { type: 'ai_response', label: 'Model responses' },
  { type: 'ai_request', label: 'Model requests' },
  { type: 'console_log', label: 'Console logs' },
  { type: 'debug_log', label: 'Debug log' },
  { type: 'session_summary', label: 'Session summary' },
];

const TECHNICAL_EVIDENCE_TYPES = new Set<DynamicEvidence['type']>([
  'ai_request',
  'ai_response',
  'console_log',
  'debug_log',
  'session_summary',
]);

function EvidenceGroup({
  group,
  items,
  onOpenScreenshot,
}: {
  group: (typeof EVIDENCE_GROUPS)[number];
  items: DynamicEvidence[];
  onOpenScreenshot: (item: DynamicEvidence) => void;
}) {
  if (items.length === 0) return null;
  const Icon = EVIDENCE_ICONS[group.type] || FileText;

  return (
    <div className="section">
      <h2 className="command-section-heading">
        <Icon size={16} /> {group.label} ({items.length})
      </h2>
      {group.type === 'screenshot' ? (
        <div className="screenshot-grid stagger-children">
          {items.map(item => (
            <EvidenceScreenshotThumbnail
              key={item.id}
              item={item}
              className="screenshot-item clickable"
              showLabel
              onOpen={onOpenScreenshot}
            />
          ))}
        </div>
      ) : (
        <div className="evidence-list stagger-children">
          {items.map(item => (
            <div key={item.id} className="evidence-item">
              <div className="evidence-header">
                <span className="evidence-type">{group.label}</span>
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
}

export function DynamicSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<DynamicSession | null>(null);
  const [evidence, setEvidence] = useState<DynamicEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load dynamic session:', err);
      setLoadError('The test run could not be loaded. Your saved run and evidence have not been changed.');
    }
    finally { setLoading(false); }
  }, [projectId, sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'queued')) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  const handleCancel = async () => {
    try { await api.cancelDynamicSession(projectId, sessionId); await load(); } catch {}
  };

  const handleExport = async () => {
    setExporting(true); setExportResult(null);
    try {
      const result = await api.exportDynamicSessionReport(projectId, sessionId);
      setExportResult({ success: true, message: 'Report exported', reportPath: result.reportPath, markdown: result.markdown });
    } catch (e) { setExportResult({ success: false, message: `Export failed. ${userFacingError(e, 'Try again.')}` }); }
    finally { setExporting(false); }
  };

  const handleCopyPath = async (path: string) => {
    try { await writeText(path); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch (err) { console.error('Failed to copy path:', err); }
  };

  if (loading) return <div className="screen command-loading" role="status" aria-live="polite"><Activity size={20} /> Loading session...</div>;
  if (loadError && !session) return (
    <div className="screen">
      <CommandPageHeader eyebrow="Dynamic Testing" title="Test run" onBack={() => onNavigate({ name: 'project-detail', projectId })} />
      <CommandEmptyState
        icon={Bug}
        title="Test run unavailable"
        description={loadError}
        action={<button type="button" className="btn-primary" onClick={() => { setLoading(true); void load(); }}>Retry</button>}
      />
    </div>
  );
  if (!session) return <div className="screen"><CommandEmptyState icon={Bug} title="Session not found" description="This Dynamic Testing session is unavailable or has been removed." /></div>;

  const isActive = session.status === 'running' || session.status === 'queued';
  const screenshots = evidence.filter(item => item.type === 'screenshot');

  return (
    <div className="screen command-dynamic-session animate-fade-in">
      <CommandPageHeader
        eyebrow="Dynamic Testing"
        title={session.name || 'Test run'}
        description={session.goal}
        status={{ label: session.status }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<><span>{session.missionType === 'smoke' ? 'Smoke test' : 'User journey'}</span><span>{new Date(session.createdAt).toLocaleString()}</span></>}
        actions={(
          <>
          {!isActive && (
            <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Exporting…' : 'Export report'}
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
                <FileText size={14} /> Report preview
              </h3>
              <div className="report-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{exportResult.markdown}</ReactMarkdown>
              </div>
            </div>
          )}

          {exportResult.reportPath && (
            <div className="export-result-path">
              <span className="export-result-path-label">Saved to:</span>
              <code>{exportResult.reportPath}</code>
              <button className="btn-copy" onClick={() => handleCopyPath(exportResult.reportPath!)}>
                {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy path</>}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="session-info">
        <div className="info-row"><span className="info-label">Goal</span><span>{session.goal}</span></div>
        <div className="info-row"><span className="info-label">Target</span><code>{session.targetUrl}</code></div>
        <div className="info-row"><span className="info-label">Test type</span><span>{session.missionType === 'smoke' ? 'Smoke test' : 'User journey'}</span></div>
        <div className="info-row"><span className="info-label">Step limit</span><span>{session.maxSteps}</span></div>
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
          <h2 className="command-section-heading"><Bug size={16} /> Failure reason</h2>
          <div className="summary-box error">{userFacingError(session.failureReason, 'The test run could not finish. Check the target and try again.')}</div>
        </div>
      )}

      {EVIDENCE_GROUPS.filter(group => !TECHNICAL_EVIDENCE_TYPES.has(group.type)).map(group => (
        <EvidenceGroup
          key={group.type}
          group={group}
          items={evidence.filter(item => item.type === group.type)}
          onOpenScreenshot={setSelectedScreenshot}
        />
      ))}

      {evidence.some(item => TECHNICAL_EVIDENCE_TYPES.has(item.type)) && (
        <details className="advanced-options technical-evidence">
          <summary>Technical details</summary>
          <div className="advanced-options-content">
            {EVIDENCE_GROUPS.filter(group => TECHNICAL_EVIDENCE_TYPES.has(group.type)).map(group => (
              <EvidenceGroup
                key={group.type}
                group={group}
                items={evidence.filter(item => item.type === group.type)}
                onOpenScreenshot={setSelectedScreenshot}
              />
            ))}
          </div>
        </details>
      )}

      {isActive && (
        <div className="section">
          <p className="running-hint command-running-hint">
            <Clock size={16} className="status-pulse" />
            Test is running… evidence will appear here as it is captured.
          </p>
        </div>
      )}

      <EvidenceScreenshotViewer
        screenshots={screenshots}
        selectedId={selectedScreenshot?.id ?? null}
        onSelect={setSelectedScreenshot}
        onClose={() => setSelectedScreenshot(null)}
      />

      {loadError && (
        <div className="command-inline-notice danger" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{loadError}</span>
          <button type="button" className="btn-secondary" onClick={() => void load()}>Retry</button>
        </div>
      )}
    </div>
  );
}
