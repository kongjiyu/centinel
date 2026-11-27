import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Check, ChevronDown, ChevronRight, Copy, RotateCcw, Info, LoaderCircle, Pencil, Play, Plus, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { api } from '../../api/client';
import type { AutoTestEntry, AutoTestPreset, AutoTestRef, AutoTestSession } from '../../autotest/types';
import { isActive } from '../../autotest/types';
import { stageHeadline } from '../../autotest/presentation';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { browserProblem, type CheckProblem } from '../../check/result';
import { plainReason } from '../../check/plainReason';
import { addNote, setMode, setSideOpen, useProjectPrefs } from '../../check/projectPrefs';
import { useLatestResult, type LatestResult } from '../../check/latestResult';
import { useCheckData } from '../../check/useCheckData';
import { checkName } from '../../check/checkName';
import { startCheck } from '../../check/runner';
import { saveCheck, useChecks } from '../../check/store';
import { type CheckMode, type CheckRecord, type StartCheckInput } from '../../check/types';
import { projectLocalFolder } from '../../check/projectWorkspace';
import type { Artifact, Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { StartupQuestionDialog } from '../check/StartupQuestionDialog';
import { InlineText } from '../check/CheckScreen';
import '../check/Check.css';
import { CheckActionLabel, CheckFollowUp, CheckProjectHeader, CheckProjectLayout } from '../check/CheckProjectWorkspace';
import { useCheckLibrary } from '../check/CheckSourceLibrary';
import { ProjectSidePanel } from './ProjectSidePanel';
import { ProjectCheckCard } from './ProjectCheckCard';
import { ConversationTurn } from './ConversationTurn';
import { BrowserWorkSection } from './CheckWorkActivity';
import { ConversationMessage, copyConversationText, MessageTime } from './ConversationMessage';
import { eligibleReplySource, type ProblemAttachment, readConversationDraft, rememberAcknowledgedRequest, replyExcerpt, conversationQuestionOptions, useConversationRequests, writeConversationDraft } from '../../check/conversation';
import type { ConversationRequest } from '../../check/conversationTypes';
import { ConversationQuestion } from './ConversationQuestion';
import { consumeConversationReturn } from '../../check/projectNavigation';
import './ProjectConversation.css';

type Navigate = (screen: Screen) => void;
type Pending = { text: string; base: (AutoTestRef & { name: string }) | null; checkMode?: CheckMode; checkInput?: StartCheckInput } | { rerun: Array<AutoTestRef & { name: string }> };
type PendingConversationQuestion = { request: ConversationRequest; question?: NonNullable<ConversationRequest['questions']>[number]; options?: string[]; at: string };

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
  const first = (plainReason(message) ?? '').split(/\n/)[0].replace(/^[\w.]+: /, '').trim();
  return first.length > 300 ? `${first.slice(0, 297)}…` : first || 'The test stopped before it finished.';
}

function conversational(session: AutoTestSession) {
  return !!session.request || session.planning === false;
}

const browserTurnCheckId = (session: AutoTestSession) => 'browser-turn-' + session.id;

function browserTurnCheck(session: AutoTestSession, projectName: string): CheckRecord {
  return { id: browserTurnCheckId(session), projectId: session.projectId, projectName, autoTestId: session.id,
    mode: 'browser', phase: 'running', title: session.tests.length === 1 ? session.tests[0].name : 'Browser check',
    createdAt: session.createdAt, updatedAt: session.updatedAt, documents: [], notes: [], focus: '' };
}

/** The plain result sentence for one finished test, from its saved verdict and checks only. */
export function resultSentence(test: AutoTestEntry): string {
  if (test.state === 'passed') return `I verified “${test.name}” in the browser.`;
  if (test.state === 'failed') {
    const problem = browserProblem(test);
    const failed = test.checkResults?.find(result => result.verdict === 'failed');
    const definition = test.checks.find(check => check.id === failed?.checkId);
    const outcome = problem.browserChecks?.[0];
    if (!failed || !outcome) return `I found a problem in “${test.name}”. The expected and observed outcomes are unavailable.`;
    const expected = (definition ? checkSentence(definition) : outcome.expected).replace(/[.!?]$/, '');
    const observation = `The browser recorded “${outcome.observed.replace(/[.!?]$/, '')}”.`;
    const expectation = definition?.kind === 'visible_text' ? `I expected the page to show “${definition.expected}”.`
      : `The expected result was “${expected}”.`;
    return `I found a problem in “${test.name}”. ${expectation} ${observation}`;
  }
  if (test.state === 'uncertain') return `“${test.name}” finished, but the result was unclear.`;
  if (test.state === 'cancelled') return `“${test.name}” was stopped.`;
  const reason = plainReason(test.reason);
  return `“${test.name}” could not run.${reason ? ` ${reason}` : ''}`;
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

/** Icon-only action with a tooltip and an accessible name (user request, 14 Nov 2026). */
function IconAction({ icon, label, onClick, shape, pressed }: { icon: typeof Check; label: string; onClick(): void; shape?: 'play' | 'triangle'; pressed?: boolean }) {
  return (
    <button type="button" className={`pc-icon-action${pressed ? ' is-on' : ''}`} onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}>
      <Icon icon={icon} shape={shape} />
    </button>
  );
}

function SessionTurn({ session, projectId, prefs, onChange, onRerun, onNavigate, card }: {
  session: AutoTestSession; projectId: string; prefs: ReturnType<typeof useProjectPrefs>;
  card?: ReactNode;
  onChange(ref: AutoTestRef & { name: string }): void; onRerun(ref: AutoTestRef & { name: string }): void; onNavigate: Navigate;
}) {
  const active = isActive(session);
  const now = useTicker(active);
  const [workOpen, setWorkOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const userText = session.request?.text ?? `Run again: ${(session.presets ?? []).map(preset => preset.name).join(', ')}`;
  const base = session.request?.base ?? null;
  const changes = base && session.tests[0] ? testChanges(base, session.tests[0]) : null;
  const opening = session.reply ?? (session.planning === false && session.tests.length ? `I'll run ${session.tests.length === 1 ? 'it' : 'them'} again.` : null);
  const finished = active ? [] : session.tests.filter(test => !['queued', 'running'].includes(test.state));
  const answerOnly = !active && !session.tests.length && !!session.reply;
  const replyText = [
    ...finished.map(resultSentence),
    ...(answerOnly ? [session.reply!] : []),
    ...(session.stage === 'failed' && session.error ? [friendlyError(session.error.message)] : []),
  ].join('\n\n');
  const elapsed = (active ? now : Date.parse(session.updatedAt)) - Date.parse(session.createdAt);
  const showWork = workOpen;
  const hasWork = active || !!opening || !!changes || !!session.repository || !!session.launch || !!session.exploration || session.tests.length > 0 || session.dropped.length > 0;
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(''), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const work = (
    <div className="pc-work">
      {opening && !answerOnly && <p className="pc-ai-text"><InlineText text={opening} /></p>}
      {changes && (changes.added.length > 0 || changes.removed.length > 0) && (
        <ul className="pc-diff">
          {changes.removed.map(line => <li key={`-${line}`} className="is-removed"><Icon icon={X} />{line}</li>)}
          {changes.added.map(line => <li key={`+${line}`} className="is-added"><Icon icon={Plus} />{line}</li>)}
        </ul>
      )}
      <BrowserWorkSection session={session} />
    </div>
  );
  const progress = hasWork && !answerOnly && <div className="pc-progress">
    <button type="button" className="pc-worked" aria-expanded={showWork} onClick={() => setWorkOpen(value => !value)}>
      {active && <Icon icon={LoaderCircle} className="ci-spin" />}
      <span>{active ? `Working for ${workedFor(elapsed)}` : `Worked for ${workedFor(elapsed)}`}</span>
      {active && <span className="pc-current-activity">{stageHeadline(session)}</span>}
      <Icon icon={workOpen ? ChevronDown : ChevronRight} />
    </button>
    {showWork && work}
  </div>;

  return (
    <>
      <ConversationMessage text={userText} at={session.createdAt}>
        {base && <span className="pc-about"><Icon icon={Pencil} />About “{base.name}”</span>}
      </ConversationMessage>
      <section className="pc-turn" aria-label="ORIN's reply">
        {progress}
        {card}
        {(finished.length > 0 || answerOnly || session.error) && <div className="pc-agent-message">
        {finished.map(test => (
          <p key={test.id} className="pc-ai-text pc-result-text">
            {test.state === 'passed' ? <Icon icon={Check} /> : test.state === 'failed' ? null : <Icon icon={Info} />}
            <span>{resultSentence(test)}</span>
          </p>
        ))}
        {answerOnly && <p className="pc-ai-text"><InlineText text={session.reply!} /></p>}
        {session.stage === 'failed' && session.error && <p className="pc-ai-text pc-error"><Icon icon={TriangleAlert} shape="triangle" /><span>{friendlyError(session.error.message)}</span></p>}
        <footer className="pc-response-actions" role="group" aria-label="Reply actions">
          <MessageTime at={session.updatedAt} />
          {!!replyText && <button type="button" className="pc-message-action" aria-label="Copy reply" title="Copy reply" onClick={() => {
            void copyConversationText(replyText).then(() => setCopyStatus('Reply copied'), () => setCopyStatus('Copy failed'));
          }}><Copy size={14} aria-hidden="true" /></button>}
          {finished.map(test => {
            const ref = { sessionId: session.id, testId: test.id, name: test.name };
            const reusable = !!test.controls && test.checks.length > 0;
            if (!test.runId && !reusable) return null;
            return <span key={test.id} className="pc-response-action-set" role="group" aria-label={`Actions for ${test.name}`}>
              {test.runId && <IconAction icon={Play} shape="play" label="Replay" onClick={() => onNavigate({ name: 'dynamic-testing', projectId, runId: test.runId })} />}
              {reusable && <IconAction icon={RotateCcw} label="Run again" onClick={() => onRerun(ref)} />}
              {reusable && <IconAction icon={Pencil} label="Change it" onClick={() => onChange(ref)} />}
            </span>;
          })}
          <span className="pc-copy-status" role="status">{copyStatus}</span>
        </footer>
        </div>}
        {session.stage === 'cancelled' && !finished.length && <p className="pc-ai-text pc-sub"><Icon icon={Info} />Stopped.</p>}
        {session.dropped.length > 0 && !active && !session.tests.length && !session.reply && <p className="pc-ai-text pc-sub"><Icon icon={Info} />The proposed test was left out because ORIN could not check it safely.</p>}
      </section>
    </>
  );
}

export function ProjectConversationScreen({ project, projects, onNavigate, pendingQuestionRequest, questionQueueReady, questionDeadlineAt, questionFocus, onQuestionAnswered }: {
  project: Project; projects: Project[]; onNavigate: Navigate;
  pendingQuestionRequest?: ConversationRequest | null; questionDeadlineAt?: number;
  questionQueueReady?: boolean;
  questionFocus?: number;
  onQuestionAnswered?: (updated: ConversationRequest) => void;
}) {
  const prefs = useProjectPrefs(project.id);
  const checks = useChecks().filter(check => check.projectId === project.id);
  const conversationRequests = useConversationRequests(project.id, project.name);
  const historyOwner = sessionStorage.getItem('centinel:supabase-user-id');
  const replySources = useMemo(() => new Map(conversationRequests.records
    .filter(request => eligibleReplySource(request, project.id, historyOwner))
    .map(request => [request.id, replyExcerpt(request)])), [conversationRequests.records, project.id, historyOwner]);
  const [replySelection, setReplySelection] = useState<{ projectId: string; ownerId: string | null; turnId: string } | null>(null);
  const clearReplySelection = useCallback(() => setReplySelection(null), []);
  const [sessions, setSessions] = useState<AutoTestSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [base, setBase] = useState<(AutoTestRef & { name: string }) | null>(null);
  const [composerVersion, setComposerVersion] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const quoteTurn = (turnId: string) => {
    setBase(null);
    setReplySelection({ projectId: project.id, ownerId: historyOwner, turnId });
  };
  const chatCardsRef = useRef<HTMLDivElement>(null);
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
  const sideOpenRef = useRef(false);
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

  const loadArtifacts = useCallback(async () => {
    try { setArtifacts(await api.listArtifacts(project.id)); } catch { /* Keep the last complete source list visible. */ }
  }, [project.id]);
  useEffect(() => { void loadArtifacts(); }, [loadArtifacts]);

  const timeline = useMemo(() => {
    const turns = sessions.filter(session => conversational(session)
      && !checks.some(check => check.autoTestId === session.id && check.id !== browserTurnCheckId(session)))
      .map(session => ({ at: session.createdAt, key: `s:${session.id}`, session,
        browserCard: session.tests.length ? checks.find(check => check.id === browserTurnCheckId(session)) ?? browserTurnCheck(session, project.name) : null }));
    const notes = prefs.notes.map(note => ({ at: note.at, key: `n:${note.id}`, note }));
    const browserCardsInTurns = new Set(turns.map(turn => turn.browserCard?.id));
    const requestIds = new Set(conversationRequests.records.map(request => 'request-' + request.id));
    const cards = checks.filter(check => !browserCardsInTurns.has(check.id) && !requestIds.has(check.id)).map(check => ({ at: check.createdAt, key: 'c:' + check.id, check }));
    const requests = conversationRequests.records.map(request => ({ at: request.createdAt, key: 'r:' + request.id, request,
      executionCard: checks.find(check => check.id === 'request-' + request.id) }));
    return [...turns, ...notes, ...cards, ...requests].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  }, [sessions, prefs.notes, checks, conversationRequests.records, project.name]);
  const last = timeline[timeline.length - 1];
  const latestAction = timeline.filter(item => !('note' in item)).at(-1);
  // Follow the newest reply as it grows (stage, tests and their results), not only new messages.
  const lastSignature = last ? `${last.key}:${'session' in last ? `${last.session.stage}:${last.session.reply ?? ''}:${last.session.tests.map(test => test.state).join(',')}`
    : 'request' in last ? `${last.request.state}:${last.request.reply?.length ?? 0}:${last.request.selectedOption ?? ''}:${last.request.events.at(-1)?.stage ?? ''}:${last.request.events.at(-1)?.at ?? ''}`
      : 'check' in last ? `${last.check.phase}:${last.check.updatedAt}` : ''}` : '';
  const [visibleStart, setVisibleStart] = useState<{ projectId: string; key: string } | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollPaneRef = useRef<HTMLElement | null>(null);
  const historyAnchorRef = useRef<{ key?: string; offset?: number; scrollTop: number } | null>(null);
  const loadingEarlierRef = useRef(false);
  const atBottomRef = useRef(true);
  const isUserTurn = (item: (typeof timeline)[number]) => !('note' in item);
  const userTurnIndices = timeline.flatMap((item, index) => isUserTurn(item) ? [index] : []);
  const visibleStartKey = visibleStart?.projectId === project.id ? visibleStart.key : undefined;
  const savedStartIndex = visibleStartKey ? timeline.findIndex(item => item.key === visibleStartKey) : -1;
  const defaultStartIndex = userTurnIndices.length > 10 ? userTurnIndices[userTurnIndices.length - 10] : 0;
  const visibleStartIndex = savedStartIndex >= 0 ? savedStartIndex : defaultStartIndex;
  const visibleTimeline = timeline.slice(visibleStartIndex);
  const earlierTurnIndices = userTurnIndices.filter(index => index < visibleStartIndex);

  const refreshScrollPosition = useCallback(() => {
    const pane = scrollPaneRef.current;
    if (!pane) return;
    const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 96;
    atBottomRef.current = atBottom;
    setAwayFromBottom(!atBottom);
  }, []);
  const jumpToLatest = useCallback(() => {
    const pane = scrollPaneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
    atBottomRef.current = true;
    setAwayFromBottom(false);
  }, []);
  const preserveHistoryAnchor = () => {
    const pane = scrollPaneRef.current;
    if (!pane) return;
    const paneTop = pane.getBoundingClientRect().top;
    const candidates = [...pane.querySelectorAll<HTMLElement>('[data-conversation-key]')];
    const visible = candidates.find(node => node.getBoundingClientRect().bottom > paneTop + 1);
    historyAnchorRef.current = visible
      ? { key: visible.dataset.conversationKey, offset: visible.getBoundingClientRect().top - paneTop, scrollTop: pane.scrollTop }
      : { scrollTop: pane.scrollTop };
  };
  const loadEarlier = useCallback(async () => {
    if (loadingEarlierRef.current) return;
    loadingEarlierRef.current = true;
    if (earlierTurnIndices.length) {
      preserveHistoryAnchor();
      const targetIndex = earlierTurnIndices[Math.max(0, earlierTurnIndices.length - 10)];
      const item = timeline[targetIndex];
      if (item) setVisibleStart({ projectId: project.id, key: item.key });
      else loadingEarlierRef.current = false;
      return;
    }
    if (!conversationRequests.canLoadOlder) { loadingEarlierRef.current = false; return; }
    preserveHistoryAnchor();
    const page = await conversationRequests.loadOlder();
    const oldest = page.at(-1);
    if (oldest) setVisibleStart({ projectId: project.id, key: `r:${oldest.id}` });
    else {
      historyAnchorRef.current = null;
      loadingEarlierRef.current = false;
    }
  }, [conversationRequests, earlierTurnIndices, project.id, timeline]);

  useEffect(() => {
    const pane = endRef.current?.closest<HTMLElement>('.ck-detail-content');
    if (!pane) return;
    scrollPaneRef.current = pane;
    pane.addEventListener('scroll', refreshScrollPosition, { passive: true });
    refreshScrollPosition();
    return () => { pane.removeEventListener('scroll', refreshScrollPosition); scrollPaneRef.current = null; };
  }, [project.id, refreshScrollPosition]);
  useEffect(() => {
    const pane = scrollPaneRef.current;
    if (!pane) return;
    const onScroll = () => {
      refreshScrollPosition();
      if (loadingEarlierRef.current) preserveHistoryAnchor();
      if (pane.closest('.ck-detail-layout')?.classList.contains('is-sidebar-expanded')) return;
      if (pane.scrollTop <= 140 && (earlierTurnIndices.length || conversationRequests.canLoadOlder)) void loadEarlier();
    };
    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => pane.removeEventListener('scroll', onScroll);
  }, [conversationRequests.canLoadOlder, earlierTurnIndices.length, loadEarlier, refreshScrollPosition]);
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const pane = scrollPaneRef.current;
    if (!anchor || !pane) return;
    const anchored = anchor.key && [...pane.querySelectorAll<HTMLElement>('[data-conversation-key]')]
      .find(node => node.dataset.conversationKey === anchor.key);
    if (anchored && anchor.offset !== undefined) {
      pane.scrollTop += anchored.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset;
    } else {
      pane.scrollTop = anchor.scrollTop;
    }
    historyAnchorRef.current = null;
    loadingEarlierRef.current = false;
    refreshScrollPosition();
  }, [visibleStart, refreshScrollPosition]);
  useEffect(() => {
    setVisibleStart(null);
    loadingEarlierRef.current = false;
    initializedScroll.current = false;
    atBottomRef.current = true;
    setAwayFromBottom(false);
  }, [project.id]);
  useEffect(() => {
    if (!loaded || !conversationRequests.loaded) return;
    if (!initializedScroll.current) {
      initializedScroll.current = true;
      if (consumeConversationReturn(project.id)) {
        inputRef.current?.focus({ preventScroll: true });
      }
      if (!sideOpenRef.current) jumpToLatest();
      return;
    }
    if (atBottomRef.current && !sideOpenRef.current) jumpToLatest();
  }, [loaded, conversationRequests.loaded, lastSignature, pending, project.id, jumpToLatest, refreshScrollPosition]);

  const launch = async (job: Pending) => {
    if ('checkInput' in job && job.checkInput) {
      startCheck(job.checkInput, { api, projects: () => projects });
      return;
    }
    setSending(true);
    setError(null);
    try {
      const session = 'rerun' in job
        ? await api.startAutoTest(project.id, { rerun: job.rerun.map(({ sessionId, testId }) => ({ sessionId, testId })), lanes: 1, startupPermission: prefs.mode })
        : await api.startAutoTest(project.id, { request: job.text, ...(job.base ? { base: { sessionId: job.base.sessionId, testId: job.base.testId } } : {}), lanes: 1, startupPermission: prefs.mode });
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
    const hasAttachments = request.documents.length || request.referenceCheckIds?.length || request.sourceArtifactIds?.length;
    submit({ text: request.focus, base, checkMode: request.mode,
      checkInput: !base && (request.mode !== 'browser' || hasAttachments) ? request : undefined });
    setBase(null);
  };

  const runFullCheck = (message = '') => {
    if (!hasFolder) {
      if (message) addNote(project.id, 'A full check needs the project folder on this computer.');
      return false;
    }
    startCheck({ projectId: project.id, documents: [], focus: message, mode: 'both', startupPermission: prefs.mode }, { api, projects: () => projects });
    return true;
  };

  const latest = useLatestResult(project.id, sessions);
  const savedChecks = sessions.filter(session => session.tests.length).map(session => browserTurnCheck(session, project.name));
  if (latest.review) savedChecks.unshift({
    id: 'saved-review-' + latest.review.id, projectId: project.id, projectName: project.name, title: latest.review.name,
    mode: 'code', phase: 'done', reviewId: latest.review.id, createdAt: latest.review.createdAt, updatedAt: latest.review.updatedAt,
    documents: [], notes: [], focus: '',
  });
  const latestSavedCheck = [...checks].filter(check => check.reviewId || check.autoTestId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.updatedAt.localeCompare(left.updatedAt))[0];
  const panelScope = `${historyOwner ?? 'anonymous'}:${project.id}`;
  const [sideChoice, setSideChoice] = useState<{ scope: string; open: boolean } | null>(null);
  const [entryPanelState, setEntryPanelState] = useState<{ scope: string; open: boolean | null }>(() => ({ scope: panelScope, open: null }));
  const entryPanelOpen = entryPanelState.scope === panelScope ? entryPanelState.open : null;
  useEffect(() => {
    if (entryPanelOpen !== null) return;
    if (latestSavedCheck) {
      setEntryPanelState({ scope: panelScope, open: true });
      return;
    }
    if (!loaded || !conversationRequests.loaded || latest.loading) return;
    setEntryPanelState({ scope: panelScope, open: !!latestSavedCheck || !!latest.result || prefs.sideOpen });
  }, [conversationRequests.loaded, entryPanelOpen, latest.loading, latest.result, latestSavedCheck, loaded, panelScope, prefs.sideOpen]);
  const userPanelChoice = sideChoice?.scope === panelScope ? sideChoice.open : null;
  const sideOpen = userPanelChoice ?? entryPanelOpen ?? prefs.sideOpen;
  useEffect(() => {
    if (questionFocus !== undefined) setSideChoice({ scope: panelScope, open: false });
  }, [panelScope, questionFocus]);
  sideOpenRef.current = sideOpen;
  const [focusCheck, setFocusCheck] = useState<CheckRecord | null>(null);
  const [checkQuestion, setCheckQuestion] = useState<{ options: CheckRecord[]; select: (check: CheckRecord) => void; clarify: (text: string) => void }>();
  const [checkChoice, setCheckChoice] = useState<string>('');
  const [checkClarification, setCheckClarification] = useState('');
  const recommendedCheck = useRef<HTMLInputElement>(null);
  useEffect(() => { setCheckQuestion(undefined); }, [project.id, historyOwner]);
  useEffect(() => {
    if (!checkQuestion) return;
    setCheckChoice(checkQuestion.options[0]?.id ?? 'custom');
    setCheckClarification('');
  }, [checkQuestion]);
  // The expanded panel carries the check page's features (25 Nov 2026), so it reads the chosen check or the check
  // behind the latest result. A running check plays in its card in the conversation, not here.
  const latestRecord = checks.find(check => latest.review && check.reviewId === latest.review.id || latest.autoTest && check.autoTestId === latest.autoTest.id);
  const defaultRecord = latestSavedCheck ?? latestRecord;
  const panelRecord = focusCheck ?? (sideOpen ? defaultRecord : undefined);
  const targetRecord = panelRecord;
  const focusData = useCheckData(targetRecord ?? undefined);
  const panelLatest: LatestResult = panelRecord
    ? focusData ? {
      review: focusData.review, autoTest: focusData.autoTest, requirements: focusData.requirements, findings: focusData.findings,
      result: focusData.requirementsState === 'unavailable' ? { ...focusData.result, requirements: null } : focusData.result,
      at: panelRecord.finishedAt ?? panelRecord.createdAt, loading: focusData.evidenceLoaded === false, reload: latest.reload,
    } : { ...latest, loading: true }
    : latest;
  const toggleSide = (open: boolean) => {
    setSideChoice({ scope: panelScope, open });
    setSideOpen(project.id, open);
    if (!open) {
      setFocusCheck(null);
      if (sideOpen && visibleStart?.projectId !== project.id) {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(jumpToLatest);
        else window.setTimeout(jumpToLatest, 0);
      }
    }
  };
  const library = useCheckLibrary(project.id);
  const openLatest = () => toggleSide(true);
  const openCheck = (check: CheckRecord) => {
    const saved = checks.find(item => item.id === check.id);
    if (!saved && check.projectId === project.id) saveCheck(check);
    setFocusCheck(saved ?? check);
    toggleSide(true);
  };
  /** Ask about this problem: attach it to the conversation box, as on the check page. */
  const askAbout = (attachment: ProblemAttachment) => {
    const draft = readConversationDraft(project.id);
    const problems = draft.problems.some(item => JSON.stringify(item.reference) === JSON.stringify(attachment.reference)) ? draft.problems : [...draft.problems, attachment];
    writeConversationDraft(project.id, { ...draft, problems, text: draft.text.trim() ? draft.text : 'Explain the attached problem.' });
    setComposerVersion(value => value + 1);
    toggleSide(false);
    inputRef.current?.focus({ preventScroll: true });
  };
  const runAgain = (problem: CheckProblem) => {
    const reference = problem.testRef ? { autoTestId: problem.testRef.sessionId, testId: problem.testRef.testId }
      : problem.findingId && panelLatest.review ? { reviewId: panelLatest.review.id, findingId: problem.findingId } : null;
    const draft = readConversationDraft(project.id);
    const problems = reference && !draft.problems.some(item => JSON.stringify(item.reference) === JSON.stringify(reference))
      ? [...draft.problems, { label: problem.title, reference }] : draft.problems;
    writeConversationDraft(project.id, { ...draft, problems, mode: 'browser',
      text: draft.text.trim() ? draft.text : 'Run this again in the browser and check whether the problem still shows.' });
    setComposerVersion(value => value + 1);
    toggleSide(false);
    inputRef.current?.focus({ preventScroll: true });
  };
  const latestCheck = latestSavedCheck ?? checks[0];
  const projectCodeFallback = latestCheck?.mode === 'code' && latestCheck.requestedMode === 'both';
  const documents = artifacts.filter(artifact => artifact.source === 'documents');
  const codeFiles = artifacts.filter(artifact => artifact.source === 'repository').length;

  const startupSession = sessions.find(session => !!session.startupQuestion);
  const latestRequest = latestAction && 'request' in latestAction ? latestAction.request : undefined;
  const owner = sessionStorage.getItem('centinel:supabase-user-id');
  const localPendingQuestion = conversationRequests.records.flatMap<PendingConversationQuestion>(request => {
    if (request.ownerId !== owner) return [];
    const current = request.pendingQuestionId ? request.questions?.find(item => item.id === request.pendingQuestionId && !item.answer) : undefined;
    if (current) return [{ request, question: current, at: current.createdAt }];
    const legacyOptions = conversationQuestionOptions(request);
    return request.state === 'completed' && request.selectedOption === undefined && legacyOptions.length
      ? [{ request, options: legacyOptions, at: request.createdAt }]
      : [];
  }).sort((left, right) => left.at.localeCompare(right.at) || left.request.createdAt.localeCompare(right.request.createdAt))[0];
  const pendingQuestion: PendingConversationQuestion | undefined = pendingQuestionRequest?.projectId === project.id
    ? { request: pendingQuestionRequest, question: pendingQuestionRequest.questions?.find(item => item.id === pendingQuestionRequest.pendingQuestionId && !item.answer), at: pendingQuestionRequest.createdAt }
    : questionQueueReady ? undefined : localPendingQuestion;
  const latestActionWorking = !!latestAction && ('request' in latestAction
    ? ['accepted', 'planning', 'running'].includes(latestAction.request.state)
    : 'session' in latestAction ? isActive(latestAction.session)
      : 'check' in latestAction ? latestAction.check.phase !== 'done' && latestAction.check.phase !== 'failed' : false);
  const stoppable = [...timeline].reverse().find(item => 'request' in item
    ? owner === item.request.ownerId && ['accepted', 'planning', 'running'].includes(item.request.state)
    : 'session' in item && owner === item.session.ownerId && isActive(item.session));
  const stopWork = async () => {
    if (!stoppable || stopping) return;
    setStopping(true);
    setStopError(undefined);
    try {
      if ('request' in stoppable) {
        const updated = await api.cancelConversationRequest(project.id, stoppable.request.id);
        if (updated?.ownerId === sessionStorage.getItem('centinel:supabase-user-id')) rememberAcknowledgedRequest(project.id, updated);
      } else if ('session' in stoppable) {
        await api.cancelAutoTest(project.id, stoppable.session.id);
        await refresh();
      }
    } catch {
      setStopError('ORIN could not stop this request. Try again.');
    } finally { setStopping(false); }
  };
  useEffect(() => {
    if (checkQuestion) chatCardsRef.current?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    if (checkQuestion) recommendedCheck.current?.focus({ preventScroll: true });
  }, [checkQuestion]);
  return <>
    <StartupQuestionDialog session={startupSession} onAnswered={() => void refresh()} />
    <Modal isOpen={!startupSession && driveAttention?.projectId === project.id} title="Google Drive needs attention"
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
    composer={<CheckFollowUp key={`${historyOwner}:${project.id}:${composerVersion}`} check={{ id: '', projectId: project.id,
      mode: projectCodeFallback ? 'code' : 'browser', requestedMode: projectCodeFallback ? 'both' : undefined }} projects={projects}
      onNavigate={onNavigate} available library={library} conversation={{
        editing: base && <span className="ck-chip is-project pc-base"><Icon icon={Pencil} /><span>Changing “{base.name}”</span><button type="button" onClick={() => setBase(null)} aria-label="Stop changing this test"><Icon icon={X} /></button></span>,
        clearReplySelection, replySources, replySourcesLoaded: conversationRequests.loaded,
        replySelection: replySelection?.projectId === project.id && replySelection.ownerId === historyOwner ? replySelection : null,
        inputRef, sending, send, runFullCheck, savedChecks, onFocus: () => setSideChoice({ scope: panelScope, open: false }), onSent: jumpToLatest,
        stop: stoppable ? { busy: stopping, run: () => void stopWork() } : undefined,
        question: pendingQuestion ? <ConversationQuestion request={pendingQuestion.request} question={'question' in pendingQuestion ? pendingQuestion.question : undefined}
          options={'options' in pendingQuestion ? pendingQuestion.options : undefined} deadlineAt={questionDeadlineAt} onAnswered={onQuestionAnswered} /> : null,
        jumpToLatest: awayFromBottom ? <button type="button" className="pc-jump-latest" aria-label="Jump to latest" title="Jump to latest" onClick={() => {
          const pane = scrollPaneRef.current;
          if (pane?.scrollTo && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
          else jumpToLatest();
        }}>
          {latestActionWorking ? <span className="pc-jump-dots" aria-hidden="true"><i /><i /><i /></span> : <ArrowDown size={16} aria-hidden="true" />}
        </button> : null,
        chooseCheck: (options, select, clarify) => setCheckQuestion({ options, select, clarify }),
        latestRequest: !pending && latestRequest && (!conversationRequests.error || conversationRequests.directlyRefreshed.includes(latestRequest.id))
          ? latestRequest : undefined,
        latestCheck: latestAction && 'session' in latestAction ? latestAction.browserCard ?? undefined : undefined,
        placeholder: base ? 'How should this test change?' : 'Ask ORIN to test or change something',
        setPermission: mode => setMode(project.id, mode),
      }} />}
    sidebar={<ProjectSidePanel project={project} latest={panelLatest} onOpen={openLatest} checkLabel={panelRecord ? checkName(panelRecord) : undefined} open={sideOpen} onToggle={() => toggleSide(!sideOpen)}
      artifacts={artifacts} onSourcesChanged={loadArtifacts} codeFiles={codeFiles} mode={prefs.mode}
      accountGiven={prefs.accountReminderShown} checks={checks} onNavigate={onNavigate} onRunFullCheck={() => { runFullCheck(); }} onRunAgain={runAgain} onOpenCheck={openCheck} onAsk={askAbout} evidenceAssessment={focusData?.evidenceAssessment} />}>
      <div className="ck-screen"><section className="ck-panel pc-response" aria-label={`Conversation about ${project.name}`}>
          <CheckProjectHeader check={{ projectId: project.id, projectName: project.name }} project={project} onNavigate={onNavigate} library={library}
            projectAction={<button type="button" className="ck-toolbar-item" data-default onClick={() => { runFullCheck(); }} disabled={!hasFolder} aria-label="Run a full check"
              title={hasFolder ? 'Run a full check' : 'This project has no folder on this computer'}><Icon icon={Play} shape="play" /><CheckActionLabel>Run a full check</CheckActionLabel></button>} />

          {checkQuestion && <div className="pc-chat-cards" ref={chatCardsRef}>
            {checkQuestion && <section className="pc-card pc-chat-card" aria-labelledby="pc-check-question">
              <h2 id="pc-check-question" className="pc-card-title" aria-live="polite">Which Check do you mean?</h2>
              <fieldset className="pc-question-options">
                <legend>Choose a saved Check, or clarify in your message</legend>
                {checkQuestion.options.map((option, index) => <label key={option.id} className="pc-check-choice">
                  <input type="radio" name="pc-check-choice" value={option.id} checked={checkChoice === option.id}
                    ref={index === 0 ? recommendedCheck : undefined} onChange={() => setCheckChoice(option.id)} />
                  <span>{checkName(option)} · {new Date(option.createdAt).toLocaleString()}{index === 0 ? ' · Recommended' : ''}</span>
                </label>)}
                <label className="pc-check-choice">
                  <input type="radio" name="pc-check-choice" value="custom" checked={checkChoice === 'custom'} onChange={() => setCheckChoice('custom')} />
                  <span>Something else</span>
                </label>
                <textarea aria-label="Clarify which Check you mean" value={checkClarification} disabled={checkChoice !== 'custom'}
                  onChange={event => setCheckClarification(event.target.value)} placeholder="Add a detail to your message" rows={2} />
              </fieldset>
              <div className="pc-actions">
                <button type="button" className="ck-button is-small is-primary" disabled={checkChoice === 'custom'} onClick={() => {
                  const selected = checkQuestion.options.find(option => option.id === checkChoice);
                  if (selected) { const question = checkQuestion; setCheckQuestion(undefined); question.select(selected); }
                }}>Use this Check</button>
                <button type="button" className="ck-button is-small" disabled={checkChoice !== 'custom' || !checkClarification.trim()} onClick={() => {
                  const question = checkQuestion; const clarification = checkClarification.trim();
                  setCheckQuestion(undefined); question.clarify(clarification); inputRef.current?.focus({ preventScroll: true });
                }}>Add clarification to message</button>
                <button type="button" className="ck-link pc-chat-card-toggle" onClick={() => { setCheckQuestion(undefined); inputRef.current?.focus({ preventScroll: true }); }}>Back to message</button>
              </div>
            </section>}
          </div>}

          <div className="pc-thread" aria-live="polite">
            <div className="pc-history-top">
              {conversationRequests.paging && <div className="pc-history-skeleton" role="status" aria-label="Loading earlier conversation" aria-busy="true">
                <span className="pc-history-skeleton-user" /><span className="pc-history-skeleton-response" /><span className="pc-history-skeleton-card" />
              </div>}
              {conversationRequests.pageError && <div className="pc-history-error" role="alert">
                <span>Earlier messages could not be loaded.</span>
                <button type="button" className="ck-link" onClick={() => void loadEarlier()}>Try again</button>
              </div>}
              {conversationRequests.error && <div className="pc-history-error" role="status">
                <span>{conversationRequests.error}</span>
                <button type="button" className="ck-link" onClick={conversationRequests.retryHistory}>Retry conversation history</button>
              </div>}
              {!conversationRequests.paging && !conversationRequests.pageError && (earlierTurnIndices.length > 0 || conversationRequests.canLoadOlder)
                && <button type="button" className="ck-link pc-history-load" onClick={() => void loadEarlier()}>Load earlier messages</button>}
            </div>
            {loaded && conversationRequests.loaded && !checks.length && <div className="pc-turn pc-ai-text pc-intro">
              <span>{latestCheck
                ? latestCheck.phase === 'done'
                  ? <>The last check found {latestCheck.problemCount ? `${latestCheck.problemCount} problem${latestCheck.problemCount === 1 ? '' : 's'}` : 'no problems'}. <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: latestCheck.id })}>Open the result</button></>
                  : <>A check is {latestCheck.phase === 'failed' ? 'saved but did not start' : 'running'}. <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: latestCheck.id })}>Open it</button></>
                : 'No check has run on this computer yet.'}
              {' '}Ask me to test something, for example “Test that a wrong password shows an error”.</span>
            </div>}
            {(!loaded || !conversationRequests.loaded) && !error && !conversationRequests.error && !timeline.length && <LoadingSkeleton className="pc-conversation-skeleton" label="Loading the conversation" />}
            {visibleTimeline.map(item => 'check' in item ? <div className="pc-turn" key={item.key} data-conversation-key={item.key}>
                {item.check.focus && !item.check.id.startsWith('request-') && <ConversationMessage text={item.check.focus} at={item.check.createdAt} />}
                <ProjectCheckCard check={item.check} onNavigate={onNavigate} onOpen={openCheck} showOutcome />
              </div>
              : 'request' in item ? <ConversationTurn key={item.key} anchorKey={item.key} request={item.request}
                artifacts={artifacts}
                executionCard={item.executionCard && (renderProgress => <ProjectCheckCard check={item.executionCard!} onNavigate={onNavigate} onOpen={openCheck}
                  showOutcome={item.request.state === 'completed'} savedOutcome={item.request.executionReply} renderProgress={renderProgress}
                  onQuote={item.request.executionReply && replySources.has(item.request.id) ? () => quoteTurn(item.request.id) : undefined} />)}
                activityCheckName={evidenceId => {
                  const referenced = checks.find(check => item.request.input.references.some(ref => !ref.findingId && !ref.testId
                    && (!ref.checkId || check.id === ref.checkId) && (!ref.reviewId || check.reviewId === ref.reviewId)
                    && (!ref.autoTestId || check.autoTestId === ref.autoTestId) && [ref.checkId && `check:${ref.checkId}`,
                      ref.reviewId && `review:${ref.reviewId}`, ref.autoTestId && `browser:${ref.autoTestId}`].includes(evidenceId)));
                  return referenced && checkName(referenced);
                }}
                onOpenActivity={evidenceId => {
                  if (evidenceId.startsWith('conversation:')) {
                    const key = `r:${evidenceId.slice('conversation:'.length)}`;
                    if (!visibleTimeline.some(turn => turn.key === key)) return;
                    return () => [...(scrollPaneRef.current?.querySelectorAll<HTMLElement>('[data-conversation-key]') ?? [])]
                      .find(node => node.dataset.conversationKey === key)?.scrollIntoView({ block: 'nearest' });
                  }
                  const reference = item.request.input.references.find(ref => ref.findingId && `finding:${ref.findingId}` === evidenceId
                    || ref.checkId && `check:${ref.checkId}` === evidenceId
                    || ref.autoTestId && `browser:${ref.autoTestId}${ref.testId ? `:${ref.testId}` : ''}` === evidenceId
                    || ref.reviewId && !ref.findingId && `review:${ref.reviewId}` === evidenceId);
                  if (!reference) return;
                  if (reference.findingId && reference.reviewId) return () => onNavigate({ name: 'review-finding', projectId: project.id,
                    sessionId: reference.reviewId!, findingId: reference.findingId! });
                  if (!reference.testId) {
                    const check = checks.find(saved => (!reference.checkId || saved.id === reference.checkId) && (reference.reviewId || reference.autoTestId)
                      && (!reference.reviewId || saved.reviewId === reference.reviewId) && (!reference.autoTestId || saved.autoTestId === reference.autoTestId));
                    if (check) return () => openCheck(check);
                  }
                  return undefined;
                }}
                onOpenProblem={(evidenceId, browserRunId) => {
                  const reference = item.request.input.references.find(ref =>
                    (ref.findingId ? `finding:${ref.findingId}` === evidenceId
                      : ref.testId ? `browser:${ref.autoTestId}:${ref.testId}` === evidenceId
                        : ref.reviewId && ref.autoTestId ? `check:${ref.checkId ?? `${ref.reviewId}:${ref.autoTestId}`}` === evidenceId
                          : ref.reviewId ? `review:${ref.reviewId}` === evidenceId
                            : ref.autoTestId && `browser:${ref.autoTestId}` === evidenceId));
                  if (!reference) return;
                  if (browserRunId && reference.testId) {
                    onNavigate({ name: 'dynamic-testing', projectId: project.id, runId: browserRunId });
                    return;
                  }
                  const { reviewId, autoTestId, findingId } = reference;
                  if (reviewId && findingId) {
                    onNavigate({ name: 'review-finding', projectId: project.id, sessionId: reviewId, findingId });
                    return;
                  }
                  const matchesReference = (check: CheckRecord) =>
                    (!reviewId || check.reviewId === reviewId) && (!autoTestId || check.autoTestId === autoTestId);
                  const savedCheck = (reference.checkId && checks.find(check => check.id === reference.checkId && matchesReference(check)))
                    || checks.find(check => check.reviewId === reviewId && check.autoTestId === autoTestId)
                    || checks.find(matchesReference);
                  if (savedCheck) { openCheck(savedCheck); return; }
                  if (!reviewId && !autoTestId) return;
                  // Saved evidence can be opened on another device without first rebuilding its local Check index.
                  const section = item.request.explanation?.sections.find(entry => entry.evidenceId === evidenceId);
                  setFocusCheck({
                    id: reference.checkId ?? evidenceId, projectId: project.id, projectName: project.name,
                    title: section?.presentation === 'check' ? section.title : undefined,
                    createdAt: item.request.createdAt, updatedAt: item.request.updatedAt, phase: 'done',
                    mode: reviewId && autoTestId ? 'both' : reviewId ? 'code' : 'browser',
                    focus: reference.checkFocus ?? '', notes: [], documents: [], reviewId, autoTestId,
                  });
                  toggleSide(true);
                }}
                replySourceExcerpt={item.request.replyTo?.status === 'resolved' ? replySources.get(item.request.replyTo.turnId) : undefined}
                onQuote={replySources.has(item.request.id) ? () => quoteTurn(item.request.id) : undefined} />
              : 'session' in item
              ? <div key={item.key} className="pc-timeline-item" data-conversation-key={item.key}><SessionTurn session={item.session} projectId={project.id} prefs={prefs} onNavigate={onNavigate}
                  card={item.browserCard && <ProjectCheckCard check={item.browserCard} onNavigate={onNavigate} onOpen={openCheck} externalProgress />}
                  onChange={ref => { setBase(ref); inputRef.current?.focus(); }}
                  onRerun={ref => submit({ rerun: [ref] })} />
              </div>
              : <p key={item.key} className="pc-note" data-conversation-key={item.key}><Icon icon={Info} />{item.note.text}</p>)}
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
            {stopError && <p className="pc-note" role="status"><Icon icon={Info} />{stopError}</p>}
            <div ref={endRef} />
          </div>

      </section></div>
  </CheckProjectLayout>
  </>;
}
