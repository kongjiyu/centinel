import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, Check, ChevronDown, ChevronRight, RotateCcw, Search, Wrench, FileText, Globe, Info, LoaderCircle, MonitorCheck, Pencil, Play, Plus, Save, ShieldCheck, TriangleAlert, Undo2, X } from 'lucide-react';
import { api } from '../../api/client';
import type { AutoTestEntry, AutoTestPreset, AutoTestRef, AutoTestSession } from '../../autotest/types';
import { isActive } from '../../autotest/types';
import { stageHeadline } from '../../autotest/presentation';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { browserProblem } from '../../check/result';
import { addNote, isPinned, looksLikeAccount, pinTest, setMode, setSideOpen, unpinTest, updatePrefs, useProjectPrefs } from '../../check/projectPrefs';
import { useLatestResult } from '../../check/latestResult';
import { startCheck } from '../../check/runner';
import { useChecks } from '../../check/store';
import { type CheckMode, type StartCheckInput } from '../../check/types';
import { projectLocalFolder } from '../../check/projectWorkspace';
import type { Artifact, Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { BrowserTiles } from '../check/BrowserTiles';
import { InlineText } from '../check/CheckScreen';
import '../check/Check.css';
import { CheckActionLabel, CheckFollowUp, CheckProjectHeader, CheckProjectLayout } from '../check/CheckProjectWorkspace';
import { useCheckLibrary } from '../check/CheckSourceLibrary';
import { ProjectSidePanel } from './ProjectSidePanel';
import { ProjectCheckCard } from './ProjectCheckCard';
import { ConversationTurn } from './ConversationTurn';
import { useConversationRequests } from '../../check/conversation';
import { consumeConversationReturn, rememberProjectPosition, restoreProjectPosition } from '../../check/projectNavigation';
import './ProjectConversation.css';

type Navigate = (screen: Screen) => void;
type Pending = { text: string; base: (AutoTestRef & { name: string }) | null; checkMode?: CheckMode; checkInput?: StartCheckInput } | { rerun: Array<AutoTestRef & { name: string }> };

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
      <section className="pc-turn" aria-label="ORIN's reply">
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
        {session.dropped.length > 0 && !active && !session.tests.length && !session.reply && <p className="pc-ai-text pc-sub"><Icon icon={Info} />The proposed test was left out because ORIN could not check it safely.</p>}
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

export function ProjectConversationScreen({ project, projects, onNavigate }: { project: Project; projects: Project[]; onNavigate: Navigate }) {
  const prefs = useProjectPrefs(project.id);
  const checks = useChecks().filter(check => check.projectId === project.id);
  const conversationRequests = useConversationRequests(project.id, project.name);
  const [sessions, setSessions] = useState<AutoTestSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [base, setBase] = useState<(AutoTestRef & { name: string }) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveAttention, setDriveAttention] = useState<{ projectId: string; status: string } | null>(null);
  useEffect(() => {
    let current = true;
    void api.getConnectedSourceStatus('google_drive', project.id).then(connection => {
      if (!current || connection.connected || !connection.sources.some(source => source.status !== 'removed')) return;
      setDriveAttention({ projectId: project.id, status: connection.status });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [project.id]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const initializedScroll = useRef(false);
  const hasFolder = !!projectLocalFolder(project);

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
    const turns = sessions.filter(session => conversational(session) && !checks.some(check => check.autoTestId === session.id)).map(session => ({ at: session.createdAt, key: `s:${session.id}`, session }));
    const notes = prefs.notes.map(note => ({ at: note.at, key: `n:${note.id}`, note }));
    const cards = checks.map(check => ({ at: check.createdAt, key: 'c:' + check.id, check }));
    const requests = conversationRequests.records.map(request => ({ at: request.createdAt, key: 'r:' + request.id, request }));
    return [...turns, ...notes, ...cards, ...requests].sort((a, b) => a.at.localeCompare(b.at));
  }, [sessions, prefs.notes, checks, conversationRequests.records]);
  const last = timeline[timeline.length - 1];
  // Follow the newest reply as it grows (stage, tests and their results), not only new messages.
  const lastSignature = last ? `${last.key}:${'session' in last ? `${last.session.stage}:${last.session.reply ?? ''}:${last.session.tests.map(test => test.state).join(',')}` : ''}` : '';
  useEffect(() => {
    if (!loaded || !conversationRequests.loaded) return;
    if (!initializedScroll.current) {
      initializedScroll.current = true;
      restoreProjectPosition(project.id, endRef.current);
      if (consumeConversationReturn(project.id)) {
        inputRef.current?.focus({ preventScroll: true });
      } else {
        return;
      }
    }
    endRef.current?.scrollIntoView?.({ block: 'end', inline: 'nearest' });
  }, [loaded, conversationRequests.loaded, lastSignature, pending, project.id]);
  useEffect(() => {
    const element = endRef.current;
    return () => rememberProjectPosition(project.id, element);
  }, [project.id]);

  const launch = async (job: Pending) => {
    if ('checkInput' in job && job.checkInput) {
      startCheck(job.checkInput, { api, projects: () => projects });
      return;
    }
    setSending(true);
    setError(null);
    try {
      const session = 'rerun' in job
        ? await api.startAutoTest(project.id, { rerun: job.rerun.map(({ sessionId, testId }) => ({ sessionId, testId })), lanes: 1 })
        : await api.startAutoTest(project.id, { request: job.text, ...(job.base ? { base: { sessionId: job.base.sessionId, testId: job.base.testId } } : {}), lanes: 1 });
      setSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
    } catch (cause) {
      addNote(project.id, userFacingError(cause, 'ORIN could not start that. Try again.'));
    } finally {
      setSending(false);
    }
  };

  const submit = (job: Pending) => {
    if (!hasFolder && (!('checkMode' in job) || job.checkMode !== 'code')) {
      addNote(project.id, 'Browser tests need the project folder on this computer, and this project only has a GitHub link. Add the folder from Start to test it here.');
      return;
    }
    if (prefs.mode === 'ask') { setPending(job); return; }
    void launch(job);
  };

  const send = (request: StartCheckInput) => {
    if (looksLikeAccount(request.focus) && !prefs.accountReminderShown) {
      updatePrefs(project.id, current => ({ ...current, accountReminderShown: true }));
      addNote(project.id, 'The AI will see this account. Use test accounts only.');
    }
    const hasAttachments = request.documents.length || request.referenceCheckIds?.length || request.sourceArtifactIds?.length;
    submit({ text: request.focus, base, checkMode: request.mode,
      checkInput: !base && (request.mode !== 'browser' || hasAttachments) ? request : undefined });
    setBase(null);
  };

  const runFullCheck = () => {
    if (!hasFolder) return;
    startCheck({ projectId: project.id, documents: [], focus: '', mode: 'both' }, { api, projects: () => projects });
  };

  const latest = useLatestResult(project.id, sessions);
  const [sideChoice, setSideChoice] = useState<boolean | null>(null);
  const sideOpen = sideChoice ?? false;
  const toggleSide = (open: boolean) => { setSideChoice(open); setSideOpen(project.id, open); };
  const library = useCheckLibrary(project.id);
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

  return <>
    <Modal isOpen={driveAttention?.projectId === project.id} title="Google Drive needs attention"
      onClose={() => setDriveAttention(null)}
      footer={<>
        <button type="button" className="btn-primary" onClick={() => { setDriveAttention(null); onNavigate({ name: 'settings', section: 'connections' }); }}>
          Open connections
        </button>
        <button type="button" className="btn-secondary" onClick={() => setDriveAttention(null)}>Dismiss</button>
      </>}>
      <p>{driveAttention?.status === 'expired'
        ? 'The Google Drive connection has expired. Reconnect it to sync this project’s Drive sources.'
        : 'This project’s Google Drive sources cannot sync. Connect Google Drive in ORIN to resume syncing.'}</p>
    </Modal>
    <CheckProjectLayout projectHeader expanded={sideOpen} onCloseSidebar={() => toggleSide(false)}
    composer={<CheckFollowUp key={project.id} check={{ id: '', projectId: project.id, mode: 'browser' }} projects={projects}
      onNavigate={onNavigate} available library={library} conversation={{
        editing: base && <span className="ck-chip is-project pc-base"><Icon icon={Pencil} /><span>Changing “{base.name}”</span><button type="button" onClick={() => setBase(null)} aria-label="Stop changing this test"><Icon icon={X} /></button></span>,
        inputRef, sending, send, onFocus: () => setSideChoice(false),
        placeholder: base ? 'How should this test change?' : 'Ask ORIN to test or change something',
        setPermission: mode => setMode(project.id, mode),
      }} />}
    sidebar={<ProjectSidePanel project={project} latest={latest} onOpen={openLatest} open={sideOpen} onToggle={() => toggleSide(!sideOpen)}
      documents={documents} codeFiles={codeFiles} pinned={prefs.pinned} lastStateOf={lastStateOf} mode={prefs.mode}
      accountGiven={prefs.accountReminderShown} checks={checks} onNavigate={onNavigate} />}>
      <div className="ck-screen"><section className="ck-panel pc-response" aria-label={`Conversation about ${project.name}`}>
          <CheckProjectHeader check={{ projectId: project.id, projectName: project.name }} project={project} onNavigate={onNavigate} library={library}
            projectAction={<button type="button" className="ck-toolbar-item" data-default onClick={runFullCheck} disabled={!hasFolder} aria-label="Run a full check"
              title={hasFolder ? 'Run a full check' : 'This project has no folder on this computer'}><Icon icon={Play} shape="play" /><CheckActionLabel>Run a full check</CheckActionLabel></button>} />

          <div className="pc-thread" aria-live="polite">
            {loaded && conversationRequests.loaded && !checks.length && <div className="pc-turn pc-ai-text pc-intro">
              <span>{latestCheck
                ? latestCheck.phase === 'done'
                  ? <>The last check found {latestCheck.problemCount ? `${latestCheck.problemCount} problem${latestCheck.problemCount === 1 ? '' : 's'}` : 'no problems'}. <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: latestCheck.id })}>Open the result</button></>
                  : <>A check is {latestCheck.phase === 'failed' ? 'saved but did not start' : 'running'}. <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: latestCheck.id })}>Open it</button></>
                : 'No check has run on this computer yet.'}
              {' '}Ask me to test something, for example “Test that a wrong password shows an error”.</span>
            </div>}
            {(!loaded || !conversationRequests.loaded) && !error && !conversationRequests.error && !timeline.length && <LoadingSkeleton className="pc-conversation-skeleton" label="Loading the conversation" />}
            {conversationRequests.error && <p role="status">{conversationRequests.error}</p>}
            {timeline.map(item => 'check' in item ? <div className="pc-turn" key={item.key}>
                {item.check.focus && !item.check.id.startsWith('request-') && <p className="pc-msg is-me">{item.check.focus}</p>}
                <ProjectCheckCard check={item.check} onNavigate={onNavigate} />
              </div>
              : 'request' in item ? <ConversationTurn key={item.key} request={item.request} onNavigate={onNavigate} />
              : 'session' in item
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
                  <p className="pc-sub">{'rerun' in pending ? `ORIN will start the app and run “${pending.rerun.map(item => item.name).join('”, “')}”.` : `ORIN will start the app, write ${pending.base ? `a new version of “${pending.base.name}”` : 'a test'} for “${pending.text}” and run it.`}</p>
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

      </section></div>
  </CheckProjectLayout>
  </>;
}
