import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Download, FileCheck2, GitBranch, History, MessageSquare, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { ReviewProgressView } from '../components/ReviewProgressView';
import {
  createReviewActivityViewModel,
  findingStatusLabel,
  formatReviewTimestamp,
  parseReviewConfig,
  parseReviewProgress,
  type ReviewLifecycleState,
} from '../reviewViewModel';
import type { Finding, Project, ReviewDecisionRecord, Screen, StaticSession } from '../types';
import './ReviewActivityScreen.css';

type Props = {
  projectId: string;
  sessionId: string;
  onNavigate: (screen: Screen) => void;
};

type Tab = 'Overview' | 'Findings' | 'Traceability' | 'Risk Assessment' | 'History';
type DecisionIntent = 'approved' | 'changes_requested';

const TABS: Tab[] = ['Overview', 'Findings', 'Traceability', 'Risk Assessment', 'History'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function stateTone(state: ReviewLifecycleState): 'neutral' | 'running' | 'success' | 'warning' | 'danger' {
  if (state === 'Completed') return 'success';
  if (state === 'In progress') return 'running';
  if (state === 'Pending to Review' || state === 'Blocked') return 'warning';
  if (state === 'Failed') return 'danger';
  return 'neutral';
}

function severityLabel(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : 'Unrated';
}

function decisionLabel(decision: ReviewDecisionRecord['decision']): string {
  if (decision === 'approved') return 'Approved review';
  if (decision === 'changes_requested') return 'Changes requested';
  return 'Comment';
}

export function ReviewActivityScreen({ projectId, sessionId, onNavigate }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecisionRecord[]>([]);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionIntent, setDecisionIntent] = useState<DecisionIntent | null>(null);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState<DecisionIntent | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement>>>({});

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [projectResult, sessionResult] = await Promise.all([
        api.project(projectId),
        api.getStaticSession(projectId, sessionId),
      ]);
      setProject(projectResult);
      setSession(sessionResult);

      try {
        setFindings(await api.listStaticFindings(projectId, sessionId));
        setFindingsError(null);
      } catch (cause) {
        setFindings([]);
        setFindingsError(String(cause));
      }

      try {
        setDecisions(await api.listReviewDecisions(projectId, sessionId));
        setDecisionsError(null);
      } catch (cause) {
        setDecisions([]);
        setDecisionsError(String(cause));
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId, sessionId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!session || (session.status !== 'queued' && session.status !== 'running')) return undefined;
    const interval = window.setInterval(() => { void load({ silent: true }); }, 1500);
    return () => window.clearInterval(interval);
  }, [load, session?.status]);

  const currentDecision = session?.currentDecision ?? decisions[0] ?? null;
  const viewModel = session
    ? createReviewActivityViewModel(session, findings, decisions, currentDecision)
    : null;
  const state = viewModel?.state ?? 'In progress';
  const config = session ? parseReviewConfig(session) : {};
  const canDecide = state === 'Pending to Review' && !currentDecision && !submitting;
  const canCancel = Boolean(session && (session.status === 'queued' || session.status === 'running')) && !cancelling;
  const objective = viewModel?.objective ?? null;
  const reviewer = currentDecision?.reviewer || (typeof config.reviewer === 'string' && config.reviewer.trim() ? config.reviewer.trim() : null);

  const severityCounts = useMemo(() => SEVERITIES.map(severity => ({
    severity,
    count: findings.filter(finding => finding.severity.toLowerCase() === severity).length,
  })), [findings]);

  const openDecisionPanel = (decision: DecisionIntent) => {
    if (!canDecide) return;
    setDecisionIntent(decision);
    setFeedback('');
    setError(null);
  };

  const submitDecision = async () => {
    if (!session || !decisionIntent || !canDecide) return;
    if (decisionIntent === 'changes_requested' && !feedback.trim()) {
      setError('Add feedback before requesting changes to this review.');
      return;
    }
    setSubmitting(decisionIntent);
    setError(null);
    try {
      await api.submitReviewDecision(projectId, session.id, {
        decision: decisionIntent,
        comment: feedback.trim() || undefined,
      });
      setDecisionIntent(null);
      setFeedback('');
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(null);
    }
  };

  const cancelReview = async () => {
    if (!session || !canCancel) return;
    setCancelling(true);
    setError(null);
    try {
      await api.cancelStaticSession(projectId, session.id);
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setCancelling(false);
    }
  };

  const exportReport = async () => {
    if (!session || exporting) return;
    setExporting(true);
    setExportNotice(null);
    try {
      const result = await api.exportSessionReport(projectId, session.id);
      setExportNotice({ tone: 'success', text: `Report saved to ${result.reportPath}` });
    } catch (cause) {
      setExportNotice({ tone: 'danger', text: `Export failed: ${String(cause)}` });
    } finally {
      setExporting(false);
    }
  };

  const changeTab = (next: Tab, focus = false) => {
    setTab(next);
    if (focus) window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const index = TABS.indexOf(current);
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex !== index) {
      event.preventDefault();
      changeTab(TABS[nextIndex], true);
    }
  };

  if (loading) return <div className="screen review-activity-screen"><p className="command-loading" role="status">Loading review activity…</p></div>;
  if (!session || !viewModel) return <div className="screen review-activity-screen"><div className="command-inline-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /> {error || 'Review activity could not be loaded.'}</div></div>;

  const actionArea = (
    <div className="review-activity-actions" aria-label="Review actions">
      {canCancel && (
        <button className="btn-secondary" type="button" onClick={() => void cancelReview()} disabled={!canCancel}>
          <X size={15} aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel review'}
        </button>
      )}
      {state === 'Pending to Review' && !currentDecision && (
        <>
          <button data-testid="review-decision-reject" className="btn-secondary review-reject-button" type="button" onClick={() => openDecisionPanel('changes_requested')} disabled={!canDecide}>
            <MessageSquare size={15} aria-hidden="true" /> Request changes
          </button>
          <button data-testid="review-decision-approve" className="btn-primary" type="button" onClick={() => openDecisionPanel('approved')} disabled={!canDecide}>
            <CheckCircle2 size={15} aria-hidden="true" /> Approve review
          </button>
        </>
      )}
      {state === 'Completed' && (
        <button className="btn-primary" type="button" onClick={() => void exportReport()} disabled={exporting}>
          <Download size={15} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export review report'}
        </button>
      )}
    </div>
  );

  return (
    <div className="screen command-review-activity review-activity-screen">
      <CommandPageHeader
        eyebrow={`Review / ${project?.name || 'Project'}`}
        title={session.name}
        description={state === 'Completed'
          ? 'Review completed from the recorded project scope. Findings remain separate from the activity decision.'
          : state === 'Pending to Review'
            ? 'Inspect the evidence and record one activity-level decision when you are ready.'
            : 'Follow the evidence-led activity conversation as Centinel processes the project sources.'}
        status={{ label: state, tone: stateTone(state) }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        actions={actionArea}
        meta={(
          <span className="review-activity-meta">
            <GitBranch size={13} aria-hidden="true" />
            <span>Scope</span>
            <span className="mono">{viewModel.targetLabel}</span>
            {session.baseRef && session.headRef && <span className="review-meta-note">Manual refs; immutable snapshot not supplied</span>}
          </span>
        )}
      />

      {error && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {error}</div>}
      {exportNotice && <div className={`review-export-notice review-export-notice-${exportNotice.tone}`} role={exportNotice.tone === 'danger' ? 'alert' : 'status'}><span>{exportNotice.text}</span><button type="button" aria-label="Dismiss export message" onClick={() => setExportNotice(null)}>Dismiss</button></div>}

      {state === 'Completed' ? (
        <ReviewResult
          session={session}
          findings={findings}
          findingsError={findingsError}
          decisions={decisions}
          decisionsError={decisionsError}
          currentDecision={currentDecision}
          objective={objective}
          reviewer={reviewer}
          severityCounts={severityCounts}
          tab={tab}
          onTabChange={changeTab}
          onTabKeyDown={handleTabKeyDown}
          tabRefs={tabRefs}
        />
      ) : (
        <ReviewActivityContent
          session={session}
          state={state}
          findings={findings}
          findingsError={findingsError}
          decisions={decisions}
          decisionsError={decisionsError}
          currentDecision={currentDecision}
        />
      )}

      {decisionIntent && state === 'Pending to Review' && !currentDecision && (
        <ReviewDecisionPanel
          intent={decisionIntent}
          reviewName={session.name}
          targetLabel={viewModel.targetLabel}
          feedback={feedback}
          submitting={submitting === decisionIntent}
          onFeedbackChange={setFeedback}
          onSubmit={() => void submitDecision()}
          onCancel={() => { setDecisionIntent(null); setFeedback(''); }}
        />
      )}
    </div>
  );
}

function ReviewActivityContent({
  session,
  state,
  findings,
  findingsError,
  decisions,
  decisionsError,
  currentDecision,
}: {
  session: StaticSession;
  state: ReviewLifecycleState;
  findings: Finding[];
  findingsError: string | null;
  decisions: ReviewDecisionRecord[];
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
}) {
  const progress = parseReviewProgress(session.progressJson);
  return (
    <section className="review-activity-surface" aria-label="Review activity conversation">
      <div className="review-activity-surface-heading">
        <div>
          <span className="command-eyebrow">Centinel activity</span>
          <h2>{state === 'Pending to Review' ? 'Evidence ready for human review' : 'Review activity'}</h2>
          <p>{state === 'Pending to Review'
            ? 'The automated activity is complete. Review candidate findings before recording an activity decision.'
            : 'Stages are shown in order. Activity details are collapsed until you need the supporting record.'}</p>
        </div>
        {progress?.updatedAt && <time dateTime={progress.updatedAt}>Updated {formatReviewTimestamp(progress.updatedAt)}</time>}
      </div>

      <ReviewProgressView progress={progress} />

      {state === 'Blocked' && <div className="review-blocked-message" role="alert"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Review blocked</strong><p>{session.failureReason || 'A required source or service needs attention before processing can continue.'}</p></div></div>}
      {state === 'Failed' && <div className="review-failed-message" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review failed</strong><p>{session.failureReason || 'Centinel could not complete this activity.'}</p></div></div>}
      {state === 'Cancelled' && <div className="review-cancelled-message" role="status"><X size={17} aria-hidden="true" /><div><strong>Review cancelled</strong><p>The activity stopped before a completed result was recorded.</p></div></div>}

      <CandidateFindingList findings={findings} error={findingsError} />

      {currentDecision && (
        <div className="review-decision-recorded" role="status">
          <History size={15} aria-hidden="true" />
          <div><strong>{decisionLabel(currentDecision.decision)}</strong><p>{currentDecision.comment || 'No written rationale was supplied.'} This activity decision is recorded separately from finding status; rejection does not automatically reprocess this review.</p></div>
        </div>
      )}

      {decisionsError && <p className="review-history-unavailable" role="status">Decision history could not be loaded. The activity data above remains available.</p>}
      {decisions.length > 0 && <DecisionHistoryPreview decisions={decisions} />}
    </section>
  );
}

function CandidateFindingList({ findings, error }: { findings: Finding[]; error: string | null }) {
  return (
    <section className="review-candidate-section" aria-labelledby="candidate-findings-heading">
      <div className="review-section-heading">
        <div>
          <h2 id="candidate-findings-heading">Candidate findings</h2>
          <p>Automated observations remain candidates until a supported adjudication workflow exists.</p>
        </div>
        {!error && <span>{findings.length} returned</span>}
      </div>
      {error ? (
        <p className="review-history-unavailable" role="status">Candidate findings could not be loaded for this activity.</p>
      ) : findings.length === 0 ? (
        <p className="review-activity-empty">No candidate findings are available for this activity.</p>
      ) : (
        <div className="review-candidate-list">{findings.map(finding => <CandidateFindingCard key={finding.id} finding={finding} />)}</div>
      )}
    </section>
  );
}

function CandidateFindingCard({ finding }: { finding: Finding }) {
  const location = finding.filePath ? `${finding.filePath}${finding.lineNumber == null ? '' : `:${finding.lineNumber}`}` : null;
  const hasEvidence = Boolean(finding.evidenceText || location);
  return (
    <article className="review-candidate-card">
      <div className="review-candidate-card-main">
        <div className="review-candidate-card-labels"><span className="review-candidate-label">Candidate finding</span><StatusBadge label={severityLabel(finding.severity)} /><span className="review-finding-state">Finding status: {findingStatusLabel(finding.status)}</span></div>
        <h3>{finding.title}</h3>
        <p>{finding.description || finding.recommendation || 'No description was supplied.'}</p>
        {finding.category && <span className="review-finding-category">{finding.category}</span>}
        {location && <span className="review-finding-location mono">{location}</span>}
      </div>
      <details className="review-candidate-details">
        <summary><ChevronRight size={14} aria-hidden="true" /><span>View full evidence</span></summary>
        <FindingEvidence finding={finding} hasEvidence={hasEvidence} />
      </details>
    </article>
  );
}

function FindingEvidence({ finding, hasEvidence }: { finding: Finding; hasEvidence: boolean }) {
  return (
    <div className="review-finding-evidence">
      <section><h4>Finding description</h4><p>{finding.description || 'Not supplied.'}</p></section>
      <section><h4>Evidence examined</h4><p>{hasEvidence ? (finding.evidenceText || finding.filePath || 'Location evidence supplied.') : 'Evidence was not supplied by the service.'}</p></section>
      <section><h4>Recommendation</h4><p>{finding.recommendation || 'Not supplied.'}</p></section>
      {finding.confidence && <section><h4>Confidence and provenance</h4><p>{finding.confidence} · {finding.source === 'static' ? 'Review source' : 'Dynamic source'}</p></section>}
    </div>
  );
}

function DecisionHistoryPreview({ decisions }: { decisions: ReviewDecisionRecord[] }) {
  return (
    <section className="review-decision-history-preview" aria-labelledby="activity-history-heading">
      <div className="review-section-heading"><div><h2 id="activity-history-heading">Human decision history</h2><p>Human feedback is kept separate from the automated activity log.</p></div></div>
      {decisions.slice(0, 3).map(decision => <DecisionRecord key={decision.id} decision={decision} />)}
    </section>
  );
}

function ReviewDecisionPanel({
  intent,
  reviewName,
  targetLabel,
  feedback,
  submitting,
  onFeedbackChange,
  onSubmit,
  onCancel,
}: {
  intent: DecisionIntent;
  reviewName: string;
  targetLabel: string;
  feedback: string;
  submitting: boolean;
  onFeedbackChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const isReject = intent === 'changes_requested';
  return (
    <aside className="review-decision-panel" aria-labelledby="review-decision-panel-heading">
      <div className="review-decision-panel-inner">
        <div className="review-decision-panel-heading">
          <div>
            <span className="command-eyebrow">Human decision</span>
            <h2 id="review-decision-panel-heading">{isReject ? 'Request changes' : 'Approve review'}</h2>
            <p><strong>{reviewName}</strong> · <span className="mono">{targetLabel}</span></p>
          </div>
          <button className="command-icon-button" type="button" onClick={onCancel} aria-label="Close decision panel"><X size={16} aria-hidden="true" /></button>
        </div>
        <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
          <label htmlFor="review-decision-feedback">{isReject ? 'Feedback' : 'Decision rationale'} <span className="field-optional">{isReject ? '*' : 'Optional'}</span></label>
          <textarea
            id="review-decision-feedback"
            value={feedback}
            onChange={event => onFeedbackChange(event.target.value)}
            placeholder={isReject ? 'Explain what needs refinement before this review can be approved.' : 'Record why this review is approved, if useful for the audit trail.'}
            required={isReject}
            rows={4}
            autoFocus
          />
          <p className="review-decision-panel-note">This records an activity-level decision. It does not resolve, dismiss, or automatically reprocess individual findings.</p>
          <div className="review-decision-panel-actions">
            <button className="btn-secondary" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button className={isReject ? 'btn-danger' : 'btn-primary'} type="submit" disabled={submitting}>
              {submitting ? (isReject ? 'Requesting…' : 'Approving…') : (isReject ? 'Request changes' : 'Approve review')}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}

function ReviewResult({
  session,
  findings,
  findingsError,
  decisions,
  decisionsError,
  currentDecision,
  objective,
  reviewer,
  severityCounts,
  tab,
  onTabChange,
  onTabKeyDown,
  tabRefs,
}: {
  session: StaticSession;
  findings: Finding[];
  findingsError: string | null;
  decisions: ReviewDecisionRecord[];
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  objective: string | null;
  reviewer: string | null;
  severityCounts: { severity: string; count: number }[];
  tab: Tab;
  onTabChange: (tab: Tab, focus?: boolean) => void;
  onTabKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, tab: Tab) => void;
  tabRefs: React.MutableRefObject<Partial<Record<Tab, HTMLButtonElement>>>;
}) {
  const panelId = `review-result-panel-${tab.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="review-result-surface" aria-label="Completed review result">
      <div className="review-completion-summary">
        <div className="review-completion-icon"><CheckCircle2 size={22} aria-hidden="true" /></div>
        <div><span className="command-eyebrow">Completed result</span><h2>Review completed</h2><p>The recorded review covers <strong className="mono">{session.baseRef && session.headRef ? `${session.baseRef} → ${session.headRef}` : 'the full project scope'}</strong>. The result describes the available evidence; it is not a whole-product pass or fail.</p></div>
      </div>

      <nav className="review-result-tabs" role="tablist" aria-label="Completed review sections">
        {TABS.map(item => (
          <button
            key={item}
            id={`review-result-tab-${item.toLowerCase().replace(/\s+/g, '-')}`}
            role="tab"
            aria-selected={tab === item}
            aria-controls={`review-result-panel-${item.toLowerCase().replace(/\s+/g, '-')}`}
            tabIndex={tab === item ? 0 : -1}
            ref={element => { if (element) tabRefs.current[item] = element; }}
            type="button"
            onClick={() => onTabChange(item)}
            onKeyDown={event => onTabKeyDown(event, item)}
          >{item}</button>
        ))}
      </nav>

      <div id={panelId} role="tabpanel" tabIndex={0} aria-labelledby={`review-result-tab-${tab.toLowerCase().replace(/\s+/g, '-')}`} className="review-result-panel">
        {tab === 'Overview' && <ReviewResultOverview session={session} findings={findings} findingsError={findingsError} decisionsError={decisionsError} currentDecision={currentDecision} objective={objective} reviewer={reviewer} severityCounts={severityCounts} />}
        {tab === 'Findings' && <FindingList findings={findings} error={findingsError} />}
        {tab === 'Traceability' && <Traceability findings={findings} />}
        {tab === 'Risk Assessment' && <RiskAssessment findings={findings} />}
        {tab === 'History' && <HistoryPanel progress={session.progressJson} decisions={decisions} error={decisionsError} />}
      </div>
    </section>
  );
}

function ReviewResultOverview({
  session,
  findings,
  findingsError,
  decisionsError,
  currentDecision,
  objective,
  reviewer,
  severityCounts,
}: {
  session: StaticSession;
  findings: Finding[];
  findingsError: string | null;
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  objective: string | null;
  reviewer: string | null;
  severityCounts: { severity: string; count: number }[];
}) {
  return (
    <div className="review-overview-grid">
      <section className="review-overview-main">
        <div className="review-overview-copy"><h2>Completion summary</h2><p>{session.finalSummary || 'The automated activity completed and the review was approved by a human reviewer.'}</p><p className="review-evidence-limit">The available result contains session findings and activity history. Structured traceability, risk dimensions, immutable snapshot metadata, and per-finding adjudication were not supplied by the current service.</p></div>
        {!findingsError && <div className="review-severity-grid" aria-label="Reported findings by severity"><div className="review-severity-total"><strong>{findings.length}</strong><span>Reported findings</span></div>{severityCounts.map(item => <div key={item.severity}><strong>{item.count}</strong><span>{severityLabel(item.severity)} severity</span></div>)}</div>}
        {findingsError && <p className="review-history-unavailable" role="status">Finding totals could not be loaded for this result.</p>}
        <div className="review-overview-copy"><h2>Review objective</h2><p>{objective || 'No objective was persisted for this review.'}</p></div>
      </section>
      <aside className="review-overview-rail"><h2>Review decision</h2><dl><div><dt>Decision</dt><dd>{currentDecision ? decisionLabel(currentDecision.decision) : 'Not supplied'}</dd></div><div><dt>Reviewer</dt><dd>{reviewer || 'Not supplied'}</dd></div><div><dt>Scope</dt><dd className="mono">{session.baseRef && session.headRef ? `${session.baseRef} → ${session.headRef}` : 'Full project scope'}</dd></div><div><dt>Completed</dt><dd>{currentDecision ? formatReviewTimestamp(currentDecision.createdAt) : 'Not supplied'}</dd></div></dl>{currentDecision?.comment && <div className="review-final-rationale"><h3>Decision rationale</h3><p>{currentDecision.comment}</p></div>}{decisionsError && <p className="review-history-unavailable">Decision history could not be loaded.</p>}</aside>
    </div>
  );
}

function FindingList({ findings, error }: { findings: Finding[]; error: string | null }) {
  if (error) return <p className="review-history-unavailable" role="status">Findings could not be loaded for this result.</p>;
  if (findings.length === 0) return <div className="command-empty-state"><FileCheck2 size={30} aria-hidden="true" /><h2>No reported findings</h2><p>The completed review did not return any findings.</p></div>;
  return <section className="review-finding-list"><div className="review-section-heading"><div><h2>Candidate findings</h2><p>These remain separate from the approved activity decision.</p></div><span>{findings.length} reported</span></div>{findings.map(finding => <CandidateFindingCard key={finding.id} finding={finding} />)}</section>;
}

function Traceability({ findings }: { findings: Finding[] }) {
  return <section className="review-traceability"><div className="review-section-heading"><div><h2>Traceability</h2><p>Current service data does not include structured requirement relationships; these rows are evidence-limited.</p></div></div>{findings.map(finding => <div key={finding.id} className="traceability-row"><span className="review-traceability-state">Evidence limited</span><span>{finding.title}</span><span className="mono">{finding.filePath || 'Implementation location not supplied'}</span></div>)}{findings.length === 0 && <p className="review-activity-empty">No traceability evidence is available for this review.</p>}</section>;
}

function RiskAssessment({ findings }: { findings: Finding[] }) {
  return <section className="review-risk"><div className="review-section-heading"><div><h2>Reported findings by severity</h2><p>Severity describes reported impact. Fix priority is shown only when the service supplies it.</p></div></div>{findings.map(finding => <div key={finding.id} className="risk-row"><div><span className="mono">{finding.id}</span><h3>{finding.title}</h3></div><div className="risk-values"><span><small>Severity</small>{severityLabel(finding.severity)}</span><span><small>Fix priority</small>{finding.priority ? severityLabel(finding.priority) : 'Not supplied'}</span></div></div>)}{findings.length === 0 && <p className="review-activity-empty">No findings require a severity summary.</p>}</section>;
}

function HistoryPanel({ progress, decisions, error }: { progress: string; decisions: ReviewDecisionRecord[]; error: string | null }) {
  return <section className="review-history"><div className="review-section-heading"><div><h2>History</h2><p>Automated activity and human decisions are shown in separate columns.</p></div></div><div className="review-history-columns"><div><h3>System activity</h3><ReviewProgressView progress={parseReviewProgress(progress)} /></div><div className="review-human-history"><h3>Human decisions</h3>{error ? <p className="review-history-unavailable">Decision history could not be loaded.</p> : decisions.length === 0 ? <p className="review-activity-empty">No human decision has been recorded.</p> : decisions.map(decision => <DecisionRecord key={decision.id} decision={decision} />)}</div></div></section>;
}

function DecisionRecord({ decision }: { decision: ReviewDecisionRecord }) {
  return <article className="review-human-history-record"><MessageSquare size={14} aria-hidden="true" /><div><strong>{decisionLabel(decision.decision)}</strong><p>{decision.comment || 'No written rationale was supplied.'}</p><span>{decision.reviewer || 'Reviewer not supplied'} · {formatReviewTimestamp(decision.createdAt) || 'Time not supplied'}</span></div></article>;
}
