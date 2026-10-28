import { useEffect, useRef, useState } from 'react';
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

export function FrozenReviewSources({ projectId, reviewId, manifest, readState, onRetryEvidence, onManageSources }: Props) {
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const identity = `${projectId}:${reviewId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    requestSequence.current += 1;
    setLoadingArtifactId(null);
    setPreview(null);
    setPreviewError(null);
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
      const text = isTextArtifact(artifact, saved.mimeType) ? new TextDecoder().decode(bytes) : null;
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

  return (
    <section className="frozen-review-sources" aria-labelledby="frozen-review-sources-heading">
      <header className="frozen-review-sources-header">
        <div>
          <span className="command-eyebrow">Historical evidence</span>
          <h2 id="frozen-review-sources-heading">Sources used</h2>
          <p>{displayedCount == null ? 'Reviewed source count unavailable' : `${displayedCount} reviewed artifact${displayedCount === 1 ? '' : 's'}`}</p>
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
        <ul className="frozen-review-source-list" aria-label="Reviewed artifacts">
          {artifacts.map(artifact => {
            const hasVersion = Boolean(artifact.artifactVersionId);
            const activePreview = preview?.identity === identity && preview.artifactId === artifact.id ? preview : null;
            return <li key={artifact.id} className="frozen-review-source-item">
              <div className="frozen-review-source-file">
                <FileText size={17} aria-hidden="true" />
                <div>
                  <strong>{artifact.fileName || 'Untitled artifact'}</strong>
                  <span title={artifact.filePath || undefined}>{artifact.filePath || 'Saved source identity unavailable'}</span>
                </div>
              </div>
              <dl className="frozen-review-source-version">
                <div><dt>Saved version</dt><dd>{hasVersion ? artifact.artifactVersionId : 'Unavailable'}</dd></div>
                <div><dt>Content hash</dt><dd title={artifact.contentHash || undefined}>{artifact.contentHash || 'Unavailable'}</dd></div>
              </dl>
              {hasVersion
                ? <button type="button" className="btn-link frozen-review-preview" onClick={() => void loadSavedVersion(artifact)} disabled={loadingArtifactId !== null}>
                  {loadingArtifactId === artifact.id ? 'Loading saved version…' : activePreview ? 'Reload saved version' : 'Preview saved version'}
                </button>
                : <SourceUnavailable>The exact saved version is unavailable for preview.</SourceUnavailable>}
              {activePreview && <div className="frozen-review-preview-content" aria-label={`Saved version preview: ${activePreview.fileName}`}>
                {activePreview.text !== null
                  ? <pre tabIndex={0}>{activePreview.text || 'This saved file is empty.'}</pre>
                  : <p>This file is available as a saved-version download.</p>}
                <a className="btn-secondary frozen-review-download" href={activePreview.downloadUrl} download={activePreview.fileName}>Download saved version</a>
              </div>}
            </li>;
          })}
        </ul>
      )}
      {previewError && <p className="frozen-review-source-error" role="alert">{previewError}</p>}
      {currentManifest?.status === 'available' && displayedCount != null && artifacts && artifacts.length !== displayedCount && (
        <SourceUnavailable>The listed artifacts do not match the manifest count. This Review’s source evidence needs checking.</SourceUnavailable>
      )}
    </section>
  );
}
