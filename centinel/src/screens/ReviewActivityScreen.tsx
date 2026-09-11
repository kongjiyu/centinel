import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Expand, FileCheck2, History, MessageSquare, Paperclip, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { ReviewProgressView } from '../components/ReviewProgressView';
import { FindingsPanel } from '../components/FindingsPanel';
import { Modal } from '../components/Modal';
import {
  createReviewActivityViewModel,
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

type Tab = 'Activity' | 'Overview' | 'Findings' | 'Traceability';
type DecisionIntent = 'approved' | 'changes_requested';
type SupportiveDocument = { id: string; name: string };

const REVIEW_DETAIL_TABS: Tab[] = ['Overview', 'Findings', 'Traceability', 'Activity'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function stateTone(state: ReviewLifecycleState): 'neutral' | 'running' | 'success' | 'warning' | 'danger' {
  if (state === 'Completed') return 'success';
  if (state === 'In progress' || state === 'Queued') return 'running';
  if (state === 'Need Approval' || state === 'Blocked') return 'warning';
  if (state === 'Failed') return 'danger';
  return 'neutral';
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
      return stored && REVIEW_DETAIL_TABS.includes(stored) ? stored : 'Overview';
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
  const canDecide = state === 'Need Approval' && !currentDecision && !submitting && !findingsError;
  const canCancel = Boolean(session && (session.status === 'queued' || session.status === 'running')) && !cancelling;
  const objective = viewModel?.objective ?? null;
  const objectiveDocuments = supportiveDocuments(config);
  const reviewer = currentDecision?.reviewer || (typeof config.reviewer === 'string' && config.reviewer.trim() ? config.reviewer.trim() : null);
  const handleFindingsLoadState = useCallback((nextFindings: Finding[], nextError: string | null) => {
    setFindings(nextFindings);
    setFindingsError(nextError);
  }, []);

  const availableTabs = REVIEW_DETAIL_TABS;

  useEffect(() => {
    if (!availableTabs.includes(tab)) changeTab(availableTabs[0]);
  // `changeTab` is intentionally stable for this small state correction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (session && (state === 'In progress' || state === 'Queued')) changeTab('Activity');
  // New and active runs always open on their live activity view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state]);

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
      if (decisionIntent === 'changes_requested') changeTab('Activity');
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
      setFeedbackNotice(`Feedback could not be sent. Your draft and attachments are still here; check the file type or size and try again. ${String(cause)}`);
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

  const changeTab = (next: Tab, focus = false) => {
    setTab(next);
    try { window.sessionStorage.setItem(resultTabStorageKey, next); } catch { /* storage is optional */ }
    if (focus) window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const tabs = REVIEW_DETAIL_TABS;
    const index = tabs.indexOf(current);
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex !== index) {
      event.preventDefault();
      changeTab(tabs[nextIndex], true);
    }
  };

  if (loading) return <div className="screen review-activity-screen"><p className="command-loading" role="status">Loading review activity…</p></div>;
  if (!session || !viewModel) return <div className="screen review-activity-screen"><div className="command-inline-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /> {error || 'Review activity could not be loaded.'}</div></div>;

  const headerActions = (
    <section className="review-activity-actions" aria-label="Review decision actions">
      {state === 'Need Approval' && !currentDecision && (
        <>
          <button data-testid="review-decision-reject" className="btn-secondary review-reject-button" type="button" onClick={() => openDecisionPanel('changes_requested')} disabled={!canDecide}>
            <MessageSquare size={15} aria-hidden="true" /> Request changes
          </button>
          <button data-testid="review-decision-approve" className="btn-primary" type="button" onClick={() => openDecisionPanel('approved')} disabled={!canDecide}>
            <CheckCircle2 size={15} aria-hidden="true" /> Approve review
          </button>
        </>
      )}
    </section>
  );

  return (
    <div className="screen command-review-activity review-activity-screen">
      <CommandPageHeader
        eyebrow={`Review / ${project?.name || 'Project'}`}
        title={session.name}
        status={{ label: state, tone: stateTone(state) }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        actions={state === 'Need Approval' && !currentDecision ? headerActions : state === 'Failed' ? <button type="button" className="btn-primary" onClick={() => onNavigate({ name: 'review-entry', projectId })}><History size={16} aria-hidden="true" /> Rerun review</button> : undefined}
      />

      {error && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {error}</div>}
      <ReviewTabs tabs={REVIEW_DETAIL_TABS} tab={tab} onTabChange={changeTab} onTabKeyDown={handleTabKeyDown} tabRefs={tabRefs} label="Review detail sections" />

      {tab === 'Activity' ? (
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
        />
      ) : (
        <ReviewResult
          session={session}
          state={state}
          findings={findings}
          findingsError={findingsError}
          decisions={decisions}
          decisionsError={decisionsError}
          currentDecision={currentDecision}
          reviewer={reviewer}
          severityCounts={severityCounts}
          tab={tab}
          onTabChange={changeTab}
          onTabKeyDown={handleTabKeyDown}
          tabRefs={tabRefs}
          onFindingsLoadState={handleFindingsLoadState}
        />
      )}

      {canCancel && (
        <div className="review-decision-dock">
          <button className="btn-secondary" type="button" onClick={() => void cancelReview()} disabled={!canCancel}>
            <X size={15} aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel review'}
          </button>
        </div>
      )}

      {state === 'Need Approval' && tab === 'Activity' && (
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

      {decisionIntent && state === 'Need Approval' && !currentDecision && (
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

function ReviewTabs({
  tabs,
  tab,
  onTabChange,
  onTabKeyDown,
  tabRefs,
  label,
}: {
  tabs: Tab[];
  tab: Tab;
  onTabChange: (tab: Tab, focus?: boolean) => void;
  onTabKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, tab: Tab) => void;
  tabRefs: React.MutableRefObject<Partial<Record<Tab, HTMLButtonElement>>>;
  label: string;
}) {
  return (
    <nav className="review-result-tabs review-activity-tabs" role="tablist" aria-label={label}>
      {tabs.map(item => (
        <button
          key={item}
          id={`review-result-tab-${item.toLowerCase()}`}
          role="tab"
          aria-selected={tab === item}
          tabIndex={tab === item ? 0 : -1}
          ref={element => { if (element) tabRefs.current[item] = element; }}
          type="button"
          onClick={() => onTabChange(item)}
          onKeyDown={event => onTabKeyDown(event, item)}
        >{item}</button>
      ))}
    </nav>
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
}) {
  const progress = parseReviewProgress(session.progressJson);
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);
  const objectiveText = objective || 'No objective was persisted for this review.';
  const objectiveNeedsDisclosure = objectiveText.length > 280;
  return (
    <div className="review-activity-body">
      <section className="review-activity-surface" aria-label="Review activity conversation">
        <div className="review-activity-surface-heading">
          <h2>{state === 'Need Approval' ? 'Review activity' : 'Review activity'}</h2>
        </div>
        <ReviewProgressView progress={progress} />
        {state === 'Blocked' && <div className="review-blocked-message" role="alert"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Review needs attention</strong><p>{session.failureReason || 'A required source or service needs attention before processing can continue.'}</p></div></div>}
        {state === 'Failed' && <div className="review-failed-message" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review failed</strong><p>{session.failureReason || 'Centinel could not complete this activity.'}</p></div></div>}
        {state === 'Cancelled' && <div className="review-cancelled-message" role="status"><X size={17} aria-hidden="true" /><div><strong>Review cancelled</strong><p>The activity stopped before a completed result was recorded.</p></div></div>}
        {currentDecision && (
          <div className="review-decision-recorded" role="status">
            <History size={15} aria-hidden="true" />
            <div><strong>{decisionLabel(currentDecision.decision)}</strong><p>{currentDecision.comment || 'No written rationale was supplied.'} This activity decision is recorded separately from finding status; request changes does not automatically reprocess this review.</p></div>
          </div>
        )}
        {decisionsError && <p className="review-history-unavailable" role="status">Decision history could not be loaded. The activity data above remains available.</p>}
        {decisions.length > 0 && <DecisionHistoryPreview decisions={decisions} />}
        {findingsError && <p className="review-history-unavailable" role="status">Findings could not be loaded. Decisions are disabled until the evidence can be reloaded.</p>}
      </section>
      <aside className="review-objective" aria-label="Review information">
        <div className="review-objective-heading"><h2>Information</h2>{objectiveNeedsDisclosure && <button type="button" className="command-icon-button" aria-label="Expand review objective" title="Expand review objective" aria-expanded={objectiveExpanded} onClick={() => setObjectiveExpanded(true)}><Expand size={16} aria-hidden="true" /></button>}</div>
        <ReviewInformation session={session} objective={objectiveText} />
        {supportiveDocuments.length > 0 && (
          <div className="review-source-tags" role="group" aria-label="Supportive documents">
            {supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}
          </div>
        )}
      </aside>
      <Modal isOpen={objectiveExpanded} onClose={() => setObjectiveExpanded(false)} title="Review objective" width={720}>
        <div className="review-objective-dialog-content"><p>{objectiveText}</p>{supportiveDocuments.length > 0 && <div className="review-source-tags" role="group" aria-label="Supportive documents">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}</div>}</div>
      </Modal>
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
  const [expanded, setExpanded] = useState(false);
  return (
    <aside className={`review-feedback-composer${expanded ? ' is-expanded' : ''}`} aria-label="Review feedback">
      <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <label className="visually-hidden" htmlFor="review-feedback-message">Write feedback about this review</label>
        <div className="review-feedback-entry"><textarea id="review-feedback-message" rows={expanded ? 3 : 1} value={value} onFocus={() => setExpanded(true)} onBlur={() => { if (!value.trim() && files.length === 0) setExpanded(false); }} onChange={event => onChange(event.target.value)} placeholder="Write feedback about this review…" />
          <div className="review-feedback-controls">
            <label className="review-attach-button" htmlFor="review-feedback-attachments" title="Attach supportive documents"><Paperclip size={17} aria-hidden="true" /><span className="visually-hidden">Attach supportive documents</span></label>
            <input id="review-feedback-attachments" className="visually-hidden" type="file" multiple accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => onFilesChange(Array.from(event.target.files ?? []))} />
            <button className="btn-primary review-feedback-send" type="submit" aria-label={submitting ? 'Sending feedback' : 'Send feedback'} title={submitting ? 'Sending feedback' : 'Send feedback'} disabled={submitting || (!value.trim() && files.length === 0)}><Send size={19} aria-hidden="true" /></button>
          </div>
        </div>
        {files.length > 0 && <div className="review-feedback-files" role="group" aria-label="Attached supportive documents">{files.map((file, index) => <span key={`${file.name}-${file.size}-${index}`}><Paperclip size={13} aria-hidden="true" />{truncateReviewSourceName(file.name)}<button type="button" title={`Remove ${file.name}`} aria-label={`Remove ${file.name}`} onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}><X size={12} aria-hidden="true" /></button></span>)}</div>}
        {notice && <p className="review-feedback-notice" role="status">{notice}</p>}
      </form>
    </aside>
  );
}

function ReviewInformation({ session, objective }: { session: StaticSession; objective: string }) {
  const config = parseReviewConfig(session);
  const progress = parseReviewProgress(session.progressJson);
  const pullRequest = typeof config.pullRequest === 'string' ? config.pullRequest.trim() : '';
  const reviewMode = typeof config.reviewMode === 'string' ? config.reviewMode : '';
  const reviewScope = pullRequest ? 'Pull Request (PR Review)' : reviewMode === 'changed-files' ? 'Change File Review' : 'Full Scope Review';
  const startedAt = progress?.startedAt;
  const finishedAt = progress?.updatedAt || session.updatedAt;
  const durationMs = startedAt && finishedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : NaN;
  const duration = Number.isFinite(durationMs) && durationMs >= 0 ? `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s` : 'In progress';
  return <dl className="review-information-list">
    <div><dt>Objective</dt><dd>{objective}</dd></div>
    <div><dt>Review scope</dt><dd>{reviewScope}</dd></div>
    <div><dt>Duration</dt><dd>{duration}</dd></div>
  </dl>;
}

function ReviewWaitingPanel({ tab }: { tab: Tab }) {
  const title = tab === 'Overview' ? 'Review overview' : tab;
  return <section className="review-waiting-panel" role="status">
    <h2>{title}</h2>
    <p>—</p>
    <span>This section will be available when the review has produced evidence.</span>
  </section>;
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
  state,
  findings,
  findingsError,
  decisions,
  decisionsError,
  currentDecision,
  reviewer,
  severityCounts,
  tab,
  onTabChange,
  onTabKeyDown,
  tabRefs,
  onFindingsLoadState,
}: {
  session: StaticSession;
  state: ReviewLifecycleState;
  findings: Finding[];
  findingsError: string | null;
  decisions: ReviewDecisionRecord[];
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  reviewer: string | null;
  severityCounts: { severity: string; count: number }[];
  tab: Tab;
  onTabChange: (tab: Tab, focus?: boolean) => void;
  onTabKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, tab: Tab) => void;
  tabRefs: React.MutableRefObject<Partial<Record<Tab, HTMLButtonElement>>>;
  onFindingsLoadState: (findings: Finding[], error: string | null) => void;
}) {
  const panelId = `review-result-panel-${tab.toLowerCase().replace(/\s+/g, '-')}`;
  const waitingForResult = state === 'In progress' || state === 'Queued';
  return (
    <section className="review-detail-panel command-project-detail" aria-label="Review detail">
      <div id={panelId} role="tabpanel" tabIndex={0} aria-labelledby={`review-result-tab-${tab.toLowerCase().replace(/\s+/g, '-')}`} className="review-result-panel">
        {waitingForResult && <ReviewWaitingPanel tab={tab} />}
        {!waitingForResult && tab === 'Overview' && <ReviewResultOverview session={session} findings={findings} findingsError={findingsError} decisionsError={decisionsError} currentDecision={currentDecision} reviewer={reviewer} severityCounts={severityCounts} state={state} />}
        {!waitingForResult && tab === 'Findings' && <FindingsPanel projectId={session.projectId} sessionId={session.id} presentation="project" pageSize={5} refreshKey={session.updatedAt} onLoadStateChange={onFindingsLoadState} />}
        {!waitingForResult && tab === 'Traceability' && <Traceability findings={findings} />}
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
  reviewer,
  severityCounts,
  state,
}: {
  session: StaticSession;
  findings: Finding[];
  findingsError: string | null;
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  reviewer: string | null;
  severityCounts: { severity: string; count: number }[];
  state: ReviewLifecycleState;
}) {
  const criticalCount = findings.filter(finding => finding.severity.toLowerCase() === 'critical').length;
  const highPriorityCount = findings.filter(finding => finding.priority?.toLowerCase() === 'high').length;
  const progress = parseReviewProgress(session.progressJson);
  const completedAt = progress?.updatedAt || session.updatedAt;
  const startedAt = progress?.startedAt;
  const durationMs = startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : NaN;
  const duration = Number.isFinite(durationMs) && durationMs >= 0
    ? `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
    : 'Not supplied';
  const config = parseReviewConfig(session);
  const reviewMode = typeof config.reviewMode === 'string' ? config.reviewMode : '';
  const pullRequest = typeof config.pullRequest === 'string' ? config.pullRequest : '';
  const reviewScope = pullRequest ? 'Pull Request (PR Review)' : reviewMode === 'changed-files' ? 'Change File Review' : 'Full Scope Review';
  return (
    <div className="review-overview-grid">
      <section className="review-overview-main review-overview-card">
        <div className="review-overview-copy"><div className="review-overview-heading"><div className="review-overview-title"><h2>Review Overview</h2></div><StatusBadge label={state} tone={stateTone(state)} /></div></div>
        {!findingsError && <div className="review-severity-grid" aria-label="Review metrics"><div className="review-severity-total"><strong>{findings.length}</strong><span>Reported findings</span></div><div><strong>{criticalCount}</strong><span>Critical severity</span></div><div><strong>{highPriorityCount}</strong><span>High priority</span></div></div>}
        <div className="review-overview-copy review-overview-summary"><h3>Summary</h3><p>{session.finalSummary || 'The automated activity completed and the review was approved by a human reviewer.'}</p></div>
        {findingsError && <p className="review-history-unavailable" role="status">Finding totals could not be loaded for this result.</p>}
      </section>
      <aside className="review-overview-rail review-decision-card"><h2>Decision</h2><dl><div><dt>Decision</dt><dd>{currentDecision ? decisionLabel(currentDecision.decision) : 'Not supplied'}</dd></div><div><dt>Assigned reviewer</dt><dd>{reviewer || 'Not supplied'}</dd></div><div><dt>Review scope</dt><dd>{reviewScope}</dd></div><div><dt>Completed</dt><dd>{completedAt ? formatReviewTimestamp(completedAt) : 'Not supplied'}</dd></div><div><dt>Duration</dt><dd>{duration}</dd></div></dl>{currentDecision?.comment && <div className="review-final-rationale"><h3>Decision rationale</h3><p>{currentDecision.comment}</p></div>}{decisionsError && <p className="review-history-unavailable">Decision history could not be loaded.</p>}</aside>
    </div>
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
