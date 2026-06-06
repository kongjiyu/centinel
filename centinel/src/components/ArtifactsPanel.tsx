import { useState, useEffect, useCallback, useMemo } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { api } from '../api/client';
import type { Artifact, ArtifactSource } from '../types';

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

export function ArtifactsPanel({ projectId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

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
    } catch {
      // ignore
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
      const repoName = rootPath.split(/[/\\]/).pop() || rootPath;
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

  // Upload: open file explorer, select multiple files
  const handleUpload = async () => {
    const selected = await open({
      multiple: true,
      title: 'Select files to upload',
      filters: [{
        name: 'Supported Files',
        extensions: ['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cs', 'json', 'yaml', 'yml', 'html', 'css', 'go', 'rb', 'php', 'rs', 'cpp', 'c', 'h'],
      }],
    });
    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    setUploading(true);
    setError(null);

    try {
      for (const filePath of paths) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const fileData = await readBinaryFile(filePath);
        const base64 = btoa(String.fromCharCode(...fileData));
        await api.uploadArtifact(projectId, { fileName, content: base64 });
      }
      await loadArtifacts();
      setShowImportDialog(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
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

  // Drive: placeholder
  const handleDrive = async () => {
    const url = prompt('Enter a Google Drive share link:');
    if (!url) return;
    setError('Google Drive integration coming soon.');
  };

  const handleDeleteDoc = async (artifactId: string) => {
    if (!confirm('Remove this source? This cannot be undone.')) return;
    try {
      await api.deleteArtifact(projectId, artifactId);
      setArtifacts(prev => prev.filter(a => a.id !== artifactId));
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteRepo = async (repoName: string) => {
    const group = repoGroups.find(g => g.repoName === repoName);
    if (!group) return;
    if (!confirm(`Remove "${repoName}" repository and all ${group.artifacts.length} files?`)) return;
    try {
      for (const a of group.artifacts) {
        await api.deleteArtifact(projectId, a.id);
      }
      setExpandedRepos(prev => { const n = new Set(prev); n.delete(repoName); return n; });
      setArtifacts(prev => prev.filter(a => !group.artifacts.some(g => g.id === a.id)));
    } catch (e) {
      setError(String(e));
    }
  };

  if (loading) return <div className="panel-loading">Loading sources...</div>;

  return (
    <div className="artifacts-panel">
      <div className="panel-header">
        <h3>Sources</h3>
        <div className="panel-actions">
          <button className="btn-primary" onClick={() => setShowImportDialog(true)}>
            + Add Source
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {artifacts.length === 0 ? (
        <div className="artifacts-empty">
          <p className="card-empty">No sources imported yet.</p>
          <button className="btn-primary" onClick={() => setShowImportDialog(true)}>
            Add Source
          </button>
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
                <button className="btn-delete-icon" onClick={() => handleDeleteDoc(a.id)} title="Remove">×</button>
              </div>
            </div>
          ))}

          {/* Repository groups (expandable) */}
          {repoGroups.map(group => {
            const isExpanded = expandedRepos.has(group.repoName);
            return (
              <div key={group.repoName} className="artifact-repo-group">
                <div className="artifact-row artifact-repo-header" onClick={() => toggleRepo(group.repoName)}>
                  <div className="artifact-info">
                    <span className="badge badge-repository">Repository</span>
                    <span className="artifact-name">{group.repoName}</span>
                    <span className="artifact-file-count">{group.artifacts.length} files</span>
                    {indexing && <span className="indexing-spinner" title="Indexing repository...">⟳</span>}
                    <svg className={`artifact-expand-icon ${isExpanded ? 'expanded' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </div>
                  <div className="artifact-meta">
                    <button className="btn-delete-icon" onClick={(e) => { e.stopPropagation(); handleDeleteRepo(group.repoName); }} title="Remove repository">×</button>
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
                              <div className="artifact-repo-folder" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => toggleFolder(nodePath)}>
                                <svg className={`artifact-expand-icon ${isFolderOpen ? 'expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 18 15 12 9 6"/>
                                </svg>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                </svg>
                                <span className="artifact-file-name">{node.name}</span>
                                <span className="artifact-file-count">{node.children?.length}</span>
                              </div>
                              {isFolderOpen && node.children?.map(child => renderNode(child, depth + 1, nodePath))}
                            </div>
                          );
                        }
                        return (
                          <div key={nodePath} className="artifact-repo-file-row" style={{ paddingLeft: 12 + depth * 16 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#999' }}>
                              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
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
        <div className="import-dialog-overlay" onClick={() => setShowImportDialog(false)}>
          <div className="import-dialog" onClick={e => e.stopPropagation()}>
            <div className="import-dialog-header">
              <h3>ADD SOURCES</h3>
              <button className="import-dialog-close" onClick={() => setShowImportDialog(false)}>×</button>
            </div>

            <div className="import-dialog-body">
              <div className="import-dropzone">
                <div className="import-dropzone-content">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                  <p>Drag sources here</p>
                </div>
              </div>

              <div className="import-options">
                <button className="import-option" onClick={handleUpload} disabled={uploading}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Upload</span>
                </button>

                <button className="import-option" onClick={handleRepository} disabled={importing}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                  <span>Repository</span>
                </button>

                <button className="import-option" onClick={handleDrive}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                  </svg>
                  <span>Drive</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
