import { useEffect, useMemo, useState } from 'react';
import { Image, LoaderCircle, X } from 'lucide-react';
import { api } from '../../api/client';
import type { RunStep, RunTimeline as Timeline } from '../../autotest/types';
import { Icon } from '../../components/Icon';
import { userFacingError } from '../../utils/userFacingError';
import { plainReason } from '../../check/plainReason';
import { PhotoViewer, type Photo } from './PhotoViewer';

/**
 * The steps a browser test took, read from its saved run (19 Nov 2026, user requests: show
 * which step a failed test failed at, open screenshots in place). The step that stopped the
 * test, or a check that failed after every step ran, sits in a soft card with the words
 * "Stopped here" / "Failed here". Typed text is shown only as a length.
 */
export function stepSentence(step: RunStep, stopped = false): string {
  const target = step.target ? ` ${step.target}` : '';
  // A stopped step was not carried out, so it reads as an attempt.
  if (stopped && step.result !== 'success') {
    switch (step.action) {
      case 'click': case 'click_visual': return `Tried to click${target || ' a control'}`;
      case 'type': case 'type_secret': return `Tried to type${step.target ? ` into ${step.target}` : ' into a field'}`;
      case 'select_option': return `Tried to choose an option${step.target ? ` in ${step.target}` : ''}`;
      case 'set_checked': return `Tried to tick${target || ' a box'}`;
      case 'press_key': return 'Tried to press a key';
      case 'navigate': return 'Tried to open a page';
      case 'upload_file': return 'Tried to upload a test file';
      case 'download_file': return 'Tried to download a file';
      default: break;
    }
  }
  switch (step.action) {
    case 'click': case 'click_visual': return `Clicked${target || ' a control'}`;
    case 'type': return `Typed ${step.typedLength ?? 'some'} character${step.typedLength === 1 ? '' : 's'}${step.target ? ` into ${step.target}` : ''}`;
    case 'type_secret': return `Filled a saved secret${step.target ? ` into ${step.target}` : ''}`;
    case 'select_option': return `Chose an option${step.target ? ` in ${step.target}` : ''}`;
    case 'set_checked': return `Ticked${target || ' a box'}`;
    case 'press_key': return 'Pressed a key';
    case 'scroll': return 'Scrolled the page';
    case 'wait': return 'Waited for the page';
    case 'navigate': return 'Opened a page';
    case 'assert_visible': return 'Looked for text on the page';
    case 'observe_visual': return 'Looked at the screen';
    case 'upload_file': return `Uploaded a test file${step.target ? ` to ${step.target}` : ''}`;
    case 'download_file': return `Downloaded a file${step.target ? ` from ${step.target}` : ''}`;
    case 'invalid': return 'The AI’s next step could not be read';
    case 'finish_success': return 'Finished the steps';
    case 'finish_failure': return 'Stopped: the goal could not be reached';
    case 'finish_blocked': return 'Stopped before finishing';
    default: return step.action.replace(/_/g, ' ');
  }
}

/** The page a step was on, in words: "/" is the first page. */
export function pageLabel(page: string): string {
  return page === '/' ? 'First page' : page;
}

/** Index of the step that stopped the test, or -1 when every step ran. */
export function stoppedAt(steps: RunStep[]): number {
  return steps.findIndex(step => step.result !== 'success');
}

/** Loads a run's timeline; shared by the timeline and the Screenshot button. */
export function useRunTimeline(projectId: string, runId: string) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setTimeline(null); setError(null);
    if (typeof api.dynamicRunSteps !== 'function') { setError('The steps of this test are not available on this device.'); return () => { active = false; }; }
    api.dynamicRunSteps(projectId, runId)
      .then(value => { if (active) setTimeline(value); })
      .catch(cause => { if (active) setError(userFacingError(cause, 'The steps of this test are not available on this device.')); });
    return () => { active = false; };
  }, [projectId, runId]);
  return { timeline, error };
}

/** Every screenshot of a run, in step order, ending with the page the check saw. */
export function runPhotos(projectId: string, runId: string, timeline: Timeline | null): Photo[] {
  if (!timeline) return [];
  const photos: Photo[] = timeline.steps.flatMap((step, index) => step.screenshot ? [{
    key: `step:${step.step}`, title: `Before step ${index + 1} · ${stepSentence(step)}`, detail: step.page ? `On ${step.page === '/' ? 'the first page' : step.page}` : null,
    load: () => api.dynamicRunStepScreenshot(projectId, runId, step.step),
  }] : []);
  if (timeline.finalScreenshot) photos.push({ key: 'final', title: 'The page when the test was checked', detail: null, load: () => api.dynamicRunStepScreenshot(projectId, runId, 'final') });
  return photos;
}

export function RunTimeline({ projectId, runId, checkFailed, checkSummary, shownReason }: {
  projectId: string; runId: string;
  /** A reason already shown above the steps; the stopped step does not repeat it. */
  shownReason?: string | null;
  /** The test's own check failed after its steps (a proven problem). */
  checkFailed?: boolean;
  /** What the check expected, for the final row. */
  checkSummary?: string | null;
}) {
  const { timeline, error } = useRunTimeline(projectId, runId);
  const photos = useMemo(() => runPhotos(projectId, runId, timeline), [projectId, runId, timeline]);
  const [viewing, setViewing] = useState<number | null>(null);

  if (error) return <p className="ck-col-note">{error}</p>;
  if (!timeline) return <p className="ck-col-note"><Icon icon={LoaderCircle} className="ci-spin" />Loading the steps…</p>;
  if (!timeline.steps.length) return <p className="ck-col-note">No steps were saved for this test.</p>;
  const steps = timeline.steps;
  const stop = stoppedAt(steps);
  const failedCheck = stop < 0 && (checkFailed || timeline.verdict === 'failed');
  const open = (key: string) => { const index = photos.findIndex(photo => photo.key === key); if (index >= 0) setViewing(index); };
  const plural = (count: number) => `${count} step${count === 1 ? '' : 's'}`;
  const summary = stop >= 0 ? `${plural(steps.length)} · stopped at step ${stop + 1}`
    : failedCheck ? `All ${plural(steps.length)} ran · the check failed` : plural(steps.length);

  return (
    <div className="ck-tl">
      <p className="ck-tl-summary">{summary}</p>
      <ol className="ck-tl-list" aria-label="Steps">
        {steps.map((step, index) => {
          const state = index === stop ? 'stopped' : stop >= 0 && index > stop ? 'skipped' : 'done';
          const showPage = !!step.page && step.page !== steps[index - 1]?.page;
          return (
            <li key={`${step.step}:${index}`} className={`ck-tl-step is-${state}`}>
              <span className="ck-tl-marker" aria-hidden="true">{state === 'stopped' ? <Icon icon={X} /> : index + 1}</span>
              <div className="ck-tl-body">
                <div className="ck-tl-line">
                  <span className="ck-tl-text">
                    <span className="ck-visually-hidden">Step {index + 1}: </span>
                    {stepSentence(step, state === 'stopped')}
                    {showPage && <span className="ck-tl-page">{pageLabel(step.page!)}</span>}
                  </span>
                  {state === 'stopped' && <span className="ck-tl-tag">Stopped here</span>}
                  {step.screenshot && <ShotButton label={`Screenshot before step ${index + 1}`} onClick={() => open(`step:${step.step}`)} />}
                </div>
                {state === 'stopped' && (() => { const why = plainReason(step.error ?? timeline.reason); return why && why !== shownReason ? <p className="ck-tl-reason">{why}</p> : null; })()}
              </div>
            </li>
          );
        })}
        {failedCheck && (
          <li className="ck-tl-step is-stopped">
            <span className="ck-tl-marker" aria-hidden="true"><Icon icon={X} /></span>
            <div className="ck-tl-body">
              <div className="ck-tl-line">
                <span className="ck-tl-text">Checked the page: not as expected</span>
                <span className="ck-tl-tag">Failed here</span>
                {timeline.finalScreenshot && <ShotButton label="Screenshot of the checked page" onClick={() => open('final')} />}
              </div>
              <p className="ck-tl-reason">{checkSummary ? `Expected: ${checkSummary}` : 'The test’s check failed. See Expected and The page showed.'}</p>
            </div>
          </li>
        )}
      </ol>
      {timeline.truncated && <p className="ck-tl-summary">Only the first 60 steps are shown.</p>}
      {viewing !== null && <PhotoViewer photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ShotButton({ label, onClick }: { label: string; onClick(): void }) {
  return <button type="button" className="ck-tl-shot" onClick={onClick} aria-label={label} title={label}><Icon icon={Image} /></button>;
}

/** A Screenshot button that opens the page the check saw, in place; the viewer can step back through the run. */
export function RunScreenshotButton({ projectId, runId, className = 'ck-button is-small' }: { projectId: string; runId: string; className?: string }) {
  const { timeline } = useRunTimeline(projectId, runId);
  const photos = useMemo(() => runPhotos(projectId, runId, timeline), [projectId, runId, timeline]);
  const [viewing, setViewing] = useState<number | null>(null);
  if (!photos.length) return null;
  return <>
    <button type="button" className={className} onClick={() => setViewing(photos.length - 1)}><Icon icon={Image} />Screenshot</button>
    {viewing !== null && <PhotoViewer photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
  </>;
}
