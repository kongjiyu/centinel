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
import type { Artifact, Finding, Project, Requirement, RequirementMapping, ReviewDecisionRecord, Screen, StaticSession } from '../types';
import { entityIdTitle, formatEntityId } from '../utils/entityId';
import { reviewFailureMessage, userFacingError } from '../utils/userFacingError';
import './ReviewActivityScreen.css';

type Props = {
  projectId: string;
  sessionId: string;
  onNavigate: (screen: Screen) => void;
};

type Tab = 'Overview' | 'Activity' | 'Findings' | 'Traceability';
type DecisionIntent = 'approved' | 'changes_requested';
type SupportiveDocument = { id: string; name: string };

const REVIEW_DETAIL_TABS: Tab[] = ['Overview', 'Activity', 'Findings', 'Traceability'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
type TraceabilityState = 'complete' | 'incomplete' | 'missing';

type TraceabilityRecord = {
  requirement: Requirement;
  mappings: RequirementMapping[];
  sources: Artifact[];
  findings: Finding[];
  state: TraceabilityState;
};

function traceabilityStateLabel(state: TraceabilityState) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** Collapse the validation dimensions into the single reviewer-facing state. */
export function traceabilityOverallState(states: TraceabilityState[]): TraceabilityState {
  if (states.includes('missing')) return 'missing';
  if (states.includes('incomplete')) return 'incomplete';
  return 'complete';
}

function normalizeTraceabilityState(value: string | undefined, fallback: TraceabilityState): TraceabilityState {
  const normalized = value?.trim().toLowerCase() || '';
  if (/complete|covered|verified|pass|full/.test(normalized)) return 'complete';
  if (/incomplete|partial|pending|weak|uncertain/.test(normalized)) return 'incomplete';
  if (/missing|uncovered|none|fail/.test(normalized)) return 'missing';
  return fallback;
}

function requirementTokens(requirement: Requirement) {
  return `${requirement.title} ${requirement.description}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 5);
}

function traceabilityRecords(
  requirements: Requirement[],
  mappings: Record<string, RequirementMapping[]>,
  artifacts: Artifact[],
  findings: Finding[],
): TraceabilityRecord[] {
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  return requirements.map(requirement => {
    const requirementMappings = mappings[requirement.id] ?? [];
    const mappedArtifacts = requirementMappings
      .map(mapping => mapping.fileId ? artifactsById.get(mapping.fileId) : undefined)
      .filter((artifact): artifact is Artifact => Boolean(artifact));
    const tokens = requirementTokens(requirement);
    const relatedFindings = findings.filter(finding => {
      if (requirementMappings.some(mapping => mapping.fileId && mapping.fileId === finding.artifactId)) return true;
      if (finding.category && requirement.category && finding.category.toLowerCase() === requirement.category.toLowerCase()) return true;
      const findingText = `${finding.title} ${finding.description} ${finding.recommendation}`.toLowerCase();
      return tokens.some(token => findingText.includes(token));
    });
    const confidence = requirementMappings.length > 0
      ? Math.min(...requirementMappings.map(mapping => mapping.confidence).filter(value => Number.isFinite(value)))
      : NaN;
    const completeness = requirementMappings.length === 0
      ? 'missing'
      : requirementMappings.every(mapping => normalizeTraceabilityState(mapping.coverageStatus, 'incomplete') === 'complete')
        ? 'complete'
        : 'incomplete';
    const correctness = mappedArtifacts.length === 0
      ? 'missing'
      : Number.isFinite(confidence) && confidence < 0.7
        ? 'incomplete'
        : relatedFindings.some(finding => /incorrect|invalid|mismatch|contradict/i.test(`${finding.category} ${finding.title} ${finding.description}`))
          ? 'incomplete'
          : 'complete';
    const consistency = mappedArtifacts.length === 0
      ? 'missing'
      : relatedFindings.some(finding => /inconsisten|contradict|conflict|mismatch/i.test(`${finding.category} ${finding.title} ${finding.description}`))
        ? 'incomplete'
        : 'complete';
    return {
      requirement,
      mappings: requirementMappings,
      sources: mappedArtifacts,
      findings: relatedFindings,
      state: traceabilityOverallState([completeness, correctness, consistency]),
    };
  });
}

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
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [requirementMappings, setRequirementMappings] = useState<Record<string, RequirementMapping[]>>({});
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
  const [focusFindingId, setFocusFindingId] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement>>>({});
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

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
        setFindingsError(userFacingError(cause, 'Findings could not be loaded.'));
      }

      try {
        setDecisions(await api.listReviewDecisions(projectId, sessionId));
        setDecisionsError(null);
      } catch (cause) {
        setDecisions([]);
        setDecisionsError(userFacingError(cause, 'Decision history could not be loaded.'));
      }

      if (!silent) {
        // Traceability is an evidence view, so an unavailable mapping endpoint
        // should not prevent the review activity itself from loading. Older test
        // doubles and saved workspaces may not expose these optional calls yet.
        try {
          const nextRequirements = typeof api.listRequirements === 'function'
            ? await api.listRequirements(projectId)
            : [];
          const nextArtifacts = typeof api.listArtifacts === 'function'
            ? await api.listArtifacts(projectId)
            : [];
          setRequirements(nextRequirements);
          setArtifacts(nextArtifacts);
          if (typeof api.listRequirementMappings === 'function') {
            const mappingEntries = await Promise.all(nextRequirements.map(async requirement => {
              try {
                return [requirement.id, await api.listRequirementMappings(projectId, requirement.id)] as const;
              } catch {
                return [requirement.id, []] as const;
              }
            }));
            setRequirementMappings(Object.fromEntries(mappingEntries));
          } else {
            setRequirementMappings({});
          }
        } catch {
          setRequirements([]);
          setArtifacts([]);
          setRequirementMappings({});
        }
      }
    } catch (cause) {
      setError(userFacingError(cause, 'Review activity could not be loaded.'));
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
  const openFinding = useCallback((findingId: string) => {
    setFocusFindingId(findingId);
    changeTab('Findings');
  // `changeTab` only writes local tab state and session storage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(userFacingError(cause, 'The review decision could not be saved.'));
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
      setFeedbackNotice(`Feedback could not be sent. Your draft and attachments are still here; ${userFacingError(cause, 'check the file type or size and try again.')}`);
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
      setError(userFacingError(cause, 'The review could not be cancelled. Try again.'));
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
          <button data-testid="review-decision-reject" className="btn-secondary review-reject-button" type="button" onClick={() => { setDecisionIntent(null); setDecisionFeedback(''); changeTab('Activity'); window.requestAnimationFrame(() => feedbackRef.current?.focus()); }} disabled={!canDecide}>
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
        title={`${session.name} ${formatEntityId(session.id)}`}
        status={{ label: state, tone: stateTone(state) }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        actions={state === 'Need Approval' && !currentDecision ? headerActions : state === 'Failed' ? <button type="button" className="btn-primary" onClick={() => onNavigate({ name: 'review-entry', projectId })}><History size={16} aria-hidden="true" /> Rerun review</button> : undefined}
      />

      {error && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {error}</div>}
      <ReviewTabs tabs={REVIEW_DETAIL_TABS} tab={tab} onTabChange={changeTab} onTabKeyDown={handleTabKeyDown} tabRefs={tabRefs} label="Review detail sections" />

      {tab === 'Overview' ? (
        <section className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-overview">
          <ReviewResultOverview
            session={session}
            findings={findings}
            findingsError={findingsError}
            decisionsError={decisionsError}
            currentDecision={currentDecision}
            reviewer={reviewer}
            severityCounts={severityCounts}
            state={state}
            objective={objective}
            supportiveDocuments={objectiveDocuments}
          />
        </section>
      ) : tab === 'Activity' ? (
        <section className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-activity">
          <ReviewActivityContent
            session={session}
            state={state}
            findingsError={findingsError}
            decisions={decisions}
            decisionsError={decisionsError}
            currentDecision={currentDecision}
          />
        </section>
      ) : tab === 'Findings' ? (
        <section className="review-detail-panel review-result-panel command-project-detail" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-findings">
          {state === 'In progress' || state === 'Queued'
            ? <ReviewWaitingPanel title="Findings" />
            : <FindingsPanel projectId={session.projectId} sessionId={session.id} presentation="project" pageSize={5} refreshKey={session.updatedAt} focusFindingId={focusFindingId} onLoadStateChange={handleFindingsLoadState} />}
        </section>
      ) : (
        <section className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-traceability">
          {state === 'In progress' || state === 'Queued' ? <ReviewWaitingPanel title="Traceability" /> : <Traceability requirements={requirements} mappings={requirementMappings} artifacts={artifacts} findings={findings} onOpenFinding={openFinding} />}
        </section>
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
          inputRef={feedbackRef}
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
  findingsError,
  decisions,
  decisionsError,
  currentDecision,
}: {
  session: StaticSession;
  state: ReviewLifecycleState;
  findingsError: string | null;
  decisions: ReviewDecisionRecord[];
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
}) {
  const progress = parseReviewProgress(session.progressJson);
  return (
    <div className="review-activity-body">
      <section className="review-activity-surface" aria-label="Review activity conversation">
        <div className="review-activity-surface-heading">
          <h2>{state === 'Need Approval' ? 'Review activity' : 'Review activity'}</h2>
        </div>
        <ReviewProgressView progress={progress} />
        {state === 'Blocked' && <div className="review-blocked-message" role="alert"><ShieldAlert size={17} aria-hidden="true" /><div><strong>Review needs attention</strong><p>{reviewFailureMessage(session.failureReason)}</p></div></div>}
        {state === 'Failed' && <div className="review-failed-message" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review failed</strong><p>{reviewFailureMessage(session.failureReason)}</p></div></div>}
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
    </div>
  );
}

function FeedbackComposer({ value, files, submitting, notice, onChange, onFilesChange, onSubmit, inputRef }: {
  value: string;
  files: File[];
  submitting: boolean;
  notice: string | null;
  onChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <aside className={`review-feedback-composer${expanded ? ' is-expanded' : ''}`} aria-label="Review feedback">
      <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <label className="visually-hidden" htmlFor="review-feedback-message">Write feedback about this review</label>
        <div className="review-feedback-entry"><textarea ref={inputRef} id="review-feedback-message" rows={expanded ? 3 : 1} value={value} onFocus={() => setExpanded(true)} onBlur={() => { if (!value.trim() && files.length === 0) setExpanded(false); }} onChange={event => onChange(event.target.value)} placeholder="Write feedback about this review…" />
          <div className="review-feedback-controls">
            <label className="review-attach-button" htmlFor="review-feedback-attachments" title="Attach supportive documents"><Paperclip size={20} aria-hidden="true" /><span className="visually-hidden">Attach supportive documents</span></label>
            <input id="review-feedback-attachments" className="visually-hidden" type="file" multiple accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => onFilesChange(Array.from(event.target.files ?? []))} />
            <button className="btn-primary review-feedback-send" type="submit" aria-label={submitting ? 'Sending feedback' : 'Send feedback'} title={submitting ? 'Sending feedback' : 'Send feedback'} disabled={submitting || (!value.trim() && files.length === 0)}><Send size={20} aria-hidden="true" /></button>
          </div>
        </div>
        {files.length > 0 && <div className="review-feedback-files" role="group" aria-label="Attached supportive documents">{files.map((file, index) => <span key={`${file.name}-${file.size}-${index}`}><Paperclip size={13} aria-hidden="true" />{truncateReviewSourceName(file.name)}<button type="button" title={`Remove ${file.name}`} aria-label={`Remove ${file.name}`} onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}><X size={12} aria-hidden="true" /></button></span>)}</div>}
        {notice && <p className="review-feedback-notice" role="status">{notice}</p>}
      </form>
    </aside>
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

function ReviewWaitingPanel({ title }: { title: string }) {
  return <section className="review-waiting-panel" role="status">
    <h2>{title}</h2>
    <p>—</p>
    <span>This section will be available when the review has produced evidence.</span>
  </section>;
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

function ReviewResultOverview({
  session,
  findings,
  findingsError,
  decisionsError,
  currentDecision,
  reviewer,
  severityCounts,
  state,
  objective,
  supportiveDocuments,
}: {
  session: StaticSession;
  findings: Finding[];
  findingsError: string | null;
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  reviewer: string | null;
  severityCounts: { severity: string; count: number }[];
  state: ReviewLifecycleState;
  objective: string | null;
  supportiveDocuments: SupportiveDocument[];
}) {
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);
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
  const waitingForEvidence = state === 'In progress' || state === 'Queued';
  const summary = waitingForEvidence
    ? 'The review is processing its sources. Findings and traceability will appear here as evidence becomes available.'
    : session.finalSummary || 'The review activity completed. Inspect the evidence before recording a decision.';
  const metricValue = (value: number) => findingsError || waitingForEvidence ? '—' : String(value);
  const objectiveText = objective || 'No objective was persisted for this review.';
  const objectiveNeedsDisclosure = objectiveText.length > 280;
  return (
    <div className="review-overview-grid">
      <section className="review-overview-main review-overview-card">
        <div className="review-overview-copy"><div className="review-overview-heading"><div className="review-overview-title"><h2>Review Overview</h2></div><StatusBadge label={state} tone={stateTone(state)} /></div></div>
        <div className="review-severity-grid" aria-label="Review metrics"><div className="review-severity-total"><strong>{metricValue(findings.length)}</strong><span>Reported findings</span></div><div><strong>{metricValue(criticalCount)}</strong><span>Critical severity</span></div><div><strong>{metricValue(highPriorityCount)}</strong><span>High priority</span></div></div>
        <section className="review-overview-objective" aria-labelledby="review-overview-objective-heading">
          <div className="review-overview-subheading">
            <h3 id="review-overview-objective-heading">Objective</h3>
            {objectiveNeedsDisclosure && <button type="button" className="command-icon-button" aria-label="Expand review objective" title="Expand review objective" aria-expanded={objectiveExpanded} onClick={() => setObjectiveExpanded(true)}><Expand size={16} aria-hidden="true" /></button>}
          </div>
          <p className={objectiveNeedsDisclosure ? 'review-overview-objective-text is-truncated' : 'review-overview-objective-text'}>{objectiveText}</p>
          {supportiveDocuments.length > 0 && <div className="review-source-tags" role="group" aria-label="Supportive documents">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}</div>}
        </section>
        <div className="review-overview-copy review-overview-summary"><h3>Summary</h3><p>{summary}</p></div>
        {findingsError && <p className="review-history-unavailable" role="status">Finding totals could not be loaded for this result.</p>}
      </section>
      <aside className="review-overview-rail review-decision-card"><h2>Decision</h2><dl><div><dt>Decision</dt><dd>{currentDecision ? decisionLabel(currentDecision.decision) : state === 'Need Approval' ? 'Pending approval' : waitingForEvidence ? 'Waiting for review' : 'Not supplied'}</dd></div><div><dt>Reviewer</dt><dd>{reviewer || 'Not supplied'}</dd></div><div><dt>Review scope</dt><dd>{reviewScope}</dd></div><div><dt>Completed</dt><dd>{waitingForEvidence ? 'Not yet' : completedAt ? formatReviewTimestamp(completedAt) : 'Not supplied'}</dd></div><div><dt>Duration</dt><dd>{duration}</dd></div></dl>{currentDecision?.comment && <div className="review-final-rationale"><h3>Decision rationale</h3><p>{currentDecision.comment}</p></div>}{decisionsError && <p className="review-history-unavailable">Decision history could not be loaded.</p>}</aside>
      <Modal isOpen={objectiveExpanded} onClose={() => setObjectiveExpanded(false)} title="Review objective" width={720}>
        <div className="review-objective-dialog-content"><p>{objectiveText}</p>{supportiveDocuments.length > 0 && <div className="review-source-tags" role="group" aria-label="Supportive documents">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}</div>}</div>
      </Modal>
    </div>
  );
}

function Traceability({
  requirements,
  mappings,
  artifacts,
  findings,
  onOpenFinding,
}: {
  requirements: Requirement[];
  mappings: Record<string, RequirementMapping[]>;
  artifacts: Artifact[];
  findings: Finding[];
  onOpenFinding: (findingId: string) => void;
}) {
  const records = useMemo(() => traceabilityRecords(requirements, mappings, artifacts, findings), [artifacts, findings, mappings, requirements]);
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const selectedRecord = records.find(record => record.requirement.id === selectedRequirementId) ?? records[0] ?? null;

  return (
    <section className="review-traceability" aria-labelledby="review-traceability-heading">
      <div className="review-section-heading">
        <div>
          <h2 id="review-traceability-heading"><FileCheck2 size={18} aria-hidden="true" /> Traceability</h2>
          <p>Each requirement is linked to its mapped source evidence and related findings.</p>
        </div>
        <strong className="review-traceability-total">{records.length} requirements</strong>
      </div>
      <div className="review-traceability-layout">
        <div className="review-traceability-table-card">
          <div className="review-traceability-table-wrap">
            <table className="review-traceability-table" aria-label="Traceability matrix">
              <thead><tr><th scope="col">ID</th><th scope="col">Requirement</th><th scope="col">Source</th><th scope="col">Findings</th><th scope="col">State</th></tr></thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={5}><div className="review-traceability-empty" role="status"><FileCheck2 size={22} aria-hidden="true" /><span>No requirement mappings are available for this review yet. Add requirements and map their source evidence to populate this matrix.</span></div></td></tr>
                ) : records.map(record => (
                  <tr key={record.requirement.id} tabIndex={0} aria-selected={selectedRecord?.requirement.id === record.requirement.id} className={selectedRecord?.requirement.id === record.requirement.id ? 'selected' : undefined} onClick={() => setSelectedRequirementId(record.requirement.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedRequirementId(record.requirement.id); } }}>
                    <td><span className="finding-id-label" title={entityIdTitle('Requirement ID:', record.requirement.id)}>{formatEntityId(record.requirement.id)}</span></td>
                    <td><button type="button" className="traceability-requirement-link" onClick={event => { event.stopPropagation(); setSelectedRequirementId(record.requirement.id); }}><strong>{record.requirement.title}</strong><span>{record.requirement.category || 'Requirement'}</span><em>… See more</em></button></td>
                    <td><div className="traceability-source-list">{record.sources.length > 0 ? record.sources.map(source => <span key={source.id} className="traceability-source-chip" title={source.filePath || source.fileName}>{source.fileName || source.filePath}</span>) : <span className="traceability-muted">No mapped source</span>}</div></td>
                    <td><div className="traceability-finding-links">{record.findings.length > 0 ? record.findings.map(finding => <button key={finding.id} type="button" className="traceability-finding-link" title={entityIdTitle(finding.title, finding.id)} aria-label={`Open finding ${formatEntityId(finding.id)}: ${finding.title}`} onClick={event => { event.stopPropagation(); onOpenFinding(finding.id); }}>{formatEntityId(finding.id)}</button>) : <span className="traceability-muted">No linked findings</span>}</div></td>
                    <td><TraceabilityStateBadge state={record.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="review-traceability-detail" aria-label="Traceability details">
          {selectedRecord ? <>
            <div className="review-traceability-detail-heading"><div><span className="command-eyebrow">Requirement</span><h3>{selectedRecord.requirement.title}</h3><span className="finding-id-label" title={entityIdTitle('Requirement ID:', selectedRecord.requirement.id)}>{formatEntityId(selectedRecord.requirement.id)}</span></div><TraceabilityStateBadge state={selectedRecord.state} /></div>
            <p className="review-traceability-detail-description">{selectedRecord.requirement.description || 'No requirement description was supplied.'}</p>
            <section><h4>Sources</h4>{selectedRecord.sources.length > 0 ? <div className="traceability-detail-list">{selectedRecord.sources.map(source => <span key={source.id} title={source.filePath || source.fileName}>{source.fileName || source.filePath}</span>)}</div> : <p className="traceability-muted">No mapped source evidence.</p>}</section>
            <section><h4>Linked findings</h4>{selectedRecord.findings.length > 0 ? <div className="traceability-detail-list">{selectedRecord.findings.map(finding => <button key={finding.id} type="button" className="traceability-detail-finding" title={entityIdTitle(finding.title, finding.id)} aria-label={`Open finding ${formatEntityId(finding.id)}: ${finding.title}`} onClick={() => onOpenFinding(finding.id)}>{formatEntityId(finding.id)}</button>)}</div> : <p className="traceability-muted">No findings are linked to this requirement.</p>}</section>
          </> : <div className="review-traceability-detail-empty">Select a requirement to review its evidence links.</div>}
        </aside>
      </div>
    </section>
  );
}

function TraceabilityStateBadge({ state }: { state: TraceabilityState }) {
  return <span className={`traceability-state-badge traceability-state-${state}`}>{traceabilityStateLabel(state)}</span>;
}

function HistoryPanel({ progress, decisions, error }: { progress: string; decisions: ReviewDecisionRecord[]; error: string | null }) {
  return <section className="review-history"><div className="review-section-heading"><div><h2>History</h2><p>Automated activity and human decisions are shown in separate columns.</p></div></div><div className="review-history-columns"><div><h3>System activity</h3><ReviewProgressView progress={parseReviewProgress(progress)} /></div><div className="review-human-history"><h3>Human decisions</h3>{error ? <p className="review-history-unavailable">Decision history could not be loaded.</p> : decisions.length === 0 ? <p className="review-activity-empty">No human decision has been recorded.</p> : decisions.map(decision => <DecisionRecord key={decision.id} decision={decision} />)}</div></div></section>;
}

function DecisionRecord({ decision }: { decision: ReviewDecisionRecord }) {
  return <article className="review-human-history-record"><MessageSquare size={14} aria-hidden="true" /><div><strong>{decisionLabel(decision.decision)}</strong><p>{decision.comment || 'No written rationale was supplied.'}</p>{decision.attachments && decision.attachments.length > 0 && <div className="review-source-tags" role="group" aria-label="Feedback attachments">{decision.attachments.map(attachment => <span className="review-source-tag" key={attachment.id} title={attachment.fileName} aria-label={attachment.fileName}>{truncateReviewSourceName(attachment.fileName)}</span>)}</div>}<span>{decision.reviewer || 'Reviewer not supplied'} · {formatReviewTimestamp(decision.createdAt) || 'Time not supplied'}</span></div></article>;
}
