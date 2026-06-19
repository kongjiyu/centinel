import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api/client';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';

type Props = {
  projectId: string;
  onNavigate: (screen: Screen) => void;
};

type EvidenceFilter = 'all' | 'screenshot' | 'action_trace' | 'ai_request' | 'ai_response' | 'console_log' | 'debug_log' | 'session_summary';

function evidenceImageSrc(filePath: string): string {
  return `http://localhost:37701/evidence-file?path=${encodeURIComponent(filePath)}`;
}

const FILTER_OPTIONS: { value: EvidenceFilter; label: string }[] = [
  { value: 'all', label: 'All Evidence' },
  { value: 'screenshot', label: '📸 Screenshots' },
  { value: 'action_trace', label: '📋 Action Trace' },
  { value: 'ai_request', label: '🤖 AI Requests' },
  { value: 'ai_response', label: '💬 AI Responses' },
  { value: 'console_log', label: '🖥️ Console Logs' },
  { value: 'debug_log', label: '🔍 Debug Logs' },
  { value: 'session_summary', label: '📄 Session Summary' },
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
      if (s.length > 0 && !selectedSessionId) {
        setSelectedSessionId(s[0].id);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedSessionId]);

  const loadEvidence = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      const e = await api.listDynamicEvidence(projectId, selectedSessionId);
      setEvidence(e);
    } catch (err) {
      console.error('Failed to load evidence:', err);
    }
  }, [projectId, selectedSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);

  // Handle Esc key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedScreenshot) {
        setSelectedScreenshot(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedScreenshot]);

  if (loading) return <div className="screen"><p>Loading...</p></div>;

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const filteredEvidence = filter === 'all' ? evidence : evidence.filter(e => e.type === filter);

  // Group evidence by session
  const groupedBySession = sessions.reduce((acc, session) => {
    acc[session.id] = { session, evidenceCount: 0 };
    return acc;
  }, {} as Record<string, { session: DynamicSession; evidenceCount: number }>);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'project-detail', projectId })}>
          Back
        </button>
        <h1>Evidence Browser</h1>
      </div>

      <div className="evidence-browser-layout">
        {/* Session List Sidebar */}
        <div className="evidence-sidebar">
          <h3>Sessions</h3>
          <div className="session-list">
            {sessions.length === 0 ? (
              <p className="empty-state">No sessions found</p>
            ) : (
              sessions.map(session => (
                <div
                  key={session.id}
                  className={`session-item ${session.id === selectedSessionId ? 'selected' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="session-item-header">
                    <span className="session-name">{session.name}</span>
                    <span className={`badge badge-${session.status}`}>{session.status}</span>
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
              {/* Session Info */}
              <div className="evidence-session-info">
                <h2>{selectedSession.name}</h2>
                <div className="session-meta">
                  <span><strong>Target:</strong> {selectedSession.targetUrl}</span>
                  <span><strong>Status:</strong> <span className={`badge badge-${selectedSession.status}`}>{selectedSession.status}</span></span>
                </div>
                {selectedSession.finalSummary && (
                  <div className="session-summary">{selectedSession.finalSummary}</div>
                )}
              </div>

              {/* Filter Bar */}
              <div className="evidence-filter">
                {FILTER_OPTIONS.map(option => {
                  const count = option.value === 'all'
                    ? evidence.length
                    : evidence.filter(e => e.type === option.value).length;
                  return (
                    <button
                      key={option.value}
                      className={`filter-btn ${filter === option.value ? 'active' : ''}`}
                      onClick={() => setFilter(option.value)}
                    >
                      {option.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Evidence Grid */}
              <div className="evidence-grid">
                {filteredEvidence.length === 0 ? (
                  <p className="empty-state">No evidence found for this filter</p>
                ) : (
                  filteredEvidence.map(item => (
                    <div key={item.id} className="evidence-card">
                      {item.type === 'screenshot' ? (
                        <div
                          className="evidence-screenshot clickable"
                          onClick={() => setSelectedScreenshot(item)}
                        >
                          <img
                            src={evidenceImageSrc(item.filePath)}
                            alt={item.summary}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ) : (
                        <div className="evidence-icon">
                          {item.type === 'action_trace' && '📋'}
                          {item.type === 'ai_request' && '🤖'}
                          {item.type === 'ai_response' && '💬'}
                          {item.type === 'console_log' && '🖥️'}
                          {item.type === 'debug_log' && '🔍'}
                          {item.type === 'session_summary' && '📄'}
                        </div>
                      )}
                      <div className="evidence-info">
                        <span className="evidence-type">{item.type}</span>
                        <span className="evidence-summary">{item.summary}</span>
                        <span className="evidence-time">{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">Select a session to view evidence</div>
          )}
        </div>
      </div>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div
          className="screenshot-modal-overlay"
          onClick={() => setSelectedScreenshot(null)}
        >
          <div className="screenshot-modal" onClick={e => e.stopPropagation()}>
            <div className="screenshot-modal-header">
              <span className="screenshot-modal-title">{selectedScreenshot.summary}</span>
              <button
                className="screenshot-modal-close"
                onClick={() => setSelectedScreenshot(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="screenshot-modal-body">
              <img
                src={evidenceImageSrc(selectedScreenshot.filePath)}
                alt={selectedScreenshot.summary}
                className="screenshot-modal-img"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
