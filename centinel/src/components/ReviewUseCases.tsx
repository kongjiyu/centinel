import type { ReviewFeature } from '../reviewFeatures';
import type { Finding } from '../types';
import { displayPath } from '../utils/displayPath';

function sourceLocations(references: ReviewFeature['entryPoints']): string {
  return [...new Set(references.map(ref => `${displayPath(ref.filePath)}:${ref.lineNumber}`))].join(' · ');
}

export function ReviewUseCaseDetails({ operations, findings, onOpenFinding }: {
  operations: ReviewFeature[];
  findings: Finding[];
  onOpenFinding: (id: string) => void;
}) {
  const [feature] = operations;
  const paths = operations.flatMap(operation => operation.paths);
  return <section>
    <h4>Implementation paths</h4>
    {feature.entryPoints.length > 0 && <p className="traceability-muted">Entry point · {sourceLocations(feature.entryPoints)}</p>}
    {feature.entryPointStatus && feature.entryPointStatus !== 'resolved' && <p className="traceability-muted">Entry point requires verification.</p>}
    {paths.length > 0 ? <ul className="review-use-case-paths">
      {paths.map(path => {
        const pathFindings = findings.filter(finding => finding.location?.sourceLocator?.analysis?.pathId === path.id);
        return <li key={path.id}>
          <strong>{path.label}</strong>
          <p className="traceability-muted">{path.status === 'unverified' ? 'Unverified' : 'Inferred'}</p>
          {path.evidence.length > 0 && <p className="traceability-muted">{sourceLocations(path.evidence)}</p>}
          {pathFindings.length > 0 && <ul aria-label="Linked findings">{pathFindings.map(finding => <li key={finding.id}>
            <button type="button" className="btn-link" onClick={() => onOpenFinding(finding.id)}>{finding.title}</button>
          </li>)}</ul>}
        </li>;
      })}
    </ul> : <p className="traceability-muted">No paths were recorded for this feature.</p>}
  </section>;
}
