import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import { api } from '../api/client';
import type { ReviewSourceArtifact, ReviewSourceManifest } from '../types';
import './FrozenReviewSources.css';

type Props = {
  projectId: string;
  reviewId: string;
  manifest: ReviewSourceManifest | null;
  readState: 'not-requested' | 'loading' | 'loaded' | 'unavailable' | 'failed';
  onRetryEvidence: () => void;
  onManageSources?: () => void;
};

type Preview = {
  identity: string;
  artifactId: string;
  fileName: string;
  text: string | null;
  downloadUrl: string;
};

function normalizedHash(value: string): string {
  return value.trim().replace(/^sha256:/i, '').toLowerCase();
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isTextArtifact(artifact: ReviewSourceArtifact, mimeType: string | null): boolean {
  if (mimeType?.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return true;
  return /\.(txt|md|js|ts|jsx|tsx|py|java|cs|json|ya?ml|html|css|go|rb|php|rs|xml|toml|ini)$/i.test(artifact.fileName);
}

function SourceUnavailable({ children }: { children: string }) {
  return <p className="frozen-review-source-unavailable" role="status">{children}</p>;
}

function SavedFolder({ name, artifacts, renderFile, depth }: { name: string; artifacts: ReviewSourceArtifact[]; renderFile: (artifact: ReviewSourceArtifact) => ReactNode; depth: number }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{name} <small>({artifacts.length})</small></summary>{open && <SavedDirectory artifacts={artifacts} renderFile={renderFile} depth={depth} />}</details>;
}

function SavedDirectory({ artifacts, renderFile, depth = 0 }: { artifacts: ReviewSourceArtifact[]; renderFile: (artifact: ReviewSourceArtifact) => ReactNode; depth?: number }) {
  const [limit, setLimit] = useState(100);
  const directories = new Map<string, ReviewSourceArtifact[]>();
  const files: ReviewSourceArtifact[] = [];
  for (const artifact of artifacts) {
    const parts = (artifact.filePath || artifact.fileName).replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= depth + 1) files.push(artifact);
    else { const name = parts[depth]; directories.set(name, [...(directories.get(name) ?? []), artifact]); }
  }
  const entries = [...directories].sort(([a], [b]) => a.localeCompare(b));
  return <ul className="frozen-review-directory">{entries.slice(0, limit).map(([name, items]) => <li key={name}><SavedFolder name={name} artifacts={items} renderFile={renderFile} depth={depth + 1} /></li>)}{files.slice(0, Math.max(0, limit - entries.length)).map(artifact => <li key={artifact.id}>{renderFile(artifact)}</li>)}{entries.length + files.length > limit && <li><button className="btn-link" type="button" onClick={() => setLimit(value => value + 100)}>Show more entries ({entries.length + files.length - limit} remaining)</button></li>}</ul>;
}

export function FrozenReviewSources({ projectId, reviewId, manifest, readState, onRetryEvidence, onManageSources }: Props) {
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchLimit, setSearchLimit] = useState(100);
  const requestSequence = useRef(0);
  const identity = `${projectId}:${reviewId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    requestSequence.current += 1;
    setLoadingArtifactId(null);
    setPreview(null);
    setPreviewError(null);
    setQuery('');
    return () => { requestSequence.current += 1; };
  }, [identity]);

  useEffect(() => () => {
    if (preview?.downloadUrl) URL.revokeObjectURL(preview.downloadUrl);
  }, [preview]);

  const loadSavedVersion = async (artifact: ReviewSourceArtifact) => {
    if (!artifact.artifactVersionId || loadingArtifactId) return;
    const requestId = ++requestSequence.current;
    const requestIdentity = identity;
    const isCurrent = () => requestSequence.current === requestId && currentIdentity.current === requestIdentity;
    setLoadingArtifactId(artifact.id);
    setPreviewError(null);
    setPreview(null);
    try {
      const saved = await api.getReviewArtifactContent(projectId, reviewId, artifact.id);
      if (!isCurrent()) return;
      if (saved.versionId !== artifact.artifactVersionId) throw new Error('Version mismatch');
      const expectedHash = normalizedHash(artifact.contentHash);
      const receivedHash = normalizedHash(saved.contentHash);
      if (!expectedHash || !receivedHash || expectedHash !== receivedHash) throw new Error('Hash mismatch');

      const bytes = decodeBase64(saved.content);
      const text = saved.textContent ?? (isTextArtifact(artifact, saved.mimeType) ? new TextDecoder().decode(bytes) : null);
      const contentType = saved.mimeType || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      if (isCurrent()) setPreview({ identity: requestIdentity, artifactId: artifact.id, fileName: artifact.fileName, text, downloadUrl: url });
      else URL.revokeObjectURL(url);
    } catch {
      if (isCurrent()) setPreviewError(`The saved version of ${artifact.fileName || 'this artifact'} is unavailable or could not be verified. Current project content was not used.`);
    } finally {
      if (isCurrent()) setLoadingArtifactId(null);
    }
  };

  const currentManifest = manifest?.projectId === projectId && manifest.sessionId === reviewId ? manifest : null;
  const artifacts = currentManifest?.artifacts;
  const displayedCount = artifacts ? artifacts.length : currentManifest?.artifactCount;

  const renderFile = (artifact: ReviewSourceArtifact) => <button type="button" className="btn-link frozen-review-file-link" title={artifact.filePath} disabled={!artifact.artifactVersionId || loadingArtifactId !== null} onClick={() => void loadSavedVersion(artifact)}><FileText size={15} aria-hidden="true" />{artifact.fileName}{!artifact.artifactVersionId && ' · version unavailable'}</button>;
  const matches = (artifacts ?? []).filter(artifact => `${artifact.filePath} ${artifact.fileName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleMatches = query ? matches.slice(0, searchLimit) : matches;
  const assigned = new Set(currentManifest?.sources.flatMap(source => source.artifactIds) ?? []);
  const groups = [...(currentManifest?.sources ?? []).map(source => ({ id: source.id, label: source.label, items: visibleMatches.filter(item => source.artifactIds.includes(item.id)) })), { id: 'unassigned', label: 'Other saved files', items: visibleMatches.filter(item => !assigned.has(item.id)) }].filter(group => group.items.length);
  return (
    <section className="frozen-review-sources" aria-labelledby="frozen-review-sources-heading">
      <header className="frozen-review-sources-header">
        <div>
          <span className="command-eyebrow">Historical evidence</span>
          <h2 id="frozen-review-sources-heading">Sources in scope</h2>
          <p>{displayedCount == null ? 'Saved source count unavailable' : `${displayedCount} saved file${displayedCount === 1 ? '' : 's'}`}</p>
        </div>
        {onManageSources && <button type="button" className="btn-secondary frozen-review-manage" onClick={onManageSources}>
          Manage project sources <ArrowUpRight size={14} aria-hidden="true" />
        </button>}
      </header>

      {readState === 'loading' && <p className="frozen-review-source-unavailable" role="status">Refreshing this Review’s saved source evidence…</p>}
      {readState === 'failed' && <div className="frozen-review-source-error" role="alert"><span>The saved source manifest could not be loaded. Previously loaded Review evidence remains visible; current project sources are not shown.</span><button type="button" className="btn-link" onClick={onRetryEvidence}>Retry source evidence</button></div>}
      {(readState === 'not-requested' || readState === 'unavailable' || !currentManifest || currentManifest.status === 'unavailable') && (
        <SourceUnavailable>This Review’s saved source manifest is unavailable. Current project sources are not shown.</SourceUnavailable>
      )}
      {currentManifest?.status === 'incomplete' && <SourceUnavailable>The saved source manifest is incomplete. Only recorded evidence is shown.</SourceUnavailable>}
      {currentManifest?.status === 'available' && !artifacts && <SourceUnavailable>This historical manifest predates per-artifact version details, so its exact reviewed files cannot be listed.</SourceUnavailable>}
      {currentManifest?.status === 'available' && artifacts?.length === 0 && <SourceUnavailable>{displayedCount === 0 ? 'No artifacts were recorded for this Review.' : 'The manifest does not contain the recorded artifact details.'}</SourceUnavailable>}

      {artifacts && artifacts.length > 0 && (
        <details className="frozen-review-browser">
          <summary>Browse saved sources</summary>
          <label className="frozen-review-search">Find a saved file<input type="search" value={query} onChange={event => { setQuery(event.target.value); setSearchLimit(100); }} placeholder="File name or path" /></label>
          <div className="frozen-review-browser-body">
            <nav className="frozen-review-source-list" aria-label="Saved source directories">
              {groups.map(group => <details key={`${group.id}:${Boolean(query)}`} open={query ? true : undefined}><summary>{group.label} <small>({group.items.length})</small></summary>{query ? group.items.map(artifact => <div key={artifact.id}>{renderFile(artifact)}<small className="frozen-review-result-path">{artifact.filePath}</small></div>) : <SavedDirectory artifacts={group.items} renderFile={renderFile} />}</details>)}
              {matches.length === 0 && <p>No saved files match.</p>}
              {query && matches.length > searchLimit && <button type="button" className="btn-link" onClick={() => setSearchLimit(value => value + 100)}>Show more matches ({matches.length - searchLimit} remaining)</button>}
            </nav>
            <div className="frozen-review-reader" aria-live="polite">
              {loadingArtifactId && <p role="status">Loading saved version…</p>}
              {preview?.identity === identity ? <><h3>{preview.fileName}</h3><details><summary>Saved version details</summary><dl className="frozen-review-source-version"><div><dt>Version</dt><dd>{artifacts.find(item => item.id === preview.artifactId)?.artifactVersionId}</dd></div><div><dt>Content hash</dt><dd>{artifacts.find(item => item.id === preview.artifactId)?.contentHash}</dd></div></dl></details><div className="frozen-review-preview-content" aria-label={`Saved version preview: ${preview.fileName}`}>
                {preview.text !== null ? <pre tabIndex={0}>{preview.text.split('\n').map((line, index) => <span className="frozen-review-code-line" key={index}><span aria-hidden="true">{index + 1}</span>{line || ' '}</span>)}</pre> : <p>This file is available as a saved-version download.</p>}
                <a className="btn-secondary frozen-review-download" href={preview.downloadUrl} download={preview.fileName}>Download saved version</a>
              </div></> : !loadingArtifactId && <p>Select a file to read its saved version.</p>}
            </div>
          </div>
        </details>
      )}
      {previewError && <p className="frozen-review-source-error" role="alert">{previewError}</p>}
      {currentManifest?.status === 'available' && displayedCount != null && artifacts && artifacts.length !== currentManifest.artifactCount && (
        <SourceUnavailable>The listed artifacts do not match the manifest count. This Review’s source evidence needs checking.</SourceUnavailable>
      )}
    </section>
  );
}
