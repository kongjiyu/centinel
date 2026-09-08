import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ImageOff, RotateCcw } from 'lucide-react';
import type { DynamicEvidence } from '../types';
import { Modal } from './Modal';

function evidenceImageSrc(filePath: string, retryKey = 0): string {
  const retry = retryKey > 0 ? `&retry=${retryKey}` : '';
  return `http://localhost:37701/evidence-file?path=${encodeURIComponent(filePath)}${retry}`;
}

type ThumbnailProps = {
  item: DynamicEvidence;
  onOpen: (item: DynamicEvidence) => void;
  className: string;
  showLabel?: boolean;
};

export function EvidenceScreenshotThumbnail({ item, onOpen, className, showLabel = false }: ThumbnailProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => setLoadFailed(false), [item.filePath]);

  return (
    <button
      type="button"
      className={`${className}${loadFailed ? ' screenshot-load-error' : ''}`}
      onClick={() => onOpen(item)}
      aria-label={`Open screenshot: ${item.summary}`}
    >
      {loadFailed ? (
        <span className="screenshot-unavailable" role="status">
          <ImageOff size={20} aria-hidden="true" />
          <span>Screenshot unavailable</span>
        </span>
      ) : (
        <img
          src={evidenceImageSrc(item.filePath)}
          alt=""
          className={showLabel ? 'screenshot-img' : undefined}
          onError={() => setLoadFailed(true)}
        />
      )}
      {showLabel && <span className="screenshot-label">{item.summary}</span>}
    </button>
  );
}

type ViewerProps = {
  screenshots: DynamicEvidence[];
  selectedId: string | null;
  onSelect: (item: DynamicEvidence) => void;
  onClose: () => void;
};

export function EvidenceScreenshotViewer({ screenshots, selectedId, onSelect, onClose }: ViewerProps) {
  const selectedIndex = useMemo(
    () => screenshots.findIndex(item => item.id === selectedId),
    [screenshots, selectedId],
  );
  const selected = selectedIndex >= 0 ? screenshots[selectedIndex] : null;
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoadFailed(false);
    setRetryKey(0);
  }, [selectedId]);

  const move = (offset: number) => {
    const next = screenshots[selectedIndex + offset];
    if (next) onSelect(next);
  };

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && selectedIndex > 0) {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'ArrowRight' && selectedIndex < screenshots.length - 1) {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, selectedIndex, screenshots]);

  if (!selected) return null;

  const retry = () => {
    setLoadFailed(false);
    setRetryKey(value => value + 1);
  };

  return (
    <Modal isOpen onClose={onClose} title={selected.summary} width={1000}>
      <div className="evidence-viewer-toolbar" aria-label="Screenshot navigation">
        <button
          type="button"
          className="btn-secondary evidence-viewer-nav"
          onClick={() => move(-1)}
          disabled={selectedIndex === 0}
        >
          <ChevronLeft size={16} aria-hidden="true" /> Previous
        </button>
        <span className="evidence-viewer-position" aria-live="polite">
          Screenshot {selectedIndex + 1} of {screenshots.length}
        </span>
        <button
          type="button"
          className="btn-secondary evidence-viewer-nav"
          onClick={() => move(1)}
          disabled={selectedIndex === screenshots.length - 1}
        >
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="screenshot-modal-body">
        {loadFailed ? (
          <div className="evidence-viewer-error" role="alert">
            <AlertCircle size={24} aria-hidden="true" />
            <div>
              <strong>Screenshot could not be loaded.</strong>
              <p>The evidence record is still available. Retry the file or close this viewer.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={retry}>
              <RotateCcw size={16} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <img
            key={`${selected.id}-${retryKey}`}
            src={evidenceImageSrc(selected.filePath, retryKey)}
            alt={selected.summary}
            className="screenshot-modal-img"
            onError={() => setLoadFailed(true)}
          />
        )}
      </div>
    </Modal>
  );
}
