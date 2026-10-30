import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sourceCurrencyState } from '../sourceCurrency';
import { open as pickPath } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { open as openLocation } from '@tauri-apps/api/shell';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
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
  'html', 'css', 'go', 'rb', 'php', 'rs', 'cpp', 'c', 'h', 'xml', 'toml', 'ini', 'sol', 'mjs', 'cjs',
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
  sourceId?: string | null;
  provider?: IntegrationProvider | null;
  kindLabel?: string;
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
  | { kind: 'repository'; group: RepoGroup }
  | { kind: 'connected'; source: ConnectedSource };

type RepositoryNavigationMemory = {
  directory: string;
  search: string;
  selectedArtifactId: string | null;
};

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

function relativeUpdatedAt(value: string | null | undefined): { label: string; dateTime: string } | null {
  const timestamp = Date.parse(value ?? '');
  if (!Number.isFinite(timestamp)) return null;

  const elapsed = timestamp - Date.now();
  if (Math.abs(elapsed) < 60_000) return { label: 'Updated just now', dateTime: new Date(timestamp).toISOString() };
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; duration: number }> = [
    { unit: 'year', duration: 365 * 24 * 60 * 60 * 1000 },
    { unit: 'month', duration: 30 * 24 * 60 * 60 * 1000 },
    { unit: 'week', duration: 7 * 24 * 60 * 60 * 1000 },
    { unit: 'day', duration: 24 * 60 * 60 * 1000 },
    { unit: 'hour', duration: 60 * 60 * 1000 },
    { unit: 'minute', duration: 60 * 1000 },
  ];
  const { unit, duration } = units.find(candidate => Math.abs(elapsed) >= candidate.duration) ?? units[units.length - 1];
  const amount = Math.round(elapsed / duration);
  return {
    label: `Updated ${new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(amount, unit)}`,
    dateTime: new Date(timestamp).toISOString(),
  };
}

function artifactUpdatedAt(artifact: Artifact): string | null {
  const value = (artifact as Artifact & { updatedAt?: string | null }).updatedAt;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
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
  const [repoDirectory, setRepoDirectory] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepoArtifact, setSelectedRepoArtifact] = useState<Artifact | null>(null);
  const [selectedArtifactNotice, setSelectedArtifactNotice] = useState<string | null>(null);
  const [currencyBusy, setCurrencyBusy] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
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
  const sourceContentRef = useRef<HTMLElement>(null);
  const previewRequestRef = useRef(0);
  const scrollMemoryRef = useRef(new Map<string, { content: number; reader: number; left: number }>());
  useEffect(() => () => { previewRequestRef.current += 1; }, []);
  const repositoryNavigationRef = useRef(new Map<string, RepositoryNavigationMemory>());
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
    const byConnectedSource = new Map<string, Artifact[]>();
    artifacts.forEach(artifact => {
      if (artifact.sourceId && connectedSources.some(source => source.id === artifact.sourceId && source.projectId === projectId)) {
        const files = byConnectedSource.get(artifact.sourceId) ?? [];
        files.push(artifact);
        byConnectedSource.set(artifact.sourceId, files);
      } else if (artifact.source === 'repository') {
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
    const groups: RepoGroup[] = connectedSources.map(source => ({
      repoName: source.name.trim() || `${CONNECTOR_LABELS[source.provider]} source`,
      repoPath: `connected:${source.id}`, rootPath: '', location: source.remoteUrl, sourceId: source.id,
      provider: source.provider, kindLabel: CONNECTOR_LABELS[source.provider], artifacts: byConnectedSource.get(source.id) ?? [],
    }));
    groups.push(...[...bySource].map(([sourceId, files]) => {
      const rootPath = commonRepositoryRoot(files);
      const parts = pathParts(rootPath);
      return { repoName: parts[parts.length - 1] || 'Imported repository', repoPath: `local:${sourceId ?? rootPath}`, rootPath, sourceId, provider: null, kindLabel: 'Local repository', artifacts: files };
    }));
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
    const request = ++previewRequestRef.current;
    const kind = artifactKind(artifact.fileName) ?? (['repository', 'directory'].includes(artifact.source)
      && ['source_code', 'other'].includes(artifact.type) ? 'text' : null);
    setPreview({ artifact, kind, content: null, error: null, loading: Boolean(kind) });
    if (!kind) return;
    try {
      const stored = await api.getArtifactContent(artifact.projectId, artifact.id, artifact.versionId);
      if (previewRequestRef.current !== request) return;
      if (artifact.versionId && stored.versionId !== artifact.versionId) throw new Error('The saved source version could not be verified. Refresh sources and try again.');
      const bytes = kind === 'text' ? Uint8Array.from(atob(stored.content), character => character.charCodeAt(0)) : null;
      const content = kind === 'text' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes!) : `data:${mimeType(artifact.fileName)};base64,${stored.content}`;
      if (kind === 'text' && /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(content)) throw new Error('This file is not readable UTF-8 text.');
      setPreview(current => current?.artifact.id === artifact.id ? { ...current, content, loading: false } : current);
    } catch (cause) {
      if (previewRequestRef.current !== request) return;
      setPreview(current => current?.artifact.id === artifact.id
        ? { ...current, error: `This file could not be previewed. ${userFacingError(cause, 'Try again.')}`, loading: false }
        : current);
    }
  }, []);

  const rememberTrigger = (event: React.MouseEvent<HTMLButtonElement>) => {
    lastSourceTriggerRef.current = event.currentTarget.id;
  };

  const repositoryMemoryKey = (group: RepoGroup) => `${projectId}:${group.repoPath}`;
  const viewMemoryKey = () => sourceView?.kind === 'repository' ? repositoryMemoryKey(sourceView.group) : sourceView?.kind === 'document' ? `document:${sourceView.artifact.id}` : 'all';
  const activeViewMemoryRef = useRef(viewMemoryKey());
  activeViewMemoryRef.current = viewMemoryKey();
  const restoreScroll = (key: string, request = previewRequestRef.current) => window.requestAnimationFrame(() => {
    if (activeViewMemoryRef.current !== key || previewRequestRef.current !== request) return;
    const saved = scrollMemoryRef.current.get(key);
    if (sourceContentRef.current) sourceContentRef.current.scrollTop = saved?.content ?? 0;
    if (fileReaderRef.current) { fileReaderRef.current.scrollTop = saved?.reader ?? 0; fileReaderRef.current.scrollLeft = saved?.left ?? 0; }
  });
  const openPreviewAndRestore = (artifact: Artifact, key: string) => {
    const pending = openPreview(artifact);
    const request = previewRequestRef.current;
    void pending.then(() => restoreScroll(key, request));
  };
  const saveActiveRepositoryNavigation = () => {
    scrollMemoryRef.current.set(viewMemoryKey(), { content: sourceContentRef.current?.scrollTop ?? 0, reader: fileReaderRef.current?.scrollTop ?? 0, left: fileReaderRef.current?.scrollLeft ?? 0 });
    if (sourceView?.kind !== 'repository') return;
    repositoryNavigationRef.current.set(repositoryMemoryKey(sourceView.group), {
      directory: repoDirectory,
      search: repoSearch,
      selectedArtifactId: selectedRepoArtifact?.id ?? null,
    });
  };

  const openDocument = (artifact: Artifact, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) rememberTrigger(event);
    saveActiveRepositoryNavigation();
    setSourceView({ kind: 'document', artifact });
    setSelectedArtifactNotice(null);
    setMarkdownMode('preview');
    openPreviewAndRestore(artifact, `document:${artifact.id}`);
  };

  const openRepository = (group: RepoGroup, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) rememberTrigger(event);
    saveActiveRepositoryNavigation();
    const memory = repositoryNavigationRef.current.get(repositoryMemoryKey(group));
    const selected = memory?.selectedArtifactId ? group.artifacts.find(artifact => artifact.id === memory.selectedArtifactId) ?? null : null;
    setSourceView({ kind: 'repository', group });
    setRepoDirectory(memory?.directory ?? '');
    setRepoSearch(memory?.search ?? '');
    setSelectedRepoArtifact(selected);
    setSelectedArtifactNotice(memory?.selectedArtifactId && !selected ? 'The previously selected file is no longer in this source. Choose another file.' : null);
    setPreview(null);
    setMarkdownMode('preview');
    if (selected) openPreviewAndRestore(selected, repositoryMemoryKey(group));
    else restoreScroll(repositoryMemoryKey(group));
  };

  const goBackToSources = () => {
    saveActiveRepositoryNavigation();
    setSourceView(null);
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
      await api.syncConnectedSource(projectId, source.id, { force: true, idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${source.id}` });
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

  const renderUpdated = (value: string | null | undefined) => {
    const updated = relativeUpdatedAt(value);
    return updated
      ? <time className="source-row-updated" dateTime={updated.dateTime} title={new Date(updated.dateTime).toLocaleString()}>{updated.label}</time>
      : <span className="source-row-updated is-unavailable">Updated time unavailable</span>;
  };

  const openConnectedSource = (source: ConnectedSource, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) rememberTrigger(event);
    const group = repoGroups.find(candidate => candidate.sourceId === source.id);
    if (group?.artifacts.length) openRepository(group);
    else {
      saveActiveRepositoryNavigation();
      setSourceView({ kind: 'connected', source });
      setSelectedArtifactNotice(null);
    }
  };

  const latestRepositoryUpdate = (group: RepoGroup) => group.artifacts
    .map(artifactUpdatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  const renderConnectedSourceActions = (source: ConnectedSource, view: ConnectedSourceRunView) => {
    const busy = syncingSourceId === source.id || view.active;
    const label = source.status === 'removed' ? 'Removed' : view.needsAttention ? 'Needs attention' : view.label;
    const checkedAt = source.lastSyncedAt && Number.isFinite(Date.parse(source.lastSyncedAt)) ? new Date(source.lastSyncedAt).toLocaleString() : 'Not available';
    const successfulAt = source.lastSuccessfulSyncAt && Number.isFinite(Date.parse(source.lastSuccessfulSyncAt)) ? new Date(source.lastSuccessfulSyncAt).toLocaleString() : 'Not available';
    return <>
      <StatusBadge label={busy ? 'Syncing' : label} tone={view.needsAttention ? 'danger' : view.active ? 'running' : label === 'Completed' ? 'success' : 'neutral'} />
      <details className="source-row-sync-details">
        <summary>Sync details</summary>
        <dl className="source-sync-times"><div><dt>Last checked</dt><dd>{checkedAt}</dd></div><div><dt>Last successful sync</dt><dd>{successfulAt}</dd></div></dl>
        {(source.lastError || source.latestSyncRun?.errorMessage) && <p className="connected-source-error">{source.lastError || source.latestSyncRun?.errorMessage}</p>}
        {view.reconnect && <p className="connected-source-error">Reconnect {CONNECTOR_LABELS[source.provider]} in Settings to update this source.</p>}
      </details>
      <div className="source-directory-actions" role="group" aria-label={`${source.name} sync actions`}>
        <button type="button" className="btn-secondary" aria-label={`History for ${source.name}`} onClick={() => void openSyncHistory(source)}>History</button>
        {view.reconnect ? <button type="button" className="btn-secondary" onClick={onOpenSettings} disabled={!onOpenSettings}>Reconnect</button> :
          <button type="button" className="btn-secondary" aria-label={`${busy ? 'Syncing' : 'Sync'} ${source.name}`} onClick={() => void syncConnectedSource(source)} disabled={busy || source.status !== 'active'}><RotateCw size={15} aria-hidden="true" /> {busy ? 'Syncing…' : view.needsAttention ? 'Retry sync' : 'Sync'}</button>}
      </div>
    </>;
  };

  const renderSourceRow = (artifact: Artifact) => (
    <li key={artifact.id} className="source-row">
      <div className="source-row-grid">
        <div className="source-row-main">
          <button id={`source-open-${artifact.id}`} type="button" className="source-name-link" aria-label={`View ${artifact.fileName}`} onClick={event => openDocument(artifact, event)}>{artifact.fileName}</button>
          <small className="source-row-kind">{SOURCE_LABELS[artifact.source]} · {artifactKind(artifact.fileName) === 'image' ? 'Image' : CATEGORY_LABELS[artifact.type]}{artifact.currency?.deprecated ? ' · Deprecated' : sourceCurrencyState(artifact).kind === 'due' ? ' · Currency check due' : ''}</small>
        </div>
        {renderUpdated(artifactUpdatedAt(artifact) ?? artifact.createdAt)}
      </div>
    </li>
  );

  const renderRepositoryRow = (group: RepoGroup) => {
    const source = group.sourceId ? connectedSources.find(candidate => candidate.id === group.sourceId) : undefined;
    const sourceViewState = source ? connectedSourceRunView(source) : null;
    const kindLabel = source ? `${CONNECTOR_LABELS[source.provider]} · ${group.artifacts.length} file${group.artifacts.length === 1 ? '' : 's'}`
      : `Local repository · ${group.artifacts.length} file${group.artifacts.length === 1 ? '' : 's'}`;
    return <li key={group.repoPath} className="source-row">
      <div className="source-row-grid">
        <div className="source-row-main">
          <button id={`source-open-repository-${encodeURIComponent(group.repoPath)}`} type="button" className="source-name-link" aria-label={`View ${group.repoName}`} onClick={event => source ? openConnectedSource(source, event) : openRepository(group, event)}>{group.repoName}</button>
          <small className="source-row-kind">{kindLabel}</small>
          {source && sourceViewState && <div className="source-row-connected-context">
            {renderConnectedSourceActions(source, sourceViewState)}
          </div>}
        </div>
        {renderUpdated(source?.lastSyncedAt ?? source?.updatedAt ?? latestRepositoryUpdate(group))}
      </div>
    </li>;
  };

  const renderConnectedSourceDetail = (source: ConnectedSource) => {
    const view = connectedSourceRunView(source);
    const label = source.status === 'removed' ? 'Removed' : view.needsAttention ? 'Needs attention' : view.label;
    return <div className="source-detail-view source-connected-detail">
      <nav className="source-path" aria-label="Source location"><button type="button" onClick={goBackToSources}>Sources</button><span><span aria-hidden="true">/</span><strong aria-current="page">{source.name}</strong></span></nav>
      <header className="source-detail-header"><div><h3 ref={detailHeadingRef} tabIndex={-1}>{source.name}</h3><p>{CONNECTOR_LABELS[source.provider]} connected source</p></div>
        <StatusBadge label={view.active ? 'Syncing' : label} tone={view.needsAttention ? 'danger' : view.active ? 'running' : label === 'Completed' ? 'success' : 'neutral'} />
      </header>

      {(source.lastError || source.latestSyncRun?.errorMessage) && <p className="connected-source-error" role="alert">{source.lastError || source.latestSyncRun?.errorMessage}</p>}
      {view.reconnect && <p className="connected-source-error">Reconnect {CONNECTOR_LABELS[source.provider]} in Settings before syncing this source.</p>}
      <dl className="source-metadata"><div><dt>Last checked</dt><dd>{source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : 'Not available'}</dd></div>
        <div><dt>Last successful sync</dt><dd>{source.lastSuccessfulSyncAt ? new Date(source.lastSuccessfulSyncAt).toLocaleString() : 'Not available'}</dd></div></dl>
      <div className="source-detail-actions">
        <button type="button" className="btn-secondary" onClick={() => void openSyncHistory(source)}>History</button>
        {view.reconnect ? <button type="button" className="btn-secondary" onClick={onOpenSettings} disabled={!onOpenSettings}>Reconnect</button> :
          <button type="button" className="btn-secondary" onClick={() => void syncConnectedSource(source)} disabled={syncingSourceId === source.id || view.active || source.status !== 'active'}><RotateCw size={15} aria-hidden="true" /> {syncingSourceId === source.id || view.active ? 'Syncing…' : view.needsAttention ? 'Retry sync' : 'Sync'}</button>}
      </div>
    </div>;
  };

  const currentRepository = sourceView?.kind === 'repository'
    ? repoGroups.find(group => group.repoPath === sourceView.group.repoPath) ?? sourceView.group : null;
  const repositoryTree = currentRepository ? buildTree(currentRepository.artifacts, currentRepository.rootPath) : [];
  const repositoryNodes = currentRepository ? getNodesAtPath(repositoryTree, repoDirectory) : [];
  const relativePath = (artifact: Artifact, root: string) => {
    const path = normalizePath(displayLocation(artifact));
    return root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? path.slice(root.length + 1) : path;
  };
  const selectFile = (artifact: Artifact, group = currentRepository) => {
    if (!group) return;
    saveActiveRepositoryNavigation();
    const parts = relativePath(artifact, group.rootPath).split('/').slice(0, -1);
    const directory = parts.join('/');
    setSourceView({ kind: 'repository', group });
    setRepoDirectory(directory);
    setRepoSearch('');
    if (!selectedRepoArtifact) window.requestAnimationFrame(() => document.getElementById('source-preview-heading')?.focus());
    setSelectedRepoArtifact(artifact);
    setSelectedArtifactNotice(null);
    setMarkdownMode('preview');
    repositoryNavigationRef.current.set(repositoryMemoryKey(group), { directory, search: '', selectedArtifactId: artifact.id });
    void openPreview(artifact);
  };
  const renderPreview = () => <PreviewPane preview={preview} markdownMode={markdownMode} onMarkdownModeChange={setMarkdownMode} onRetry={() => { if (preview) void openPreview(preview.artifact); }} />;
  const matchesSource = (text: string) => text.toLowerCase().includes(sourceQuery.trim().toLowerCase());
  const visibleDocuments = [...docArtifacts, ...driveArtifacts].filter(artifact => sourceCategory !== 'repositories' && (sourceCategory === 'all' || (sourceCategory === 'images' ? artifactKind(artifact.fileName) === 'image' : artifactKind(artifact.fileName) !== 'image')) && matchesSource(`${artifact.fileName} ${displayLocation(artifact)} ${SOURCE_LABELS[artifact.source]} ${CATEGORY_LABELS[artifact.type]}`));
  const visibleRepositories = repoGroups.filter(group => (sourceCategory === 'all' || sourceCategory === 'repositories')
    && (matchesSource(`${group.repoName} repository ${group.rootPath}`) || group.artifacts.some(artifact => matchesSource(displayLocation(artifact)))));
  const hasMaterials = artifacts.length > 0;
  const hasSources = hasMaterials || connectedSources.length > 0;
  const visibleSourceRows = [...visibleRepositories.map(renderRepositoryRow), ...visibleDocuments.map(renderSourceRow)];
  const sourcePageCount = Math.max(1, Math.ceil(visibleSourceRows.length / 20));
  const currentSourcePage = Math.min(sourcePage, sourcePageCount);

  useEffect(() => {
    if (sourceView?.kind !== 'repository' || !selectedRepoArtifact || !currentRepository) return;
    const refreshed = currentRepository.artifacts.find(artifact => artifact.id === selectedRepoArtifact.id);
    if (!refreshed) {
      setSelectedArtifactNotice(`${selectedRepoArtifact.fileName} is no longer in the current source list. Its last selected saved version remains visible.`);
      return;
    }
    if (refreshed.versionId !== selectedRepoArtifact.versionId || refreshed.contentHash !== selectedRepoArtifact.contentHash) {
      setSelectedRepoArtifact(refreshed);
      setSelectedArtifactNotice(`${refreshed.fileName} changed. The reader now shows its latest saved version.`);
      void openPreview(refreshed);
    } else if (refreshed !== selectedRepoArtifact) {
      setSelectedRepoArtifact(refreshed);
    }
  }, [currentRepository, openPreview, selectedRepoArtifact, sourceView?.kind]);

  useEffect(() => {
    if (sourceView?.kind !== 'document') return;
    const selected = sourceView.artifact;
    const current = artifacts.find(artifact => artifact.id === selected.id);
    if (!current) { setSelectedArtifactNotice(`${selected.fileName} is no longer in the current source list. The last selected saved version remains visible.`); return; }
    if (current.versionId !== selected.versionId || current.contentHash !== selected.contentHash) {
      setSourceView({ kind: 'document', artifact: current });
      setSelectedArtifactNotice(`${current.fileName} changed. The reader now shows its latest saved version.`);
      void openPreview(current);
    }
  }, [artifacts, sourceView, openPreview]);

  useEffect(() => {
    if (selectedRepoArtifact) document.getElementById(`source-directory-file-${selectedRepoArtifact.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedRepoArtifact?.id]);

  const renderRepositoryDetail = (group: RepoGroup) => {
    const filePath = selectedRepoArtifact ? relativePath(selectedRepoArtifact, group.rootPath) : '';
    const parts = (selectedRepoArtifact ? filePath.split('/').slice(0, -1).join('/') : repoDirectory).split('/').filter(Boolean);
    const results = repoSearch.trim() ? group.artifacts.filter(artifact => relativePath(artifact, group.rootPath).toLowerCase().includes(repoSearch.trim().toLowerCase())) : null;
    const navigateDirectory = (path: string) => {
      setRepoDirectory(path); setSelectedRepoArtifact(null); setSelectedArtifactNotice(null); setPreview(null); setRepoSearch('');
      repositoryNavigationRef.current.set(repositoryMemoryKey(group), { directory: path, search: '', selectedArtifactId: null });
    };
    const renderBreadcrumbs = () => <nav className="source-path" aria-label="Source location">
      <button type="button" onClick={goBackToSources}>Sources</button>
      <span><span aria-hidden="true">/</span><button type="button" onClick={() => navigateDirectory('')} aria-current={!parts.length && !selectedRepoArtifact ? 'page' : undefined}>{group.repoName}</button></span>
      {parts.map((part, index) => { const path = parts.slice(0, index + 1).join('/'); return <span key={path}><span aria-hidden="true">/</span><button type="button" aria-current={!selectedRepoArtifact && index === parts.length - 1 ? 'page' : undefined} onClick={() => navigateDirectory(path)}>{part}</button></span>; })}
      {selectedRepoArtifact && <span><span aria-hidden="true">/</span><strong aria-current="page">{selectedRepoArtifact.fileName}</strong></span>}
    </nav>;
    const renderFileSearch = () => <div className="source-go-to-file"><label className="visually-hidden" htmlFor="repository-file-search">Find a file</label><div className="source-search"><Search size={16} aria-hidden="true" /><input id="repository-file-search" type="search" value={repoSearch} onChange={event => setRepoSearch(event.target.value)} placeholder="Go to file" /></div></div>;
    const renderMatches = () => <><p className="source-search-result" role="status">{results?.length ? `${results.length} matching file${results.length === 1 ? '' : 's'}` : 'No files match your search.'}</p><button type="button" className="btn-back" onClick={() => { setRepoSearch(''); repositoryNavigationRef.current.set(repositoryMemoryKey(group), { directory: repoDirectory, search: '', selectedArtifactId: selectedRepoArtifact?.id ?? null }); }}>Clear file search</button><ul className="source-match-list" aria-label="Matching repository files">{results?.map(artifact => <li key={artifact.id}><button type="button" className="source-directory-entry" aria-pressed={selectedRepoArtifact?.id === artifact.id} onClick={() => selectFile(artifact, group)}><File size={16} aria-hidden="true" /><span className="source-directory-main"><strong>{artifact.fileName}</strong><small>{relativePath(artifact, group.rootPath)}</small></span></button></li>)}</ul></>;
    const renderDirectoryEntry = (node: TreeNode) => {
      let name = node.name;
      let directory = node;
      while (directory.isDir && directory.children?.length === 1 && directory.children[0].isDir) {
        directory = directory.children[0]; name += `/${directory.name}`;
      }
      const nodePath = repoDirectory ? `${repoDirectory}/${name}` : name;
      const itemCount = node.isDir ? countFiles(node) : 0;
      return <li key={nodePath}><button type="button" className="source-directory-entry" id={!node.isDir ? `source-directory-file-${node.artifact!.id}` : undefined}
        aria-label={node.isDir ? `${name} ${itemCount} file${itemCount === 1 ? '' : 's'}` : name}
        onClick={() => node.isDir ? navigateDirectory(nodePath) : selectFile(node.artifact!, group)}>
        {node.isDir ? <Folder size={18} aria-hidden="true" /> : <File size={18} aria-hidden="true" />}
        <span className="source-directory-main"><strong>{name}</strong><small>{node.isDir ? `${itemCount} file${itemCount === 1 ? '' : 's'}` : CATEGORY_LABELS[node.artifact!.type]}</small></span>
      </button></li>;
    };
    return <div className="source-detail-view source-repository-detail">
      {selectedRepoArtifact ? <>
        {renderBreadcrumbs()}
        {selectedArtifactNotice && <p role="status" className="source-file-change-notice">{selectedArtifactNotice}</p>}
        <section className="source-file-main source-selected-file" aria-label="File viewer"><div className="source-import-summary"><File size={16} aria-hidden="true" /><span>Saved source</span><time dateTime={selectedRepoArtifact.createdAt}>Added {new Date(selectedRepoArtifact.createdAt).toLocaleDateString()}</time></div><div ref={fileReaderRef} className="source-file-reader" tabIndex={0} aria-label="Scrollable file content"><h4 id="source-preview-heading" className="visually-hidden" tabIndex={-1}>{selectedRepoArtifact.fileName}</h4>{renderPreview()}</div></section>
      </> : <>
        <div className="source-repo-toolbar">{renderBreadcrumbs()}<div className="source-repo-actions">{renderFileSearch()}{!group.sourceId && <button type="button" className="btn-secondary" onClick={() => setShowImportDialog(true)}><Plus size={16} aria-hidden="true" /> Add file</button>}</div></div>
        {results ? <div className="source-search-table">{renderMatches()}</div> : <div className="source-table-shell">
          {repositoryNodes.length ? <ul className="source-directory" aria-label="Repository files">{repositoryNodes.map(renderDirectoryEntry)}</ul>
            : <p className="source-preview-empty">This directory is empty.</p>}
        </div>}
      </>}
      <details className="source-disclosure"><summary>Source details</summary><dl className="source-metadata"><div><dt>Location</dt><dd>{group.location || group.rootPath || 'Repository location unavailable'}</dd></div></dl>{!group.sourceId && <button type="button" className="btn-secondary source-remove" onClick={() => setDeleteTarget({ kind: 'repository', group })}><Trash2 size={15} aria-hidden="true" /> Remove repository</button>}</details>
    </div>;
  };

  const changeCurrency = async (artifact: Artifact, action: 'confirm' | 'deprecate' | 'restore') => {
    setCurrencyBusy(true); setCurrencyError(null);
    try {
      const currency = await api.setArtifactCurrency(projectId, artifact.id, action);
      setArtifacts(previous => previous.map(item => item.id === artifact.id ? { ...item, currency } : item));
    } catch (cause) {
      setCurrencyError(userFacingError(cause, 'The source currency could not be saved.'));
    } finally {
      setCurrencyBusy(false);
    }
  };

  // Currency confirmation is not version approval; a deprecated source leaves new Reviews.
  const renderCurrency = (artifact: Artifact) => {
    const state = sourceCurrencyState(artifact);
    return <div className={`source-currency is-${state.kind}`} role="group" aria-label="Source currency">
      <span className="source-currency-label">{state.label}</span>
      <span className="source-currency-actions">
        {state.kind !== 'deprecated' && <button type="button" className="btn-secondary" disabled={currencyBusy} onClick={() => void changeCurrency(artifact, 'confirm')}>Confirm still current</button>}
        {state.kind !== 'deprecated'
          ? <button type="button" className="btn-secondary" disabled={currencyBusy} onClick={() => void changeCurrency(artifact, 'deprecate')}>Mark deprecated</button>
          : <button type="button" className="btn-secondary" disabled={currencyBusy} onClick={() => void changeCurrency(artifact, 'restore')}>Restore to active</button>}
      </span>
      {currencyError && <p className="source-currency-error" role="alert">{currencyError}</p>}
    </div>;
  };

  const renderDocumentDetail = (artifact: Artifact) => (
    <div className="source-detail-view source-document-detail">
      <nav className="source-path" aria-label="Source location"><button type="button" onClick={goBackToSources}>Sources</button><span><span aria-hidden="true">/</span><strong aria-current="page">{artifact.fileName}</strong></span></nav>
      <header className="source-detail-header">
        <div><h3 ref={detailHeadingRef} tabIndex={-1}>{artifact.fileName}</h3><p>{SOURCE_LABELS[artifact.source]} · {CATEGORY_LABELS[artifact.type]}</p></div>
        <div className="source-detail-actions">
          {validLocation(artifact) && <button type="button" className="btn-secondary" onClick={() => void handleOpenWith(artifact)}><ExternalLink size={15} aria-hidden="true" /> Open original</button>}
        </div>
      </header>
      {renderCurrency(artifact)}
      {selectedArtifactNotice && <p role="status" className="source-file-change-notice">{selectedArtifactNotice}</p>}
      <section ref={fileReaderRef} className="source-preview-panel source-document-preview source-file-reader" tabIndex={0} aria-labelledby="source-preview-heading">
        <div className="visually-hidden"><h4 id="source-preview-heading">Preview</h4></div>
        {renderPreview()}
      </section>
      <details className="source-disclosure"><summary>Source details</summary><dl className="source-metadata"><div><dt>Category</dt><dd>{CATEGORY_LABELS[artifact.type]}</dd></div><div><dt>Location</dt><dd>{displayLocation(artifact)}</dd></div><div><dt>Added</dt><dd>{new Date(artifact.createdAt).toLocaleString()}</dd></div></dl><button type="button" className="btn-secondary source-remove" onClick={() => setDeleteTarget({ kind: 'artifact', artifact })}><Trash2 size={15} aria-hidden="true" /> Remove source</button></details>
    </div>
  );

  if (loading) return <div className="artifacts-panel source-workspace">
    <div className="panel-header source-directory-header"><div><h3>Sources</h3></div><button type="button" className="btn-primary" disabled><Plus size={17} aria-hidden="true" /> Add source</button></div>
    <section className="source-browser-layout source-loading-layout" aria-label="Project sources" aria-busy="true">
      <p className="visually-hidden" role="status">Loading project sources…</p>
      <ul className="source-skeleton-list" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <li key={index}><span /><i /><b /></li>)}</ul>
    </section>
  </div>;

  return (
    <div className="artifacts-panel source-workspace">
      <input ref={fileInputRef} className="visually-hidden" tabIndex={-1} type="file" multiple onChange={event => { void handleFileInput(event); }} aria-label="Select source files" />
      {hasMaterials && <SourceIndexStatus key={projectId} projectId={projectId} sourceVersionKey={artifacts.map(artifact => `${artifact.id}:${artifact.versionId ?? artifact.contentHash}`).sort().join('|')} />}
      <div className="panel-header source-directory-header">
        <div><h3>Sources</h3></div>
        <button type="button" className="btn-primary" onClick={() => setShowImportDialog(true)} disabled={uploading || importing}><Plus size={17} aria-hidden="true" /> Add source</button>
      </div>
      {error && !showImportDialog && <div className="source-preview-feedback"><p className="form-error" role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => void loadArtifacts()}>Retry loading sources</button></div>}
      {sourceStatusStale && <p role="status">Source status could not be refreshed. Showing the last saved progress; checking again shortly.</p>}
      {uploadProgress && <p role="status">Uploading {uploadProgress.current} of {uploadProgress.total} files…</p>}
      <div className="source-browser-layout">
        <main ref={sourceContentRef} className="source-content-area" aria-label="Source content">
          {sourceView?.kind === 'document' ? renderDocumentDetail(sourceView.artifact)
            : sourceView?.kind === 'repository' ? renderRepositoryDetail(currentRepository ?? sourceView.group)
              : sourceView?.kind === 'connected' ? renderConnectedSourceDetail(connectedSources.find(source => source.id === sourceView.source.id) ?? sourceView.source)
                : <>
                  <div className="source-content-heading"><div><h4>All sources</h4></div></div>
                  {hasSources && <div className="source-explorer-toolbar"><div className="source-category-controls" role="group" aria-label="Source categories">{([{ value: 'all', label: 'All sources' }, { value: 'repositories', label: 'Repositories' }, { value: 'documents', label: 'Documents' }, { value: 'images', label: 'Images' }] as const).map(category => <button type="button" key={category.value} aria-pressed={sourceCategory === category.value} onClick={() => { setSourceCategory(category.value); setSourcePage(1); }}>{category.label}</button>)}</div><div className="source-list-search"><label className="visually-hidden" htmlFor="project-source-search">Find a source</label><div className="source-search"><Search size={16} aria-hidden="true" /><input id="project-source-search" type="search" value={sourceQuery} onChange={event => { setSourceQuery(event.target.value); setSourcePage(1); }} placeholder="Search sources" /></div></div></div>}
                  {hasSources ? visibleSourceRows.length > 0 ? <><div className="source-table-shell source-explorer-table"><ul className="source-directory" aria-label="Project sources">{visibleSourceRows.slice((currentSourcePage - 1) * 20, currentSourcePage * 20)}</ul></div><div className="source-pagination"><span>{visibleSourceRows.length} sources · Page {currentSourcePage} of {sourcePageCount}</span>{sourcePageCount > 1 && <div><button type="button" className="btn-secondary" disabled={currentSourcePage === 1} onClick={() => setSourcePage(currentSourcePage - 1)}>Previous</button><button type="button" className="btn-secondary" disabled={currentSourcePage === sourcePageCount} onClick={() => setSourcePage(currentSourcePage + 1)}>Next</button></div>}</div></> : <div className="source-empty-result"><p role="status">No sources match your search.</p><button type="button" className="btn-secondary" onClick={() => { setSourceQuery(''); setSourceCategory('all'); setSourcePage(1); }}>Clear search</button></div> : filesLoaded && <div className="source-empty"><h4>Add your project materials</h4><p>Upload documents or import code to use in a Review.</p>{renderDropzone('source-dropzone', 'Add source files')}</div>}
                </>}
        </main>
      </div>

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
