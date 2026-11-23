import { useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { isSupportedLocalSource, MAX_LOCAL_SOURCE_FILES, readDroppedLocalSources, type LocalSourceFile } from '../../components/projectLocalFiles';
import type { CheckDocument } from '../../check/types';
import { saveCheckDocuments } from '../../check/runner';
import { api } from '../../api/client';
import '../../components/ProjectCreateModal.css';

const ACCEPT = '.md,.markdown,.txt,.pdf,.json,.csv,.yaml,.yml,.doc,.docx';
const extensions = new Set(ACCEPT.split(','));

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
  return { documents, message: [batch.message, failed.length ? `Could not save ${failed.length} documents to the library. Centinel will try again when you send the check.` : null].filter(Boolean).join(' ') || null };
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
  return <Modal isOpen={open} onClose={close} title="Add Document">
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
      <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} aria-label="Document files" onChange={event => choose(event.target)} />
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} aria-label="Document folder" onChange={event => choose(event.target)} />
    </div>
    {busy && <p role="status">Adding documents…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
