import { useRef } from 'react';
import { Modal } from '../../components/Modal';
import type { CheckDocument } from '../../check/types';

const ACCEPT = '.md,.markdown,.txt,.pdf,.json,.csv,.yaml,.yml,.doc,.docx';
const extensions = new Set(ACCEPT.split(','));

export async function readCheckDocuments(files: FileList | File[]) {
  const accepted: CheckDocument[] = [];
  const rejected: string[] = [];
  for (const file of Array.from(files)) {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!extensions.has(extension) || file.size > 10 * 1024 * 1024) { rejected.push(file.name); continue; }
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      accepted.push({ name: file.name, base64 });
    } catch { rejected.push(file.name); }
  }
  return {
    accepted,
    message: rejected.length ? `Not added: ${rejected.join(', ')}. Documents can be Markdown, text, PDF, Word, JSON, CSV or YAML, up to 10 MB.` : null,
  };
}

export function CheckDocumentPicker({ open, onClose, onSelect, closeOnSelect = true }: { open: boolean; onClose: () => void; onSelect: (files: File[]) => void; closeOnSelect?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const select = (files: FileList | null) => {
    if (!files?.length) return;
    onSelect(Array.from(files));
    if (closeOnSelect) onClose();
  };
  return <Modal isOpen={open} onClose={onClose} title="Add Document">
    <div className="ck-document-actions">
      <button type="button" className="ck-button" onClick={() => fileInput.current?.click()}>Choose files</button>
      <button type="button" className="ck-button" onClick={() => folderInput.current?.click()}>Choose folder</button>
      <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} onChange={event => select(event.target.files)} />
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={event => select(event.target.files)} />
    </div>
  </Modal>;
}
