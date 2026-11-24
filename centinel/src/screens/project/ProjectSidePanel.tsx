import { useEffect, useState } from 'react';
import { Check, Download, LayoutList, LoaderCircle, Lock, MonitorCheck, Play, RotateCcw, SquareChartGantt, TriangleAlert, X, Globe, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { AutoTestRef } from '../../autotest/types';
import { checkProblemSummary } from '../../check/result';
import { problemCountTone, ProblemCountIcon } from '../../components/ProblemCountIcon';
import { Icon } from '../../components/Icon';
import { CornersIn, CornersOut } from '../../components/cornerIcons';
import { MODE_LABEL, unpinTest, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import type { LatestResult } from '../../check/latestResult';
import type { CheckProblem } from '../../check/result';
import { ProjectOverviewMain, ProjectOverviewRail, ReviewState, problemLook, useReviewTrace } from './ProjectOverview';
import { RequirementsSection, SourcesSection } from './ProjectManage';
import { useChecks } from '../../check/store';
import { projectLocalFolder } from '../../check/projectWorkspace';
import type { CheckData } from '../../check/useCheckData';
import type { CheckRecord } from '../../check/types';
import type { Artifact, Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import './ProjectConversation.css';

type Navigate = (screen: Screen) => void;
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

/**
 * The project side panel (DESIGN.md §4.4). Collapsed: the latest check's problem count, numbers and problems.
 * Expanded over the conversation: risk counts, every problem with its evidence, requirements and sources
 * to manage, saved tests, how it is tested and checks. Everything is read from saved records.
 */
export function ProjectSidePanel({ project, latest, onOpen, open, onToggle, artifacts, onSourcesChanged, codeFiles, pinned, lastStateOf, mode, accountGiven, checks, onNavigate, onRunFullCheck, onRunAgain, checkId, checkLabel, onOpenCheck }: {
  project: Project; latest: LatestResult; onOpen(): void; open: boolean; onToggle(): void;
  artifacts: Artifact[]; onSourcesChanged(): void; codeFiles: number; pinned: ReturnType<typeof useProjectPrefs>['pinned'];
  lastStateOf(ref: AutoTestRef): string | undefined; mode: PermissionMode; accountGiven: boolean;
  checks: ReturnType<typeof useChecks>; onNavigate: Navigate; onRunFullCheck?(): void; onRunAgain?(problem: CheckProblem): void; checkId?: string; checkLabel?: string;
  /** Opens a saved check in this panel instead of on its own page. */
  onOpenCheck?(check: ReturnType<typeof useChecks>[number]): void;
}) {
  const [exporting, setExporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const documents = artifacts.filter(artifact => artifact.source === 'documents');
  const [message, setMessage] = useState<string | null>(null);
  const { result, review } = latest;
  const problems = result ? [...result.proven, ...result.foundInCode] : [];
  const problemSummary = result ? checkProblemSummary(result) : {};
  const running = !!result && !result.finished;
  const reviewDone = !!review && result?.codeState === 'done';
  const tally = result?.requirements ?? null;
  const hasFolder = !!projectLocalFolder(project);
  const download = async () => {
    if (!review) return;
    setExporting(true);
    setMessage(null);
    try {
      const report = await api.exportProjectReport(project.id, { reviewId: review.id });
      const target = report.downloads.pdf ?? report.downloads.markdown;
      if (!target) throw new Error('The report has no download link.');
      if (typeof window !== 'undefined' && '__TAURI_IPC__' in (window as object)) { const shell = await import('@tauri-apps/api/shell'); await shell.open(target); }
      else globalThis.open(target, '_blank', 'noopener');
      setMessage('The report opened in your browser.');
    } catch (cause) {
      setMessage(userFacingError(cause, 'The report could not be created. Try again.'));
    } finally {
      setExporting(false);
    }
  };
  // A review that stopped can be run again on the current sources; a finished one is checked again with Run a full check.
  const retryable = !!review && ['failure', 'failed', 'blocked', 'cancelled'].includes(review.status);
  const retry = async () => {
    if (!review) return;
    setRetrying(true);
    setMessage(null);
    try {
      await api.retryStaticSession(project.id, review.id, { refreshSourceManifest: true, idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `retry-${review.id}-${Date.now()}` });
      setMessage('The code review started again on the current sources.');
      latest.reload();
    } catch (cause) {
      setMessage(userFacingError(cause, 'The code review could not start again. Try again.'));
    } finally {
      setRetrying(false);
    }
  };

  const latestLabel = checkLabel ?? `Latest check${latest.at ? ` · ${new Date(latest.at).toLocaleDateString(undefined, DAY)}` : ''}`;
  const toggleLabel = open ? 'Back to the conversation' : 'Show the whole project';
  const trace = useReviewTrace(project.id, open && review ? review.id : null);

  const summary = latest.loading ? <p className="pc-empty"><Icon icon={LoaderCircle} className="ci-spin" /> Loading…</p>
    : !result ? <p className="pc-empty">No check has run yet. Use Run a full check.</p>
    : <>
      <p className={`pc-latest-verdict${!running && problems.length ? ` problem-count-tone is-${problemCountTone(problemSummary)}` : ''}`}>
        {running ? <Icon icon={LoaderCircle} className="ci-spin" /> : <ProblemCountIcon summary={problemSummary} />}
        <span>{running ? 'A check is running' : problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'No problems found'}{open && !running && result.proven.length > 0 ? `. ${result.proven.length} proven in the browser.` : ''}</span>
      </p>
      {!open && !running && result.proven.length > 0 && <p className="pc-latest-sub">{result.proven.length} proven in the browser</p>}
      {!running && (
        <div className="pc-latest-numbers">
          <div><small>Browser</small><b>{result.browserState === 'not_requested' || result.browserState === 'not_started' ? '–' : result.proven.length}</b></div>
          <div><small>Code</small><b>{result.codeState === 'not_requested' || result.codeState === 'not_started' ? '–' : result.foundInCode.length}</b></div>
          <div><small>Not met</small><b>{tally ? tally.notMet : '–'}</b>{tally ? <small className="pc-of"> /{tally.total}</small> : null}</div>
        </div>
      )}
    </>;

  return (
    <aside className={`pc-side${open ? ' is-open' : ''}`} aria-label="What ORIN knows">
      <div className="pc-side-top">
        <div className="pc-side-heading">
          <h2>{open ? project.name : latestLabel}</h2>
          {open && <ReviewState review={review} />}
          {open && <span className="pc-side-meta">{latestLabel}</span>}
        </div>
        <div className="pc-side-actions">
          {open && checkId && <button type="button" className="ck-button is-small" onClick={() => onNavigate({ name: 'check', checkId })}>
            <Icon icon={SquareChartGantt} />Open full Check
          </button>}
          {open && reviewDone && <button type="button" className="ck-button is-primary is-small" onClick={() => void download()} disabled={exporting}><Icon icon={Download} />{exporting ? 'Creating report…' : 'Download report'}</button>}
          {open && retryable && <button type="button" className="ck-button is-small" onClick={() => void retry()} disabled={retrying}><Icon icon={RotateCcw} />{retrying ? 'Starting…' : 'Retry the code review'}</button>}
          {open && !retryable && hasFolder && onRunFullCheck && <button type="button" className="ck-button is-small" onClick={onRunFullCheck} disabled={running}><Icon icon={Play} shape="play" />Run a full check</button>}
          <button type="button" className="pc-side-toggle" onClick={onToggle} aria-expanded={open} aria-controls="pc-side-more"
            aria-label={toggleLabel} title={toggleLabel}>
            <Icon icon={open ? CornersIn : CornersOut} />
          </button>
        </div>
      </div>
      {open && message && <p className="pc-empty pc-side-message">{message}</p>}
      {!open ? (
        <div className="pc-side-body">
          <section className="pc-side-col pc-side-latest">
            {summary}
            {result && problems.length > 0 && <>
              <h2>Problems</h2>
              <ul className="pc-latest-problems">
                {problems.map(problem => {
                  const look = problemLook(problem);
                  return <li key={problem.key}><Icon icon={look.icon} shape={look.shape} className={look.className} /><span title={problem.title}>{problem.title}</span></li>;
                })}
              </ul>
            </>}
            {result && <button type="button" className="ck-link pc-open-result" onClick={onOpen}><Icon icon={LayoutList} />Open the full result</button>}
          </section>
        </div>
      ) : (
        <div className="pc-side-body" id="pc-side-more">
          <section className="pc-side-col pc-side-main pc-side-extra" aria-label="Latest check">
            <ProjectOverviewMain projectId={project.id} latest={latest} trace={trace}
              onReplay={onRunAgain} />
          </section>
          <section className="pc-side-col pc-side-extra">
            <ProjectOverviewRail latest={latest} trace={trace}>
              <RequirementsSection projectId={project.id} requirements={latest.requirements} tally={tally} documents={documents} tests={latest.autoTest?.tests ?? []} onChanged={latest.reload} />
              <SourcesSection project={project} artifacts={artifacts} onChanged={onSourcesChanged} />
              <section aria-label="Saved browser tests">
                <h3>Saved browser tests{pinned.length ? ` · ${pinned.length}` : ''}</h3>
                {pinned.length ? (
                  <ul>
                    {pinned.map(test => {
                      const state = lastStateOf(test);
                      return (
                        <li key={`${test.sessionId}:${test.testId}`}>
                          {state === 'failed' ? <Icon icon={TriangleAlert} shape="triangle" className="pc-bad" /> : state === 'passed' ? <Icon icon={Check} /> : <Icon icon={MonitorCheck} />}
                          <span>{test.name}</span>
                          <button type="button" className="pc-unpin" onClick={() => unpinTest(project.id, test)} aria-label={`Stop running ${test.name} in every check`}><Icon icon={X} /></button>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="pc-empty">None yet. Use Save for every check on a test.</p>}
              </section>
              <section aria-label="How it is tested">
                <h3>How it is tested</h3>
                <ul>
                  <li><Icon icon={Globe} /><span>{hasFolder ? 'ORIN starts the app itself' : 'No folder on this computer, so browser tests cannot run'}</span></li>
                  <li><Icon icon={ShieldCheck} /><span>{MODE_LABEL[mode]} mode</span></li>
                  {accountGiven && <li><Icon icon={Lock} /><span>Test account given in the conversation</span></li>}
                </ul>
              </section>
              <section aria-label="Checks">
                <h3>Checks</h3>
                {checks.length ? (
                  <ul>
                    {checks.slice(0, 5).map(check => (
                      <li key={check.id}>
                        <button type="button" className="ck-link pc-check-link" onClick={() => onOpenCheck ? onOpenCheck(check) : onNavigate({ name: 'check', checkId: check.id })}>
                          {check.phase === 'done' ? <ProblemCountIcon summary={check} /> : <Icon icon={LoaderCircle} />}
                          {new Date(check.createdAt).toLocaleDateString(undefined, DAY)} · <span className={check.phase === 'done' ? `problem-count-tone is-${problemCountTone(check)}` : undefined}>{check.phase === 'done' ? `${check.problemCount ?? 0} problems` : check.phase === 'failed' ? 'did not start' : 'running'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="pc-empty">No checks on this computer yet.</p>}
              </section>
            </ProjectOverviewRail>
          </section>
        </div>
      )}
    </aside>
  );
}


export function CheckProjectSidebar({ project, check, data, onNavigate, open, onToggle }: {
  project: Project; check: CheckRecord; data: CheckData; onNavigate: Navigate; open: boolean; onToggle(): void;
}) {
  const prefs = useProjectPrefs(project.id);
  const checks = useChecks().filter(item => item.projectId === project.id);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open || typeof api.listArtifacts !== 'function') return;
    let active = true;
    void api.listArtifacts(project.id).then(items => { if (active) setArtifacts(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [open, project.id, version]);
  return <ProjectSidePanel project={project} open={open} onToggle={onToggle} checkLabel="This check"
    latest={{ review: data.review, autoTest: data.autoTest,
      result: data.requirementsState === 'unavailable' ? { ...data.result, requirements: null } : data.result, requirements: data.requirements,
      findings: data.findings, at: check.finishedAt ?? check.createdAt, loading: false, reload: () => setVersion(value => value + 1) }}
    onOpen={() => { if (open) onToggle(); else document.querySelector<HTMLElement>('.ck-detail-content')?.scrollTo?.({ top: 0 }); }}
    artifacts={artifacts} onSourcesChanged={() => setVersion(value => value + 1)}
    codeFiles={artifacts.filter(item => item.source === 'repository').length}
    pinned={prefs.pinned} lastStateOf={ref => ref.sessionId === data.autoTest?.id ? data.autoTest.tests.find(item => item.id === ref.testId)?.state : undefined}
    mode={prefs.mode} accountGiven={prefs.accountReminderShown} checks={checks} onNavigate={onNavigate} />;
}
