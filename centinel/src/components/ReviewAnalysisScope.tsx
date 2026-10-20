import type { ReviewAnalysisMap } from '../reviewHarness';
import type { Finding } from '../types';

const domainNames = { security: 'Security', business: 'Business rules', technical: 'Technical', personnel: 'Human error' };

/** Saved evidence summaries only; never render private model reasoning. */
export function ReviewAnalysisScope({ map, findings = [], onOpenFinding }: { map: ReviewAnalysisMap | null | undefined; findings?: Finding[]; onOpenFinding?: (id: string) => void }) {
  if (!map) return <p className="review-history-unavailable">Feature and path coverage was not recorded for this review.</p>;
  return <section className="review-analysis-scope" aria-labelledby="review-analysis-heading">
    <h3 id="review-analysis-heading">Features and paths checked</h3>
    <p>I identified {map.features.length} possible feature{map.features.length === 1 ? '' : 's'} in {map.coverage.parsedArtifacts} of {map.coverage.sourceArtifacts} source files. This map covers the visible code branches; runtime and dependency paths still need verification.</p>
    {map.status !== 'assessed' && <p role="status">{map.status === 'partial' ? 'Some domain assessments are available.' : 'Domain assessments are not verified yet.'} Unverified coverage is not a clean result.</p>}
    {map.features.map(feature => <details key={feature.id} className="review-analysis-feature">
      <summary>{feature.label} · {feature.paths.length} mapped {feature.paths.length === 1 ? 'path' : 'paths'}</summary>
      <p>Inferred feature — confirm its purpose against the project requirements.</p>
      <ul>{feature.assessments.map(item => <li key={item.domain}><strong>{domainNames[item.domain]}: </strong>{item.status === 'assessed' ? item.summary : 'Not verified.'}</li>)}</ul>
      {onOpenFinding && <ul>{findings.filter(finding => finding.location?.sourceLocator?.analysis?.featureId === feature.id).map(finding => <li key={finding.id}><button type="button" className="btn-link" onClick={() => onOpenFinding(finding.id)} aria-label={`View finding: ${finding.title}`}>{finding.title}</button></li>)}</ul>}
      <details><summary>Path coverage and open questions</summary>
        <ul>{feature.paths.map(path => <li key={path.id}><strong>{path.kind}: </strong>{path.label}{path.evidence[0] && <span> ({path.evidence[0].filePath}:{path.evidence[0].lineNumber})</span>}</li>)}</ul>
        <ul>{feature.unresolved.map((item, i) => <li key={i}>{item.reason}</li>)}</ul>
      </details>
    </details>)}
    <details><summary>Coverage limits</summary><ul>{map.coverage.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
      <ul>{map.coverage.unsupportedArtifacts.map(item => <li key={item.artifactId}>{item.filePath}: {item.reason}</li>)}</ul>
    </details>
  </section>;
}
