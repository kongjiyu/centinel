import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, ChevronDown, ChevronUp, Clock, Code, Download, FileText, Flag, Folder, Image, Info, ListX, LoaderCircle, Maximize2, Minimize2, MonitorCheck, OctagonAlert, Play, Plus, Sparkles, Square, TriangleAlert, X } from 'lucide-react';
import { api } from '../../api/client';
import { laneNumber } from '../../autotest/presentation';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import type { CheckProblem, CheckResult } from '../../check/result';
import { getCheck, markCheckViewed, useCheck, useChecks } from '../../check/store';
import { CHECK_MODES, type CheckDocument, type CheckMode, type CheckRecord } from '../../check/types';
import { startCheck } from '../../check/runner';
import { projectLocalFolder } from '../../check/projectWorkspace';
import { useCheckData, type CheckData } from '../../check/useCheckData';
import type { RiskLevel } from '../../riskPolicy';
import type { Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { BrowserTiles } from './BrowserTiles';
import { CheckPermission } from './CheckPermission';
import { CheckDocumentPicker, readCheckDocuments } from './CheckDocumentPicker';
import { setMode as savePermission, useProjectPrefs } from '../../check/projectPrefs';
import { animateComposerArrival } from './composerTransition';
import { useImportSources } from '../../components/RecentProjectDetails';
import { invoke } from '@tauri-apps/api/tauri';
import { ExternalLink } from 'lucide-react';
import { CheckAddSource, CheckLibraryList, useCheckLibrary, type CheckLibrary } from './CheckSourceLibrary';
import { handleComposerEnter } from './composerKeys';
import { findCheckMention } from './checkMention';
import type { Artifact } from '../../types';
import { rankMentionChecks, rankMentionProjects, useMentionSelection } from './checkMentionSelection';
import { CheckAttachmentCount } from './CheckAttachmentCount';
import { CheckComposerNotices } from './CheckComposerNotices';
import './Check.css';

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
  const contentRef = useRef<HTMLDivElement>(null);
  const library = useCheckLibrary(projects ? check?.projectId : undefined);
  const data = useCheckData(check);
  const showResult = !!check && !!data && (check.phase === 'failed' || check.phase === 'done' || data.result.finished);
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
  }, [checkId, !!check, !!projects, showResult]);
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
  const references = (check.referenceCheckIds ?? []).map(getCheck)
    .filter((reference): reference is CheckRecord => !!check.projectId && reference?.projectId === check.projectId);
  const content = <>
    {references.length > 0 && <nav className="ck-check-references" aria-label="Referenced checks">
      {references.map(reference => <button type="button" key={reference.id} className="ck-link" onClick={() => onNavigate({ name: 'check', checkId: reference.id })}>{reference.focus || reference.projectName}{typeof reference.problemCount === 'number' && (' · ' + reference.problemCount + (reference.problemCount === 1 ? ' problem' : ' problems'))}</button>)}
    </nav>}
    {showResult ? <ResultView check={check} data={data} onNavigate={onNavigate} /> : <LiveView check={check} data={data} onNavigate={onNavigate} />}
  </>;
  if (!projects) return content;
  const project = projects.find(item => item.id === check.projectId);
  return <div className="ck-detail-layout">
    <div className="ck-glow" aria-hidden="true" />
    <CheckProjectHeader check={check} project={project} onNavigate={onNavigate} library={library} />
    <div className="ck-detail-content" ref={contentRef}>{content}</div>
    <aside className="ck-detail-sidebar" aria-label="Check details">
      <h2>{check.projectName}</h2>
      <p>{CHECK_MODES.find(option => option.value === check.mode)?.label}</p>
      <p>{showResult ? 'Result' : 'Check in progress'}</p>
      {check.projectId && projects.some(project => project.id === check.projectId) &&
        <button type="button" className="ck-link" onClick={() => onNavigate({ name: 'project', projectId: check.projectId! })}>Open project</button>}
    </aside>
    <CheckFollowUp check={check} projects={projects} onNavigate={onNavigate} available={showResult} library={library} />
  </div>;
}

function CheckProjectHeader({ check, project, onNavigate, library }: { check: CheckRecord; project?: Project; onNavigate: Navigate; library: CheckLibrary }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const result = useImportSources(open ? check.projectId : undefined);
  const folder = project?.workspacePath || project?.managedWorkspacePath || check.folder;
  return <header className="ck-detail-header">
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><Icon icon={Folder} /><span>{check.projectName}</span><Icon icon={ChevronDown} /></summary>
      <div className="ck-menu ck-detail-sources" aria-label="Project sources">
        {folder && <div className="ck-library-heading"><p><strong>Workspace directory</strong><span>{folder}</span></p>
          <button type="button" className="ck-round" aria-label="Open workspace folder" onClick={() => {
            setFolderError(null);
            if (!('__TAURI_IPC__' in window)) { setFolderError('Open the workspace folder from the desktop app.'); return; }
            void invoke('open_workspace_folder', { folder }).catch(error => setFolderError(typeof error === 'string' ? error : 'The workspace folder could not be opened.'));
          }}><Icon icon={ExternalLink} /></button>
        </div>}
        {folderError && <p role="status">{folderError}</p>}
        {(result?.sources ?? []).map(source => <p key={source.id}><strong>{source.name}</strong>{source.location && <span>{source.location}</span>}</p>)}
        {check.githubUrl && !result?.sources.some(source => source.location === check.githubUrl) && <p>{check.githubUrl}</p>}
        {!result && check.projectId && <p role="status">Loading project sources…</p>}
        {result?.incomplete && <p role="status">Some sources could not be loaded.</p>}
        <section aria-label="Library">
          <div className="ck-library-heading"><strong>Library</strong>{check.projectId && <button type="button" className="ck-round" aria-label="Add source" onClick={() => setAdding(true)}><Icon icon={Plus} /></button>}</div>
          {check.projectId ? <CheckLibraryList library={library} /> : <p>No project library available.</p>}
        </section>
        {project && <button type="button" onClick={() => onNavigate({ name: 'project', projectId: project.id })}>Open project</button>}
      </div>
    </details>
    {adding && check.projectId && <CheckAddSource projectId={check.projectId} onClose={() => setAdding(false)} onSaved={library.refresh} />}
  </header>;
}

function CheckFollowUp({ check, projects, onNavigate, available, library }: { check: CheckRecord; projects: Project[]; onNavigate: Navigate; available: boolean; library: CheckLibrary }) {
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
  const input = useRef<HTMLTextAreaElement>(null);
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
  const effectiveMode = hasFolder ? mode : 'code';
  const libraryRequiresCode = effectiveMode === 'browser' && sources.length > 0;
  const canSend = available && project && draft.trim() && !sending && !libraryRequiresCode && !mention;
  const query = mention?.query.trim().toLowerCase() ?? '';
  const matchingChecks = rankMentionChecks(recent.filter(item => check.projectId && item.projectId === check.projectId
    && item.id !== check.id && !attachedChecks.some(attached => attached.id === item.id)
    && [item.projectName, item.focus].join(' ').toLowerCase().includes(query)));
  const mentionProjects = rankMentionProjects(projects.filter(item => item.id !== check.projectId), recent, query);
  const selectMention = useMentionSelection(addMenu, mention?.query);
  const showAddAction = (name: string) => !query || name.toLowerCase().includes(query);
  const changeDraft = (value: string, caret: number) => {
    setDraft(value);
    const next = findCheckMention(value, caret);
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
    setSending(true);
    const focus = draft.trim();
    const next = startCheck({ projectId: project.id, documents, focus, mode: effectiveMode,
      ...(effectiveMode === 'code' ? {} : { browserRequest: focus }), referenceCheckIds: [check.id, ...attachedChecks.map(item => item.id)],
      ...(sources.length ? { sourceArtifactIds: sources.map(source => source.id) } : {}) },
      { api, projects: () => projects });
    onNavigate({ name: 'check', checkId: next.id });
  }}>
    <button type="button" className="ck-composer-expand" aria-label={expanded ? 'Collapse composer' : 'Expand composer'} aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}><Icon icon={expanded ? Minimize2 : Maximize2} /></button>
    {!!documents.length && <ul className="ck-attached">{documents.map(document => <li className="ck-chip" key={document.name}>
      <Icon icon={FileText} /><span>{document.name}</span><button type="button" aria-label={`Remove ${document.name}`} onClick={() => setDocuments(current => current.filter(item => item.name !== document.name))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!sources.length && <ul className="ck-attached">{sources.map(source => <li className="ck-chip" key={source.id}>
      <Icon icon={FileText} /><span>{source.fileName}</span><button type="button" aria-label={`Remove source ${source.fileName}`} onClick={() => setSources(current => current.filter(item => item.id !== source.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
    {!!attachedChecks.length && <ul className="ck-attached">{attachedChecks.map(item => <li className="ck-chip" key={item.id}>
      <Icon icon={Clock} /><span>{item.focus || item.projectName}</span><button type="button" aria-label={'Remove check ' + (item.focus || item.projectName)} onClick={() => setAttachedChecks(current => current.filter(entry => entry.id !== item.id))}><Icon icon={X} /></button>
    </li>)}</ul>}
    <textarea ref={input} className="ck-focus" rows={2} maxLength={2000} aria-label="Follow-up check" value={draft}
      placeholder={available ? 'What should Centinel check next?' : 'Prepare a follow-up while this check runs'}
      onChange={event => changeDraft(event.target.value, event.target.selectionStart)}
      onKeyDown={event => {
        if (mention && event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
        if (selectMention(event)) return;
        handleComposerEnter(event, expanded, () => composer.current?.requestSubmit(), changeDraft);
      }} />
    <div className="ck-input-actions">
      <button type="button" ref={addTrigger} className="ck-round ck-add-trigger" aria-label="Add to check" aria-haspopup="dialog" aria-expanded={addOpen} onClick={() => { if (!addOpen) library.refresh(); setMention(null); setAddOpen(!addOpen || !!mention); }}><Icon icon={Plus} /></button>
      <CheckPermission value={prefs.mode} onChange={mode => { if (check.projectId) savePermission(check.projectId, mode); }} />
      <Select aria-label="Check mode" className="ck-mode-select" value={effectiveMode}
        options={CHECK_MODES.map(option => ({ ...option, disabled: !hasFolder && option.value !== 'code' }))}
        onChange={value => setMode(value as CheckMode)} />
      <button type="submit" aria-label="Send follow-up" className="ck-round ck-follow-up-send" disabled={!canSend}><Icon icon={ArrowUp} /></button>
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
      ...(attachmentMessage ? [{ title: 'Check attachments', description: attachmentMessage, tone: 'warning' as const }] : []),
    ]} />}
  </form><CheckDocumentPicker open={picker} onClose={() => setPicker(false)} onSelect={files => {
    void readCheckDocuments(files).then(({ accepted, message }) => {
      setDocuments(current => [...current, ...accepted.filter(item => !current.some(existing => existing.name === item.name))]);
      setAttachmentMessage(message);
    });
  }} />{addingSource && project && <CheckAddSource projectId={project.id} onClose={() => setAddingSource(false)} onSaved={library.refresh} />}</>;
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
          <h1 className="ck-title">Checking {check.projectName}<span className="ci-pair ck-elapsed"><Icon icon={Clock} /><span className="ci-text">{formatElapsed(now - Date.parse(check.createdAt))}</span></span></h1>
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
              <NumberCard icon={ListX} label="Requirements not met"><RequirementsValue result={result} /></NumberCard>
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
