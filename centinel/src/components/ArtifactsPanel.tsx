import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { api } from '../api/client';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import type { Artifact, ArtifactSource } from '../types';
import { ChevronRight, Cloud, File, Folder, GitBranch, MessageSquare, Plus, RotateCw, X, Upload } from 'lucide-react';

const SUPPORTED_EXTENSIONS = new Set([
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cs', 'json', 'yaml', 'yml',
  'html', 'css', 'go', 'rb', 'php', 'rs', 'cpp', 'c', 'h',
]);

function extensionOf(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

async function fileToBase64(file: File): Promise<string> {
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
  drive: 'Drive',
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
  | { kind: 'document'; artifact: Artifact }
  | { kind: 'repository'; group: RepoGroup };

export function ArtifactsPanel({ projectId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build a tree structure from flat artifact list
  const buildTree = (artifacts: Artifact[], rootPath: string): TreeNode[] => {
    const root: TreeNode[] = [];
    // Normalize path separators for comparison
    const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const normRoot = normalize(rootPath);

    for (const a of artifacts) {
      // Get relative path from repo root
      const fullPath = a.originalPath || a.fileName;
      const normFull = normalize(fullPath);
      // Strip root path prefix (case-insensitive)
      let relPath = normFull.startsWith(normRoot)
        ? fullPath.substring(rootPath.length)
        : fullPath;
      relPath = relPath.replace(/^[/\\]/, '');
      const parts = relPath.split(/[/\\]/).filter(Boolean);

      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        let existing = current.find(n => n.name === dirName && n.isDir);
        if (!existing) {
          existing = { name: dirName, isDir: true, children: [] };
          current.push(existing);
        }
        current = existing.children!;
      }
      current.push({ name: parts[parts.length - 1], isDir: false, artifact: a });
    }

    // Sort: dirs first, then files, both alphabetical
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach(n => { if (n.children) sortTree(n.children); });
    };
    sortTree(root);
    return root;
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const loadArtifacts = useCallback(async () => {
    try {
      const data = await api.listArtifacts(projectId);
      setArtifacts(data);
      setError(null);
    } catch (cause) {
      setArtifacts([]);
      setError(`Sources could not be loaded: ${String(cause)}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  // Find common ancestor path for a set of file paths
  const findCommonRoot = (paths: string[]): string => {
    if (paths.length === 0) return '';
    if (paths.length === 1) {
      // Single file: use its parent dir
      return paths[0].split(/[/\\]/).slice(0, -1).join('/');
    }
    // Split all paths into segments
    const split = paths.map(p => p.split(/[/\\]/));
    const minLen = Math.min(...split.map(s => s.length));
    const common: string[] = [];
    for (let i = 0; i < minLen; i++) {
      const seg = split[0][i];
      if (split.every(s => s[i] === seg)) {
        common.push(seg);
      } else {
        break;
      }
    }
    return common.join('/');
  };

  // Group artifacts: documents as individual items, repos as grouped
  const { docArtifacts, repoGroups } = useMemo(() => {
    const docs: Artifact[] = [];
    const repoArtifacts: Artifact[] = [];

    for (const a of artifacts) {
      const isRepo = a.source === 'repository' || (a.originalPath && a.originalPath.length > 0);
      if (isRepo) {
        repoArtifacts.push(a);
      } else {
        docs.push(a);
      }
    }

    // Group repo artifacts by common root path
    const rootMap = new Map<string, Artifact[]>();
    for (const a of repoArtifacts) {
      // Find the root by checking which existing group this belongs to
      let matched = false;
      for (const [root, group] of rootMap) {
        const allPaths = [...group.map(g => g.originalPath || ''), a.originalPath || ''];
        const common = findCommonRoot(allPaths);
        // If common root is at least as deep as the existing root, it belongs here
        if (common.length >= root.length && common.startsWith(root.split(/[/\\]/).slice(0, -1).join('/'))) {
          rootMap.delete(root);
          rootMap.set(common, [...group, a]);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Start a new group with this artifact's parent dir as initial root
        const parentDir = a.originalPath
          ? a.originalPath.split(/[/\\]/).slice(0, -1).join('/')
          : a.fileName;
        rootMap.set(parentDir, [a]);
      }
    }

    const groups: RepoGroup[] = Array.from(rootMap.entries()).map(([rootPath, arts]) => {
      const repoName = rootPath.split(/[/\\]/).pop() || 'Imported repository';
      return {
        repoName,
        repoPath: rootPath,
        rootPath,
        artifacts: arts,
      };
    });

    return { docArtifacts: docs, repoGroups: groups };
  }, [artifacts]);

  const toggleRepo = (repoName: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      if (next.has(repoName)) next.delete(repoName);
      else next.add(repoName);
      return next;
    });
  };

  const finishUpload = async () => {
    await loadArtifacts();
    setShowImportDialog(false);
  };

  const uploadBrowserFiles = async (files: File[]) => {
    const supported = files.filter(file => SUPPORTED_EXTENSIONS.has(extensionOf(file.name)));
    const unsupported = files.filter(file => !SUPPORTED_EXTENSIONS.has(extensionOf(file.name)));
    if (unsupported.length > 0) {
      setError(`Unsupported source${unsupported.length === 1 ? '' : 's'} skipped: ${unsupported.map(file => file.name).join(', ')}`);
    } else {
      setError(null);
    }
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
      setError(`Upload failed: ${String(cause)}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // Upload: open the native file picker, select multiple files.
  const handleUpload = async () => {
    try {
      const selected = await open({
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
        for (let offset = 0; offset < fileData.length; offset += chunkSize) {
          binary += String.fromCharCode(...fileData.slice(offset, offset + chunkSize));
        }
        await api.uploadArtifact(projectId, { fileName, content: btoa(binary) });
        setUploadProgress({ current: index + 1, total: paths.length });
      }
      await finishUpload();
    } catch (cause) {
      setError(`Upload failed: ${String(cause)}`);
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

  // Repository: open folder picker, import all files
  const handleRepository = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select a repository folder',
    });
    if (!selected) return;

    setImporting(true);
    setError(null);

    try {
      await api.importRepoArtifacts(projectId, selected as string);
      await loadArtifacts();
      setShowImportDialog(false);

      // Poll indexing status in background
      setIndexing(true);
      let attempts = 0;
      const maxAttempts = 60; // 60 seconds max
      const poll = async () => {
        try {
          const status = await api.getIndexStatus(projectId);
          if (status.status === 'done' || status.status === 'error' || attempts >= maxAttempts) {
            setIndexing(false);
            if (status.status === 'error') {
              setError(`Indexing failed: ${status.error}`);
            }
            return;
          }
          attempts++;
          setTimeout(poll, 1000);
        } catch {
          setIndexing(false);
        }
      };
      // Start polling after a short delay
      setTimeout(poll, 500);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'document') {
        await api.deleteArtifact(projectId, deleteTarget.artifact.id);
        setArtifacts(prev => prev.filter(a => a.id !== deleteTarget.artifact.id));
      } else {
        for (const artifact of deleteTarget.group.artifacts) {
          await api.deleteArtifact(projectId, artifact.id);
        }
        setExpandedRepos(prev => {
          const next = new Set(prev);
          next.delete(deleteTarget.group.repoName);
          return next;
        });
        setArtifacts(prev => prev.filter(a => !deleteTarget.group.artifacts.some(item => item.id === a.id)));
      }
      setDeleteTarget(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="panel-loading">Loading sources...</div>;

  return (
    <div className="artifacts-panel">
      <div className="panel-header">
        <h3>Sources</h3>
        <div className="panel-actions">
          <button type="button" className="command-icon-button" onClick={() => setShowImportDialog(true)} aria-label="Add source" title="Add source">
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <input ref={fileInputRef} className="visually-hidden" type="file" multiple onChange={event => { void handleFileInput(event); }} aria-label="Select source files" />

      {artifacts.length === 0 ? (
        <div
          className={`artifacts-empty artifacts-empty-dropzone${dragActive ? ' is-dragging' : ''}`}
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={handleDropzoneKeyDown}
          onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
          onDragOver={event => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={event => { if (event.currentTarget === event.target) setDragActive(false); }}
          onDrop={event => { void handleDrop(event); }}
          aria-label="Add source files"
        >
          <Upload size={28} aria-hidden="true" />
          <strong>{uploadProgress ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…` : 'Drop source files here'}</strong>
          <p>or press Enter to choose supported files from your computer.</p>
          <small>Supported: text, Markdown, code, JSON, YAML, and HTML files.</small>
        </div>
      ) : (
        <div className="artifact-list">
          {/* Document items (individual) */}
          {docArtifacts.map(a => (
            <div key={a.id} className="artifact-row">
              <div className="artifact-info">
                <span className={`badge ${SOURCE_COLORS[a.source]}`}>{SOURCE_LABELS[a.source]}</span>
                <span className="artifact-name">{a.fileName}</span>
              </div>
              <div className="artifact-meta">
                <button className="btn-delete-icon" onClick={() => setDeleteTarget({ kind: 'document', artifact: a })} title="Remove" aria-label={`Remove ${a.fileName}`}>×</button>
              </div>
            </div>
          ))}

          {/* Repository groups (expandable) */}
          {repoGroups.map(group => {
            const isExpanded = expandedRepos.has(group.repoName);
            return (
              <div key={group.repoName} className="artifact-repo-group">
                <div className="artifact-row artifact-repo-header">
                  <button
                    type="button"
                    className="artifact-repo-toggle"
                    onClick={() => toggleRepo(group.repoName)}
                    aria-expanded={isExpanded}
                  >
                    <span className="artifact-info">
                    <span className="badge badge-repository">Repository</span>
                    <span className="artifact-name">{group.repoName}</span>
                    <span className="artifact-file-count">{group.artifacts.length} files</span>
                    {indexing && <RotateCw className="indexing-spinner" size={13} aria-label="Indexing repository" />}
                    <ChevronRight className={`artifact-expand-icon ${isExpanded ? 'expanded' : ''}`} size={14} />
                    </span>
                  </button>
                  <div className="artifact-meta">
                    <button className="btn-delete-icon" onClick={() => setDeleteTarget({ kind: 'repository', group })} title="Remove repository" aria-label={`Remove ${group.repoName} repository`}><X size={13} /></button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="artifact-repo-files">
                    {(() => {
                      const tree = buildTree(group.artifacts, group.rootPath);
                      const renderNode = (node: TreeNode, depth: number, parentPath: string) => {
                        const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
                        if (node.isDir) {
                          const isFolderOpen = expandedFolders.has(nodePath);
                          return (
                            <div key={nodePath}>
                              <button type="button" className="artifact-repo-folder" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => toggleFolder(nodePath)} aria-expanded={isFolderOpen}>
                                <ChevronRight className={`artifact-expand-icon ${isFolderOpen ? 'expanded' : ''}`} size={12} />
                                <Folder size={14} />
                                <span className="artifact-file-name">{node.name}</span>
                                <span className="artifact-file-count">{node.children?.length}</span>
                              </button>
                              {isFolderOpen && node.children?.map(child => renderNode(child, depth + 1, nodePath))}
                            </div>
                          );
                        }
                        return (
                          <div key={nodePath} className="artifact-repo-file-row" style={{ paddingLeft: 12 + depth * 16 }}>
                            <File className="artifact-file-icon" size={14} />
                            <span className="artifact-file-name">{node.name}</span>
                            <span className={`badge badge-${node.artifact!.type.replace('_', '-')}`}>{node.artifact!.type.replace(/_/g, ' ')}</span>
                          </div>
                        );
                      };
                      return tree.map(node => renderNode(node, 0, ''));
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Import Sources Dialog */}
      {showImportDialog && (
        <Modal isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} title="Add sources" width={780}>
          <div className="import-dialog-body">
              <div
                className={`import-dropzone${dragActive ? ' is-dragging' : ''}`}
                role="button"
                tabIndex={0}
                onClick={openFilePicker}
                onKeyDown={handleDropzoneKeyDown}
                onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
                onDragOver={event => { event.preventDefault(); setDragActive(true); }}
                onDragLeave={event => { if (event.currentTarget === event.target) setDragActive(false); }}
                onDrop={event => { void handleDrop(event); }}
                aria-label="Drop source files to upload"
              >
                <div className="import-dropzone-content">
                  <Upload size={32} aria-hidden="true" />
                  <strong>{uploadProgress ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…` : 'Drop sources here'}</strong>
                  <p>Click to choose files or drag them into this area.</p>
                </div>
              </div>

              <div className="import-options">
                <button className="import-option" onClick={handleUpload} disabled={uploading}>
                  <Upload size={24} aria-hidden="true" />
                  <span>Upload</span>
                  <small>Available</small>
                </button>

                <button className="import-option" onClick={handleRepository} disabled={importing}>
                  <Folder size={24} aria-hidden="true" />
                  <span>Repository</span>
                  <small>Available</small>
                </button>

                <button className="import-option" type="button" disabled aria-describedby="connector-source-note">
                  <GitBranch size={24} aria-hidden="true" />
                  <span>GitHub</span>
                  <small>Unavailable</small>
                </button>

                <button className="import-option" type="button" disabled aria-describedby="connector-source-note">
                  <Cloud size={24} aria-hidden="true" />
                  <span>Google Drive</span>
                  <small>Unavailable</small>
                </button>

                <button className="import-option" type="button" disabled aria-describedby="connector-source-note">
                  <MessageSquare size={24} aria-hidden="true" />
                  <span>Slack</span>
                  <small>Unavailable</small>
                </button>

              </div>
              <p id="connector-source-note" className="import-dialog-note">Local upload and repository import are available now. GitHub, Google Drive, and Slack connectors are not connected in this build.</p>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={deleteTarget?.kind === 'repository' ? 'Remove repository?' : 'Remove source?'}
        description={deleteTarget?.kind === 'repository'
          ? `Remove ${deleteTarget.group.repoName} and its ${deleteTarget.group.artifacts.length} indexed files from this project?`
          : `Remove ${deleteTarget?.artifact.fileName ?? 'this source'} from this project?`}
        confirmLabel={deleteTarget?.kind === 'repository' ? 'Remove repository' : 'Remove source'}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
      />
    </div>
  );
}
