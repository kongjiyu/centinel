import { reviewHandover } from '../reviewHandover';
import { setVisibleInterval, setVisibleTimeout } from '../hooks/usePageVisible';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Expand, FileCheck2, History, MessageSquare, Paperclip, RotateCcw, Search, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { readReviewActivityPreview, rememberReviewActivity } from '../reviewActivityCache';
import { ReviewNarrativeTimeline, ReviewObjectiveList } from '../components/ReviewNarrative';
import { buildReviewNarrative, objectivePoints, type ReviewNarrative } from '../reviewNarrative';
import { mergeReviewFindings, reviewEvidenceFindings } from '../reviewEvidenceFindings';
import type { ReviewAnalysisMap, ReviewHarnessTrace } from '../reviewHarness';
import { ReviewUseCaseDetails } from '../components/ReviewUseCases';
import { featureDisplayName, groupReviewFeatures, type ReviewFeatureGroup } from '../reviewFeatures';
import { FindingsPanel } from '../components/FindingsPanel';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { reviewCoverageGaps, unverifiedPartLocation, unverifiedPartReason } from '../reviewCoverage';
import { confirmedMappingsByRequirement, suggestedLinkCount } from '../requirementLinks';
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
import type { Artifact, EvidenceSufficiencyAssessment, Finding, Project, Requirement, RequirementMapping, ReviewDecisionRecord, ReviewSourceManifest, ReviewTraceabilityRecord, ReviewTraceabilitySnapshot, Screen, StaticSession } from '../types';
import { entityIdTitle, formatEntityId } from '../utils/entityId';
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

type Tab = 'Overview' | 'Activity' | 'Findings' | 'Traceability';
type EvidenceReadStatus = 'not-requested' | 'loading' | 'loaded' | 'unavailable' | 'failed';
type ReviewEvidenceReadState = {
  projectId: string | null;
  sessionId: string | null;
  findings: EvidenceReadStatus;
  sourceManifest: EvidenceReadStatus;
  traceability: EvidenceReadStatus;
};
type SupportiveDocument = { id: string; name: string };

const REVIEW_DETAIL_TABS: Tab[] = ['Overview', 'Activity', 'Findings', 'Traceability'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
type TraceabilityState = 'complete' | 'incomplete' | 'missing';
type TraceabilityFilter = 'all' | 'attention' | TraceableState;

type TraceabilityRecord = {
  requirement: Requirement;
  sources: Artifact[];
  findings: Finding[];
  state: TraceabilityState;
};

function reportNamePart(value: string | undefined, fallback: string) {
  const cleaned = value?.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)
    .replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '');
  return cleaned || fallback;
}

function traceabilityStateLabel(state: TraceableState) {
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
      sources: mappedArtifacts,
      findings: relatedFindings,
      state: traceabilityOverallState([completeness, correctness, consistency]),
    };
  });
}

const stateTone = reviewLifecycleTone;

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
  const resultTabStorageKey = `centinel:review-result-tab:${projectId}:${sessionId}`;
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
  const [requirements, setRequirements] = useState<Requirement[]>([]);
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
  const [tab, setTab] = useState<Tab>(() => {
    if (initialTab === 'Findings') return initialTab;
    try {
      const stored = window.sessionStorage.getItem(resultTabStorageKey) as Tab | null;
      return stored && REVIEW_DETAIL_TABS.includes(stored) ? stored : 'Overview';
    } catch {
      return 'Overview';
    }
  });
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
  const findings = useMemo(() => mergeReviewFindings(storedFindings, evidenceFindings), [storedFindings, evidenceFindings]);
  const [contradictionDrafts, setContradictionDrafts] = useState<Record<string, { decision: 'authoritative_left' | 'authoritative_right' | 'not_conflict'; rationale: string }>>({});
  const [savingContradiction, setSavingContradiction] = useState<string | null>(null);
  const [contradictionNotice, setContradictionNotice] = useState<string | null>(null);
  const [traceabilityFilter, setTraceabilityFilter] = useState<TraceabilityFilter>('all');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement>>>({});
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
            if (!isCurrentLoad()) return;
            setRequirementMappings(Object.fromEntries(mappingEntries));
          } else {
            setRequirementMappings({});
          }
        } catch {
          if (!isCurrentLoad()) return;
          setRequirements([]);
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
  const featureGroups = useMemo(() => harnessTrace?.analysisMap
    ? groupReviewFeatures(harnessTrace.analysisMap, findings, traceabilitySnapshot)
    : [], [harnessTrace?.analysisMap, findings, traceabilitySnapshot]);
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
  const confirmedRequirementMappings = useMemo(() => confirmedMappingsByRequirement(requirementMappings), [requirementMappings]);
  const suggestedLinks = suggestedLinkCount(requirementMappings);
  const objective = viewModel?.objective ?? null;
  const objectiveDocuments = supportiveDocuments(config);
  const reviewer = currentDecision?.reviewer || (typeof config.reviewer === 'string' && config.reviewer.trim() ? config.reviewer.trim() : null);
  const openFinding = (id: string) => onNavigate({ name: 'review-finding', projectId, sessionId, findingId: id, reviewName: session?.name });

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
  }, [session?.id, state]);

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
  const findingRead = { findings, loading: currentEvidenceReads.findings !== 'loaded' && !findings.length && !findingsError, error: findingsError, refresh: loadReviewEvidence };
  const findingsReadOnly = state === 'In progress' || state === 'Queued';
  if (findingId) return <div className="screen review-finding-screen">
    <FindingsPanel readOnly={findingsReadOnly} projectId={session.projectId} sessionId={session.id}
      presentation="project" featureGroups={featureGroups} focusFindingId={findingId} reviewRead={findingRead}
      onBackToFindings={() => onNavigate({ name: 'review-activity', projectId, sessionId, reviewName: session.name, initialTab: 'Findings' })} />
  </div>;

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
    <div className={`screen command-review-activity review-activity-screen${awaitsReviewDecision(state) && tab === 'Activity' ? ' has-feedback-composer' : ''}`}>
      <CommandPageHeader
        eyebrow={`Review / ${project?.name || 'Project'}`}
        title={`${session.name} ${formatEntityId(session.id)}`}
        status={{ label: state, tone: stateTone(state) }}
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
      <ReviewTabs tabs={REVIEW_DETAIL_TABS} tab={tab} onTabChange={changeTab} onTabKeyDown={handleTabKeyDown} tabRefs={tabRefs} label="Review detail sections" />

      {tab === 'Overview' ? (
        <section id="review-result-panel-overview" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-overview">
          <ReviewResultOverview
            narrative={narrative!}
            evidenceReady={currentEvidenceReads.findings === 'loaded' && currentEvidenceReads.sourceManifest === 'loaded' && currentEvidenceReads.traceability === 'loaded' && !harnessLoading && !harnessError}
            analysisMap={harnessTrace?.analysisMap}
            assessment={evidenceAssessment}
            onOpenFinding={openFinding}
            onOpenActivity={() => changeTab('Activity')}
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
            onOpenTraceability={() => {
              setTraceabilityFilter('attention');
              changeTab('Traceability');
            }}
          />
        </section>
      ) : tab === 'Activity' ? (
        <section id="review-result-panel-activity" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-activity">
          <ReviewActivityContent
            onOpenSettings={() => onNavigate({ name: 'settings' })}
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
        </section>
      ) : tab === 'Findings' ? (
        <section id="review-result-panel-findings" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-findings">
          <FindingsPanel key={session.id} readOnly={findingsReadOnly} projectId={session.projectId} sessionId={session.id} presentation="project" featureGroups={featureGroups} pageSize={5} onOpenFinding={openFinding} reviewRead={findingRead} />
        </section>
      ) : (
        <section id="review-result-panel-traceability" className="review-detail-panel review-result-panel" role="tabpanel" tabIndex={0} aria-labelledby="review-result-tab-traceability">
          {!harnessTrace?.analysisMap && (state === 'In progress' || state === 'Queued')
            ? <ReviewWaitingPanel title="Traceability" />
            : <Traceability key={session.id} requirements={requirements} mappings={confirmedRequirementMappings} artifacts={artifacts} findings={findings} snapshot={traceabilitySnapshot} readStatus={currentEvidenceReads.traceability} featureGroups={featureGroups} map={harnessTrace?.analysisMap} filter={traceabilityFilter} onFilterChange={setTraceabilityFilter} onOpenFinding={openFinding} />}
        </section>
      )}

      {canCancel && (
        <div className="review-decision-dock">
          <button className="btn-secondary" type="button" onClick={() => void cancelReview()} disabled={!canCancel}>
            <X size={15} aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel review'}
          </button>
        </div>
      )}

      {awaitsReviewDecision(state) && tab === 'Activity' && (
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
  onOpenFinding,
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
  const scope = session.scope;
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
          <h2>Review activity</h2>
        </div>
        <ReviewNarrativeTimeline key={session.id} narrative={narrative} findings={findings} loading={harnessLoading} error={harnessError} onOpenFinding={onOpenFinding} resolveSource={resolveSource} />
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
      <aside className="review-activity-metadata review-decision-card" aria-label="Review details">
        <dl>
          <div className="review-activity-source-count"><dt>Source files reviewed</dt><dd><strong>{narrative.reviewedSourceCount ?? '—'}</strong></dd></div>
          <div><dt>Source reference</dt><dd>
            {sourceManifest?.gitRefs?.map(ref => {
              const branch = ref.commit === config.repositoryRevision && typeof config.repositoryBranch === 'string' ? config.repositoryBranch : ref.branch;
              return <div key={JSON.stringify([ref.repository, ref.commit, ref.branch])}>
                <span>{ref.repository}</span>{branch && <code>{branch}</code>} <code title={ref.commit}>{ref.commit.slice(0, 12)}</code>{ref.subject && <span>{ref.subject}</span>}
              </div>;
            })}
            {sourceManifest?.snapshotId && (!sourceManifest.gitRefs?.length || Boolean(sourceManifest.snapshotOnlyFileCount)) && <div>Snapshot <code>{sourceManifest.snapshotId}</code></div>}
            {!sourceManifest?.snapshotId && !sourceManifest?.gitRefs?.length && 'Unavailable'}
          </dd></div>
          <div><dt>Review status</dt><dd><StatusBadge label={state} tone={reviewLifecycleTone(state)} />{narrative.timing.duration !== 'Not recorded' && <p>{narrative.timing.duration}</p>}</dd></div>
          <div><dt>Review scope</dt><dd>{scope ? `${scope.artifactIds?.length ?? 0} selected files · ${scope.requirementIds?.length ?? 0} requirements · ${scope.standardIds?.length ?? 0} standards` : 'No explicit scope recorded.'}</dd></div>
          <div><dt>Goal</dt><dd><ReviewObjectiveList points={narrative.objectives} /></dd></div>
        </dl>
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

function ReviewWaitingPanel({ title }: { title: string }) {
  return <section className="review-waiting-panel" role="status">
    <h2>{title}</h2>
    <p>—</p>
    <span>This section will be available when the review has produced evidence.</span>
  </section>;
}

function ReviewResultOverview({
  analysisMap, assessment, onOpenFinding, onOpenActivity, evidenceReady,
  narrative,
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
  onOpenTraceability,
}: {
  evidenceReady: boolean;
  analysisMap: ReviewHarnessTrace['analysisMap'];
  assessment: EvidenceSufficiencyAssessment | null;
  onOpenFinding: (id: string) => void;
  onOpenActivity: () => void;
  narrative: ReviewNarrative;
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
  onOpenTraceability: () => void;
}) {
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);
  const endedAt = narrative.timing.endedAt;
  const executionTimeLabel = state === 'Paused' ? 'Paused at'
    : ['Failed', 'Blocked', 'Cancelled'].includes(state) ? 'Stopped at' : 'Execution finished';
  const duration = narrative.timing.duration;
  const config = parseReviewConfig(session);
  const reviewMode = typeof config.reviewMode === 'string' ? config.reviewMode : '';
  const pullRequest = typeof config.pullRequest === 'string' ? config.pullRequest : '';
  const reviewScope = config.scopeMode === 'focused' ? 'Focused review'
    : config.scopeMode === 'full' ? 'Full review'
      : pullRequest ? 'Pull Request (PR Review)' : reviewMode === 'changed-files' ? 'Change File Review' : 'Full Scope Review';
  const waitingForEvidence = state === 'In progress' || state === 'Queued';
  const metricValue = (value: number) => findingsError || waitingForEvidence ? '—' : String(value);
  const objectiveText = objective || 'Not specified';
  const objectiveNeedsDisclosure = objectiveText.length > 280 || narrative.objectives.length > 2;
  const traceabilityAvailable = traceabilitySnapshot?.status === 'available' && Boolean(traceabilitySnapshot.summary) && traceabilitySnapshot.records.length > 0;
  const traceabilitySummary = traceabilitySnapshot?.summary;
  const traceabilityDetail = traceabilityAvailable && traceabilitySummary
    ? `${traceabilitySummary.missing} Missing · ${traceabilitySummary.incomplete} Incomplete`
    : 'Not available for this review';
  const handover = reviewHandover({ findings, findingsError, evidenceReady, state, executionStatus: session.status, modelStatus: session.modelStatus, manifest: sourceManifest, traceability: traceabilitySnapshot, assessment, map: analysisMap });
  const completedStages = narrative.stages.filter(stage => stage.state === 'Completed');
  const pendingStages = narrative.stages.filter(stage => stage.state !== 'Completed');
  const carryoverCount = findings.filter(finding => finding.status === 'carryover').length;
  return (
    <div className="review-overview-grid">
      <section className="review-overview-main review-overview-card">
        <div className="review-overview-heading"><div><span className="command-eyebrow">Handover recommendation</span><h2>{handover.recommendation}</h2>{narrative.objectives[0] && <p className="review-purpose">{narrative.objectives[0]}</p>}</div><StatusBadge label={state} tone={stateTone(state)} /></div>
        <section className="review-next-actions" aria-label="Next actions">
          <h3>What to do next</h3>
          {findingsError ? <p>Reload findings before deciding.</p> : <ol>
            {[
              ...handover.blockers.map(finding => ({ finding, label: 'Confirmed blocker' })),
              ...handover.risks.map(finding => ({ finding, label: 'Remaining risk' })),
              ...handover.gaps.map(finding => ({ finding, label: 'Evidence gap' })),
            ].slice(0, 3).map(({ finding, label }) => <li key={finding.id}><strong>{label}</strong><button className="btn-link" onClick={() => onOpenFinding(finding.id)}>{finding.recommendation || finding.title}</button></li>)}
            {handover.blockers.length + handover.risks.length + handover.gaps.length < 3 && handover.reasons.length > 0 && <li><strong>Evidence gap</strong><button className="btn-link" onClick={onOpenActivity}>{handover.reasons[0]} View coverage and activity →</button></li>}
          </ol>}
          {!findingsError && !handover.blockers.length && !handover.risks.length && !handover.gaps.length && !handover.reasons.length && <p>No outstanding actions in the recorded scope.</p>}
        </section>
        <section className="review-overview-summary" aria-label="Review summary">
          <h3>What this review established</h3>
          <dl className="review-narrative-summary">
            <div><dt>Completed work</dt><dd>{completedStages.length ? completedStages.map(stage => stage.title).join(' · ') : 'No completed assessment stages are recorded.'}</dd></div>
            <div><dt>Requirements</dt><dd>{traceabilityAvailable ? `${traceabilitySnapshot!.records.length} identified. See Traceability for links and coverage.` : assessment?.confirmedRequirementCount === 0 ? 'Requirements not identified. Code checks are reported separately.' : 'Requirement coverage unavailable.'}</dd></div>
            <div><dt>Results</dt><dd>{findingsError ? 'Findings unavailable.' : `${findings.length} reported findings: ${handover.blockers.length} confirmed blockers, ${handover.risks.length} remaining risks and ${handover.gaps.length} needing evidence verification.`}</dd></div>
            {pendingStages.length > 0 && <div><dt>Not completed</dt><dd>{pendingStages.map(stage => `${stage.title} (${stage.state.toLowerCase()})`).join(' · ')}</dd></div>}
            {session.failureReason && <div><dt>Why it stopped</dt><dd>{reviewFailureMessage(session.failureReason)}</dd></div>}
          </dl>
          {handover.reasons.length > 0 && <details><summary>Coverage limits · {handover.reasons.length}</summary><ul>{handover.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
        </section>
        <div className="review-severity-grid review-session-metrics" aria-label="Review metrics"><button type="button" className="review-metric-link review-traceability-metric" onClick={onOpenTraceability} aria-label="View incomplete and missing requirements in Traceability"><strong>{waitingForEvidence ? '—' : traceabilityAvailable && traceabilitySummary ? String(traceabilitySummary.attention) : '—'}</strong><span>Traceability attention</span>{!waitingForEvidence && traceabilityAvailable && traceabilitySummary && <small>{traceabilityDetail}</small>}<span className="review-metric-link-action">View incomplete and missing requirements →</span></button><div className="review-severity-total"><strong>{metricValue(findings.length)}</strong><span>Reported findings</span>{!waitingForEvidence && !findingsError && carryoverCount > 0 && <small>{carryoverCount} carried over · {findings.length - carryoverCount} new</small>}</div></div>
        <section className="review-overview-objective" aria-labelledby="review-overview-objective-heading">
          <div className="review-overview-subheading">
            <h3 id="review-overview-objective-heading">Objective</h3>
            {objectiveNeedsDisclosure && <button type="button" className="command-icon-button" aria-label="Expand review objective" title="Expand review objective" aria-expanded={objectiveExpanded} onClick={() => setObjectiveExpanded(true)}><Expand size={16} aria-hidden="true" /></button>}
          </div>
          <ReviewObjectiveList points={narrative.objectives.slice(0, 2)} />
          {supportiveDocuments.length > 0 && <div className="review-source-tags" role="group" aria-label="Supportive documents">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}</div>}
        </section>

         {findingsError && <p className="review-history-unavailable" role="status">Finding totals could not be loaded for this result.</p>}
      </section>
      <aside className="review-overview-rail review-decision-card"><h2>Human decision</h2><dl><div><dt>Decision</dt><dd>{currentDecision ? decisionLabel(currentDecision.decision) : awaitsReviewDecision(state) ? 'Pending approval' : waitingForEvidence ? 'Waiting for review' : 'Not supplied'}</dd></div><div><dt>Reviewer</dt><dd>{reviewer || 'Not supplied'}</dd></div><div><dt>Review scope</dt><dd>{reviewScope}</dd></div><div><dt>{executionTimeLabel}</dt><dd>{waitingForEvidence ? 'Not yet' : endedAt ? formatReviewTimestamp(endedAt) : 'Not supplied'}</dd></div><div><dt>Duration</dt><dd>{duration}</dd></div></dl>{currentDecision?.comment && <div className="review-final-rationale"><h3>Decision rationale</h3><p>{currentDecision.comment}</p></div>}{decisionsError && <p className="review-history-unavailable">Decision history could not be loaded.</p>}</aside>
      <Modal isOpen={objectiveExpanded} onClose={() => setObjectiveExpanded(false)} title="Review objective" width={720}>
        <div className="review-objective-dialog-content"><ReviewObjectiveList points={objectivePoints(objective)} />{supportiveDocuments.length > 0 && <div className="review-source-tags" role="group" aria-label="Supportive documents">{supportiveDocuments.map(document => <span key={document.id} className="review-source-tag" title={document.name} aria-label={document.name}>{truncateReviewSourceName(document.name)}</span>)}</div>}</div>
      </Modal>
    </div>
  );
}

const TRACEABILITY_PAGE_SIZE = 5;
type TraceableState = TraceabilityState | 'unavailable';
type TraceableRequirement = Pick<ReviewTraceabilityRecord, 'requirementId' | 'title' | 'description' | 'category' | 'state' | 'evidenceStatus' | 'sourceArtifactIds'> & {
  references: string[];
  findings: Finding[];
};
type TraceableItem = { id: string; title: string; searchText: string; state: TraceableState } & (
  | { requirement: TraceableRequirement }
  | { featureGroup: ReviewFeatureGroup; requirements: TraceableRequirement[]; fileRequirements: TraceableRequirement[]; findings: Finding[] }
);

function traceabilityIdLabel(item: TraceableItem): string {
  // Analysis map IDs share a namespace, so shorten the hash instead of the prefix.
  const featureHash = 'featureGroup' in item ? /^feature-([a-f0-9]{8})[a-f0-9]+$/.exec(item.id)?.[1] : undefined;
  return formatEntityId(featureHash ?? item.id);
}

function Traceability({
  requirements,
  mappings,
  artifacts,
  findings,
  snapshot,
  readStatus,
  featureGroups,
  map,
  filter,
  onFilterChange,
  onOpenFinding,
}: {
  requirements: Requirement[];
  mappings: Record<string, RequirementMapping[]>;
  artifacts: Artifact[];
  findings: Finding[];
  snapshot: ReviewTraceabilitySnapshot | null;
  readStatus: EvidenceReadStatus;
  featureGroups: ReviewFeatureGroup[];
  map?: ReviewAnalysisMap | null;
  filter: TraceabilityFilter;
  onFilterChange: (filter: TraceabilityFilter) => void;
  onOpenFinding: (findingId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const items = useMemo(() => {
    const saved = snapshot?.status === 'available';
    const requirementRows: TraceableRequirement[] = saved
      ? snapshot.records.map(record => ({
        ...record,
        references: [
          ...record.sourceArtifactIds.map(id => `Saved artifact ${formatEntityId(id)}`),
          ...(record.sourceSymbolIds ?? []).map(id => `Symbol ${formatEntityId(id)}`),
        ],
        findings: findings.filter(finding => finding.requirementId === record.requirementId || (finding.artifactId && record.sourceArtifactIds.includes(finding.artifactId))),
      }))
      : !snapshot && !map && readStatus === 'unavailable'
        ? traceabilityRecords(requirements, mappings, artifacts, findings).map(record => ({
          ...record.requirement,
          requirementId: record.requirement.id,
          state: record.state,
          sourceArtifactIds: record.sources.map(source => source.id),
          references: record.sources.map(source => source.fileName || source.filePath),
          findings: record.findings,
        }))
        : [];

    const requirementsById = new Map(requirementRows.map(record => [record.requirementId, record]));
    const findingsByFeature = new Map<string, Finding[]>();
    for (const finding of findings) {
      const featureId = finding.location?.sourceLocator?.analysis?.featureId;
      if (!featureId) continue;
      const related = findingsByFeature.get(featureId) ?? [];
      related.push(finding);
      findingsByFeature.set(featureId, related);
    }
    const linkedRequirementIds = new Set<string>();
    const featureItems: TraceableItem[] = featureGroups.map(featureGroup => {
      const { feature, operations } = featureGroup;
      const relatedFindings = operations.flatMap(operation => {
        const paths = new Set(operation.paths.map(path => path.id));
        return (findingsByFeature.get(operation.id) ?? []).filter(finding => paths.has(finding.location?.sourceLocator?.analysis?.pathId ?? ''));
      });
      const linkedIds = new Set(relatedFindings.flatMap(finding => finding.requirementId ? [finding.requirementId] : []));
      const linked = [...linkedIds].flatMap(id => {
        const record = requirementsById.get(id);
        if (!record) return [];
        linkedRequirementIds.add(id);
        return [record];
      });
      const entryArtifacts = new Set(operations.flatMap(operation => operation.entryPoints.map(point => point.artifactId)));
      const mappedToEntry = (record: TraceableRequirement) => record.sourceArtifactIds.some(id => entryArtifacts.has(id));
      const fileRequirements = requirementRows.filter(record => !linkedIds.has(record.requirementId) && mappedToEntry(record));
      // A mapping on a shared file alone cannot verify an operation in that file.
      const state = !saved ? 'unavailable' : linked.length
        ? traceabilityOverallState(linked.map(record => record.state === 'complete' && (!mappedToEntry(record) || (record.evidenceStatus && record.evidenceStatus !== 'verified')) ? 'incomplete' : record.state))
        : fileRequirements.length ? 'incomplete' : 'missing';
      const title = featureDisplayName(feature.label);
      return {
        id: feature.id,
        title,
        state,
        featureGroup,
        requirements: linked,
        fileRequirements,
        findings: relatedFindings,
        searchText: [...operations.flatMap(operation => [operation.label, ...operation.paths.map(path => path.label)]), ...linked.map(record => record.title)].join(' '),
      };
    });
    return [...featureItems, ...requirementRows.filter(record => !linkedRequirementIds.has(record.requirementId)).map(record => ({
      id: record.requirementId,
      title: record.title,
      state: record.state,
      searchText: `${record.description} ${record.category}`,
      requirement: record,
    }))];
  }, [artifacts, featureGroups, findings, map, mappings, readStatus, requirements, snapshot]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = items.filter(item => `${item.id} ${item.title} ${item.searchText}`.toLowerCase().includes(normalizedQuery)
    && (filter === 'all' || (filter === 'attention' ? item.state === 'incomplete' || item.state === 'missing' : item.state === filter)));
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / TRACEABILITY_PAGE_SIZE) - 1));
  const visible = filtered.slice(safePage * TRACEABILITY_PAGE_SIZE, (safePage + 1) * TRACEABILITY_PAGE_SIZE);
  const selected = visible.find(item => item.id === selectedId) ?? (map?.features.length ? undefined : visible[0]);
  const unavailable = snapshot?.status === 'unavailable' || readStatus === 'unavailable' || readStatus === 'failed';

  return <section className="review-traceability" aria-labelledby="review-traceability-heading">
    <div className={selected ? 'review-traceability-layout' : undefined}>
      <div className="review-traceability-table-card">
        <div className="review-traceability-table-heading"><h2 id="review-traceability-heading"><FileCheck2 size={18} aria-hidden="true" /> Traceability</h2></div>
        {map?.coverage.featureInventoryTruncated && <p className="traceability-muted" role="status">Feature inventory limit reached.</p>}
        {unavailable && <p className="traceability-muted" role="status">{snapshot?.status === 'available'
          ? 'Saved requirement evidence could not be refreshed.'
          : 'Saved requirement evidence is unavailable for this Review.'}</p>}
        {snapshot?.status === 'available' && snapshot.records.length === 0 && <p className="traceability-muted">Requirements not identified.</p>}
        {readStatus === 'loading' && <p className="traceability-muted" role="status">Loading requirement evidence…</p>}
        <TraceabilityToolbar query={query} filter={filter} onQueryChange={value => { setQuery(value); setPage(0); }} onFilterChange={value => { onFilterChange(value); setPage(0); }} />
        <div className="review-traceability-table-wrap">
          <table className="review-traceability-table" aria-label="Traceability matrix">
            <thead><tr><th scope="col">ID</th><th scope="col">Feature</th><th scope="col">State</th></tr></thead>
            <tbody>{visible.length ? visible.map(item => <tr key={item.id} className={selected?.id === item.id ? 'selected' : undefined} onClick={() => setSelectedId(item.id)}>
              <td><span className="finding-id-label" title={entityIdTitle('Traceability ID:', item.id)}>{traceabilityIdLabel(item)}</span></td>
              <td><button type="button" className="traceability-requirement-link" aria-pressed={selected?.id === item.id} onClick={event => { event.stopPropagation(); setSelectedId(item.id); }}><strong>{item.title}</strong></button></td>
              <td><TraceabilityStateBadge state={item.state} /></td>
            </tr>) : <tr><td colSpan={3}><div className="review-traceability-empty" role="status">{items.length
              ? 'No traceability items match the current filters.'
              : 'No traceable items were recorded for this Review.'}</div></td></tr>}</tbody>
          </table>
        </div>
        <TraceabilityPagination total={filtered.length} page={safePage} onPageChange={setPage} />
      </div>
      {selected && <aside className="review-traceability-detail" aria-label="Traceability details">
        <div className="review-traceability-detail-heading">
          <div><h3>{selected.title}</h3><span className="finding-id-label" title={entityIdTitle('Traceability ID:', selected.id)}>{traceabilityIdLabel(selected)}</span></div>
          <TraceabilityStateBadge state={selected.state} />
        </div>
        {'featureGroup' in selected ? <>
          <section>
            <h4>Requirement evidence</h4>
            {selected.requirements.length ? <ul className="review-traceability-evidence">
              {selected.requirements.map(record => <li key={record.requirementId}>
                <strong>{record.title}</strong> · {traceabilityStateLabel(record.state)}
                {record.description && <p className="traceability-muted">{record.description}</p>}
                {record.references.length > 0 && <p className="traceability-muted">{record.references.join(' · ')}</p>}
                {record.evidenceStatus && record.evidenceStatus !== 'verified' && <p className="traceability-muted">Implementation evidence is {record.evidenceStatus}.</p>}
              </li>)}
            </ul> : <p className="traceability-muted">{savedEvidenceMessage(snapshot)}</p>}
            {selected.fileRequirements.length > 0 && <>
              <p className="traceability-muted">Requirements mapped to the same file still need a feature-level link.</p>
              <ul className="review-traceability-evidence">{selected.fileRequirements.map(record => <li key={record.requirementId}>{record.title}</li>)}</ul>
            </>}
          </section>
          <ReviewUseCaseDetails operations={selected.featureGroup.operations} findings={selected.findings} onOpenFinding={onOpenFinding} />
        </> : <>
          <section><h4>Requirement evidence</h4><p className="review-traceability-detail-description">{selected.requirement.description || 'No requirement description was supplied.'}</p></section>
          {selected.requirement.evidenceStatus && selected.requirement.evidenceStatus !== 'verified' && <p className="review-history-unavailable" role="status">{selected.requirement.evidenceStatus === 'stale' ? 'Implementation evidence is stale.' : 'Implementation evidence is unavailable.'} The saved mapping does not prove coverage of the reviewed source version.</p>}
          <section><h4>Implementation references</h4>{selected.requirement.references.length
            ? <div className="traceability-detail-list">{selected.requirement.references.map((reference, index) => <span key={index} className="traceability-source-tag">{reference}</span>)}</div>
            : <p className="traceability-muted">No implementation evidence is linked.</p>}</section>
          <section><h4>Linked findings</h4>{selected.requirement.findings.length
            ? <div className="traceability-detail-list">{selected.requirement.findings.map(finding => <button key={finding.id} type="button" className="traceability-detail-finding" title={entityIdTitle(finding.title, finding.id)} aria-label={`Open finding ${formatEntityId(finding.id)}: ${finding.title}`} onClick={() => onOpenFinding(finding.id)}>{formatEntityId(finding.id)}</button>)}</div>
            : <p className="traceability-muted">No findings are linked to this item.</p>}</section>
        </>}
      </aside>}
    </div>
  </section>;
}

function savedEvidenceMessage(snapshot: ReviewTraceabilitySnapshot | null) {
  if (snapshot?.status !== 'available') return 'Saved requirement evidence is unavailable.';
  return snapshot.records.length ? 'No saved requirement is linked to this feature.' : 'Requirements not identified.';
}

function TraceabilityToolbar({ query, filter, onQueryChange, onFilterChange }: {
  query: string;
  filter: TraceabilityFilter;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: TraceabilityFilter) => void;
}) {
  return <div className="review-traceability-toolbar" role="search" aria-label="Traceability filters">
    <label className="review-traceability-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search traceability" value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Feature or ID" /></label>
    <Select className="review-traceability-state" aria-label="Traceability state" value={filter} onChange={value => onFilterChange(value as TraceabilityFilter)} options={[
      { value: 'all', label: 'All states' }, { value: 'attention', label: 'Incomplete and missing' },
      { value: 'complete', label: 'Complete' }, { value: 'incomplete', label: 'Incomplete' }, { value: 'missing', label: 'Missing' }, { value: 'unavailable', label: 'Unavailable' },
    ]} />
  </div>;
}

function TraceabilityPagination({ total, page, onPageChange }: { total: number; page: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.ceil(total / TRACEABILITY_PAGE_SIZE);
  return <footer>
    {pageCount > 1 && <nav className="review-traceability-pagination" aria-label="Traceability pages">
      <button type="button" className="btn-secondary" onClick={() => onPageChange(page - 1)} disabled={page === 0}>Previous</button>
      <span>Page {page + 1} of {pageCount}</span>
      <button type="button" className="btn-secondary" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount - 1}>Next</button>
    </nav>}
    <div className="findings-count-label">{total} {total === 1 ? 'item' : 'items'}</div>
  </footer>;
}

function TraceabilityStateBadge({ state }: { state: TraceableState }) {
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
