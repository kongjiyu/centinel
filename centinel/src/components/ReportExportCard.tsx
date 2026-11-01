import { Download, FileText } from 'lucide-react';
import type { ProjectReportExportResult } from '../api/client';
import './ReportExportCard.css';

type Props = {
  result: ProjectReportExportResult;
  /** Card heading, e.g. "Project report ready". */
  title: string;
  /** What the report covers, shown before the generation time. */
  subject: string;
  formatDate: (value: string) => string;
  headingId: string;
  downloadsLabel?: string;
  showMarkdownPreview?: boolean;
};

/**
 * Result of a report export: one clear PDF download first, other formats as
 * secondary links, and storage/integrity facts behind a Technical details disclosure.
 */
export function ReportExportCard({ result, title, subject, formatDate, headingId, downloadsLabel = 'Report downloads', showMarkdownPreview = false }: Props) {
  const { downloads } = result;
  const hasLinks = Boolean(downloads.pdf || downloads.markdown || downloads.json);
  return (
    <section className="report-export-card" aria-labelledby={headingId}>
      <div className="report-export-card-main">
        <span className="report-export-card-icon" aria-hidden="true"><FileText size={20} /></span>
        <div className="report-export-card-copy">
          <h2 id={headingId}>{title}</h2>
          <p role="status" aria-live="polite">{subject} · Generated {formatDate(result.generatedAt)}</p>
        </div>
      </div>
      <nav className="report-export-card-downloads" aria-label={downloadsLabel}>
        {downloads.pdf && <a className="btn-primary" href={downloads.pdf} target="_blank" rel="noreferrer" download><Download size={16} aria-hidden="true" /> Download PDF</a>}
        {downloads.markdown && <a className="btn-secondary" href={downloads.markdown} target="_blank" rel="noreferrer" download aria-label="Download Markdown">Markdown</a>}
        {downloads.json && <a className="btn-secondary" href={downloads.json} target="_blank" rel="noreferrer" download aria-label="Download JSON">JSON</a>}
        {!hasLinks && <span>Download links are unavailable. The report was saved; export again to get fresh links.</span>}
      </nav>
      {hasLinks && result.expiresAt && <p className="report-export-card-note">Links stop working at {formatDate(result.expiresAt)}. Export again for fresh links.</p>}
      <details className="report-export-card-details">
        <summary>Technical details</summary>
        <dl>
          <div><dt>Report ID</dt><dd><code>{result.reportId}</code></dd></div>
          <div><dt>Stored in</dt><dd>Private Supabase storage</dd></div>
          <div><dt>Report format</dt><dd><code>{result.generatorVersion}</code></dd></div>
          <div><dt>Risk policy</dt><dd><code>{result.riskPolicyVersion}</code></dd></div>
          <div><dt>Snapshot checksum</dt><dd><code>{result.checksums.snapshot}</code></dd></div>
          <div><dt>Markdown checksum</dt><dd><code>{result.checksums.markdown}</code></dd></div>
          <div><dt>PDF checksum</dt><dd><code>{result.checksums.pdf}</code></dd></div>
          <div><dt>Package checksum</dt><dd><code>{result.checksums.package}</code></dd></div>
        </dl>
        {showMarkdownPreview && result.markdown && <>
          <h3>Markdown preview</h3>
          <pre className="report-export-card-preview">{result.markdown}</pre>
        </>}
      </details>
    </section>
  );
}
