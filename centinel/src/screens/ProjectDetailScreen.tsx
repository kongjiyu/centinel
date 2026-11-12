import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { setVisibleInterval } from '../hooks/usePageVisible';
import { ProjectMembersPanel } from '../components/ProjectMembersPanel';
import { findingToDynamicDraft } from '../dynamic/findingDraft';
import { Download, Plus, FolderOpen, Play, AlertCircle, GitBranch, Clock3, ChevronLeft, ChevronRight, ChevronDown, Users, Settings, ShieldAlert, Info, Trash2, Search, UserPlus, CheckCircle2, ListFilter, FileCheck2, MonitorPlay } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { api, type ProjectReportDownloadLinks, type ProjectReportExportResult, type ProjectReportHistoryEntry } from '../api/client';
import { ReportExportCard } from '../components/ReportExportCard';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { ProjectReadinessCard } from '../components/ProjectReadinessCard';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { effectiveReviewDecision, isExecutedReviewStatus, projectActivityLifecycle, projectActivityLifecycleTone } from '../reviewViewModel';
import { userFacingError } from '../utils/userFacingError';
import { formatEntityId } from '../utils/entityId';
import { deriveRiskLevel, priorityRank, riskLevelRank, RISK_MATRIX_ROWS } from '../riskPolicy';
import { projectReadinessFindings } from '../readinessFindings';
import { reviewEvidenceFindings, reviewTraceabilityFindings } from '../reviewEvidenceFindings';
import { assessReviewSourceCurrency, latestSuccessfulReview } from '../reviewCurrency';
import { effectiveFindingStatus } from '../findingStatus';
import { distinctFindingIssues, groupFindings } from '../findingGroups';
import { createRecheckIdempotencyKey, findingRecheckPlan } from '../findingRecheck';
import { dynamicActivityScreen, latestPerSavedTest, loadDynamicActivity } from '../dynamic/runActivity';
import type { Project, DynamicSession, StaticSession, Artifact, Screen, Finding, ProjectAssessment, CollaborationStatus, ProjectCollaboratorMatch, ReviewSourceManifest } from '../types';
import type { ProjectReadinessStatus } from '../types';
import './ProjectDetailScreen.css';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
  onProjectUpdated?: (project: Project) => void;
  initialAction?: 'static' | 'dynamic';
  initialSection?: 'source' | 'findings';
  findingsReviewId?: string;
  findingId?: string;
  sourceArtifactId?: string;
  initialStaticSessionId?: string;
};

type ActivityState = 'all' | 'queued' | 'running' | 'needs_approval' | 'success' | 'needs_attention' | 'cancelled';

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  action: 'source' | 'findings' | 'activity' | 'actions' | 'review' | 'requirements';
  actionLabel: string;
  rank?: number;
  risk?: string;
  findingId?: string;
  target?: Screen;
  comparisonParentReviewId?: string;
  filter?: { category?: string; search?: string };
};

type ReviewSourceManifestLoad = {
  reviewId: string;
  status: 'loading' | 'available' | 'unavailable';
  manifest?: ReviewSourceManifest | null;
};

type AssessmentInfoPage = 'severity' | 'priority' | 'risk';

/**
 * Project Detail timestamps deliberately use a stable, readable format rather
 * than the browser's locale-dependent long date output. Date parts remain in
 * the user's local timezone, matching the rest of the desktop workspace.
 */
export function formatProjectDateTime(value: string, _shortYear = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(date);
  return `${pad(date.getDate())} ${month} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ATTENTION_PREVIEW_LIMIT = 80;

function attentionNeedsDisclosure(detail: string): boolean {
  return detail.length > ATTENTION_PREVIEW_LIMIT;
}

function attentionPreview(detail: string): string {
  if (!attentionNeedsDisclosure(detail)) return detail;
  const preview = detail.slice(0, ATTENTION_PREVIEW_LIMIT).trimEnd();
  const boundary = preview.lastIndexOf(' ');
  return (boundary > ATTENTION_PREVIEW_LIMIT - 30 ? preview.slice(0, boundary) : preview).trimEnd();
}

export function ProjectDetailScreen({ project, onNavigate, onProjectUpdated, initialAction, initialSection, sourceArtifactId, findingsReviewId, findingId, initialStaticSessionId: _initialStaticSessionId }: Props) {
  const showCollaborators = import.meta.env.VITE_ENABLE_PROJECT_COLLABORATORS === 'true';
  const [currentProject, setCurrentProject] = useState(project);
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [dynamicSessionsLoadingProjectId, setDynamicSessionsLoadingProjectId] = useState<string | null>(null);
  const [dynamicSessionsLoadedProjectId, setDynamicSessionsLoadedProjectId] = useState<string | null>(null);
  const [dynamicSessionsError, setDynamicSessionsError] = useState<string | null>(null);
  const [staticSessionsLoadingProjectId, setStaticSessionsLoadingProjectId] = useState<string | null>(null);
  const [staticSessionsLoadedProjectId, setStaticSessionsLoadedProjectId] = useState<string | null>(null);
  const [staticSessionsError, setStaticSessionsError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactsLoaded, setArtifactsLoaded] = useState(false);
  const [artifactsLoadedProjectId, setArtifactsLoadedProjectId] = useState<string | null>(null);
  const [reviewSourceManifestLoad, setReviewSourceManifestLoad] = useState<ReviewSourceManifestLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ProjectReportExportResult | null>(null);
  const [reportHistory, setReportHistory] = useState<ProjectReportHistoryEntry[]>([]);
  const [reportHistoryLoading, setReportHistoryLoading] = useState(false);
  const [reportHistoryError, setReportHistoryError] = useState<string | null>(null);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [reportLinks, setReportLinks] = useState<Record<string, ProjectReportDownloadLinks>>({});
  const [renewingReportId, setRenewingReportId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(initialSection === 'source' ? 'project-source' : initialSection === 'findings' ? 'project-findings' : 'project-overview');
  useEffect(() => { setActiveSection(initialSection === 'source' ? 'project-source' : initialSection === 'findings' ? 'project-findings' : 'project-overview'); }, [project.id, initialSection, findingsReviewId, findingId]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activityQuery, setActivityQuery] = useState('');
  const [activityType, setActivityType] = useState<'all' | 'review' | 'dynamic'>('all');
  const [activityDateTime, setActivityDateTime] = useState('');
  const [activityState, setActivityState] = useState<ActivityState>('all');
  const [activityPage, setActivityPage] = useState(0);
  const [projectFindings, setProjectFindings] = useState<Finding[]>([]);
  const [assessmentData, setAssessmentData] = useState<ProjectAssessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentLoadedProjectId, setAssessmentLoadedProjectId] = useState<string | null>(null);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsLoadedProjectId, setFindingsLoadedProjectId] = useState<string | null>(null);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [readinessStatus, setReadinessStatus] = useState<ProjectReadinessStatus | null>(null);
  const [reviewGapState, setReviewGapState] = useState<{ projectId: string; reviewId: string; findings: Finding[]; message: string | null } | null>(null);
  useEffect(() => { setReadinessStatus(null); }, [project.id]);
  const [latestTraceabilitySummary, setLatestTraceabilitySummary] = useState<{ complete: number; incomplete: number; missing: number; attention: number } | null>(null);
  const [latestTraceabilityReview, setLatestTraceabilityReview] = useState<StaticSession | null>(null);
  const [traceabilitySummaryLoading, setTraceabilitySummaryLoading] = useState(false);
  const [assessmentInfoPage, setAssessmentInfoPage] = useState<AssessmentInfoPage | null>(null);
  const [attentionFindingId, setAttentionFindingId] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ name: project.name, description: project.description, workspacePath: project.workspacePath });
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [collaborationStatus, setCollaborationStatus] = useState<CollaborationStatus | null>(null);
  const [collaborationStatusError, setCollaborationStatusError] = useState<string | null>(null);
  const [syncingProjectCollaborators, setSyncingProjectCollaborators] = useState(false);
  const [membershipRevision, setMembershipRevision] = useState(0);
  const [collaboratorOwnerProject, setCollaboratorOwnerProject] = useState<string | null>(null);
  const [githubCollaboratorsLoading, setGithubCollaboratorsLoading] = useState(false);
  const [githubCollaboratorsError, setGithubCollaboratorsError] = useState<string | null>(null);
  const [showCollaboratorDialog, setShowCollaboratorDialog] = useState(false);
  const [githubConnection, setGithubConnection] = useState<'checking' | 'connected' | 'disconnected' | 'unavailable'>('checking');
  const [collaboratorQuery, setCollaboratorQuery] = useState('');
  const [collaboratorFilter, setCollaboratorFilter] = useState('');
  useEffect(() => { setCollaboratorFilter(''); }, [project.id]);
  const [collaboratorMatches, setCollaboratorMatches] = useState<ProjectCollaboratorMatch[]>([]);
  const [collaboratorSearchLoading, setCollaboratorSearchLoading] = useState(false);
  const [collaboratorAddLoading, setCollaboratorAddLoading] = useState(false);
  const [collaboratorError, setCollaboratorError] = useState<string | null>(null);
  const [collaboratorNotice, setCollaboratorNotice] = useState<string | null>(null);
  const collaboratorSyncAttempts = useRef(new Set<string>());
  const collaboratorLoads = useRef(new Map<string, Promise<void>>());
  const currentProjectId = useRef(project.id);
  currentProjectId.current = project.id;
  const [attentionDetailItem, setAttentionDetailItem] = useState<AttentionItem | null>(null);
  const [findingsFilter, setFindingsFilter] = useState<{ riskLevel?: 'critical_or_high'; status?: 'unresolved'; category?: string; search?: string } | null>(null);

  const { state: activeReviewState } = useActiveReviewState();
  const activeReviewRevision = activeReviewState?.session.projectId === project.id
    ? `${activeReviewState.session.id}:${activeReviewState.session.status}` : null;

  useEffect(() => {
    if(initialAction==='dynamic'){onNavigate({name:'dynamic-testing',projectId:project.id});return;}
    if (!initialAction) return;
    const sectionId = 'project-overview';
    setActiveSection(sectionId);
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }, [initialAction, project.id]);

  const loadDynamicSessions = useCallback(async () => {
    setDynamicSessionsLoadingProjectId(project.id);
    try {
      const result = await loadDynamicActivity(project.id);
      setDynamicSessions(result.sessions);
      setDynamicSessionsError(result.unavailable ? 'Some Dynamic Testing activity could not be loaded.' : null);
    } catch (cause) {
      setDynamicSessionsError(userFacingError(cause, 'Dynamic Testing activity could not be loaded.'));
    } finally {
      setDynamicSessionsLoadedProjectId(project.id);
      setDynamicSessionsLoadingProjectId(current => current === project.id ? null : current);
    }
  }, [project.id]);

  const loadStaticSessions = useCallback(async () => {
    setStaticSessionsLoadingProjectId(project.id);
    try {
      setStaticSessions(await api.listStaticSessions(project.id));
      setStaticSessionsError(null);
    } catch (cause) {
      setStaticSessionsError(userFacingError(cause, 'Review activity could not be loaded.'));
    } finally {
      setStaticSessionsLoadedProjectId(project.id);
      setStaticSessionsLoadingProjectId(current => current === project.id ? null : current);
    }
  }, [project.id]);

  const loadArtifacts = useCallback(async () => {
    setArtifactsLoaded(false);
    try {
      setArtifacts(await api.listArtifacts(project.id));
      setArtifactsError(null);
    } catch (cause) {
      setArtifacts([]);
      setArtifactsError(userFacingError(cause, 'Sources could not be loaded.'));
    } finally {
      setArtifactsLoaded(true);
      setArtifactsLoadedProjectId(project.id);
    }
  }, [project.id]);

  const loadProjectFindings = useCallback(async () => {
    setFindingsLoading(true);
    setFindingsError(null);
    try {
      setProjectFindings(await api.listFindings(project.id));
    } catch (cause) {
      setProjectFindings([]);
      setFindingsError(userFacingError(cause, 'Findings could not be loaded.'));
    } finally {
      setFindingsLoading(false);
      setFindingsLoadedProjectId(project.id);
    }
  }, [project.id]);

  const loadReportHistory = useCallback(async () => {
    if (typeof api.listProjectReportHistory !== 'function') return;
    setReportHistoryLoading(true);
    setReportHistoryError(null);
    try { setReportHistory(await api.listProjectReportHistory(project.id)); }
    catch (cause) { setReportHistoryError(userFacingError(cause, 'Report history could not be loaded.')); }
    finally { setReportHistoryLoading(false); }
  }, [project.id]);

  useEffect(() => {
    setSettingsDraft({ name: project.name, description: project.description, workspacePath: project.workspacePath });
    setSettingsError(null);
    setCurrentProject(project);
    setSettingsEditing(false);
  }, [project.description, project.id, project.name, project.workspacePath]);

  useEffect(() => {
    setDynamicSessionsError(null);
    setStaticSessionsError(null);
    setFindingsError(null);
    setArtifactsError(null);
    setCollaborationStatus(null);
    setCollaborationStatusError(null);
    setGithubCollaboratorsError(null);
    setAssessmentData(null);
    setAssessmentLoadedProjectId(null);
  }, [project.id]);

  // Opening Source/Settings/Collaborators must not run the entire project
  // evidence pipeline. Those sections own their own data requests.
  useEffect(() => {
    if (activeSection === 'project-overview') void loadDynamicSessions();
  }, [activeSection, loadDynamicSessions]);
  useEffect(() => {
    if (activeSection === 'project-overview' || activeSection === 'project-assessment') void loadProjectFindings();
  }, [activeSection, loadProjectFindings]);
  useEffect(() => {
    if (activeSection === 'project-overview') void loadArtifacts();
    if (['project-overview', 'project-assessment', 'project-findings'].includes(activeSection)) void loadStaticSessions();
  }, [activeSection, loadArtifacts, loadStaticSessions]);

  useEffect(() => {
    if (activeSection !== 'project-assessment') return;
    if (typeof api.getProjectAssessment !== 'function') {
      setAssessmentData(null);
      setAssessmentLoading(false);
      setAssessmentLoadedProjectId(project.id);
      return;
    }
    let cancelled = false;
    setAssessmentLoading(true);
    api.getProjectAssessment(project.id)
      .then(data => { if (!cancelled) setAssessmentData(data.status === 'available' ? data : null); })
      .catch(() => { if (!cancelled) setAssessmentData(null); })
      .finally(() => {
        if (cancelled) return;
        setAssessmentLoading(false);
        setAssessmentLoadedProjectId(project.id);
      });
    return () => { cancelled = true; };
  }, [activeSection, project.id, activeReviewRevision]);

  useEffect(() => {
    const snapshot = activeReviewState?.session;
    if (!snapshot || snapshot.projectId !== project.id) return;

    setStaticSessions(prev => prev.map(session => session.id === snapshot.id
      ? {
          ...session,
          status: snapshot.status,
          finalSummary: snapshot.finalSummary,
          failureReason: snapshot.failureReason,
        }
      : session));

  }, [activeReviewState?.session, project.id]);

  useEffect(() => {
    if (activeSection !== 'project-overview') return;
    const hasActive = dynamicSessions.some(s => s.status === 'running' || s.status === 'queued') ||
      staticSessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActive) return;
    return setVisibleInterval(() => { loadDynamicSessions(); loadStaticSessions(); }, 2000);
  }, [activeSection, dynamicSessions, staticSessions, loadDynamicSessions, loadStaticSessions]);

  const handleExportReport = async () => {
    setExporting(true);
    setError(null);
    try {
      setExportResult(await api.exportProjectReport(project.id));
      await loadReportHistory();
    } catch (cause) {
      setExportResult(null);
      setError(`Export failed. ${userFacingError(cause, 'Try again.')}`);
    } finally {
      setExporting(false);
    }
  };

  const renewReportLinks = async (reportId: string) => {
    setRenewingReportId(reportId);
    setReportHistoryError(null);
    try {
      const links = await api.renewProjectReportLinks(project.id, reportId);
      setReportLinks(previous => ({ ...previous, [reportId]: links }));
    } catch (cause) {
      setReportHistoryError(userFacingError(cause, 'Fresh report download links could not be created.'));
    } finally {
      setRenewingReportId(null);
    }
  };

  const moveToSection = (sectionId: string) => {
    setActionsOpen(false);
    setActiveSection(sectionId);
    requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const projectActivities = useMemo(() => [...staticSessions.map(session => ({
    id: session.id,
    name: session.name,
    kind: 'Review' as const,
    rawStatus: session.status,
    status: projectActivityLifecycle(session, 'review'),
    createdAt: session.updatedAt || session.createdAt,
  })), ...dynamicSessions.map(session => ({
    id: session.id,
    runId: session.runId,
    name: session.name,
    kind: 'Dynamic Testing' as const,
    rawStatus: session.status,
    status: projectActivityLifecycle(session, 'dynamic'),
    createdAt: session.updatedAt || session.createdAt,
  }))]
    .filter(activity => activityType === 'all' || (activityType === 'review' ? activity.kind === 'Review' : activity.kind === 'Dynamic Testing'))
    .filter(activity => {
      if (activityState === 'all') return true;
      if (activityState === 'needs_attention') return activity.status === 'Failed' || activity.status === 'Needs attention';
      if (activityState === 'needs_approval') return activity.status === 'Need Approval';
      if (activityState === 'queued') return activity.rawStatus === 'queued';
      if (activityState === 'running') return activity.rawStatus === 'running';
      if (activityState === 'success') return activity.status === 'Completed';
      if (activityState === 'cancelled') return activity.status === 'Cancelled';
      return true;
    })
    .filter(activity => {
      if (!activityDateTime) return true;
      const selectedTimestamp = Date.parse(activityDateTime);
      return Number.isNaN(selectedTimestamp) || Date.parse(activity.createdAt) >= selectedTimestamp;
    })
    .filter(activity => !activityQuery.trim() || (activity.name + ' ' + activity.kind + ' ' + activity.status).toLowerCase().includes(activityQuery.trim().toLowerCase()))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [activityDateTime, activityQuery, activityState, activityType, dynamicSessions, staticSessions]);

  const activityPageCount = Math.max(1, Math.ceil(projectActivities.length / 5));
  const visibleProjectActivities = projectActivities.slice(activityPage * 5, activityPage * 5 + 5);
  const activityInitialReadLoading = dynamicSessionsLoadedProjectId !== project.id || staticSessionsLoadedProjectId !== project.id;
  const activityRefreshing = !activityInitialReadLoading && (
    dynamicSessionsLoadingProjectId === project.id || staticSessionsLoadingProjectId === project.id
  );
  const activityLoadError = dynamicSessionsError ?? staticSessionsError;
  const overviewInitialReadLoading = activityInitialReadLoading || findingsLoadedProjectId !== project.id || artifactsLoadedProjectId !== project.id;
  const overviewRefreshing = !overviewInitialReadLoading && (
    dynamicSessionsLoadingProjectId === project.id || staticSessionsLoadingProjectId === project.id ||
    (findingsLoading && findingsLoadedProjectId === project.id) || (!artifactsLoaded && artifactsLoadedProjectId === project.id)
  );
  const overviewReadError = findingsError ?? dynamicSessionsError ?? staticSessionsError ?? artifactsError;
  const assessmentInitialReadLoading = assessmentLoadedProjectId !== project.id;

  useEffect(() => {
    setActivityPage(page => Math.min(page, activityPageCount - 1));
  }, [activityPageCount]);

  useEffect(() => {
    setActivityPage(0);
  }, [activityDateTime, activityQuery, activityState, activityType]);

  const unresolvedFindings = useMemo(() => projectFindings
    .map(finding => ({ ...finding, status: effectiveFindingStatus(finding) }))
    .filter(finding => !['dismissed', 'fixed'].includes(finding.status))
    .sort((a, b) => (riskLevelRank(a.riskLevel ?? deriveRiskLevel(a.severity, a.priority)) - riskLevelRank(b.riskLevel ?? deriveRiskLevel(b.severity, b.priority))) || Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)), [projectFindings]);

  const currentFindings = useMemo(() => {
    // A re-review can expose a carry-over row alongside the newly produced
    // row for the same issue. Collapse that stable fingerprint so one logical
    // unresolved issue contributes once to project risk.
    const byFingerprint = new Map<string, Finding>();
    unresolvedFindings
      // Project Assessment risk is Review/static-only in v1. Dynamic Testing
      // keeps its own evidence and lifecycle until a comparable cross-module
      // policy is defined.
      .filter(finding => finding.source === 'static')
      .forEach(finding => {
        const title = finding.title.trim().toLowerCase().replace(/\s+/g, ' ');
        const fingerprint = [finding.artifactId || finding.filePath || finding.id, (finding.category || '').trim().toLowerCase(), title].join('|');
        const existing = byFingerprint.get(fingerprint);
        if (!existing || (existing.status === 'carryover' && finding.status !== 'carryover')) byFingerprint.set(fingerprint, finding);
      });
    return Array.from(byFingerprint.values());
  }, [unresolvedFindings]);

  const riskLevelFindings = useMemo(() => currentFindings
    .map(finding => ({ ...finding, riskLevel: finding.riskLevel ?? deriveRiskLevel(finding.severity, finding.priority) }))
    .filter(finding => Boolean(finding.riskLevel)), [currentFindings]);

  const riskFindings = useMemo(() => riskLevelFindings
    .sort((a, b) => riskLevelRank(a.riskLevel) - riskLevelRank(b.riskLevel)
      || priorityRank(a.priority) - priorityRank(b.priority)
      || riskLevelRank(a.severity) - riskLevelRank(b.severity)
      || Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)
      || a.title.localeCompare(b.title)
      || a.id.localeCompare(b.id)), [riskLevelFindings]);

  const hasReconciledFindings = projectFindings.some(finding => finding.resolutionEvidence != null || finding.latestOccurrence != null);
  const displayedRiskFindings = assessmentData?.status === 'available' && !hasReconciledFindings
    ? assessmentData.riskItems.filter(finding => !['dismissed', 'fixed'].includes(effectiveFindingStatus(finding)))
    : riskFindings;

  const latestReview = useMemo(() => [...staticSessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null, [staticSessions]);
  const lastSuccessfulReview = useMemo(() => latestSuccessfulReview(staticSessions), [staticSessions]);
  const latestDynamicTest = useMemo(() => [...dynamicSessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null, [dynamicSessions]);
  const latestReviewState = latestReview ? projectActivityLifecycle(latestReview, 'review') : null;
  const latestDynamicState = latestDynamicTest ? projectActivityLifecycle(latestDynamicTest, 'dynamic') : null;

  useEffect(() => {
    if (activeSection !== 'project-overview') return;
    if (!lastSuccessfulReview) {
      setReviewSourceManifestLoad(null);
      return;
    }

    let cancelled = false;
    const reviewId = lastSuccessfulReview.id;
    setReviewSourceManifestLoad({ reviewId, status: 'loading' });
    if (typeof api.getReviewSourceManifest !== 'function') {
      setReviewSourceManifestLoad({ reviewId, status: 'unavailable' });
      return () => { cancelled = true; };
    }

    api.getReviewSourceManifest(project.id, reviewId)
      .then(manifest => {
        if (!cancelled) setReviewSourceManifestLoad({ reviewId, status: 'available', manifest });
      })
      .catch(() => {
        if (!cancelled) setReviewSourceManifestLoad({ reviewId, status: 'unavailable' });
      });

    return () => { cancelled = true; };
  }, [activeSection, lastSuccessfulReview?.id, project.id]);

  const reviewSourceCurrency = useMemo(() => {
    if (!lastSuccessfulReview || !reviewSourceManifestLoad || reviewSourceManifestLoad.reviewId !== lastSuccessfulReview.id || reviewSourceManifestLoad.status === 'loading' || !artifactsLoaded) return null;
    if (reviewSourceManifestLoad.status === 'unavailable' || artifactsError) {
      return assessReviewSourceCurrency(lastSuccessfulReview, null, null);
    }
    return assessReviewSourceCurrency(lastSuccessfulReview, reviewSourceManifestLoad.manifest ?? null, artifacts);
  }, [artifacts, artifactsError, artifactsLoaded, lastSuccessfulReview, reviewSourceManifestLoad]);

  useEffect(() => {
    if (activeSection !== 'project-assessment') return;
    const completedReview = [...staticSessions]
      .filter(review => effectiveReviewDecision(review) === 'approved')
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null;
    if (assessmentData?.status === 'available') {
      const assessedReview = assessmentData.traceability.reviewId
        ? staticSessions.find(review => review.id === assessmentData.traceability.reviewId) ?? completedReview
        : completedReview;
      setLatestTraceabilityReview(assessedReview ?? null);
      setLatestTraceabilitySummary(assessmentData.traceability.status === 'available' ? assessmentData.traceability.summary : null);
      setTraceabilitySummaryLoading(false);
      return;
    }
    setLatestTraceabilityReview(completedReview);
    if (!completedReview || typeof api.getReviewTraceability !== 'function') {
      setLatestTraceabilitySummary(null);
      setTraceabilitySummaryLoading(false);
      return;
    }
    let cancelled = false;
    setTraceabilitySummaryLoading(true);
    api.getReviewTraceability(project.id, completedReview.id)
      .then(snapshot => { if (!cancelled) setLatestTraceabilitySummary(snapshot.status === 'available' ? snapshot.summary : null); })
      .catch(() => { if (!cancelled) setLatestTraceabilitySummary(null); })
      .finally(() => { if (!cancelled) setTraceabilitySummaryLoading(false); });
    return () => { cancelled = true; };
  }, [activeSection, assessmentData, project.id, staticSessions]);

  const recurringPatterns = useMemo(() => {
    const approvedSessionIds = new Set(staticSessions.filter(review => effectiveReviewDecision(review) === 'approved').map(review => review.id));
    const groups = new Map<string, { label: string; sessions: Set<string>; filter: { category?: string; search?: string } }>();
    projectFindings.forEach(finding => {
      if (finding.source !== 'static') return;
      if (!finding.sessionId || !approvedSessionIds.has(finding.sessionId)) return;
      const category = finding.category?.trim();
      const normalizedTitle = finding.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const key = category ? `category:${category.toLowerCase()}` : `title:${normalizedTitle}`;
      const existing = groups.get(key) ?? { label: category || finding.title, sessions: new Set<string>(), filter: category ? { category } : { search: finding.title } };
      existing.sessions.add(finding.sessionId);
      groups.set(key, existing);
    });
    return Array.from(groups.values()).sort((a, b) => b.sessions.size - a.sessions.size || a.label.localeCompare(b.label)).slice(0, 3);
  }, [projectFindings, staticSessions]);

  // Before the first Review, point people at requirements: without confirmed ones
  // the Review can only check code quality, not whether the code does what it should.
  const needsFirstReview = staticSessions.length === 0 && dynamicSessions.length === 0 && artifacts.length > 0;
  const [confirmedRequirementCount, setConfirmedRequirementCount] = useState<number | null>(null);
  useEffect(() => {
    if (!needsFirstReview || typeof api.listRequirements !== 'function') return;
    let disposed = false;
    void Promise.resolve(api.listRequirements(project.id))
      .then(requirements => { if (!disposed) setConfirmedRequirementCount(Array.isArray(requirements) ? requirements.length : null); })
      .catch(() => { if (!disposed) setConfirmedRequirementCount(null); });
    return () => { disposed = true; };
  }, [needsFirstReview, project.id]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (artifactsError) {
      items.push({
        id: 'sources-unavailable',
        title: 'Sources could not be checked',
        detail: 'The source service is unavailable. Retry before starting a Review.',
        action: 'source',
        actionLabel: 'Inspect sources',
        rank: 0,
      });
    }

    const superseded = new Set(staticSessions.map(session => session.parentSessionId).filter(Boolean));
    [...staticSessions.filter(session => !superseded.has(session.id)), ...latestPerSavedTest(dynamicSessions)]
      .filter(session => ['blocked', 'failure', 'failed'].includes(session.status))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .forEach(session => items.push({
        id: `session-${session.id}`,
        title: `${session.name} needs attention`,
        detail: userFacingError(session.failureReason, 'The activity did not complete. Inspect the activity details before retrying.'),
        action: 'activity',
        actionLabel: 'Open failed run',
        rank: 1,
        target: 'type' in session && session.type === 'dynamic'
          ? dynamicActivityScreen(project.id, session)
          : { name: 'review-activity', projectId: project.id, sessionId: session.id, reviewName: session.name },
      }));

    recurringPatterns.forEach(pattern => items.push({
      id: `recurring-${pattern.label}`,
      title: `Recurring Finding Patterns · ${pattern.label}`,
      detail: `${pattern.sessions.size} completed Review session${pattern.sessions.size === 1 ? '' : 's'} contain this pattern.`,
      action: 'findings',
      actionLabel: 'View pattern',
      filter: pattern.filter,
    }));

    if (lastSuccessfulReview && reviewSourceCurrency && reviewSourceCurrency.changedCount > 0) {
      const sourceCount = reviewSourceCurrency.changedCount;
      const sourceNoun = `reviewed source version${sourceCount === 1 ? '' : 's'}`;
      items.push({
        id: `source-currency-changed-${lastSuccessfulReview.id}`,
        title: 'Sources changed',
        detail: reviewSourceCurrency.fullyVerified
          ? `${sourceCount} ${sourceNoun} changed or were removed since “${lastSuccessfulReview.name}”. Start a Review to assess the current versions.`
          : `At least ${sourceCount} ${sourceNoun} changed or were removed since “${lastSuccessfulReview.name}”; source currency could not be fully verified. Start a Review to assess the current versions.`,
        action: 'review',
        actionLabel: 'Review changed sources',
        comparisonParentReviewId: lastSuccessfulReview.id,
      });
    }

    if (lastSuccessfulReview && reviewSourceCurrency && reviewSourceCurrency.addedCount > 0) {
      const sourceCount = reviewSourceCurrency.addedCount;
      const addedSourceNoun = `new project source${sourceCount === 1 ? '' : 's'}`;
      items.push({
        id: `source-currency-added-${lastSuccessfulReview.id}`,
        title: 'New sources need review',
        detail: `${sourceCount} ${addedSourceNoun} ${sourceCount === 1 ? 'was' : 'were'} imported after “${lastSuccessfulReview.name}” and may not be covered by that Review.${reviewSourceCurrency.fullyVerified ? '' : ' Source currency could not be fully verified.'} Start a Review to assess them.`,
        action: 'review',
        actionLabel: 'Review new sources',
        comparisonParentReviewId: lastSuccessfulReview.id,
      });
    }

    if (lastSuccessfulReview && reviewSourceCurrency?.status === 'unverified') {
      items.push({
        id: `source-currency-unverified-${lastSuccessfulReview.id}`,
        title: 'Review needs checking',
        detail: 'Source currency cannot be verified from the saved Review evidence. Start a Review to establish a current source snapshot.',
        action: 'review',
        actionLabel: 'Check source coverage',
        comparisonParentReviewId: lastSuccessfulReview.id,
      });
    }

    // One item per distinct issue: repeated detections of the same issue
    // across Reviews are counted once. Stored rows and risk inputs are unchanged.
    distinctFindingIssues(unresolvedFindings).forEach(({ representative: finding, occurrences }) => {
      const severity = finding.severity.toLowerCase();
      if (severity === 'info' || severity === 'informational') return;
      const risk = finding.riskLevel ?? deriveRiskLevel(finding.severity, finding.priority);
      const urgency = risk ?? severity;
      const rank = urgency === 'critical' ? 0 : urgency === 'high' ? 2 : urgency === 'medium' ? 4 : 7;
      const description = finding.description.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] || finding.description.trim();
      items.push({
        id: `finding-${finding.id}`,
        title: groupFindings([finding])[0].title,
        detail: `${description || 'Open the finding to see what was reported.'}${occurrences.length > 1 ? ` Found ${occurrences.length} times.` : ''}`,
        action: 'findings',
        actionLabel: 'Inspect finding',
        risk: urgency,
        rank,
        findingId: finding.id,
      });
    });

    if (!artifactsError && artifacts.length === 0) {
      items.push({
        id: 'sources-missing',
        title: 'Add sources to this project',
        detail: 'Upload a document or import a repository before starting a Review.',
        action: 'source',
        actionLabel: 'Add sources',
      });
    }

    if (needsFirstReview && confirmedRequirementCount === 0) {
      items.push({
        id: 'requirements-missing',
        title: 'Confirm what the project should do',
        detail: 'Upload a requirements document, then extract and confirm its requirements so the Review checks the code against them. Without them, the Review checks code quality only.',
        action: 'requirements',
        actionLabel: 'Add requirements',
      });
    }

    if (needsFirstReview) {
      items.push({
        id: 'first-review',
        title: 'Start the first Review',
        detail: 'The project has sources ready for its first file review.',
        action: 'actions',
        actionLabel: 'Start Review',
      });
    }

    return items.sort((a, b) => (a.rank ?? 5) - (b.rank ?? 5));
  }, [project.id, artifactsError, artifacts.length, confirmedRequirementCount, dynamicSessions, lastSuccessfulReview, needsFirstReview, recurringPatterns, reviewSourceCurrency, staticSessions, unresolvedFindings]);

  const readinessFindings = useMemo(() => projectReadinessFindings(readinessStatus), [readinessStatus]);
  const latestSavedReview = useMemo(() => [...staticSessions].filter(review => !['queued', 'prepared', 'running'].includes(review.status)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))[0], [staticSessions]);
  useEffect(() => {
    if (activeSection !== 'project-findings' || !latestSavedReview || findingsReviewId) return;
    let disposed = false;
    const identity = { projectId: project.id, reviewId: latestSavedReview.id };
    setReviewGapState({ ...identity, findings: [], message: 'Loading the latest Review’s document findings…' });
    if (typeof api.getReviewEvidenceSufficiency !== 'function') {
      setReviewGapState({ ...identity, findings: [], message: 'The latest Review’s saved document assessment is unavailable.' }); return;
    }
    void Promise.allSettled([
      api.getReviewEvidenceSufficiency(project.id, latestSavedReview.id),
      Promise.resolve().then(() => api.getReviewTraceability(project.id, latestSavedReview.id)),
      Promise.resolve().then(() => api.getReviewHarness(project.id, latestSavedReview.id)),
      Promise.resolve().then(() => api.listStaticFindings(project.id, latestSavedReview.id)),
    ]).then(([assessment, snapshot, harness, findings]) => {
      if (disposed) return;
      setReviewGapState({
        ...identity,
        findings: [
          ...reviewEvidenceFindings(latestSavedReview, assessment.status === 'fulfilled' ? assessment.value : null),
          ...reviewTraceabilityFindings(latestSavedReview, snapshot.status === 'fulfilled' ? snapshot.value : null,
            harness.status === 'fulfilled' && harness.value && isExecutedReviewStatus(harness.value.review.status) ? harness.value.analysisMap : null, findings.status === 'fulfilled' ? findings.value : []),
        ],
        message: assessment.status === 'rejected' ? 'The latest Review’s document findings could not be loaded. Reopen Findings to retry.'
          : !assessment.value ? 'The latest Review has no saved document assessment.' : null,
      });
    });
    return () => { disposed = true; };
  }, [activeSection, project.id, findingsReviewId, latestSavedReview?.id, latestSavedReview?.updatedAt]);
  const currentReviewGaps = reviewGapState?.projectId === project.id && reviewGapState.reviewId === latestSavedReview?.id ? reviewGapState : null;
  const supplementalProjectFindings = useMemo(() => [...readinessFindings, ...(currentReviewGaps?.findings ?? [])], [readinessFindings, currentReviewGaps?.findings]);

  // Findings a newer comparison Review did not report again. They stay open (resolution
  // needs exact proof), but the person who fixed them should know what Re-check found.
  const [notFoundAgain, setNotFoundAgain] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (activeSection !== 'project-findings') return;
    let disposed = false;
    const children = staticSessions
      .filter(session => session.projectId === project.id && session.parentSessionId && isExecutedReviewStatus(session.status))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 5);
    if (!children.length) { setNotFoundAgain(new Map()); return; }
    void Promise.all(children.map(child => api.getReviewCorrelations(project.id, child.id).then(snapshot => ({ child, snapshot })).catch(() => null)))
      .then(results => {
        if (disposed) return;
        const next = new Map<string, string>();
        for (const result of results) {
          if (!result) continue;
          const when = new Date(result.child.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
          for (const correlation of result.snapshot.correlations ?? []) {
            if (correlation.classification !== 'carried_over' || correlation.method !== 'unmatched' || !correlation.parentFindingId || next.has(correlation.parentFindingId)) continue;
            next.set(correlation.parentFindingId, `Not found in “${result.child.name}” (${when}). Centinel couldn't prove it is fixed, so it stays open. If you fixed it, mark it as resolved.`);
          }
        }
        setNotFoundAgain(next);
      });
    return () => { disposed = true; };
  }, [activeSection, project.id, staticSessions]);

  const recheckFor = useCallback((finding: Finding) => {
    const plan = findingRecheckPlan(finding, staticSessions);
    if (!plan) return null;
    const { review } = plan;
    const latestResult = notFoundAgain.get(finding.id) ?? null;
    if (plan.kind === 'open') return {
      latestResult,
      hint: `“${review.name}” is still running. Open it to follow its progress.`,
      run: async () => onNavigate({ name: 'review-activity', projectId: project.id, sessionId: review.id, reviewName: review.name }),
    };
    if (plan.kind === 'compare') return {
      latestResult,
      hint: `Prepares a Review of your updated code compared with “${review.name}”; start it to check whether this is fixed. This finding updates when it completes.`,
      run: async () => onNavigate({ name: 'review-entry', projectId: project.id, comparisonParentReviewId: review.id }),
    };
    return {
      latestResult,
      hint: `Creates a linked attempt of “${review.name}” with the current sources. This finding updates when it completes.`,
      run: async () => {
        if (typeof api.retryStaticSession !== 'function') throw new Error('Re-check is unavailable in this version.');
        let retried: StaticSession;
        try {
          retried = await api.retryStaticSession(project.id, review.id, { refreshSourceManifest: true, idempotencyKey: createRecheckIdempotencyKey(review.id) });
        } catch (cause) {
          throw new Error(userFacingError(cause, 'The re-check could not be started. The original Review remains available.'));
        }
        if (!retried?.id) throw new Error('The service did not return the new Review.');
        onNavigate({ name: 'review-activity', projectId: project.id, sessionId: retried.id, reviewName: retried.name });
      },
    };
  }, [notFoundAgain, onNavigate, project.id, staticSessions]);

  const visibleAttentionItems = attentionItems.slice(0, 3);

  const riskSummary = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    riskLevelFindings.forEach(finding => {
      const level = finding.riskLevel as keyof typeof counts;
      if (level in counts) counts[level] += 1;
    });
    return assessmentData?.status === 'available' && assessmentData.summary && !hasReconciledFindings ? {
      critical: assessmentData.summary.critical,
      high: assessmentData.summary.high,
      medium: assessmentData.summary.medium,
      low: assessmentData.summary.low,
    } : counts;
  }, [assessmentData, hasReconciledFindings, riskLevelFindings]);

  const handleAttentionAction = (item: AttentionItem) => {
    if (item.target) { onNavigate(item.target); return; }
    if (item.action === 'actions') {
      setActionsOpen(true);
      return;
    }
    if (item.action === 'review') {
      onNavigate({ name: 'review-entry', projectId: project.id, ...(item.comparisonParentReviewId ? { comparisonParentReviewId: item.comparisonParentReviewId } : {}) });
      return;
    }
    if (item.action === 'requirements') {
      onNavigate({ name: 'requirements', projectId: project.id });
      return;
    }
    if (item.action === 'activity') {
      setActivityState('needs_attention');
      setActiveSection('project-overview');
      requestAnimationFrame(() => document.getElementById('project-recent-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (item.action === 'findings') {
      setAttentionFindingId(item.findingId ?? null);
      setFindingsFilter(item.filter ?? null);
    }
    moveToSection(item.action === 'source' ? 'project-source' : 'project-findings');
  };

  const openAttentionDetail = (item: AttentionItem) => {
    setAttentionDetailItem(item);
  };

  const chooseWorkspaceFolder = async () => {
    if (!settingsEditing) return;
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose workspace folder' });
      if (typeof selected === 'string') {
        setSettingsDraft(draft => ({ ...draft, workspacePath: selected }));
        setSettingsError(null);
      }
    } catch {
      setSettingsError('The folder picker could not open. Try again in the desktop app.');
    }
  };

  const handleDeleteProject = async () => {
    setDeletingProject(true);
    setSettingsError(null);
    try {
      await api.deleteProject(project.id);
      setShowDeleteProject(false);
      onNavigate({ name: 'projects' });
    } catch (cause) {
      setSettingsError(`Project could not be removed. Your workspace files are unchanged. ${userFacingError(cause, 'Try again.')}`);
    } finally {
      setDeletingProject(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft.name.trim() || !settingsDraft.workspacePath.trim()) {
      setSettingsError('Project name and workspace are required.');
      return;
    }
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const updated = await api.updateProject(project.id, {
        name: settingsDraft.name.trim(),
        description: settingsDraft.description.trim(),
        workspacePath: settingsDraft.workspacePath.trim(),
      });
      setCurrentProject(updated);
      setSettingsDraft({ name: updated.name, description: updated.description, workspacePath: updated.workspacePath });
      setSettingsEditing(false);
      setSettingsSaved(true);
      onProjectUpdated?.(updated);
    } catch (cause) {
      setSettingsError(`Project settings could not be saved. ${userFacingError(cause, 'Try again.')}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCancelSettings = () => {
    setSettingsDraft({ name: currentProject.name, description: currentProject.description, workspacePath: currentProject.workspacePath });
    setSettingsEditing(false);
    setSettingsError(null);
    setSettingsSaved(false);
  };

  const loadCollaborationStatus = useCallback(async (): Promise<CollaborationStatus> => {
    setCollaborationStatusError(null);
    try {
      const status = await api.getCollaborationStatus(project.id);
      if (currentProjectId.current === project.id) setCollaborationStatus(status);
      return status;
    } catch (cause) {
      const message = userFacingError(cause, 'GitHub collaboration status is unavailable. Check your connection and try again.');
      const unavailable: CollaborationStatus = {
        available: false,
        repository: null,
        message,
      };
      if (currentProjectId.current === project.id) {
        setCollaborationStatus(unavailable);
        setCollaborationStatusError(message);
      }
      return unavailable;
    }
  }, [project.id]);

  const loadCollaboratorData = useCallback(() => {
    const projectId = project.id;
    const existingLoad = collaboratorLoads.current.get(projectId);
    if (existingLoad) return existingLoad;

    setGithubCollaboratorsLoading(true);
    if (!collaboratorSyncAttempts.current.has(projectId)) setGithubCollaboratorsError(null);
    const load = Promise.resolve().then(async () => {
      const status = await loadCollaborationStatus();
      if (currentProjectId.current !== projectId) return;

      if (status?.available && !collaboratorSyncAttempts.current.has(projectId)) {
        collaboratorSyncAttempts.current.add(projectId);
        try {
          await api.syncGithubCollaborators(projectId);
          if (currentProjectId.current === projectId) {
            setGithubCollaboratorsError(null);
          }
        } catch (cause) {
          if (currentProjectId.current === projectId) {
            setGithubCollaboratorsError(userFacingError(cause, 'GitHub collaborators could not be synced. Check repository access.'));
          }
        }
      }

    }).finally(() => {
      if (currentProjectId.current === projectId) setGithubCollaboratorsLoading(false);
      if (collaboratorLoads.current.get(projectId) === load) collaboratorLoads.current.delete(projectId);
    });
    collaboratorLoads.current.set(projectId, load);
    return load;
  }, [loadCollaborationStatus, project.id]);

  useEffect(() => {
    if (!showCollaborators || activeSection !== 'project-collaborations') return;
    void loadCollaboratorData();
  }, [activeSection, loadCollaboratorData]);

  useEffect(() => {
    if (!showCollaboratorDialog) return;
    let current = true;
    setGithubConnection('checking');
    void api.githubStatus().then(status => {
      if (current) setGithubConnection(status.connected ? 'connected' : 'disconnected');
    }).catch(() => { if (current) setGithubConnection('unavailable'); });
    return () => { current = false; };
  }, [showCollaboratorDialog, project.id]);

  const openCollaboratorDialog = () => {
    setCollaboratorQuery('');
    setCollaboratorMatches([]);
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    setShowCollaboratorDialog(true);
  };

  useEffect(() => {
    if (!showCollaboratorDialog) return;
    const query = collaboratorQuery.trim();
    let current = true;
    setCollaboratorMatches([]);
    setCollaboratorError(null);
    setCollaboratorSearchLoading(query.length >= 2);
    if (query.length < 2) return;
    const timer = window.setTimeout(() => {
      void api.searchProjectCollaborators(project.id, query).then(result => {
        if (!current) return;
        setCollaboratorMatches(result.matches);
      }).catch(cause => {
        if (current) setCollaboratorError(userFacingError(cause, 'Collaborator search is unavailable.'));
      }).finally(() => {
        if (current) setCollaboratorSearchLoading(false);
      });
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [collaboratorQuery, project.id, showCollaboratorDialog]);

  const syncProjectCollaborators = async () => {
    const projectId = project.id;
    setSyncingProjectCollaborators(true);
    setGithubCollaboratorsError(null);
    setCollaboratorNotice(null);
    try {
      const result = await api.syncGithubCollaborators(projectId, true);
      if (currentProjectId.current !== projectId) return;
      setMembershipRevision(revision => revision + 1);
      const added = result.projectMembersAdded ?? 0;
      setCollaboratorNotice(added === 1 ? 'Added 1 new project viewer.' : `Added ${added} new project viewers.`);
    } catch (cause) {
      if (currentProjectId.current === projectId) setGithubCollaboratorsError(userFacingError(cause, 'Project collaborators could not be synced.'));
    } finally {
      setSyncingProjectCollaborators(false);
    }
  };

  const changeCollaboratorAccess = async (match: ProjectCollaboratorMatch) => {
    const projectId = project.id;
    if (match.state === 'joined' || collaboratorOwnerProject !== projectId || collaboratorAddLoading) return;
    setCollaboratorAddLoading(true);
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    try {
      let state: ProjectCollaboratorMatch['state'] = 'available';
      if (match.state === 'pending') await api.cancelPendingCollaborator(projectId, match.id);
      else ({ state } = await api.addProjectCollaborator(projectId, match));
      if (currentProjectId.current !== projectId) return;
      setCollaboratorMatches(matches => matches.map(item => item.provider === match.provider && item.id === match.id
        ? { ...item, state } : item));
      if (state === 'joined') setMembershipRevision(revision => revision + 1);
      setCollaboratorNotice(state === 'available' ? 'Pending Viewer access cancelled.'
        : state === 'joined' ? `${match.name} has project Viewer access.`
          : `@${match.name} has 30 days to link their GitHub account to Centinel and open Projects.`);
    } catch (cause) {
      if (currentProjectId.current === projectId) setCollaboratorError(userFacingError(cause, 'Collaborator access could not be updated.'));
    } finally {
      setCollaboratorAddLoading(false);
    }
  };

  return (
    <div className="screen command-project-detail animate-fade-in">
      <CommandPageHeader
        eyebrow="Project"
        title={currentProject.name}
        onBack={() => onNavigate({ name: 'projects' })}
        actions={(
          <div className="project-action-menu">
            <button
              type="button"
              className="btn-primary project-action-trigger"
              aria-expanded={actionsOpen}
              aria-haspopup="menu"
              onClick={() => setActionsOpen(open => !open)}
            >
              Action <ChevronDown size={15} aria-hidden="true" />
            </button>
            {actionsOpen && (
              <div className="project-action-popover" role="menu" aria-label="Project actions">
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); onNavigate({ name: 'review-entry', projectId: project.id }); }}>
                  <FolderOpen size={16} aria-hidden="true" /> Start Review
                </button>
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); onNavigate({name:'dynamic-testing',projectId:project.id}); }}>
                  <Play size={16} aria-hidden="true" /> Dynamic testing
                </button>
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); void handleExportReport(); }} disabled={exporting}>
                  <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export report'}
                </button>
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setShowReportHistory(true); void loadReportHistory(); }}>
                  <Clock3 size={16} aria-hidden="true" /> Report history
                </button>
              </div>
            )}
          </div>
        )}
      />

      <nav className="project-section-nav" aria-label="Project sections">
        <button className={activeSection === 'project-overview' ? 'active' : ''} aria-current={activeSection === 'project-overview' ? 'page' : undefined} onClick={() => moveToSection('project-overview')}>Overview</button>
        <button className={activeSection === 'project-assessment' ? 'active' : ''} aria-current={activeSection === 'project-assessment' ? 'page' : undefined} onClick={() => moveToSection('project-assessment')}>Assessment</button>
        <button className={activeSection === 'project-findings' ? 'active' : ''} aria-current={activeSection === 'project-findings' ? 'page' : undefined} onClick={() => { setAttentionFindingId(null); moveToSection('project-findings'); }}>Findings</button>
        <button className={activeSection === 'project-source' ? 'active' : ''} aria-current={activeSection === 'project-source' ? 'page' : undefined} onClick={() => moveToSection('project-source')}>Source</button>
        {showCollaborators && <button className={activeSection === 'project-collaborations' ? 'active' : ''} aria-current={activeSection === 'project-collaborations' ? 'page' : undefined} onClick={() => moveToSection('project-collaborations')}>Collaborators</button>}
        <button className={activeSection === 'project-settings' ? 'active' : ''} aria-current={activeSection === 'project-settings' ? 'page' : undefined} onClick={() => moveToSection('project-settings')}>Settings</button>
      </nav>

      {error && <p className="form-error command-inline-alert"><AlertCircle size={14} /> {error}</p>}
      {exportResult && <ReportExportCard
        result={exportResult}
        title="Project report ready"
        subject={`Summary and technical details for ${project.name}`}
        formatDate={formatProjectDateTime}
        headingId="report-export-heading"
        showMarkdownPreview
      />}
      <div className="detail-grid" id="project-overview">
        {/* Artifacts */}
        {activeSection === 'project-source' && <section className="card detail-card sources-card" id="project-source">
          <ArtifactsPanel projectId={project.id} initialView="repository" sourceArtifactId={sourceArtifactId} onOpenSettings={() => onNavigate({ name: 'settings' })} />
        </section>}

        {showReportHistory && <Modal isOpen onClose={() => setShowReportHistory(false)} title="Report history" width={760}><section className="project-reports-card" aria-label="Project report history">
          <p className="project-report-history-description">Past project reports include risk assessment, Review findings and evidence, decisions, and the latest available Dynamic Testing summary. Use Action → Export report to create a new snapshot.</p>
          {reportHistoryError && <p className="command-inline-alert" role="alert"><AlertCircle size={14} /> {reportHistoryError}</p>}
          {reportHistoryLoading ? <p className="project-reports-status" role="status">Loading report history…</p> : reportHistory.length === 0 ? (
            <div className="project-reports-empty">
              <Download size={22} aria-hidden="true" />
              <p>No reports have been exported for this project yet.</p>
            </div>
          ) : <div className="project-report-history" role="list" aria-label="Project report history">
            {reportHistory.map(report => {
              const links = reportLinks[report.id];
              return <article className="project-report-history-row" role="listitem" key={report.id}>
                <div className="project-report-history-main">
                  <strong>Report {formatEntityId(report.id)}</strong>
                  <span>Generated {formatProjectDateTime(report.createdAt)}</span>
                  <small>Policy {report.policyVersion} · Generator {report.generatorVersion}</small>
                  {report.checksum && <small className="project-report-checksum">Checksum <code>{report.checksum}</code></small>}
                </div>
                <div className="project-report-history-actions">
                  <button type="button" className="btn-secondary" onClick={() => void renewReportLinks(report.id)} disabled={renewingReportId === report.id}>
                    {renewingReportId === report.id ? 'Preparing…' : 'Get download links'}
                  </button>
                  {links && <div className="project-report-links" aria-label={`Downloads for report ${formatEntityId(report.id)}`}>
                    <a href={links.downloads.json} target="_blank" rel="noreferrer" download>JSON</a>
                    <a href={links.downloads.markdown} target="_blank" rel="noreferrer" download>Markdown</a>
                    <a href={links.downloads.pdf} target="_blank" rel="noreferrer" download>PDF</a>
                    <small>Links expire {formatProjectDateTime(links.expiresAt)}</small>
                  </div>}
                </div>
              </article>;
            })}
          </div>}
        </section></Modal>}

        {activeSection === 'project-overview' && <>
          <div className="project-overview-grid" aria-label="Project overview">
            <section className="card detail-card project-attention-card" aria-labelledby="project-attention-heading">
              <div className="panel-header">
                <div>
                  <h2 id="project-attention-heading"><AlertCircle size={19} /> Need attention</h2>
                </div>
                {!overviewInitialReadLoading && attentionItems.length > 0 && <span className="panel-count">{attentionItems.length} item{attentionItems.length === 1 ? '' : 's'}</span>}
              </div>
              {overviewInitialReadLoading ? <LoadingSkeleton variant="rows" rows={3} label="Loading project overview" /> : <>
                {overviewRefreshing && <p className="project-collaboration-status" role="status">Updating project overview…</p>}
                {overviewReadError && <p className="project-collaboration-status" role="status">Some project information could not be loaded. Open this section again to retry.</p>}
                {visibleAttentionItems.length > 0 ? (
                  <div className="project-attention-list">
                     {visibleAttentionItems.map(item => {
                       const needsDisclosure = attentionNeedsDisclosure(item.detail);
                       return (
                         <div key={item.id} className="project-attention-row">
                           <div className="project-attention-copy">
                             <div className="project-attention-title">
                               <strong data-risk={item.risk}>{item.title}{item.risk && <span className="visually-hidden"> · {item.risk} risk</span>}</strong>
                             </div>
                             <p>
                               <span>{attentionPreview(item.detail)}</span>
                               {needsDisclosure && <button
                                 type="button"
                                 className="project-attention-see-more"
                                 onClick={() => openAttentionDetail(item)}
                               >… See More</button>}
                             </p>
                           </div>
                           <button type="button" className="btn-secondary" onClick={() => handleAttentionAction(item)}>{item.actionLabel}</button>
                         </div>
                       );
                     })}
                  </div>
                ) : overviewReadError ? (
                  <div className="project-overview-empty"><ShieldAlert size={22} aria-hidden="true" /><p>Attention status is incomplete while project information is unavailable.</p></div>
                ) : (
                  <div className="project-overview-empty"><ShieldAlert size={22} aria-hidden="true" /><p>No items need attention right now.</p></div>
                )}
              </>}
            </section>

            <ProjectReadinessCard projectId={project.id} onStatusChange={setReadinessStatus} />
          </div>

          <section className="card detail-card project-activity-summary" id="project-recent-activity" aria-labelledby="project-recent-activity-heading">
             <div className="panel-header project-activity-header">
               <div className="project-activity-title"><h2 id="project-recent-activity-heading"><Clock3 size={19} /> Recent activity</h2><div className="project-activity-type-toggle" role="group" aria-label="Activity type">
                 <button type="button" className={activityType === 'all' ? 'active' : ''} aria-label="All activity" aria-pressed={activityType === 'all'} title="All activity" onClick={() => setActivityType('all')}><ListFilter size={16} aria-hidden="true" /></button>
                 <button type="button" className={activityType === 'review' ? 'active' : ''} aria-pressed={activityType === 'review'} onClick={() => setActivityType('review')}><FileCheck2 size={16} aria-hidden="true" /><span>Review</span></button>
                 <button type="button" className={activityType === 'dynamic' ? 'active' : ''} aria-pressed={activityType === 'dynamic'} onClick={() => setActivityType('dynamic')}><MonitorPlay size={16} aria-hidden="true" /><span>Dynamic Testing</span></button>
               </div></div>
                <span className="project-activity-header-end">
                  {!activityInitialReadLoading && <span className="panel-count">{activityLoadError && projectActivities.length === 0 ? 'Unavailable' : `${Math.min(5, projectActivities.length)} of ${projectActivities.length}`}</span>}
                </span>
             </div>
             <div className="project-activity-filters" aria-label="Filter recent activity">
               <label className="project-activity-search"><span>Search</span><input type="search" aria-label="Search activity" value={activityQuery} onChange={event => setActivityQuery(event.target.value)} placeholder="Activity name or state" /></label>
               <label htmlFor="project-activity-datetime">Datetime<input id="project-activity-datetime" type="datetime-local" value={activityDateTime} onChange={event => setActivityDateTime(event.target.value)} /></label>
               <label htmlFor="project-activity-state">State<Select id="project-activity-state" value={activityState} onChange={value => setActivityState(value as ActivityState)} options={[{ value: 'all', label: 'All states' }, { value: 'queued', label: 'Queued' }, { value: 'running', label: 'In progress' }, { value: 'needs_approval', label: 'Need Approval' }, { value: 'success', label: 'Completed' }, { value: 'needs_attention', label: 'Needs attention' }, { value: 'cancelled', label: 'Cancelled' }]} /></label>
             </div>
             {activityInitialReadLoading || (activityRefreshing && projectActivities.length === 0) ? <LoadingSkeleton variant="rows" rows={5} label="Loading recent activity" /> : <>
               {activityLoadError && <p className="project-collaboration-status" role="status">Some recent activity could not be loaded.</p>}
               {visibleProjectActivities.map(activity => (
                 <button key={`${activity.kind}-${activity.id}`} type="button" className="project-activity-row" onClick={() => activity.kind === 'Review' ? onNavigate({ name: 'review-activity', projectId: project.id, sessionId: activity.id, reviewName: activity.name }) : onNavigate(dynamicActivityScreen(project.id, activity))}>
                   <span className="project-activity-main"><strong>{activity.name} <span className="project-activity-id">{formatEntityId(activity.id)}</span> <time dateTime={activity.createdAt}>done at {formatProjectDateTime(activity.createdAt)}</time></strong><small>{activity.kind}</small></span>
                   <StatusBadge label={activity.status} />
                   <ChevronRight size={15} aria-hidden="true" />
                 </button>
               ))}
               {projectActivities.length === 0 && <p className="card-empty">{activityLoadError ? 'Recent activity could not be loaded.' : staticSessions.length + dynamicSessions.length === 0 ? 'No activity yet. Start a Review or Dynamic Testing from Action.' : 'No activity matches these filters.'}</p>}
               {projectActivities.length > 5 && <nav className="project-pagination project-activity-pagination" aria-label="Recent activity pages">
                 <span className="project-pagination-range">{activityPage * 5 + 1}–{Math.min((activityPage + 1) * 5, projectActivities.length)} of {projectActivities.length}</span>
                 <span className="project-pagination-controls"><button type="button" className="btn-secondary" onClick={() => setActivityPage(page => Math.max(0, page - 1))} disabled={activityPage === 0} aria-label="Previous activity page"><ChevronLeft size={16} aria-hidden="true" /></button><span className="project-pagination-label">Page {activityPage + 1} of {activityPageCount}</span><button type="button" className="btn-secondary" onClick={() => setActivityPage(page => Math.min(activityPageCount - 1, page + 1))} disabled={activityPage >= activityPageCount - 1} aria-label="Next activity page"><ChevronRight size={16} aria-hidden="true" /></button></span>
               </nav>}
             </>}
          </section>
        </>}

        {activeSection === 'project-assessment' && <section className="card detail-card project-risk-card" id="project-assessment" aria-labelledby="project-risk-heading">
          <div className="panel-header">
            <div>
              <h2 id="project-risk-heading"><ShieldAlert size={19} /> Assessment <button type="button" className="command-icon-button assessment-info-button" aria-label="Assessment information" title="How Assessment risk is measured" onClick={() => setAssessmentInfoPage('severity')}><Info size={16} aria-hidden="true" /></button></h2>
            </div>
              <span className="panel-count">{assessmentInitialReadLoading || findingsLoading ? 'Loading…' : findingsError ? 'Unavailable' : assessmentData?.status === 'available' && assessmentData.summary ? `${assessmentData.summary.classified} classified${assessmentData.summary.unclassified > 0 ? ` · ${assessmentData.summary.unclassified} unavailable` : ''}` : `${riskLevelFindings.length} classified${currentFindings.length > riskLevelFindings.length ? ` · ${currentFindings.length - riskLevelFindings.length} unavailable` : ''}`}</span>
          </div>
          <p className="project-assessment-scope-note">Risk here comes from Review findings. Dynamic Testing results stay in Dynamic Testing and are not added to this score.</p>
          {assessmentInitialReadLoading ? <LoadingSkeleton variant="panel" label="Loading assessment" /> : <>
          {assessmentLoading && <p className="project-collaboration-status" role="status">Updating assessment…</p>}
          <section className="project-risk-summary-section" aria-labelledby="risk-summary-heading">
            <div className="project-risk-section-heading"><div><h3 id="risk-summary-heading">Risk Summary</h3></div></div>
            <div className="project-risk-overview-grid">
              <div className="project-traceability-attention-card"><div><strong>Requirement traceability attention</strong><span>{traceabilitySummaryLoading ? 'Loading…' : latestTraceabilitySummary ? latestTraceabilitySummary.attention : '—'}</span><small>{latestTraceabilitySummary ? `${latestTraceabilitySummary.missing} Missing · ${latestTraceabilitySummary.incomplete} Incomplete` : latestTraceabilityReview ? 'Traceability snapshot unavailable' : 'No completed Review snapshot available'}</small></div>{latestTraceabilityReview && <button type="button" className="btn-link" onClick={() => { try { window.sessionStorage.setItem(`centinel:review-result-tab:${project.id}:${latestTraceabilityReview.id}`, 'Traceability'); } catch { /* storage is optional */ } onNavigate({ name: 'review-activity', projectId: project.id, sessionId: latestTraceabilityReview.id, reviewName: latestTraceabilityReview.name }); }}>View latest review <span aria-hidden="true">→</span></button>}</div>
              <div className="project-risk-count-grid" aria-label="Risk level counts">
                {(['low', 'medium', 'high', 'critical'] as const).map(level => <div key={level} className={`project-risk-count project-risk-count-${level}`}><strong>{findingsError || findingsLoading ? '—' : riskSummary[level]}</strong><span>{level.charAt(0).toUpperCase() + level.slice(1)} Risk</span></div>)}
              </div>
            </div>
          </section>
          <section className="project-risk-items-section" aria-labelledby="risk-items-heading">
            <div className="project-risk-section-heading"><div><h3 id="risk-items-heading">Risk Items</h3><p>Four highest-risk unresolved findings.</p></div><span className="panel-count">{Math.min(4, displayedRiskFindings.length)} of {displayedRiskFindings.length}</span></div>
            {displayedRiskFindings.length > 0 ? <div className="project-risk-table-wrap"><table className="project-risk-table" aria-label="Current risk items"><thead><tr><th scope="col">Risk</th><th scope="col">Severity</th><th scope="col">Priority</th><th scope="col">Finding</th><th scope="col">Category</th><th scope="col">Status</th></tr></thead><tbody>{displayedRiskFindings.slice(0, 4).map(finding => <tr key={finding.id}><td><span className={`project-risk-level project-risk-level-${finding.riskLevel}`}>{finding.riskLevel}</span></td><td>{finding.severity}</td><td>{finding.priority || 'Not set'}</td><td><strong>{finding.title}</strong></td><td>{finding.category || '—'}</td><td>{finding.status === 'fixed' ? 'Resolved' : finding.status === 'dismissed' ? 'Dismissed' : 'Unresolved'}</td></tr>)}</tbody></table></div> : <p className="card-empty">{findingsError ? 'Risk items could not be loaded.' : findingsLoading ? 'Loading risk items…' : riskLevelFindings.length === 0 ? 'No classified unresolved risk items.' : 'No current risk items.'}</p>}
            <button type="button" className="btn-link project-see-more-findings" onClick={() => { setFindingsFilter({ riskLevel: 'critical_or_high', status: 'unresolved' }); moveToSection('project-findings'); }}>See More Findings <span aria-hidden="true">→</span></button>
          </section>
          </>}
          <AssessmentInfoDialog page={assessmentInfoPage} onPageChange={setAssessmentInfoPage} onClose={() => setAssessmentInfoPage(null)} />
        </section>}

        {activeSection === 'project-findings' && <div id="project-findings">
           <FindingsPanel
             projectId={project.id}
             supplementalFindings={supplementalProjectFindings}
             supplementalUnavailableMessage={[readinessStatus?.stale && readinessStatus.snapshot ? 'Readiness findings describe previous sources and are hidden until a current assessment is available.' : null, currentReviewGaps?.message].filter(Boolean).join(' ') || null}
             presentation="project"
             focusFindingId={initialSection === 'findings' ? findingId : attentionFindingId}
             initialReviewFilter={findingsReviewId}
             readOnly={Boolean(findingsReviewId && !staticSessions.some(review =>
               review.id === findingsReviewId && review.status !== 'queued' && review.status !== 'running'))}
             onVerifyWithDynamic={finding => onNavigate({ name: 'dynamic-testing', projectId: project.id, draft: findingToDynamicDraft(finding) })}
             recheckFor={recheckFor}
             onOpenReview={reviewId => {
               const review = staticSessions.find(session => session.id === reviewId);
               onNavigate({ name: 'review-activity', projectId: project.id, sessionId: reviewId, reviewName: review?.name });
             }}
            pageSize={5}
            initialFilter={findingsFilter}
            refreshKey={
              activeReviewState?.session.projectId === project.id
                ? `${activeReviewState.session.id}:${activeReviewState.session.status}`
               : undefined
             }
           />
        </div>}

        {showCollaborators && activeSection === 'project-collaborations' && <section className="card detail-card project-collaboration-card" id="project-collaborations">
          <div className="panel-header project-collaboration-header">
            <h2><Users size={19} aria-hidden="true" /> Project Collaborators</h2>
            <div className="project-collaboration-actions">
              {collaborationStatus?.available && collaboratorOwnerProject === project.id && <button type="button" className="btn-secondary" onClick={() => void syncProjectCollaborators()} disabled={githubCollaboratorsLoading || syncingProjectCollaborators}>{syncingProjectCollaborators ? 'Syncing…' : 'Sync GitHub collaborators'}</button>}
            </div>
          </div>
          <div className={`project-collaboration-search-row${collaboratorOwnerProject === project.id ? ' with-add-action' : ''}`}>
            <div role="search" aria-label="Project collaborator search">
              <label className="project-collaboration-search-control"><Search size={16} aria-hidden="true" /><span className="visually-hidden">Search project collaborators</span><input type="search" value={collaboratorFilter} onChange={event => setCollaboratorFilter(event.target.value)} placeholder="Search by email" /></label>
            </div>
            {(collaboratorOwnerProject === project.id) && <button type="button" className="btn-secondary" onClick={openCollaboratorDialog}><UserPlus size={16} aria-hidden="true" /> Add collaborator</button>}
          </div>
          <ProjectMembersPanel key={`${project.id}:${membershipRevision}`} projectId={project.id} inline search={collaboratorFilter} onOwnerProjectChange={setCollaboratorOwnerProject} />
          {collaborationStatusError && <p className="command-inline-alert" role="alert">{collaborationStatusError}</p>}
          {githubCollaboratorsError && <p className="command-inline-alert" role="alert">{githubCollaboratorsError}</p>}
          {collaboratorNotice && <p className="collaborator-dialog-notice" role="status">{collaboratorNotice}</p>}

        </section>}

        {activeSection === 'project-settings' && <section className="card detail-card project-settings-card" id="project-settings">
          <div className="panel-header project-settings-header">
            <div><h2><Settings size={19} /> Settings</h2></div>
            <div className="project-settings-actions">
              {!settingsEditing ? (
                <button type="button" className="btn-secondary" onClick={() => { setSettingsEditing(true); setSettingsSaved(false); }}><Settings size={15} aria-hidden="true" /> Edit</button>
              ) : (
                <>
                  <button type="button" className="btn-secondary" onClick={handleCancelSettings} disabled={savingSettings}>Cancel</button>
                  <button type="button" className="btn-primary" onClick={() => void handleSaveSettings()} disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save'}</button>
                </>
              )}
            </div>
          </div>
          <div className="project-settings-stack">
            <section className="project-settings-section" aria-labelledby="project-settings-heading">
              <h3 id="project-settings-heading">Project settings</h3>
              <div className="project-settings-form">
                <label htmlFor="project-setting-name"><span>Project name</span><input id="project-setting-name" disabled={!settingsEditing} value={settingsDraft.name} onChange={event => setSettingsDraft(draft => ({ ...draft, name: event.target.value }))} /></label>
                <label htmlFor="project-setting-description"><span>Description</span>{settingsEditing ? <textarea id="project-setting-description" value={settingsDraft.description} onChange={event => setSettingsDraft(draft => ({ ...draft, description: event.target.value }))} placeholder="enter your description here" rows={3} /> : <div id="project-setting-description" className="project-settings-readonly-description" role="textbox" aria-readonly="true" aria-label="Description">{settingsDraft.description || 'No description provided.'}</div>}</label>
                <label htmlFor="project-setting-workspace"><span>Workspace</span>{settingsEditing ? <span className="project-workspace-picker"><input id="project-setting-workspace" value={settingsDraft.workspacePath} readOnly aria-readonly="true" aria-haspopup="dialog" onClick={() => void chooseWorkspaceFolder()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void chooseWorkspaceFolder(); } }} /><button type="button" className="project-workspace-picker-button" aria-label="Choose workspace folder" onClick={() => void chooseWorkspaceFolder()}><FolderOpen size={16} aria-hidden="true" /></button></span> : <span id="project-setting-workspace" className="project-settings-readonly-workspace" role="textbox" aria-readonly="true" aria-label="Workspace">{settingsDraft.workspacePath}</span>}</label>
              </div>
              <dl className="project-settings-facts">
                <div><dt>Created Datetime</dt><dd><time dateTime={currentProject.createdAt}>{formatProjectDateTime(currentProject.createdAt)}</time></dd></div>
              </dl>
              {settingsError && <p className="command-inline-alert" role="alert"><AlertCircle size={14} /> {settingsError}</p>}
              {settingsSaved && <p className="project-settings-saved" role="status"><CheckCircle2 size={15} aria-hidden="true" /> Project settings saved.</p>}
            </section>

            <section className="project-danger-zone" aria-labelledby="project-danger-zone-heading">
              <div><h3 id="project-danger-zone-heading">Remove project</h3><p>Removing this project is unrecoverable. Workspace files will be retained.</p></div>
              <button type="button" className="btn-danger" onClick={() => setShowDeleteProject(true)}><Trash2 size={16} aria-hidden="true" /> Remove project</button>
            </section>
          </div>
        </section>}

      </div>

      <Modal
        isOpen={attentionDetailItem !== null}
        onClose={() => setAttentionDetailItem(null)}
        title={attentionDetailItem?.title ?? 'Attention details'}
        width={560}
      >
        {attentionDetailItem && <div className="project-attention-dialog">
          <p>{attentionDetailItem.detail}</p>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setAttentionDetailItem(null)}>Close</button>
            <button type="button" className="btn-primary" onClick={() => { const item = attentionDetailItem; setAttentionDetailItem(null); handleAttentionAction(item); }}>{attentionDetailItem.actionLabel}</button>
          </div>
        </div>}
      </Modal>

      <Modal
        isOpen={showCollaborators && showCollaboratorDialog}
        onClose={collaboratorAddLoading ? () => undefined : () => setShowCollaboratorDialog(false)}
        title="Add collaborator"
        width={560}
      >
        {(githubConnection === 'disconnected' || githubConnection === 'unavailable') &&
          <div className="collaborator-connection-state" aria-label="GitHub connection">
            <GitBranch size={16} aria-hidden="true" /><strong>GitHub</strong>
            <StatusBadge label={githubConnection === 'disconnected' ? 'Disconnected' : 'Status unavailable'} tone="neutral" />
            <button type="button" className="btn-secondary" disabled={collaboratorAddLoading} onClick={() => {
              setShowCollaboratorDialog(false);
              onNavigate({ name: 'settings', section: 'connections' });
            }}>Open connections</button>
          </div>}
        <div className="collaborator-dialog">
          <div className="collaborator-search-form">
            <label htmlFor="collaborator-query">Find a collaborator</label>
            <span className="collaborator-query-control">
              <input id="collaborator-query" type="search" value={collaboratorQuery} maxLength={320}
                onChange={event => { setCollaboratorQuery(event.target.value); setCollaboratorNotice(null); }}
                placeholder={githubConnection === 'disconnected' || githubConnection === 'unavailable' ? 'Centinel email' : 'GitHub username, name, or Centinel email'}
                disabled={collaboratorAddLoading} />
              <Search size={16} aria-hidden="true" />
            </span>
          </div>
          {collaboratorSearchLoading && <p className="collaborator-dialog-status" role="status">Searching accounts…</p>}
          {!collaboratorSearchLoading && collaboratorQuery.trim().length >= 2 && !collaboratorError && !collaboratorMatches.length
            && <p className="collaborator-dialog-status" role="status">No matching accounts.</p>}
          {collaboratorError && <p className="command-inline-alert" role="alert">{collaboratorError}</p>}
          {collaboratorNotice && <p className="collaborator-dialog-notice" role="status">{collaboratorNotice}</p>}
          {collaboratorMatches.length > 0 && <div className="collaborator-results" aria-label="Matching accounts">
            {collaboratorMatches.map(match => <div className="collaborator-result-row" key={`${match.provider}:${match.id}`}>
              <button type="button" className="collaborator-result"
                disabled={match.state !== 'available' || collaboratorAddLoading} onClick={() => void changeCollaboratorAccess(match)}>
                {match.avatarUrl ? <img src={match.avatarUrl} alt="" /> : <span className="collaborator-avatar" aria-hidden="true"><Users size={16} /></span>}
                <span className="collaborator-result-account"><strong>{match.name}</strong><small>{match.provider === 'github' ? 'GitHub' : 'Centinel'}</small></span>
                {match.state === 'joined' && <StatusBadge label="Joined" tone="success" />}
                {match.state === 'pending' && <StatusBadge label="Pending" tone="neutral" />}
                {match.state === 'available' && <UserPlus size={16} aria-hidden="true" />}
              </button>
              {match.state === 'pending' && <button type="button" className="btn-secondary" disabled={collaboratorAddLoading}
                aria-label={`Cancel pending access for ${match.name}`} onClick={() => void changeCollaboratorAccess(match)}>Cancel</button>}
            </div>)}
          </div>}
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteProject}
        onClose={deletingProject ? () => undefined : () => setShowDeleteProject(false)}
        title="Remove project"
        width={460}
      >
        <div className="confirm-dialog-content">
          <span className="confirm-dialog-icon" aria-hidden="true"><Trash2 size={20} /></span>
          <p>Remove <strong>{currentProject.name}</strong> and its indexed records from Centinel? Files in <span className="project-workspace">{currentProject.workspacePath}</span> will be retained.</p>
        </div>
        <div className="form-actions confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={() => setShowDeleteProject(false)} disabled={deletingProject} data-autofocus>Cancel</button>
          <button type="button" className="btn-danger" onClick={() => void handleDeleteProject()} disabled={deletingProject}>{deletingProject ? 'Removing…' : 'Remove project'}</button>
        </div>
      </Modal>
    </div>
  );
}

function AssessmentInfoDialog({
  page,
  onPageChange,
  onClose,
}: {
  page: AssessmentInfoPage | null;
  onPageChange: (page: AssessmentInfoPage) => void;
  onClose: () => void;
}) {
  const pages: Array<{ id: AssessmentInfoPage; label: string }> = [
    { id: 'severity', label: 'Severity' },
    { id: 'priority', label: 'Priority' },
    { id: 'risk', label: 'Risk Measurement' },
  ];
  const activePage = page ?? 'severity';
  const handlePageKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: AssessmentInfoPage) => {
    const index = pages.findIndex(item => item.id === current);
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % pages.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + pages.length) % pages.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = pages.length - 1;
    if (nextIndex !== index) {
      event.preventDefault();
      onPageChange(pages[nextIndex].id);
      requestAnimationFrame(() => document.getElementById(`assessment-info-tab-${pages[nextIndex].id}`)?.focus());
    }
  };

  return <Modal isOpen={Boolean(page)} onClose={onClose} title="Assessment information" width={720}>
    <div className="assessment-info-dialog">
      <div className="assessment-info-tabs" role="tablist" aria-label="Assessment information pages">
        {pages.map(item => <button key={item.id} id={`assessment-info-tab-${item.id}`} type="button" role="tab" aria-selected={activePage === item.id} aria-controls={`assessment-info-panel-${item.id}`} tabIndex={activePage === item.id ? 0 : -1} data-autofocus={activePage === item.id ? true : undefined} onClick={() => onPageChange(item.id)} onKeyDown={event => handlePageKeyDown(event, item.id)}>{item.label}</button>)}
      </div>
      {activePage === 'severity' && <section id="assessment-info-panel-severity" role="tabpanel" aria-labelledby="assessment-info-tab-severity" tabIndex={0}><h3 id="assessment-info-severity">Severity</h3><p>Severity represents the potential impact of an identified finding.</p><dl className="assessment-info-definitions"><div><dt>Critical</dt><dd>Severe impact requiring immediate attention, such as major security, correctness, integrity, or production-impacting concerns.</dd></div><div><dt>High</dt><dd>Significant impact that should be remediated promptly.</dd></div><div><dt>Medium</dt><dd>Material concern that should be addressed but does not normally require immediate intervention.</dd></div><div><dt>Low</dt><dd>Limited-impact concern or lower-urgency improvement.</dd></div></dl><p className="assessment-info-note">Informational findings remain visible in Findings when supported, but are not silently converted into Low Risk.</p></section>}
      {activePage === 'priority' && <section id="assessment-info-panel-priority" role="tabpanel" aria-labelledby="assessment-info-tab-priority" tabIndex={0}><h3 id="assessment-info-priority">Priority</h3><p>Priority represents remediation and review urgency. It is independent from Severity.</p><dl className="assessment-info-definitions"><div><dt>High</dt><dd>Respond promptly because delay materially increases exposure or blocks important work.</dd></div><div><dt>Medium</dt><dd>Schedule remediation in the normal project flow.</dd></div><div><dt>Low</dt><dd>Address when practical or as part of routine improvement.</dd></div></dl><p className="assessment-info-note">Example: a finding can be Severity <strong>High</strong> and Priority <strong>Medium</strong>. Severity describes impact; Priority describes urgency.</p></section>}
      {activePage === 'risk' && <section id="assessment-info-panel-risk" role="tabpanel" aria-labelledby="assessment-info-tab-risk" tabIndex={0}><h3 id="assessment-info-risk">Risk Measurement</h3><p>Centinel determines a finding's Risk Level by evaluating the combination of its Severity and Priority. Severity represents potential impact, while Priority represents remediation urgency. The resulting classification is evaluated using Centinel's predefined risk matrix.</p><div className="assessment-risk-matrix-wrap"><table className="assessment-risk-matrix" aria-label="Centinel Risk Matrix v1"><thead><tr><th scope="col">Severity / Priority</th><th scope="col">High</th><th scope="col">Medium</th><th scope="col">Low</th></tr></thead><tbody>{RISK_MATRIX_ROWS.map(row => <tr key={row.severity}><th scope="row">{row.severity}</th><td>{row.high}</td><td>{row.medium}</td><td>{row.low}</td></tr>)}</tbody></table></div><p className="assessment-info-note"><strong>Severity ≠ Priority ≠ Risk Category ≠ Risk Level.</strong> Risk Category describes the type or domain of concern, such as Security or Requirement. This deterministic matrix is Centinel policy; it is not claimed as a direct ISO/IEEE mandate.</p></section>}
      <div className="assessment-info-navigation"><button type="button" className="btn-secondary" onClick={() => onPageChange(pages[Math.max(0, pages.findIndex(item => item.id === activePage) - 1)].id)} disabled={activePage === pages[0].id}>Previous</button><span>{pages.findIndex(item => item.id === activePage) + 1} of {pages.length}</span><button type="button" className="btn-secondary" onClick={() => onPageChange(pages[Math.min(pages.length - 1, pages.findIndex(item => item.id === activePage) + 1)].id)} disabled={activePage === pages[pages.length - 1].id}>Next</button></div>
    </div>
  </Modal>;
}
