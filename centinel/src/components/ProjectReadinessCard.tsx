import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, CircleDashed, CircleX, LoaderCircle, ShieldAlert, TriangleAlert } from 'lucide-react';
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

function categoryGaps(category: ReadinessCategoryResult | undefined, findings: NonNullable<ProjectReadinessStatus['snapshot']>['findings']) {
  if (!category || category.state === 'completed') return [];
  const criteria = (category.criteria ?? []).filter(criterion => criterion.status !== 'pass');
  if (criteria.length) {
    const seen = new Set<string>();
    return criteria.flatMap(criterion => {
      if (seen.has(criterion.basis)) return [];
      seen.add(criterion.basis);
      return [{
        id: criterion.id,
        title: CRITERION_LABELS[category.id]?.[criterion.id] ?? criterion.id.replace(/_/g, ' '),
        description: criterion.basis,
        unverified: criterion.status === 'unknown',
      }];
    });
  }
  const saved = findings.filter(gap => gap.category === category.id);
  return saved.length ? saved.map(gap => ({ ...gap, unverified: false })) : [{
    id: category.id,
    title: category.state === 'missing' ? 'Missing evidence' : 'Gap details unavailable',
    description: category.state === 'missing' ? 'No assessable evidence was recorded for this category.' : 'This assessment did not save details for the incomplete checks.',
    unverified: false,
  }];
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

export function ProjectReadinessCard({ projectId, onStatusChange }: Props) {
  const [status, setStatus] = useState<ProjectReadinessStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<ReadinessCategoryResult['id'] | null>(null);
  const [pinnedCategory, setPinnedCategory] = useState<ReadinessCategoryResult['id'] | null>(null);
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
    setHoveredCategory(null);
    setPinnedCategory(null);
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
  const previewCategory = hoveredCategory ?? pinnedCategory;
  useEffect(() => {
    if (!previewCategory) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHoveredCategory(null);
        setPinnedCategory(null);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [previewCategory]);
  const statusError = status?.status === 'failed' || status?.status === 'paused'
    ? userFacingError(status.error, 'The readiness assessment could not finish. Check the project sources and AI connection, then retry.')
    : null;
  const errorMessage = requestError && !/^AI assessment is paused/i.test(requestError) ? requestError
    : status?.errorCode === 'assessment_paused' || /^AI assessment is paused/i.test(status?.error ?? '') ? null : statusError;
  const isStaleSnapshot = Boolean(status?.stale && snapshot);
  const jobState = status?.assessmentHeld ? 'The local service is restricting AI assessments. Select Retry to check again.' : !status
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
              ? null
              : snapshot
                ? 'Assessment is current.'
                : 'No assessment is saved yet.';

  return (
    <section className="card detail-card project-readiness-compact-card" aria-labelledby="project-readiness-heading" aria-busy={busy}>
      <header className="project-readiness-card-header">
        <h2 id="project-readiness-heading"><ShieldAlert size={19} aria-hidden="true" /> Readiness</h2>
        <div className="project-readiness-card-actions">
          {isStaleSnapshot && <span className="project-readiness-source-notice" tabIndex={0} aria-describedby="project-readiness-source-tooltip">
            <TriangleAlert size={19} aria-hidden="true" />
            <span id="project-readiness-source-tooltip" role="tooltip">Sources have changed. Run Readiness again.</span>
          </span>}
          {busy && <LoaderCircle className="project-readiness-spinner" size={17} aria-hidden="true" />}
          <span>
            <button type="button" className="btn-primary project-readiness-start" disabled={busy} onClick={() => void startAssessment()}>
              {status?.assessmentHeld ? 'Retry' : status?.status === 'paused' ? 'Resume' : errorMessage ? 'Retry' : 'Start'}
            </button>
          </span>
        </div>
      </header>
      {jobState && <p className="project-readiness-job-state" role="status" aria-live="polite" aria-atomic="true">{jobState}</p>}
      <ul className="project-readiness-categories" aria-label="Project readiness categories">
        {CATEGORY_ORDER.map(id => {
          const category = categoryById.get(id);
          const gaps = categoryGaps(category, snapshot?.findings ?? []);
          const expanded = gaps.length > 0 && previewCategory === id;
          const regionId = `project-readiness-gaps-${id}`;
          return (
            <li key={id} className={expanded ? 'is-expanded' : undefined}
              onMouseEnter={() => { if (gaps.length) setHoveredCategory(id); }}
              onMouseLeave={() => setHoveredCategory(null)}>
              <div className="project-readiness-category-row">
                <span className="project-readiness-category-name">
                  {gaps.length > 0 && (
                    <button
                      type="button"
                      className="project-readiness-criteria-toggle"
                      aria-expanded={expanded}
                      aria-controls={expanded ? regionId : undefined}
                      aria-label={`${pinnedCategory === id ? 'Hide' : 'Show'} gaps for ${CATEGORY_LABELS[id]}`}
                      onClick={() => {
                        setHoveredCategory(null);
                        setPinnedCategory(pinnedCategory === id ? null : id);
                      }}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                  )}
                  <strong>{CATEGORY_LABELS[id]}</strong>
                </span>
                <CategoryState state={category?.state ?? null} />
              </div>
              {expanded && <section id={regionId} className="project-readiness-gap-preview" aria-label={`${CATEGORY_LABELS[id]} gaps`}>
                <h3>{CATEGORY_LABELS[id]} gaps</h3>
                <ul>{gaps.map(gap => <li key={gap.id}>
                  <strong>{gap.title}{gap.unverified && <span> · Not verified</span>}</strong>
                  <p>{gap.description}</p>
                </li>)}</ul>
              </section>}
            </li>
          );
        })}
      </ul>
      {errorMessage && <p className="project-readiness-error" role="alert">{snapshot ? 'Showing the previous assessment. ' : ''}{errorMessage}</p>}
    </section>
  );
}
