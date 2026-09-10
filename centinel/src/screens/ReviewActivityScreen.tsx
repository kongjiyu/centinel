import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileCheck2, GitBranch, History, MessageSquare, Paperclip, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { ReviewProgressView } from '../components/ReviewProgressView';
import {
  createReviewActivityViewModel,
  findingStatusLabel,
  formatReviewTimestamp,
  parseReviewConfig,
  parseReviewProgress,
  truncateReviewSourceName,
  type ReviewLifecycleState,
} from '../reviewViewModel';
import type { Finding, Project, ReviewDecisionRecord, Screen, StaticSession } from '../types';
import './ReviewActivityScreen.css';

type Props = {
  projectId: string;
  sessionId: string;
  onNavigate: (screen: Screen) => void;
};

type Tab = 'Overview' | 'Findings' | 'Traceability' | 'History';
type DecisionIntent = 'approved' | 'changes_requested';
type SupportiveDocument = { id: string; name: string };

const TABS: Tab[] = ['Overview', 'Findings', 'Traceability', 'History'];
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

function supportiveDocuments(config: Record<string, unknown>): SupportiveDocument[] {
  if (!Array.isArray(config.supportiveDocuments)) return [];
  return config.supportiveDocuments.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) return [];
    return [{ id: typeof record.id === 'string' ? record.id : `supportive-document-${index}`, name }];
  });
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      resolve(separator >= 0 ? result.slice(separator + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function ReviewActivityScreen({ projectId, sessionId, onNavigate }: Props) {
  const resultTabStorageKey = `centinel:review-result-tab:${projectId}:${sessionId}`;
  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<StaticSession | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecisionRecord[]>([]);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const stored = window.sessionStorage.getItem(resultTabStorageKey) as Tab | null;
      return stored && TABS.includes(stored) ? stored : 'Overview';
    } catch {
      return 'Overview';
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionIntent, setDecisionIntent] = useState<DecisionIntent | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState('');
  const [composerFeedback, setComposerFeedback] = useState('');
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
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

  const embeddedDecision = session?.currentDecision;
  const currentDecision = embeddedDecision && embeddedDecision.decision !== 'commented'
    ? embeddedDecision
    : decisions.find(decision => decision.decision !== 'commented') ?? null;
  const viewModel = session
    ? createReviewActivityViewModel(session, findings, decisions, currentDecision)
    : null;
  const state = viewModel?.state ?? 'In progress';
  const config = session ? parseReviewConfig(session) : {};
  const canDecide = state === 'Pending to Review' && !currentDecision && !submitting;
  const canCancel = Boolean(session && (session.status === 'queued' || session.status === 'running')) && !cancelling;
  const objective = viewModel?.objective ?? null;
  const objectiveDocuments = supportiveDocuments(config);
  const reviewer = currentDecision?.reviewer || (typeof config.reviewer === 'string' && config.reviewer.trim() ? config.reviewer.trim() : null);

  const severityCounts = useMemo(() => SEVERITIES.map(severity => ({
    severity,
    count: findings.filter(finding => finding.severity.toLowerCase() === severity).length,
  })), [findings]);

  const openDecisionPanel = (decision: DecisionIntent) => {
    if (!canDecide) return;
    setDecisionIntent(decision);
    setDecisionFeedback('');
    setError(null);
  };

  const submitDecision = async () => {
    if (!session || !decisionIntent || !canDecide) return;
    if (decisionIntent === 'changes_requested' && !decisionFeedback.trim()) {
      setError('Add feedback before requesting changes to this review.');
      return;
    }
    setSubmitting(decisionIntent);
    setError(null);
    try {
      await api.submitReviewDecision(projectId, session.id, {
        decision: decisionIntent,
        comment: decisionFeedback.trim() || undefined,
      });
      setDecisionIntent(null);
      setDecisionFeedback('');
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(null);
    }
  };

  const sendFeedback = async () => {
    if (!session || sendingFeedback || (!composerFeedback.trim() && composerFiles.length === 0)) return;
    setSendingFeedback(true);
    setFeedbackNotice(null);
    try {
      const attachments = await Promise.all(composerFiles.map(async file => ({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: await fileToBase64(file),
      })));
      await api.submitReviewDecision(projectId, session.id, {
        decision: 'commented',
        comment: composerFeedback.trim(),
        attachments,
      });
      setComposerFeedback('');
      setComposerFiles([]);
      setFeedbackNotice('Feedback added to this review.');
      await load({ silent: true });
    } catch (cause) {
      setFeedbackNotice(`Feedback could not be sent: ${String(cause)}`);
    } finally {
      setSendingFeedback(false);
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
    try { window.sessionStorage.setItem(resultTabStorageKey, next); } catch { /* storage is optional */ }
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

  const activityActions = (
    <section className="review-activity-actions" aria-label="Review decision actions">
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
    </section>
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
          exporting={exporting}
          onExport={() => void exportReport()}
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
          objective={objective}
          supportiveDocuments={objectiveDocuments}
          actions={activityActions}
        />
      )}

      {state !== 'Completed' && (
        <FeedbackComposer
          value={composerFeedback}
          files={composerFiles}
          submitting={sendingFeedback}
          notice={feedbackNotice}
          onChange={setComposerFeedback}
          onFilesChange={setComposerFiles}
          onSubmit={() => void sendFeedback()}
        />
      )}

      {decisionIntent && state === 'Pending to Review' && !currentDecision && (
        <ReviewDecisionPanel
          intent={decisionIntent}
          reviewName={session.name}
          targetLabel={viewModel.targetLabel}
          feedback={decisionFeedback}
          submitting={submitting === decisionIntent}
          onFeedbackChange={setDecisionFeedback}
          onSubmit={() => void submitDecision()}
          onCancel={() => { setDecisionIntent(null); setDecisionFeedback(''); }}
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
  objective,
  supportiveDocuments,
  actions,
}: {
  session: StaticSession;
  state: ReviewLifecycleState;
  findings: Finding[];
  findingsError: string | null;
  decisions: ReviewDecisionRecord[];
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  objective: string | null;
  supportiveDocuments: SupportiveDocument[];
  actions: React.ReactNode;
}) {
  const progress = parseReviewProgress(session.progressJson);
  return (
    <div className="review-activity-body">
      <section className="review-objective" aria-label="Review objective">
        <div className="review-objective-heading"><span>Objective</span><span className="review-objective-scope">Review scope</span></div>
        <p>{objective || 'No objective was persisted for this review.'}</p>
        {supportiveDocuments.length > 0 && (
          <div className="review-source-tags" role="group" aria-label="Supportive documents">
            {supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}
          </div>
        )}
      </section>

      <section className="review-activity-surface" aria-label="Review activity conversation">
      <div className="review-activity-surface-heading">
        <div>
          <span className="command-eyebrow">Centinel activity</span>
          <h2>{state === 'Pending to Review' ? 'Evidence ready for human review' : 'Review activity'}</h2>
          <p>{state === 'Pending to Review'
            ? 'The automated activity is complete. Review candidate findings before recording an activity decision.'
            : 'Stages are shown in order. Each stage summarizes the recorded activity and supporting sources.'}</p>
        </div>
        {progress?.updatedAt && <time dateTime={progress.updatedAt}>Updated {formatReviewTimestamp(progress.updatedAt)}</time>}
      </div>

      <ReviewProgressView progress={progress} />

      {state === 'Blocked' && <div className="review-blocked-message" role="alert"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Review blocked</strong><p>{session.failureReason || 'A required source or service needs attention before processing can continue.'}</p></div></div>}
      {state === 'Failed' && <div className="review-failed-message" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review failed</strong><p>{session.failureReason || 'Centinel could not complete this activity.'}</p></div></div>}
      {state === 'Cancelled' && <div className="review-cancelled-message" role="status"><X size={17} aria-hidden="true" /><div><strong>Review cancelled</strong><p>The activity stopped before a completed result was recorded.</p></div></div>}

      {currentDecision && (
        <div className="review-decision-recorded" role="status">
          <History size={15} aria-hidden="true" />
          <div><strong>{decisionLabel(currentDecision.decision)}</strong><p>{currentDecision.comment || 'No written rationale was supplied.'} This activity decision is recorded separately from finding status; rejection does not automatically reprocess this review.</p></div>
        </div>
      )}

      {decisionsError && <p className="review-history-unavailable" role="status">Decision history could not be loaded. The activity data above remains available.</p>}
      {decisions.length > 0 && <DecisionHistoryPreview decisions={decisions} />}
      {findingsError && <p className="review-history-unavailable" role="status">Candidate findings could not be loaded. Review activity remains available.</p>}
      {findings.length > 0 && <p className="review-activity-findings-note">{findings.length} candidate finding{findings.length === 1 ? '' : 's'} will be available in the completed result.</p>}
      </section>
      {actions}
    </div>
  );
}

function FeedbackComposer({ value, files, submitting, notice, onChange, onFilesChange, onSubmit }: {
  value: string;
  files: File[];
  submitting: boolean;
  notice: string | null;
  onChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onSubmit: () => void;
}) {
  return (
    <aside className="review-feedback-composer" aria-label="Review feedback">
      <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <label className="review-feedback-label" htmlFor="review-feedback-message">Feedback</label>
        <textarea id="review-feedback-message" rows={2} value={value} onChange={event => onChange(event.target.value)} placeholder="Write feedback about this review…" />
        {files.length > 0 && <div className="review-feedback-files" role="group" aria-label="Attached supportive documents">{files.map((file, index) => <span key={`${file.name}-${file.size}-${index}`}><Paperclip size={13} aria-hidden="true" />{truncateReviewSourceName(file.name)}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}><X size={12} aria-hidden="true" /></button></span>)}</div>}
        <div className="review-feedback-controls">
          <label className="review-attach-button" htmlFor="review-feedback-attachments"><Paperclip size={16} aria-hidden="true" />Attach supportive documents</label>
          <input id="review-feedback-attachments" className="visually-hidden" type="file" multiple accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => onFilesChange(Array.from(event.target.files ?? []))} />
          <button className="btn-primary review-feedback-send" type="submit" disabled={submitting || (!value.trim() && files.length === 0)}><Send size={15} aria-hidden="true" />{submitting ? 'Sending…' : 'Send feedback'}</button>
        </div>
        {notice && <p className="review-feedback-notice" role="status">{notice}</p>}
      </form>
    </aside>
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
  exporting,
  onExport,
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
  exporting: boolean;
  onExport: () => void;
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
        {tab === 'Overview' && <ReviewResultOverview session={session} findings={findings} findingsError={findingsError} decisionsError={decisionsError} currentDecision={currentDecision} objective={objective} reviewer={reviewer} severityCounts={severityCounts} exporting={exporting} onExport={onExport} />}
        {tab === 'Findings' && <FindingList findings={findings} error={findingsError} />}
        {tab === 'Traceability' && <Traceability findings={findings} />}
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
  exporting,
  onExport,
}: {
  session: StaticSession;
  findings: Finding[];
  findingsError: string | null;
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  objective: string | null;
  reviewer: string | null;
  severityCounts: { severity: string; count: number }[];
  exporting: boolean;
  onExport: () => void;
}) {
  return (
    <div className="review-overview-grid">
      <section className="review-overview-main">
        <div className="review-overview-copy"><div className="review-overview-heading"><h2>Completion summary</h2><button className="btn-secondary" type="button" onClick={onExport} disabled={exporting}><Download size={15} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export review report'}</button></div><p>{session.finalSummary || 'The automated activity completed and the review was approved by a human reviewer.'}</p><p className="review-evidence-limit">The available result contains session findings and activity history. Structured traceability, immutable snapshot metadata, and per-finding adjudication were not supplied by the current service.</p></div>
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
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const orderedFindings = [...findings].sort((left, right) => {
    const severityDifference = (severityRank[left.severity.toLowerCase()] ?? 4) - (severityRank[right.severity.toLowerCase()] ?? 4);
    if (severityDifference !== 0) return severityDifference;
    return Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt);
  });
  return (
    <section className="review-finding-list" aria-labelledby="result-findings-heading">
      <div className="review-section-heading"><div><h2 id="result-findings-heading">Findings</h2><p>Reported observations remain separate from the activity decision.</p></div><span>{findings.length} reported</span></div>
      <div className="review-result-table-wrap">
        <table className="review-result-findings-table">
          <caption className="visually-hidden">Review findings</caption>
          <thead><tr><th scope="col">Priority</th><th scope="col">Severity</th><th scope="col">Description</th><th scope="col">Status</th></tr></thead>
          <tbody>{orderedFindings.map(finding => {
            return <tr key={finding.id}>
              <td>{finding.priority || 'Not set'}</td>
              <td><StatusBadge label={severityLabel(finding.severity)} /></td>
              <td><div className="review-result-finding-description"><strong>{finding.title}</strong><span>{finding.description || 'No description was supplied.'}</span></div><details className="review-result-finding-details"><summary>View evidence</summary><div className="review-result-finding-detail-body"><FindingEvidence finding={finding} hasEvidence={Boolean(finding.evidenceText || finding.filePath)} /></div></details></td>
              <td><span className="review-finding-state">{findingStatusLabel(finding.status)}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function Traceability({ findings }: { findings: Finding[] }) {
  return <section className="review-traceability"><div className="review-section-heading"><div><h2>Traceability</h2><p>Structured requirement relationships are not supplied by this review service.</p></div></div><div className="review-traceability-empty" role="status"><FileCheck2 size={22} aria-hidden="true" /><span>Traceability is unavailable for this result. Findings and source evidence remain available in the Findings tab.</span></div></section>;
}

function HistoryPanel({ progress, decisions, error }: { progress: string; decisions: ReviewDecisionRecord[]; error: string | null }) {
  return <section className="review-history"><div className="review-section-heading"><div><h2>History</h2><p>Automated activity and human decisions are shown in separate columns.</p></div></div><div className="review-history-columns"><div><h3>System activity</h3><ReviewProgressView progress={parseReviewProgress(progress)} /></div><div className="review-human-history"><h3>Human decisions</h3>{error ? <p className="review-history-unavailable">Decision history could not be loaded.</p> : decisions.length === 0 ? <p className="review-activity-empty">No human decision has been recorded.</p> : decisions.map(decision => <DecisionRecord key={decision.id} decision={decision} />)}</div></div></section>;
}

function DecisionRecord({ decision }: { decision: ReviewDecisionRecord }) {
  return <article className="review-human-history-record"><MessageSquare size={14} aria-hidden="true" /><div><strong>{decisionLabel(decision.decision)}</strong><p>{decision.comment || 'No written rationale was supplied.'}</p>{decision.attachments && decision.attachments.length > 0 && <div className="review-source-tags" role="group" aria-label="Feedback attachments">{decision.attachments.map(attachment => <span className="review-source-tag" key={attachment.id} title={attachment.fileName} aria-label={attachment.fileName}>{truncateReviewSourceName(attachment.fileName)}</span>)}</div>}<span>{decision.reviewer || 'Reviewer not supplied'} · {formatReviewTimestamp(decision.createdAt) || 'Time not supplied'}</span></div></article>;
}
