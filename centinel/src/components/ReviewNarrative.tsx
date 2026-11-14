import type { FindingLink, ReviewNarrative } from '../reviewNarrative';
import { EvidenceFileLabel } from './EvidenceFileLabel';
import { Eye, LoaderCircle } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { Finding } from '../types';
import { rankFindingEvidence } from '../findingEvidenceRanking';
import { EvidenceFileControl } from './FindingEvidence';

function StageFiles({ files, renderFile }: { files: string[]; renderFile: (path: string) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const remainingId = useId();
  const remaining = files.slice(5);
  return <div className="review-stage-files">
    {files.slice(0, 5).map(renderFile)}
    {remaining.length > 0 && <>
      <span className="review-stage-files-remaining" id={remainingId} hidden={!expanded}>{expanded && remaining.map(renderFile)}</span>
      <button type="button" className="btn-link review-stage-files-toggle" aria-expanded={expanded} aria-controls={remainingId} onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Show fewer files' : `Show ${remaining.length} more ${remaining.length === 1 ? 'file' : 'files'}`}
      </button>
    </>}
  </div>;
}

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
function FindingLinks({ findings, occurrences, onOpenFinding, active }: { findings: FindingLink[]; occurrences: Map<string, Finding>; onOpenFinding: (id: string) => void; active?: boolean }) {
  return findings.length > 0 ? <div className="review-stage-finding-tables">{findings.map(finding => {
    const members = (finding.memberIds ?? [finding.id]).flatMap(id => {
      const occurrence = occurrences.get(id);
      return occurrence ? [occurrence] : [];
    });
    const files = rankFindingEvidence(members, false)[0]?.files ?? [];
    return <section className="finding-feature-evidence review-stage-finding-table" key={finding.id}
      id={`review-finding-${finding.id}`} tabIndex={-1}>
      {members.filter(member => member.id !== finding.id).map(member =>
        <span key={member.id} id={`review-finding-${member.id}`} tabIndex={-1} />)}
      <header><div><h4>{finding.label}</h4><p>{finding.aspect} · {files.length} affected {files.length === 1 ? 'file' : 'files'}</p></div>
        {!active && <button type="button" className="command-icon-button" onClick={() => onOpenFinding(finding.id)} aria-label={`View finding: ${finding.label}`}><Eye size={17} aria-hidden="true" /></button>}
      </header>
      {files.length > 0 && <table aria-label={`${finding.label} evidence`}><tbody>{files.map(file => <tr key={file.path}>
        <td><EvidenceFileControl path={file.path} findings={file.findings} onOpen={active ? undefined : occurrence => onOpenFinding(occurrence.id)} /></td>
        <td>{file.lines > 0 ? `${file.lines} ${file.lines === 1 ? 'line' : 'lines'} highlighted` : 'No lines recorded'}</td>
      </tr>)}</tbody></table>}
    </section>;
  })}</div> : null;
}
export function ReviewNarrativeTimeline({ narrative, findings = [], loading, error, onOpenFinding, resolveSource, liveFindings = [], showIssueEvidence = true }: { narrative: ReviewNarrative; findings?: Finding[]; loading: boolean; error: string | null; onOpenFinding: (id: string) => void; resolveSource?: (path: string) => { path: string; href?: string }; liveFindings?: Array<{ key: string; title: string }>; showIssueEvidence?: boolean }) {
  const visibleStages = narrative.stages.filter(stage => !['Not started', 'Not reached', 'Not recorded'].includes(stage.state) || stage.findings.length > 0);
  const liveItems = liveFindings.length > 0 && <ul className="review-live-findings" aria-label="Findings from validated batches">
    {liveFindings.map(finding => <li key={finding.key} id={`review-finding-${finding.key}`} tabIndex={-1}>{finding.title}</li>)}
  </ul>;
  const occurrences = new Map(findings.map(finding => [finding.id, finding]));
  const fileLabel = (path: string, line?: number) => <EvidenceFileLabel key={path} {...(resolveSource?.(path) ?? { path })} line={line} focusable />;
  return <div className="review-narrative">
    {loading && <p role="status">Loading the saved activity…</p>}
    {error && <p role="status">{error}</p>}
    {!loading && !narrative.detailedHistoryAvailable && <p>{narrative.active && !narrative.stages.length ? 'This review is waiting to start. Its activity will appear here step by step.' : 'Detailed activity is unavailable. Any recorded stage progress appears below.'}</p>}
    {visibleStages.length > 0 && <ol className="review-activity-timeline" aria-label="Review stages">{visibleStages.map(stage => <li key={stage.id} className="review-narrative-stage" aria-current={stage.state === 'In progress' ? 'step' : undefined}>
      <div className="review-stage-heading"><h3>{stage.title}</h3>{stage.state !== 'In progress' && stage.duration !== 'Not recorded' && <span>{stage.duration}</span>}</div>
      {stage.state === 'In progress' ? <>
        {stage.focus && <p className="review-stage-recap">{stage.focus} {stage.goal}</p>}
        {stage.checks?.map(check => <p className="review-stage-check" key={check}>{check}</p>)}
        {stage.features?.map(feature => <div className="review-stage-check" key={feature.id}>
          <p>{feature.summary}</p>
          {feature.path && fileLabel(feature.path, feature.line)}
        </div>)}
        {stage.outcome && <p>{stage.outcome}</p>}
      </> : <p className="review-stage-recap">{stage.recap ?? (stage.outcome || stage.checks?.at(-1) || stage.next)}</p>}
      {stage.files && stage.files.length > 0 && <StageFiles files={stage.files} renderFile={fileLabel} />}
      {showIssueEvidence && <FindingLinks findings={stage.findings} occurrences={occurrences} onOpenFinding={onOpenFinding} active={narrative.active} />}
      {stage.id === 'model_analysis' && liveItems}
      {stage.state === 'In progress' && <p className="review-stage-processing" role="status"><LoaderCircle size={16} aria-hidden="true" /> Processing this stage…</p>}
    </li>)}</ol>}
    {!visibleStages.some(stage => stage.id === 'model_analysis') && liveItems}
    {showIssueEvidence && narrative.unassignedFindings.length > 0 && <section aria-labelledby="review-unassigned-findings"><h3 id="review-unassigned-findings">Other saved findings</h3><p>These findings have no saved stage information.</p><FindingLinks findings={narrative.unassignedFindings} occurrences={occurrences} onOpenFinding={onOpenFinding} active={narrative.active} /></section>}
  </div>;
}
