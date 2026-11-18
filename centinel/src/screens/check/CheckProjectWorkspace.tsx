import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowUp, ChevronDown, Clock, ExternalLink, FileText, Folder, History, Search, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { useImportSources } from '../../components/RecentProjectDetails';
import { getCheck, useChecks } from '../../check/store';
import { checkName } from '../../check/checkName';
import { CHECK_MODES, type CheckDocument, type CheckMode, type CheckRecord, type StartCheckInput } from '../../check/types';
import { startCheck } from '../../check/runner';
import { projectLocalFolder } from '../../check/projectWorkspace';
import { setMode as savePermission, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import type { Project, Screen } from '../../types';
import { CheckPermission } from './CheckPermission';
import { attachCheckDocuments, CheckDocumentPicker, readDroppedCheckDocuments, type CheckDocumentBatch } from './CheckDocumentPicker';
import { CheckAddOptions, SourceActions } from './CheckAddOptions';
import { animateComposerArrival } from './composerTransition';
import { CheckAddSource, CheckLibraryList, type CheckLibrary, type CheckSourceChoice } from './CheckSourceLibrary';
import { handleComposerEnter } from './composerKeys';
import { findCheckMention } from './checkMention';
import { rankMentionChecks, rankMentionProjects, useMentionSelection } from './checkMentionSelection';
import { CheckAttachmentCount } from './CheckAttachmentCount';
import { CheckComposerNotices } from './CheckComposerNotices';
import { checkReference, draftContentSignature, readConversationDraft, rememberAcknowledgedRequest, writeConversationDraft } from '../../check/conversation';
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

export function CheckProjectLayout({ header, children, composer, sidebar, expanded, onCloseSidebar }: {
  header: ReactNode; children: ReactNode; composer: ReactNode; sidebar?: ReactNode;
  expanded?: boolean; onCloseSidebar?(): void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pane = contentRef.current;
    const layout = pane?.parentElement;
    if (!pane || !layout || expanded) return;
    // Layout width excludes the scroll gutters and stays stable during the card transition.
    const measure = () => {
      if (pane.clientWidth > 0) layout.style.setProperty('--ck-response-pane-width', `${pane.clientWidth}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(pane);
    return () => { observer?.disconnect(); layout.style.removeProperty('--ck-response-pane-width'); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded || !onCloseSidebar) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[aria-modal=true]')) onCloseSidebar(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded, onCloseSidebar]);
  return <div className={`ck-detail-layout${sidebar ? '' : ' is-without-sidebar'}${expanded ? ' is-sidebar-expanded' : ''}`}>
    <div className="ck-glow" aria-hidden="true" />
    {header}
    <div className="ck-detail-content" ref={contentRef} hidden={expanded}>{children}</div>
    <div className="ck-docked-composer" hidden={expanded}>{composer}</div>
    {sidebar}
  </div>;
}

export function CheckProjectHeader({ check, project, onNavigate, library }: {
  check: Pick<CheckRecord, 'projectName' | 'projectId' | 'folder' | 'githubUrl'> & { id?: string };
  project?: Project; onNavigate: Navigate; library: CheckLibrary;
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
  const goToProject = () => { if (project) onNavigate({ name: 'project', projectId: project.id }); };

  useEffect(() => {
    if (!panel) return;
    if (panel === 'history') historyInput.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);

  return <header className="ck-detail-header" ref={header} onKeyDown={event => {
    if (event.key !== 'Escape' || !panel || adding) return;
    event.stopPropagation();
    (panel === 'history' ? historyButton : sourcesButton).current?.focus();
    setPanel(null);
  }}>
    {check.id && project && <button type="button" className="ck-header-action ck-header-icon" aria-label="Back to project" title="Back to project" onClick={goToProject}><Icon icon={ArrowLeft} /></button>}
    <button type="button" className="ck-header-action ck-source-trigger" aria-label={`Project sources for ${check.projectName}`}
      aria-haspopup="dialog" aria-expanded={panel === 'sources'} ref={sourcesButton} onClick={() => setPanel(value => value === 'sources' ? null : 'sources')}>
      <Icon icon={Folder} /><span>{check.projectName}</span><Icon icon={ChevronDown} />
    </button>
    {check.projectId && <button type="button" className="ck-header-action ck-header-icon" aria-label="Check history" title="Check history"
      aria-haspopup="dialog" aria-expanded={panel === 'history'} ref={historyButton} onClick={() => {
        setQuery('');
        setPanel(value => value === 'history' ? null : 'history');
      }}><Icon icon={History} /></button>}
    {panel === 'history' && <div className="ck-menu ck-header-popover ck-check-history" role="dialog" aria-label="Check history">
      <label className="ck-popover-search"><Icon icon={Search} /><input type="search" ref={historyInput}
        aria-label="Filter checks by name" placeholder="Filter checks by name" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="ck-header-scroll">
        {matching.length ? <ul>{matching.map(item => <li key={item.id}><button type="button" className="ck-history-row"
          aria-current={item.id === check.id ? 'page' : undefined}
          onClick={() => { setPanel(null); onNavigate({ name: 'check', checkId: item.id }); }}>
          <span>{checkName(item)}</span>
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
          {(result?.sources ?? []).map(source => <div className="ck-source-row" key={source.id}><Icon icon={FileText} /><div>
            <strong title={source.name}>{source.name}</strong>{source.location && <small title={source.location}>{source.location}</small>}
          </div></div>)}
          {check.githubUrl && !result?.sources.some(source => source.location === check.githubUrl) && <div className="ck-source-row">
            <Icon icon={Folder} /><div><strong>GitHub repository</strong><small title={check.githubUrl}>{check.githubUrl}</small></div>
          </div>}
          {!result && check.projectId && <p role="status">Loading project sources…</p>}
          {result?.incomplete && <p role="status">Some sources could not be loaded.</p>}
          {result && !result.incomplete && !result.sources.length && !folder && !check.githubUrl && <p>No sources added yet.</p>}
        </section>
        <section className="ck-source-section" aria-label="Library">
          <div className="ck-library-heading"><strong>Library</strong></div>
          {check.projectId ? <CheckLibraryList library={library} compact /> : <p>No project library available.</p>}
        </section>
      </div>
    </div>}
    {adding && check.projectId && <CheckAddSource projectId={check.projectId} initialChoice={adding} onClose={() => { setAdding(null); sourcesButton.current?.focus(); }}
      onSaved={() => { library.refresh(); setPanel(null); }} />}
  </header>;
}

export function CheckFollowUp({ check, projects, onNavigate, available, library, conversation }: { check: Pick<CheckRecord, 'id' | 'projectId' | 'mode' | 'folder'>; projects: Project[]; onNavigate: Navigate; available: boolean; library: CheckLibrary; conversation?: ConversationComposer }) {
  // Check and Project render this composer with a key for the current route.
  const [saved] = useState(() => readConversationDraft(check.projectId ?? '', check.id));
  const [draft, setDraft] = useState(saved.text);
  const [mode, setMode] = useState<CheckMode>(() => saved.mode ?? check.mode);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false);
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
  return <><form ref={composer} className={`ck-composer ck-follow-up${expanded ? ' is-expanded' : ''}`} onDragOver={event => {
    if (!conversation?.editing && event.dataTransfer.types.includes('Files')) event.preventDefault();
  }} onDrop={event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (!conversation?.editing) void addDocuments(() => readDroppedCheckDocuments(event.dataTransfer));
  }} onSubmit={async event => {
    event.preventDefault();
    if (!canSend) return;
    const focus = draft.trim();
    if (!conversation?.editing && typeof api.sendConversationRequest === 'function') {
      setSending(true);
      try {
        const owner = sessionStorage.getItem('centinel:supabase-user-id');
        const current = readConversationDraft(project.id, check.id);
        const checkReferences = attachedChecks.filter(item => item.projectId === project.id).map(checkReference).map(reference => ({
          ...(reference.reviewId && !attachedProblems.some(item => item.reference.reviewId === reference.reviewId) ? { reviewId: reference.reviewId } : {}),
          ...(reference.autoTestId && !attachedProblems.some(item => item.reference.autoTestId === reference.autoTestId) ? { autoTestId: reference.autoTestId } : {}),
        })).filter(reference => Object.keys(reference).length > 0);
        const references = [...checkReferences,
          ...attachedProblems.map(item => item.reference), ...sources.map(item => ({ artifactId: item.id })),
          ...documents.filter(item => item.saved?.projectId === project.id).map(item => ({ artifactId: item.saved!.artifactId }))];
        if (documents.some(item => item.saved?.projectId !== project.id)) throw new Error('Some documents are not saved yet. Add them again before sending.');
        if (references.some(ref => !Object.keys(ref).length)) throw new Error('An attached check has no saved evidence yet.');
        const requestSignature = JSON.stringify({ focus, mode: effectiveMode, permission: prefs.mode, references });
        const id = current.requestSignature === requestSignature && current.requestId ? current.requestId : crypto.randomUUID();
        writeConversationDraft(project.id, { ...current, requestId: id, requestSignature }, check.id);
        const accepted = await api.sendConversationRequest(project.id, { id, text: focus, mode: effectiveMode, permission: prefs.mode, references });
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
          ? 'The local service does not support chat messages yet. Restart Centinel’s development service and resend. Your draft is saved.'
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
      <Icon icon={FileText} /><span>@{item.label}</span><button type="button" aria-label={'Remove problem ' + item.label} onClick={() => setAttachedProblems(current => current.filter((_, at) => at !== index))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!documents.length && <ul className="ck-attached">{documents.map(document => <li className="ck-chip" key={document.name}>
      <Icon icon={FileText} /><span>{document.name}</span><button type="button" aria-label={`Remove ${document.name}`} onClick={() => setDocuments(current => current.filter(item => item.name !== document.name))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!sources.length && <ul className="ck-attached">{sources.map(source => <li className="ck-chip" key={source.id}>
      <Icon icon={FileText} /><span>{source.fileName}</span><button type="button" aria-label={`Remove source ${source.fileName}`} onClick={() => setSourceIds(current => current.filter(id => id !== source.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!attachedChecks.length && <ul className="ck-attached">{attachedChecks.map(item => <li className="ck-chip" key={item.id}>
      <Icon icon={Clock} /><span>@{checkName(item)}</span><button type="button" aria-label={'Remove check ' + checkName(item)} onClick={() => setAttachedChecks(current => current.filter(entry => entry.id !== item.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
    <textarea ref={input} className="ck-focus" rows={2} maxLength={2000} aria-label={conversation ? "Message to Centinel" : "Follow-up check"} value={draft} onFocus={conversation?.onFocus}
      placeholder={conversation?.placeholder ?? (available ? 'What should Centinel check next?' : 'Prepare a follow-up while this check runs')}
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
      <CheckAddOptions query={query} onDocument={() => { finishAttachment(); setPicker(true); }}
        onSource={project ? choice => { finishAttachment(); setAddingSource(choice); } : undefined} />
      <section aria-label="Problems"><h2>Problems</h2>
        {problemOptions.error ? <p>Problems could not be loaded.</p> : problemOptions.problems.filter(item => item.label.toLowerCase().includes(query)
          && !attachedProblems.some(attached => JSON.stringify(attached.reference) === JSON.stringify(item.reference))).slice(0, 12).map(item =>
          <button type="button" key={JSON.stringify(item.reference)} onClick={() => { setAttachedProblems(current => [...current, item]); finishAttachment(); }}>
            <Icon icon={FileText} /><span>{item.label}</span>
          </button>)}
        {!problemOptions.error && !problemOptions.problems.length && <p>No saved problems in recent checks.</p>}
        <p>Showing problems from attached checks and recent checks. Open an older check to include its problems.</p>
      </section>
      <section aria-label="Recent Checks"><h2>Recent Checks</h2>
        {matchingChecks.length ? matchingChecks.map(item => <button key={item.id} type="button" onClick={() => {
          setAttachedChecks(current => [...current, item]);
          finishAttachment();
        }}><Icon icon={Clock} /><span>{checkName(item)}</span>
          <CheckAttachmentCount check={item} />
        </button>) : <p>No matching checks for this project.</p>}
      </section>
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
  </form><CheckDocumentPicker open={picker} onClose={() => setPicker(false)} onSelect={batch => addDocuments(async () => batch)} />
    {addingSource && project && <CheckAddSource projectId={project.id} initialChoice={addingSource} onClose={() => setAddingSource(null)} onSaved={library.refresh} />}</>;
}

