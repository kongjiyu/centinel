import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Clock, ChevronDown, ExternalLink, FileText, Folder, History, Search, Maximize2, Minimize2, Plus, SquareChartGantt, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { api } from '../../api/client';
import { problemCountTone, ProblemCountIcon } from '../../components/ProblemCountIcon';
import { OverflowText } from '../../components/OverflowText';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ProjectCreateModal } from '../../components/ProjectCreateModal';
import { useImportSources } from '../../components/RecentProjectDetails';
import { getCheck, useChecks } from '../../check/store';
import { checkName } from '../../check/checkName';
import { CHECK_MODES, type CheckDocument, type CheckMode, type CheckRecord, type StartCheckInput } from '../../check/types';
import { startCheck } from '../../check/runner';
import { projectLocalFolder } from '../../check/projectWorkspace';
import { setMode as savePermission, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import type { Project, Screen } from '../../types';
import { CheckPermission } from './CheckPermission';
import { attachCheckDocuments, CheckDocumentInput, PageDocumentDropIndicator, usePageDocumentDrop, type CheckDocumentBatch } from './CheckDocumentPicker';
import { CheckAddOptions, SourceActions } from './CheckAddOptions';
import { animateComposerArrival } from './composerTransition';
import { CheckAddSource, CheckLibraryGroups, CheckLibraryList, type CheckLibrary, type CheckSourceChoice } from './CheckSourceLibrary';
import { handleComposerEnter } from './composerKeys';
import { findCheckMention } from './checkMention';
import { rankMentionChecks, rankMentionProjects, useMentionSelection } from './checkMentionSelection';
import { CheckAttachmentCount } from './CheckAttachmentCount';
import { CheckComposerNotices } from './CheckComposerNotices';
import { checkReference, draftContentSignature, readConversationDraft, rememberAcknowledgedRequest, writeConversationDraft, type ProblemAttachment } from '../../check/conversation';
import type { ConversationReference } from '../../check/conversationTypes';
import { useProblemMentions } from '../../check/problemMentions';
import { rememberCheckTransition } from '../../check/checkTransition';
import { rememberConversationReturn } from '../../check/projectNavigation';
import './Check.css';

type Navigate = (screen: Screen) => void;
type ConversationComposer = {
  editing?: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement>;
  placeholder: string;
  sending: boolean;
  onFocus?(): void;
  send(request: StartCheckInput): void;
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

export function CheckProjectHeader({ check, project, onNavigate, library, projectAction, checkHeading }: {
  check: Pick<CheckRecord, 'projectName' | 'projectId' | 'folder' | 'githubUrl'> & { id?: string };
  project?: Project; onNavigate: Navigate; library: CheckLibrary; projectAction?: ReactNode;
  checkHeading?: { name: string; duration?: string; problems?: Pick<CheckRecord, 'problemCount' | 'problemRisk' | 'highProblemCount'>; report?: ReactNode };
}) {
  const [panel, setPanel] = useState<'sources' | 'history' | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<CheckSourceChoice | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const header = useRef<HTMLElement>(null);
  const sourcesButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyInput = useRef<HTMLInputElement>(null);
  const result = useImportSources(panel === 'sources' ? check.projectId : undefined);
  const checks = useChecks();
  const matching = checks.filter(item => check.projectId && item.projectId === check.projectId
    && checkName(item).toLowerCase().includes(query.trim().toLowerCase()));
  const folder = project?.workspacePath || project?.managedWorkspacePath || check.folder;
  const projectId = project?.id ?? check.projectId;

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
    <div className="ck-header-toolbar" role="group" aria-label={checkHeading ? 'Check actions and details' : 'Project actions'}>
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
    </div>
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
          {folder && <div className="ck-source-row">
            <Icon icon={Folder} /><div><strong>Workspace folder</strong><small title={folder}>{folder}</small></div>
            <button type="button" className="ck-round" aria-label="Open workspace folder" title="Open workspace folder" onClick={() => {
              setFolderError(null);
              if (!('__TAURI_IPC__' in window)) { setFolderError('Open the workspace folder from the desktop app.'); return; }
              void invoke('open_workspace_folder', { folder }).catch(error => setFolderError(typeof error === 'string' ? error : 'The workspace folder could not be opened.'));
            }}><Icon icon={ExternalLink} /></button>
          </div>}
          {folderError && <p role="status">{folderError}</p>}
          {check.githubUrl && !result?.sources.some(source => source.location === check.githubUrl) && <div className="ck-source-row">
            <Icon icon={Folder} /><div><strong>GitHub repository</strong><small title={check.githubUrl}>{check.githubUrl}</small></div>
          </div>}
        </section>
        <section className="ck-source-section" aria-label="Library">
          <div className="ck-library-heading"><strong>Library</strong></div>
          {(result?.sources ?? []).map(source => <div className="ck-source-row" key={source.id}><Icon icon={FileText} /><div>
            <strong title={source.name}>{source.name}</strong>{source.location && <small title={source.location}>{source.location}</small>}
          </div></div>)}
          <CheckLibraryGroups library={library} listedIds={result?.sources.map(source => source.id) ?? []} />
          {!result && check.projectId && <p role="status">Loading project sources…</p>}
          {result?.incomplete && <p role="status">Some sources could not be loaded.</p>}
        </section>
      </div>
    </div>}
    {adding && check.projectId && <CheckAddSource projectId={check.projectId} initialChoice={adding} onClose={() => { setAdding(null); sourcesButton.current?.focus({ preventScroll: true }); }}
      onSaved={() => { library.refresh(); setPanel(null); }} />}
  </header>;
}

export function CheckFollowUp({ check, projects, onNavigate, available, library, conversation, explainProblem }: {
  check: Pick<CheckRecord, 'id' | 'projectId' | 'mode' | 'folder'>; projects: Project[]; onNavigate: Navigate; available: boolean; library: CheckLibrary;
  conversation?: ConversationComposer; explainProblem?: ProblemAttachment;
}) {
  // Check and Project render this composer with a key for the current route.
  const [saved] = useState(() => readConversationDraft(check.projectId ?? '', check.id));
  const [draft, setDraft] = useState(saved.text);
  const [mode, setMode] = useState<CheckMode>(() => saved.mode ?? check.mode);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const documentInput = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mention, setMention] = useState<ReturnType<typeof findCheckMention>>(null);
  const [attachedChecks, setAttachedChecks] = useState<CheckRecord[]>(() => [...new Set([...saved.checkIds, ...(check.id ? [check.id] : [])])]
    .map(getCheck).filter((item): item is CheckRecord => !!item && item.projectId === check.projectId && (!!item.reviewId || !!item.autoTestId)));
  const [attachedProblems, setAttachedProblems] = useState(saved.problems);
  const [addingSource, setAddingSource] = useState<CheckSourceChoice | null>(null);
  const recent = useChecks();
  const [sourceIds, setSourceIds] = useState(saved.sourceIds ?? []);
  const sources = sourceIds.map(id => library.items?.find(item => item.id === id) ?? { id, fileName: 'Saved source' });
  const [documents, setDocuments] = useState<CheckDocument[]>(saved.documents ?? []);
  const [readingDocuments, setReadingDocuments] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
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
  useLayoutEffect(() => {
    if (!check.projectId) return;
    writeConversationDraft(check.projectId, { ...readConversationDraft(check.projectId, check.id), text: draft, mode,
      checkIds: attachedChecks.map(item => item.id), problems: attachedProblems,
      documents: documents.filter(item => item.saved).map(item => ({ ...item, base64: '' })), sourceIds }, check.id);
  }, [check.id, check.projectId, draft, mode, attachedChecks, attachedProblems, documents, sourceIds]);
  const hasFolder = !!(projectLocalFolder(project) || check.folder);
  const effectiveMode = conversation?.editing ? 'browser' : hasFolder || conversation ? mode : 'code';
  const libraryRequiresCode = effectiveMode === 'browser' && sources.length > 0;
  const revisionHasAttachments = !!conversation?.editing && (documents.length > 0 || sources.length > 0 || attachedChecks.length > 0);
  const canSend = project && draft.trim() && !sending && !readingDocuments && !conversation?.sending && !libraryRequiresCode && !revisionHasAttachments && !mention;
  const problemOptions = useProblemMentions(check.projectId, [...attachedChecks, ...recent.filter(item => !attachedChecks.some(attached => attached.id === item.id))], addOpen);
  const query = mention?.query.trim().toLowerCase() ?? '';
  const matchingChecks = rankMentionChecks(recent.filter(item => check.projectId && item.projectId === check.projectId
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
  return <>{dragging && <PageDocumentDropIndicator anchor={composer} />}<form ref={composer} className={`ck-composer ck-follow-up${expanded ? ' is-expanded' : ''}`} onSubmit={async event => {
    event.preventDefault();
    if (!canSend) return;
    const focus = draft.trim();
    if (!conversation?.editing && typeof api.sendConversationRequest === 'function') {
      setSending(true);
      try {
        const owner = sessionStorage.getItem('centinel:supabase-user-id');
        const current = readConversationDraft(project.id, check.id);
        const checkReferences = attachedChecks.filter(item => item.projectId === project.id).map(item => {
          const reference = checkReference(item);
          return { label: checkName(item), reference: {
            ...(reference.reviewId && !attachedProblems.some(problem => problem.reference.reviewId === reference.reviewId) ? { reviewId: reference.reviewId } : {}),
            ...(reference.autoTestId && !attachedProblems.some(problem => problem.reference.autoTestId === reference.autoTestId) ? { autoTestId: reference.autoTestId } : {}),
          } };
        }).filter(item => Object.keys(item.reference).length > 0);
        const fileName = (name: string) => name.split(/[\\/]/).pop() ?? '';
        const attachments: Array<{ label: string; reference: ConversationReference }> = [
          ...checkReferences, ...attachedProblems,
          ...sources.map(item => ({ label: fileName(item.fileName), reference: { artifactId: item.id } })),
          ...documents.filter(item => item.saved?.projectId === project.id)
            .map(item => ({ label: fileName(item.name), reference: { artifactId: item.saved!.artifactId } })),
        ];
        const references = attachments.map(item => item.reference);
        const referenceLabels = attachments.map(item => item.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) || null);
        if (documents.some(item => item.saved?.projectId !== project.id)) throw new Error('Some documents are not saved yet. Add them again before sending.');
        if (references.some(ref => !Object.keys(ref).length)) throw new Error('An attached check has no saved evidence yet.');
        const payload = { text: focus, mode: effectiveMode, permission: prefs.mode, references,
          ...(referenceLabels.some(Boolean) ? { referenceLabels } : {}) };
        const requestSignature = JSON.stringify({ focus, mode: effectiveMode, permission: prefs.mode, references,
          ...(payload.referenceLabels ? { referenceLabels } : {}) });
        const id = current.requestSignature === requestSignature && current.requestId ? current.requestId : crypto.randomUUID();
        writeConversationDraft(project.id, { ...current, requestId: id, requestSignature }, check.id);
        const accepted = await api.sendConversationRequest(project.id, { id, ...payload });
        if (owner !== sessionStorage.getItem('centinel:supabase-user-id')) return;
        rememberAcknowledgedRequest(project.id, accepted);
        if (!mounted.current) return;
        const latest = readConversationDraft(project.id, check.id);
        if (latest.requestId === id) {
          if (draftContentSignature(latest) === draftContentSignature(current)) {
            writeConversationDraft(project.id, { text: '', checkIds: [], problems: [], mode }, check.id);
            setDraft(''); setDocuments([]); setSourceIds([]); setAttachedChecks([]); setAttachedProblems([]);
          } else {
            writeConversationDraft(project.id, { ...latest, requestId: undefined, requestSignature: undefined }, check.id);
          }
        }
        setAttachmentMessage(null);
        if (check.id) {
          rememberCheckTransition(check.id, composer.current?.closest('.ck-detail-layout')?.querySelector('.ck-detail-content .ck-panel') ?? null);
          rememberConversationReturn(project.id);
          onNavigate({ name: 'project', projectId: project.id });
        }
      } catch (error) {
        if (mounted.current) setAttachmentMessage(error instanceof Error && 'status' in error && error.status === 404 && error.message === 'Not found'
          ? 'The local service does not support chat messages yet. Restart ORIN’s development service and resend. Your draft is saved.'
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
      return;
    }
    setSending(true);
    const next = startCheck(request, { api, projects: () => projects });
    onNavigate({ name: 'check', checkId: next.id });
  }}>
    <button type="button" className="ck-composer-expand" aria-label={expanded ? 'Collapse composer' : 'Expand composer'} aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}><Icon icon={expanded ? Minimize2 : Maximize2} /></button>
    {conversation?.editing}
    {!!attachedProblems.length && <ul className="ck-attached">{attachedProblems.map((item, index) => <li className="ck-chip" key={JSON.stringify(item.reference)}>
      <Icon icon={FileText} /><span>{item.label}</span><button type="button" aria-label={'Remove problem ' + item.label} onClick={() => setAttachedProblems(current => current.filter((_, at) => at !== index))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!documents.length && <ul className="ck-attached">{documents.map(document => <li className="ck-chip" key={document.name}>
      <Icon icon={FileText} /><span>{document.name}</span><button type="button" aria-label={`Remove ${document.name}`} onClick={() => setDocuments(current => current.filter(item => item.name !== document.name))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!sources.length && <ul className="ck-attached">{sources.map(source => <li className="ck-chip" key={source.id}>
      <Icon icon={FileText} /><span>{source.fileName}</span><button type="button" aria-label={`Remove source ${source.fileName}`} onClick={() => setSourceIds(current => current.filter(id => id !== source.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!attachedChecks.length && <ul className="ck-attached">{attachedChecks.map(item => <li className="ck-chip" key={item.id}>
      <Icon icon={SquareChartGantt} /><span>{checkName(item)}</span><button type="button" aria-label={'Remove check ' + checkName(item)} onClick={() => setAttachedChecks(current => current.filter(entry => entry.id !== item.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
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
      <Select aria-label="Check mode" className="ck-mode-select" value={effectiveMode} disabled={!!conversation?.editing}
        options={CHECK_MODES.map(option => ({ ...option, disabled: !hasFolder && (conversation ? option.value === 'both' : option.value !== 'code') }))}
        onChange={value => setMode(value as CheckMode)} />
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
        {!check.projectId ? <p>No project library available.</p> : effectiveMode === 'browser' ? <p>Choose Code or Code and browser to attach library files.</p> :
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

