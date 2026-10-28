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
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
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
import { StatusBadge } from './CommandUI';
import './ArtifactsPanel.css';
import type { Artifact, ArtifactSource, ConnectedSource, ConnectedSourceBrowseEntry, ConnectedSourceStatusResult, ConnectedSourceSyncRun, IntegrationProvider } from '../types';
import { userFacingError } from '../utils/userFacingError';
import { SourceIndexStatus } from './SourceIndexStatus';

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
  directory: 'Directory',
  drive: 'Google Drive',
};

const CATEGORY_LABELS: Record<Artifact['type'], string> = {
  requirement: 'Requirements', design: 'Design', source_code: 'Code', coding_standard: 'Coding standards', other: 'Document',
};

const CONNECTOR_LABELS: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  google_drive: 'Google Drive',
  slack: 'Slack',
};

const CONNECTOR_KINDS: Record<IntegrationProvider, ConnectedSource['kind']> = {
  github: 'github_repository',
  google_drive: 'google_drive',
  slack: 'slack_channel',
};

type RepoGroup = {
  repoName: string;
  repoPath: string;
  rootPath: string;
  location?: string | null;
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
  /** Route the user to the global OAuth connection settings. */
  onOpenSettings?: () => void;
  initialView?: 'sources' | 'repository';
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

type ConnectedSourceRunView = {
  label: string;
  statusClass: string;
  active: boolean;
  needsAttention: boolean;
  reconnect: boolean;
  processed: number;
  countsAvailable: boolean;
  lastUpdated: string | null;
};

function connectedSourceRunView(source: ConnectedSource): ConnectedSourceRunView {
  const run = source.latestSyncRun;
  if (!run) {
    const labels = { idle: 'Not synced', syncing: 'In progress', ready: 'Completed', error: 'Needs attention' };
    const label = source.status === 'active' ? labels[source.syncStatus] : source.status === 'removed' ? 'Removed' : 'Needs attention';
    return {
      label: label || 'Not synced', statusClass: source.syncStatus === 'error' ? 'error' : 'idle',
      active: source.syncStatus === 'syncing', needsAttention: Boolean(source.lastError) || source.syncStatus === 'error' || ['inaccessible', 'disconnected'].includes(source.status), reconnect: ['inaccessible', 'disconnected'].includes(source.status),
      processed: 0, countsAvailable: false, lastUpdated: source.lastSyncedAt,
    };
  }
  const failed = run.status === 'failure' || run.status === 'partial' && Boolean(run.errorCode || run.errorMessage);
  const retrying = run.status === 'running' && Boolean(run.nextAttemptAt && Date.parse(run.nextAttemptAt) > Date.now());
  const labels: Record<ConnectedSourceSyncRun['status'], string> = {
    queued: 'Queued', running: retrying ? 'Retrying' : 'Importing',
    partial: failed ? 'Needs attention' : 'Importing', success: 'Completed', failure: 'Failed', cancelled: 'Cancelled',
  };
  const reconnectCodes = new Set(['http_401', 'token_expired', 'integration_disconnected', 'invalid_credentials', 'slack_missing_scope', 'slack_invalid_auth', 'slack_token_revoked', 'slack_token_expired']);
  const processed = run.importedCount + run.updatedCount + run.unchangedCount + run.removedCount + run.inaccessibleCount;
  return {
    label: retrying && run.retryAttempt && run.retryLimit ? `Retrying · ${run.retryAttempt} of ${run.retryLimit}` : labels[run.status],
    statusClass: failed ? 'error' : run.status,
    active: run.status === 'queued' || run.status === 'running' || run.status === 'partial' && !failed,
    needsAttention: failed || Boolean(source.lastError) || ['inaccessible', 'disconnected'].includes(source.status),
    reconnect: ['inaccessible', 'disconnected'].includes(source.status) || reconnectCodes.has(run.errorCode ?? ''),
    processed,
    countsAvailable: (run.attemptCount ?? 0) > 0 || processed > 0,
    lastUpdated: source.lastSyncedAt ?? run.startedAt ?? run.createdAt,
  };
}

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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function pathParts(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

/**
 * Legacy/local artifact records do not carry a repository id. Use their persisted
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
  return /^(https?:\/\/|[A-Za-z]:[/\\]|\\\\|\/)/i.test(value) ? value : null;
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
  onRetry,
}: {
  preview: PreviewState | null;
  markdownMode: MarkdownMode;
  onMarkdownModeChange: (mode: MarkdownMode) => void;
  onRetry: () => void;
}) {
  if (!preview) return <p className="source-preview-empty">Select a file to preview it.</p>;
  if (preview.loading) return <div className="panel-loading" role="status">Loading preview…</div>;
  if (preview.error) return <div className="source-preview-feedback"><p className="form-error" role="alert">{preview.error}</p><button type="button" className="btn-secondary" onClick={onRetry}>Retry preview</button></div>;
  if (!preview.kind) return <p className="source-preview-unavailable">Preview not available</p>;
  if (preview.content === null) return <p className="source-preview-empty">Preview not available.</p>;
  if (preview.kind === 'text' && preview.content === '') return <p className="source-preview-empty">This file is empty.</p>;

  const isMarkdown = extensionOf(preview.artifact.fileName) === 'md';
  return (
    <div className="source-preview-content">
      {isMarkdown && (
        <div className="source-preview-mode" role="group" aria-label="Markdown preview mode">
          <button type="button" className={markdownMode === 'preview' ? 'active' : ''} aria-pressed={markdownMode === 'preview'} onClick={() => onMarkdownModeChange('preview')}>Preview</button>
          <button type="button" className={markdownMode === 'original' ? 'active' : ''} aria-pressed={markdownMode === 'original'} onClick={() => onMarkdownModeChange('original')}>Code</button>
          <span className="source-file-line-count">{preview.content.split('\n').length} lines</span>
        </div>
      )}
      {preview.kind === 'text' && isMarkdown && markdownMode === 'preview' && (
        <article className="artifact-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown></article>
      )}
      {preview.kind === 'text' && (!isMarkdown || markdownMode === 'original') && (
        <><div className="source-code-toolbar"><strong>Code</strong><span>{preview.content.split('\n').length} lines</span></div><pre className="artifact-text-preview" tabIndex={0} aria-label="File code"><span className="source-code-grid"><span className="source-line-numbers" aria-hidden="true">{preview.content.split('\n').map((_, index) => index + 1).join('\n')}</span><code>{preview.content}</code></span></pre></>
      )}
      {preview.kind === 'image' && <div className="artifact-image-preview"><img src={preview.content} alt={`Preview of ${preview.artifact.fileName}`} /></div>}
      {preview.kind === 'pdf' && <iframe className="artifact-pdf-preview" src={preview.content} title={`Preview of ${preview.artifact.fileName}`} />}
    </div>
  );
}

export function ArtifactsPanel({ projectId, onOpenSettings, initialView = 'sources' }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [connectedSources, setConnectedSources] = useState<ConnectedSource[]>([]);
  const [sourceStatusStale, setSourceStatusStale] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceCategory, setSourceCategory] = useState<'all' | 'repositories' | 'documents' | 'images'>('all');
  const [sourcePage, setSourcePage] = useState(1);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourceView, setSourceView] = useState<SourceView | null>(null);
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [repoDirectory, setRepoDirectory] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepoArtifact, setSelectedRepoArtifact] = useState<Artifact | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');
  const [connectorProvider, setConnectorProvider] = useState<IntegrationProvider | null>(null);
  const [connectorStatus, setConnectorStatus] = useState<ConnectedSourceStatusResult | null>(null);
  const [connectorItems, setConnectorItems] = useState<ConnectedSourceBrowseEntry[]>([]);
  const [connectorCursor, setConnectorCursor] = useState<string | null>(null);
  const [connectorParent, setConnectorParent] = useState<ConnectedSourceBrowseEntry | null>(null);
  const [connectorSelection, setConnectorSelection] = useState<ConnectedSourceBrowseEntry | null>(null);
  const [connectorQuery, setConnectorQuery] = useState('');
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [historySource, setHistorySource] = useState<ConnectedSource | null>(null);
  const [syncHistory, setSyncHistory] = useState<ConnectedSourceSyncRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSourceTriggerRef = useRef<string | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileReaderRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const initialViewAppliedRef = useRef(false);

  const loadArtifacts = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    const [artifactResult, sourceResult] = await Promise.allSettled([
      api.listArtifacts(projectId),
      typeof api.listConnectedSources === 'function' ? api.listConnectedSources(projectId) : Promise.resolve([]),
    ]);
    const errors: string[] = [];
    if (artifactResult.status === 'fulfilled') { setArtifacts(artifactResult.value); setFilesLoaded(true); }
    else errors.push(`Files could not be refreshed. ${userFacingError(artifactResult.reason, 'Try again.')}`);
    if (sourceResult.status === 'fulfilled') {
      setConnectedSources(sourceResult.value);
      setSourceStatusStale(false);
    } else {
      setSourceStatusStale(true);
      errors.push(`Connection status is unavailable; showing the last known progress. ${userFacingError(sourceResult.reason, 'Retry shortly.')}`);
    }
    setError(errors.length ? errors.join(' ') : null);
    hasLoadedRef.current = true;
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void loadArtifacts(); }, [loadArtifacts]);

  useEffect(() => { if (sourceView) detailHeadingRef.current?.focus(); }, [sourceView]);
  useEffect(() => {
    if (fileReaderRef.current) { fileReaderRef.current.scrollTop = 0; fileReaderRef.current.scrollLeft = 0; }
  }, [preview?.artifact.id]);
  const needsSourceAttention = connectedSources.some(source => connectedSourceRunView(source).needsAttention);
  useEffect(() => { if (needsSourceAttention) setUpdatesOpen(true); }, [needsSourceAttention]);

  const activeSourceKey = connectedSources
    .filter(source => connectedSourceRunView(source).active)
    .map(source => source.id)
    .sort()
    .join('|');
  const connectedSourceKey = connectedSources.map(source => source.id).sort().join('|');

  useEffect(() => {
    if (!connectedSourceKey || typeof api.listConnectedSources !== 'function') return undefined;
    let disposed = false;
    let requestInFlight = false;
    let timer: number | undefined;
    const poll = async () => {
      if (disposed || requestInFlight) return;
      requestInFlight = true;
      try {
        const sources = await api.listConnectedSources(projectId);
        // A workspace-level automatic sync can start while every visible
        // source is idle. Refresh idle sources too, and fetch the saved file
        // inventory when a run has finished so counts do not remain stale.
        if (!disposed && !sources.some(source => connectedSourceRunView(source).active)) {
          try {
            const refreshed = await api.listArtifacts(projectId);
            if (!disposed) {
              setArtifacts(refreshed);
              setError(current => current?.startsWith('Files could not be refreshed.') ? null : current);
            }
          } catch (cause) {
            if (!disposed) setError(`Files could not be refreshed. ${userFacingError(cause, 'Try again.')}`);
          }
        }
        if (!disposed) {
          setConnectedSources(sources);
          setSourceStatusStale(false);
        }
      } catch {
        if (!disposed) setSourceStatusStale(true);
      } finally {
        requestInFlight = false;
        if (!disposed) timer = window.setTimeout(() => { void poll(); }, activeSourceKey ? 2_000 : 30_000);
      }
    };
    timer = window.setTimeout(() => { void poll(); }, activeSourceKey ? 1_000 : 30_000);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeSourceKey, connectedSourceKey, projectId]);

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
    const bySource = new Map<string | null, Artifact[]>();
    for (const artifact of repositories) {
      const key = artifact.sourceId || null;
      const files = bySource.get(key) ?? [];
      files.push(artifact);
      bySource.set(key, files);
    }
    const groups: RepoGroup[] = [...bySource].map(([sourceId, files]) => {
      if (sourceId) {
        const source = connectedSources.find(item => item.id === sourceId && item.projectId === projectId && item.kind === 'github_repository');
        return { repoName: source?.name.trim() || 'Imported repository', repoPath: `connected:${sourceId}`,
          rootPath: '', location: source?.remoteUrl, artifacts: files };
      }
      const rootPath = commonRepositoryRoot(files);
      const parts = pathParts(rootPath);
      return { repoName: parts[parts.length - 1] || 'Imported repository', repoPath: rootPath, rootPath, artifacts: files };
    });
    return { docArtifacts: docs, repoGroups: groups, driveArtifacts: drive };
  }, [artifacts, connectedSources, projectId]);

  useEffect(() => {
    if (loading || initialViewAppliedRef.current) return;
    initialViewAppliedRef.current = true;
    if (initialView === 'repository' && repoGroups.length === 1 && docArtifacts.length === 0 && driveArtifacts.length === 0) {
      setSourceView({ kind: 'repository', group: repoGroups[0] });
    }
  }, [initialView, loading, repoGroups, docArtifacts.length, driveArtifacts.length]);

  const finishUpload = async () => {
    await loadArtifacts();
    setShowImportDialog(false);
  };

  const openPreview = useCallback(async (artifact: Artifact) => {
    const kind = artifactKind(artifact.fileName);
    setPreview({ artifact, kind, content: null, error: null, loading: Boolean(kind) });
    if (!kind) return;
    try {
      const stored = await api.getArtifactContent(artifact.projectId, artifact.id, artifact.versionId);
      const bytes = kind === 'text' ? Uint8Array.from(atob(stored.content), character => character.charCodeAt(0)) : null;
      const content = kind === 'text' ? new TextDecoder().decode(bytes!) : `data:${mimeType(artifact.fileName)};base64,${stored.content}`;
      setPreview(current => current?.artifact.id === artifact.id ? { ...current, content, loading: false } : current);
    } catch (cause) {
      setPreview(current => current?.artifact.id === artifact.id
        ? { ...current, error: `This file could not be previewed. ${userFacingError(cause, 'Try again.')}`, loading: false }
        : current);
    }
  }, []);

  const rememberTrigger = (event: React.MouseEvent<HTMLButtonElement>) => {
    lastSourceTriggerRef.current = event.currentTarget.id;
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
    setFileTreeOpen(true);
    setExpandedDirectories(new Set());
  };

  const goBackToSources = () => {
    setSourceView(null);
    setRepoDirectory('');
    setRepoSearch('');
    setSelectedRepoArtifact(null);
    setPreview(null);
    window.requestAnimationFrame(() => { if (lastSourceTriggerRef.current) document.getElementById(lastSourceTriggerRef.current)?.focus(); });
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
    if (uploading || importing || connectorLoading) return;
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
    if (uploading || importing || connectorLoading) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  };

  const handleRepository = async () => {
    try {
      const selected = await pickPath({ directory: true, multiple: false, title: 'Select a repository folder' });
      if (!selected || Array.isArray(selected)) return;
      setImporting(true);
      setError(null);
      await api.importRepoArtifacts(projectId, selected);
      await loadArtifacts();
      setShowImportDialog(false);
    } catch (cause) {
      setError(userFacingError(cause, 'The source could not be updated. Try again.'));
    } finally {
      setImporting(false);
    }
  };

  const closeConnector = () => {
    setConnectorProvider(null);
    setConnectorStatus(null);
    setConnectorItems([]);
    setConnectorCursor(null);
    setConnectorParent(null);
    setConnectorSelection(null);
    setConnectorQuery('');
    setConnectorError(null);
  };

  const browseConnector = async (
    provider: IntegrationProvider,
    options: { remoteId?: string; cursor?: string; query?: string } = {},
    append = false,
  ) => {
    setConnectorLoading(true);
    setConnectorError(null);
    try {
      const page = await api.browseConnectedSources(provider, { ...options, pageSize: 50 });
      setConnectorItems(previous => append ? [...previous, ...page.items] : page.items);
      setConnectorCursor(page.nextCursor);
    } catch (cause) {
      setConnectorError(userFacingError(cause, `Could not browse ${CONNECTOR_LABELS[provider]}. Reconnect it in Settings and try again.`));
    } finally {
      setConnectorLoading(false);
    }
  };

  const openConnector = async (provider: IntegrationProvider) => {
    if (typeof api.getConnectedSourceStatus !== 'function' || typeof api.browseConnectedSources !== 'function') {
      onOpenSettings?.();
      return;
    }
    setConnectorLoading(true);
    setConnectorError(null);
    try {
      const status = await api.getConnectedSourceStatus(provider, projectId);
      if (!status.connected) {
        if (onOpenSettings) { setShowImportDialog(false); onOpenSettings(); }
        else setConnectorError(`Connect ${CONNECTOR_LABELS[provider]} in Settings before importing a source.`);
        return;
      }
      setConnectorProvider(provider);
      setConnectorStatus(status);
      setConnectorParent(null);
      setConnectorSelection(null);
      setConnectorQuery('');
      const page = await api.browseConnectedSources(provider, { pageSize: 50 });
      setConnectorItems(page.items);
      setConnectorCursor(page.nextCursor);
    } catch (cause) {
      setConnectorError(userFacingError(cause, `Could not open ${CONNECTOR_LABELS[provider]}. Try again.`));
    } finally {
      setConnectorLoading(false);
    }
  };

  const selectConnectorEntry = async (entry: ConnectedSourceBrowseEntry) => {
    if (connectorProvider === 'github' && entry.kind === 'repository') {
      setConnectorParent(entry);
      setConnectorSelection(null);
      await browseConnector('github', { remoteId: entry.id });
      return;
    }
    if (connectorProvider === 'google_drive' && entry.kind === 'folder') {
      setConnectorParent(entry);
      setConnectorSelection(entry);
      await browseConnector('google_drive', { remoteId: entry.id });
      return;
    }
    setConnectorSelection(entry);
  };

  const importConnectorSelection = async () => {
    if (!connectorProvider || !connectorSelection) return;
    const remote = connectorProvider === 'github' ? connectorParent : connectorSelection;
    if (!remote) return;
    setConnectorLoading(true);
    setConnectorError(null);
    try {
      const selectedScope = connectorProvider === 'github'
        ? { branch: connectorSelection.id }
        : connectorProvider === 'google_drive'
          ? { resourceKind: connectorSelection.kind === 'folder' ? 'folder' : 'file' }
          : { channelId: connectorSelection.id };
      await api.importConnectedSource(projectId, {
        provider: connectorProvider,
        kind: CONNECTOR_KINDS[connectorProvider],
        remoteId: remote.id,
        remoteUrl: remote.remoteUrl ?? null,
        name: remote.name,
        selectedScope,
        sync: true,
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${remote.id}`,
      });
      await loadArtifacts();
      closeConnector();
      setShowImportDialog(false);
    } catch (cause) {
      setConnectorError(userFacingError(cause, 'The connected source could not be imported. Review the connection and try again.'));
    } finally {
      setConnectorLoading(false);
    }
  };

  const syncConnectedSource = async (source: ConnectedSource) => {
    setSyncingSourceId(source.id);
    setError(null);
    try {
      await api.syncConnectedSource(projectId, source.id, { idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${source.id}` });
      await loadArtifacts();
    } catch (cause) {
      setError(userFacingError(cause, `Could not synchronize ${source.name}. Try again or reconnect ${CONNECTOR_LABELS[source.provider]} in Settings.`));
    } finally {
      setSyncingSourceId(null);
    }
  };

  const openSyncHistory = async (source: ConnectedSource) => {
    setHistorySource(source);
    setSyncHistory([]);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setSyncHistory(await api.getConnectedSourceSyncHistory(projectId, source.id));
    } catch (cause) {
      setHistoryError(userFacingError(cause, `Could not load synchronization history for ${source.name}.`));
    } finally {
      setHistoryLoading(false);
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
        : sourceView.kind === 'repository' && sourceView.group.repoPath === deleteTarget.group.repoPath)) {
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
      tabIndex={uploading || importing || connectorLoading ? -1 : 0}
      aria-disabled={uploading || importing || connectorLoading}
      onClick={() => { if (!uploading && !importing && !connectorLoading) openFilePicker(); }}
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
    return (
      <tr key={artifact.id}>
        <td><div className="source-directory-main">
          <button id={`source-open-${artifact.id}`} type="button" className="source-name-link" aria-label={`View ${artifact.fileName}`} onClick={event => openDocument(artifact, event)}>{artifact.fileName}</button>
          <span>{SOURCE_LABELS[artifact.source]}</span>
        </div></td><td>{artifactKind(artifact.fileName) === 'image' ? 'Image' : CATEGORY_LABELS[artifact.type]}</td><td className="source-table-date">{new Date(artifact.createdAt).toLocaleDateString()}</td>
      </tr>
    );
  };

  const renderRepositoryRow = (group: RepoGroup) => (
    <tr key={group.repoPath}>
      <td><div className="source-directory-main">
        <button id={`source-open-repository-${encodeURIComponent(group.repoPath)}`} type="button" className="source-name-link" aria-label={`View ${group.repoName}`} onClick={event => openRepository(group, event)}>{group.repoName}</button>
        <span>{group.artifacts.length} file{group.artifacts.length === 1 ? '' : 's'}</span>
      </div></td><td><Folder size={15} aria-hidden="true" /> Repository</td><td className="source-table-date">—</td>
    </tr>
  );

  const renderConnectedSourceRow = (source: ConnectedSource) => {
    const view = connectedSourceRunView(source);
    const busy = syncingSourceId === source.id || view.active;
    const label = source.status === 'removed' ? 'Removed' : view.needsAttention ? 'Needs attention' : view.label;
    return (
      <li key={source.id} className="source-update-row">
        <div className="source-directory-main">
          <strong>{source.name}</strong>
          <span>{CONNECTOR_LABELS[source.provider]} · {source.lastSuccessfulSyncAt ? `Synced ${new Date(source.lastSuccessfulSyncAt).toLocaleString()}` : 'Not synced yet'}</span>
          {(source.lastError || source.latestSyncRun?.errorMessage) && <p className="connected-source-error">{source.lastError || source.latestSyncRun?.errorMessage}</p>}
          {view.reconnect && <p className="connected-source-error">Reconnect {CONNECTOR_LABELS[source.provider]} in Settings to update this source.</p>}
        </div>
        <StatusBadge label={label} tone={view.needsAttention ? 'danger' : view.active ? 'running' : label === 'Completed' ? 'success' : 'neutral'} />
        <div className="source-directory-actions" role="group" aria-label={`Update ${source.name}`}>
          <button type="button" className="btn-secondary" onClick={() => void openSyncHistory(source)}>History</button>
          {view.reconnect ? <button type="button" className="btn-secondary" onClick={onOpenSettings} disabled={!onOpenSettings}>Reconnect</button> :
            <button type="button" className="btn-secondary" onClick={() => void syncConnectedSource(source)} disabled={busy || source.status !== 'active'}><RotateCw size={15} aria-hidden="true" /> {busy ? 'Syncing…' : view.needsAttention ? 'Retry sync' : 'Sync'}</button>}
        </div>
      </li>
    );
  };

  const currentRepository = sourceView?.kind === 'repository'
    ? repoGroups.find(group => group.repoPath === sourceView.group.repoPath) ?? sourceView.group : null;
  const repositoryTree = currentRepository ? buildTree(currentRepository.artifacts, currentRepository.rootPath) : [];
  const repositoryNodes = getNodesAtPath(repositoryTree, repoDirectory);
  const selectedArtifact = sourceView?.kind === 'repository' ? selectedRepoArtifact : sourceView?.artifact;
  const relativePath = (artifact: Artifact, root: string) => {
    const path = normalizePath(displayLocation(artifact));
    return root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? path.slice(root.length + 1) : path;
  };
  const selectFile = (artifact: Artifact) => {
    if (sourceView?.kind === 'repository') {
      const parts = relativePath(artifact, sourceView.group.rootPath).split('/').slice(0, -1);
      setExpandedDirectories(current => new Set([...current, ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))]));
    }
    if (!selectedRepoArtifact) window.requestAnimationFrame(() => document.getElementById('source-preview-heading')?.focus());
    setSelectedRepoArtifact(artifact); setMarkdownMode('preview'); void openPreview(artifact);
  };
  const renderPreview = () => <PreviewPane preview={preview} markdownMode={markdownMode} onMarkdownModeChange={setMarkdownMode} onRetry={() => { if (preview) void openPreview(preview.artifact); }} />;
  const matchesSource = (text: string) => text.toLowerCase().includes(sourceQuery.trim().toLowerCase());
  const visibleDocuments = [...docArtifacts, ...driveArtifacts].filter(artifact => sourceCategory !== 'repositories' && (sourceCategory === 'all' || (sourceCategory === 'images' ? artifactKind(artifact.fileName) === 'image' : artifactKind(artifact.fileName) !== 'image')) && matchesSource(`${artifact.fileName} ${displayLocation(artifact)} ${SOURCE_LABELS[artifact.source]} ${CATEGORY_LABELS[artifact.type]}`));
  const visibleRepositories = repoGroups.filter(group => (sourceCategory === 'all' || sourceCategory === 'repositories') && (matchesSource(`${group.repoName} repository ${group.rootPath}`) || group.artifacts.some(artifact => matchesSource(displayLocation(artifact)))));
  const hasMaterials = artifacts.length > 0;
  const visibleSourceRows = [...visibleRepositories.map(renderRepositoryRow), ...visibleDocuments.map(renderSourceRow)];
  const sourcePageCount = Math.max(1, Math.ceil(visibleSourceRows.length / 20));
  const currentSourcePage = Math.min(sourcePage, sourcePageCount);

  const renderRepositoryDetail = (group: RepoGroup) => {
    const filePath = selectedRepoArtifact ? relativePath(selectedRepoArtifact, group.rootPath) : '';
    const parts = (selectedRepoArtifact ? filePath.split('/').slice(0, -1).join('/') : repoDirectory).split('/').filter(Boolean);
    const results = repoSearch.trim() ? group.artifacts.filter(artifact => relativePath(artifact, group.rootPath).toLowerCase().includes(repoSearch.trim().toLowerCase())) : null;
    const navigateDirectory = (path: string) => { setRepoDirectory(path); setSelectedRepoArtifact(null); setPreview(null); setRepoSearch(''); };
    const renderBreadcrumbs = () => <nav className="source-path" aria-label="Repository directory">
      <button type="button" onClick={() => navigateDirectory('')} aria-current={!parts.length && !selectedRepoArtifact ? 'location' : undefined}>{group.repoName}</button>
      {parts.map((part, index) => { const path = parts.slice(0, index + 1).join('/'); return <span key={path}><span aria-hidden="true">/</span><button type="button" aria-current={!selectedRepoArtifact && index === parts.length - 1 ? 'location' : undefined} onClick={() => navigateDirectory(path)}>{part}</button></span>; })}
      {selectedRepoArtifact && <span><span aria-hidden="true">/</span><strong>{selectedRepoArtifact.fileName}</strong></span>}
    </nav>;
    const renderFileSearch = () => <div className="source-go-to-file"><label className="visually-hidden" htmlFor="repository-file-search">Find a file</label><div className="source-search"><Search size={16} aria-hidden="true" /><input id="repository-file-search" type="search" value={repoSearch} onChange={event => setRepoSearch(event.target.value)} placeholder="Go to file" /></div></div>;
    const renderTree = (nodes: TreeNode[], parent = ''): React.ReactNode => <ul className="source-file-tree" aria-label={parent ? undefined : 'Repository files'}>{nodes.map(node => {
      const path = parent ? `${parent}/${node.name}` : node.name;
      const expanded = expandedDirectories.has(path);
      return <li key={path}>
        {node.isDir ? <><button type="button" className="source-tree-node" aria-expanded={expanded} onClick={() => setExpandedDirectories(current => { const next = new Set(current); if (expanded) next.delete(path); else next.add(path); return next; })}>{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}<Folder size={16} aria-hidden="true" /><span>{node.name}</span></button>{expanded && renderTree(node.children ?? [], path)}</> : <button type="button" className={`source-tree-node${selectedRepoArtifact?.id === node.artifact?.id ? ' selected' : ''}`} aria-pressed={selectedRepoArtifact?.id === node.artifact?.id} onClick={() => selectFile(node.artifact!)}><File size={16} aria-hidden="true" /><span>{node.name}</span></button>}
      </li>;
    })}</ul>;
    const renderMatches = () => <><p className="source-search-result" role="status">{results?.length ? `${results.length} matching file${results.length === 1 ? '' : 's'}` : 'No files match your search.'}</p><button type="button" className="btn-back" onClick={() => setRepoSearch('')}>Clear file search</button><ul className="source-file-tree" aria-label="Matching repository files">{results?.map(artifact => <li key={artifact.id}><button type="button" className="source-tree-node" aria-pressed={selectedRepoArtifact?.id === artifact.id} onClick={() => selectFile(artifact)}><File size={16} aria-hidden="true" /><span>{artifact.fileName}<small>{relativePath(artifact, group.rootPath)}</small></span></button></li>)}</ul></>;
    const renderTableRow = (node: TreeNode) => {
      let name = node.name;
      let directory = node;
      while (directory.isDir && directory.children?.length === 1 && directory.children[0].isDir) {
        directory = directory.children[0]; name += `/${directory.name}`;
      }
      const nodePath = repoDirectory ? `${repoDirectory}/${name}` : name;
      return <tr key={nodePath}><td><button type="button" className="source-file-link" onClick={() => node.isDir ? navigateDirectory(nodePath) : selectFile(node.artifact!)}>{node.isDir ? <Folder size={18} aria-hidden="true" /> : <File size={18} aria-hidden="true" />}<span>{name}</span>{node.isDir && <span className="visually-hidden"> {countFiles(node)} file{countFiles(node) === 1 ? '' : 's'}</span>}</button></td><td className="source-table-description">{node.isDir ? `${countFiles(node)} file${countFiles(node) === 1 ? '' : 's'}` : CATEGORY_LABELS[node.artifact!.type]}</td><td className="source-table-date">{node.artifact ? new Date(node.artifact.createdAt).toLocaleDateString() : '—'}</td></tr>;
    };
    return <div className="source-detail-view source-repository-detail">
      <button type="button" className="btn-back source-back" onClick={goBackToSources}><ArrowLeft size={16} aria-hidden="true" /> All sources</button>
      {!selectedRepoArtifact && <header className="source-detail-header"><div className="source-repo-identity"><Folder size={21} aria-hidden="true" /><h3 ref={detailHeadingRef} tabIndex={-1}>{group.repoName}</h3><span className="source-kind">Repository</span></div></header>}
      {selectedRepoArtifact ? <div className={`source-file-layout${fileTreeOpen ? '' : ' is-collapsed'}`}>
        {fileTreeOpen && <aside className="source-files-sidebar" aria-label="Files navigation"><div className="source-sidebar-heading"><button type="button" className="btn-secondary" aria-label="Hide files" onClick={() => setFileTreeOpen(false)}><PanelLeftClose size={17} aria-hidden="true" /></button><h4>Files</h4></div>{renderFileSearch()}<div className="source-files-scroll" tabIndex={0} aria-label="Scrollable repository files">{results ? renderMatches() : renderTree(repositoryTree)}</div></aside>}
        <section className="source-file-main" aria-label="File viewer"><div className="source-file-pathbar">{!fileTreeOpen && <button type="button" className="btn-secondary" aria-label="Show files" onClick={() => setFileTreeOpen(true)}><PanelLeftOpen size={17} aria-hidden="true" /></button>}{renderBreadcrumbs()}</div><div className="source-import-summary"><File size={16} aria-hidden="true" /><span>Saved source</span><time dateTime={selectedRepoArtifact.createdAt}>Added {new Date(selectedRepoArtifact.createdAt).toLocaleDateString()}</time></div><div ref={fileReaderRef} className="source-file-reader" tabIndex={0} aria-label="Scrollable file content"><h4 id="source-preview-heading" className="visually-hidden" tabIndex={-1}>{selectedRepoArtifact.fileName}</h4>{renderPreview()}</div></section>
      </div> : <><div className="source-repo-toolbar">{renderBreadcrumbs()}<div className="source-repo-actions">{renderFileSearch()}<button type="button" className="btn-secondary" onClick={() => setShowImportDialog(true)}><Plus size={16} aria-hidden="true" /> Add file</button></div></div>{results ? <div className="source-search-table">{renderMatches()}</div> : <div className="source-table-shell"><div className="source-import-summary"><Folder size={16} aria-hidden="true" /><strong>Imported files</strong><span>{group.artifacts.length} files</span></div><div className="source-table-scroll" tabIndex={0} aria-label="Scrollable repository directory"><table className="source-file-table" aria-label="Repository files"><thead><tr><th scope="col">Name</th><th scope="col">Contents</th><th scope="col">Added</th></tr></thead><tbody>{repoDirectory && <tr><td colSpan={3}><button type="button" className="source-file-link" onClick={() => navigateDirectory(repoDirectory.split('/').slice(0, -1).join('/'))}><ArrowLeft size={16} aria-hidden="true" /><span>..</span><span className="visually-hidden"> Parent directory</span></button></td></tr>}{repositoryNodes.length ? repositoryNodes.map(renderTableRow) : <tr><td colSpan={3}>This directory is empty.</td></tr>}</tbody></table></div></div>}</>}
      <details className="source-disclosure"><summary>Source details</summary><dl className="source-metadata"><div><dt>Location</dt><dd>{group.location || group.rootPath || 'Repository location unavailable'}</dd></div></dl><button type="button" className="btn-secondary source-remove" onClick={() => setDeleteTarget({ kind: 'repository', group })}><Trash2 size={15} aria-hidden="true" /> Remove repository</button></details>
    </div>;
  };

  const renderDocumentDetail = (artifact: Artifact) => (
    <div className="source-detail-view source-document-detail">
      <button type="button" className="btn-back source-back" onClick={goBackToSources}><ArrowLeft size={16} aria-hidden="true" /> Back to sources</button>
      <header className="source-detail-header">
        <div><h3 ref={detailHeadingRef} tabIndex={-1}>{artifact.fileName}</h3><p>{SOURCE_LABELS[artifact.source]} · {CATEGORY_LABELS[artifact.type]}</p></div>
        <div className="source-detail-actions">
          {validLocation(artifact) && <button type="button" className="btn-secondary" onClick={() => void handleOpenWith(artifact)}><ExternalLink size={15} aria-hidden="true" /> Open original</button>}
        </div>
      </header>
      <section className="source-preview-panel source-document-preview source-file-reader" tabIndex={0} aria-labelledby="source-preview-heading">
        <div className="visually-hidden"><h4 id="source-preview-heading">Preview</h4></div>
        {renderPreview()}
      </section>
      <details className="source-disclosure"><summary>Source details</summary><dl className="source-metadata"><div><dt>Category</dt><dd>{CATEGORY_LABELS[artifact.type]}</dd></div><div><dt>Location</dt><dd>{displayLocation(artifact)}</dd></div><div><dt>Added</dt><dd>{new Date(artifact.createdAt).toLocaleString()}</dd></div></dl><button type="button" className="btn-secondary source-remove" onClick={() => setDeleteTarget({ kind: 'artifact', artifact })}><Trash2 size={15} aria-hidden="true" /> Remove source</button></details>
    </div>
  );

  if (loading) return <div className="panel-loading" role="status">Loading sources...</div>;

  return (
    <div className="artifacts-panel source-workspace">
      <input ref={fileInputRef} className="visually-hidden" tabIndex={-1} type="file" multiple onChange={event => { void handleFileInput(event); }} aria-label="Select source files" />
      {hasMaterials && <SourceIndexStatus key={projectId} projectId={projectId} sourceVersionKey={artifacts.map(artifact => `${artifact.id}:${artifact.versionId ?? artifact.contentHash}`).sort().join('|')} />}
      {sourceView ? <>{error && !showImportDialog && <p className="form-error" role="alert">{error}</p>}{sourceView.kind === 'document' ? renderDocumentDetail(sourceView.artifact) : renderRepositoryDetail(currentRepository ?? sourceView.group)}</> : <>
      <div className="panel-header source-directory-header">
        <div><h3>Sources</h3><p className="panel-description">Materials available for this project's reviews.</p></div>
        <button type="button" className="btn-primary" onClick={() => setShowImportDialog(true)} disabled={uploading || importing}><Plus size={17} aria-hidden="true" /> Add source</button>
      </div>
      {error && !showImportDialog && <div className="source-preview-feedback"><p className="form-error" role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => void loadArtifacts()}>Retry loading sources</button></div>}

      {sourceStatusStale && <p role="status">Source status could not be refreshed. Showing the last saved progress; checking again shortly.</p>}

      {hasMaterials && <div className="source-explorer-toolbar"><div className="source-category-controls" role="group" aria-label="Source categories">{([{ value: 'all', label: 'All sources' }, { value: 'repositories', label: 'Repositories' }, { value: 'documents', label: 'Documents' }, { value: 'images', label: 'Images' }] as const).map(category => <button type="button" key={category.value} aria-pressed={sourceCategory === category.value} onClick={() => { setSourceCategory(category.value); setSourcePage(1); }}>{category.label}</button>)}</div><div className="source-list-search"><label className="visually-hidden" htmlFor="project-source-search">Find a source</label><div className="source-search"><Search size={16} aria-hidden="true" /><input id="project-source-search" type="search" value={sourceQuery} onChange={event => { setSourceQuery(event.target.value); setSourcePage(1); }} placeholder="Search sources" /></div></div></div>}
      {hasMaterials ? visibleSourceRows.length > 0 ? <><div className="source-table-shell source-explorer-table"><div className="source-table-scroll" tabIndex={0} aria-label="Scrollable project sources"><table className="source-file-table" aria-label="Project sources"><thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Added</th></tr></thead><tbody>{visibleSourceRows.slice((currentSourcePage - 1) * 20, currentSourcePage * 20)}</tbody></table></div></div><div className="source-pagination"><span>{visibleSourceRows.length} sources · Page {currentSourcePage} of {sourcePageCount}</span>{sourcePageCount > 1 && <div><button type="button" className="btn-secondary" disabled={currentSourcePage === 1} onClick={() => setSourcePage(currentSourcePage - 1)}>Previous</button><button type="button" className="btn-secondary" disabled={currentSourcePage === sourcePageCount} onClick={() => setSourcePage(currentSourcePage + 1)}>Next</button></div>}</div></> : <div className="source-empty-result"><p role="status">No sources match your search.</p><button type="button" className="btn-secondary" onClick={() => { setSourceQuery(''); setSourceCategory('all'); setSourcePage(1); }}>Clear search</button></div> : filesLoaded && (connectedSources.length ? <p className="source-preview-empty">No files have been imported yet. Check Source updates below.</p> : <div className="source-empty"><h4>Add your project materials</h4><p>Upload documents or import code to use in a Review.</p>{renderDropzone('source-dropzone', 'Add source files')}</div>)}
      {uploadProgress && <p role="status">Uploading {uploadProgress.current} of {uploadProgress.total} files…</p>}
      {connectedSources.length > 0 && <details className="source-disclosure source-updates" open={updatesOpen} onToggle={event => setUpdatesOpen(event.currentTarget.open)}><summary>Source updates <span>{connectedSources.length} connected {connectedSources.length === 1 ? 'source' : 'sources'}{needsSourceAttention ? ' · Needs attention' : activeSourceKey ? ' · In progress' : ''}</span></summary><p className="source-section-note">Check for updates from connected apps. Imported files appear in the list above.</p><ul className="source-updates-list" aria-label="Connected source updates">{connectedSources.map(renderConnectedSourceRow)}</ul></details>}

      </>}

      {showImportDialog && (
        <Modal isOpen={showImportDialog} onClose={() => { if (uploading || importing || connectorLoading) return; closeConnector(); setShowImportDialog(false); }} title={connectorProvider ? `Import from ${CONNECTOR_LABELS[connectorProvider]}` : 'Add source'} width={640}>
          <div className="import-dialog-body">
            {error && <p className="form-error" role="alert">{error}</p>}
            {connectorError && !connectorProvider && <p className="form-error" role="alert">{connectorError}</p>}
            {!connectorProvider ? <>
              <section aria-labelledby="source-computer-heading"><h4 id="source-computer-heading">This computer</h4><div className="source-import-options">
                <button type="button" className="source-import-option" onClick={() => { if ('__TAURI_IPC__' in window) void handleUpload(); else openFilePicker(); }} disabled={uploading || importing || connectorLoading}><Upload size={20} aria-hidden="true" /><span><strong>Upload files</strong><small>{uploading ? `Uploading ${uploadProgress?.current ?? 0} of ${uploadProgress?.total ?? 0}…` : 'Documents, code, PDFs and images'}</small></span></button>
                <button type="button" className="source-import-option" onClick={() => void handleRepository()} disabled={uploading || importing || connectorLoading}><Folder size={20} aria-hidden="true" /><span><strong>Import local folder</strong><small>{importing ? 'Importing…' : 'Choose a repository on this computer'}</small></span></button>
              </div><div className="source-compact-drop">{renderDropzone('source-dropzone', 'Drop source files to upload')}</div></section>
              <section aria-labelledby="source-apps-heading"><h4 id="source-apps-heading">Connected apps</h4><div className="source-import-options source-app-options">
                <button type="button" className="source-import-option" onClick={() => void openConnector('github')} disabled={uploading || importing || connectorLoading}><GitBranch size={20} aria-hidden="true" /><span><strong>GitHub</strong><small>Repository and branch</small></span></button>
                <button type="button" className="source-import-option" onClick={() => void openConnector('google_drive')} disabled={uploading || importing || connectorLoading}><Cloud size={20} aria-hidden="true" /><span><strong>Google Drive</strong><small>Files and folders</small></span></button>
                <button type="button" className="source-import-option" onClick={() => void openConnector('slack')} disabled={uploading || importing || connectorLoading}><MessageSquare size={20} aria-hidden="true" /><span><strong>Slack</strong><small>Channel messages</small></span></button>
              </div><p className="source-section-note">Manage app connections in Settings. If an app is disconnected, selecting it opens Settings.</p>{connectorLoading && <p role="status">Opening connection…</p>}</section>
            </> : <div className="connected-source-browser">
              <div className="connected-source-browser-header">
                <button type="button" className="btn-back" disabled={connectorLoading} onClick={() => connectorParent ? void browseConnector(connectorProvider).then(() => { setConnectorParent(null); setConnectorSelection(null); }) : closeConnector()}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
                <div><strong>{connectorStatus?.accountLabel || CONNECTOR_LABELS[connectorProvider]}</strong><StatusBadge label="Connected" tone="neutral" /></div>
              </div>
              <label className="source-search-label" htmlFor="connected-source-search">Search {CONNECTOR_LABELS[connectorProvider]}</label><div className="source-search"><Search size={15} aria-hidden="true" /><input id="connected-source-search" type="search" value={connectorQuery} onChange={event => setConnectorQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void browseConnector(connectorProvider, { remoteId: connectorParent?.id, query: connectorQuery }); }} placeholder="Search by name" /></div>
              {connectorParent && <p className="import-dialog-note">Selected location: <strong>{connectorParent.name}</strong>{connectorProvider === 'github' ? ' — choose a branch.' : ' — choose this folder or one item below.'}</p>}
              {connectorError && <p className="form-error" role="alert">{connectorError}</p>}
              {connectorLoading && <p className="panel-loading" role="status">Loading {CONNECTOR_LABELS[connectorProvider]}…</p>}
              {!connectorLoading && <ul className="connected-source-browser-list" aria-label={`${CONNECTOR_LABELS[connectorProvider]} sources`}>
                {connectorItems.length === 0 && <li className="source-preview-empty">No accessible sources matched this view.</li>}
                {connectorItems.map(item => <li key={`${item.kind}:${item.id}`}><button type="button" aria-label={`${item.name}, ${item.kind}${item.revision ? `, ${item.revision}` : ''}`} className={`connected-source-browser-row${connectorSelection?.id === item.id ? ' is-selected' : ''}`} aria-pressed={connectorSelection?.id === item.id} onClick={() => void selectConnectorEntry(item)}><span><strong>{item.name}</strong><small>{item.kind.replace(/_/g, ' ')}{item.revision ? ` · ${item.revision}` : ''}</small></span><ChevronRight size={16} aria-hidden="true" /></button></li>)}
              </ul>}
              {connectorCursor && <button type="button" className="btn-secondary" onClick={() => void browseConnector(connectorProvider, { remoteId: connectorParent?.id, cursor: connectorCursor, query: connectorQuery }, true)} disabled={connectorLoading}>Load more</button>}
              <div className="connected-source-browser-actions">
                <button type="button" className="btn-secondary" disabled={connectorLoading} onClick={() => { closeConnector(); setShowImportDialog(false); }}>Cancel</button>
                <button type="button" className="btn-primary" onClick={() => void importConnectorSelection()} disabled={!connectorSelection || connectorLoading || (connectorProvider === 'github' && connectorSelection.kind !== 'branch')}>{connectorLoading ? 'Importing…' : 'Import and sync'}</button>
              </div>
            </div>}
          </div>
        </Modal>
      )}

      {historySource && <Modal isOpen={Boolean(historySource)} onClose={() => setHistorySource(null)} title={`${historySource.name} sync history`} width={680}>
        <div className="connected-source-history">
          {historyLoading ? <p role="status">Loading sync history…</p> : historyError ? <div className="source-preview-feedback"><p className="form-error" role="alert">{historyError}</p><button type="button" className="btn-secondary" onClick={() => void openSyncHistory(historySource)}>Retry history</button></div> : syncHistory.length === 0 ? <p>No synchronization runs have been recorded.</p> : <ol>{syncHistory.map(run => <li key={run.id}><div><StatusBadge label={run.status === 'partial' ? 'Needs attention' : run.status} /><span>{new Date(run.createdAt).toLocaleString()}</span></div><p>{run.importedCount} imported · {run.updatedCount} updated · {run.unchangedCount} unchanged · {run.removedCount} removed</p>{run.errorMessage && <p className="form-error" role="alert">{run.errorMessage}</p>}</li>)}</ol>}
          <div className="connected-source-browser-actions"><button type="button" className="btn-primary" onClick={() => setHistorySource(null)}>Done</button></div>
        </div>
      </Modal>}

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
