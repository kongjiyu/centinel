import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, CircleX, LoaderCircle, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import type { ProjectReadinessStatus, ReadinessCategoryResult } from '../types';
import { userFacingError } from '../utils/userFacingError';
import './ProjectReadinessCard.css';

type Props = {
  projectId: string;
  onStatusChange?: (status: ProjectReadinessStatus | null) => void;
};

const CATEGORY_LABELS: Record<ReadinessCategoryResult['id'], string> = {
  repository: 'Repository',
  requirements: 'Requirement specification',
  design: 'Design documentation',
  standards: 'Coding standards',
};

const CATEGORY_ORDER: ReadinessCategoryResult['id'][] = ['repository', 'requirements', 'design', 'standards'];

function CategoryState({ state }: { state: ReadinessCategoryResult['state'] | null }) {
  if (!state) return <span className="project-readiness-value is-unavailable">—</span>;

  const label = state === 'completed' ? 'Completed' : state === 'incomplete' ? 'Incomplete' : 'Missing';
  const Icon = state === 'completed' ? CheckCircle2 : state === 'incomplete' ? CircleDashed : CircleX;
  return (
    <span className={`project-readiness-value is-${state}`}>
      <Icon size={16} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ProjectReadinessCard({ projectId, onStatusChange }: Props) {
  const [status, setStatus] = useState<ProjectReadinessStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const lifecycle = useRef(0);
  const requestSequence = useRef(0);

  const refreshStatus = useCallback(async () => {
    const lifecycleId = lifecycle.current;
    const requestId = ++requestSequence.current;
    setLoadingStatus(true);
    try {
      const nextStatus = await api.getProjectReadiness(projectId);
      if (lifecycle.current !== lifecycleId || requestSequence.current !== requestId) return;
      setStatus(current => nextStatus.snapshot || !current?.snapshot ? nextStatus : { ...nextStatus, snapshot: current.snapshot });
      setRequestError(null);
    } catch (cause) {
      if (lifecycle.current !== lifecycleId || requestSequence.current !== requestId) return;
      setRequestError(userFacingError(cause, 'Readiness could not be loaded. Check your connection and retry.'));
    } finally {
      if (lifecycle.current === lifecycleId && requestSequence.current === requestId) setLoadingStatus(false);
    }
  }, [projectId]);

  useEffect(() => {
    lifecycle.current += 1;
    setStatus(null);
    setRequestError(null);
    setStarting(false);
    setLoadingStatus(true);
    void refreshStatus();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      lifecycle.current += 1;
      requestSequence.current += 1;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [projectId, refreshStatus]);

  const active = status?.status === 'queued' || status?.status === 'running';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refreshStatus(), 2000);
    return () => window.clearInterval(timer);
  }, [active, refreshStatus]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  const startAssessment = async () => {
    if (active || starting) return;
    const lifecycleId = lifecycle.current;
    requestSequence.current += 1;
    setLoadingStatus(false);
    setStarting(true);
    setRequestError(null);
    try {
      const nextStatus = await api.startProjectReadiness(projectId);
      if (lifecycle.current !== lifecycleId) return;
      setStatus(current => nextStatus.snapshot || !current?.snapshot ? nextStatus : { ...nextStatus, snapshot: current.snapshot });
    } catch (cause) {
      if (lifecycle.current !== lifecycleId) return;
      setRequestError(userFacingError(cause, 'Readiness could not start. Check the project sources and AI connection, then retry.'));
    } finally {
      if (lifecycle.current === lifecycleId) setStarting(false);
    }
  };

  const busy = (loadingStatus && !status) || starting || active;
  const snapshot = status?.snapshot ?? null;
  const stateByCategory = new Map(snapshot?.categories.map(category => [category.id, category.state]) ?? []);
  const statusError = status?.status === 'failed' || status?.status === 'paused'
    ? userFacingError(status.error, 'The readiness assessment could not finish. Check the project sources and AI connection, then retry.')
    : null;
  const errorMessage = requestError ?? statusError;

  return (
    <section className="card detail-card project-readiness-compact-card" aria-labelledby="project-readiness-heading" aria-busy={busy}>
      <header className="project-readiness-card-header">
        <h2 id="project-readiness-heading"><ShieldAlert size={19} aria-hidden="true" /> Readiness</h2>
        <div className="project-readiness-card-actions">
          {busy && <LoaderCircle className="project-readiness-spinner" size={17} aria-hidden="true" />}
          <button type="button" className="btn-primary project-readiness-start" disabled={busy} onClick={() => void startAssessment()}>
            {status?.status === 'paused' ? 'Resume' : errorMessage ? 'Retry' : 'Start'}
          </button>
        </div>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {loadingStatus && !status ? 'Loading project readiness status.' : status?.status === 'queued' ? 'Project readiness assessment queued.' : status?.status === 'running' ? 'Project readiness assessment in progress.' : ''}
      </p>
      <ul className="project-readiness-categories" aria-label="Project readiness categories">
        {CATEGORY_ORDER.map(id => (
          <li key={id}>
            <strong>{CATEGORY_LABELS[id]}</strong>
            <CategoryState state={stateByCategory.get(id) ?? null} />
          </li>
        ))}
      </ul>
      {errorMessage && <p className="project-readiness-error" role="alert">{snapshot ? 'Showing the previous assessment. ' : ''}{errorMessage}</p>}
    </section>
  );
}
