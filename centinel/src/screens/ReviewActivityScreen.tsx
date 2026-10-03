import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Expand, FileCheck2, History, MessageSquare, Paperclip, RotateCcw, Search, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { ReviewProgressView } from '../components/ReviewProgressView';
import { FindingsPanel } from '../components/FindingsPanel';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import {
  createReviewActivityViewModel,
  formatReviewTimestamp,
  parseReviewConfig,
  parseReviewProgress,
  truncateReviewSourceName,
  type ReviewLifecycleState,
} from '../reviewViewModel';
import type { Artifact, EvidenceSufficiencyAssessment, Finding, FindingCorrelationSnapshot, Project, Requirement, RequirementMapping, ReviewDecisionRecord, ReviewModelUsage, ReviewSourceManifest, ReviewTraceabilitySnapshot, Screen, StaticSession } from '../types';
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
type TraceabilityFilter = 'all' | 'attention' | TraceabilityState;

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
  if (/^(incomplete|partial|pending|weak|uncertain)$/.test(normalized)) return 'incomplete';
  if (/^(complete|covered|verified|pass|passed|full|fully[_ -]?covered)$/.test(normalized)) return 'complete';
  if (/^(missing|uncovered|none|fail|failed)$/.test(normalized)) return 'missing';
  return fallback;
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
    const relatedFindings = findings.filter(finding => {
      if (requirementMappings.some(mapping => mapping.fileId && mapping.fileId === finding.artifactId)) return true;
      if (finding.category && requirement.category && finding.category.toLowerCase() === requirement.category.toLowerCase()) return true;
      // Free-text overlap is intentionally not evidence. A relationship is
      // discoverable here only when the persisted mapping or category gives
      // us a structured join; the snapshot endpoint is authoritative for
      // completed Reviews.
      return false;
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
  const [sourceManifest, setSourceManifest] = useState<ReviewSourceManifest | null>(null);
  const [traceabilitySnapshot, setTraceabilitySnapshot] = useState<ReviewTraceabilitySnapshot | null>(null);
  const [modelUsage, setModelUsage] = useState<ReviewModelUsage | null>(null);
  const [modelUsageError, setModelUsageError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecisionRecord[]>([]);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const [decisionOffset, setDecisionOffset] = useState(0);
  const [hasOlderDecisions, setHasOlderDecisions] = useState(false);
  const [loadingOlderDecisions, setLoadingOlderDecisions] = useState(false);
  const [olderDecisionsError, setOlderDecisionsError] = useState<string | null>(null);
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
  const [retrying, setRetrying] = useState(false);
  const [startingIteration, setStartingIteration] = useState(false);
  const [preparedChild, setPreparedChild] = useState<StaticSession | null>(null);
  const [iterationSourceChoice, setIterationSourceChoice] = useState<'reuse' | 'refresh'>('reuse');
  const [evidenceAssessment, setEvidenceAssessment] = useState<EvidenceSufficiencyAssessment | null>(null);
  const [contradictionDrafts, setContradictionDrafts] = useState<Record<string, { decision: 'authoritative_left' | 'authoritative_right' | 'not_conflict'; rationale: string }>>({});
  const [savingContradiction, setSavingContradiction] = useState<string | null>(null);
  const [contradictionNotice, setContradictionNotice] = useState<string | null>(null);
  const [correlationSnapshot, setCorrelationSnapshot] = useState<FindingCorrelationSnapshot | null>(null);
  const [focusFindingId, setFocusFindingId] = useState<string | null>(null);
  const [traceabilityFilter, setTraceabilityFilter] = useState<TraceabilityFilter>('all');
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
        const firstDecisions = await api.listReviewDecisions(projectId, sessionId);
        setDecisions(firstDecisions);
        setDecisionOffset(firstDecisions.length);
        setHasOlderDecisions(firstDecisions.length === 50);
        setOlderDecisionsError(null);
        setDecisionsError(null);
      } catch (cause) {
        setDecisions([]);
        setDecisionOffset(0);
        setHasOlderDecisions(false);
        setOlderDecisionsError(null);
        setDecisionsError(userFacingError(cause, 'Decision history could not be loaded.'));
      }

      if (typeof api.getReviewEvidenceSufficiency === 'function') {
        try { setEvidenceAssessment(await api.getReviewEvidenceSufficiency(projectId, sessionId)); }
        catch { setEvidenceAssessment(null); }
      }
      if (typeof api.getReviewCorrelations === 'function') {
        try { setCorrelationSnapshot(await api.getReviewCorrelations(projectId, sessionId)); }
        catch { setCorrelationSnapshot(null); }
      }
      if (typeof api.listStaticSessions === 'function') {
        try {
          const children = (await api.listStaticSessions(projectId)).filter(item => item.parentSessionId === sessionId);
          setPreparedChild(children.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null);
        } catch { /* child discovery is additive */ }
      }

      // These endpoints are additive evidence contracts. Older sidecars and
      // test doubles may not expose them; in that case the UI renders an
      // explicit unavailable state rather than turning missing data into zero.
      if (typeof api.getReviewSourceManifest === 'function') {
        try { setSourceManifest(await api.getReviewSourceManifest(projectId, sessionId)); }
        catch { setSourceManifest(null); }
      } else {
        setSourceManifest(null);
      }
      if (typeof api.getReviewTraceability === 'function') {
        try { setTraceabilitySnapshot(await api.getReviewTraceability(projectId, sessionId)); }
        catch {
          // A known endpoint that is unavailable must not fall back to live
          // project mappings; doing so would make a historical Review change
          // when current requirements or artifacts change.
          setTraceabilitySnapshot({ sessionId, projectId, status: 'unavailable', records: [], summary: null });
        }
      } else {
        setTraceabilitySnapshot(null);
      }

      // Usage is additive evidence. A historical review may legitimately have
      // no usage rows, and older test doubles/sidecars may not expose the
      // endpoint; both cases stay explicit rather than becoming zero.
      if (typeof api.getReviewModelUsage === 'function') {
        try {
          setModelUsage(await api.getReviewModelUsage(projectId, sessionId));
          setModelUsageError(null);
        } catch (cause) {
          setModelUsage(null);
          setModelUsageError(userFacingError(cause, 'Model usage is not available for this review.'));
        }
      } else if (typeof api.getAiUsage === 'function') {
        try {
          setModelUsage(await api.getAiUsage({ scope: 'text', callKind: 'review', projectId, sessionId }));
          setModelUsageError(null);
        } catch (cause) {
          setModelUsage(null);
          setModelUsageError(userFacingError(cause, 'Model usage is not available for this review.'));
        }
      } else {
        setModelUsage(sessionResult.modelUsage ?? null);
        setModelUsageError(null);
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

  const loadOlderDecisions = async () => {
    if (loadingOlderDecisions || !hasOlderDecisions) return;
    setLoadingOlderDecisions(true);
    setOlderDecisionsError(null);
    try {
      const nextPage = await api.listReviewDecisions(projectId, sessionId, 50, decisionOffset);
      setDecisions(previous => {
        const seen = new Set(previous.map(decision => decision.id));
        return [...previous, ...nextPage.filter(decision => !seen.has(decision.id))];
      });
      setDecisionOffset(previous => previous + nextPage.length);
      setHasOlderDecisions(nextPage.length === 50);
    } catch {
      setOlderDecisionsError('Older decisions could not be loaded. Try again.');
    } finally {
      setLoadingOlderDecisions(false);
    }
  };

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
  const canRetry = Boolean(session && (session.status === 'failure' || session.status === 'blocked' || session.status === 'cancelled')) && !retrying;
  const saveContradiction = async (contradictionId: string) => {
    const draft = contradictionDrafts[contradictionId];
    if (!draft || draft.rationale.trim().length < 8) {
      setError('Explain the evidence decision in at least 8 characters.');
      return;
    }
    setSavingContradiction(contradictionId);
    setError(null);
    try {
      const disposition = await api.saveContradictionDisposition(projectId, sessionId, contradictionId, {
        decision: draft.decision, rationale: draft.rationale.trim(),
      });
      setEvidenceAssessment(previous => previous ? {
        ...previous,
        contradictions: previous.contradictions.map(item => item.id === contradictionId ? { ...item, disposition } : item),
      } : previous);
      setContradictionNotice('Evidence decision saved. Retry the review to reassess its frozen sources.');
    } catch (cause) {
      setError(userFacingError(cause, 'The evidence decision could not be saved.'));
    } finally {
      setSavingContradiction(null);
    }
  };
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

  const openDecisionPanel = (decision: DecisionIntent) => {
    if (!canDecide) return;
    setDecisionIntent(decision);
    setIterationSourceChoice('reuse');
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
      const decision = await api.submitReviewDecision(projectId, session.id, {
        decision: decisionIntent,
        comment: decisionFeedback.trim() || undefined,
        ...(decisionIntent === 'changes_requested' ? { sourceChoice: iterationSourceChoice } : {}),
      });
      if (decision.preparedChild) setPreparedChild(decision.preparedChild);
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

  const startPreparedIteration = async () => {
    if (!preparedChild || startingIteration) return;
    setStartingIteration(true);
    setError(null);
    try {
      const started = await api.startPreparedReviewIteration(projectId, preparedChild.id, {
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${preparedChild.id}`,
      });
      onNavigate({ name: 'review-activity', projectId, sessionId: started.id, reviewName: started.name });
    } catch (cause) {
      setError(userFacingError(cause, 'The revised review could not be started. The prepared review remains available.'));
    } finally {
      setStartingIteration(false);
    }
  };

  const retryReview = async () => {
    if (!session || !canRetry || typeof api.retryStaticSession !== 'function') return;
    setRetrying(true);
    setError(null);
    try {
      const retried = await api.retryStaticSession(projectId, session.id, { refreshSourceManifest: false });
      if (!retried?.id) throw new Error('The service did not return the retried review.');
      onNavigate({ name: 'review-activity', projectId, sessionId: retried.id, reviewName: retried.name });
    } catch (cause) {
      setError(userFacingError(cause, 'The review could not be retried. The original attempt is still available.'));
    } finally {
      setRetrying(false);
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
  if (!session || !viewModel) return <div className="screen review-activity-screen"><div className="command-inline-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /> <span>{error || 'Review activity could not be loaded.'}</span><button type="button" className="btn-link" onClick={() => void load()}>Try again</button></div></div>;

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
        title={`${session.name} ${formatEntityId(session.id)}`}
        status={{ label: state, tone: stateTone(state) }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
         actions={state === 'Need Approval' && !currentDecision ? headerActions : canRetry ? <button type="button" className="btn-primary" onClick={() => void retryReview()} disabled={!canRetry}><RotateCcw size={16} aria-hidden="true" /> {retrying ? 'Retrying…' : 'Retry review'}</button> : undefined}
      />

      {error && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {error}</div>}
      {evidenceAssessment && evidenceAssessment.readiness !== 'ready' && (
        <section className={`review-evidence-readiness is-${evidenceAssessment.readiness}`} aria-labelledby="review-evidence-readiness-heading" role={evidenceAssessment.readiness === 'blocked' ? 'alert' : 'status'}>
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <h2 id="review-evidence-readiness-heading">{evidenceAssessment.readiness === 'blocked' ? 'Evidence blocks this review' : 'Evidence needs attention'}</h2>
            <p>{evidenceAssessment.availableArtifactCount} of {evidenceAssessment.artifactCount} artifacts are currently available.</p>
            <ul>{evidenceAssessment.gaps.map(gap => <li key={gap.id}><strong>{gap.title}</strong><span>{gap.detail}</span><span className="review-evidence-remediation">Next: {gap.remediation}</span></li>)}</ul>
            {evidenceAssessment.contradictions.length > 0 && <div className="review-contradictions" aria-label="Conflicting evidence">
              <p>{evidenceAssessment.contradictions.length} possible evidence conflict{evidenceAssessment.contradictions.length === 1 ? '' : 's'} require a reviewer decision.</p>
              {evidenceAssessment.contradictions.map((conflict, index) => {
                const draft = contradictionDrafts[conflict.id] ?? { decision: 'not_conflict' as const, rationale: '' };
                return <div className="review-contradiction" key={conflict.id}>
                  <h3>Conflict {index + 1}</h3>
                  <blockquote><strong>Claim A</strong><p>{conflict.left.text}</p><small>{conflict.left.locator?.filePath ?? 'Source location unavailable'}{conflict.left.locator?.lineStart ? `:${conflict.left.locator.lineStart}` : ''}</small></blockquote>
                  <blockquote><strong>Claim B</strong><p>{conflict.right.text}</p><small>{conflict.right.locator?.filePath ?? 'Source location unavailable'}{conflict.right.locator?.lineStart ? `:${conflict.right.locator.lineStart}` : ''}</small></blockquote>
                  {conflict.disposition ? <p role="status"><strong>Resolved:</strong> {conflict.disposition.decision === 'authoritative_left' ? 'Claim A is authoritative' : conflict.disposition.decision === 'authoritative_right' ? 'Claim B is authoritative' : 'Not a conflict'}. {conflict.disposition.rationale}</p>
                    : session.status === 'blocked' && <div className="review-contradiction-form">
                      <fieldset><legend>How should this conflict be handled?</legend>
                        {([['authoritative_left', 'Claim A is authoritative'], ['authoritative_right', 'Claim B is authoritative'], ['not_conflict', 'These claims are not conflicting']] as const).map(([value, label]) =>
                          <label key={value}><input type="radio" name={`contradiction-${conflict.id}`} checked={draft.decision === value} onChange={() => setContradictionDrafts(previous => ({ ...previous, [conflict.id]: { ...draft, decision: value } }))} /> {label}</label>)}</fieldset>
                      <label htmlFor={`contradiction-rationale-${conflict.id}`}>Reason for this decision</label>
                      <textarea id={`contradiction-rationale-${conflict.id}`} value={draft.rationale} onChange={event => setContradictionDrafts(previous => ({ ...previous, [conflict.id]: { ...draft, rationale: event.target.value } }))} rows={3} maxLength={2000} />
                      <button type="button" className="btn-primary" onClick={() => void saveContradiction(conflict.id)} disabled={savingContradiction === conflict.id}>{savingContradiction === conflict.id ? 'Saving…' : 'Save evidence decision'}</button>
                    </div>}
                </div>;
              })}
              {contradictionNotice && <p role="status">{contradictionNotice}</p>}
            </div>}
          </div>
        </section>
      )}
      {preparedChild && preparedChild.status === 'prepared' && (
        <section className="review-iteration-ready" role="status" aria-labelledby="review-iteration-ready-heading">
          <div><History size={17} aria-hidden="true" /><div><h2 id="review-iteration-ready-heading">Revised review prepared</h2><p>{preparedChild.name} will {preparedChild.parentSessionId ? 'preserve its parent lineage and ' : ''}run only when you start it.</p></div></div>
          <button type="button" className="btn-primary" onClick={() => void startPreparedIteration()} disabled={startingIteration}>{startingIteration ? 'Starting…' : 'Start revised review'}</button>
        </section>
      )}
      {correlationSnapshot && (
        <section className="review-correlation-summary" aria-labelledby="review-correlation-heading">
          <div><h2 id="review-correlation-heading">Changes since parent review</h2><p>Finding lineage is based on stable identifiers and disclosed matching rules.</p></div>
          <dl>{(['new', 'recurring', 'carried_over', 'resolved', 'regressed'] as const).map(classification => <div key={classification}><dt>{classification.replace('_', ' ')}</dt><dd>{correlationSnapshot.counts[classification] ?? 0}</dd></div>)}</dl>
          {correlationSnapshot.ambiguities.length > 0 && <p className="review-history-unavailable" role="status">{correlationSnapshot.ambiguities.length} ambiguous match{correlationSnapshot.ambiguities.length === 1 ? '' : 'es'} require reviewer confirmation.</p>}
        </section>
      )}
      <ReviewTabs tabs={REVIEW_DETAIL_TABS} tab={tab} onTabChange={changeTab} onTabKeyDown={handleTabKeyDown} tabRefs={tabRefs} label="Review detail sections" />

      {tab === 'Overview' ? (
        <section id="review-result-panel-overview" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-overview">
          <ReviewResultOverview
            session={session}
            findings={findings}
            findingsError={findingsError}
            decisionsError={decisionsError}
            currentDecision={currentDecision}
            reviewer={reviewer}
            state={state}
            objective={objective}
            supportiveDocuments={objectiveDocuments}
            sourceManifest={sourceManifest}
            traceabilitySnapshot={traceabilitySnapshot}
            modelUsage={modelUsage}
            modelUsageError={modelUsageError}
            projectId={session.projectId}
            onNavigate={onNavigate}
            onOpenTraceability={() => {
              setTraceabilityFilter('attention');
              changeTab('Traceability');
            }}
          />
        </section>
      ) : tab === 'Activity' ? (
        <section id="review-result-panel-activity" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-activity">
          <ReviewActivityContent
            session={session}
            state={state}
            findingsError={findingsError}
            decisions={decisions}
            decisionsError={decisionsError}
            hasOlderDecisions={hasOlderDecisions}
            loadingOlderDecisions={loadingOlderDecisions}
            olderDecisionsError={olderDecisionsError}
            onLoadOlderDecisions={() => void loadOlderDecisions()}
            currentDecision={currentDecision}
          />
        </section>
      ) : tab === 'Findings' ? (
        <section id="review-result-panel-findings" className="review-detail-panel review-result-panel command-project-detail" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-findings">
          {state === 'In progress' || state === 'Queued'
            ? <ReviewWaitingPanel title="Findings" />
            : <FindingsPanel projectId={session.projectId} sessionId={session.id} presentation="project" pageSize={5} refreshKey={session.updatedAt} focusFindingId={focusFindingId} onLoadStateChange={handleFindingsLoadState} />}
        </section>
      ) : (
        <section id="review-result-panel-traceability" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-traceability">
          {state === 'In progress' || state === 'Queued' ? <ReviewWaitingPanel title="Traceability" /> : <Traceability requirements={requirements} mappings={requirementMappings} artifacts={artifacts} findings={findings} snapshot={traceabilitySnapshot} filter={traceabilityFilter} onFilterChange={setTraceabilityFilter} onOpenFinding={openFinding} />}
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
          sourceChoice={iterationSourceChoice}
          submitting={submitting === decisionIntent}
          onFeedbackChange={setDecisionFeedback}
          onSourceChoiceChange={setIterationSourceChoice}
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
          aria-controls={`review-result-panel-${item.toLowerCase()}`}
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
  hasOlderDecisions,
  loadingOlderDecisions,
  olderDecisionsError,
  onLoadOlderDecisions,
  currentDecision,
}: {
  session: StaticSession;
  state: ReviewLifecycleState;
  findingsError: string | null;
  decisions: ReviewDecisionRecord[];
  decisionsError: string | null;
  hasOlderDecisions: boolean;
  loadingOlderDecisions: boolean;
  olderDecisionsError: string | null;
  onLoadOlderDecisions: () => void;
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
        {decisions.length > 0 && <DecisionHistory decisions={decisions} hasOlder={hasOlderDecisions} loadingOlder={loadingOlderDecisions} olderError={olderDecisionsError} onLoadOlder={onLoadOlderDecisions} />}
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

function DecisionHistory({ decisions, hasOlder, loadingOlder, olderError, onLoadOlder }: { decisions: ReviewDecisionRecord[]; hasOlder: boolean; loadingOlder: boolean; olderError: string | null; onLoadOlder: () => void }) {
  return (
    <section className="review-decision-history" aria-labelledby="activity-history-heading">
      <div className="review-section-heading"><div><h2 id="activity-history-heading">Human decision history</h2><p>Human feedback is kept separate from the automated activity log.</p></div></div>
      {decisions.map(decision => <DecisionRecord key={decision.id} decision={decision} />)}
      {olderError && <p className="review-history-unavailable" role="alert">{olderError}</p>}
      {hasOlder && <button className="btn-secondary review-decision-history-more" type="button" onClick={onLoadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading older decisions…' : 'Load older decisions'}</button>}
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
  sourceChoice,
  submitting,
  onFeedbackChange,
  onSourceChoiceChange,
  onSubmit,
  onCancel,
}: {
  intent: DecisionIntent;
  reviewName: string;
  targetLabel: string;
  feedback: string;
  sourceChoice: 'reuse' | 'refresh';
  submitting: boolean;
  onFeedbackChange: (value: string) => void;
  onSourceChoiceChange: (value: 'reuse' | 'refresh') => void;
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
          {isReject && <fieldset className="review-iteration-source-choice">
            <legend>Evidence for the revised review</legend>
            <label><input type="radio" name="iteration-source-choice" value="reuse" checked={sourceChoice === 'reuse'} onChange={() => onSourceChoiceChange('reuse')} /> Reuse the frozen source manifest</label>
            <label><input type="radio" name="iteration-source-choice" value="refresh" checked={sourceChoice === 'refresh'} onChange={() => onSourceChoiceChange('refresh')} /> Refresh project sources before review</label>
          </fieldset>}
          <p className="review-decision-panel-note">{isReject ? 'This prepares an immutable child review. It will not call a model until you explicitly start it.' : 'This records an activity-level decision. It does not resolve or dismiss individual findings.'}</p>
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
  state,
  objective,
  supportiveDocuments,
  sourceManifest,
  traceabilitySnapshot,
  modelUsage,
  modelUsageError,
  projectId,
  onNavigate,
  onOpenTraceability,
}: {
  session: StaticSession;
  findings: Finding[];
  findingsError: string | null;
  decisionsError: string | null;
  currentDecision: ReviewDecisionRecord | null;
  reviewer: string | null;
  state: ReviewLifecycleState;
  objective: string | null;
  supportiveDocuments: SupportiveDocument[];
  sourceManifest: ReviewSourceManifest | null;
  traceabilitySnapshot: ReviewTraceabilitySnapshot | null;
  modelUsage: ReviewModelUsage | null;
  modelUsageError: string | null;
  projectId: string;
  onNavigate: (screen: Screen) => void;
  onOpenTraceability: () => void;
}) {
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);
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
  const objectiveText = objective || 'Not specified';
  const objectiveNeedsDisclosure = objectiveText.length > 280;
  const manifestAvailable = sourceManifest?.status === 'available' && sourceManifest.artifactCount != null;
  const traceabilityAvailable = traceabilitySnapshot?.status === 'available' && Boolean(traceabilitySnapshot.summary);
  const traceabilitySummary = traceabilitySnapshot?.summary;
  const traceabilityDetail = traceabilityAvailable && traceabilitySummary
    ? `${traceabilitySummary.missing} Missing · ${traceabilitySummary.incomplete} Incomplete`
    : 'Not available for this review';
  const carryoverCount = findings.filter(finding => finding.status === 'carryover').length;
  const usageTotals = modelUsage?.totals;
  const formatTokenCount = (value: number | undefined) => value == null ? '—' : value.toLocaleString();
  return (
    <div className="review-overview-grid">
      <section className="review-overview-main review-overview-card">
        <div className="review-overview-copy"><div className="review-overview-heading"><div className="review-overview-title"><h2>Review Overview</h2></div><StatusBadge label={state} tone={stateTone(state)} /></div></div>
        <div className="review-severity-grid review-session-metrics" aria-label="Review metrics"><button type="button" className="review-metric-link review-traceability-metric" onClick={onOpenTraceability} aria-label="View incomplete and missing requirements in Traceability"><strong>{waitingForEvidence ? '—' : traceabilityAvailable && traceabilitySummary ? String(traceabilitySummary.attention) : '—'}</strong><span>Traceability attention</span>{!waitingForEvidence && traceabilityAvailable && traceabilitySummary && <small>{traceabilityDetail}</small>}<span className="review-metric-link-action">View incomplete and missing requirements →</span></button><div><strong>{waitingForEvidence ? '—' : manifestAvailable ? String(sourceManifest?.artifactCount) : '—'}</strong><span>Artifacts reviewed</span></div><div className="review-severity-total"><strong>{metricValue(findings.length)}</strong><span>Reported findings</span>{!waitingForEvidence && !findingsError && carryoverCount > 0 && <small>{carryoverCount} carried over · {findings.length - carryoverCount} new</small>}</div></div>
        <section className="review-overview-objective" aria-labelledby="review-overview-objective-heading">
          <div className="review-overview-subheading">
            <h3 id="review-overview-objective-heading">Objective</h3>
            {objectiveNeedsDisclosure && <button type="button" className="command-icon-button" aria-label="Expand review objective" title="Expand review objective" aria-expanded={objectiveExpanded} onClick={() => setObjectiveExpanded(true)}><Expand size={16} aria-hidden="true" /></button>}
          </div>
          <p className={objectiveNeedsDisclosure ? 'review-overview-objective-text is-truncated' : 'review-overview-objective-text'}>{objectiveText}</p>
          {supportiveDocuments.length > 0 && <div className="review-source-tags" role="group" aria-label="Supportive documents">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}</div>}
        </section>
         <div className="review-overview-copy review-overview-summary"><h3>Summary</h3><p>{summary}</p></div>
         <section className="review-model-usage" aria-labelledby="review-model-usage-heading">
           <div className="review-overview-subheading"><h3 id="review-model-usage-heading">Model usage</h3><span className="review-meta-note">Provider-reported totals</span></div>
           {usageTotals ? <div className="review-model-usage-grid" aria-label="Per-review model usage"><div><strong>{formatTokenCount(usageTotals.calls)}</strong><span>Requests</span></div><div><strong>{formatTokenCount(usageTotals.input)}</strong><span>Input tokens</span></div><div><strong>{formatTokenCount(usageTotals.output)}</strong><span>Output tokens</span></div><div><strong>{formatTokenCount(usageTotals.cacheRead)}</strong><span>Cache reads</span></div><div><strong>{formatTokenCount(usageTotals.cacheCreation)}</strong><span>Cache creation</span></div></div> : <p className="review-history-unavailable" role="status">{modelUsageError || 'Model usage is not available for this review.'}</p>}
           {usageTotals && modelUsage?.byGroup && modelUsage.byGroup.length > 0 && <ul className="review-model-usage-groups" aria-label="Models used">{modelUsage.byGroup.map(group => <li key={`${group.provider}-${group.apiFormat}-${group.model}`}><span>{group.provider} · {group.model}</span><small>{group.totalCalls.toLocaleString()} request{group.totalCalls === 1 ? '' : 's'}</small></li>)}</ul>}
         </section>
         {findingsError && <p className="review-history-unavailable" role="status">Finding totals could not be loaded for this result.</p>}
      </section>
      <aside className="review-overview-rail review-decision-card"><h2>Decision</h2><dl><div><dt>Decision</dt><dd>{currentDecision ? decisionLabel(currentDecision.decision) : state === 'Need Approval' ? 'Pending approval' : waitingForEvidence ? 'Waiting for review' : 'Not supplied'}</dd></div><div><dt>Reviewer</dt><dd>{reviewer || 'Not supplied'}</dd></div><div><dt>Review scope</dt><dd>{reviewScope}</dd></div><div><dt>Completed</dt><dd>{waitingForEvidence ? 'Not yet' : completedAt ? formatReviewTimestamp(completedAt) : 'Not supplied'}</dd></div><div><dt>Duration</dt><dd>{duration}</dd></div></dl>{currentDecision?.comment && <div className="review-final-rationale"><h3>Decision rationale</h3><p>{currentDecision.comment}</p></div>}{decisionsError && <p className="review-history-unavailable">Decision history could not be loaded.</p>}</aside>
      <section className="review-overview-sources" aria-label="Review sources"><ArtifactsPanel projectId={projectId} onOpenSettings={() => onNavigate({ name: 'settings' })} /></section>
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
  snapshot,
  filter,
  onFilterChange,
  onOpenFinding,
}: {
  requirements: Requirement[];
  mappings: Record<string, RequirementMapping[]>;
  artifacts: Artifact[];
  findings: Finding[];
  snapshot: ReviewTraceabilitySnapshot | null;
  filter: TraceabilityFilter;
  onFilterChange: (filter: TraceabilityFilter) => void;
  onOpenFinding: (findingId: string) => void;
}) {
  const records = useMemo(() => traceabilityRecords(requirements, mappings, artifacts, findings), [artifacts, findings, mappings, requirements]);
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 5;
  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter(record => {
      const matchesQuery = !normalizedQuery || `${record.requirement.id} ${record.requirement.title} ${record.requirement.description} ${record.requirement.category}`.toLowerCase().includes(normalizedQuery);
      return matchesQuery && (filter === 'all' || (filter === 'attention' ? record.state !== 'complete' : record.state === filter));
    });
  }, [filter, query, records]);
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRecords = filteredRecords.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selectedRecord = records.find(record => record.requirement.id === selectedRequirementId) ?? records[0] ?? null;
  const selectRecord = (requirementId: string) => setSelectedRequirementId(requirementId);

  if (snapshot) {
    if (snapshot.status === 'available') {
      return <SnapshotTraceability snapshot={snapshot} artifacts={artifacts} findings={findings} filter={filter} onFilterChange={onFilterChange} onOpenFinding={onOpenFinding} />;
    }
    return <section className="review-traceability" aria-labelledby="review-traceability-heading"><div className="review-traceability-unavailable" role="status"><FileCheck2 size={22} aria-hidden="true" /><h2 id="review-traceability-heading">Traceability</h2><p>Traceability is not available for this review.</p><span>This Review predates the persisted traceability snapshot or the evidence could not be captured.</span></div></section>;
  }

  return (
    <section className="review-traceability" aria-labelledby="review-traceability-heading">
      <div className="review-traceability-layout">
        <div className="review-traceability-table-card">
          <div className="review-traceability-table-heading"><h2 id="review-traceability-heading"><FileCheck2 size={18} aria-hidden="true" /> Traceability</h2></div>
          <div className="review-traceability-toolbar" role="search" aria-label="Traceability filters">
            <label className="review-traceability-search"><span className="visually-hidden">Search traceability</span><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search traceability" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Requirement ID or name" /></label>
            <label className="review-traceability-state"><span className="visually-hidden">Traceability state</span><Select aria-label="Traceability state" value={filter} onChange={value => { onFilterChange(value as TraceabilityFilter); setPage(0); }} options={[{ value: 'all', label: 'All states' }, { value: 'attention', label: 'Incomplete and missing' }, { value: 'complete', label: 'Complete' }, { value: 'incomplete', label: 'Incomplete' }, { value: 'missing', label: 'Missing' }]} /></label>
          </div>
          <div className="review-traceability-table-wrap">
            <table className="review-traceability-table" aria-label="Traceability matrix">
              <thead><tr><th scope="col">ID</th><th scope="col">Requirement</th><th scope="col">State</th></tr></thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={3}><div className="review-traceability-empty" role="status"><FileCheck2 size={22} aria-hidden="true" /><span>{records.length === 0 ? 'No requirement mappings are available for this review yet. Add requirements and map their source evidence to populate this matrix.' : 'No traceability items match the current filters.'}</span></div></td></tr>
                ) : pagedRecords.map(record => (
                  <tr key={record.requirement.id} tabIndex={0} aria-selected={selectedRecord?.requirement.id === record.requirement.id} className={selectedRecord?.requirement.id === record.requirement.id ? 'selected' : undefined} onClick={() => selectRecord(record.requirement.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRecord(record.requirement.id); } }}>
                    <td><span className="finding-id-label" title={entityIdTitle('Requirement ID:', record.requirement.id)}>{formatEntityId(record.requirement.id)}</span></td>
                    <td><button type="button" className="traceability-requirement-link" onClick={event => { event.stopPropagation(); selectRecord(record.requirement.id); }}><strong>{record.requirement.title}</strong><span>{formatEntityId(record.requirement.id)} · {record.requirement.category || 'Requirement'}</span></button></td>
                    <td><TraceabilityStateBadge state={record.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredRecords.length > 0 && <nav className="review-traceability-pagination" aria-label="Traceability pages"><span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filteredRecords.length)} of {filteredRecords.length}</span><span><button type="button" className="btn-secondary" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={safePage === 0}>Previous</button><span>Page {safePage + 1} of {pageCount}</span><button type="button" className="btn-secondary" onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} disabled={safePage >= pageCount - 1}>Next</button></span></nav>}
        </div>
        <aside className="review-traceability-detail" aria-label="Traceability details">
          {selectedRecord ? <>
            <div className="review-traceability-detail-heading"><div><span className="command-eyebrow">Requirement</span><h3>{selectedRecord.requirement.title}</h3><span className="finding-id-label" title={entityIdTitle('Requirement ID:', selectedRecord.requirement.id)}>{formatEntityId(selectedRecord.requirement.id)}</span></div><TraceabilityStateBadge state={selectedRecord.state} /></div>
            <section><h4>Requirement sentence</h4><p className="review-traceability-detail-description">{selectedRecord.requirement.description || 'No requirement description was supplied.'}</p></section>
            <section><h4>Requirement reference</h4>{selectedRecord.sources.filter(source => source.type !== 'source_code').length > 0 ? <div className="traceability-detail-list">{selectedRecord.sources.filter(source => source.type !== 'source_code').map(source => <span key={source.id} className="traceability-source-tag" title={source.filePath || source.fileName}>{source.fileName || source.filePath}</span>)}</div> : <p className="traceability-muted">No requirement reference is linked.</p>}</section>
            <section><h4>Implementation reference</h4>{selectedRecord.sources.filter(source => source.type === 'source_code').length > 0 ? <div className="traceability-detail-list">{selectedRecord.sources.filter(source => source.type === 'source_code').map(source => <span key={source.id} className="traceability-source-tag" title={source.filePath || source.fileName}>{source.fileName || source.filePath}</span>)}</div> : <p className="traceability-muted">No implementation evidence is linked.</p>}</section>
            <section><h4>Linked findings</h4>{selectedRecord.findings.length > 0 ? <div className="traceability-detail-list">{selectedRecord.findings.map(finding => <button key={finding.id} type="button" className="traceability-detail-finding" title={entityIdTitle(finding.title, finding.id)} aria-label={`Open finding ${formatEntityId(finding.id)}: ${finding.title}`} onClick={() => onOpenFinding(finding.id)}>{formatEntityId(finding.id)}</button>)}</div> : <p className="traceability-muted">No findings are linked to this requirement.</p>}</section>
          </> : <div className="review-traceability-detail-empty">Select a requirement to review its evidence links.</div>}
        </aside>
      </div>
    </section>
  );
}

function SnapshotTraceability({
  snapshot,
  artifacts,
  findings,
  filter,
  onFilterChange,
  onOpenFinding,
}: {
  snapshot: ReviewTraceabilitySnapshot;
  artifacts: Artifact[];
  findings: Finding[];
  filter: TraceabilityFilter;
  onFilterChange: (filter: TraceabilityFilter) => void;
  onOpenFinding: (findingId: string) => void;
}) {
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const filteredRecords = snapshot.records.filter(record => filter === 'all' || (filter === 'attention' ? record.state !== 'complete' : record.state === filter));
  const selected = filteredRecords.find(record => record.requirementId === selectedRequirementId) ?? filteredRecords[0] ?? null;
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const selectedSourceReferences = selected
    ? [...selected.sourceArtifactIds.map(id => artifactsById.get(id)?.fileName || formatEntityId(id)), ...(selected.sourceSymbolIds ?? []).map(id => `Symbol ${formatEntityId(id)}`)]
    : [];
  return (
    <section className="review-traceability" aria-labelledby="review-traceability-heading">
      <div className="review-traceability-layout">
        <div className="review-traceability-table-card">
          <div className="review-traceability-table-heading"><h2 id="review-traceability-heading"><FileCheck2 size={18} aria-hidden="true" /> Traceability</h2><span className="panel-count">{snapshot.summary?.attention ?? '—'} needing attention</span></div>
          <div className="review-traceability-toolbar" role="search" aria-label="Traceability filters"><label className="review-traceability-state"><span className="visually-hidden">Traceability state</span><Select aria-label="Traceability state" value={filter} onChange={value => onFilterChange(value as TraceabilityFilter)} options={[{ value: 'all', label: 'All states' }, { value: 'attention', label: 'Incomplete and missing' }, { value: 'complete', label: 'Complete' }, { value: 'incomplete', label: 'Incomplete' }, { value: 'missing', label: 'Missing' }]} /></label></div>
          <div className="review-traceability-table-wrap"><table className="review-traceability-table" aria-label="Traceability matrix"><thead><tr><th scope="col">ID</th><th scope="col">Requirement</th><th scope="col">State</th></tr></thead><tbody>{filteredRecords.length === 0 ? <tr><td colSpan={3}><div className="review-traceability-empty" role="status">{snapshot.records.length === 0 ? 'No requirement records were captured for this review.' : 'No traceability items match the current filters.'}</div></td></tr> : filteredRecords.map(record => <tr key={record.requirementId} tabIndex={0} aria-selected={selected?.requirementId === record.requirementId} className={selected?.requirementId === record.requirementId ? 'selected' : undefined} onClick={() => setSelectedRequirementId(record.requirementId)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedRequirementId(record.requirementId); } }}><td><span className="finding-id-label" title={entityIdTitle('Requirement ID:', record.requirementId)}>{formatEntityId(record.requirementId)}</span></td><td><button type="button" className="traceability-requirement-link" onClick={event => { event.stopPropagation(); setSelectedRequirementId(record.requirementId); }}><strong>{record.title}</strong><span>{formatEntityId(record.requirementId)} · {record.category || 'Requirement'}</span></button></td><td><TraceabilityStateBadge state={record.state} /></td></tr>)}</tbody></table></div>
        </div>
        <aside className="review-traceability-detail" aria-label="Traceability details">{selected ? <><div className="review-traceability-detail-heading"><div><span className="command-eyebrow">Requirement</span><h3>{selected.title}</h3><span className="finding-id-label" title={entityIdTitle('Requirement ID:', selected.requirementId)}>{formatEntityId(selected.requirementId)}</span></div><TraceabilityStateBadge state={selected.state} /></div><section><h4>Requirement sentence</h4><p className="review-traceability-detail-description">{selected.description || 'No requirement description was supplied.'}</p></section><section><h4>Implementation reference</h4>{selectedSourceReferences.length > 0 ? <div className="traceability-detail-list">{selectedSourceReferences.map((reference, index) => <span key={`${reference}-${index}`} className="traceability-source-tag">{reference}</span>)}</div> : <p className="traceability-muted">No implementation evidence is linked.</p>}</section><section><h4>Linked findings</h4>{findings.filter(finding => finding.artifactId && selected.sourceArtifactIds.includes(finding.artifactId)).length > 0 ? <div className="traceability-detail-list">{findings.filter(finding => finding.artifactId && selected.sourceArtifactIds.includes(finding.artifactId)).map(finding => <button key={finding.id} type="button" className="traceability-detail-finding" title={entityIdTitle(finding.title, finding.id)} aria-label={`Open finding ${formatEntityId(finding.id)}: ${finding.title}`} onClick={() => onOpenFinding(finding.id)}>{formatEntityId(finding.id)}</button>)}</div> : <p className="traceability-muted">No findings are linked to this requirement.</p>}</section></> : <div className="review-traceability-detail-empty">No traceability records are available for this review.</div>}</aside>
      </div>
    </section>
  );
}

function TraceabilityStateBadge({ state }: { state: TraceabilityState }) {
  return <span className={`traceability-state-badge traceability-state-${state}`}>{traceabilityStateLabel(state)}</span>;
}

function DecisionRecord({ decision }: { decision: ReviewDecisionRecord }) {
  return <article className="review-human-history-record"><MessageSquare size={14} aria-hidden="true" /><div><strong>{decisionLabel(decision.decision)}</strong><p>{decision.comment || 'No written rationale was supplied.'}</p>{decision.attachments && decision.attachments.length > 0 && <div className="review-source-tags" role="group" aria-label="Feedback attachments">{decision.attachments.map(attachment => <DecisionAttachmentAction key={attachment.id} decision={decision} attachment={attachment} />)}</div>}<span>{decision.reviewer || 'Reviewer not supplied'} · {formatReviewTimestamp(decision.createdAt) || 'Time not supplied'}</span></div></article>;
}

function DecisionAttachmentAction({ decision, attachment }: { decision: ReviewDecisionRecord; attachment: NonNullable<ReviewDecisionRecord['attachments']>[number] }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedUrl || expiresAt === null) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      setSignedUrl(null);
      setError('Download link expired. Request a new one.');
      return;
    }
    const timeout = window.setTimeout(() => {
      setSignedUrl(null);
      setError('Download link expired. Request a new one.');
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [signedUrl, expiresAt]);

  async function prepareDownload() {
    setLoading(true);
    setError(null);
    setSignedUrl(null);
    try {
      const result = await api.getReviewDecisionAttachmentDownload(decision.projectId, decision.sessionId, decision.id, attachment.id);
      const url = new URL(result.signedUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported download link');
      const nextExpiry = Date.parse(result.expiresAt);
      if (!Number.isFinite(nextExpiry) || nextExpiry <= Date.now()) throw new Error('Expired download link');
      setExpiresAt(nextExpiry);
      setSignedUrl(url.toString());
    } catch {
      setError('Could not prepare the download link. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return <div className="review-decision-attachment" aria-live="polite">
    <button type="button" className="review-source-tag review-source-tag-action" title={attachment.fileName} aria-label={`${signedUrl ? 'Refresh' : 'Get'} download link for ${attachment.fileName}`} onClick={() => void prepareDownload()} disabled={loading}>
      <Paperclip size={14} aria-hidden="true" /> {loading ? 'Preparing…' : attachment.fileName}
    </button>
    {signedUrl && <a className="review-decision-attachment-link" href={signedUrl} target="_blank" rel="noopener noreferrer" download>Download {attachment.fileName}</a>}
    {error && <span className="review-decision-attachment-error" role="alert">{error}</span>}
  </div>;
}
