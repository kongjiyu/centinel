import { useState, useEffect, useCallback } from 'react';
import { Image, Activity, FileText, Terminal, Bug, Search, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { EvidenceScreenshotThumbnail, EvidenceScreenshotViewer } from '../components/EvidenceScreenshot';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';

type Props = { projectId: string; onNavigate: (screen: Screen) => void };

type EvidenceFilter = 'overview' | 'screenshot' | 'action_trace' | 'ai_request' | 'ai_response' | 'console_log' | 'debug_log' | 'session_summary';

const EVIDENCE_ICONS: Record<string, typeof Image> = {
  screenshot: Image,
  action_trace: Activity,
  ai_request: FileText,
  ai_response: FileText,
  console_log: Terminal,
  debug_log: Bug,
  session_summary: FileText,
};

const PRIMARY_FILTER_OPTIONS: { value: EvidenceFilter; label: string; icon: typeof Image }[] = [
  { value: 'overview', label: 'Overview', icon: Search },
  { value: 'screenshot', label: 'Screenshots', icon: Image },
  { value: 'action_trace', label: 'Action trace', icon: Activity },
];

const TECHNICAL_FILTER_OPTIONS: { value: EvidenceFilter; label: string; icon: typeof Image }[] = [
  { value: 'ai_request', label: 'Model requests', icon: FileText },
  { value: 'ai_response', label: 'Model responses', icon: FileText },
  { value: 'console_log', label: 'Console', icon: Terminal },
  { value: 'debug_log', label: 'Debug', icon: Bug },
  { value: 'session_summary', label: 'Summary', icon: FileText },
];

const OVERVIEW_TYPES = new Set<DynamicEvidence['type']>(['screenshot', 'action_trace', 'session_summary']);

export function EvidenceBrowser({ projectId, onNavigate }: Props) {
  const [sessions, setSessions] = useState<DynamicSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<DynamicEvidence[]>([]);
  const [filter, setFilter] = useState<EvidenceFilter>('overview');
  const [loading, setLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<DynamicEvidence | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const s = await api.listDynamicSessions(projectId);
      setSessions(s);
      if (s.length > 0 && !selectedSessionId) setSelectedSessionId(s[0].id);
      setSessionsError(null);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setSessionsError('Test runs could not be loaded. Your saved evidence has not been changed.');
    }
    finally { setLoading(false); }
  }, [projectId, selectedSessionId]);

  const loadEvidence = useCallback(async () => {
    if (!selectedSessionId) return;
    setEvidenceLoading(true);
    setEvidence([]);
    try {
      setEvidence(await api.listDynamicEvidence(projectId, selectedSessionId));
      setEvidenceError(null);
    }
    catch (err) {
      console.error('Failed to load evidence:', err);
      setEvidenceError('Evidence could not be loaded. The test run has not been changed.');
    }
    finally { setEvidenceLoading(false); }
  }, [projectId, selectedSessionId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { loadEvidence(); }, [loadEvidence]);

  if (loading) return <div className="screen command-loading" role="status" aria-live="polite"><Activity size={20} /> Loading evidence...</div>;

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const filteredEvidence = filter === 'overview'
    ? evidence.filter(item => OVERVIEW_TYPES.has(item.type))
    : evidence.filter(item => item.type === filter);
  const screenshots = evidence.filter(item => item.type === 'screenshot');

  return (
    <div className="screen command-evidence-browser animate-fade-in">
      <CommandPageHeader
        eyebrow="Dynamic Testing"
        title="Evidence"
        description="Review screenshots and action traces from browser test runs."
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<><span>{sessions.length} sessions</span><span>{evidence.length} evidence items</span></>}
      />

      {sessionsError && sessions.length === 0 ? (
        <CommandEmptyState
          icon={AlertCircle}
          title="Evidence unavailable"
          description={sessionsError}
          action={<button type="button" className="btn-primary" onClick={() => { setLoading(true); void loadSessions(); }}>Retry</button>}
        />
      ) : sessions.length === 0 ? (
        <CommandEmptyState
          icon={Activity}
          title="No test runs yet"
          description="Create a Dynamic Testing run to capture screenshots and an action trace."
          action={<button type="button" className="btn-primary" onClick={() => onNavigate({ name: 'project-detail', projectId, initialAction: 'dynamic' })}>New test</button>}
        />
      ) : (

      <div className="evidence-browser-layout">
        {/* Session List Sidebar */}
        <div className="evidence-sidebar">
          <h3 className="command-section-heading">
            <Search size={14} /> Sessions
          </h3>
          <div className="session-list">
            {sessions.length === 0 ? (
              <p className="command-compact-empty">No sessions found</p>
            ) : (
              sessions.map(session => (
                <button
                  type="button"
                  key={session.id}
                  className={`session-item ${session.id === selectedSessionId ? 'selected' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                  aria-pressed={session.id === selectedSessionId}
                >
                  <div className="session-item-header">
                    <span className="session-name">{session.name}</span>
                    <StatusBadge label={session.status} />
                  </div>
                  <div className="session-item-meta">
                    <span>{session.targetUrl}</span>
                    <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Evidence Content */}
        <div className="evidence-content">
          {selectedSession ? (
            <>
              <div className="evidence-session-info">
                <h2>{selectedSession.name}</h2>
                <div className="session-meta">
                  <span><strong>Target:</strong> {selectedSession.targetUrl}</span>
                  <span><strong>Status:</strong> <StatusBadge label={selectedSession.status} /></span>
                </div>
                {selectedSession.finalSummary && (
                  <div className="session-summary">{selectedSession.finalSummary}</div>
                )}
              </div>

              {/* Filter Bar */}
              <div className="evidence-filter">
                {PRIMARY_FILTER_OPTIONS.map(option => {
                  const Icon = option.icon;
                  const count = option.value === 'overview'
                    ? evidence.filter(item => OVERVIEW_TYPES.has(item.type)).length
                    : evidence.filter(item => item.type === option.value).length;
                  return (
                    <button key={option.value}
                      type="button"
                      className={`filter-btn ${filter === option.value ? 'active' : ''}`}
                      aria-pressed={filter === option.value}
                      onClick={() => setFilter(option.value)}
                    >
                      <Icon size={12} /> {option.label} ({count})
                    </button>
                  );
                })}
              </div>

              <details className="advanced-options evidence-technical-filters">
                <summary>Technical filters</summary>
                <div className="advanced-options-content evidence-filter">
                  {TECHNICAL_FILTER_OPTIONS.map(option => {
                    const Icon = option.icon;
                    const count = evidence.filter(item => item.type === option.value).length;
                    return (
                      <button key={option.value}
                        type="button"
                        className={`filter-btn ${filter === option.value ? 'active' : ''}`}
                        aria-pressed={filter === option.value}
                        onClick={() => setFilter(option.value)}
                      >
                        <Icon size={12} /> {option.label} ({count})
                      </button>
                    );
                  })}
                </div>
              </details>

              {/* Evidence Grid */}
              <div className="evidence-grid stagger-children" aria-busy={evidenceLoading}>
                {evidenceLoading ? (
                  <p className="command-filter-empty" role="status" aria-live="polite"><Activity size={20} /><br />Loading evidence…</p>
                ) : evidenceError ? (
                  <div className="command-filter-empty" role="alert">
                    <AlertCircle size={20} />
                    <p>{evidenceError}</p>
                    <button type="button" className="btn-secondary" onClick={() => void loadEvidence()}>Retry</button>
                  </div>
                ) : filteredEvidence.length === 0 ? (
                  <p className="command-filter-empty">
                    <AlertCircle size={20} />
                    <br />No evidence found for this filter.
                  </p>
                ) : (
                  filteredEvidence.map(item => {
                    const Icon = EVIDENCE_ICONS[item.type] || FileText;
                    return (
                      <div key={item.id} className="evidence-card">
                        {item.type === 'screenshot' ? (
                          <EvidenceScreenshotThumbnail
                            item={item}
                            className="evidence-screenshot clickable"
                            onOpen={setSelectedScreenshot}
                          />
                        ) : (
                          <div className="evidence-icon">
                            <Icon size={28} />
                          </div>
                        )}
                        <div className="evidence-info">
                          <span className="evidence-type">{item.type}</span>
                          <span className="evidence-summary">{item.summary}</span>
                          <span className="evidence-time">{new Date(item.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <CommandEmptyState icon={Search} title="Select a test run" description="Choose a test run to review its evidence." />
          )}
        </div>
      </div>
      )}

      <EvidenceScreenshotViewer
        screenshots={screenshots}
        selectedId={selectedScreenshot?.id ?? null}
        onSelect={setSelectedScreenshot}
        onClose={() => setSelectedScreenshot(null)}
      />
    </div>
  );
}
