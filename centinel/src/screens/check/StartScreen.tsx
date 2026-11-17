import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, FileText, Folder, GitBranch, History, Maximize2, Minimize2, MonitorCheck, Plus, TriangleAlert, X } from 'lucide-react';
import { api } from '../../api/client';
import { useChecks } from '../../check/store';
import { useAttention, type AttentionItem } from '../../check/attention';
import { setMode as savePermissionMode, useProjectPrefs, type PermissionMode } from '../../check/projectPrefs';
import { projectLocalFolder } from '../../check/projectWorkspace';
import { Icon } from '../../components/Icon';
import { ProjectCreateModal } from '../../components/ProjectCreateModal';
import { Select } from '../../components/Select';
import { isWorkflowProviderConfigured } from '../../providerReadiness';
import { folderName, githubRepositoryName, startCheck } from '../../check/runner';
import { CHECK_MODES, type CheckDocument, type CheckMode, type CheckRecord } from '../../check/types';
import type { AiProviderSetting, Project, ProjectCreationResult, ProjectRepositoryInput, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import { CheckPermission } from './CheckPermission';
import { rememberComposerPosition } from './composerTransition';
import { CheckDocumentPicker, readCheckDocuments } from './CheckDocumentPicker';
import './Check.css';

type Props = {
  projects: Project[];
  aiSettings: AiProviderSetting[];
  initialCreate?: boolean;
  onNavigate: (screen: Screen) => void;
  onProjectCreated: (project: Project) => void;
  onCreateProject: (name: string, description: string, sources: ProjectRepositoryInput[]) => Promise<ProjectCreationResult | void>;
};

type Attached = { kind: 'project'; id: string } | { kind: 'folder'; path: string } | { kind: 'github'; url: string };

const DOCUMENT_TYPES = /\.(md|markdown|txt|pdf|json|csv|ya?ml|docx?)$/i;
const TITLE = 'What should Centinel check?';
const ATTENTION_PROMPTS = {
  1: 'Recheck the areas flagged in the last result.',
  2: 'Check what changed in the latest commits.',
  3: 'Run a first check of the main flows.',
  4: 'Recheck the main flows for regressions.',
};
const GENERAL_PROMPTS = [
  'Check that the main user flows work.',
  'Review what happens when something goes wrong.',
  'Compare the code with the project requirements.',
];
const attentionLabel = ({ priority, project }: AttentionItem) => ({
  1: `Revisit the latest check for ${project.name}.`,
  2: `Check what changed in ${project.name}.`,
  3: `Run your first check on ${project.name}.`,
  4: `Check ${project.name} again for regressions.`,
})[priority];

function looksLikeFolder(text: string) {
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(text.trim()) && !/\s{2,}/.test(text.trim()) && !text.includes('\n');
}


export function StartScreen({ projects, aiSettings, initialCreate = false, onNavigate, onProjectCreated, onCreateProject }: Props) {
  const [attached, setAttached] = useState<Attached | null>(null);
  const [documents, setDocuments] = useState<CheckDocument[]>([]);
  const [focus, setFocus] = useState('');
  const [mode, setMode] = useState<CheckMode>('both');
  const [menu, setMenu] = useState<'add' | 'projects' | null>(null);
  const [repoOpen, setRepoOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [references, setReferences] = useState<CheckRecord[]>([]);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const recentChecks = useChecks();
  const attention = useAttention(projects, recentChecks);
  const [createOpen, setCreateOpen] = useState(initialCreate);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [nextCheckId, setNextCheckId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draftPermission, setDraftPermission] = useState<PermissionMode | null>(null);
  const [preparingSample, setPreparingSample] = useState(false);
  const projectButton = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const navigateRef = useRef(onNavigate);
  const recommendationVersion = useRef(0);
  navigateRef.current = onNavigate;

  useEffect(() => {
    if (!nextCheckId) return;
    const input = composerRef.current?.querySelector('.ck-input');
    const footer = footerRef.current;
    if (!input || !footer?.animate || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) {
      navigateRef.current({ name: 'check', checkId: nextCheckId });
      return;
    }
    const collapse = footer.animate([{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(0)' }],
      { duration: 150, fill: 'forwards', easing: 'ease-in' });
    let active = true;
    void Promise.all([collapse.finished, import('./CheckScreen').catch(() => undefined)]).then(() => {
      if (!active) return;
      rememberComposerPosition(nextCheckId, input.getBoundingClientRect());
      navigateRef.current({ name: 'check', checkId: nextCheckId });
    }, () => undefined);
    return () => { active = false; collapse.cancel(); };
  }, [nextCheckId]);
  const [titleLength, setTitleLength] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches ? 0 : TITLE.length,
  );

  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: no-preference)');
    if (!motion?.matches) return;
    let count = 0;
    const timer = window.setInterval(() => {
      count = motion.matches ? count + 1 : TITLE.length;
      setTitleLength(count);
      if (count === TITLE.length) window.clearInterval(timer);
    }, 66);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const popover = menuRef.current;
    const anchor = popover?.parentElement;
    const scrollArea = anchor?.closest('main');
    const fit = () => {
      if (!popover || !anchor) return;
      const top = scrollArea?.getBoundingClientRect().top ?? 0;
      popover.style.setProperty('--ck-popover-room', `${Math.max(80, anchor.getBoundingClientRect().top - top - 8)}px`);
    };
    fit();
    if (!mention) popover?.querySelector<HTMLElement>(menu === 'projects' ? 'input' : 'button')?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) || addButton.current?.contains(event.target as Node) || projectButton.current?.contains(event.target as Node)) return;
      setMenu(null);
      setMention(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setMention(null);
        (menu === 'projects' ? projectButton.current : mention ? textRef.current : addButton.current)?.focus();
      } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && menuRef.current?.contains(document.activeElement)) {
        const items = Array.from(menuRef.current.querySelectorAll('button'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = index + (event.key === 'ArrowDown' ? 1 : -1);
        event.preventDefault();
        items[(next + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    scrollArea?.addEventListener('scroll', fit);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      scrollArea?.removeEventListener('scroll', fit);
    };
  }, [menu, Boolean(mention)]);

  const textReady = isWorkflowProviderConfigured(aiSettings, 'text');
  const visionReady = isWorkflowProviderConfigured(aiSettings, 'vision');
  const needsText = mode !== 'browser' && !textReady;
  const needsVision = mode !== 'code' && !visionReady;
  const savedProject = attached?.kind === 'project' ? projects.find(project => project.id === attached.id) : undefined;
  const projectPrefs = useProjectPrefs(savedProject?.id ?? '');
  const projectLabel = attached?.kind === 'project' ? savedProject?.name ?? 'Saved project'
    : attached?.kind === 'folder' ? folderName(attached.path) : attached ? githubRepositoryName(attached.url) : null;
  const browserNeedsFolder = mode !== 'code' && (attached?.kind === 'github' || (attached?.kind === 'project' && !projectLocalFolder(savedProject)));

  const attachProject = (id: string) => {
    recommendationVersion.current += 1;
    if (draftPermission) {
      savePermissionMode(id, draftPermission);
      setDraftPermission(null);
    }
    setAttached({ kind: 'project', id });
    setMenu(null);
    if (mention) setFocus(value => value.slice(0, mention.start) + value.slice(mention.end));
    setMention(null);
    setReferences(current => current.filter(check => check.projectId === id));
    setMessage(null);
    textRef.current?.focus();
  };

  const attachCheck = (check: CheckRecord) => {
    if (!check.projectId) return;
    attachProject(check.projectId);
    setReferences(current => [...current.filter(item => item.projectId === check.projectId && item.id !== check.id), check]);
  };

  const replaceRecommendation = (source: Attached | null, nextMode: CheckMode, prompt: string, check?: CheckRecord) => {
    recommendationVersion.current += 1;
    setMenu(null);
    setMention(null);
    setAttached(source);
    setMode(nextMode);
    setFocus(prompt);
    setDocuments([]);
    setReferences(check ? [check] : []);
    setDraftPermission(null);
    setMessage(null);
    textRef.current?.focus({ preventScroll: true });
  };

  const applyAttention = ({ project, mode, check, priority }: AttentionItem) => {
    replaceRecommendation({ kind: 'project', id: project.id }, mode, ATTENTION_PROMPTS[priority], check);
  };

  const changeFocus = (value: string, caret: number) => {
    setFocus(value);
    const match = /(?:^|\s)@([^@\n]*)$/.exec(value.slice(0, caret));
    if (match) {
      setMention({ start: caret - match[1].length - 1, end: caret, query: match[1] });
      setMenu('add');
    } else if (mention) {
      setMention(null);
      setMenu(null);
    }
  };

  const matchingProjects = projects.filter(project => project.name.toLowerCase().includes((mention?.query ?? projectQuery).trim().toLowerCase()));
  const matchingChecks = recentChecks.filter(check => check.projectId && projects.some(project => project.id === check.projectId)
    && check.projectName.toLowerCase().includes(mention?.query.trim().toLowerCase() ?? '')).slice(0, 10);

  const attachRepository = (source: ProjectRepositoryInput) => {
    recommendationVersion.current += 1;
    setReferences([]);
    if (source.type === 'github') attachLink(source.repoUrl);
    else {
      setAttached({ kind: 'folder', path: source.path });
      setMessage(null);
    }
  };

  const addDocuments = async (files: FileList | File[]) => {
    const version = recommendationVersion.current;
    const { accepted, message } = await readCheckDocuments(files);
    if (version !== recommendationVersion.current) return;
    setDocuments(current => [...current, ...accepted.filter(item => !current.some(existing => existing.name === item.name))]);
    setMessage(message);
  };

  const attachLink = (value: string) => {
    if (!githubRepositoryName(value)) { setMessage('That is not a GitHub repository link. Use a link like https://github.com/owner/repository.'); return false; }
    setReferences([]);
    setAttached({ kind: 'github', url: value.trim() });
    setMessage(null);
    return true;
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!attached && githubRepositoryName(text)) { event.preventDefault(); attachLink(text); return; }
    if (!attached && looksLikeFolder(text)) { event.preventDefault(); setAttached({ kind: 'folder', path: text.trim() }); setMessage(null); }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const items = Array.from(event.dataTransfer.items ?? []);
    const hasFolder = items.some(item => (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.()?.isDirectory);
    const files = Array.from(event.dataTransfer.files).filter(file => file.size > 0 || DOCUMENT_TYPES.test(file.name));
    if (files.length) void addDocuments(files);
    if (hasFolder) setMessage('Use + → Add Repository to choose a local folder, or Add Document to choose a reference folder.');
    const text = event.dataTransfer.getData('text');
    if (text && githubRepositoryName(text)) attachLink(text);
  };

  const sample = async () => {
    const version = ++recommendationVersion.current;
    setPreparingSample(true);
    setMessage(null);
    try {
      const prepared = await api.prepareSampleShop();
      if (version !== recommendationVersion.current) return;
      replaceRecommendation({ kind: 'folder', path: prepared.path }, 'both', 'Check that shoppers can browse products, add items to their cart, and complete checkout.');
    } catch (cause) {
      if (version === recommendationVersion.current) setMessage(userFacingError(cause, 'The Sample Shop could not be prepared.'));
    } finally {
      setPreparingSample(false);
    }
  };

  const start = () => {
    if (starting || preparingSample) return;
    if (!attached) {
      setMessage('Add your project first. Choose one below or add a repository.');
      return;
    }
    if (needsText || needsVision || (mode === 'browser' && browserNeedsFolder)) return;
    setStarting(true);
    const check = startCheck({
      ...(attached.kind === 'project' ? { projectId: attached.id }
        : attached.kind === 'folder' ? { folder: attached.path } : { githubUrl: attached.url }),
      documents, focus, mode,
      ...(mode === 'browser' && focus.trim() ? { browserRequest: focus.trim() } : {}),
      ...(references.length ? { referenceCheckIds: references.map(check => check.id) } : {}),
    }, { api, projects: () => projects, onProjectCreated: project => {
      if (draftPermission) savePermissionMode(project.id, draftPermission);
      onProjectCreated(project);
    } });
    setNextCheckId(check.id);
  };

  const placeholder = attached ? 'Anything to focus on? For example: check that sign-in and checkout follow the requirements.' : 'Type @ to find checks and projects, or choose a project below';
  const seen = new Map<number, number>();
  const topAttention = attention.filter(item => {
    const count = seen.get(item.priority) ?? 0;
    seen.set(item.priority, count + 1);
    return count < 2;
  }).slice(0, 3);
  const attentionRows = <>
    {topAttention.map(item => (
      <button type="button" key={item.project.id} onClick={() => applyAttention(item)} title={attentionLabel(item)}>
        <span>{attentionLabel(item)}</span>
      </button>
    ))}
    {GENERAL_PROMPTS.slice(0, 3 - topAttention.length).map(prompt => (
      <button type="button" key={prompt} title={prompt} onClick={() => replaceRecommendation(null, 'both', prompt)}><span>{prompt}</span></button>
    ))}
    <button type="button" onClick={() => { setMenu(null); void sample(); }} disabled={preparingSample}>
      <span>{preparingSample ? 'Preparing the Sample Shop…' : 'Try the Sample Shop'}</span>
    </button>
  </>;

  return (
    <>
    <div className={`ck-screen ck-start${starting ? ' is-launching' : ''}`}>
      <div className="ck-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className={`ck-start-column${titleLength === TITLE.length ? ' is-intro-ready' : ''}`}>
        <h1 className="ck-headline" aria-label={TITLE}>
          <span className="ck-title-space" aria-hidden="true">{TITLE}_</span>
          <span aria-hidden="true">{TITLE.slice(0, titleLength)}{titleLength === TITLE.length && <span className="ck-title-caret">_</span>}</span>
        </h1>
        <p className="ck-sub">Add your code and your documents. Centinel does the rest.</p>

        <div className={`ck-composer${expanded ? ' is-expanded' : ''}`} ref={composerRef}>
        <div
          className={`ck-input${dragging ? ' is-dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <button type="button" className="ck-composer-expand" aria-label={expanded ? 'Collapse composer' : 'Expand composer'} aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}><Icon icon={expanded ? Minimize2 : Maximize2} /></button>
          {(references.length > 0 || documents.length > 0) && (
            <ul className="ck-attached" aria-label="Added to this check">
              {references.map(check => <li key={check.id} className="ck-chip"><Icon icon={History} /><span>{check.projectName}</span>
                <button type="button" aria-label={`Remove check ${check.projectName}`} onClick={() => setReferences(items => items.filter(item => item.id !== check.id))}><Icon icon={X} /></button>
              </li>)}
              {documents.map(document => (
                <li key={document.name} className="ck-chip">
                  <Icon icon={FileText} />
                  <span>{document.name}</span>
                  <button type="button" onClick={() => setDocuments(current => current.filter(item => item.name !== document.name))} aria-label={`Remove ${document.name}`}><Icon icon={X} /></button>
                </li>
              ))}
            </ul>
          )}
          <label className="ck-visually-hidden" htmlFor="ck-focus">{attached ? 'Anything to focus on (optional)' : 'Project folder path or GitHub link'}</label>
          <textarea
            id="ck-focus"
            ref={textRef}
            className="ck-focus"
            rows={2}
            maxLength={2000}
            value={focus}
            placeholder={placeholder}
            onPaste={onPaste}
            onChange={event => {
              const value = event.target.value;
              if (!attached && (githubRepositoryName(value) || looksLikeFolder(value)) && !value.includes(' ')) {
                if (githubRepositoryName(value)) attachLink(value); else setAttached({ kind: 'folder', path: value.trim() });
                setFocus('');
                return;
              }
              changeFocus(value, event.target.selectionStart);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start();
              if (mention && menu === 'add' && event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
              }
            }}
          />
          <div className="ck-input-actions">
            <button type="button" ref={addButton} className="ck-round ck-add-trigger" aria-label="Add to check" aria-haspopup="dialog" aria-expanded={menu === 'add'}
              onClick={() => { setMenu(menu === 'add' && !mention ? null : 'add'); setMention(null); }}>
              <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <CheckPermission value={savedProject ? projectPrefs.mode : draftPermission ?? 'auto'}
              onChange={value => savedProject ? savePermissionMode(savedProject.id, value) : setDraftPermission(value)} />
            <button type="button" className={`ck-button ck-send is-primary${focus ? ' is-icon' : ''}`} aria-label="Conduct the Check" onClick={start} disabled={starting || preparingSample || (mode === 'browser' && browserNeedsFolder)} title={attached ? 'Start check' : 'Add your project first'}>
              <span className="ck-send-label" aria-hidden="true">Conduct the Check</span>
              <ArrowUp className="ck-send-arrow" size={16} aria-hidden="true" />
            </button>
          </div>
          {menu === 'add' && (
            <div className="ck-menu ck-attachment-menu" role="dialog" aria-label="Add to check" ref={menuRef}>
              {!mention && <>
                <h2>Add</h2>
                <button type="button" onClick={() => { setMenu(null); setDocumentsOpen(true); }}>
                  <Icon icon={FileText} /><span>Add Document <small>Add any files and folders as reference for your project</small></span>
                </button>
                <button type="button" onClick={() => { setMenu(null); setRepoOpen(true); }}>
                  <Icon icon={GitBranch} /><span>Add Repository <small>Choose a GitHub repository, paste a link, or use a local folder</small></span>
                </button>
              </>}
              <section className="ck-recent-attachments" aria-labelledby="ck-recent-attachments-title">
                <h2 id="ck-recent-attachments-title">Recent Checks</h2>
                {matchingChecks.length ? matchingChecks.map(check => (
                  <button type="button" key={check.id} onClick={() => attachCheck(check)}>
                    <Icon icon={History} /><span>{check.projectName} <small>{new Date(check.createdAt).toLocaleString()}</small></span>
                  </button>
                )) : <p>{mention?.query.trim() ? 'No matching checks' : 'No recent checks to attach'}</p>}
              </section>
              {mention && (
                <section className="ck-recent-attachments" aria-labelledby="ck-mention-projects-title">
                  <h2 id="ck-mention-projects-title">Projects</h2>
                  {matchingProjects.length ? matchingProjects.map(project => (
                    <button key={project.id} type="button" onClick={() => attachProject(project.id)}>
                      <Icon icon={Folder} /><span>{project.name}</span>
                    </button>
                  )) : <p>{mention.query.trim() ? 'No matching projects' : 'No saved projects yet'}</p>}
                </section>
              )}
            </div>
          )}
        </div>
        <div className="ck-composer-footer" ref={footerRef}>
          <div className="ck-project-dropdown">
            <button type="button" ref={projectButton} className="ck-project-trigger" aria-label={projectLabel ? `Choose project: ${projectLabel}` : 'Choose project'} aria-haspopup="dialog" aria-expanded={menu === 'projects'}
              onClick={() => { setMention(null); setProjectQuery(''); setMenu(value => value === 'projects' ? null : 'projects'); }}>
              <Icon icon={Folder} /><span>{projectLabel ?? 'Choose project'}</span><ChevronDown size={14} aria-hidden="true" />
            </button>
            {menu === 'projects' && (
              <div className="ck-menu ck-project-menu" role="dialog" aria-label="Choose a project" ref={menuRef}>
                <input type="search" aria-label="Search projects" placeholder="Search projects" value={projectQuery} onChange={event => setProjectQuery(event.target.value)} />
                <div className="ck-project-list" role="group" aria-label="Saved projects">
                  {matchingProjects.map(project => (
                    <button key={project.id} type="button" onClick={() => attachProject(project.id)}><Icon icon={Folder} /><span>{project.name}</span></button>
                  ))}
                  {!matchingProjects.length && <p>{projectQuery.trim() ? 'No matching projects' : 'No saved projects yet'}</p>}
                </div>
                <div className="ck-project-menu-footer">
                  <button type="button" onClick={() => { projectButton.current?.focus(); setMenu(null); setCreateOpen(true); }}><Icon icon={Plus} />Add a project</button>
                </div>
              </div>
            )}
          </div>
          {attached && <button type="button" className="ck-project-clear" aria-label={`Remove ${projectLabel}`} onClick={() => { setAttached(null); setReferences([]); }}><Icon icon={X} /></button>}
          <Select aria-label="Check mode" className="ck-mode-select" value={mode} options={CHECK_MODES} onChange={value => setMode(value as CheckMode)} />
        </div>
        </div>

        {message && <p className="ck-inline-message" role="status"><Icon icon={TriangleAlert} shape="triangle" /><span className="ci-text">{message}</span></p>}
        {(needsText || needsVision) && (
          <div className="ck-setup-step" role="status">
            <Icon icon={TriangleAlert} shape="triangle" />
            <span>{needsText && needsVision ? 'Connect an AI provider for the code review and the browser tests first.' : needsText ? 'Connect an AI provider for the code review first.' : 'Choose an AI model that can read screenshots for the browser tests first.'}</span>
            <button type="button" className="ck-button" onClick={() => onNavigate({ name: 'settings' })}>Open AI settings</button>
          </div>
        )}
        {browserNeedsFolder && <p className="ck-inline-message is-quiet"><Icon icon={MonitorCheck} /><span>{savedProject?.managedWorkspacePath
          ? <>Add your app files to <code>{savedProject.managedWorkspacePath}</code> before running browser tests.</>
          : 'Browser tests need the project folder on this computer. Choose or add a project with a local folder.'}</span></p>}

        <div className="ck-attention" role="group" aria-label="Recommendations">{attentionRows}</div>
      </div>
    </div>
    <CheckDocumentPicker open={documentsOpen} onClose={() => setDocumentsOpen(false)} onSelect={files => void addDocuments(files)} />
    <ProjectCreateModal isOpen={repoOpen} onClose={() => setRepoOpen(false)} onCreate={onCreateProject} onRepositorySelected={attachRepository} />
    <ProjectCreateModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreate={onCreateProject} onCreated={project => attachProject(project.id)} />
    </>
  );
}
