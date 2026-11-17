import { useEffect, useState } from 'react';
import { Check, Code, Download, FileText, Folder, Info, LayoutList, LoaderCircle, Lock, MonitorCheck, TriangleAlert, OctagonAlert, X, Minus, Globe, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { AutoTestRef } from '../../autotest/types';
import { Icon } from '../../components/Icon';
import { CornersIn, CornersOut } from '../../components/cornerIcons';
import { MODE_LABEL, unpinTest, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import type { LatestResult } from '../../check/latestResult';
import { useChecks } from '../../check/store';
import { folderName } from '../../check/runner';
import { projectLocalFolder } from '../../check/projectWorkspace';
import type { CheckData } from '../../check/useCheckData';
import type { CheckRecord } from '../../check/types';
import type { Artifact, Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import './ProjectConversation.css';

type Navigate = (screen: Screen) => void;
const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

const RISK_ICON: Record<string, { icon: typeof Check; shape?: 'triangle'; className: string }> = {
  critical: { icon: OctagonAlert, className: 'pc-risk-critical' },
  high: { icon: TriangleAlert, shape: 'triangle', className: 'pc-risk-high' },
  medium: { icon: TriangleAlert, shape: 'triangle', className: 'pc-risk-medium' },
  low: { icon: Info, className: 'pc-risk-low' },
};

export function ProjectSidePanel({ project, latest, onOpen, open, onToggle, documents, codeFiles, pinned, lastStateOf, mode, accountGiven, checks, onNavigate, checkLabel }: {
  project: Project; latest: LatestResult; onOpen(): void; open: boolean; onToggle(): void;
  documents: Artifact[]; codeFiles: number; pinned: ReturnType<typeof useProjectPrefs>['pinned'];
  lastStateOf(ref: AutoTestRef): string | undefined; mode: PermissionMode; accountGiven: boolean;
  checks: ReturnType<typeof useChecks>; onNavigate: Navigate; checkLabel?: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { result, review, autoTest } = latest;
  const problems = result ? [...result.proven, ...result.foundInCode] : [];
  const running = !!result && !result.finished;
  const reviewDone = !!review && result?.codeState === 'done';
  const tally = result?.requirements ?? null;
  const browserTests = autoTest?.tests ?? [];
  const browserFailed = browserTests.filter(test => test.state === 'failed').length;
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
  const requirementNames = tally ? (latest.requirements.length ? latest.requirements.map(item => item.title) : [...tally.notMetNames, ...(tally.metNames ?? [])]) : [];

  const latestLabel = checkLabel ?? `Latest check${latest.at ? ` · ${new Date(latest.at).toLocaleDateString(undefined, DAY)}` : ''}`;
  const toggleLabel = open ? 'Back to the conversation' : 'Show the whole project';

  return (
    <aside className={`pc-side${open ? ' is-open' : ''}`} aria-label="What Centinel knows">
      <div className="pc-side-top">
        <h2>{open ? project.name : latestLabel}</h2>
        <button type="button" className="pc-side-toggle" onClick={onToggle} aria-expanded={open} aria-controls="pc-side-more"
          aria-label={toggleLabel} title={toggleLabel}>
          <Icon icon={open ? CornersIn : CornersOut} />
        </button>
      </div>
      <div className="pc-side-body">
        <section className="pc-side-col pc-side-latest">
          {open && <h2>{latestLabel}</h2>}
          {latest.loading ? <p className="pc-empty"><Icon icon={LoaderCircle} className="ci-spin" /> Loading…</p>
            : !result ? <p className="pc-empty">No check has run yet. Use Run a full check.</p>
            : <>
              <p className="pc-latest-verdict">
                {running ? <Icon icon={LoaderCircle} className="ci-spin" /> : problems.length ? <Icon icon={TriangleAlert} shape="triangle" className="pc-bad" /> : <Icon icon={Check} />}
                <span>{running ? 'A check is running' : problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'No problems found'}</span>
              </p>
              {!running && result.proven.length > 0 && <p className="pc-latest-sub">{result.proven.length} proven in the browser</p>}
              {!running && (
                <div className="pc-latest-numbers">
                  <div><small>Browser</small><b>{result.browserState === 'not_requested' || result.browserState === 'not_started' ? '–' : result.proven.length}</b></div>
                  <div><small>Code</small><b>{result.codeState === 'not_requested' || result.codeState === 'not_started' ? '–' : result.foundInCode.length}</b></div>
                  <div><small>Not met</small><b>{tally ? tally.notMet : '–'}</b>{tally ? <small className="pc-of"> /{tally.total}</small> : null}</div>
                </div>
              )}
              {problems.length > 0 && <>
                <h2>Problems</h2>
                <ul className="pc-latest-problems">
                  {problems.map(problem => {
                    const look = RISK_ICON[problem.risk ?? ''] ?? (problem.marks.includes('browser') ? { icon: MonitorCheck, className: 'pc-risk-browser' } : RISK_ICON.low);
                    return <li key={problem.key}><Icon icon={look.icon} shape={look.shape} className={look.className} /><span title={problem.title}>{problem.title}</span></li>;
                  })}
                </ul>
              </>}
              <button type="button" className="ck-link pc-open-result" onClick={onOpen}><Icon icon={LayoutList} />Open the full result</button>
            </>}
        </section>
        {open && <>
          <section className="pc-side-col pc-side-extra" id="pc-side-more">
            {tally && tally.total > 0 && <>
              <h2>Requirements</h2>
              <ul>
                {requirementNames.map(name => {
                  const notMet = tally.notMetNames.includes(name);
                  const met = tally.metNames?.includes(name);
                  return <li key={name}>{notMet ? <Icon icon={X} className="pc-bad" /> : met ? <Icon icon={Check} /> : <Icon icon={Minus} />}<span title={`${name}: ${notMet ? 'not met' : met ? 'met' : 'not checked'}`}>{name}</span></li>;
                })}
              </ul>
            </>}
            {browserTests.length > 0 && <>
              <h2>Browser tests · {browserFailed ? `${browserFailed} of ${browserTests.length} failed` : `${browserTests.length} ran`}</h2>
              <ul>
                {browserTests.map(test => (
                  <li key={test.id}>
                    {test.state === 'failed' ? <Icon icon={X} className="pc-bad" /> : test.state === 'passed' ? <Icon icon={Check} /> : <Icon icon={Minus} />}
                    <span title={`${test.name}: ${test.state === 'failed' ? 'failed' : test.state === 'passed' ? 'passed' : 'not finished'}`}>{test.name}</span>
                  </li>
                ))}
              </ul>
            </>}
            {!(tally && tally.total) && !browserTests.length && <p className="pc-empty">No requirements or browser tests yet.</p>}
          </section>
          <section className="pc-side-col pc-side-extra">
            <h2>Sources</h2>
            <ul>
              {project.workspacePath ? <li><Icon icon={Folder} /><span title={project.workspacePath}>{folderName(project.workspacePath)}{codeFiles ? ` · ${codeFiles} files` : ''}</span></li> : <li><Icon icon={Code} /><span>{codeFiles} code files</span></li>}
              {documents.slice(0, 8).map(document => <li key={document.id}><Icon icon={FileText} /><span>{document.fileName}</span></li>)}
            </ul>
            <h2>Saved browser tests{pinned.length ? ` · ${pinned.length}` : ''}</h2>
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
            <h2>How it is tested</h2>
            <ul>
              <li><Icon icon={Globe} /><span>{hasFolder ? 'Centinel starts the app itself' : 'No folder on this computer, so browser tests cannot run'}</span></li>
              <li><Icon icon={ShieldCheck} /><span>{MODE_LABEL[mode]} mode</span></li>
              {accountGiven && <li><Icon icon={Lock} /><span>Test account given in the conversation</span></li>}
            </ul>
            <h2>Checks</h2>
            {checks.length ? (
              <ul>
                {checks.slice(0, 5).map(check => (
                  <li key={check.id}>
                    <button type="button" className="ck-link pc-check-link" onClick={() => onNavigate({ name: 'check', checkId: check.id })}>
                      {check.phase === 'done' && check.problemCount ? <Icon icon={TriangleAlert} shape="triangle" className="pc-bad" /> : check.phase === 'done' ? <Icon icon={Check} /> : <Icon icon={LoaderCircle} />}
                      {new Date(check.createdAt).toLocaleDateString(undefined, DAY)} · {check.phase === 'done' ? `${check.problemCount ?? 0} problems` : check.phase === 'failed' ? 'did not start' : 'running'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="pc-empty">No checks on this computer yet.</p>}
            {reviewDone && <button type="button" className="ck-button is-primary is-small pc-download" onClick={() => void download()} disabled={exporting}><Icon icon={Download} />{exporting ? 'Creating report…' : 'Download report'}</button>}
            {message && <p className="pc-empty">{message}</p>}
            <button type="button" className="ck-link pc-details" onClick={() => onNavigate({ name: 'project-detail', projectId: project.id, details: true })}>Details: findings, sources, settings</button>
          </section>
        </>}
      </div>
    </aside>
  );
}


export function CheckProjectSidebar({ project, check, data, onNavigate, open, onToggle }: {
  project: Project; check: CheckRecord; data: CheckData; onNavigate: Navigate; open: boolean; onToggle(): void;
}) {
  const prefs = useProjectPrefs(project.id);
  const checks = useChecks().filter(item => item.projectId === project.id);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  useEffect(() => {
    if (!open || typeof api.listArtifacts !== 'function') return;
    let active = true;
    void api.listArtifacts(project.id).then(items => { if (active) setArtifacts(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [open, project.id]);
  return <ProjectSidePanel project={project} open={open} onToggle={onToggle} checkLabel="This check"
    latest={{ review: data.review, autoTest: data.autoTest, result: data.result, requirements: data.requirements,
      at: check.finishedAt ?? check.createdAt, loading: false }}
    onOpen={() => { if (open) onToggle(); else document.querySelector<HTMLElement>('.ck-detail-content')?.scrollTo?.({ top: 0 }); }}
    documents={artifacts.filter(item => item.source === 'documents')}
    codeFiles={artifacts.filter(item => item.source === 'repository').length}
    pinned={prefs.pinned} lastStateOf={ref => ref.sessionId === data.autoTest?.id ? data.autoTest.tests.find(item => item.id === ref.testId)?.state : undefined}
    mode={prefs.mode} accountGiven={prefs.accountReminderShown} checks={checks} onNavigate={onNavigate} />;
}
