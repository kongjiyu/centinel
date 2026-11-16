import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Code, FileText, Folder, Link, MonitorCheck, Plus, ShoppingCart, TriangleAlert, X } from 'lucide-react';
import { api } from '../../api/client';
import { Icon } from '../../components/Icon';
import { isWorkflowProviderConfigured } from '../../providerReadiness';
import { folderName, githubRepositoryName, startCheck } from '../../check/runner';
import type { CheckDocument, CheckMode } from '../../check/types';
import type { AiProviderSetting, Project, Screen } from '../../types';
import { userFacingError } from '../../utils/userFacingError';
import './Check.css';

type Props = {
  projects: Project[];
  aiSettings: AiProviderSetting[];
  onNavigate: (screen: Screen) => void;
  onProjectCreated: (project: Project) => void;
};

type Attached = { kind: 'folder'; path: string } | { kind: 'github'; url: string };

const DOCUMENT_TYPES = /\.(md|markdown|txt|pdf|json|csv|ya?ml|docx?)$/i;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MODES: Array<{ id: CheckMode; label: string; icon: typeof Check }> = [
  { id: 'both', label: 'Code and browser', icon: Check },
  { id: 'code', label: 'Code only', icon: Code },
  { id: 'browser', label: 'Browser only', icon: MonitorCheck },
];

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

function looksLikeFolder(text: string) {
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(text.trim()) && !/\s{2,}/.test(text.trim()) && !text.includes('\n');
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function StartScreen({ projects, aiSettings, onNavigate, onProjectCreated }: Props) {
  const [attached, setAttached] = useState<Attached | null>(null);
  const [documents, setDocuments] = useState<CheckDocument[]>([]);
  const [focus, setFocus] = useState('');
  const [mode, setMode] = useState<CheckMode>('both');
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preparingSample, setPreparingSample] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node) || addButton.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); addButton.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const textReady = isWorkflowProviderConfigured(aiSettings, 'text');
  const visionReady = isWorkflowProviderConfigured(aiSettings, 'vision');
  const needsText = mode !== 'browser' && !textReady;
  const needsVision = mode !== 'code' && !visionReady;
  const browserNeedsFolder = mode !== 'code' && attached?.kind === 'github';

  const chooseFolder = async () => {
    setMenuOpen(false);
    setMessage(null);
    if (!isTauri()) {
      setMessage('Paste the full path of your project folder into the box, for example /Users/you/projects/shop.');
      textRef.current?.focus();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({ directory: true, multiple: false, title: 'Choose your project folder' });
      if (typeof selected === 'string' && selected) setAttached({ kind: 'folder', path: selected });
    } catch (cause) {
      setMessage(userFacingError(cause, 'The folder picker could not open.'));
    }
  };

  const addDocuments = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const accepted: CheckDocument[] = [];
    const rejected: string[] = [];
    for (const file of list) {
      if (!DOCUMENT_TYPES.test(file.name) || file.size > MAX_DOCUMENT_BYTES) { rejected.push(file.name); continue; }
      try { accepted.push({ name: file.name, base64: await readAsBase64(file) }); } catch { rejected.push(file.name); }
    }
    setDocuments(current => [...current, ...accepted.filter(item => !current.some(existing => existing.name === item.name))]);
    setMessage(rejected.length ? `Not added: ${rejected.join(', ')}. Documents can be Markdown, text, PDF, Word, JSON, CSV or YAML, up to 10 MB.` : null);
  };

  const attachLink = (value: string) => {
    if (!githubRepositoryName(value)) { setMessage('That is not a GitHub repository link. Use a link like https://github.com/owner/repository.'); return false; }
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
    if (hasFolder) setMessage('Folders cannot be dropped here. Use + and Choose a folder so Centinel can open it.');
    const text = event.dataTransfer.getData('text');
    if (text && githubRepositoryName(text)) attachLink(text);
  };

  const sample = async () => {
    setPreparingSample(true);
    setMessage(null);
    try {
      const prepared = await api.prepareSampleShop();
      setAttached({ kind: 'folder', path: prepared.path });
    } catch (cause) {
      setMessage(userFacingError(cause, 'The Sample Shop could not be prepared.'));
    } finally {
      setPreparingSample(false);
    }
  };

  const start = () => {
    if (!attached) {
      setMessage('Add your project first: choose its folder with +, or paste a GitHub link.');
      return;
    }
    if (needsText || needsVision) return;
    setStarting(true);
    const check = startCheck({
      ...(attached.kind === 'folder' ? { folder: attached.path } : { githubUrl: attached.url }),
      documents, focus, mode,
    }, { api, projects: () => projects, onProjectCreated });
    onNavigate({ name: 'check', checkId: check.id });
  };

  const placeholder = attached ? 'Anything to focus on? For example: check that sign-in and checkout follow the requirements.' : 'Drop documents here, choose your project folder with +, or paste a GitHub link';

  return (
    <div className="ck-screen ck-start">
      <div className="ck-glow" aria-hidden="true" />
      <div className="ck-start-column">
        <h1 className="ck-headline">What should Centinel check?</h1>
        <p className="ck-sub">Add your code and your documents. Centinel does the rest.</p>

        <div
          className={`ck-input${dragging ? ' is-dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {(attached || documents.length > 0) && (
            <ul className="ck-attached" aria-label="Added to this check">
              {attached && (
                <li className="ck-chip is-project">
                  <Icon icon={attached.kind === 'folder' ? Folder : Link} />
                  <span title={attached.kind === 'folder' ? attached.path : attached.url}>{attached.kind === 'folder' ? folderName(attached.path) : githubRepositoryName(attached.url)}</span>
                  <button type="button" onClick={() => setAttached(null)} aria-label={`Remove ${attached.kind === 'folder' ? folderName(attached.path) : 'GitHub link'}`}><Icon icon={X} /></button>
                </li>
              )}
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
              setFocus(value);
            }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start(); }}
          />
          {linkOpen && (
            <form className="ck-link-form" onSubmit={event => { event.preventDefault(); if (attachLink(link)) { setLinkOpen(false); setLink(''); } }}>
              <label className="ck-visually-hidden" htmlFor="ck-link">GitHub repository link</label>
              <input id="ck-link" autoFocus value={link} onChange={event => setLink(event.target.value)} placeholder="https://github.com/owner/repository" />
              <button type="submit" className="ck-button">Add</button>
              <button type="button" className="ck-button is-quiet" onClick={() => setLinkOpen(false)}>Cancel</button>
            </form>
          )}
          <div className="ck-input-actions">
            <div className="ck-add">
              <button type="button" ref={addButton} className="ck-round" aria-label="Add a folder, GitHub link or documents" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
                <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div className="ck-menu" role="menu" ref={menuRef}>
                  <button type="button" role="menuitem" onClick={() => void chooseFolder()}><Icon icon={Folder} />Choose a folder</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setLinkOpen(true); }}><Icon icon={Link} />Paste a GitHub link</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}><Icon icon={FileText} />Add documents</button>
                </div>
              )}
              <input ref={fileInput} type="file" multiple hidden accept=".md,.markdown,.txt,.pdf,.json,.csv,.yaml,.yml,.doc,.docx" onChange={event => { if (event.target.files) void addDocuments(event.target.files); event.target.value = ''; }} />
            </div>
            <button type="button" className="ck-round is-go" onClick={start} disabled={starting} aria-label="Start check" title={attached ? 'Start check' : 'Add your project first'}>
              <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
            </button>
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
        {browserNeedsFolder && !needsVision && <p className="ck-inline-message is-quiet"><Icon icon={MonitorCheck} />Browser tests need the project folder on this computer. A GitHub link can only be reviewed.</p>}

        <div className="ck-modes" role="radiogroup" aria-label="What to check">
          {MODES.map(item => (
            <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} className={`ck-mode${mode === item.id ? ' is-on' : ''}`} onClick={() => setMode(item.id)}>
              <Icon icon={item.icon} />{item.label}
            </button>
          ))}
        </div>

        <p className="ck-sample">
          No project at hand?{' '}
          <button type="button" className="ck-link" onClick={() => void sample()} disabled={preparingSample}>
            <Icon icon={ShoppingCart} />{preparingSample ? 'Preparing the Sample Shop…' : 'Try the Sample Shop'}
          </button>
        </p>
      </div>
    </div>
  );
}
