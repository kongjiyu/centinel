import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowUp, ChevronDown, Clock, ExternalLink, FileText, Folder, History, Search, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { useImportSources } from '../../components/RecentProjectDetails';
import { useChecks } from '../../check/store';
import { CHECK_MODES, type CheckDocument, type CheckMode, type CheckRecord, type StartCheckInput } from '../../check/types';
import { startCheck } from '../../check/runner';
import { projectLocalFolder } from '../../check/projectWorkspace';
import { setMode as savePermission, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import type { Artifact, Project, Screen } from '../../types';
import { CheckPermission } from './CheckPermission';
import { CheckDocumentPicker, readCheckDocuments } from './CheckDocumentPicker';
import { animateComposerArrival } from './composerTransition';
import { CheckAddSource, CheckLibraryList, type CheckLibrary } from './CheckSourceLibrary';
import { handleComposerEnter } from './composerKeys';
import { findCheckMention } from './checkMention';
import { rankMentionChecks, rankMentionProjects, useMentionSelection } from './checkMentionSelection';
import { CheckAttachmentCount } from './CheckAttachmentCount';
import { CheckComposerNotices } from './CheckComposerNotices';
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

export function CheckProjectLayout({ header, children, composer, sidebar, expanded, onCloseSidebar, contentKey }: {
  header: ReactNode; children: ReactNode; composer: ReactNode; sidebar?: ReactNode;
  expanded?: boolean; onCloseSidebar?(): void; contentKey?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pane = contentRef.current;
    const panel = pane?.querySelector<HTMLElement>('.ck-panel');
    const layout = pane?.parentElement;
    if (!panel || !layout) return;
    const measure = () => layout.style.setProperty('--ck-docked-width', panel.getBoundingClientRect().width + 'px');
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    return () => { observer?.disconnect(); layout.style.removeProperty('--ck-docked-width'); };
  }, [contentKey, expanded]);
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

const historyDate = new Intl.DateTimeFormat('en-US', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function checkDateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  const parts = Object.fromEntries(historyDate.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
}

export function CheckProjectHeader({ check, project, onNavigate, library }: {
  check: Pick<CheckRecord, 'projectName' | 'projectId' | 'folder' | 'githubUrl'> & { id?: string };
  project?: Project; onNavigate: Navigate; library: CheckLibrary;
}) {
  const [panel, setPanel] = useState<'sources' | 'history' | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const header = useRef<HTMLElement>(null);
  const sourcesButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyInput = useRef<HTMLInputElement>(null);
  const result = useImportSources(panel === 'sources' ? check.projectId : undefined);
  const checks = useChecks();
  const matching = checks.filter(item => check.projectId && item.projectId === check.projectId
    && (item.focus?.trim() || item.projectName).toLowerCase().includes(query.trim().toLowerCase()));
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
          <span>{item.focus?.trim() || item.projectName}</span><time dateTime={item.createdAt}>{checkDateLabel(item.createdAt)}</time>
        </button></li>)}</ul> : <p>{query.trim() ? 'No matching checks.' : 'No checks saved for this project.'}</p>}
      </div>
    </div>}
    {panel === 'sources' && <div className="ck-menu ck-header-popover ck-detail-sources" role="dialog" aria-label="Project sources">
      <div className="ck-header-scroll">
        <section className="ck-source-section" aria-label="Project locations">
          <div className="ck-library-heading"><strong>Sources</strong>{check.projectId && <button type="button" className="ck-round" aria-label="Add source" title="Add source" onClick={() => setAdding(true)}><Icon icon={Plus} /></button>}</div>
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
    {adding && check.projectId && <CheckAddSource projectId={check.projectId} onClose={() => { setAdding(false); sourcesButton.current?.focus(); }}
      onSaved={() => { library.refresh(); setPanel(null); }} />}
  </header>;
}

export function CheckFollowUp({ check, projects, onNavigate, available, library, conversation }: { check: Pick<CheckRecord, 'id' | 'projectId' | 'mode' | 'folder'>; projects: Project[]; onNavigate: Navigate; available: boolean; library: CheckLibrary; conversation?: ConversationComposer }) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<CheckMode>(check.mode);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [mention, setMention] = useState<ReturnType<typeof findCheckMention>>(null);
  const [attachedChecks, setAttachedChecks] = useState<CheckRecord[]>([]);
  const [addingSource, setAddingSource] = useState(false);
  const recent = useChecks();
  const [sources, setSources] = useState<Artifact[]>([]);
  const [documents, setDocuments] = useState<CheckDocument[]>([]);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const composer = useRef<HTMLFormElement>(null);
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
    if (composer.current) animateComposerArrival(check.id, composer.current);
  }, [check.id]);
  const project = projects.find(item => item.id === check.projectId);
  const hasFolder = !!(projectLocalFolder(project) || check.folder);
  const effectiveMode = conversation?.editing ? 'browser' : hasFolder || conversation ? mode : 'code';
  const libraryRequiresCode = effectiveMode === 'browser' && sources.length > 0;
  const revisionHasAttachments = !!conversation?.editing && (documents.length > 0 || sources.length > 0 || attachedChecks.length > 0);
  const canSend = available && project && draft.trim() && !sending && !conversation?.sending && !libraryRequiresCode && !revisionHasAttachments && !mention;
  const query = mention?.query.trim().toLowerCase() ?? '';
  const matchingChecks = rankMentionChecks(recent.filter(item => check.projectId && item.projectId === check.projectId
    && item.id !== check.id && !attachedChecks.some(attached => attached.id === item.id)
    && [item.projectName, item.focus].join(' ').toLowerCase().includes(query)));
  const mentionProjects = rankMentionProjects(projects.filter(item => item.id !== check.projectId), recent, query);
  const selectMention = useMentionSelection(addMenu, mention?.query);
  const showAddAction = (name: string) => !query || name.toLowerCase().includes(query);
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
  return <><form ref={composer} className={`ck-composer ck-follow-up${expanded ? ' is-expanded' : ''}`} onSubmit={event => {
    event.preventDefault();
    if (!canSend) return;
    const focus = draft.trim();
    const request: StartCheckInput = { projectId: project.id, documents, focus, mode: effectiveMode,
      ...(effectiveMode === 'code' ? {} : { browserRequest: focus }),
      referenceCheckIds: [...(conversation ? [] : [check.id]), ...attachedChecks.map(item => item.id)],
      ...(sources.length ? { sourceArtifactIds: sources.map(source => source.id) } : {}) };
    if (conversation) {
      conversation.send(request);
      setDraft('');
      setDocuments([]);
      setSources([]);
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
    {!!documents.length && <ul className="ck-attached">{documents.map(document => <li className="ck-chip" key={document.name}>
      <Icon icon={FileText} /><span>{document.name}</span><button type="button" aria-label={`Remove ${document.name}`} onClick={() => setDocuments(current => current.filter(item => item.name !== document.name))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!sources.length && <ul className="ck-attached">{sources.map(source => <li className="ck-chip" key={source.id}>
      <Icon icon={FileText} /><span>{source.fileName}</span><button type="button" aria-label={`Remove source ${source.fileName}`} onClick={() => setSources(current => current.filter(item => item.id !== source.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!attachedChecks.length && <ul className="ck-attached">{attachedChecks.map(item => <li className="ck-chip" key={item.id}>
      <Icon icon={Clock} /><span>{item.focus || item.projectName}</span><button type="button" aria-label={'Remove check ' + (item.focus || item.projectName)} onClick={() => setAttachedChecks(current => current.filter(entry => entry.id !== item.id))}><Icon icon={X} /></button>
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
      <CheckPermission value={prefs.mode} onChange={mode => { if (conversation?.setPermission) { conversation.setPermission(mode); return; } if (check.projectId) savePermission(check.projectId, mode); }} />
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
      {(showAddAction('Add Document') || (project && showAddAction('Add source'))) && <section aria-label="Add">
        <h2>Add</h2>
        {showAddAction('Add Document') && <button type="button" onClick={() => { finishAttachment(); setPicker(true); }}><Icon icon={FileText} />Add Document</button>}
        {project && showAddAction('Add source') && <button type="button" onClick={() => { finishAttachment(); setAddingSource(true); }}><Icon icon={Plus} />Add source</button>}
      </section>}
      <section aria-label="Recent Checks"><h2>Recent Checks</h2>
        {matchingChecks.length ? matchingChecks.map(item => <button key={item.id} type="button" onClick={() => {
          setAttachedChecks(current => [...current, item]);
          finishAttachment();
        }}><Icon icon={Clock} /><span>{item.focus || item.projectName}</span>
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
          <CheckLibraryList library={library} attached={sources} filter={mention?.query} onAttach={source => { setSources(current => current.some(item => item.id === source.id) ? current : [...current, source]); finishAttachment(); }} />}
      </section>
    </div>}
    {!addOpen && <CheckComposerNotices notices={[
      ...(libraryRequiresCode ? [{ title: 'Library files need a code check', description: 'Choose Code or Code and browser, or remove the attached library files.', tone: 'warning' as const }] : []),
      ...(revisionHasAttachments ? [{ title: 'Attachments need a new check', description: 'Remove the attachments to revise this browser test, or stop editing the test to send them with a new check.', tone: 'warning' as const }] : []),
      ...(attachmentMessage ? [{ title: 'Check attachments', description: attachmentMessage, tone: 'warning' as const }] : []),
    ]} />}
  </form><CheckDocumentPicker open={picker} onClose={() => setPicker(false)} onSelect={files => {
    void readCheckDocuments(files).then(({ accepted, message }) => {
      setDocuments(current => [...current, ...accepted.filter(item => !current.some(existing => existing.name === item.name))]);
      setAttachmentMessage(message);
    });
  }} />{addingSource && project && <CheckAddSource projectId={project.id} onClose={() => setAddingSource(false)} onSaved={library.refresh} />}</>;
}

