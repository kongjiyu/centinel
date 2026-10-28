import { useEffect, useRef, type ReactNode } from 'react';
import type { Finding } from '../types';
import { findingDomain, findingGroupDomains, findingSourceReferences, groupStatus, type FindingGroup } from '../findingGroups';
import { effectiveFindingStatus } from '../findingStatus';
import { FindingEvidence } from './FindingEvidence';
import { formatEntityId } from '../utils/entityId';

export function FindingDocument({ group, selectedId, onSelect, onBack, actions, onOpenReview }: {
  group: FindingGroup; selectedId: string; onSelect: (id: string) => void; onBack: () => void;
  actions: (finding: Finding) => ReactNode; onOpenReview?: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [group.key]);
  const recommendations = group.members.map(item => item.recommendation.trim());
  const commonRecommendation = recommendations[0] && recommendations.every(value => value === recommendations[0]) ? recommendations[0] : null;
  const origin = group.representative.verifier === 'readiness' ? 'Readiness' : group.representative.source === 'dynamic' ? 'Dynamic Testing' : 'Review';
  return <article className="finding-document card detail-card" aria-label="Finding details">
    <button type="button" className="btn-secondary" onClick={onBack}>Back to findings</button>
    <header><p>{origin} · {findingGroupDomains(group)} · {groupStatus(group)}</p><h2 ref={heading} tabIndex={-1}>{group.title}</h2>
      <p>{group.members.length} flagged {group.members.length === 1 ? 'occurrence' : 'occurrences'}. Each section records the affected sources, explanation and remediation status.</p></header>
    {commonRecommendation && <section className="finding-overall-recommendation" aria-label="Overall recommendation"><h3>Overall recommendation</h3><p>{commonRecommendation}</p></section>}
    {group.members.length > 1 && <nav aria-label="Flagged locations"><h3>Flagged locations</h3><ol>{group.members.map((item,index) => <li key={item.id}><button type="button" className="btn-link" onClick={() => { onSelect(item.id); document.getElementById(`flagged-${encodeURIComponent(item.id)}`)?.scrollIntoView?.({ block: 'start', behavior: 'auto' }); }}>
      {item.filePath || item.requirementId || item.title}{item.lineNumber ? `:${item.lineNumber}` : ''}
    </button></li>)}</ol></nav>}
    {group.members.map((finding,index) => <section key={finding.id} id={`flagged-${encodeURIComponent(finding.id)}`} className="finding-flagged-section" aria-label={`Flagged item ${index+1}`} data-selected={finding.id===selectedId}>
      <header><h3>{index+1}. {finding.filePath || (finding.requirementId ? `Requirement ${finding.requirementId}` : finding.title)}{finding.lineNumber ? `:${finding.lineNumber}` : ''}</h3>
        <p>{formatEntityId(finding.id)} · {findingDomain(finding)} · {finding.severity} · {effectiveFindingStatus(finding)}{finding.priority ? ` · Priority: ${finding.priority}` : ''}</p></header>
      {finding.title !== group.title && <p className="finding-recorded-title">Recorded issue: {finding.title}</p>}
      <section><h4>What happens and why</h4><p>{finding.description || 'A causal explanation was not recorded for this occurrence.'}</p>
        {finding.location?.logicFlow?.length ? <ol aria-label="Logic flow">{finding.location.logicFlow.map((step,i) => <li key={i}>{step}</li>)}</ol> : <p className="finding-evidence-note">No separate step-by-step flow was recorded. The explanation above is the available assessment.</p>}
      </section>
      <FindingEvidence finding={finding} headingLevel={4} />
      {finding.evidenceText && !findingSourceReferences(finding).some(ref => ref.excerpt === finding.evidenceText) && <section><h4>Recorded evidence</h4><pre>{finding.evidenceText}</pre></section>}
      {!commonRecommendation && finding.recommendation && <section><h4>Recommendation for this item</h4><p>{finding.recommendation}</p></section>}
      {finding.resolutionEvidence && <section aria-label="Resolution evidence"><h4>Resolution evidence</h4><p>Not reproduced in the comparable re-review: <strong>{finding.resolutionEvidence.reviewName}</strong>.</p>
        <p>Source version: <code>{finding.resolutionEvidence.previousSourceVersion}</code> → <code>{finding.resolutionEvidence.reviewedSourceVersion}</code></p>
        <p>Source manifest: <code>{finding.resolutionEvidence.sourceManifestId}</code></p>
        {onOpenReview && <button type="button" className="btn-link" onClick={() => onOpenReview(finding.resolutionEvidence!.reviewId)}>Open review {finding.resolutionEvidence.reviewName}</button>}</section>}
      {finding.lineageHistory?.length ? <section aria-label="Prior finding history"><h4>Prior finding history</h4><ul>{finding.lineageHistory.map(entry => <li key={entry.findingId}>
        {entry.classification === 'regressed' ? 'Regressed' : 'Recurring'} in {entry.reviewName || entry.reviewId}: {entry.title} ({entry.status})
        {entry.sourceVersion && <p>Source version: <code>{entry.sourceVersion}</code></p>}
        {onOpenReview && entry.reviewId && <button type="button" className="btn-link" onClick={() => onOpenReview(entry.reviewId!)}>Open review {entry.reviewName || entry.reviewId}</button>}
      </li>)}</ul></section> : null}
      {actions(finding)}
    </section>)}
  </article>;
}
