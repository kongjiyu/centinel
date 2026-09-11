import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as pickPath } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { open as openLocation } from '@tauri-apps/api/shell';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  File,
  Folder,
  GitBranch,
  MessageSquare,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../api/client';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import type { Artifact, ArtifactSource } from '../types';
import { userFacingError } from '../utils/userFacingError';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cs', 'json', 'yaml', 'yml',
  'html', 'css', 'go', 'rb', 'php', 'rs', 'cpp', 'c', 'h', 'xml', 'toml', 'ini',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const PREVIEW_EXTENSIONS = new Set([...TEXT_EXTENSIONS, 'pdf', ...IMAGE_EXTENSIONS]);
const SUPPORTED_EXTENSIONS = PREVIEW_EXTENSIONS;

function extensionOf(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

async function fileToBase64(file: globalThis.File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

const SOURCE_LABELS: Record<ArtifactSource, string> = {
  documents: 'Documents',
  repository: 'Repository',
  drive: 'Google Drive',
};

const SOURCE_COLORS: Record<ArtifactSource, string> = {
  documents: 'badge-documents',
  repository: 'badge-repository',
  drive: 'badge-drive',
};

type RepoGroup = {
  repoName: string;
  repoPath: string;
  rootPath: string;
  artifacts: Artifact[];
};

type TreeNode = {
  name: string;
  isDir: boolean;
  children?: TreeNode[];
  artifact?: Artifact;
};

type Props = {
  projectId: string;
};

type DeleteTarget =
  | { kind: 'artifact'; artifact: Artifact }
  | { kind: 'repository'; group: RepoGroup };

type PreviewKind = 'text' | 'pdf' | 'image';

type PreviewState = {
  artifact: Artifact;
  kind: PreviewKind | null;
  content: string | null;
  error: string | null;
  loading: boolean;
};

type SourceView =
  | { kind: 'document'; artifact: Artifact }
  | { kind: 'repository'; group: RepoGroup };

type MarkdownMode = 'preview' | 'original';

function artifactKind(fileName: string): PreviewKind | null {
  const extension = extensionOf(fileName);
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return null;
}

function mimeType(fileName: string): string {
  const extension = extensionOf(fileName);
  const values: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', js: 'text/javascript', ts: 'text/typescript',
    jsx: 'text/javascript', tsx: 'text/typescript', json: 'application/json', yaml: 'text/yaml',
    yml: 'text/yaml', html: 'text/html', css: 'text/css', xml: 'application/xml', toml: 'text/plain',
    ini: 'text/plain', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  return values[extension] || 'application/octet-stream';
}

function toDataUrl(bytes: Uint8Array, type: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function pathParts(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

/**
 * Artifact records do not yet carry a repository id. Use their persisted
 * common ancestor rather than a fixed path depth so a Windows repository at
 * C:/Users/name/Projects/repo is not incorrectly displayed as "Users".
 */
function commonRepositoryRoot(artifacts: Artifact[]): string {
  const paths = artifacts
    .map(artifact => normalizePath(artifact.originalPath || artifact.filePath || artifact.fileName))
    .filter(Boolean);
  if (paths.length === 0) return 'Repository';
  const directories = paths.map(path => path.split('/').filter(Boolean).slice(0, -1));
  const first = directories[0];
  let commonLength = first.length;
  for (const directory of directories.slice(1)) {
    commonLength = Math.min(commonLength, directory.length);
    let index = 0;
    while (index < commonLength && first[index].toLowerCase() === directory[index].toLowerCase()) index += 1;
    commonLength = index;
  }
  let common = first.slice(0, commonLength);
  if (common.length === 0 || (common.length === 1 && /^[A-Za-z]:$/.test(common[0]))) return '';
  const conventionalContainer = common[common.length - 1]?.toLowerCase();
  if (['src', 'app', 'lib', 'docs', 'test', 'tests'].includes(conventionalContainer) && common.length > 1) {
    common = common.slice(0, -1);
  }
  const prefix = paths[0].startsWith('/') ? '/' : '';
  return `${prefix}${common.join('/')}`;
}

function displayLocation(artifact: Artifact): string {
  return artifact.originalPath || artifact.filePath || 'Location unavailable';
}

function validLocation(artifact: Artifact): string | null {
  const value = (artifact.originalPath || artifact.filePath || '').trim();
  return value || null;
}

function buildTree(artifacts: Artifact[], rootPath: string): TreeNode[] {
  const root: TreeNode[] = [];
  const normalizedRoot = normalizePath(rootPath);

  for (const artifact of artifacts) {
    const fullPath = artifact.originalPath || artifact.filePath || artifact.fileName;
    const normalizedFull = normalizePath(fullPath);
    let relative = normalizedFull;
    if (normalizedFull.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
      relative = normalizedFull.slice(normalizedRoot.length + 1);
    } else if (normalizedFull.toLowerCase() === normalizedRoot.toLowerCase()) {
      relative = artifact.fileName;
    }
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) parts.push(artifact.fileName);
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const directoryName = parts[index];
      let directory = current.find(node => node.isDir && node.name.toLowerCase() === directoryName.toLowerCase());
      if (!directory) {
        directory = { name: directoryName, isDir: true, children: [] };
        current.push(directory);
      }
      current = directory.children!;
    }
    current.push({ name: parts[parts.length - 1], isDir: false, artifact });
  }

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach(node => { if (node.children) sortTree(node.children); });
  };
  sortTree(root);
  return root;
}

function getNodesAtPath(nodes: TreeNode[], directoryPath: string): TreeNode[] {
  if (!directoryPath) return nodes;
  let current = nodes;
  for (const part of directoryPath.split('/').filter(Boolean)) {
    const directory = current.find(node => node.isDir && node.name === part);
    if (!directory?.children) return [];
    current = directory.children;
  }
  return current;
}

function countFiles(node: TreeNode): number {
  if (!node.isDir) return 1;
  return (node.children || []).reduce((total, child) => total + countFiles(child), 0);
}

function PreviewPane({
  preview,
  markdownMode,
  onMarkdownModeChange,
}: {
  preview: PreviewState | null;
  markdownMode: MarkdownMode;
  onMarkdownModeChange: (mode: MarkdownMode) => void;
}) {
  if (!preview) return <p className="source-preview-empty">Select a file to preview it.</p>;
  if (preview.loading) return <div className="panel-loading" role="status">Loading preview…</div>;
  if (preview.error) return <p className="form-error" role="alert">{preview.error}</p>;
  if (!preview.kind) return <p className="source-preview-unavailable">Preview not available</p>;
  if (!preview.content) return <p className="source-preview-empty">Preview not available.</p>;

  const isMarkdown = extensionOf(preview.artifact.fileName) === 'md';
  return (
    <div className="source-preview-content">
      {isMarkdown && (
        <div className="source-preview-mode" role="group" aria-label="Markdown preview mode">
          <button type="button" className={markdownMode === 'preview' ? 'active' : ''} aria-pressed={markdownMode === 'preview'} onClick={() => onMarkdownModeChange('preview')}>Preview</button>
          <button type="button" className={markdownMode === 'original' ? 'active' : ''} aria-pressed={markdownMode === 'original'} onClick={() => onMarkdownModeChange('original')}>Original</button>
        </div>
      )}
      {preview.kind === 'text' && isMarkdown && markdownMode === 'preview' && (
        <article className="artifact-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown></article>
      )}
      {preview.kind === 'text' && (!isMarkdown || markdownMode === 'original') && (
        <pre className="artifact-text-preview"><code>{preview.content}</code></pre>
      )}
      {preview.kind === 'image' && <div className="artifact-image-preview"><img src={preview.content} alt={`Preview of ${preview.artifact.fileName}`} /></div>}
      {preview.kind === 'pdf' && <iframe className="artifact-pdf-preview" src={preview.content} title={`Preview of ${preview.artifact.fileName}`} />}
    </div>
  );
}

export function ArtifactsPanel({ projectId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourceView, setSourceView] = useState<SourceView | null>(null);
  const [repoDirectory, setRepoDirectory] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepoArtifact, setSelectedRepoArtifact] = useState<Artifact | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSourceTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listArtifacts(projectId);
      setArtifacts(data);
      setError(null);
    } catch (cause) {
      setArtifacts([]);
      setError(`Sources could not be loaded. ${userFacingError(cause, 'Try again.')}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadArtifacts(); }, [loadArtifacts]);

  const { docArtifacts, repoGroups, driveArtifacts } = useMemo(() => {
    const docs: Artifact[] = [];
    const repositories: Artifact[] = [];
    const drive: Artifact[] = [];
    artifacts.forEach(artifact => {
      if (artifact.source === 'repository') {
        repositories.push(artifact);
      } else if (artifact.source === 'drive') {
        drive.push(artifact);
      } else {
        docs.push(artifact);
      }
    });
    const groups: RepoGroup[] = repositories.length > 0 ? (() => {
      const rootPath = commonRepositoryRoot(repositories);
      const parts = pathParts(rootPath);
      const repoName = parts[parts.length - 1] || 'Imported repository';
      return [{ repoName, repoPath: rootPath, rootPath, artifacts: repositories }];
    })() : [];
    return { docArtifacts: docs, repoGroups: groups, driveArtifacts: drive };
  }, [artifacts]);

  const finishUpload = async () => {
    await loadArtifacts();
    setShowImportDialog(false);
  };

  const openPreview = useCallback(async (artifact: Artifact) => {
    const kind = artifactKind(artifact.fileName);
    setPreview({ artifact, kind, content: null, error: null, loading: Boolean(kind) });
    if (!kind) return;
    try {
      const bytes = await readBinaryFile(artifact.filePath);
      const content = kind === 'text' ? new TextDecoder().decode(bytes) : toDataUrl(bytes, mimeType(artifact.fileName));
      setPreview(current => current?.artifact.id === artifact.id ? { ...current, content, loading: false } : current);
    } catch (cause) {
      setPreview(current => current?.artifact.id === artifact.id
        ? { ...current, error: `This file could not be previewed. ${userFacingError(cause, 'Try again.')}`, loading: false }
        : current);
    }
  }, []);

  const rememberTrigger = (event: React.MouseEvent<HTMLButtonElement>) => {
    lastSourceTriggerRef.current = event.currentTarget;
  };

  const openDocument = (artifact: Artifact, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) rememberTrigger(event);
    setSourceView({ kind: 'document', artifact });
    setSelectedRepoArtifact(null);
    setRepoDirectory('');
    setRepoSearch('');
    setMarkdownMode('preview');
    void openPreview(artifact);
  };

  const openRepository = (group: RepoGroup, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) rememberTrigger(event);
    setSourceView({ kind: 'repository', group });
    setRepoDirectory('');
    setRepoSearch('');
    setSelectedRepoArtifact(null);
    setPreview(null);
  };

  const goBackToSources = () => {
    setSourceView(null);
    setRepoDirectory('');
    setRepoSearch('');
    setSelectedRepoArtifact(null);
    setPreview(null);
    window.requestAnimationFrame(() => lastSourceTriggerRef.current?.focus());
  };

  const handleOpenWith = async (artifact: Artifact) => {
    const location = validLocation(artifact);
    if (!location) {
      setError(`No real location is available for ${artifact.fileName}.`);
      return;
    }
    try {
      await openLocation(location);
    } catch (cause) {
      setError(`The location could not be opened. ${userFacingError(cause, 'Check the source path and try again.')}`);
    }
  };

  const uploadBrowserFiles = async (files: globalThis.File[]) => {
    const supported = files.filter(file => SUPPORTED_EXTENSIONS.has(extensionOf(file.name)));
    const unsupported = files.filter(file => !SUPPORTED_EXTENSIONS.has(extensionOf(file.name)));
    setError(unsupported.length > 0 ? `Unsupported source${unsupported.length === 1 ? '' : 's'} skipped: ${unsupported.map(file => file.name).join(', ')}` : null);
    if (supported.length === 0) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: supported.length });
    try {
      for (let index = 0; index < supported.length; index += 1) {
        const file = supported[index];
        await api.uploadArtifact(projectId, { fileName: file.name, content: await fileToBase64(file) });
        setUploadProgress({ current: index + 1, total: supported.length });
      }
      await finishUpload();
    } catch (cause) {
      setError(`Upload failed. ${userFacingError(cause, 'Check the file and try again.')}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleUpload = async () => {
    try {
      const selected = await pickPath({
        multiple: true,
        title: 'Select files to upload',
        filters: [{ name: 'Supported Files', extensions: Array.from(SUPPORTED_EXTENSIONS) }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setUploading(true);
      setUploadProgress({ current: 0, total: paths.length });
      setError(null);
      for (let index = 0; index < paths.length; index += 1) {
        const filePath = paths[index];
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const fileData = await readBinaryFile(filePath);
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < fileData.length; offset += chunkSize) binary += String.fromCharCode(...fileData.slice(offset, offset + chunkSize));
        await api.uploadArtifact(projectId, { fileName, content: btoa(binary) });
        setUploadProgress({ current: index + 1, total: paths.length });
      }
      await finishUpload();
    } catch (cause) {
      setError(`Upload failed. ${userFacingError(cause, 'Check the file and try again.')}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await uploadBrowserFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    await uploadBrowserFiles(Array.from(event.dataTransfer.files || []));
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleDropzoneKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  };

  const handleRepository = async () => {
    const selected = await pickPath({ directory: true, multiple: false, title: 'Select a repository folder' });
    if (!selected || Array.isArray(selected)) return;
    setImporting(true);
    setError(null);
    try {
      await api.importRepoArtifacts(projectId, selected);
      await loadArtifacts();
      setShowImportDialog(false);
      setIndexing(true);
      let attempts = 0;
      const poll = async () => {
        try {
          const status = await api.getIndexStatus(projectId);
          if (status.status === 'done' || status.status === 'error' || attempts >= 60) {
            setIndexing(false);
            if (status.status === 'error') setError(`Indexing failed. ${userFacingError(status.error, 'The source could not be indexed. Try again.')}`);
            return;
          }
          attempts += 1;
          window.setTimeout(() => { void poll(); }, 1000);
        } catch {
          setIndexing(false);
        }
      };
      window.setTimeout(() => { void poll(); }, 500);
    } catch (cause) {
      setError(userFacingError(cause, 'The source could not be updated. Try again.'));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const deletedIds = deleteTarget.kind === 'artifact'
        ? [deleteTarget.artifact.id]
        : deleteTarget.group.artifacts.map(artifact => artifact.id);
      for (const artifactId of deletedIds) await api.deleteArtifact(projectId, artifactId);
      setArtifacts(previous => previous.filter(artifact => !deletedIds.includes(artifact.id)));
      if (sourceView && (deleteTarget.kind === 'artifact'
        ? sourceView.kind === 'document' && sourceView.artifact.id === deleteTarget.artifact.id
        : sourceView.kind === 'repository' && sourceView.group.repoName === deleteTarget.group.repoName)) {
        goBackToSources();
      }
      setDeleteTarget(null);
    } catch (cause) {
      setError(userFacingError(cause, 'The source could not be removed. Try again.'));
    } finally {
      setDeleting(false);
    }
  };

  const renderDropzone = (className: string, label: string) => (
    <div
      className={`${className}${dragActive ? ' is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      onClick={openFilePicker}
      onKeyDown={handleDropzoneKeyDown}
      onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
      onDragOver={event => { event.preventDefault(); setDragActive(true); }}
      onDragLeave={event => { if (event.currentTarget === event.target) setDragActive(false); }}
      onDrop={event => { void handleDrop(event); }}
      aria-label={label}
    >
      <Upload size={28} aria-hidden="true" />
      <strong>{uploadProgress ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…` : 'Drop source files here'}</strong>
      <p>or press Enter to choose supported files from your computer.</p>
      <small>Supported: text, Markdown, code, PDF, and image files.</small>
    </div>
  );

  const renderSourceRow = (artifact: Artifact) => {
    const isDrive = artifact.source === 'drive';
    const canOpen = Boolean(validLocation(artifact));
    const openSource = () => { if (isDrive) void handleOpenWith(artifact); else openDocument(artifact); };
    return (
      <div key={artifact.id} className="source-directory-row" role="listitem" tabIndex={0} onClick={openSource} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSource(); } }}>
        <span className={`badge ${SOURCE_COLORS[artifact.source]}`}>{SOURCE_LABELS[artifact.source]}</span>
        <div className="source-directory-main">
          <strong>{artifact.fileName}</strong>
          <span>{displayLocation(artifact)}</span>
        </div>
        <div className="source-directory-meta"><span>{artifact.type.replace(/_/g, ' ')}</span></div>
        <div className="source-directory-actions">
          <button type="button" className="btn-secondary" onClick={event => { event.stopPropagation(); openSource(); }} disabled={isDrive && !canOpen}>Open</button>
          <button type="button" className="source-remove-button" aria-label={`Remove ${artifact.fileName}`} title={`Remove ${artifact.fileName}`} onClick={event => { event.stopPropagation(); setDeleteTarget({ kind: 'artifact', artifact }); }}><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>
    );
  };

  const renderRepositoryRow = (group: RepoGroup) => (
    <div key={group.repoName} className="source-directory-row source-directory-repository" role="listitem" tabIndex={0} onClick={() => openRepository(group)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRepository(group); } }}>
      <span className="badge badge-repository">Repository</span>
      <div className="source-directory-main">
        <strong>{group.repoName}</strong>
        <span>{group.rootPath || 'Repository location unavailable'}</span>
      </div>
      <div className="source-directory-meta"><span>{group.artifacts.length} file{group.artifacts.length === 1 ? '' : 's'}</span>{indexing && <span className="source-indexing" role="status"><RotateCw size={12} aria-hidden="true" /> Indexing…</span>}</div>
      <div className="source-directory-actions">
        <button type="button" className="btn-secondary" onClick={event => { event.stopPropagation(); openRepository(group, event); }}>Open</button>
        <button type="button" className="source-remove-button" aria-label={`Remove ${group.repoName} repository`} title={`Remove ${group.repoName} repository`} onClick={event => { event.stopPropagation(); setDeleteTarget({ kind: 'repository', group }); }}><Trash2 size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );

  const repositoryTree = sourceView?.kind === 'repository' ? buildTree(sourceView.group.artifacts, sourceView.group.rootPath) : [];
  const repositoryNodes = getNodesAtPath(repositoryTree, repoDirectory).filter(node => !repoSearch.trim() || node.name.toLowerCase().includes(repoSearch.trim().toLowerCase()));
  const selectedArtifact = sourceView?.kind === 'repository' ? selectedRepoArtifact : sourceView?.artifact;

  const renderRepositoryDetail = (group: RepoGroup) => {
    const parts = repoDirectory.split('/').filter(Boolean);
    return (
      <div className="source-detail-view source-repository-detail">
        <div className="source-detail-header">
          <button type="button" className="btn-back" onClick={goBackToSources}><ArrowLeft size={16} aria-hidden="true" /> Back to sources</button>
          <div><span className="badge badge-repository">Repository</span><h3>{group.repoName}</h3><p>{group.rootPath || 'Repository location unavailable'}</p>{indexing && <p className="source-indexing" role="status"><RotateCw size={12} aria-hidden="true" /> Indexing repository…</p>}</div>
          <button type="button" className="source-detail-remove btn-secondary" onClick={() => setDeleteTarget({ kind: 'repository', group })}><Trash2 size={15} aria-hidden="true" /> Remove</button>
        </div>
        <div className="source-repository-layout">
          <section className="source-tree-panel" aria-labelledby="source-tree-heading">
            <div className="source-tree-heading"><h4 id="source-tree-heading">Repository files</h4><span>{group.artifacts.length} files</span></div>
            <label className="source-tree-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">Search repository files</span><input type="search" aria-label="Search repository files" value={repoSearch} onChange={event => setRepoSearch(event.target.value)} placeholder="Search files" /></label>
            <nav className="source-tree-breadcrumbs" aria-label="Repository directory">
              <button type="button" className={!repoDirectory ? 'active' : ''} onClick={() => { setRepoDirectory(''); setSelectedRepoArtifact(null); setPreview(null); }}>Root</button>
              {parts.map((part, index) => {
                const path = parts.slice(0, index + 1).join('/');
                return <span key={path}><ChevronRight size={13} aria-hidden="true" /><button type="button" className={repoDirectory === path ? 'active' : ''} onClick={() => { setRepoDirectory(path); setSelectedRepoArtifact(null); setPreview(null); }}>{part}</button></span>;
              })}
            </nav>
            {repoDirectory && <button type="button" className="source-tree-parent" onClick={() => { const next = parts.slice(0, -1).join('/'); setRepoDirectory(next); setSelectedRepoArtifact(null); setPreview(null); }}><ArrowLeft size={14} aria-hidden="true" /> Parent directory</button>}
            <div className="source-tree" role="tree" aria-label="Repository directory tree">
              {repositoryNodes.length === 0 && <p className="source-preview-empty">This directory is empty.</p>}
              {repositoryNodes.map(node => {
                const nodePath = repoDirectory ? `${repoDirectory}/${node.name}` : node.name;
                if (node.isDir) return <button key={nodePath} type="button" className="source-tree-node source-tree-directory" role="treeitem" aria-expanded="false" onClick={() => { setRepoDirectory(nodePath); setSelectedRepoArtifact(null); setPreview(null); }}><ChevronRight size={15} aria-hidden="true" /><Folder size={16} aria-hidden="true" /><span>{node.name}</span><small>{countFiles(node)} file{countFiles(node) === 1 ? '' : 's'}</small></button>;
                return <button key={nodePath} type="button" className={`source-tree-node source-tree-file${selectedRepoArtifact?.id === node.artifact?.id ? ' selected' : ''}`} role="treeitem" aria-pressed={selectedRepoArtifact?.id === node.artifact?.id} onClick={() => { setSelectedRepoArtifact(node.artifact!); setMarkdownMode('preview'); void openPreview(node.artifact!); }}><File size={16} aria-hidden="true" /><span>{node.name}</span><small>{node.artifact?.type.replace(/_/g, ' ')}</small></button>;
              })}
            </div>
          </section>
          <section className="source-preview-panel" aria-labelledby="source-preview-heading">
            <div className="source-preview-heading"><h4 id="source-preview-heading">{selectedArtifact ? selectedArtifact.fileName : 'File preview'}</h4></div>
            {selectedArtifact && <p className="source-preview-location">{displayLocation(selectedArtifact)}</p>}
            <PreviewPane preview={preview} markdownMode={markdownMode} onMarkdownModeChange={setMarkdownMode} />
          </section>
        </div>
      </div>
    );
  };

  const renderDocumentDetail = (artifact: Artifact) => (
    <div className="source-detail-view source-document-detail">
      <div className="source-detail-header">
        <button type="button" className="btn-back" onClick={goBackToSources}><ArrowLeft size={16} aria-hidden="true" /> Back to sources</button>
        <div><span className={`badge ${SOURCE_COLORS[artifact.source]}`}>{SOURCE_LABELS[artifact.source]}</span><h3>{artifact.fileName}</h3><p>{displayLocation(artifact)}</p></div>
        <div className="source-detail-actions">
          <button type="button" className="source-remove-button" aria-label={`Remove ${artifact.fileName}`} title={`Remove ${artifact.fileName}`} onClick={() => setDeleteTarget({ kind: 'artifact', artifact })}><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <dl className="source-metadata">
        <div><dt>Category</dt><dd>{artifact.type.replace(/_/g, ' ')}</dd></div>
        <div><dt>Location</dt><dd className="source-technical-text">{displayLocation(artifact)}</dd></div>
        <div><dt>Added</dt><dd>{new Date(artifact.createdAt).toLocaleString()}</dd></div>
      </dl>
      <section className="source-preview-panel source-document-preview" aria-labelledby="source-preview-heading">
        <div className="source-preview-heading"><h4 id="source-preview-heading">Preview</h4></div>
        <PreviewPane preview={preview} markdownMode={markdownMode} onMarkdownModeChange={setMarkdownMode} />
      </section>
    </div>
  );

  if (loading) return <div className="panel-loading" role="status">Loading sources...</div>;

  if (sourceView) {
    return (
      <div className="artifacts-panel source-detail-shell">
        <input ref={fileInputRef} className="visually-hidden" type="file" multiple onChange={event => { void handleFileInput(event); }} aria-label="Select source files" />
        {error && <p className="form-error" role="alert">{error}</p>}
        {sourceView.kind === 'document' ? renderDocumentDetail(sourceView.artifact) : renderRepositoryDetail(sourceView.group)}
        <ConfirmDialog
          isOpen={deleteTarget !== null}
          title={deleteTarget?.kind === 'repository' ? 'Remove repository?' : 'Remove source?'}
          description={deleteTarget?.kind === 'repository' ? `Remove ${deleteTarget.group.repoName} and its ${deleteTarget.group.artifacts.length} indexed files from this project?` : `Remove ${deleteTarget?.artifact.fileName ?? 'this source'} from this project?`}
          confirmLabel={deleteTarget?.kind === 'repository' ? 'Remove repository' : 'Remove source'}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          busy={deleting}
        />
      </div>
    );
  }

  return (
    <div className="artifacts-panel">
      <div className="panel-header source-directory-header">
        <div><h3><Folder size={18} aria-hidden="true" /> Sources</h3></div>
        <button type="button" className="btn-secondary" onClick={() => setShowImportDialog(true)}><Plus size={17} aria-hidden="true" /> Add source</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <input ref={fileInputRef} className="visually-hidden" type="file" multiple onChange={event => { void handleFileInput(event); }} aria-label="Select source files" />

      {artifacts.length === 0 ? renderDropzone('artifacts-empty artifacts-empty-dropzone', 'Add source files') : (
        <div className="source-directory" role="list" aria-label="Project sources">
          {docArtifacts.map(renderSourceRow)}
          {repoGroups.map(renderRepositoryRow)}
          {driveArtifacts.map(renderSourceRow)}
        </div>
      )}

      {showImportDialog && (
        <Modal isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} title="Add source" width={780}>
          <div className="import-dialog-body">
            {renderDropzone('import-dropzone', 'Drop source files to upload')}
            <div className="import-options" role="list" aria-label="Source categories">
              <button type="button" className="import-option" onClick={() => void handleUpload()} disabled={uploading}><Upload size={24} aria-hidden="true" /><span>Documents</span><small>{uploading ? 'Uploading…' : 'Available'}</small></button>
              <button type="button" className="import-option" onClick={() => void handleRepository()} disabled={importing}><Folder size={24} aria-hidden="true" /><span>Repository</span><small>{importing ? 'Importing…' : 'Available'}</small></button>
              <button type="button" className="import-option" disabled aria-describedby="connector-source-note"><GitBranch size={24} aria-hidden="true" /><span>GitHub</span><small>Unavailable</small></button>
              <button type="button" className="import-option" disabled aria-describedby="connector-source-note"><Cloud size={24} aria-hidden="true" /><span>Google Drive</span><small>Unavailable</small></button>
              <button type="button" className="import-option" disabled aria-describedby="connector-source-note"><MessageSquare size={24} aria-hidden="true" /><span>Slack</span><small>Unavailable</small></button>
            </div>
            <p id="connector-source-note" className="import-dialog-note">Local documents and repository import are available now. GitHub, Google Drive, and Slack remain unavailable until a connected location is returned by the application.</p>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={deleteTarget?.kind === 'repository' ? 'Remove repository?' : 'Remove source?'}
        description={deleteTarget?.kind === 'repository' ? `Remove ${deleteTarget.group.repoName} and its ${deleteTarget.group.artifacts.length} indexed files from this project?` : `Remove ${deleteTarget?.artifact.fileName ?? 'this source'} from this project?`}
        confirmLabel={deleteTarget?.kind === 'repository' ? 'Remove repository' : 'Remove source'}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
      />
    </div>
  );
}
