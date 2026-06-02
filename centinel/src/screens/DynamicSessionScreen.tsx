import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';

type Props = {
  projectId: string;
  sessionId: string;
  onNavigate: (screen: Screen) => void;
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function DynamicSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<DynamicSession | null>(null);
  const [evidence, setEvidence] = useState<DynamicEvidence[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        api.getDynamicSession(projectId, sessionId),
        api.listDynamicEvidence(projectId, sessionId),
      ]);
      setSession(s);
      setEvidence(e);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while running
  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'queued')) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  const handleCancel = async () => {
    try {
      await api.cancelDynamicSession(projectId, sessionId);
      await load();
    } catch {
      // ignore
    }
  };

  if (loading) return <div className="screen"><p>Loading...</p></div>;
  if (!session) return <div className="screen"><p>Session not found.</p></div>;

  const screenshots = evidence.filter(e => e.type === 'screenshot');
  const isActive = session.status === 'running' || session.status === 'queued';

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn-back" onClick={() => onNavigate({ name: 'project-detail', projectId })}>
          Back
        </button>
        <h1>Dynamic Test</h1>
        <StatusBadge status={session.status} />
        {isActive && (
          <button className="btn-delete" onClick={handleCancel}>Cancel</button>
        )}
      </div>

      <div className="session-info">
        <div className="info-row">
          <span className="info-label">Goal</span>
          <span>{session.goal}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Target</span>
          <code>{session.targetUrl}</code>
        </div>
        <div className="info-row">
          <span className="info-label">Mission</span>
          <span>{session.missionType === 'smoke' ? 'Smoke Test' : 'User Journey'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Max Steps</span>
          <span>{session.maxSteps}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Started</span>
          <span>{new Date(session.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {session.finalSummary && (
        <div className="section">
          <h2>Summary</h2>
          <div className="summary-box">{session.finalSummary}</div>
        </div>
      )}

      {session.failureReason && (
        <div className="section">
          <h2>Failure Reason</h2>
          <div className="summary-box error">{session.failureReason}</div>
        </div>
      )}

      {screenshots.length > 0 && (
        <div className="section">
          <h2>Screenshots</h2>
          <div className="screenshot-grid">
            {screenshots.map(s => (
              <div key={s.id} className="screenshot-item">
                <img src={`asset://localhost/${s.filePath}`} alt={s.summary} className="screenshot-img" />
                <span className="screenshot-label">{s.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isActive && (
        <div className="section">
          <p className="running-hint">Test is running... screenshots will appear here as they are captured.</p>
        </div>
      )}
    </div>
  );
}
