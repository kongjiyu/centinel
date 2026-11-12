import { reviewHandover } from '../reviewHandover';
import { setVisibleInterval, setVisibleTimeout } from '../hooks/usePageVisible';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, History, List, MessageSquare, Paperclip, RotateCcw, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { readReviewActivityPreview, rememberReviewActivity } from '../reviewActivityCache';
import { ReviewNarrativeTimeline, ReviewObjectiveList } from '../components/ReviewNarrative';
import { buildReviewNarrative, type ReviewNarrative } from '../reviewNarrative';
import { mergeReviewFindings, reviewEvidenceFindings, reviewTraceabilityFindings } from '../reviewEvidenceFindings';
import type { ReviewHarnessTrace } from '../reviewHarness';
import { findingRiskLevel } from '../components/FindingsPanel';
import { Modal } from '../components/Modal';
import { reviewCoverageGaps, unverifiedPartLocation, unverifiedPartReason } from '../reviewCoverage';
import { suggestedLinkCount } from '../requirementLinks';
import {
  awaitsReviewDecision,
  reviewLifecycleTone,
  createReviewActivityViewModel,
  isExecutedReviewStatus,
  formatReviewTimestamp,
  parseReviewConfig,
  truncateReviewSourceName,
  type ReviewLifecycleState,
} from '../reviewViewModel';
import type { Artifact, EvidenceSufficiencyAssessment, Finding, Project, RequirementMapping, ReviewDecisionRecord, ReviewSourceManifest, ReviewTraceabilitySnapshot, Screen, StaticSession } from '../types';
import { formatEntityId } from '../utils/entityId';
import { screenToHash } from '../navigation/screenHash';
import { reviewFailureMessage, userFacingError } from '../utils/userFacingError';
import './ReviewActivityScreen.css';

type Props = {
  accountId?: string | null;
  findingId?: string;
  initialTab?: 'Findings';
  projectId: string;
  sessionId: string;
  onNavigate: (screen: Screen) => void;
};

type EvidenceReadStatus = 'not-requested' | 'loading' | 'loaded' | 'unavailable' | 'failed';
type ReviewEvidenceReadState = {
  projectId: string | null;
  sessionId: string | null;
  findings: EvidenceReadStatus;
  sourceManifest: EvidenceReadStatus;
  traceability: EvidenceReadStatus;
};
type SupportiveDocument = { id: string; name: string };

type TraceabilityState = 'complete' | 'incomplete' | 'missing';

function reportNamePart(value: string | undefined, fallback: string) {
  const cleaned = value?.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)
    .replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '');
  return cleaned || fallback;
}

/** Collapse the validation dimensions into the single reviewer-facing state. */
export function traceabilityOverallState(states: TraceabilityState[]): TraceabilityState {
  if (states.includes('missing')) return 'missing';
  if (states.includes('incomplete')) return 'incomplete';
  return 'complete';
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

function hasExplicitReviewScope(session: StaticSession): { artifacts: boolean; requirements: boolean } {
  const config = parseReviewConfig(session);
  const savedScope = (session.scope ?? {}) as Record<string, unknown>;
  const readIds = (value: unknown) => Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim());
  return {
    artifacts: readIds(savedScope.artifactIds) || readIds(config.artifactIds) || readIds(config.selectedArtifactIds),
    requirements: readIds(savedScope.requirementIds) || readIds(config.requirementIds) || readIds(config.selectedRequirementIds),
  };
}

const EVIDENCE_GAP_PREVIEW = 3;
type EvidenceGap = EvidenceSufficiencyAssessment['gaps'][number];

/** Show gaps that share a title and next step once, so repeated per-requirement gaps stay readable. */
function groupEvidenceGaps(gaps: EvidenceGap[]): Array<{ title: string; remediation: string; gaps: EvidenceGap[] }> {
  const groups = new Map<string, { title: string; remediation: string; gaps: EvidenceGap[] }>();
  for (const gap of gaps) {
    const key = `${gap.title}\u0000${gap.remediation}`;
    const group = groups.get(key);
    if (group) group.gaps.push(gap);
    else groups.set(key, { title: gap.title, remediation: gap.remediation, gaps: [gap] });
  }
  return [...groups.values()];
}

function createRetryIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ReviewActivityScreen({ accountId, findingId, initialTab, projectId, sessionId, onNavigate }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<StaticSession | null>(null);
  const [storedFindings, setFindings] = useState<Finding[]>([]);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [evidenceReads, setEvidenceReads] = useState<ReviewEvidenceReadState>({
    projectId: null, sessionId: null, findings: 'not-requested', sourceManifest: 'not-requested', traceability: 'not-requested',
  });
  const evidenceRequestSequence = useRef(0);
  const screenRequestSequence = useRef(0);
  const activeScreenRead = useRef<{ identity: string; requestId: number } | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [requirementMappings, setRequirementMappings] = useState<Record<string, RequirementMapping[]>>({});
  const [sourceManifest, setSourceManifest] = useState<ReviewSourceManifest | null>(null);
  const [traceabilitySnapshot, setTraceabilitySnapshot] = useState<ReviewTraceabilitySnapshot | null>(null);
  const [harnessTrace, setHarnessTrace] = useState<ReviewHarnessTrace | null>(null);
  const [harnessLoading, setHarnessLoading] = useState(false);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecisionRecord[]>([]);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const [decisionOffset, setDecisionOffset] = useState(0);
  const [hasOlderDecisions, setHasOlderDecisions] = useState(false);
  const [loadingOlderDecisions, setLoadingOlderDecisions] = useState(false);
  const [olderDecisionsError, setOlderDecisionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [composerFeedback, setComposerFeedback] = useState('');
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryPanelOpen, setRetryPanelOpen] = useState(false);
  const [retryRequest, setRetryRequest] = useState<string | null>(null);
  const [retrySubmissionError, setRetrySubmissionError] = useState<string | null>(null);
  const [startingIteration, setStartingIteration] = useState(false);
  const [preparedChild, setPreparedChild] = useState<StaticSession | null>(null);
  const [evidenceAssessment, setEvidenceAssessment] = useState<EvidenceSufficiencyAssessment | null>(null);
  const evidenceFindings = useMemo(() => session ? reviewEvidenceFindings(session, evidenceAssessment) : [], [session, evidenceAssessment]);
  const [contradictionDrafts, setContradictionDrafts] = useState<Record<string, { decision: 'authoritative_left' | 'authoritative_right' | 'not_conflict'; rationale: string }>>({});
  const [savingContradiction, setSavingContradiction] = useState<string | null>(null);
  const [contradictionNotice, setContradictionNotice] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  const loadReviewEvidence = useCallback(async () => {
    const requestId = ++evidenceRequestSequence.current;
    const identity = { projectId, sessionId };
    const isCurrent = () => evidenceRequestSequence.current === requestId;
    setEvidenceReads(previous => ({
      projectId,
      sessionId,
      findings: previous.projectId === projectId && previous.sessionId === sessionId && previous.findings === 'loaded' ? 'loaded' : 'loading',
      sourceManifest: previous.projectId === projectId && previous.sessionId === sessionId && previous.sourceManifest === 'unavailable' ? 'unavailable' : 'loading',
      traceability: previous.projectId === projectId && previous.sessionId === sessionId && previous.traceability === 'unavailable' ? 'unavailable' : 'loading',
    }));

    const readFindings = async () => {
      try {
        if (typeof api.listStaticFindings !== 'function') throw new Error('Findings endpoint is unavailable.');
        const nextFindings = await api.listStaticFindings(projectId, sessionId);
        if (!Array.isArray(nextFindings) || nextFindings.some(finding => !finding || finding.projectId !== projectId || finding.sessionId !== sessionId)) {
          throw new Error('Findings identity mismatch.');
        }
        if (!isCurrent()) return;
        setFindings(nextFindings);
        setFindingsError(null);
        setEvidenceReads(previous => isCurrent() ? { ...previous, ...identity, findings: 'loaded' } : previous);
      } catch (cause) {
        if (!isCurrent()) return;
        setFindingsError(userFacingError(cause, 'Findings could not be loaded.'));
        setEvidenceReads(previous => ({ ...previous, ...identity, findings: 'failed' }));
      }
    };

    const readSourceManifest = async () => {
      if (typeof api.getReviewSourceManifest !== 'function') {
        if (isCurrent()) setEvidenceReads(previous => ({ ...previous, ...identity, sourceManifest: 'unavailable' }));
        return;
      }
      try {
        const nextManifest = await api.getReviewSourceManifest(projectId, sessionId);
        if (!nextManifest || nextManifest.projectId !== projectId || nextManifest.sessionId !== sessionId
          || !['available', 'unavailable', 'incomplete'].includes(nextManifest.status)
          || !Array.isArray(nextManifest.sources)
          || (nextManifest.artifactCount !== null && typeof nextManifest.artifactCount !== 'number')
          || nextManifest.sources.some(source => source.sessionId !== sessionId)
          || (nextManifest.artifacts !== undefined && !Array.isArray(nextManifest.artifacts))
          || (Array.isArray(nextManifest.artifacts) && nextManifest.artifacts.some(artifact => !artifact || typeof artifact.id !== 'string' || typeof artifact.fileName !== 'string' || typeof artifact.filePath !== 'string' || typeof artifact.contentHash !== 'string'))
          || (Array.isArray(nextManifest.artifacts) && nextManifest.artifactCount !== null && nextManifest.artifactCount !== nextManifest.artifacts.length)) {
          throw new Error('Source manifest identity or shape is invalid.');
        }
        if (!isCurrent()) return;
        setSourceManifest(nextManifest);
        setEvidenceReads(previous => isCurrent() ? { ...previous, ...identity, sourceManifest: nextManifest.status === 'unavailable' ? 'unavailable' : 'loaded' } : previous);
      } catch {
        if (!isCurrent()) return;
        setEvidenceReads(previous => ({ ...previous, ...identity, sourceManifest: 'failed' }));
      }
    };

    const readTraceability = async () => {
      if (typeof api.getReviewTraceability !== 'function') {
        if (isCurrent()) setEvidenceReads(previous => ({ ...previous, ...identity, traceability: 'unavailable' }));
        return;
      }
      try {
        const nextSnapshot = await api.getReviewTraceability(projectId, sessionId);
        if (!nextSnapshot || nextSnapshot.projectId !== projectId || nextSnapshot.sessionId !== sessionId
          || !['available', 'unavailable'].includes(nextSnapshot.status)
          || !Array.isArray(nextSnapshot.records)
          || (nextSnapshot.status === 'available' && (!nextSnapshot.summary || ['complete', 'incomplete', 'missing', 'attention'].some(key => typeof nextSnapshot.summary?.[key as keyof typeof nextSnapshot.summary] !== 'number')))) {
          throw new Error('Traceability identity or shape is invalid.');
        }
        if (!isCurrent()) return;
        setTraceabilitySnapshot(nextSnapshot);
        setEvidenceReads(previous => isCurrent() ? { ...previous, ...identity, traceability: nextSnapshot.status === 'unavailable' ? 'unavailable' : 'loaded' } : previous);
      } catch {
        if (!isCurrent()) return;
        setEvidenceReads(previous => ({ ...previous, ...identity, traceability: 'failed' }));
      }
    };

    await Promise.all([readFindings(), readSourceManifest(), readTraceability()]);
  }, [projectId, sessionId]);

  const load = useCallback(async ({ silent = false, foreground = false }: { silent?: boolean; foreground?: boolean } = {}) => {
    const identity = `${projectId}:${sessionId}`;
    if ((silent || foreground) && activeScreenRead.current?.identity === identity) return;
    const loadRequestId = ++screenRequestSequence.current;
    activeScreenRead.current = { identity, requestId: loadRequestId };
    const isCurrentLoad = () => screenRequestSequence.current === loadRequestId;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [projectResult, sessionResult] = await Promise.all([
        api.project(projectId),
        api.getStaticSession(projectId, sessionId),
      ]);
      if (!isCurrentLoad()) return;
      if (sessionResult.projectId === projectId && sessionResult.id === sessionId) rememberReviewActivity(accountId, sessionResult);
      setProject(projectResult);
      setSession(sessionResult);
      // Show the workspace while evidence loads; its independent gate keeps
      // decisions disabled and makes a stalled evidence request discoverable.
      if (!silent) setLoading(false);
      await loadReviewEvidence();
      if (!isCurrentLoad()) return;

      try {
        const firstDecisions = await api.listReviewDecisions(projectId, sessionId);
        if (!isCurrentLoad()) return;
        setDecisions(firstDecisions);
        setDecisionOffset(firstDecisions.length);
        setHasOlderDecisions(firstDecisions.length === 50);
        setOlderDecisionsError(null);
        setDecisionsError(null);
      } catch (cause) {
        if (!isCurrentLoad()) return;
        setDecisions([]);
        setDecisionOffset(0);
        setHasOlderDecisions(false);
        setOlderDecisionsError(null);
        setDecisionsError(userFacingError(cause, 'Decision history could not be loaded.'));
      }

      if (typeof api.getReviewEvidenceSufficiency === 'function') {
        try {
          const value = await api.getReviewEvidenceSufficiency(projectId, sessionId);
          if (!isCurrentLoad()) return;
          setEvidenceAssessment(value?.reviewId === sessionId && value.projectId === projectId && Array.isArray(value.gaps) && Array.isArray(value.contradictions) ? value : null);
        }
        catch { if (isCurrentLoad()) setEvidenceAssessment(null); }
      }
      if (typeof api.listStaticSessions === 'function') {
        try {
          const children = (await api.listStaticSessions(projectId)).filter(item => item.parentSessionId === sessionId);
          if (!isCurrentLoad()) return;
          setPreparedChild(children.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null);
        } catch { /* child discovery is additive */ }
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
          if (!isCurrentLoad()) return;
          setArtifacts(nextArtifacts);
          if (typeof api.listRequirementMappings === 'function') {
            const mappingEntries = await Promise.all(nextRequirements.map(async requirement => {
              try {
                return [requirement.id, await api.listRequirementMappings(projectId, requirement.id)] as const;
              } catch {
                return [requirement.id, []] as const;
              }
            }));
            if (!isCurrentLoad()) return;
            setRequirementMappings(Object.fromEntries(mappingEntries));
          } else {
            setRequirementMappings({});
          }
        } catch {
          if (!isCurrentLoad()) return;
          setArtifacts([]);
          setRequirementMappings({});
        }
      }
    } catch (cause) {
      if (isCurrentLoad()) setError(userFacingError(cause, 'Review activity could not be loaded.'));
    } finally {
      if (activeScreenRead.current?.requestId === loadRequestId) activeScreenRead.current = null;
      if (isCurrentLoad() && !silent) setLoading(false);
    }
  }, [accountId, loadReviewEvidence, projectId, sessionId]);

  useEffect(() => {
    void load();
    return () => { screenRequestSequence.current += 1; };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') {
        void load({ foreground: true, silent: session?.id === sessionId && session.projectId === projectId });
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, projectId, sessionId, session?.id, session?.projectId]);

  useEffect(() => () => { evidenceRequestSequence.current += 1; }, [projectId, sessionId]);

  // The durable runner records a flat checkpoint plus step events. Fetch its
  // evidence independently so legacy progress cannot hide the saved activity.
  useEffect(() => {
    let disposed = false;
    let reading = false;
    let cancelTimer: (() => void) | undefined;
    setHarnessTrace(null);
    setHarnessError(null);
    setHarnessLoading(false);
    if (typeof api.getReviewHarness !== 'function') return;
    setHarnessLoading(true);
    const refresh = async () => {
      if (reading) return;
      reading = true;
      cancelTimer?.();
      try {
        const trace = await api.getReviewHarness(projectId, sessionId);
        if (disposed) return;
        if (trace.review.id !== sessionId) throw new Error('Review history mismatch');
        setHarnessTrace(trace);
        setHarnessError(null);
        if (trace.review.status === 'queued' || trace.review.status === 'running') cancelTimer = setVisibleTimeout(() => void refresh(), 1500);
      } catch {
        if (!disposed) {
          setHarnessError('Saved execution details could not be loaded. Reopen the review to try again; finding evidence remains available.');
          if (session?.status === 'queued' || session?.status === 'running') cancelTimer = setVisibleTimeout(() => void refresh(), 3000);
        }
      } finally {
        reading = false;
        if (!disposed) setHarnessLoading(false);
      }
    };
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    void refresh();
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      disposed = true;
      cancelTimer?.();
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [projectId, sessionId, session?.status]);

  useEffect(() => {
    if (!session || (session.status !== 'queued' && session.status !== 'running')) return undefined;
    return setVisibleInterval(() => { void load({ silent: true }); }, 1500);
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

  const findings = useMemo(() => mergeReviewFindings(storedFindings, [
    ...evidenceFindings,
    ...(session && isExecutedReviewStatus(session.status) ? reviewTraceabilityFindings(session, traceabilitySnapshot, harnessTrace?.analysisMap, storedFindings) : []),
  ]), [storedFindings, evidenceFindings, session, traceabilitySnapshot, harnessTrace?.analysisMap]);
  const embeddedDecision = session?.currentDecision;
  const currentDecision = embeddedDecision && embeddedDecision.decision !== 'commented'
    ? embeddedDecision
    : decisions.find(decision => decision.decision !== 'commented') ?? null;
  const evidenceMatchesCurrent = evidenceReads.projectId === projectId && evidenceReads.sessionId === sessionId;
  const currentEvidenceReads = evidenceMatchesCurrent ? evidenceReads : {
    projectId: null, sessionId: null, findings: 'not-requested' as const,
    sourceManifest: 'not-requested' as const, traceability: 'not-requested' as const,
  };
  const viewModel = session
    ? createReviewActivityViewModel(session, findings, decisions, currentDecision)
    : null;
  const state = viewModel?.state ?? 'In progress';
  const narrative = useMemo(() => session ? buildReviewNarrative({
    session, trace: harnessTrace, findings, findingsError, findingsLoading: currentEvidenceReads.findings === 'not-requested' || currentEvidenceReads.findings === 'loading',
    assessment: evidenceAssessment, traceability: traceabilitySnapshot, decision: currentDecision,
  }) : null, [session, harnessTrace, findings, findingsError, currentEvidenceReads.findings, evidenceAssessment, traceabilitySnapshot, currentDecision]);
  const config = session ? parseReviewConfig(session) : {};
  const isCurrentSession = Boolean(session && session.id === sessionId && session.projectId === projectId);
  const explicitScope = session ? hasExplicitReviewScope(session) : { artifacts: false, requirements: false };
  const evidenceReadStates = [currentEvidenceReads.findings, currentEvidenceReads.sourceManifest, currentEvidenceReads.traceability];
  const evidenceReadFailed = evidenceReadStates.includes('failed');
  const evidenceReadPending = evidenceReadStates.some(status => status === 'not-requested' || status === 'loading');
  const decisionEvidenceIssue = !evidenceMatchesCurrent || evidenceReadPending
    ? 'Review evidence is still loading. Approval is available after the required evidence loads.'
    : evidenceReadFailed
      ? 'Required Review evidence could not be loaded. Retry evidence before making a decision.'
      : sourceManifest?.status === 'incomplete'
        ? 'The saved source manifest is incomplete, so the reviewed scope cannot be verified for a decision.'
        : sourceManifest?.status === 'available' && sourceManifest.artifactCount == null
          ? 'The saved source manifest has no verified artifact count, so the reviewed scope cannot be verified for a decision.'
          : currentEvidenceReads.sourceManifest === 'unavailable' && explicitScope.artifacts
            ? 'This legacy Review has an explicit artifact selection but no saved source manifest, so its scope cannot be verified for a decision.'
            : currentEvidenceReads.traceability === 'unavailable' && explicitScope.requirements
              ? 'This legacy Review has an explicit requirement selection but no saved traceability evidence, so its scope cannot be verified for a decision.'
              : null;
  const canDecide = isCurrentSession && awaitsReviewDecision(state) && !currentDecision && !submitting && !findingsError && !decisionEvidenceIssue;
  const canCancel = Boolean(session && (session.status === 'queued' || session.status === 'running')) && !cancelling;
  const retryable = Boolean(session && (session.status === 'failure' || session.status === 'failed' || session.status === 'blocked' || session.status === 'cancelled'));
  const canRetry = retryable && !retrying;

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
  const coverageGaps = session ? reviewCoverageGaps(session) : null;
  const suggestedLinks = suggestedLinkCount(requirementMappings);
  const objective = viewModel?.objective ?? null;
  const objectiveDocuments = supportiveDocuments(config);
  const findingsTarget = (id?: string): Screen => ({
    name: 'project-detail', projectId, initialSection: 'findings', findingsReviewId: sessionId, ...(id ? { findingId: id } : {}),
  });
  const openFinding = (id: string) => onNavigate(findingsTarget(id));
  useEffect(() => {
    if (findingId || initialTab === 'Findings') onNavigate(findingsTarget(findingId));
  }, [findingId, initialTab, onNavigate, projectId, sessionId]);

  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const submitApproval = async () => {
    if (!session || !approvalOpen || !canDecide) return;
    setSubmitting(true);
    setApprovalError(null);
    try {
      await api.submitReviewDecision(projectId, session.id, { decision: 'approved' });
      setApprovalOpen(false);
      await load();
    } catch (cause) {
      setApprovalError(userFacingError(cause, 'The review decision could not be saved.'));
    } finally {
      setSubmitting(false);
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

  const openRetryPanel = () => {
    if (!session || !canRetry) return;
    setRetryRequest(null);
    setRetrySubmissionError(null);
    setRetryPanelOpen(true);
    setError(null);
  };

  const retryReview = async () => {
    if (!session || !canRetry || typeof api.retryStaticSession !== 'function') return;
    const request = retryRequest ?? createRetryIdempotencyKey();
    setRetryRequest(request);
    setRetrying(true);
    setRetrySubmissionError(null);
    try {
      const retried = await api.retryStaticSession(projectId, session.id, {
        refreshSourceManifest: true,
        idempotencyKey: request,
      });
      if (!retried?.id) throw new Error('The service did not return the retried review.');
      onNavigate({ name: 'review-activity', projectId, sessionId: retried.id, reviewName: retried.name });
    } catch (cause) {
      setRetrySubmissionError(userFacingError(cause, 'The retry request could not be created. The original attempt remains available.'));
    } finally {
      setRetrying(false);
    }
  };

  if (loading || (session && !isCurrentSession)) {
    const preview = readReviewActivityPreview(accountId, projectId, sessionId);
    return <div className="screen review-activity-screen">
      {preview ? <section className="review-activity-surface" aria-label="Last saved Review activity">
        <h2>Last saved Review activity</h2>
        <p role="status">Checking for current progress. Saved at {formatReviewTimestamp(preview.updatedAt)}.</p>
        <ol className="review-activity-timeline">{preview.stages.map(stage => (
          <li key={stage.id} className="review-narrative-stage">
            <div className="review-stage-heading"><h3>{stage.title}</h3><span>{stage.status}</span></div>
          </li>
        ))}</ol>
      </section> : <LoadingSkeleton variant="rows" rows={5} label="Loading review activity" />}
    </div>;
  }
  if (!session || !viewModel) return <div className="screen review-activity-screen"><div className="command-inline-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /> <span>{error || 'Review activity could not be loaded.'}</span><button type="button" className="btn-link" onClick={() => void load()}>Try again</button></div></div>;
  const showApproval = awaitsReviewDecision(state) && !currentDecision;
  const executed = isExecutedReviewStatus(session.status);
  const exportReviewReport = async () => {
    if (reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const { markdown } = await api.exportProjectReport(projectId, { reviewId: session.id });
      if (!markdown) throw new Error('The Review report did not contain Markdown.');
      const filename = `Centinel_${reportNamePart(project?.name, 'Project')}_${reportNamePart(session.name, 'Review')}_report.md`;
      if (typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function') {
        const destination = await save({ title: 'Save Review report', defaultPath: filename, filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (destination) await writeTextFile(destination, markdown);
      } else {
        const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setReportError(userFacingError(cause, 'The Review report could not be exported.'));
    } finally {
      setReportBusy(false);
    }
  };
  const blockerCount = approvalOpen
    ? reviewHandover({ findings, findingsError, state, manifest: sourceManifest, traceability: traceabilitySnapshot, assessment: evidenceAssessment }).blockers.length
    : 0;

  return (
    <div className={`screen command-review-activity review-activity-screen${awaitsReviewDecision(state) ? ' has-feedback-composer' : ''}`}>
      <CommandPageHeader
        eyebrow={`Review / ${project?.name || 'Project'}`}
        title={`${session.name} ${formatEntityId(session.id)}`}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        actions={executed || showApproval ? <section className="review-activity-actions" aria-label={showApproval ? 'Review decision actions' : 'Review follow-up actions'}>
          {executed && <button type="button" className="btn-secondary" onClick={() => void exportReviewReport()} disabled={reportBusy}><Download size={15} aria-hidden="true" /> {reportBusy ? 'Exporting…' : 'Export report'}</button>}
          {showApproval && <button data-testid="review-decision-approve" className="btn-primary" type="button" onClick={() => { setApprovalError(null); setApprovalOpen(true); }} disabled={!canDecide}><CheckCircle2 size={15} aria-hidden="true" /> Approve review</button>}
        </section> : canRetry ? <button type="button" className="btn-primary" onClick={openRetryPanel}><RotateCcw size={16} aria-hidden="true" /> {state === 'Paused' ? 'Resume review' : 'Retry review'}</button> : undefined}
      />

      {error && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {error}</div>}
      {reportError && <div className="command-inline-alert" role="alert"><AlertCircle size={15} aria-hidden="true" /> {reportError}</div>}
      {coverageGaps && (
        <section className="review-evidence-readiness is-ready_with_warnings review-coverage-gaps" aria-labelledby="review-coverage-gaps-heading" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <h2 id="review-coverage-gaps-heading">Completed with gaps</h2>
            <p>The verified checks and findings are ready to inspect. {coverageGaps.total} part{coverageGaps.total === 1 ? '' : 's'} of the code could not be verified, so {coverageGaps.total === 1 ? 'it has' : 'they have'} no clean result and cannot close earlier findings.</p>
            {coverageGaps.parts.length > 0 && <ul aria-label="Parts that could not be verified">{coverageGaps.parts.map((part, index) => <li key={`${part.reason}-${index}`}>
              <strong>{unverifiedPartLocation(part)}</strong>
              <span>{unverifiedPartReason(part)}</span>
            </li>)}</ul>}
            {coverageGaps.total > coverageGaps.parts.length && <p>{coverageGaps.total - coverageGaps.parts.length} more part{coverageGaps.total - coverageGaps.parts.length === 1 ? ' is' : 's are'} listed in Activity.</p>}
            <span className="review-evidence-remediation">Check the listed parts before approving the Review.</span>
          </div>
        </section>
      )}
      {awaitsReviewDecision(state) && !currentDecision && decisionEvidenceIssue && !approvalOpen && (
        <section className={`review-evidence-decision-gate${evidenceReadFailed ? ' is-failed' : ''}`} role={evidenceReadFailed || sourceManifest?.status === 'incomplete' ? 'alert' : 'status'} aria-label="Decision evidence status">
          <div><strong>{evidenceReadFailed ? 'Decision evidence needs attention' : 'Decision evidence is unavailable'}</strong><p>{decisionEvidenceIssue}</p></div>
          {evidenceReadFailed && <button type="button" className="btn-secondary" onClick={() => void loadReviewEvidence()} disabled={evidenceReadPending}>{evidenceReadPending ? 'Retrying evidence…' : 'Retry evidence'}</button>}
        </section>
      )}
      {evidenceAssessment && evidenceAssessment.readiness !== 'ready' && (
        <section className={`review-evidence-readiness is-${evidenceAssessment.readiness}`} aria-labelledby="review-evidence-readiness-heading" role={evidenceAssessment.readiness === 'blocked' ? 'alert' : 'status'}>
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <h2 id="review-evidence-readiness-heading">{evidenceAssessment.readiness === 'blocked' ? 'Evidence blocks this review' : 'Evidence needs attention'}</h2>
            <p>{evidenceAssessment.availableArtifactCount} of {evidenceAssessment.artifactCount} artifacts are currently available.</p>
            <ul>{groupEvidenceGaps(evidenceAssessment.gaps).map(group => group.gaps[0].code === 'traceability_mappings_incomplete' ? <li key={group.gaps[0].id} className="review-requirement-links-gap">
              <strong>{group.title}</strong>
              <span>{suggestedLinks > 0
                ? `Centinel suggested ${suggestedLinks} link${suggestedLinks === 1 ? '' : 's'} from this review's evidence — confirm them so requirement coverage can be checked.`
                : `${group.gaps.length} requirement${group.gaps.length === 1 ? ' is' : 's are'} not linked to code yet.`}</span>
              <button type="button" className="btn-link" onClick={() => onNavigate({ name: 'requirements', projectId })}>{suggestedLinks > 0 ? 'Confirm suggested links' : 'Link requirements to code'}</button>
            </li> : <li key={group.gaps[0].id}>
              <strong>{group.title}{group.gaps.length > 1 ? ` (${group.gaps.length})` : ''}</strong>
              {group.gaps.length === 1 ? <span>{group.gaps[0].detail}</span> : <>
                <ul className="review-evidence-gap-items">{group.gaps.slice(0, EVIDENCE_GAP_PREVIEW).map(gap => <li key={gap.id}>{gap.detail}</li>)}</ul>
                {group.gaps.length > EVIDENCE_GAP_PREVIEW && <details className="review-evidence-gap-more"><summary>Show {group.gaps.length - EVIDENCE_GAP_PREVIEW} more</summary>
                  <ul className="review-evidence-gap-items">{group.gaps.slice(EVIDENCE_GAP_PREVIEW).map(gap => <li key={gap.id}>{gap.detail}</li>)}</ul></details>}
              </>}
              <span className="review-evidence-remediation">Next: {group.remediation}</span></li>)}</ul>
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
      <Modal isOpen={retryPanelOpen && retryable} title="Retry review?" width={440} onClose={retrying ? () => undefined : () => setRetryPanelOpen(false)}>
        <p>Start a new attempt with the latest available versions of the selected sources?</p>
        {retrySubmissionError && <p className="form-error" role="alert">{retrySubmissionError}</p>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => setRetryPanelOpen(false)} disabled={retrying} data-autofocus>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void retryReview()} disabled={retrying}>{retrying ? 'Starting review…' : 'Retry review'}</button>
        </div>
      </Modal>
          <ReviewActivityContent
            onOpenSettings={() => onNavigate({ name: 'settings' })}
            liveEvents={harnessTrace?.events}
            onViewAll={() => onNavigate(findingsTarget())}
            onCancel={session.status === 'queued' || session.status === 'running' ? () => void cancelReview() : undefined}
            cancelling={cancelling}
            objective={objective}
            supportiveDocuments={objectiveDocuments}
            narrative={narrative!}
            sourceManifest={sourceManifest}
            projectArtifacts={artifacts}
            findings={findings}
            onOpenFinding={openFinding}
            harnessLoading={harnessLoading}
            harnessError={harnessError}
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
      {awaitsReviewDecision(state) && (
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

      <Modal isOpen={approvalOpen && showApproval} title="Approve review?" width={520} descriptionId="review-approval-description" onClose={() => { if (!submitting) setApprovalOpen(false); }}>
        <div className="review-approval-context">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <span>{project?.name || 'Project'}</span>
            <strong>{session.name}</strong>
            <small className="mono">{formatEntityId(session.id)}</small>
          </div>
        </div>
        <p id="review-approval-description" className="review-approval-description">Confirm to record your approval for this Review.</p>
        {blockerCount > 0 && <div className="review-approval-warning">
          <ShieldAlert size={18} aria-hidden="true" />
          <p>{blockerCount} confirmed {blockerCount === 1 ? 'blocker will remain open' : 'blockers will remain open'} after approval.</p>
        </div>}
        {(approvalError || decisionEvidenceIssue) && <p className="form-error" role="alert">{approvalError || decisionEvidenceIssue}</p>}
        {evidenceReadFailed && <button type="button" className="btn-link" onClick={() => void loadReviewEvidence()}>Retry evidence</button>}
        <div className="form-actions review-approval-actions">
          <button type="button" className="btn-secondary" data-autofocus disabled={submitting} onClick={() => setApprovalOpen(false)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!canDecide} onClick={() => void submitApproval()}>{submitting ? 'Approving…' : 'Confirm approval'}</button>
        </div>
      </Modal>
    </div>
  );
}

function ReviewActivityContent({
  onOpenFinding, liveEvents, onViewAll, onCancel, cancelling, objective, supportiveDocuments,
  narrative,
  sourceManifest,
  projectArtifacts,
  findings,
  harnessLoading,
  harnessError,
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
  onOpenSettings,
}: {
  onOpenSettings: () => void;
  onOpenFinding: (id: string) => void;
  liveEvents?: ReviewHarnessTrace['events'];
  onViewAll: () => void;
  onCancel?: () => void;
  cancelling: boolean;
  objective: string | null;
  supportiveDocuments: SupportiveDocument[];
  narrative: ReviewNarrative;
  sourceManifest: ReviewSourceManifest | null;
  projectArtifacts: Artifact[];
  findings: Finding[];
  harnessLoading: boolean;
  harnessError: string | null;
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
  const savedTitles = new Set(findings.map(finding => finding.title));
  const liveFindings = session.status === 'running' ? (liveEvents ?? []).flatMap(event =>
    event.reviewId === session.id && event.event === 'review_live_finding_titles' && Array.isArray(event.detail?.titles)
      ? event.detail.titles.slice(0, 5).reverse().flatMap((title, index) => typeof title === 'string' && title.length <= 160 && !savedTitles.has(title)
        ? [{ key: `${event.id ?? event.createdAt}:${index}`, title, time: event.createdAt, findingId: undefined }]
        : [])
      : []) : [];
  const recentFindings = [...findings.map(finding => ({
    key: finding.id, title: finding.title, time: finding.createdAt, findingId: finding.id,
  })), ...new Map(liveFindings.map(finding => [finding.title, finding])).values()]
    .sort((a, b) => b.time.localeCompare(a.time)).slice(0, 5);
  const reviewedTime = state === 'Completed' ? narrative.timing.endedAt : null;
  const config = parseReviewConfig(session);
  const knownSources = sourceManifest?.artifacts?.length ? sourceManifest.artifacts : projectArtifacts;
  const resolveSource = (path: string) => {
    const normalized = path.replaceAll('\\', '/');
    const exact = knownSources.filter(file => file.filePath.replaceAll('\\', '/') === normalized);
    const matches = exact.length || normalized.includes('/') ? exact : knownSources.filter(file => file.fileName === normalized);
    const file = matches.length === 1 ? matches[0] : undefined;
    return file ? { path: file.filePath, href: screenToHash({ name: 'project-detail', projectId: session.projectId, initialSection: 'source', sourceArtifactId: file.id }) } : { path };
  };
  return (
    <div className="review-activity-body">
      <section className="review-activity-surface" aria-label="Review activity conversation">
        <div className="review-activity-surface-heading">
          <h2>Overview</h2>

        </div>
        <ReviewNarrativeTimeline key={session.id} narrative={narrative} findings={findings} loading={harnessLoading} error={harnessError} onOpenFinding={onOpenFinding} resolveSource={resolveSource} liveFindings={liveFindings} />
        {(state === 'Blocked' || state === 'Paused') && <div className="review-blocked-message" role="alert"><ShieldAlert size={17} aria-hidden="true" /><div><strong>{state === 'Paused' ? 'Review paused' : 'Review needs attention'}</strong><p>{reviewFailureMessage(session.failureReason)}</p></div></div>}
        {state === 'Failed' && <div className="review-failed-message" role="alert"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review failed</strong><p>{reviewFailureMessage(session.failureReason)}</p>{/model provider|provider unavailable|no model/i.test(session.failureReason ?? '') && <button type="button" className="btn-secondary" onClick={onOpenSettings}>Open Settings</button>}</div></div>}
        {state === 'Cancelled' && <div className="review-cancelled-message" role="status"><X size={17} aria-hidden="true" /><div><strong>Review cancelled</strong><p>The activity stopped before a completed result was recorded.</p></div></div>}
        {currentDecision && (
          <div className="review-decision-recorded" role="status">
            <History size={15} aria-hidden="true" />
            <div><strong>{decisionLabel(currentDecision.decision)}</strong><p>{currentDecision.comment || 'No written rationale was supplied.'} This activity decision is recorded separately from finding status.</p></div>
          </div>
        )}
        {decisionsError && <p className="review-history-unavailable" role="status">Decision history could not be loaded. The activity data above remains available.</p>}
        {decisions.length > 0 && <DecisionHistory decisions={decisions} hasOlder={hasOlderDecisions} loadingOlder={loadingOlderDecisions} olderError={olderDecisionsError} onLoadOlder={onLoadOlderDecisions} />}
        {findingsError && <p className="review-history-unavailable" role="status">Findings could not be loaded. Decisions are disabled until the evidence can be reloaded.</p>}
      </section>
      <aside className="review-activity-metadata" aria-label="Review details">
        <section><h3>Version</h3>
            {sourceManifest?.gitRefs?.map(ref => {
              const branch = ref.commit === config.repositoryRevision && typeof config.repositoryBranch === 'string' ? config.repositoryBranch : ref.branch;
              return <div key={JSON.stringify([ref.repository, ref.commit, ref.branch])}>
                <span>{ref.repository}</span>{branch && <code>{branch}</code>} <code title={ref.commit}>{ref.commit.slice(0, 12)}</code>{ref.subject && <span>{ref.subject}</span>}
              </div>;
            })}
            {sourceManifest?.snapshotId && (!sourceManifest.gitRefs?.length || Boolean(sourceManifest.snapshotOnlyFileCount)) && <div>Snapshot <code>{sourceManifest.snapshotId}</code></div>}
            {!sourceManifest?.snapshotId && !sourceManifest?.gitRefs?.length && 'Unavailable'}
        </section>
        <section><h3>State</h3>{state === 'Need Approval' ? <span>{state}</span> : <StatusBadge label={state} tone={reviewLifecycleTone(state)} />}</section>
        <section><h3>Findings</h3>
          <div aria-live="polite">
            {recentFindings.length > 0 ? <ul aria-label="Recent findings">{recentFindings.map(({ key, title, findingId }) => (
              <li key={key} className="review-sidebar-finding">
                <button type="button" className="review-sidebar-finding-jump" onClick={() => {
                  const target = document.getElementById(`review-finding-${key}`);
                  target?.focus({ preventScroll: true });
                  target?.scrollIntoView?.({ block: 'center' });
                }}>{title}</button>
                {findingId && <button type="button" className="command-icon-button" aria-label={`Open finding detail: ${title}`}
                  title="Open finding detail" onClick={() => onOpenFinding(findingId)}><ExternalLink size={16} aria-hidden="true" /></button>}
              </li>
            ))}</ul> : <p>{findingsError ? 'Findings unavailable' : 'No findings recorded yet'}</p>}
          </div>
          <button type="button" className="btn-secondary" onClick={onViewAll}><List size={16} aria-hidden="true" /> All Findings</button>
        </section>
        <section><h3>Risk</h3><dl>
          {['Critical', 'High', 'Medium', 'Low'].map(level => <div key={level}><dt>{level}</dt><dd>{findingsError ? '—' : findings.filter(finding => findingRiskLevel(finding)?.toLowerCase() === level.toLowerCase()).length}</dd></div>)}
        </dl></section>
        <section><h3>Review</h3><dl>
          <div><dt>Review scope</dt><dd>{config.scopeMode === 'focused' ? 'Focused Review' : 'Full Review'}</dd></div>
          <div><dt>Duration</dt><dd>{narrative.timing.duration}</dd></div>
          <div><dt>Source files reviewed</dt><dd>{narrative.reviewedSourceCount ?? '—'}</dd></div>
          <div><dt>Reviewed time</dt><dd>{reviewedTime ? formatReviewTimestamp(reviewedTime) : ''}</dd></div>
        </dl>
          {objective && <section className="review-overview-objective" aria-label="Goal">
            <h3>Goal</h3><ReviewObjectiveList points={narrative.objectives} />
            {supportiveDocuments.length > 0 && <div className="review-source-tags" aria-label="References">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name}>{document.name}</span>)}</div>}
          </section>}
        </section>
        {onCancel && <section><button className="btn-secondary" type="button" onClick={onCancel} disabled={cancelling}><X size={15} aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel review'}</button></section>}
      </aside>
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
        <div className="review-feedback-entry"><textarea ref={inputRef} id="review-feedback-message" rows={expanded ? 3 : 1} value={value} onFocus={() => setExpanded(true)} onBlur={() => { if (!value.trim() && files.length === 0) setExpanded(false); }} onChange={event => onChange(event.target.value)} placeholder="Write feedback…" />
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
