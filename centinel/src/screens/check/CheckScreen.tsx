import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Clock, Code, Download, FileText, Flag, Folder, Image, Info, ListX, LoaderCircle, MonitorCheck, OctagonAlert, Play, Plus, Sparkles, Square, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import { laneNumber } from '../../autotest/presentation';
import { Icon } from '../../components/Icon';
import type { CheckProblem, CheckResult } from '../../check/result';
import { markCheckViewed, useCheck } from '../../check/store';
import { type CheckRecord } from '../../check/types';
import { useCheckData, type CheckData } from '../../check/useCheckData';
import type { RiskLevel } from '../../riskPolicy';
import type { Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { BrowserTiles } from './BrowserTiles';
import { useCheckLibrary } from './CheckSourceLibrary';
import type { Artifact } from '../../types';
import { CheckFollowUp, CheckProjectHeader, CheckProjectLayout } from './CheckProjectWorkspace';
import { CheckProjectSidebar } from '../project/ProjectSidePanel';
import './Check.css';
import { animateCheckTransition } from '../../check/checkTransition';

type Navigate = (screen: Screen) => void;

/** Renders `code` spans from saved text as code; everything else stays plain text. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return <>{parts.map((part, index) => part.length > 2 && part.startsWith('`') && part.endsWith('`') ? <code key={index} className="ck-code">{part.slice(1, -1)}</code> : part)}</>;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return minutes ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function CheckScreen({ checkId, onNavigate, projects }: { checkId: string; onNavigate: Navigate; projects?: Project[] }) {
  const check = useCheck(checkId);
  const [expanded, setExpanded] = useState(false);
  const library = useCheckLibrary(projects ? check?.projectId : undefined);
  const data = useCheckData(check);
  const showResult = !!check && !!data && (check.phase === 'failed' || check.phase === 'done' || data.result.finished);
  useLayoutEffect(() => {
    if (data) animateCheckTransition(checkId, document.querySelector<HTMLElement>('.ck-detail-content'));
  }, [checkId, !!data]);
  useEffect(() => {
    if (!showResult) return;
    const markVisible = () => {
      if (document.visibilityState === 'visible') markCheckViewed(checkId);
    };
    markVisible();
    document.addEventListener('visibilitychange', markVisible);
    return () => document.removeEventListener('visibilitychange', markVisible);
  }, [checkId, showResult]);
  if (!check) {
    return (
      <div className="ck-screen ck-empty">
        <h1 className="ck-title">This check is not on this device</h1>
        <p className="ck-sub">Checks are listed on the computer where they were started. The project and its saved results are still under Details.</p>
        <button type="button" className="ck-button is-primary" onClick={() => onNavigate({ name: 'new-check' })}><Icon icon={Plus} />New check</button>
      </div>
    );
  }
  if (!data) return null;
  const content = showResult && !data.evidenceLoaded
    ? <div className="ck-screen"><section className="ck-panel" role="status">Loading the saved result…{data.loadError && <p>{data.loadError}</p>}</section></div>
    : showResult ? <ResultView check={check} data={data} onNavigate={onNavigate} /> : <LiveView check={check} data={data} onNavigate={onNavigate} />;
  if (!projects) return content;
  const project = projects.find(item => item.id === check.projectId);
  return <CheckProjectLayout
    expanded={expanded} onCloseSidebar={() => setExpanded(false)}
    header={<CheckProjectHeader check={check} project={project} onNavigate={onNavigate} library={library} />}
    composer={<CheckFollowUp key={check.id} check={check} projects={projects} onNavigate={onNavigate} available={showResult} library={library} />}
    sidebar={project && <CheckProjectSidebar key={check.id} project={project} check={check} data={data} onNavigate={onNavigate} open={expanded} onToggle={() => setExpanded(value => !value)} />}>
    {content}
  </CheckProjectLayout>;
}

/* ------------------------------------------------------------------ Live */

type StepState = 'done' | 'current' | 'upcoming' | 'failed' | 'paused';

const PREP_TEXT: Record<string, string> = {
  project: 'Reading the project folder',
  documents: 'Adding your documents',
  github: 'Importing the repository from GitHub',
  review: 'Starting the code review',
  browser: 'Starting the browser tests',
};

function liveSteps(check: CheckRecord, data: CheckData) {
  const { result, autoTest } = data;
  const steps: Array<{ id: string; label: string; state: StepState }> = [];
  steps.push({ id: 'read', label: check.phase === 'preparing' ? PREP_TEXT[check.prepStep ?? 'project'] : 'Read the project', state: check.phase === 'preparing' ? 'current' : 'done' });
  if (check.autoTestId) {
    const started = !!autoTest && ['exploring', 'planning', 'testing', 'summarizing', 'completed'].includes(autoTest.stage);
    const failedEarly = autoTest?.stage === 'failed' && !autoTest.launch?.url;
    steps.push({ id: 'app', label: started ? 'Started the app' : 'Start the app', state: failedEarly ? 'failed' : started ? 'done' : check.phase === 'preparing' ? 'upcoming' : 'current' });
  }
  const paused = result.codeState === 'paused';
  steps.push({ id: 'find', label: check.autoTestId && check.reviewId ? 'Find and prove problems' : check.autoTestId ? 'Test in the browser' : 'Find problems in the code', state: paused ? 'paused' : check.phase === 'preparing' ? 'upcoming' : steps.some(step => step.state === 'current') ? 'upcoming' : 'current' });
  steps.push({ id: 'result', label: 'Result', state: 'upcoming' });
  return steps;
}

function StageStrip({ steps }: { steps: ReturnType<typeof liveSteps> }) {
  return (
    <ol className="ck-steps" aria-label="Progress">
      {steps.map(step => (
        <li key={step.id} className={`is-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
          {step.state === 'done' && <Icon icon={Check} />}
          {step.state === 'current' && <Icon icon={LoaderCircle} className="ci-spin" />}
          {step.state === 'failed' && <Icon icon={TriangleAlert} shape="triangle" />}
          {step.state === 'paused' && <Icon icon={Info} />}
          {step.state === 'upcoming' && step.id === 'result' && <Icon icon={Flag} />}
          <span>{step.state === 'paused' ? 'Paused' : step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function LiveView({ check, data, onNavigate }: { check: CheckRecord; data: CheckData; onNavigate: Navigate }) {
  const now = useNow(true);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const { result, review, findings, autoTest, live } = data;
  const wantsCode = check.mode !== 'browser';
  const wantsBrowser = check.mode !== 'code';
  const codeDone = result.codeState !== 'running' && result.codeState !== 'not_started';

  const stop = async () => {
    if (!check.projectId) return;
    setStopping(true);
    setStopError(null);
    try {
      await Promise.all([
        check.reviewId && result.codeState === 'running' ? api.cancelStaticSession(check.projectId, check.reviewId) : null,
        check.autoTestId && result.browserState === 'running' ? api.cancelAutoTest(check.projectId, check.autoTestId) : null,
      ]);
    } catch (cause) {
      setStopError(userFacingError(cause, 'The check could not be stopped. Try again.'));
    } finally {
      setStopping(false);
    }
  };

  // Problems that appear live: validated titles while running, saved findings once the review ends.
  const codeItems: Array<{ key: string; title: string; location: string | null }> = codeDone
    ? result.foundInCode.map(problem => ({ key: problem.key, title: problem.title, location: problem.location }))
    : live.titles.map(title => ({ key: title, title, location: null }));
  const browserFails = (autoTest?.tests ?? []).filter(test => test.state === 'failed');
  const runningTests = (autoTest?.tests ?? []).filter(test => test.state === 'running');

  return (
    <div className="ck-screen ck-live">
      <div className="ck-glow is-low" aria-hidden="true" />
      <div className="ck-panel">
        <header className="ck-live-head">
          <h1 className="ck-title">Checking {check.title || check.projectName}<span className="ci-pair ck-elapsed"><Icon icon={Clock} /><span className="ci-text">{formatElapsed(now - Date.parse(check.createdAt))}</span></span></h1>
          {check.phase === 'running' && <button type="button" className="ck-button" onClick={() => void stop()} disabled={stopping}><Icon icon={Square} />{stopping ? 'Stopping…' : 'Stop'}</button>}
        </header>
        <StageStrip steps={liveSteps(check, data)} />
        {stopError && <p className="ck-inline-message" role="alert"><Icon icon={TriangleAlert} shape="triangle" />{stopError}</p>}
        {result.codeState === 'paused' && check.projectId && check.reviewId && (
          <div className="ck-setup-step" role="status">
            <Icon icon={Info} />
            <span>The code review is paused because the AI provider reached a limit. Nothing resumes by itself.</span>
            <button type="button" className="ck-button" onClick={() => onNavigate({ name: 'review-activity', projectId: check.projectId!, sessionId: check.reviewId! })}>Open the review to resume</button>
          </div>
        )}
        {check.notes.length > 0 && <ul className="ck-notes">{check.notes.map(note => <li key={note}><Icon icon={Info} />{note}</li>)}</ul>}
        {data.loadError && <p className="ck-inline-message is-quiet" role="status"><Icon icon={Info} />{data.loadError}</p>}

        <div className={`ck-columns${wantsCode && wantsBrowser ? '' : ' is-single'}`} aria-live="polite">
          {wantsCode && (
            <section className="ck-col" aria-label="Found in the code">
              <div className="ck-col-head">
                <span className="ci-pair"><Icon icon={Code} /><span className="ci-text">Found in the code</span></span>
                {result.codeState === 'running' && (
                  <span className="ck-reading">
                    <span className="ck-pulse" aria-hidden="true" />
                    {live.currentFiles.length ? <><Icon icon={FileText} /><span className="ck-mono">{live.currentFiles[0]}</span></> : <span>{live.stageLabel}</span>}
                  </span>
                )}
              </div>
              {result.codeState === 'running' && live.batchesTotal && (
                <p className="ck-col-note"><span><span className="ck-tabular">{live.batchesDone} of {live.batchesTotal}</span> parts reviewed</span></p>
              )}
              {check.phase === 'preparing' && !check.reviewId && <p className="ck-col-note"><Icon icon={LoaderCircle} className="ci-spin" />{PREP_TEXT[check.prepStep ?? 'project']}</p>}
              {codeDone && <p className="ck-col-note"><Icon icon={Check} />Code review finished{findings.length ? '' : ' with no problems'}.</p>}
              <ul className="ck-live-list">
                {codeItems.map(item => (
                  <li key={item.key} className="ck-live-item">
                    <span className="ck-live-title">{item.title}{item.location && <small className="ck-mono">{item.location}</small>}</span>
                    <span className="ck-mark"><Icon icon={Code} />Code</span>
                  </li>
                ))}
              </ul>
              {result.codeState === 'running' && !codeItems.length && review && <p className="ck-col-empty">Problems appear here as soon as each one is confirmed.</p>}
            </section>
          )}
          {wantsBrowser && (
            <section className="ck-col" aria-label="Proving in the browser">
              <div className="ck-col-head">
                <span className="ci-pair"><Icon icon={MonitorCheck} /><span className="ci-text">{wantsCode ? 'Proving in the browser' : 'Testing in the browser'}</span></span>
              </div>
              {autoTest ? <BrowserTiles session={autoTest} /> : (
                <div className="ck-stage"><div className="ck-stage-waiting"><Icon icon={check.phase === 'preparing' ? LoaderCircle : Info} className={check.phase === 'preparing' ? 'ci-spin' : ''} /><span>{check.phase === 'preparing' ? 'Waiting for the project to be ready' : check.autoTestId ? 'Connecting to the browser tests…' : 'Browser tests are not running for this check.'}</span></div></div>
              )}
              {browserFails.length > 0 && (
                <ul className="ck-live-list">
                  {browserFails.map(test => (
                    <li key={test.id} className="ck-live-item">
                      <span className="ck-live-title">{test.name}{test.sourceRefs[0] && <small className="ck-mono">{test.sourceRefs[0].path}:{test.sourceRefs[0].line}</small>}</span>
                      <span className="ck-mark is-browser"><Icon icon={MonitorCheck} />Browser</span>
                    </li>
                  ))}
                </ul>
              )}
              {runningTests.length > 0 && <span className="ck-visually-hidden">{runningTests.map(test => `${test.name} in browser ${test.laneId ? laneNumber(test.laneId) : ''}`).join(', ')}</span>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Result */

const RISK: Record<RiskLevel, { label: string; icon: typeof Info; shape?: 'triangle' }> = {
  critical: { label: 'Critical', icon: OctagonAlert },
  high: { label: 'High', icon: TriangleAlert, shape: 'triangle' },
  medium: { label: 'Medium', icon: TriangleAlert, shape: 'triangle' },
  low: { label: 'Low', icon: Info },
};

function ProblemRow({ problem, open, onToggle, check, onNavigate }: { problem: CheckProblem; open: boolean; onToggle(): void; check: CheckRecord; onNavigate: Navigate }) {
  const risk = problem.risk ? RISK[problem.risk] : null;
  const bodyId = `ck-problem-${problem.key.replace(/[^\w-]/g, '')}`;
  return (
    <li className={`ck-row${open ? ' is-open' : ''}`}>
      <button type="button" className="ck-row-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="ck-row-title">{problem.title}{problem.location && <small className="ck-mono">{problem.location}</small>}</span>
        {risk && <span className={`ck-risk is-${problem.risk}`}><Icon icon={risk.icon} shape={risk.shape} />{risk.label}</span>}
        {problem.marks.includes('code') && <span className="ck-mark"><Icon icon={Code} />Code</span>}
        {problem.marks.includes('browser') && <span className="ck-mark is-browser"><Icon icon={MonitorCheck} />Browser</span>}
        <Icon icon={open ? ChevronUp : ChevronDown} className="ck-chevron" />
      </button>
      {open && (
        <div className="ck-row-body" id={bodyId}>
          <div className={`ck-pair${problem.codeSummary && problem.browserChecks ? '' : ' is-single'}`}>
            {problem.codeSummary && (
              <div className="ck-evidence">
                <small className="ci-pair"><Icon icon={Code} /><span className="ci-text">In the code{problem.location ? ` · ${problem.location}` : ''}</span></small>
                <p><InlineText text={problem.codeSummary} /></p>
                {problem.codeEvidence && <pre className="ck-excerpt">{problem.codeEvidence}</pre>}
                {problem.recommendation && <p className="ck-fix"><strong>Suggested fix.</strong> <InlineText text={problem.recommendation} /></p>}
                {problem.needsCitationCheck && <p className="ck-col-note"><Icon icon={Info} />The location of this problem could not be matched exactly. Check it in the code.</p>}
              </div>
            )}
            {problem.browserChecks && (
              <div className="ck-evidence">
                <small className="ci-pair"><Icon icon={MonitorCheck} /><span className="ci-text">In the browser</span></small>
                {problem.browserChecks.map((item, index) => (
                  <dl key={index} className="ck-expect">
                    <div><dt>Expected</dt><dd>{item.expected}</dd></div>
                    <div><dt>The page showed</dt><dd>{item.observed}</dd></div>
                  </dl>
                ))}
              </div>
            )}
          </div>
          <div className="ck-links">
            {problem.runId && check.projectId && <>
              <button type="button" className="ck-button is-small" onClick={() => onNavigate({ name: 'dynamic-testing', projectId: check.projectId, runId: problem.runId })}><Icon icon={Image} />Screenshot</button>
              <button type="button" className="ck-button is-small" onClick={() => onNavigate({ name: 'dynamic-testing', projectId: check.projectId, runId: problem.runId })}><Icon icon={Play} shape="play" />Replay the test</button>
            </>}
            {problem.findingId && check.projectId && check.reviewId && (
              <button type="button" className="ck-button is-small" onClick={() => onNavigate({ name: 'review-finding', projectId: check.projectId!, sessionId: check.reviewId!, findingId: problem.findingId! })}><Icon icon={Code} />Open the code</button>
            )}
          </div>
          {problem.aiExplanation && (
            <div className="ck-ai">
              <small className="ci-pair"><Icon icon={Sparkles} /><span className="ci-text">AI explanation</span></small>
              <p><InlineText text={problem.aiExplanation} /></p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function NumberCard({ icon, label, children }: { icon: typeof Info; label: string; children: React.ReactNode }) {
  return (
    <div className="ck-number">
      <p className="ci-pair"><Icon icon={icon} /><span className="ci-text">{label}</span></p>
      <div className="ck-number-value">{children}</div>
    </div>
  );
}

function RequirementsValue({ result }: { result: CheckResult }) {
  const tally = result.requirements;
  if (!tally) return <span className="ck-number-text">No requirements provided</span>;
  if (tally.notMet === 0 && tally.notChecked === 0) return <span className="ck-number-text">All {tally.total} met</span>;
  return <><b>{tally.notMet}</b><small>of {tally.total}{tally.notChecked ? ` · ${tally.notChecked} not checked` : ''}</small></>;
}

function ResultView({ check, data, onNavigate }: { check: CheckRecord; data: CheckData; onNavigate: Navigate }) {
  const { result } = data;
  const firstKey = (result.proven[0] ?? result.foundInCode[0])?.key ?? null;
  const [openKey, setOpenKey] = useState<string | null>(firstKey);
  const userToggled = useRef(false);
  // Results arrive after the first render; open the top problem once, unless the person already chose.
  useEffect(() => { if (!userToggled.current && firstKey) setOpenKey(current => current ?? firstKey); }, [firstKey]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const finishedAt = check.finishedAt ? Date.parse(check.finishedAt) : Date.parse(data.review?.updatedAt ?? data.autoTest?.updatedAt ?? check.updatedAt);
  const duration = formatDuration(Math.max(0, finishedAt - Date.parse(check.createdAt)));

  const exportReport = async () => {
    if (!check.projectId || !check.reviewId) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const report = await api.exportProjectReport(check.projectId, { reviewId: check.reviewId });
      const target = report.downloads.pdf ?? report.downloads.markdown;
      if (!target) throw new Error('The report has no download link.');
      if (typeof window !== 'undefined' && '__TAURI_IPC__' in (window as object)) { const shell = await import('@tauri-apps/api/shell'); await shell.open(target); }
      else globalThis.open(target, '_blank', 'noopener');
      setExportMessage('The report opened in your browser.');
    } catch (cause) {
      setExportMessage(userFacingError(cause, 'The report could not be created. Try again.'));
    } finally {
      setExporting(false);
    }
  };

  const toggle = (key: string) => { userToggled.current = true; setOpenKey(current => current === key ? null : key); };
  const groups: Array<{ id: string; label: string; icon: typeof Info; items: CheckProblem[] }> = [
    { id: 'proven', label: 'Proven in the browser', icon: MonitorCheck, items: result.proven },
    { id: 'code', label: 'Found in code', icon: Code, items: result.foundInCode },
  ];
  const canExport = !!check.reviewId && result.codeState === 'done';

  return (
    <div className="ck-screen ck-result">
      <div className="ck-glow is-low" aria-hidden="true" />
      <div className="ck-panel">
        <header className="ck-result-head">
          <div>
            <p className="ck-context">
              <span className="ci-pair"><Icon icon={Folder} /><span className="ci-text">{check.projectName}</span></span>
              <span aria-hidden="true">·</span>
              <span className="ci-pair"><Icon icon={Clock} /><span className="ci-text">{check.phase === 'failed' ? 'did not start' : `checked in ${duration}`}</span></span>
            </p>
            <h1 className="ck-verdict">{result.verdict}</h1>
            {result.verdictDetail && <p className="ck-sub is-left">{result.verdictDetail}</p>}
          </div>
          {canExport && <button type="button" className="ck-button" onClick={() => void exportReport()} disabled={exporting}><Icon icon={Download} />{exporting ? 'Creating report…' : 'Export report'}</button>}
        </header>
        {exportMessage && <p className="ck-inline-message is-quiet" role="status"><Icon icon={Info} />{exportMessage}</p>}

        {check.phase === 'failed' ? (
          <div className="ck-actions-row">
            <button type="button" className="ck-button is-primary" onClick={() => onNavigate({ name: 'new-check' })}><Icon icon={Plus} />Start a new check</button>
          </div>
        ) : (
          <>
            <div className="ck-numbers">
              <NumberCard icon={MonitorCheck} label="Proven in the browser">
                {result.browserState === 'not_requested' || result.browserState === 'not_started' ? <span className="ck-number-text">Not run</span> : <b>{result.proven.length}</b>}
              </NumberCard>
              <NumberCard icon={Code} label="Found in code">
                {result.codeState === 'not_requested' || result.codeState === 'not_started' ? <span className="ck-number-text">Not run</span> : <b>{result.foundInCode.length}</b>}
              </NumberCard>
              <NumberCard icon={ListX} label="Requirements not met">{data.requirementsState === 'unavailable'
                ? <span className="ck-number-text">Requirements unavailable</span>
                : data.requirementsState === 'loading' ? <span className="ck-number-text">Loading…</span> : <RequirementsValue result={result} />}</NumberCard>
            </div>

            {groups.filter(group => group.items.length).map(group => (
              <section key={group.id} className="ck-group" aria-label={group.label}>
                <h2 className="ck-group-title ci-pair"><Icon icon={group.icon} /><span className="ci-text">{group.label}</span></h2>
                <ul className="ck-rows">
                  {group.items.map(problem => <ProblemRow key={problem.key} problem={problem} open={openKey === problem.key} onToggle={() => toggle(problem.key)} check={check} onNavigate={onNavigate} />)}
                </ul>
              </section>
            ))}

            {result.requirements && result.requirements.notMetNames.length > 0 && (
              <section className="ck-group" aria-label="Requirements not met">
                <h2 className="ck-group-title ci-pair"><Icon icon={ListX} /><span className="ci-text">Requirements not met</span></h2>
                <ul className="ck-plain-list">{result.requirements.notMetNames.map(name => <li key={name}>{name}</li>)}</ul>
              </section>
            )}
          </>
        )}

        <footer className="ck-foot">
          {result.notChecked.length > 0 && (
            <div className="ck-not-checked">
              <p className="ci-pair"><Icon icon={Info} /><span className="ci-text">Not checked</span></p>
              <ul>{result.notChecked.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {result.notes.length > 0 && <ul className="ck-method-notes">{result.notes.map(note => <li key={note} className="ci-pair"><Icon icon={Info} /><span className="ci-text">{note}</span></li>)}</ul>}
          {result.browserTestCount > 0 && <p className="ci-pair"><Icon icon={Check} /><span className="ci-text">{result.passedBrowserTests} of {result.browserTestCount} browser tests passed.</span></p>}
          {check.projectId && (
            <nav className="ck-details" aria-label="Details">
              <span>Details</span>
              {check.reviewId && <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'review-activity', projectId: check.projectId!, sessionId: check.reviewId! })}><Icon icon={Code} />Code review</button>}
              {check.autoTestId && <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'dynamic-testing', projectId: check.projectId })}><Icon icon={MonitorCheck} />Browser tests</button>}
              <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'requirements', projectId: check.projectId! })}><Icon icon={ListX} />Requirements</button>
              <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'project-detail', projectId: check.projectId! })}><Icon icon={Folder} />Project<Icon icon={ArrowRight} /></button>
            </nav>
          )}
        </footer>
      </div>
    </div>
  );
}
