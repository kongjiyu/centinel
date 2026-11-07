import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, CircleX, LoaderCircle, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { setVisibleInterval } from '../hooks/usePageVisible';
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

type ReadinessCriterion = NonNullable<ReadinessCategoryResult['criteria']>[number];

const CRITERION_LABELS: Partial<Record<ReadinessCategoryResult['id'], Record<string, string>>> = {
  requirements: {
    clarity: 'Clarity', consistency: 'Consistency', testability: 'Testability', business_decisions: 'Business decision logic',
    boundaries: 'Boundaries and constraints', exceptions: 'Exceptions', scope: 'Scope',
  },
  design: {
    responsibilities: 'Responsibilities', interfaces: 'Interfaces', data: 'Data', flows: 'Flows',
    failure_decisions: 'Failure decisions', scope: 'Scope coverage',
  },
  standards: { applicability: 'Rule applicability', checkability: 'Checking methods', conflicts: 'Rule conflicts' },
};

const CRITERION_STATUS_LABELS: Record<ReadinessCriterion['status'], string> = { pass: 'Met', gap: 'Gap', unknown: 'Not verified' };
const MAX_CRITERION_SOURCES = 3;

/** Readiness cites confirmed records by internal ID; show people what they are instead. */
function sourceLabel(path: string): string {
  if (/^requirement\/[^/]+$/i.test(path)) return 'Confirmed requirement';
  if (/^coding_standard\/[^/]+$/i.test(path)) return 'Confirmed coding standard';
  return path;
}

function CriteriaList({ categoryId, label, criteria, id }: { categoryId: ReadinessCategoryResult['id']; label: string; criteria: ReadinessCriterion[]; id: string }) {
  return (
    <ul id={id} className="project-readiness-criteria" aria-label={`${label} criteria`}>
      {criteria.map(criterion => {
        const sources = criterion.references.slice(0, MAX_CRITERION_SOURCES);
        const hidden = criterion.references.length - sources.length;
        return (
          <li key={criterion.id}>
            <div className="project-readiness-criterion-head">
              <span className="project-readiness-criterion-name">{CRITERION_LABELS[categoryId]?.[criterion.id] ?? criterion.id.replace(/_/g, ' ')}</span>
              <span className={`project-readiness-criterion-status is-${criterion.status}`}>{CRITERION_STATUS_LABELS[criterion.status]}</span>
            </div>
            <p className="project-readiness-criterion-basis">{criterion.basis}</p>
            {sources.length > 0 && (
              <ul className="project-readiness-criterion-sources" aria-label="Cited sources">
                {sources.map((reference, index) => (
                  <li key={`${reference.artifactId}-${index}`}>
                    <span className="project-readiness-criterion-path">{sourceLabel(reference.path)}</span>
                    <q>{reference.excerpt}</q>
                  </li>
                ))}
                {hidden > 0 && <li className="project-readiness-criterion-more">{hidden} more cited {hidden === 1 ? 'source' : 'sources'}</li>}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

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

function assessmentDateLabel(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}

export function ProjectReadinessCard({ projectId, onStatusChange }: Props) {
  const [status, setStatus] = useState<ProjectReadinessStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<ReadinessCategoryResult['id']>>(() => new Set());
  const lifecycle = useRef(0);
  const requestSequence = useRef(0);
  const statusRequest = useRef<{ lifecycleId: number; requestId: number } | null>(null);

  const refreshStatus = useCallback(async () => {
    const lifecycleId = lifecycle.current;
    // A slow GET must be allowed to finish. Starting another poll every two
    // seconds would invalidate every response on a slower connection.
    if (statusRequest.current?.lifecycleId === lifecycleId) return;
    const requestId = ++requestSequence.current;
    const pending = { lifecycleId, requestId };
    statusRequest.current = pending;
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
      if (statusRequest.current === pending) statusRequest.current = null;
      if (lifecycle.current === lifecycleId && requestSequence.current === requestId) setLoadingStatus(false);
    }
  }, [projectId]);

  useEffect(() => {
    lifecycle.current += 1;
    setStatus(null);
    setRequestError(null);
    setExpandedCategories(new Set());
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
    // Skip polls while the window is hidden; the visibility listener above
    // refreshes as soon as it is shown again.
    return setVisibleInterval(() => void refreshStatus(), 2000);
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
  const categoryById = new Map(snapshot?.categories.map(category => [category.id, category]) ?? []);
  const toggleCategory = (id: ReadinessCategoryResult['id']) => setExpandedCategories(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const statusError = status?.status === 'failed' || status?.status === 'paused'
    ? userFacingError(status.error, 'The readiness assessment could not finish. Check the project sources and AI connection, then retry.')
    : null;
  const errorMessage = requestError ?? statusError;
  const isStaleSnapshot = Boolean(status?.stale && snapshot);
  const assessedAt = assessmentDateLabel(snapshot?.assessedAt);
  const jobState = !status
    ? loadingStatus ? 'Loading assessment status.' : 'Assessment status unavailable.'
    : status.status === 'queued'
      ? 'Assessment queued.'
      : status.status === 'running'
        ? 'Checking updated sources.'
        : status.status === 'paused'
          ? 'Assessment paused. Manual resume is required.'
          : status.status === 'failed'
            ? snapshot ? 'Assessment failed. The saved result is still available.' : 'Assessment failed. No saved result is available.'
            : status.stale && snapshot
              ? 'Awaiting manual assessment.'
              : snapshot
                ? 'Assessment is current.'
                : 'No assessment is saved yet.';

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
      {isStaleSnapshot && <p className="project-readiness-previous"><strong>Previous assessment — sources have changed</strong><span>{assessedAt ? `Assessed ${assessedAt}` : 'Assessment date unavailable.'}</span></p>}
      <p className="project-readiness-job-state" role="status" aria-live="polite" aria-atomic="true">{jobState}</p>
      <ul className="project-readiness-categories" aria-label="Project readiness categories">
        {CATEGORY_ORDER.map(id => {
          const category = categoryById.get(id);
          const criteria = category?.criteria ?? [];
          const expanded = criteria.length > 0 && expandedCategories.has(id);
          const regionId = `project-readiness-criteria-${id}`;
          return (
            <li key={id} className={expanded ? 'is-expanded' : undefined}>
              <div className="project-readiness-category-row">
                <strong>{CATEGORY_LABELS[id]}</strong>
                <span className="project-readiness-category-end">
                  <CategoryState state={category?.state ?? null} />
                  {criteria.length > 0 && (
                    <button
                      type="button"
                      className="project-readiness-criteria-toggle"
                      aria-expanded={expanded}
                      aria-controls={expanded ? regionId : undefined}
                      aria-label={`${expanded ? 'Hide' : 'Show'} criteria for ${CATEGORY_LABELS[id]}`}
                      title={`${expanded ? 'Hide' : 'Show'} criteria`}
                      onClick={() => toggleCategory(id)}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </div>
              {expanded && <CriteriaList id={regionId} categoryId={id} label={CATEGORY_LABELS[id]} criteria={criteria} />}
            </li>
          );
        })}
      </ul>
      {errorMessage && <p className="project-readiness-error" role="alert">{snapshot ? 'Showing the previous assessment. ' : ''}{errorMessage}</p>}
    </section>
  );
}
