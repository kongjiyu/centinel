import { FileText, GitBranch, SquareChartGantt, TriangleAlert, X } from 'lucide-react';

const attachmentIcons = { check: SquareChartGantt, problem: TriangleAlert, document: FileText, library: GitBranch };
const fileTypes: Record<string, string> = { pdf: 'PDF', md: 'Markdown', markdown: 'Markdown', txt: 'Text',
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', doc: 'Word', docx: 'Word',
  csv: 'CSV', json: 'JSON', yaml: 'YAML', yml: 'YAML', png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', webp: 'WebP' };

export type ConversationAttachmentKind = keyof typeof attachmentIcons;

export function ConversationAttachment({ kind, label, onRemove, base64 }: {
  kind: ConversationAttachmentKind; label: string; onRemove?: () => void; base64?: string;
}) {
  const AttachmentIcon = attachmentIcons[kind];
  const extension = /\.([a-z\d]+)$/i.exec(label)?.[1].toLowerCase();
  const type = kind === 'check' ? 'Check' : kind === 'problem' ? 'Problem'
    : (extension && fileTypes[extension]) || (kind === 'document' ? 'Document' : 'Library file');
  const bytes = base64 ? Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) : undefined;
  const size = bytes === undefined ? undefined : bytes < 1024 ? `${bytes} B` :
    bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return <li className="ck-conversation-attachment" data-attachment-kind={kind} data-full-label={label} tabIndex={0} aria-label={label}>
    <span className="ck-attachment-icon"><AttachmentIcon size={17} aria-hidden="true" /></span>
    <span className="ck-attachment-content"><strong>{label}</strong><small>{type}{size && ` · ${size}`}</small></span>
    {onRemove && <button type="button" title={`Remove ${label}`} aria-label={`Remove ${kind === 'document' ? '' : `${kind === 'library' ? 'source' : kind} `}${label}`} onClick={onRemove}>
      <X size={14} aria-hidden="true" />
    </button>}
  </li>;
}
