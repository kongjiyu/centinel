import type { FindingLink, ReviewNarrative } from '../reviewNarrative';

export function ReviewObjectiveList({ points }: { points: string[] }) {
  return points.length ? <ul className="review-objective-points">{points.map((point, index) => <li key={index}>{point}</li>)}</ul>
    : <p>No review instructions were supplied.</p>;
}
export function ReviewNarrativeSummary({ summary }: { summary: ReviewNarrative['summary'] }) {
  return <dl className="review-narrative-summary">
    <div><dt>What happened</dt><dd>{summary.outcome}</dd></div>
    <div><dt>What needs attention</dt><dd>{summary.blockers.length ? <ul>{summary.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul> : 'Nothing stopped the review. Check the findings before making your decision.'}</dd></div>
    <div><dt>What to do next</dt><dd>{summary.next}</dd></div>
  </dl>;
}
function FindingLinks({ findings, onOpenFinding }: { findings: FindingLink[]; onOpenFinding: (id: string) => void }) {
  return findings.length > 0 ? <ul className="review-stage-findings">{findings.map(finding => <li key={finding.id}>
    <span>{finding.aspect}: </span><button type="button" className="btn-link" onClick={() => onOpenFinding(finding.id)} aria-label={`View finding: ${finding.label}`}>{finding.label}</button>
  </li>)}</ul> : null;
}
export function ReviewNarrativeTimeline({ narrative, loading, error, onOpenFinding }: { narrative: ReviewNarrative; loading: boolean; error: string | null; onOpenFinding: (id: string) => void }) {
  return <div className="review-narrative">
    <div className="review-activity-intro"><p>Review time: <strong>{narrative.timing.duration}</strong></p></div>
    <hr className="review-reasoning-divider" />
    {loading && <p role="status">Loading the saved activity…</p>}
    {error && <p role="status">{error}</p>}
    {!loading && !error && narrative.retryUpdate && <p role="status">{narrative.retryUpdate}</p>}
    {!loading && !narrative.detailedHistoryAvailable && <p>The detailed activity wasn’t saved for this review. You can still inspect its findings below.</p>}
    {narrative.stages.length > 0 && <ol className="review-activity-timeline" aria-label="Review stages">{narrative.stages.map(stage => <li key={stage.id} className="review-narrative-stage">
      <div className="review-stage-heading"><h3>{stage.title}</h3><span>{stage.state} · {stage.duration}</span></div>
      {stage.outcome && <p>{stage.outcome}</p>}
      <FindingLinks findings={stage.findings} onOpenFinding={onOpenFinding} />
    </li>)}</ol>}
    {narrative.unassignedFindings.length > 0 && <section aria-labelledby="review-unassigned-findings"><h3 id="review-unassigned-findings">Other saved findings</h3><p>These findings have no saved stage information.</p><FindingLinks findings={narrative.unassignedFindings} onOpenFinding={onOpenFinding} /></section>}
  </div>;
}
