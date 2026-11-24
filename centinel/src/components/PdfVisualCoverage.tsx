import type { EvidenceSufficiencyAssessment } from '../types';

export function PdfVisualCoverage({ assessment }: { assessment: EvidenceSufficiencyAssessment | null | undefined }) {
  const files = assessment?.pdfVisualCoverage ?? [];
  if (!files.length) return null;
  return <details className="ck-pdf-visual">
    <summary>PDF visual review</summary>
    {files.map(file => <details key={`${file.artifactId}:${file.sourceVersion}`}>
      <summary>{file.fileName} · {file.pages.length} of {file.totalPages} pages reviewed</summary>
      {file.pages.length > 0 && <ul>{file.pages.map(page => <li key={page.page}><strong>Page {page.page}</strong> {page.summary}</li>)}</ul>}
    </details>)}
  </details>;
}
