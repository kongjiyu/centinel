import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { userFacingError } from '../../utils/userFacingError';

/**
 * Opens a browser test's screenshots in place (19 Nov 2026, user request: a Screenshot
 * button opens the photo instead of going to another page). Each image is read only
 * when shown; ← and → move between them.
 */
export type Photo = { key: string; title: string; detail?: string | null; load(): Promise<Blob> };

export function PhotoViewer({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex(index: number): void; onClose(): void }) {
  const photo = photos[index];
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) return;
    let active = true;
    let made: string | null = null;
    setUrl(null); setError(null);
    photo.load()
      .then(blob => { made = URL.createObjectURL(blob); if (active) setUrl(made); else URL.revokeObjectURL(made); })
      .catch(cause => { if (active) setError(userFacingError(cause, 'This screenshot is not available on this device.')); });
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
    // Reload only when another photo is shown; the photo list may be rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.key]);
  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); onIndex(index - 1); }
      if (event.key === 'ArrowRight' && index < photos.length - 1) { event.preventDefault(); onIndex(index + 1); }
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [index, photos.length, onIndex]);
  if (!photo) return null;
  const many = photos.length > 1;
  // Rendered at the document root: the check screen's panels create their own positioning context,
  // which otherwise trapped the viewer inside the middle column.
  return createPortal(
    <Modal isOpen onClose={onClose} title={photo.title} width={1040} overlayClassName="ck-viewer-overlay"
      headerAside={many ? <span className="ck-viewer-count">{index + 1} of {photos.length}</span> : undefined}>
      <div className="ck-viewer">
        {photo.detail && <p className="ck-viewer-detail">{photo.detail}</p>}
        <div className="ck-viewer-stage">
          {many && <button type="button" className="ck-viewer-nav is-prev" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous screenshot"><Icon icon={ChevronLeft} /></button>}
          <div className="ck-viewer-frame">
            {url ? <img src={url} alt={photo.title} /> : error ? <p className="ck-col-note">{error}</p> : <p className="ck-col-note"><Icon icon={LoaderCircle} className="ci-spin" />Loading the screenshot…</p>}
          </div>
          {many && <button type="button" className="ck-viewer-nav is-next" onClick={() => onIndex(index + 1)} disabled={index === photos.length - 1} aria-label="Next screenshot"><Icon icon={ChevronRight} /></button>}
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
