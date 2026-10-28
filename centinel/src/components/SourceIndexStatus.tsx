import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { SourceIndexStatus as Status } from '../types';
import './SourceIndexStatus.css';

const labels: Record<Status['state'], string> = {
  none: 'Search has not been prepared.', queued: 'Search preparation is queued.', running: 'Preparing source search…',
  ready: 'Source search is ready.', paused: 'Source search preparation is paused.', failed: 'Source search needs attention.', superseded: 'Source search needs updating.',
};
export function SourceIndexStatus({ projectId, sourceVersionKey }: { projectId: string; sourceVersionKey: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    if (typeof api.getSourceIndexStatus !== 'function') return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    epoch.current++;
    setStatus(null); setError(false); setStarting(false);
    const poll = async () => {
      try {
        const next = await api.getSourceIndexStatus(projectId, controller.signal);
        if (!controller.signal.aborted) { setStatus(next); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 15_000);
    };
    void poll();
    return () => { epoch.current++; controller.abort(); clearTimeout(timer); };
  }, [projectId, sourceVersionKey, refresh]);
  const resume = async () => {
    const requestEpoch = epoch.current;
    setStarting(true); setError(false);
    try { await api.resumeSourceIndex(projectId); if (epoch.current === requestEpoch) setRefresh(value => value + 1); }
    catch { if (epoch.current === requestEpoch) setError(true); }
    finally { if (epoch.current === requestEpoch) setStarting(false); }
  };
  if (!status && !error) return null;
  const canStart = status && ['none', 'paused', 'failed', 'superseded'].includes(status.state);
  return <div className="source-index-status">
    <div role="status" aria-atomic="true">
      <span>{error ? 'Source search status is unavailable. Try again shortly.' : status ? labels[status.state] : ''}</span>
      {status?.state === 'paused' && !error && <span className="source-index-hint"> Check model settings or provider access before resuming. Automatic retries are stopped.</span>}
    </div>
    {canStart && <button type="button" className="btn-secondary" disabled={starting} onClick={() => void resume()}>{starting ? 'Starting…' : status?.state === 'paused' ? 'Resume indexing' : 'Prepare search'}</button>}
  </div>;
}
