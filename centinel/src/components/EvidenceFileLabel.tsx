import { Code, File, FileText } from 'lucide-react';
import { useId } from 'react';
import './EvidenceFileLabel.css';

const codeExtension = /\.(?:[cm]?[jt]sx?|jsonc?|html?|css|scss|vue|svelte|py|rb|rs|go|java|cs|cpp|c|h|sql|sh|ps1|xml|ya?ml|toml)$/i;

export function EvidenceFileLabel({ path, line, excerpt, focusable = false, href }: { path: string; line?: number | null; excerpt?: string | null; focusable?: boolean; href?: string }) {
  const tooltipId = useId();
  const name = path.split(/[\\/]/).pop() || path;
  const pdf = /\.pdf$/i.test(name);
  const Icon = pdf || /\.(?:md|txt|docx?)$/i.test(name) ? FileText : codeExtension.test(name) ? Code : File;
  const location = line && line > 0 ? `${path}:${line}` : path;
  const content = <>
    <Icon size={12} aria-hidden="true" />
    {pdf && <span className="evidence-file-format" aria-hidden="true">PDF</span>}
    <span>{name}</span>
    <span id={tooltipId} className="evidence-file-tooltip" role="tooltip"><strong>{location}</strong>{excerpt && <code>{excerpt}</code>}</span>
  </>;
  if (href) return <a className="evidence-file-label" href={href} aria-label={name} aria-describedby={tooltipId}>{content}</a>;
  return <span className="evidence-file-label" tabIndex={focusable ? 0 : undefined} aria-describedby={focusable ? tooltipId : undefined}>{content}</span>;
}
