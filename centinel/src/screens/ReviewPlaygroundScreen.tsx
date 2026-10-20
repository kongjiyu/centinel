import { useEffect, useState } from 'react';
import { FileCheck2, FlaskConical, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { Select } from '../components/Select';
import { harnessStepState, stepLabel, type ReviewHarnessTrace } from '../reviewHarness';
import type { Project, Screen, StaticSession } from '../types';
import './ReviewPlaygroundScreen.css';

type Props = { projects: Project[]; initialProjectId?: string; initialSessionId?: string; onNavigate: (screen: Screen) => void };

export function ReviewPlaygroundScreen({ projects, initialProjectId, initialSessionId, onNavigate }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [sessionId, setSessionId] = useState(initialSessionId ?? '');
  const [reviews, setReviews] = useState<StaticSession[]>([]);
  const [trace, setTrace] = useState<ReviewHarnessTrace | null>(null);
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id);
  }, [projectId, projects]);

  useEffect(() => {
    let disposed = false;
    setReviews([]);
    setTrace(null);
    setError(null);
    if (!projectId) return;
    setLoading(true);
    api.listStaticSessions(projectId).then(value => {
      if (disposed) return;
      setReviews(value);
      setSessionId(current => value.some(item => item.id === current) ? current : value.find(item => ['queued', 'running'].includes(item.status))?.id ?? value[0]?.id ?? '');
    }).catch(() => { if (!disposed) setError('Reviews could not be loaded. Refresh to try again.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [projectId, refresh]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setTrace(null);
    setStageId('');
    if (!projectId || !sessionId) return;
    const load = async () => {
      try {
        const value = await api.getReviewHarness(projectId, sessionId);
        if (disposed) return;
        setTrace(value);
        setError(null);
        setStageId(current => current || value.review.progress?.stage || value.workflow.stages[0]?.id || '');
        if (['queued', 'running'].includes(value.review.status)) timer = setTimeout(() => void load(), 1500);
      } catch {
        if (!disposed) setError('The execution trace could not be loaded. Confirm the updated sidecar is running, then refresh.');
      }
    };
    void load();
    return () => { disposed = true; clearTimeout(timer); };
  }, [projectId, sessionId, refresh]);

  const active = trace && ['queued', 'running'].includes(trace.review.status);
  const selectedStage = trace?.workflow.stages.find(stage => stage.id === stageId) ?? trace?.workflow.stages[0];
  const attempts = trace?.events.filter(event => event.event === 'model_attempt') ?? [];

  return <div className="screen review-playground">
    <CommandPageHeader eyebrow="Review" title="Playground" description="Observe the sources, checks, model attempts, and evidence recorded by each review step." actions={<button type="button" className="btn-primary" disabled={!projectId} onClick={() => onNavigate({ name: 'review-entry', projectId, returnToPlayground: true })}>Start review</button>} />
    <div className="playground-toolbar">
      <label>Project<Select aria-label="Playground project" value={projectId} options={projects.map(project => ({ value: project.id, label: project.name }))} onChange={value => { setSessionId(''); setProjectId(value); }} placeholder="Choose a project" /></label>
      <label>Review<Select aria-label="Playground review" value={sessionId} options={reviews.map(review => ({ value: review.id, label: review.name }))} onChange={setSessionId} disabled={!reviews.length || loading} placeholder={loading ? 'Loading reviews…' : 'Choose a review'} /></label>
      <button type="button" className="btn-secondary" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
    </div>
    {error && <p className="command-inline-alert" role="alert">{error}</p>}
    {!projectId ? <CommandEmptyState icon={FlaskConical} title="Choose a project" description="Create a project and add sources to inspect a review execution." />
      : !sessionId && !loading ? error ? <p role="status">Review selection is unavailable.</p> : <CommandEmptyState icon={FileCheck2} title="No reviews yet" description="Start a review to observe its actual execution. This playground runs the same workflow as Review." />
      : !trace ? <p role="status">{error ? 'Execution details are unavailable.' : 'Loading execution details…'}</p>
      : <>
        <section className="playground-run" aria-label="Observed review">
          <div><h2>{trace.review.name}</h2><p>{active ? 'Observing live execution · refreshes automatically' : 'Saved execution history'} · {trace.workflow.version}</p></div>
          <StatusBadge label={trace.review.status === 'pending_approval' ? 'Need Approval' : trace.review.status} />
          <button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'review-activity', projectId, sessionId })}>Open review</button>
        </section>
        {!trace.events.some(event => event.event.startsWith('harness_step_')) && <p className="playground-notice" role="status">This review has no step trace. Reviews started with the updated runner record step-level activity; older runs retain their existing evidence.</p>}
        <div className="playground-layout">
          <nav className="playground-stages" aria-label="Verification stages">
            {trace.workflow.stages.map((stage, index) => <button key={stage.id} type="button" aria-current={stage.id === selectedStage?.id ? 'step' : undefined} onClick={() => setStageId(stage.id)}><span className="playground-stage-index">{index + 1}</span><span><strong>{stage.label}</strong><small>{trace.review.progress?.completedStages.includes(stage.id) ? 'Completed' : trace.review.progress?.stage === stage.id && active ? 'In progress' : 'Inspect steps'}</small></span></button>)}
          </nav>
          <section className="playground-detail" aria-label="Stage details">
            <h2>{selectedStage?.label}</h2>
            <ol className="playground-steps">{selectedStage?.steps.map(step => {
              const events = trace.events.filter(event => event.detail?.step === step);
              const state = harnessStepState(events, step, !active);
              return <li key={step}><details><summary><span>{stepLabel(step)}</span><StatusBadge label={state} /></summary>
                {!events.length ? <p>No execution was recorded for this step. It may be optional, not reached, or from an older run.</p> : events.map((event, index) => <div key={event.id ?? index} className="playground-event"><div><strong>{stepLabel(event.event.replace('harness_step_', ''))}</strong><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString()}</time>{typeof event.detail?.durationMs === 'number' && <span>{event.detail.durationMs} ms</span>}</div><pre>{JSON.stringify(event.detail, null, 2)}</pre></div>)}
              </details></li>;
            })}</ol>
            {selectedStage?.id === 'model_analysis' && <details className="playground-attempts"><summary>Model attempts ({attempts.length})</summary>{attempts.length ? attempts.map((event, index) => <pre key={event.id ?? index}>{JSON.stringify(event.detail, null, 2)}</pre>) : <p>No model attempts recorded.</p>}</details>}
          </section>
        </div>
        <p className="playground-footnote">The workflow uses deterministic gates around model review, informed by <a href="https://github.com/alibaba/open-code-review" target="_blank" rel="noreferrer">Open Code Review</a>. Activity shows execution metadata; source content, credentials, and private model reasoning are excluded.</p>
      </>}
  </div>;
}
