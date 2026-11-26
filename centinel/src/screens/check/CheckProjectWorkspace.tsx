import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Clock, ChevronDown, FileText, Folder, GitBranch, History, Search, Maximize2, Minimize2, Plus, Reply, SquareChartGantt, X } from 'lucide-react';
import { api } from '../../api/client';
import { problemCountTone, ProblemCountIcon } from '../../components/ProblemCountIcon';
import { OverflowText } from '../../components/OverflowText';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ProjectCreateModal } from '../../components/ProjectCreateModal';
import { ArtifactPreviewDialog } from '../../components/ArtifactsPanel';
import { getCheck, saveCheck, useChecks } from '../../check/store';
import { checkName } from '../../check/checkName';
import { CHECK_MODES, type CheckDocument, type CheckMode, type CheckRecord, type StartCheckInput } from '../../check/types';
import { startCheck } from '../../check/runner';
import { projectLocalFolder } from '../../check/projectWorkspace';
import { addNote, looksLikeAccount, setMode as savePermission, updatePrefs, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import type { Artifact, Project, Screen } from '../../types';
import { CheckPermission } from './CheckPermission';
import { attachCheckDocuments, CheckDocumentInput, PageDocumentDropIndicator, usePageDocumentDrop, type CheckDocumentBatch } from './CheckDocumentPicker';
import { CheckAddOptions, SourceActions } from './CheckAddOptions';
import { animateComposerArrival } from './composerTransition';
import { CheckAddSource, CheckLibraryGroups, CheckLibraryList, githubDestination, LibrarySourceRow, type CheckLibrary, type CheckSourceChoice } from './CheckSourceLibrary';
import { handleComposerEnter } from './composerKeys';
import { findCheckMention } from './checkMention';
import { rankMentionChecks, rankMentionProjects, useMentionSelection } from './checkMentionSelection';
import { CheckAttachmentCount } from './CheckAttachmentCount';
import { CheckComposerNotices } from './CheckComposerNotices';
import { acknowledgeConversationDraft, asksForProjectStatus, checkReference, conversationApproval, draftContentSignature, loadConversationReplySource, mentionedCheckCandidates, namedReviewScope, readConversationDraft, recoverConversationRequest, rememberAcknowledgedRequest, requestsFullCheck, sendConversationDraft, writeConversationDraft, type ProblemAttachment } from '../../check/conversation';
import type { ConversationRequest } from '../../check/conversationTypes';
import { useProblemMentions } from '../../check/problemMentions';
import { ConversationAttachment } from './ConversationAttachment';
import { ConversationQuotePreview } from './ConversationQuotePreview';
import { rememberCheckTransition } from '../../check/checkTransition';
import { rememberConversationReturn } from '../../check/projectNavigation';
import './Check.css';

type Navigate = (screen: Screen) => void;
type ConversationComposer = {
  latestRequest?: ConversationRequest;
  latestCheck?: CheckRecord;
  savedChecks?: CheckRecord[];
  question?: ReactNode;
  jumpToLatest?: ReactNode;
  editing?: ReactNode;
  replySources?: ReadonlyMap<string, string>;
  replySourcesLoaded?: boolean;
  replySelection?: { turnId: string } | null;
  clearReplySelection?(): void;
  inputRef: RefObject<HTMLTextAreaElement>;
  placeholder: string;
  sending: boolean;
  onFocus?(): void;
  send(request: StartCheckInput): void;
  runFullCheck?(message: string): boolean;
  chooseCheck?(options: CheckRecord[], select: (check: CheckRecord) => void, clarify: (text: string) => void): void;
  onSent?(): void;
  setPermission?(mode: PermissionMode): void;
};

export function CheckProjectLayout({ header, children, composer, sidebar, expanded, onCloseSidebar, projectHeader }: {
  header?: ReactNode; children: ReactNode; composer: ReactNode; sidebar?: ReactNode;
  expanded?: boolean; onCloseSidebar?(): void; projectHeader?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const pane = contentRef.current;
    const layout = pane?.parentElement;
    if (!pane || !layout) return;
    // Layout width excludes the scroll gutters and stays stable during the card transition.
    const measure = () => {
      if (pane.clientWidth > 0) layout.style.setProperty('--ck-response-pane-width', `${pane.clientWidth}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(pane);
    return () => { observer?.disconnect(); layout.style.removeProperty('--ck-response-pane-width'); };
  }, []);
  useLayoutEffect(() => {
    const pane = contentRef.current;
    if (!pane) return;
    const headerElement = pane.parentElement?.querySelector<HTMLElement>(':scope > .ck-detail-header');
    if (headerElement) headerElement.inert = !!expanded;
  }, [expanded]);
  useEffect(() => {
    if (!expanded || !onCloseSidebar) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal=true]')) return;
      contentRef.current?.parentElement?.querySelector<HTMLElement>('.pc-side-toggle')?.focus();
      onCloseSidebar();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded, onCloseSidebar]);
  return <div className={`ck-detail-layout${sidebar ? '' : ' is-without-sidebar'}${expanded ? ' is-sidebar-expanded' : ''}${projectHeader ? ' has-project-header' : ''}`}>
    <div className="ck-glow" aria-hidden="true" />
    {header}
    <div className="ck-detail-content" ref={node => { contentRef.current = node; if (node) node.inert = !!expanded; }} aria-hidden={expanded || undefined}>{children}</div>
    <div className="ck-docked-composer" ref={node => { if (node) node.inert = !!expanded; }} aria-hidden={expanded || undefined}>{composer}</div>
    {sidebar}
  </div>;
}

export function CheckActionLabel({ children }: { children: ReactNode }) {
  return <span className="ck-toolbar-label"><span>{children}</span></span>;
}

export function CheckActionToolbar({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  const stopTracking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopTracking.current?.(), []);

  return <div className={className ? `ck-header-toolbar ${className}` : 'ck-header-toolbar'} role="group" aria-label={label}
    onPointerMove={event => {
      if (event.pointerType === 'touch' || stopTracking.current) return;
      const toolbar = event.currentTarget;
      const document = toolbar.ownerDocument;
      let hovered: HTMLElement | null = null;
      let lastPosition: { x: number; y: number } | null = null;
      // Layout can change hover targets with the pointer still in place.
      // Track real movement, including the next move outside a resized toolbar.
      const track = (pointer: PointerEvent) => {
        if (pointer.pointerType === 'touch' || lastPosition?.x === pointer.clientX && lastPosition?.y === pointer.clientY) return;
        lastPosition = { x: pointer.clientX, y: pointer.clientY };
        if (!(pointer.target instanceof Element) || !toolbar.contains(pointer.target)) {
          stopTracking.current?.();
          return;
        }
        const item = pointer.target.closest<HTMLElement>('.ck-toolbar-item:not(:disabled)');
        if (hovered === item) return;
        hovered?.removeAttribute('data-pointer-active');
        item?.setAttribute('data-pointer-active', '');
        hovered = item;
      };
      stopTracking.current = () => {
        document.removeEventListener('pointermove', track, true);
        hovered?.removeAttribute('data-pointer-active');
        stopTracking.current = null;
      };
      document.addEventListener('pointermove', track, { capture: true, passive: true });
      track(event.nativeEvent);
    }}
    onPointerLeave={event => { if (!event.relatedTarget) stopTracking.current?.(); }}
    onPointerCancel={() => stopTracking.current?.()}
    onFocus={event => { if (event.target.matches(':focus-visible')) stopTracking.current?.(); }}>
    {children}
  </div>;
}

export function CheckProjectHeader({ check, project, onNavigate, library, projectAction, checkHeading }: {
  check: Pick<CheckRecord, 'projectName' | 'projectId' | 'folder' | 'githubUrl'> & { id?: string };
  project?: Project; onNavigate: Navigate; library: CheckLibrary; projectAction?: ReactNode;
  checkHeading?: { name: string; duration?: string; problems?: Pick<CheckRecord, 'problemCount' | 'problemRisk' | 'highProblemCount'>; report?: ReactNode };
}) {
  const [panel, setPanel] = useState<'sources' | 'history' | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<CheckSourceChoice | null>(null);
  const [openArtifact, setOpenArtifact] = useState<Artifact | null>(null);
  const header = useRef<HTMLElement>(null);
  const sourcesButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyInput = useRef<HTMLInputElement>(null);
  const checks = useChecks();
  const matching = checks.filter(item => check.projectId && item.projectId === check.projectId
    && checkName(item).toLowerCase().includes(query.trim().toLowerCase()));
  const folder = project?.workspacePath || project?.managedWorkspacePath || check.folder;
  const projectId = project?.id ?? check.projectId;
  const githubUrl = githubDestination(check.githubUrl);
  const showRepoLocation = githubUrl && !library.connected?.some(source => source.kind === 'github_repository' && githubDestination(source.remoteUrl) === githubUrl);

  useEffect(() => {
    if (!panel) return;
    if (panel === 'history') historyInput.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);

  const sourceTrigger = <button type="button" className="ck-header-action ck-source-trigger" aria-label={`Project sources for ${check.projectName}`}
    aria-haspopup="dialog" aria-expanded={panel === 'sources'} ref={sourcesButton} onClick={() => setPanel(value => value === 'sources' ? null : 'sources')}>
    {!projectAction && <Icon icon={Folder} />}<span title={check.projectName}>{check.projectName}</span><Icon icon={ChevronDown} />
  </button>;

  return <header className={`ck-detail-header${projectAction ? ' is-project-header' : checkHeading ? ' is-check-header' : ''}`} ref={header} onKeyDown={event => {
    if (event.key !== 'Escape' || !panel || adding) return;
    event.stopPropagation();
    (panel === 'history' ? historyButton : sourcesButton).current?.focus({ preventScroll: true });
    setPanel(null);
  }}>
    {checkHeading ? <div className="ck-check-heading">
      {projectId && <button type="button" className="ck-header-action ck-header-icon" aria-label={`Back to ${project?.name ?? check.projectName}`}
        title={project?.name ?? check.projectName}
        onClick={() => onNavigate({ name: 'project', projectId })}><Icon icon={Folder} /></button>}
      <div className="ck-check-heading-copy">
        <h1 className="ck-title" tabIndex={0}><Icon icon={SquareChartGantt} /><OverflowText text={checkHeading.name} /></h1>
      </div>
    </div> : projectAction ? <div className="pc-project-heading"><h1 className="ck-title">{sourceTrigger}</h1></div> : sourceTrigger}
    <CheckActionToolbar label={checkHeading ? 'Check actions and details' : 'Project actions'}>
      {checkHeading?.duration && <span className="ck-toolbar-item" tabIndex={0} data-default
        aria-label={`Check duration: ${checkHeading.duration}`}><Icon icon={Clock} /><CheckActionLabel>{checkHeading.duration}</CheckActionLabel></span>}
      {checkHeading?.problems && <span className={`ck-toolbar-item problem-count-tone is-${problemCountTone(checkHeading.problems)}`} tabIndex={0}>
        <ProblemCountIcon summary={checkHeading.problems} />
        <CheckActionLabel>{checkHeading.problems.problemCount} {checkHeading.problems.problemCount === 1 ? 'problem' : 'problems'}</CheckActionLabel>
      </span>}
      {check.projectId && <button type="button" className="ck-toolbar-item" aria-label="History"
        data-default={!projectAction && !checkHeading?.duration || undefined}
        aria-haspopup="dialog" aria-expanded={panel === 'history'} ref={historyButton} onClick={() => {
          setQuery('');
          setPanel(value => value === 'history' ? null : 'history');
        }}><Icon icon={History} /><CheckActionLabel>History</CheckActionLabel></button>}
      {projectAction}
      {checkHeading?.report}
    </CheckActionToolbar>
    {panel === 'history' && <div className="ck-menu ck-header-popover ck-check-history" role="dialog" aria-label="History">
      <label className="ck-popover-search"><Icon icon={Search} /><input type="search" ref={historyInput}
        aria-label="Filter checks by name" placeholder="Filter checks by name" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="ck-header-scroll">
        {matching.length ? <ul>{matching.map(item => <li key={item.id}><button type="button" className="ck-history-row"
          aria-current={item.id === check.id ? 'page' : undefined}
          onClick={() => { setPanel(null); onNavigate({ name: 'check', checkId: item.id }); }}>
          <Icon icon={SquareChartGantt} /><span>{checkName(item)}</span>
        </button></li>)}</ul> : <p>{query.trim() ? 'No matching checks.' : 'No checks saved for this project.'}</p>}
      </div>
    </div>}
    {panel === 'sources' && <div className="ck-menu ck-header-popover ck-detail-sources" role="dialog" aria-label="Project sources">
      <div className="ck-library-heading ck-source-heading"><strong>Sources</strong>{check.projectId && <SourceActions onChoose={setAdding} />}</div>
      <div className="ck-header-scroll">
        <section className="ck-source-section" aria-label="Project locations">
          {folder && <LibrarySourceRow name="Workspace folder" detail={folder} icon={Folder} folder={folder} />}
          {showRepoLocation && <LibrarySourceRow name="GitHub repository" detail={githubUrl} icon={GitBranch} url={githubUrl} />}
        </section>
        <section className="ck-source-section" aria-label="Library">
          <div className="ck-library-heading"><strong>Library</strong></div>
          <CheckLibraryGroups library={library} onOpenArtifact={artifact => { setPanel(null); setOpenArtifact(artifact); }} />
        </section>
      </div>
    </div>}
    {adding && check.projectId && <CheckAddSource projectId={check.projectId} initialChoice={adding} onClose={() => { setAdding(null); sourcesButton.current?.focus({ preventScroll: true }); }}
      onSaved={() => { library.refresh(); setPanel(null); }} />}
    {openArtifact && openArtifact.projectId === projectId && <ArtifactPreviewDialog key={openArtifact.id} artifact={openArtifact}
      onClose={() => { setOpenArtifact(null); sourcesButton.current?.focus({ preventScroll: true }); }} />}
  </header>;
}

export function CheckFollowUp({ check, projects, onNavigate, available, library, conversation, explainProblem }: { check: Pick<CheckRecord, 'id' | 'projectId' | 'mode' | 'requestedMode' | 'folder'>; projects: Project[]; onNavigate: Navigate; available: boolean; library: CheckLibrary; conversation?: ConversationComposer; explainProblem?: ProblemAttachment }) {
  // Check and Project render this composer with a key for the current route.
  const [saved] = useState(() => readConversationDraft(check.projectId ?? '', check.id));
  const [draft, setDraft] = useState(saved.text);
  const [replyToTurnId, setReplyToTurnId] = useState(conversation ? saved.replyToTurnId : undefined);
  const [mode, setMode] = useState<CheckMode>(() => saved.mode ?? check.mode);
  const [modeChangedByOrin, setModeChangedByOrin] = useState(false);
  const codeFallback = check.mode === 'code' && check.requestedMode === 'both';
  useEffect(() => { if (codeFallback) setMode('code'); }, [codeFallback]);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const documentInput = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mention, setMention] = useState<ReturnType<typeof findCheckMention>>(null);
  const [attachedChecks, setAttachedChecks] = useState<CheckRecord[]>(() => [...new Set([...saved.checkIds, ...(check.id ? [check.id] : [])])]
    .map(id => {
      const snapshot = saved.checks?.find(item => item.id === id);
      return getCheck(id) ?? (snapshot && { ...snapshot, focus: '', documents: [], notes: [] });
    }).filter((item): item is CheckRecord => !!item && item.projectId === check.projectId && (!!item.reviewId || !!item.autoTestId)));
  const [attachedProblems, setAttachedProblems] = useState(saved.problems);
  const [addingSource, setAddingSource] = useState<CheckSourceChoice | null>(null);
  const recent = useChecks();
  const [sourceIds, setSourceIds] = useState(saved.sourceIds ?? []);
  const sources = sourceIds.map(id => library.items?.find(item => item.id === id) ?? { id, fileName: 'Saved source' });
  const [documents, setDocuments] = useState<CheckDocument[]>(saved.documents ?? []);
  const [readingDocuments, setReadingDocuments] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const chosenCheck = useRef<{ text: string; check: CheckRecord }>();
  const composer = useRef<HTMLFormElement>(null);
  const mounted = useRef(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const ownInput = useRef<HTMLTextAreaElement>(null);
  const input = conversation?.inputRef ?? ownInput;
  const closeMenu = () => { setAddOpen(false); setMention(null); };
  useEffect(() => {
    if (!addOpen) return;
    if (!mention) addMenu.current?.querySelector('button')?.focus();
    const close = (event: PointerEvent) => {
      if (event.target !== input.current && !addMenu.current?.contains(event.target as Node) && !addTrigger.current?.contains(event.target as Node)) {
        setAddOpen(false); setMention(null);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [addOpen, Boolean(mention)]);
  const prefs = useProjectPrefs(check.projectId ?? '');
  useLayoutEffect(() => {
    mounted.current = true;
    if (composer.current) animateComposerArrival(check.id, composer.current);
    return () => { mounted.current = false; };
  }, [check.id]);
  const project = projects.find(item => item.id === check.projectId);
  useLayoutEffect(() => {
    if (saved.text === 'Explain the attached check.') input.current?.focus({ preventScroll: true });
  }, [input, saved.text]);
  useEffect(() => {
    if (!explainProblem) return;
    setAttachedProblems(current => current.some(item => JSON.stringify(item.reference) === JSON.stringify(explainProblem.reference))
      ? current : [...current, explainProblem]);
    setDraft(current => current.trim() ? current : 'Explain the attached problem.');
    closeMenu();
    input.current?.focus();
  }, [explainProblem, input]);
  const resetDraft = () => {
    setDraft(''); setDocuments([]); setSourceIds([]); setAttachedChecks([]); setAttachedProblems([]); setReplyToTurnId(undefined);
  };
  const replySelection = conversation?.replySelection;
  const clearReplySelection = conversation?.clearReplySelection;
  useEffect(() => {
    if (!replySelection) return;
    setReplyToTurnId(replySelection.turnId);
    setAddOpen(false);
    setMention(null);
    input.current?.focus({ preventScroll: true });
    clearReplySelection?.();
  }, [input, replySelection, clearReplySelection]);
  const replyTargetAvailable = !!replyToTurnId && conversation?.replySources?.has(replyToTurnId);
  useLayoutEffect(() => {
    if (!check.projectId) return;
    writeConversationDraft(check.projectId, { ...readConversationDraft(check.projectId, check.id), text: draft, mode,
      checkIds: attachedChecks.map(item => item.id), problems: attachedProblems,
      checks: attachedChecks.map(({ id, projectId, projectName, title, mode, phase, reviewId, autoTestId, createdAt, updatedAt, focus }) =>
        ({ id, projectId, projectName, title, mode, phase, reviewId, autoTestId, createdAt, updatedAt, focus })),
      documents: documents.filter(item => item.saved).map(item => ({ ...item, base64: '' })), sourceIds, replyToTurnId }, check.id);
  }, [check.id, check.projectId, draft, mode, attachedChecks, attachedProblems, documents, sourceIds, replyToTurnId]);
  useEffect(() => {
    if (!check.projectId || !saved.requestId || typeof api.conversationRequest !== 'function') return;
    const projectId = check.projectId;
    const owner = sessionStorage.getItem('centinel:supabase-user-id');
    let active = true;
    setSending(true);
    void recoverConversationRequest(projectId, saved.requestId).then(record => {
      if (!active || owner !== sessionStorage.getItem('centinel:supabase-user-id')) return;
      if (!record) return;
      if (acknowledgeConversationDraft(projectId, record, check.id)) {
        resetDraft();
        if (saved.mode === 'browser' && record.input.mode === 'code' && namedReviewScope(record.input.text)) {
          setMode('code');
          setModeChangedByOrin(true);
        }
      }
      if (check.id) setAttachmentMessage('The sent message was recovered in the project conversation.');
    }).catch(() => {
      if (active) setAttachmentMessage('The saved request could not be checked. Your draft is saved.');
    }).finally(() => { if (active) setSending(false); });
    return () => { active = false; };
  }, [check.id, check.projectId, saved.requestId]);
  const hasFolder = !!(projectLocalFolder(project) || check.folder);
  const effectiveMode = conversation?.editing ? 'browser' : hasFolder || conversation ? mode : 'code';
  const canUseLibrary = effectiveMode !== 'browser' || typeof api.sendConversationRequest === 'function' && !conversation?.editing;
  const libraryRequiresCode = effectiveMode === 'browser' && sources.length > 0 && !canUseLibrary;
  const revisionHasAttachments = !!conversation?.editing && (documents.length > 0 || sources.length > 0 || attachedChecks.length > 0);
  const replyTargetBlocksSend = !!replyToTurnId && (!!conversation?.editing || typeof api.sendConversationRequest !== 'function');
  const canSend = !replyTargetBlocksSend && project && draft.trim() && !sending && !readingDocuments && !conversation?.sending && !libraryRequiresCode && !revisionHasAttachments && !mention;
  const candidates = [...recent, ...(conversation?.savedChecks ?? []).filter(item => !recent.some(existing => existing.id === item.id ||
    item.reviewId && existing.reviewId === item.reviewId || item.autoTestId && existing.autoTestId === item.autoTestId))];
  const problemOptions = useProblemMentions(check.projectId, [...attachedChecks, ...candidates.filter(item => !attachedChecks.some(attached => attached.id === item.id))], addOpen);
  const query = mention?.query.trim().toLowerCase() ?? '';
  const matchingChecks = rankMentionChecks(candidates.filter(item => check.projectId && item.projectId === check.projectId
    && item.id !== check.id && !attachedChecks.some(attached => attached.id === item.id)
    && [checkName(item), item.projectName, item.focus].join(' ').toLowerCase().includes(query)));
  const mentionProjects = rankMentionProjects(projects.filter(item => item.id !== check.projectId), recent, query);
  const selectMention = useMentionSelection(addMenu, mention?.query);
  const changeDraft = (value: string, caret: number) => {
    setDraft(value);
    const next = conversation?.editing ? null : findCheckMention(value, caret);
    if (next && !mention) library.refresh();
    if (next || mention) setAddOpen(!!next);
    setMention(next);
  };
  const finishAttachment = () => {
    if (mention) setDraft(current => current.slice(0, mention.start) + current.slice(mention.end));
    closeMenu();
    input.current?.focus({ preventScroll: true });
  };
  const addDocuments = async (read: () => Promise<CheckDocumentBatch>) => {
    if (readingDocuments) return;
    setReadingDocuments(true);
    try {
      const result = await attachCheckDocuments(await read(), documents, project?.id);
      setDocuments(current => [...current, ...result.documents]);
      setAttachmentMessage(result.message);
      if (project) library.refresh();
    } catch {
      setAttachmentMessage('The dropped documents could not be read. Try the Add Document picker.');
    } finally { setReadingDocuments(false); }
  };
  const dragging = usePageDocumentDrop(composer, !conversation?.editing, addDocuments);
  return <>{dragging && <PageDocumentDropIndicator anchor={composer} />}
  {(conversation?.question || conversation?.jumpToLatest) && <div className="pc-composer-extras">
    {conversation?.question}
    {conversation?.jumpToLatest}
  </div>}
  <form ref={composer} className={`ck-composer ck-follow-up${expanded ? ' is-expanded' : ''}`} onSubmit={async event => {
    event.preventDefault();
    if (!canSend) return;
    const focus = draft.trim();
    if (conversation?.runFullCheck && !conversation.editing && !replyToTurnId && !attachedChecks.length && !attachedProblems.length
      && !documents.length && !sources.length && requestsFullCheck(focus)) {
      if (conversation.runFullCheck(focus)) { resetDraft(); conversation.onSent?.(); }
      return;
    }
    const moduleReview = namedReviewScope(focus);
    const includesAccount = looksLikeAccount(focus);
    if (includesAccount && !prefs.accountReminderShown) {
      updatePrefs(project.id, current => ({ ...current, accountReminderShown: true }));
      addNote(project.id, 'The AI will see this account. Use test accounts only.');
    }
    if (!conversation?.editing && typeof api.sendConversationRequest === 'function') {
      setSending(true);
      try {
        const owner = sessionStorage.getItem('centinel:supabase-user-id');
        if (replyToTurnId && !replyTargetAvailable
          && !await loadConversationReplySource(project.id, replyToTurnId, owner)) {
          throw new Error('The quoted reply is no longer available in this project.');
        }
        const previous = conversation?.latestRequest;
        const selection = chosenCheck.current?.text === focus ? chosenCheck.current.check : undefined;
        chosenCheck.current = undefined;
        let selectedChecks = attachedChecks;
        if (!selectedChecks.length && !attachedProblems.length && !replyToTurnId && !moduleReview) {
          const projectChecks = candidates.filter(item => item.projectId === project.id);
          const options = selection ? [selection] : asksForProjectStatus(focus)
            ? projectChecks.filter(item => item.reviewId || item.autoTestId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1)
            : mentionedCheckCandidates(focus, projectChecks, previous, conversation?.latestCheck);
          if (options.length > 1 && conversation?.chooseCheck) {
            conversation.chooseCheck(options, selected => {
              chosenCheck.current = { text: focus, check: selected };
              composer.current?.requestSubmit();
            }, clarification => {
              const extra = clarification.trim();
              if (!extra) return;
              chosenCheck.current = undefined;
              setDraft(current => `${current.trim() || focus.trim()}\n${extra}`);
              setAttachmentMessage(null);
              input.current?.focus({ preventScroll: true });
            });
            return;
          }
          if (options.length === 1) selectedChecks = options;
        }
        const checkReferences = selectedChecks.filter(item => item.projectId === project.id).map(checkReference).flatMap(reference => {
          const reviewId = attachedProblems.some(item => item.reference.reviewId === reference.reviewId && reference.reviewId) ? undefined : reference.reviewId;
          const autoTestId = attachedProblems.some(item => item.reference.autoTestId === reference.autoTestId && reference.autoTestId) ? undefined : reference.autoTestId;
          return reviewId || autoTestId ? [{ ...reference, reviewId, autoTestId }] : [];
        });
        const references = [...checkReferences,
          ...attachedProblems.map(item => item.reference), ...sources.map(item => ({ artifactId: item.id })),
          ...documents.filter(item => item.saved?.projectId === project.id).map(item => ({ artifactId: item.saved!.artifactId }))];
        if (documents.some(item => item.saved?.projectId !== project.id)) throw new Error('Some documents are not saved yet. Add them again before sending.');
        if (references.some(ref => !Object.keys(ref).length)) throw new Error('An attached check has no saved evidence yet.');
        const current = readConversationDraft(project.id, check.id);
        const approval = replyToTurnId ? null : conversationApproval(focus);
        if (approval && !references.length && !current.requestId && previous && previous.projectId === project.id && previous.ownerId === owner) {
          if (previous.state === 'accepted' || previous.state === 'planning') {
            setAttachmentMessage('The plan is still being prepared. Send “proceed” when the scope appears.');
            return;
          }
          if (previous.state === 'awaiting_permission') {
            if (approval === 'code' && (previous.action !== 'code' || previous.autoTestId)) {
              setAttachmentMessage('There is no Code-only plan waiting for approval. Ask for a Code Review and name the folder you want to review.');
              return;
            }
            const confirmed = await api.confirmConversationRequest(project.id, previous.id, previous.revision);
            if (owner !== sessionStorage.getItem('centinel:supabase-user-id')) return;
            rememberAcknowledgedRequest(project.id, confirmed);
            if (mounted.current && draftContentSignature(current) === draftContentSignature(readConversationDraft(project.id, check.id))) resetDraft();
            if (mounted.current) setAttachmentMessage(null);
            return;
          }
        }
        const sendMode = !replyToTurnId && moduleReview && effectiveMode === 'browser' && !references.length ? 'code' : effectiveMode;
        const accepted = await sendConversationDraft(project.id, { text: focus, mode: sendMode, permission: prefs.mode, references,
          ...(replyToTurnId ? { replyToTurnId } : {}) }, check.id);
        if (owner !== sessionStorage.getItem('centinel:supabase-user-id')) return;
        const clear = acknowledgeConversationDraft(project.id, accepted, check.id);
        if (!mounted.current) return;
        if (clear) resetDraft();
        if (sendMode !== effectiveMode && accepted.input.mode === sendMode) {
          setMode(sendMode);
          setModeChangedByOrin(true);
        }
        setAttachmentMessage(null);
        conversation?.onSent?.();
        if (check.id) {
          rememberCheckTransition(check.id, composer.current?.closest('.ck-detail-layout')?.querySelector('.ck-detail-content .ck-panel') ?? null);
          rememberConversationReturn(project.id);
          onNavigate({ name: 'project', projectId: project.id });
        }
      } catch (error) {
        if (mounted.current) setAttachmentMessage(error instanceof Error && 'status' in error && error.status === 404 && error.message === 'Not found'
          ? 'The local service does not support chat messages yet. Restart ORIN’s development service and resend. Your draft is saved.'
          : error instanceof Error && error.name === 'TimeoutError' ? 'The local service did not acknowledge the send. Your draft is saved. Send again to check whether it arrived.'
          : error instanceof Error ? error.message : 'The request could not be sent. Your draft is saved.');
      } finally { if (mounted.current) setSending(false); }
      return;
    }
    const request: StartCheckInput = { projectId: project.id, documents, focus, mode: effectiveMode,
      ...(effectiveMode === 'code' ? {} : { browserRequest: focus }),
      referenceCheckIds: [...(conversation ? [] : [check.id]), ...attachedChecks.map(item => item.id)],
      ...(sources.length ? { sourceArtifactIds: sources.map(source => source.id) } : {}) };
    if (conversation) {
      conversation.send(request);
      setDraft('');
      setDocuments([]);
      setSourceIds([]);
      setAttachedChecks([]);
      setAttachmentMessage(null);
      conversation.onSent?.();
      return;
    }
    setSending(true);
    const next = startCheck(request, { api, projects: () => projects });
    onNavigate({ name: 'check', checkId: next.id });
  }}>
    <button type="button" className="ck-composer-expand" aria-label={expanded ? 'Collapse composer' : 'Expand composer'} aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}><Icon icon={expanded ? Minimize2 : Maximize2} /></button>
    {conversation?.editing}
    {replyToTurnId && <ConversationQuotePreview className="pc-reply-chip" projectId={check.projectId ?? ''}
      ownerId={sessionStorage.getItem('centinel:supabase-user-id')} turnId={replyToTurnId}
      preview={conversation?.replySources?.get(replyToTurnId)} label="Quoted reply">
      {preview => <>
        <Reply size={15} aria-hidden="true" />
        <div>
          <strong>Quoted reply</strong>
          {conversation?.editing
            ? <span>Remove the quote before changing this test.</span>
            : preview ? <span>{preview}</span> : null}
        </div>
        <button type="button" aria-label="Remove quoted reply" onClick={() => {
          setReplyToTurnId(undefined);
          input.current?.focus({ preventScroll: true });
        }}><Icon icon={X} /></button>
      </>}
    </ConversationQuotePreview>}
    {!!(attachedProblems.length || documents.length || sources.length || attachedChecks.length) && <ul className="ck-attached ck-conversation-attachments" aria-label="Draft attachments">
      {attachedProblems.map((item, index) => <ConversationAttachment key={JSON.stringify(item.reference)} kind="problem" label={item.label}
        onRemove={() => setAttachedProblems(current => current.filter((_, at) => at !== index))} />)}
      {documents.map(document => <ConversationAttachment key={document.name} kind="document" label={document.name} base64={document.base64}
        onRemove={() => setDocuments(current => current.filter(item => item.name !== document.name))} />)}
      {sources.map(source => <ConversationAttachment key={source.id} kind="library" label={source.fileName}
        onRemove={() => setSourceIds(current => current.filter(id => id !== source.id))} />)}
      {attachedChecks.map(item => <ConversationAttachment key={item.id} kind="check" label={checkName(item)}
        onRemove={() => setAttachedChecks(current => current.filter(entry => entry.id !== item.id))} />)}
    </ul>}
    <textarea ref={input} className="ck-focus" rows={2} maxLength={2000} aria-label={conversation ? "Message to ORIN" : "Follow-up check"} value={draft} onFocus={conversation?.onFocus}
      placeholder={conversation?.placeholder ?? (available ? 'What should ORIN check next?' : 'Prepare a follow-up while this check runs')}
      onChange={event => changeDraft(event.target.value, event.target.selectionStart)}
      onKeyDown={event => {
        if (mention && event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
        if (selectMention(event)) return;
        handleComposerEnter(event, expanded, () => composer.current?.requestSubmit(), changeDraft);
      }} />
    <div className="ck-input-actions">
      <button type="button" ref={addTrigger} disabled={!!conversation?.editing} className="ck-round ck-add-trigger" aria-label="Add to check" aria-haspopup="dialog" aria-expanded={addOpen} onClick={() => { if (!addOpen) library.refresh(); setMention(null); setAddOpen(!addOpen || !!mention); }}><Icon icon={Plus} /></button>
      <CheckPermission value={prefs.mode} onChange={mode => {
        void (async () => {
          try {
            if (check.projectId && typeof api.setConversationPermission === 'function') await api.setConversationPermission(check.projectId, mode);
            if (conversation?.setPermission) conversation.setPermission(mode);
            else if (check.projectId) savePermission(check.projectId, mode);
          } catch { setAttachmentMessage('Permission mode could not be saved. Try again.'); }
        })();
      }} />
      <Select aria-label="Check mode" className={`ck-mode-select${modeChangedByOrin ? ' ck-mode-changed' : ''}`} value={effectiveMode} disabled={!!conversation?.editing || sending}
        options={CHECK_MODES.map(option => ({ ...option, disabled: !hasFolder && (conversation ? option.value === 'both' : option.value !== 'code') }))}
        onChange={value => { setModeChangedByOrin(false); setMode(value as CheckMode); }} />
      {modeChangedByOrin && <span className="visually-hidden" role="status">ORIN changed Check mode to Code.</span>}
      <button type="submit" aria-label={conversation ? "Send" : "Send follow-up"} className="ck-round ck-follow-up-send" disabled={!canSend}><Icon icon={ArrowUp} /></button>
    </div>
    {addOpen && <div ref={addMenu} className="ck-menu ck-attachment-menu ck-follow-up-menu" role="dialog" aria-label="Add to check"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation(); closeMenu(); (mention ? input : addTrigger).current?.focus(); return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        if (!(event.target instanceof HTMLButtonElement)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = buttons.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
      <CheckAddOptions query={query} onDocument={() => { finishAttachment(); documentInput.current?.click(); }}
        onRepository={() => { finishAttachment(); setAddingSource('repository'); }} />
      {(problemOptions.error || problemOptions.problems.length > 0) && <section aria-label="Problems"><h2>Problems</h2>
        {problemOptions.error ? <p>Problems could not be loaded.</p> : problemOptions.problems.filter(item => item.label.toLowerCase().includes(query)
          && !attachedProblems.some(attached => JSON.stringify(attached.reference) === JSON.stringify(item.reference))).slice(0, 12).map(item =>
          <button type="button" key={JSON.stringify(item.reference)} onClick={() => { setAttachedProblems(current => [...current, item]); finishAttachment(); }}>
            <Icon icon={FileText} /><span>{item.label}</span>
          </button>)}
        <p>Showing problems from attached checks and recent checks. Open an older check to include its problems.</p>
      </section>}
      {!!matchingChecks.length && <section aria-label="Recent Checks"><h2>Recent Checks</h2>
        {matchingChecks.map(item => <button key={item.id} type="button" onClick={() => {
          if (!getCheck(item.id)) saveCheck(item);
          setAttachedChecks(current => [...current, item]);
          finishAttachment();
        }}><Icon icon={SquareChartGantt} /><span>{checkName(item)}</span>
          <CheckAttachmentCount check={item} />
        </button>)}
      </section>}
      {mention && <section aria-label="Projects"><h2>Projects</h2>
        {mentionProjects.map(item => <button key={item.id} type="button" onClick={() => {
          onNavigate({ name: 'new-check', draft: {
            projectId: item.id, focus: draft.slice(0, mention.start) + draft.slice(mention.end),
            mode: projectLocalFolder(item) ? mode : 'code', documents,
          } });
        }}><Icon icon={Folder} /><span>{item.name}</span><small className="ck-attachment-count">New check</small></button>)}
        {!mentionProjects.length && <p>No matching projects.</p>}
      </section>}
      <section aria-label="Library"><h2>Library</h2>
        {!check.projectId ? <p>No project library available.</p> : !canUseLibrary ? <p>Choose Code or Code and browser to attach library files.</p> :
          <CheckLibraryList library={library} attached={sources} filter={mention?.query} onAttach={source => { setSourceIds(current => [...new Set([...current, source.id])]); finishAttachment(); }} />}
      </section>
    </div>}
    {!addOpen && <CheckComposerNotices notices={[
      ...(libraryRequiresCode ? [{ title: 'Library files need a code check', description: 'Choose Code or Code and browser, or remove the attached library files.', tone: 'warning' as const }] : []),
      ...(revisionHasAttachments ? [{ title: 'Attachments need a new check', description: 'Remove the attachments to revise this browser test, or stop editing the test to send them with a new check.', tone: 'warning' as const }] : []),
      ...(attachmentMessage ? [{ title: 'Check attachments', description: attachmentMessage, tone: 'warning' as const }] : []),
    ]} />}
  </form><CheckDocumentInput input={documentInput} onFiles={addDocuments} />
    {addingSource && (project ? <CheckAddSource projectId={project.id} initialChoice={addingSource} onClose={() => setAddingSource(null)} onSaved={library.refresh} />
      : <ProjectCreateModal isOpen onClose={() => setAddingSource(null)} onCreate={async () => undefined} onRepositorySelected={source => {
        setAddingSource(null);
        onNavigate({ name: 'new-check', draft: {
          focus: draft, mode, documents,
          ...(source.type === 'local-repository' ? { folder: source.path } : { githubUrl: source.repoUrl }),
        } });
      }} />)}</>;
}

