import { useState, useEffect, useCallback } from 'react';
import { Image, Activity, FileText, Terminal, Bug, Search, X, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader, StatusBadge } from '../components/CommandUI';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';

type Props = { projectId: string; onNavigate: (screen: Screen) => void };

type EvidenceFilter = 'all' | 'screenshot' | 'action_trace' | 'ai_request' | 'ai_response' | 'console_log' | 'debug_log' | 'session_summary';

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

const FILTER_OPTIONS: { value: EvidenceFilter; label: string; icon: typeof Image }[] = [
  { value: 'all', label: 'All', icon: Search },
  { value: 'screenshot', label: 'Screenshots', icon: Image },
  { value: 'action_trace', label: 'Action Trace', icon: Activity },
  { value: 'ai_request', label: 'AI Requests', icon: FileText },
  { value: 'ai_response', label: 'AI Responses', icon: FileText },
  { value: 'console_log', label: 'Console', icon: Terminal },
  { value: 'debug_log', label: 'Debug', icon: Bug },
  { value: 'session_summary', label: 'Summary', icon: FileText },
];

export function EvidenceBrowser({ projectId, onNavigate }: Props) {
  const [sessions, setSessions] = useState<DynamicSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<DynamicEvidence[]>([]);
  const [filter, setFilter] = useState<EvidenceFilter>('all');
  const [loading, setLoading] = useState(true);
  const [selectedScreenshot, setSelectedScreenshot] = useState<DynamicEvidence | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const s = await api.listDynamicSessions(projectId);
      setSessions(s);
      if (s.length > 0 && !selectedSessionId) setSelectedSessionId(s[0].id);
    } catch (err) { console.error('Failed to load sessions:', err); }
    finally { setLoading(false); }
  }, [projectId, selectedSessionId]);

  const loadEvidence = useCallback(async () => {
    if (!selectedSessionId) return;
    try { setEvidence(await api.listDynamicEvidence(projectId, selectedSessionId)); }
    catch (err) { console.error('Failed to load evidence:', err); }
  }, [projectId, selectedSessionId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { loadEvidence(); }, [loadEvidence]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedScreenshot) setSelectedScreenshot(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedScreenshot]);

  if (loading) return <div className="screen command-loading"><Activity size={20} /> Loading evidence...</div>;

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const filteredEvidence = filter === 'all' ? evidence : evidence.filter(e => e.type === filter);

  return (
    <div className="screen command-evidence-browser animate-fade-in">
      <CommandPageHeader
        eyebrow="Evidence Inspector"
        title="Evidence Browser"
        description="Inspect screenshots, model exchanges, action traces, and runtime logs captured by dynamic sessions."
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<><span>{sessions.length} sessions</span><span>{evidence.length} evidence items</span></>}
      />

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
                <div
                  key={session.id}
                  className={`session-item ${session.id === selectedSessionId ? 'selected' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="session-item-header">
                    <span className="session-name">{session.name}</span>
                    <StatusBadge label={session.status} />
                  </div>
                  <div className="session-item-meta">
                    <span>{session.targetUrl}</span>
                    <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
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
                {FILTER_OPTIONS.map(option => {
                  const Icon = option.icon;
                  const count = option.value === 'all' ? evidence.length : evidence.filter(e => e.type === option.value).length;
                  return (
                    <button key={option.value}
                      className={`filter-btn ${filter === option.value ? 'active' : ''}`}
                      onClick={() => setFilter(option.value)}
                    >
                      <Icon size={12} /> {option.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Evidence Grid */}
              <div className="evidence-grid stagger-children">
                {filteredEvidence.length === 0 ? (
                  <p className="command-filter-empty">
                    <AlertCircle size={20} />
                    <br />No evidence found for this filter
                  </p>
                ) : (
                  filteredEvidence.map(item => {
                    const Icon = EVIDENCE_ICONS[item.type] || FileText;
                    return (
                      <div key={item.id} className="evidence-card">
                        {item.type === 'screenshot' ? (
                          <div className="evidence-screenshot clickable"
                            onClick={() => setSelectedScreenshot(item)}>
                            <img src={evidenceImageSrc(item.filePath)} alt={item.summary}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          </div>
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
            <CommandEmptyState icon={Search} title="Select a session" description="Choose a dynamic session from the left to inspect its captured evidence." />
          )}
        </div>
      </div>

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
              <img src={evidenceImageSrc(selectedScreenshot.filePath)} alt={selectedScreenshot.summary} className="screenshot-modal-img" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
