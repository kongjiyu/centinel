import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bookmark, BookmarkCheck, Check, Download, LayoutList, Minus, OctagonAlert, ChevronDown, ChevronRight, Code, RotateCcw, Search, Wrench, FileText, Folder, Globe, Image, Info, LoaderCircle, Lock, MonitorCheck, Pencil, Play, Plus, Save, ShieldCheck, Sparkles, TriangleAlert, Undo2, X } from 'lucide-react';
import { api } from '../../api/client';
import type { AutoTestEntry, AutoTestPreset, AutoTestRef, AutoTestSession } from '../../autotest/types';
import { isActive } from '../../autotest/types';
import { stageHeadline } from '../../autotest/presentation';
import { Icon } from '../../components/Icon';
import { CornersIn, CornersOut } from '../../components/cornerIcons';
import { browserProblem } from '../../check/result';
import { addNote, isPinned, looksLikeAccount, MODE_LABEL, pinTest, setMode, setSideOpen, unpinTest, updatePrefs, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import { useLatestResult, type LatestResult } from '../../check/latestResult';
import { folderName, startCheck } from '../../check/runner';
import { useChecks } from '../../check/store';
import type { Artifact, Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { BrowserTiles } from '../check/BrowserTiles';
import { InlineText } from '../check/CheckScreen';
import '../check/Check.css';
import './ProjectConversation.css';

type Navigate = (screen: Screen) => void;
type Pending = { text: string; base: (AutoTestRef & { name: string }) | null } | { rerun: Array<AutoTestRef & { name: string }> };

const POLL_MS = 2000;
const IDLE_POLL_MS = 15000;

/** Plain-language steps from a test goal (one per line or sentence). */
export function goalSteps(goal: string): string[] {
  const lines = goal.split(/\n+/).map(line => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
  const steps = lines.length > 1 ? lines : goal.split(/(?<=[.!?])\s+(?=[A-Z"“])/).map(step => step.trim()).filter(Boolean);
  return steps.slice(0, 15);
}

/** What the page must show for the test to pass, in words. */
export function checkSentence(check: { kind: string; description: string; expected?: unknown; selector?: string }): string {
  const expected = typeof check.expected === 'string' ? check.expected : '';
  if (check.kind === 'visible_text' && expected) return `The page shows “${expected}”`;
  if (check.kind === 'url' && expected) { try { const url = new URL(expected); return `The address is ${url.pathname}${url.search}`; } catch { return `The address is ${expected}`; } }
  if (check.kind === 'field_value' && expected) return `${check.description}: “${expected}”`;
  return check.description;
}

/** Lines added and removed between a saved test and its revision. */
export function testChanges(base: AutoTestPreset, next: AutoTestEntry): { added: string[]; removed: string[] } {
  const lines = (test: { goal: string; checks: AutoTestPreset['checks'] }) => [...goalSteps(test.goal), ...test.checks.map(check => `Passes only if: ${checkSentence(check)}`)];
  const before = lines(base); const after = lines(next);
  return { added: after.filter(line => !before.includes(line)), removed: before.filter(line => !after.includes(line)) };
}

/** One readable line for a stopped session; raw tool output stays out of the conversation. */
export function friendlyError(message: string): string {
  if (/Executable doesn't exist|playwright install/i.test(message)) return 'The test browser is not installed on this computer. Run “pnpm exec playwright install chromium” in the sidecar folder, then try again.';
  const first = message.split(/\n/)[0].replace(/^[\w.]+: /, '').trim();
  return first.length > 300 ? `${first.slice(0, 297)}…` : first || 'The test stopped before it finished.';
}

function conversational(session: AutoTestSession) {
  return !!session.request || session.planning === false;
}

/** The plain result sentence for one finished test, from its saved verdict and checks only. */
export function resultSentence(test: AutoTestEntry): string {
  if (test.state === 'passed') return `“${test.name}” passed.`;
  if (test.state === 'failed') {
    const problem = browserProblem(test);
    const first = problem.browserChecks?.[0];
    const expected = test.checks[0] ? checkSentence(test.checks[0]).replace(/^The page shows /, 'the page to show ') : first?.expected ?? 'the expected result';
    return `“${test.name}” found a problem. I expected ${expected.charAt(0).toLowerCase()}${expected.slice(1)}, but ${first && first.observed !== 'This was not shown on the page.' ? `the page showed “${first.observed}”` : 'it was not shown on the page'}.`;
  }
  if (test.state === 'uncertain') return `“${test.name}” finished, but the result was unclear.`;
  if (test.state === 'cancelled') return `“${test.name}” was stopped.`;
  return `“${test.name}” could not run.${test.reason ? ` ${test.reason}` : ''}`;
}

function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** "1 min 05 s" from milliseconds. */
export function workedFor(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes}m ${String(total % 60).padStart(2, '0')}s` : `${total}s`;
}

type Activity = { id: string; summary: string; icon: typeof Check; running: boolean; details: Array<{ icon?: typeof Check; num?: number; text: React.ReactNode }>; live?: boolean; test?: AutoTestEntry };

const joinList = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** High-level activity lines for one turn, each with its detailed rows (Codex-style). Built only from the saved session. */
export function turnActivities(session: AutoTestSession): Activity[] {
  const active = isActive(session);
  const prep: Activity['details'] = [];
  const done: string[] = [];
  if (session.repository) {
    prep.push({ icon: FileText, text: `Read ${session.repository.files} file${session.repository.files === 1 ? '' : 's'}: ${session.repository.routes} route${session.repository.routes === 1 ? '' : 's'}, ${session.repository.forms} form${session.repository.forms === 1 ? '' : 's'}${session.repository.requirements ? ', and the requirements' : ''}` });
    done.push('read the project');
  }
  if (session.launch?.url) {
    prep.push({ icon: Globe, text: <>Started the app with <span className="ck-mono">{session.launch.label}</span> at <span className="ck-mono">{session.launch.url}</span></> });
    done.push('started the app');
  }
  if (session.exploration) {
    for (const page of session.exploration.pages.slice(0, 8)) prep.push({ icon: Search, text: <>Looked at <span className="ck-mono">{page.path}</span>: {page.controls} control{page.controls === 1 ? '' : 's'}</> });
    done.push(`looked at ${session.exploration.pages.length} page${session.exploration.pages.length === 1 ? '' : 's'}`);
  }
  if (session.tests.length && session.planning !== false) {
    for (const test of session.tests) prep.push({ icon: Pencil, text: <>Wrote <b>{test.name}</b></> });
    done.push(`wrote ${session.tests.length} test${session.tests.length === 1 ? '' : 's'}`);
  }
  if (session.planning === false && session.tests.length) done.push(`loaded ${session.tests.length} saved test${session.tests.length === 1 ? '' : 's'}`);
  for (const item of session.dropped) prep.push({ icon: Info, text: `Left out “${item.name}”: ${item.reason}` });
  const preparing = active && ['reading', 'starting', 'exploring', 'planning'].includes(session.stage);
  const activities: Activity[] = [];
  if (prep.length || preparing) {
    const summary = done.length ? joinList(done).replace(/^./, letter => letter.toUpperCase()) : stageHeadline(session);
    activities.push({ id: 'prep', summary: preparing && done.length ? `${summary} · ${stageHeadline(session).toLowerCase()}` : summary, icon: Wrench, running: preparing, details: prep });
  }
  for (const test of session.tests) {
    const running = test.state === 'running';
    if (test.state === 'queued' && !active) continue;
    activities.push({
      id: test.id, test, icon: MonitorCheck, running: running || (active && test.state === 'queued'), live: running,
      summary: running ? `Testing ${test.name} in the browser` : test.state === 'queued' ? `Waiting to test ${test.name}` : `Tested ${test.name} in the browser`,
      details: [
        ...goalSteps(test.goal).map((step, index) => ({ num: index + 1, text: <InlineText text={step} /> })),
        ...test.checks.map(check => ({ icon: Check, text: `Passes only if ${checkSentence(check).charAt(0).toLowerCase()}${checkSentence(check).slice(1)}` })),
      ],
    });
  }
  return activities;
}

function ActivityLine({ activity, session }: { activity: Activity; session: AutoTestSession }) {
  const [open, setOpen] = useState(false);
  const failed = activity.test?.state === 'failed';
  return (
    <div className="pc-activity">
      <button type="button" className="pc-activity-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {activity.running ? <Icon icon={LoaderCircle} className="ci-spin" /> : <Icon icon={failed ? TriangleAlert : activity.icon} shape={failed ? 'triangle' : undefined} className={failed ? 'pc-bad' : ''} />}
        <span>{activity.summary}</span>
        <Icon icon={open ? ChevronDown : ChevronRight} className="pc-run-chevron" />
      </button>
      {open && activity.details.length > 0 && (
        <ul className="pc-activity-detail">{activity.details.map((row, index) => <li key={index}>{row.icon ? <Icon icon={row.icon} /> : <span className="pc-step-n">{row.num}.</span>}<span>{row.text}</span></li>)}</ul>
      )}
      {activity.live && <div className="pc-mini"><BrowserTiles session={session} compact /></div>}
    </div>
  );
}

/** Icon-only action with a tooltip and an accessible name (user request, 14 Nov 2026). */
function IconAction({ icon, label, onClick, shape, pressed }: { icon: typeof Check; label: string; onClick(): void; shape?: 'play' | 'triangle'; pressed?: boolean }) {
  return (
    <button type="button" className={`pc-icon-action${pressed ? ' is-on' : ''}`} onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}>
      <Icon icon={icon} shape={shape} />
    </button>
  );
}

function SessionTurn({ session, projectId, prefs, onChange, onRerun, onCancel, onNavigate }: {
  session: AutoTestSession; projectId: string; prefs: ReturnType<typeof useProjectPrefs>;
  onChange(ref: AutoTestRef & { name: string }): void; onRerun(ref: AutoTestRef & { name: string }): void; onCancel(id: string): void; onNavigate: Navigate;
}) {
  const active = isActive(session);
  const now = useTicker(active);
  const [workOpen, setWorkOpen] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const userText = session.request?.text ?? `Run again: ${(session.presets ?? []).map(preset => preset.name).join(', ')}`;
  const base = session.request?.base ?? null;
  const changes = base && session.tests[0] ? testChanges(base, session.tests[0]) : null;
  const opening = session.reply ?? (session.planning === false && session.tests.length ? `I'll run ${session.tests.length === 1 ? 'it' : 'them'} again.` : null);
  const activities = turnActivities(session);
  const finished = active ? [] : session.tests.filter(test => !['queued', 'running'].includes(test.state));
  const answerOnly = !active && !session.tests.length && !!session.reply;
  const elapsed = (active ? now : Date.parse(session.updatedAt)) - Date.parse(session.createdAt);
  const showWork = active || workOpen;
  const hasWork = !!opening || activities.length > 0 || !!changes;

  const work = (
    <div className="pc-work">
      {opening && !answerOnly && <p className="pc-ai-text"><InlineText text={opening} /></p>}
      {changes && (changes.added.length > 0 || changes.removed.length > 0) && (
        <ul className="pc-diff">
          {changes.removed.map(line => <li key={`-${line}`} className="is-removed"><Icon icon={X} />{line}</li>)}
          {changes.added.map(line => <li key={`+${line}`} className="is-added"><Icon icon={Plus} />{line}</li>)}
        </ul>
      )}
      {activities.map(activity => <ActivityLine key={activity.id} activity={activity} session={session} />)}
    </div>
  );

  return (
    <>
      <div className="pc-msg is-me">
        {base && <span className="pc-about"><Icon icon={Pencil} />About “{base.name}”</span>}
        {userText}
      </div>
      <section className="pc-turn" aria-label="Centinel's reply">
        {hasWork && !answerOnly && (
          <>
            <button type="button" className="pc-worked" aria-expanded={showWork} disabled={active} onClick={() => setWorkOpen(value => !value)}>
              {active && <Icon icon={LoaderCircle} className="ci-spin" />}
              <span>{active ? `Working · ${workedFor(elapsed)}` : `Worked for ${workedFor(elapsed)}`}</span>
              {!active && <Icon icon={workOpen ? ChevronDown : ChevronRight} />}
            </button>
            {showWork && work}
          </>
        )}
        {active && <button type="button" className="ck-link pc-stop" onClick={() => onCancel(session.id)}><Icon icon={X} />Stop</button>}
        {answerOnly && <p className="pc-ai-text"><InlineText text={session.reply!} /></p>}
        {finished.map(test => (
          <p key={test.id} className={`pc-ai-text pc-result-text${test.state === 'failed' ? ' is-fail' : ''}`}>
            {test.state === 'passed' ? <Icon icon={Check} /> : test.state === 'failed' ? <Icon icon={TriangleAlert} shape="triangle" /> : <Icon icon={Info} />}
            <span>{resultSentence(test)}</span>
          </p>
        ))}
        {session.stage === 'failed' && session.error && <p className="pc-ai-text pc-error"><Icon icon={TriangleAlert} shape="triangle" /><span>{friendlyError(session.error.message)}</span></p>}
        {session.stage === 'cancelled' && !finished.length && <p className="pc-ai-text pc-sub"><Icon icon={Info} />Stopped.</p>}
        {session.dropped.length > 0 && !active && !session.tests.length && !session.reply && <p className="pc-ai-text pc-sub"><Icon icon={Info} />The proposed test was left out because Centinel could not check it safely.</p>}
      </section>
      {finished.map(test => {
        const ref = { sessionId: session.id, testId: test.id, name: test.name };
        const pinned = isPinned(prefs, ref);
        const reusable = !!test.controls?.length;
        if (!test.runId && !reusable) return null;
        return (
          <div key={test.id} className="pc-actions pc-turn-actions" role="group" aria-label={`Actions for ${test.name}`}>
            {test.runId && <IconAction icon={Play} shape="play" label="Replay" onClick={() => onNavigate({ name: 'dynamic-testing', projectId, runId: test.runId })} />}
            {reusable && <IconAction icon={RotateCcw} label="Run again" onClick={() => onRerun(ref)} />}
            {reusable && !pinned && <IconAction icon={Bookmark} label="Save for every check" onClick={() => { pinTest(projectId, { ...ref, pinnedAt: new Date().toISOString() }); setJustSaved(test.id); }} />}
            {pinned && <IconAction icon={BookmarkCheck} pressed label="Saved for every check. Select to stop running it in every check" onClick={() => { unpinTest(projectId, ref); setJustSaved(null); }} />}
            {reusable && <IconAction icon={Pencil} label="Change it" onClick={() => onChange(ref)} />}
            {pinned && justSaved === test.id && <span className="pc-done">Saved for every check <button type="button" className="ck-link" onClick={() => { unpinTest(projectId, ref); setJustSaved(null); }}><Icon icon={Undo2} />Undo</button></span>}
          </div>
        );
      })}
    </>
  );
}

const RISK_ICON: Record<string, { icon: typeof Check; shape?: 'triangle'; className: string }> = {
  critical: { icon: OctagonAlert, className: 'pc-risk-critical' },
  high: { icon: TriangleAlert, shape: 'triangle', className: 'pc-risk-high' },
  medium: { icon: TriangleAlert, shape: 'triangle', className: 'pc-risk-medium' },
  low: { icon: Info, className: 'pc-risk-low' },
};

const DAY = { day: 'numeric', month: 'short' } as const;

/**
 * The project side panel (DESIGN.md §4.4, 14 Nov 2026). Collapsed it is a narrow
 * column with the latest check: the problem count, three numbers and its problems.
 * Expanded it grows over the whole conversation area and adds everything the
 * project holds: requirements, browser tests, sources, saved tests, how it is
 * tested, checks, the report and the full result. Everything is read from saved
 * records; whether it is open is kept on this device.
 */
function ProjectSidePanel({ project, latest, onOpen, open, onToggle, documents, codeFiles, pinned, lastStateOf, mode, accountGiven, checks, onNavigate }: {
  project: Project; latest: LatestResult; onOpen(): void; open: boolean; onToggle(): void;
  documents: Artifact[]; codeFiles: number; pinned: ReturnType<typeof useProjectPrefs>['pinned'];
  lastStateOf(ref: AutoTestRef): string | undefined; mode: PermissionMode; accountGiven: boolean;
  checks: ReturnType<typeof useChecks>; onNavigate: Navigate;
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
  const hasFolder = !!project.workspacePath;
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

  const latestLabel = `Latest check${latest.at ? ` · ${new Date(latest.at).toLocaleDateString(undefined, DAY)}` : ''}`;
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

export function ProjectConversationScreen({ project, projects, onNavigate }: { project: Project; projects: Project[]; onNavigate: Navigate }) {
  const prefs = useProjectPrefs(project.id);
  const checks = useChecks().filter(check => check.projectId === project.id);
  const [sessions, setSessions] = useState<AutoTestSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [text, setText] = useState('');
  const [base, setBase] = useState<(AutoTestRef & { name: string }) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const hasFolder = !!project.workspacePath;

  const refresh = useCallback(async () => {
    try {
      const list = await api.autoTests(project.id);
      setSessions(list);
      setError(null);
    } catch (cause) {
      setError(userFacingError(cause, 'The conversation could not be loaded. It will try again.'));
    } finally {
      setLoaded(true);
    }
  }, [project.id]);

  const anyActive = sessions.some(isActive);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { await refresh(); if (active) timer = setTimeout(tick, anyActive ? POLL_MS : IDLE_POLL_MS); };
    void tick();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh, anyActive]);

  useEffect(() => {
    api.listArtifacts(project.id).then(setArtifacts).catch(() => undefined);
  }, [project.id]);

  const timeline = useMemo(() => {
    const turns = sessions.filter(conversational).map(session => ({ at: session.createdAt, key: `s:${session.id}`, session }));
    const notes = prefs.notes.map(note => ({ at: note.at, key: `n:${note.id}`, note }));
    return [...turns, ...notes].sort((a, b) => a.at.localeCompare(b.at));
  }, [sessions, prefs.notes]);
  const last = timeline[timeline.length - 1];
  // Follow the newest reply as it grows (stage, tests and their results), not only new messages.
  const lastSignature = last ? `${last.key}:${'session' in last ? `${last.session.stage}:${last.session.reply ?? ''}:${last.session.tests.map(test => test.state).join(',')}` : ''}` : '';
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end', inline: 'nearest' }); }, [lastSignature, pending]);

  const launch = async (job: Pending) => {
    setSending(true);
    setError(null);
    try {
      const session = 'rerun' in job
        ? await api.startAutoTest(project.id, { rerun: job.rerun.map(({ sessionId, testId }) => ({ sessionId, testId })), lanes: 1 })
        : await api.startAutoTest(project.id, { request: job.text, ...(job.base ? { base: { sessionId: job.base.sessionId, testId: job.base.testId } } : {}), lanes: 1 });
      setSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
    } catch (cause) {
      addNote(project.id, userFacingError(cause, 'Centinel could not start that. Try again.'));
    } finally {
      setSending(false);
    }
  };

  const submit = (job: Pending) => {
    if (!hasFolder) {
      addNote(project.id, 'Browser tests need the project folder on this computer, and this project only has a GitHub link. Add the folder from Start to test it here.');
      return;
    }
    if (prefs.mode === 'ask') { setPending(job); return; }
    void launch(job);
  };

  const send = () => {
    const value = text.trim();
    if (!value || sending) return;
    if (looksLikeAccount(value) && !prefs.accountReminderShown) {
      updatePrefs(project.id, current => ({ ...current, accountReminderShown: true }));
      addNote(project.id, 'The AI will see this account. Use test accounts only.');
    }
    submit({ text: value, base });
    setText('');
    setBase(null);
  };

  const runFullCheck = () => {
    if (!project.workspacePath) return;
    const check = startCheck({ folder: project.workspacePath, documents: [], focus: '', mode: 'both' }, { api, projects: () => projects });
    onNavigate({ name: 'check', checkId: check.id });
  };

  const latest = useLatestResult(project.id, sessions);
  const sideOpen = prefs.sideOpen;
  useEffect(() => {
    if (!sideOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setSideOpen(project.id, false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [sideOpen, project.id]);
  const openLatest = () => {
    const local = latest.review ? checks.find(check => check.reviewId === latest.review!.id) : checks[0];
    if (local) onNavigate({ name: 'check', checkId: local.id });
    else if (latest.review) onNavigate({ name: 'review-activity', projectId: project.id, sessionId: latest.review.id });
    else onNavigate({ name: 'dynamic-testing', projectId: project.id });
  };
  const latestCheck = checks[0];
  const documents = artifacts.filter(artifact => artifact.source === 'documents');
  const codeFiles = artifacts.filter(artifact => artifact.source === 'repository').length;
  const lastStateOf = (ref: AutoTestRef) => sessions.find(session => session.id === ref.sessionId)?.tests.find(test => test.id === ref.testId)?.state;

  return (
    <div className="ck-screen pc-screen">
      <div className="ck-glow is-low" aria-hidden="true" />
      <div className={`pc-layout${prefs.sideOpen ? ' is-side-open' : ''}`}>
        {/* While the panel covers the conversation, the conversation cannot be reached. */}
        <section className="pc-main" aria-label={`Conversation about ${project.name}`} aria-hidden={prefs.sideOpen || undefined} {...(prefs.sideOpen ? { inert: '' } : {})}>
          <header className="pc-head">
            <div>
              <p className="pc-kicker">Project</p>
              <h1 className="ck-title">{project.name}</h1>
            </div>
            <button type="button" className="ck-button" onClick={runFullCheck} disabled={!hasFolder} title={hasFolder ? 'Review the code and test in a browser' : 'This project has no folder on this computer'}><Icon icon={Play} shape="play" />Run a full check</button>
          </header>

          <div className="pc-thread" aria-live="polite">
            <div className="pc-turn pc-ai-text pc-intro">
              <span>{latestCheck
                ? latestCheck.phase === 'done'
                  ? <>The last check found {latestCheck.problemCount ? `${latestCheck.problemCount} problem${latestCheck.problemCount === 1 ? '' : 's'}` : 'no problems'}. <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: latestCheck.id })}>Open the result</button></>
                  : <>A check is {latestCheck.phase === 'failed' ? 'saved but did not start' : 'running'}. <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: latestCheck.id })}>Open it</button></>
                : 'No check has run on this computer yet.'}
              {' '}Ask me to test something, for example “Test that a wrong password shows an error”.</span>
            </div>
            {!loaded && <p className="pc-sub"><Icon icon={LoaderCircle} className="ci-spin" />Loading the conversation…</p>}
            {timeline.map(item => 'session' in item
              ? <SessionTurn key={item.key} session={item.session} projectId={project.id} prefs={prefs} onNavigate={onNavigate}
                  onChange={ref => { setBase(ref); inputRef.current?.focus(); }}
                  onRerun={ref => submit({ rerun: [ref] })}
                  onCancel={id => { void api.cancelAutoTest(project.id, id).then(() => refresh()).catch(() => undefined); }} />
              : <p key={item.key} className="pc-note"><Icon icon={Info} />{item.note.text}</p>)}
            {pending && <div className="pc-msg is-me">{'rerun' in pending ? `Run again: ${pending.rerun.map(item => item.name).join(', ')}` : pending.text}</div>}
            {pending && (
              <div className="pc-turn">
                <div className="pc-card">
                  <p className="pc-card-title"><Icon icon={ShieldCheck} />Ask first is on</p>
                  <p className="pc-sub">{'rerun' in pending ? `Centinel will start the app and run “${pending.rerun.map(item => item.name).join('”, “')}”.` : `Centinel will start the app, write ${pending.base ? `a new version of “${pending.base.name}”` : 'a test'} for “${pending.text}” and run it.`}</p>
                  <div className="pc-actions">
                    <button type="button" className="ck-button is-small is-primary" onClick={() => { const job = pending; setPending(null); void launch(job); }}><Icon icon={Play} shape="play" />Go ahead</button>
                    <button type="button" className="ck-button is-small" onClick={() => setPending(null)}><Icon icon={X} />Cancel</button>
                  </div>
                </div>
              </div>
            )}
            {error && <p className="pc-note"><Icon icon={Info} />{error}</p>}
            <div ref={endRef} />
          </div>

          <form className="pc-composer" onSubmit={event => { event.preventDefault(); send(); }}>
            {base && <span className="ck-chip is-project pc-base"><Icon icon={Pencil} /><span>Changing “{base.name}”</span><button type="button" onClick={() => setBase(null)} aria-label="Stop changing this test"><Icon icon={X} /></button></span>}
            <label className="ck-visually-hidden" htmlFor="pc-input">Message to Centinel</label>
            <textarea id="pc-input" ref={inputRef} rows={2} maxLength={2000} value={text} onChange={event => setText(event.target.value)}
              placeholder={base ? 'How should this test change?' : 'Ask Centinel to test or change something'}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
            <div className="pc-composer-row">
              <div className="pc-mode">
                <button type="button" className="ck-button is-small" aria-haspopup="listbox" aria-expanded={modeOpen} onClick={() => setModeOpen(value => !value)} aria-label={`Permission mode: ${MODE_LABEL[prefs.mode]}`}>
                  <Icon icon={ShieldCheck} />{MODE_LABEL[prefs.mode]}
                </button>
                {modeOpen && (
                  <ul className="ck-menu pc-mode-menu" role="listbox" aria-label="Permission mode">
                    {([['ask', 'Asks before running or changing anything'], ['auto', 'Runs and saves tests; asks before changing settings'], ['bypass', 'Does everything except deleting']] as Array<[PermissionMode, string]>).map(([mode, hint]) => (
                      <li key={mode} role="option" aria-selected={prefs.mode === mode}>
                        <button type="button" onClick={() => { setMode(project.id, mode); setModeOpen(false); }}>
                          {prefs.mode === mode ? <Icon icon={Check} /> : <span className="pc-mode-space" />}
                          <span><b>{MODE_LABEL[mode]}</b><small>{hint}</small></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="submit" className="ck-round is-go" aria-label="Send" disabled={sending || !text.trim()}><ArrowUp size={18} strokeWidth={2} aria-hidden="true" /></button>
            </div>
          </form>
        </section>

        <div className="pc-side-slot" aria-hidden="true" />
        <ProjectSidePanel project={project} latest={latest} onOpen={openLatest} open={prefs.sideOpen} onToggle={() => setSideOpen(project.id, !prefs.sideOpen)}
          documents={documents} codeFiles={codeFiles} pinned={prefs.pinned} lastStateOf={lastStateOf} mode={prefs.mode}
          accountGiven={prefs.accountReminderShown} checks={checks} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
