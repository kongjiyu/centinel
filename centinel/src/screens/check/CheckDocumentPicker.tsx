import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FileText } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { isSupportedLocalSource, MAX_LOCAL_SOURCE_FILES, readDroppedLocalSources, type LocalSourceFile } from '../../components/projectLocalFiles';
import type { CheckDocument } from '../../check/types';
import { saveCheckDocuments } from '../../check/runner';
import { api } from '../../api/client';
import '../../components/ProjectCreateModal.css';

export const CHECK_DOCUMENT_ACCEPT = '.md,.markdown,.txt,.pdf,.json,.csv,.yaml,.yml,.doc,.docx';
const extensions = new Set(CHECK_DOCUMENT_ACCEPT.split(','));

export type CheckDocumentBatch = { accepted: CheckDocument[]; message: string | null };

export async function attachCheckDocuments(batch: CheckDocumentBatch, existing: CheckDocument[], projectId?: string) {
  const names = new Set(existing.map(document => document.name));
  const additions = batch.accepted.filter(document => {
    if (names.has(document.name)) return false;
    names.add(document.name);
    return true;
  });
  if (!projectId || !additions.length) return { documents: additions, message: batch.message };
  const { documents, failed } = await saveCheckDocuments(api, projectId, additions);
  return { documents, message: [batch.message, failed.length ? `Could not save ${failed.length} documents to the library. ORIN will try again when you send the check.` : null].filter(Boolean).join(' ') || null };
}

export async function readCheckDocuments(files: LocalSourceFile[], limited = false): Promise<CheckDocumentBatch> {
  const accepted: CheckDocument[] = [];
  const rejected: string[] = [];
  for (const source of files) {
    if (accepted.length === MAX_LOCAL_SOURCE_FILES) { limited = true; break; }
    const { file, path } = source;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!extensions.has(extension) || !isSupportedLocalSource(source)) { rejected.push(path); continue; }
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      accepted.push({ name: path, base64 });
    } catch { rejected.push(path); }
  }
  const notes = [
    rejected.length ? `Skipped ${rejected.length} unreadable or unsupported files. Choose Markdown, text, PDF, Word, JSON, CSV or YAML, up to 10 MB per file.` : '',
    limited ? 'Some files were skipped. Choose up to 200 documents at a time.' : '',
    !files.length ? 'No readable documents were found.' : '',
  ];
  return { accepted, message: notes.filter(Boolean).join(' ') || null };
}

export async function readDroppedCheckDocuments(transfer: DataTransfer) {
  const { files, limited } = await readDroppedLocalSources(transfer);
  return readCheckDocuments(files, limited);
}

export function CheckDocumentPicker({ open, onClose, onSelect, closeOnSelect = true }: { open: boolean; onClose: () => void; onSelect: (batch: CheckDocumentBatch) => Promise<void> | void; closeOnSelect?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    setDragging(false);
    onClose();
  };
  const select = async (read: () => Promise<CheckDocumentBatch>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const batch = await read();
      if (!batch.accepted.length) { setError(batch.message); return; }
      await onSelect(batch);
      if (closeOnSelect) onClose();
    } catch {
      setError('The selected files could not be added. Try again.');
    } finally { setBusy(false); }
  };
  const choose = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? [], file => ({ file, path: file.webkitRelativePath || file.name }));
    input.value = '';
    if (files.length) void select(() => readCheckDocuments(files));
  };
  return <Modal isOpen={open} onClose={close} title="Add Document" appBackdrop>
    <div className="project-source-drop" data-dragging={dragging || undefined} aria-busy={busy} onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      if (!busy) setDragging(true);
    }} onDragLeave={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false);
    }} onDrop={event => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      if (!event.dataTransfer.types.includes('Files')) return;
      void select(() => readDroppedCheckDocuments(event.dataTransfer));
    }}>
      <Icon icon={FileText} />
      <span>Drop files or a folder here</span>
      <div className="project-source-pickers">
        <button type="button" className="btn-link" data-autofocus disabled={busy} onClick={() => fileInput.current?.click()}>Choose files</button>
        <button type="button" className="btn-link" disabled={busy} onClick={() => folderInput.current?.click()}>Choose folder</button>
      </div>
      <input ref={fileInput} type="file" multiple hidden accept={CHECK_DOCUMENT_ACCEPT} aria-label="Document files" onChange={event => choose(event.target)} />
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} aria-label="Document folder" onChange={event => choose(event.target)} />
    </div>
    {busy && <p role="status">Adding documents…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}

export function usePageDocumentDrop(
  anchor: RefObject<HTMLElement>,
  enabled: boolean,
  onFiles: (read: () => Promise<CheckDocumentBatch>) => void,
) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  latest.current = onFiles;
  useEffect(() => {
    setDragging(false);
    if (!enabled) return;
    const area = anchor.current?.closest('main') ?? anchor.current?.closest('.ck-start, .ck-detail-layout') ?? anchor.current;
    if (!area) return;
    const allowDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files') || document.querySelector('[aria-modal=true]')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const end = () => setDragging(false);
    const leave = (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !area.contains(event.relatedTarget)) {
        // Chromium can omit relatedTarget as the pointer crosses a child.
        const bounds = area.getBoundingClientRect();
        if (event.relatedTarget || event.clientX <= bounds.left || event.clientX >= bounds.right
          || event.clientY <= bounds.top || event.clientY >= bounds.bottom) end();
      }
    };
    const drop = (event: DragEvent) => {
      end();
      if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files') || document.querySelector('[aria-modal=true]')) return;
      event.preventDefault();
      const transfer = event.dataTransfer;
      latest.current(() => readDroppedCheckDocuments(transfer));
    };
    area.addEventListener('dragover', allowDrop);
    area.addEventListener('dragleave', leave);
    area.addEventListener('drop', drop);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    window.addEventListener('blur', end);
    return () => {
      area.removeEventListener('dragover', allowDrop);
      area.removeEventListener('dragleave', leave);
      area.removeEventListener('drop', drop);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
      window.removeEventListener('blur', end);
    };
  }, [anchor, enabled]);
  return dragging;
}

export function PageDocumentDropIndicator({ anchor }: { anchor: RefObject<HTMLElement> }) {
  const area = anchor.current?.closest('main') ?? anchor.current?.closest('.ck-start, .ck-detail-layout');
  const bounds = area?.getBoundingClientRect();
  return createPortal(<div className="ck-page-file-drop" role="status"
    style={bounds ? { inset: `${bounds.top}px ${window.innerWidth - bounds.right}px ${window.innerHeight - bounds.bottom}px ${bounds.left}px` } : undefined}>
    <Icon icon={FileText} /><span>Drop documents anywhere on this page</span>
  </div>, document.body);
}

export function CheckDocumentInput({ input, onFiles }: {
  input: RefObject<HTMLInputElement>;
  onFiles: (read: () => Promise<CheckDocumentBatch>) => void;
}) {
  return <input ref={input} type="file" multiple hidden accept={CHECK_DOCUMENT_ACCEPT} aria-label="Document files"
    onChange={event => {
      const files = Array.from(event.currentTarget.files ?? [], file => ({ file, path: file.name }));
      event.currentTarget.value = '';
      if (files.length) onFiles(() => readCheckDocuments(files));
    }} />;
}
