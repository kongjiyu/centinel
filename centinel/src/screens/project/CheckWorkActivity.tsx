import { useState, type ReactNode } from 'react';
import { ChevronRight, FileSearch, Globe, ListChecks, MonitorCheck, ScanSearch, SquareChartGantt, Wrench } from 'lucide-react';
import type { AutoTestEntry, AutoTestSession } from '../../autotest/types';
import type { CheckData } from '../../check/useCheckData';
import { Icon } from '../../components/Icon';
import { RunTimeline } from '../check/RunTimeline';

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const workList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

export const checkWorkLabels = {
  code: 'Started the Code Review',
  browser: 'Started the Browser Check',
} as const;

export type CheckWorkBranches = Partial<Record<keyof typeof checkWorkLabels, ReactNode>>;

export function WorkRow({ icon: glyph = FileSearch, children }: { icon?: typeof FileSearch; children: ReactNode }) {
  return <li className="pc-work-row"><Icon icon={glyph} /><div>{children}</div></li>;
}

function BrowserTestActivity({ test, projectId }: { test: AutoTestEntry; projectId: string }) {
  const [open, setOpen] = useState(false);
  const started = !!(test.startedAt || test.runId || test.smoke?.pages.length);
  const verdict = test.state === 'passed' ? 'passed' : test.state === 'failed' ? 'failed' : test.state === 'uncertain' ? 'unclear' : undefined;
  return <details className="pc-check-branch" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Icon icon={MonitorCheck} /><span>{started ? 'Started' : 'Recorded'} {test.name}</span><Icon icon={ChevronRight} /></summary>
    {open && <div className="pc-test-work">
      {test.firstAttempt?.runId && test.firstAttempt.runId !== test.runId && <BrowserAttempt projectId={projectId} runId={test.firstAttempt.runId} />}
      {test.runId && <RunTimeline projectId={projectId} runId={test.runId} activity />}
      <ul className="pc-activity-list" role="list" aria-label="Recorded assertions and verdict">
        {test.smoke?.pages.map(page => <WorkRow key={page.path} icon={Globe}>Checked <code>{page.path}</code>{page.status != null && ` · HTTP ${page.status}`}</WorkRow>)}
        {test.checkResults?.filter(result => result.verdict !== 'not_tested').map((result, index) => <WorkRow key={`${result.checkId}:${index}`} icon={ListChecks}>
          Checked {test.checks.find(check => check.id === result.checkId)?.description ?? 'a saved assertion'}
          {result.observed && <div className="pc-work-detail">Observed {result.observed}</div>}
          {result.evidenceIds.length > 0 && <div className="pc-work-detail">Recorded {counted(result.evidenceIds.length, 'evidence item')}</div>}
        </WorkRow>)}
        {verdict && <WorkRow icon={ListChecks}>Saved the verdict · {verdict}</WorkRow>}
      </ul>
    </div>}
  </details>;
}

function BrowserAttempt({ projectId, runId }: { projectId: string; runId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="pc-saved-scope" onToggle={event => setOpen(event.currentTarget.open)}><summary>First attempt</summary>
    {open && <RunTimeline projectId={projectId} runId={runId} activity />}
  </details>;
}

function BrowserWorkActivity({ session }: { session: AutoTestSession }) {
  const { repository, launch, exploration, tests, dropped, summary } = session;
  const planned = tests.filter(test => !test.kind || session.planning === false);
  const recorded = tests.filter(test => test.startedAt || test.runId || test.checkResults?.length || test.smoke?.pages.length
    || ['running', 'passed', 'failed', 'uncertain'].includes(test.state));
  const pages = exploration?.pages.length ?? 0;
  const work = [
    repository && `read ${counted(repository.files, 'project file')}`,
    launch?.url && 'started the app',
    pages > 0 && `inspected ${counted(pages, 'page')}`,
    planned.length > 0 && `${session.planning === false ? 'loaded' : 'prepared'} ${counted(planned.length, 'test')}`,
    recorded.length > 0 && `started ${counted(recorded.length, 'test')}`,
  ].filter((part): part is string => Boolean(part));
  const stoppedBeforeTesting = (session.stage === 'failed' || session.stage === 'cancelled') && !recorded.length;
  return <div className="pc-check-work">
    {(work.length > 0 || stoppedBeforeTesting) && <p className="pc-work-summary">
      {work.length > 0 && `I ${workList.format(work)}.`}
      {stoppedBeforeTesting && `${work.length ? ' ' : ''}I stopped before any Browser tests ran.`}
    </p>}
    <ul className="pc-activity-list" role="list" aria-label="Browser actions">
      {repository && <WorkRow>Read {counted(repository.files, 'file')} · {counted(repository.routes, 'route')} · {counted(repository.forms, 'form')}{repository.requirements && ' · found requirements'}</WorkRow>}
      {(launch?.installStarted || launch?.installing) && <WorkRow icon={Wrench}>Started installing dependencies</WorkRow>}
      {launch?.url && <WorkRow icon={Globe}>Started the app at <code>{launch.url}</code></WorkRow>}
      {exploration?.pages.map(page => <WorkRow icon={ScanSearch} key={page.path}>Inspected <code>{page.path}</code> · {page.controls} controls</WorkRow>)}
      {planned.map(test => <WorkRow icon={ListChecks} key={test.id}>{session.planning === false ? 'Loaded saved test' : 'Prepared test'} <strong>{test.name}</strong></WorkRow>)}
      {dropped.map((item, index) => <WorkRow icon={ListChecks} key={`${item.name}:${index}`}>Left out <strong>{item.name}</strong> · {item.reason}</WorkRow>)}
    </ul>
    {recorded.map(test => <BrowserTestActivity key={test.id} test={test} projectId={session.projectId} />)}
    {summary && <p className="pc-work-note">Saved Browser results · {summary.passed} passed · {summary.failed} failed{summary.uncertain > 0 && ` · ${summary.uncertain} unclear`}</p>}
  </div>;
}

const codeStages = { freezing_sources: 'Saved the exact source versions', indexing_context: 'Indexing the repo', deterministic_analysis: 'Running rule check' } as const;
const reviewPhases: Record<string, string> = { documents: 'Worked on the documents', behaviors: 'Worked on code behavior', environment: 'Worked on settings and other files' };
const phaseTargets: Record<string, string> = { documents: 'documents', behaviors: 'code behavior', environment: 'settings and other files' };

export function CodeWorkSection({ data }: { data: CheckData }) {
  return <CheckWorkSection mode="code"><CodeWorkActivity data={data} /></CheckWorkSection>;
}

function CodeWorkActivity({ data }: { data: CheckData }) {
  const progress = data.trace?.review.progress;
  const journal = (data.trace?.events ?? []).filter(event => event.reviewId === data.review?.id);
  const completed = new Set(progress?.completedStages ?? []);
  const started = new Set(journal.filter(event => event.event === 'review_stage_started').map(event => event.stage));
  const finished = data.result.codeState === 'done';
  const finishedBatches = new Set(journal.filter(event => event.event === 'review_analysis_batch_saved')
    .flatMap(event => typeof event.detail?.batchId === 'string' ? [event.detail.batchId] : [])).size;
  const summary = [
    completed.has('freezing_sources') && 'saved the exact source versions',
    completed.has('indexing_context') && 'prepared the source index',
    completed.has('deterministic_analysis') && 'ran the rule checks',
    finishedBatches > 0 && `saved results for ${counted(finishedBatches, 'review batch')}`,
    finished && data.evidenceLoaded && `saved ${counted(data.findings.length, 'finding')}`,
  ].filter((part): part is string => Boolean(part));
  const work = journal.flatMap(event => {
    const batch = typeof event.detail?.batchId === 'string' ? event.detail.batchId : undefined;
    const file = typeof event.detail?.filePath === 'string' ? event.detail.filePath : undefined;
    const phase = typeof event.detail?.phase === 'string' ? phaseTargets[event.detail.phase] : undefined;
    const number = typeof event.detail?.batchNumber === 'number' ? event.detail.batchNumber : undefined;
    switch (event.event) {
      case 'review_assessment_batch_started': return [<>Started reviewing {phase ?? 'a source batch'}{number && ` · batch ${number}`}{file && <> · <code>{file}</code></>}</>];
      case 'review_analysis_batch_saved': return [batch ? <>Finished reviewing batch <code>{batch}</code></> : 'Finished reviewing a batch'];
      case 'review_analysis_batch_unverified':
      case 'review_batch_needs_verification': return [batch ? <>Recorded a coverage gap in batch <code>{batch}</code></> : 'Recorded a coverage gap'];
      case 'review_batch_cache_reused': return [batch ? <>Referenced the previously validated batch <code>{batch}</code></> : 'Referenced a previously validated batch'];
      default: return [];
    }
  });
  return <div className="pc-check-work">
    {summary.length > 0 && <p className="pc-work-summary">I {workList.format(summary)}.</p>}
    <ul className="pc-activity-list" role="list" aria-label="Code Review actions">
      {Object.entries(codeStages).filter(([stage]) => completed.has(stage) || started.has(stage) || progress?.stage === stage)
        .map(([stage, label]) => <WorkRow key={stage}>{stage === 'freezing_sources' && !completed.has(stage) ? 'Started saving the exact source versions' : label}</WorkRow>)}
    </ul>
    {progress?.assessmentPhase && reviewPhases[progress.assessmentPhase] && <p className="pc-work-note">
      {data.result.codeState === 'running' ? data.live.stageLabel : reviewPhases[progress.assessmentPhase]}
    </p>}
    {work.map((note, index) => <p className="pc-work-note" key={index}>{note}</p>)}
    <ul className="pc-activity-list" role="list" aria-label="Recorded findings">
      {(data.findings.length ? data.findings.map(item => ({ key: item.id, title: item.title,
        location: item.filePath ? `${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ''}` : null })) : data.live.problems)
        .map(item => <WorkRow icon={ListChecks} key={item.key}>Recorded finding <strong>{item.title}</strong>{item.location && <> · <code>{item.location}</code></>}</WorkRow>)}
    </ul>
  </div>;
}

function CheckWorkSection({ mode, children }: { mode: keyof typeof checkWorkLabels; children: ReactNode }) {
  return <details className="pc-check-branch">
    <summary><Icon icon={SquareChartGantt} /><span>{checkWorkLabels[mode]}</span><Icon icon={ChevronRight} /></summary>
    {children}
  </details>;
}

export function BrowserWorkSection({ session }: { session: AutoTestSession }) {
  return <CheckWorkSection mode="browser"><BrowserWorkActivity session={session} /></CheckWorkSection>;
}
