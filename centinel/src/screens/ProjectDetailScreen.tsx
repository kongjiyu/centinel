import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Download, Plus, FolderOpen, Play, AlertCircle, GitBranch, RotateCw, Clock3, ChevronLeft, ChevronRight, ChevronDown, Users, Settings, ShieldAlert, Info, Trash2, Search, UserPlus, CheckCircle2, TriangleAlert, CircleX, ListFilter, FileCheck2, MonitorPlay } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { api, type ProjectReportDownloadLinks, type ProjectReportExportResult, type ProjectReportHistoryEntry } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { projectActivityLifecycle, projectActivityLifecycleTone } from '../reviewViewModel';
import { userFacingError } from '../utils/userFacingError';
import { formatEntityId } from '../utils/entityId';
import { deriveRiskLevel, priorityRank, riskLevelRank, RISK_MATRIX_ROWS } from '../riskPolicy';
import type { Project, DynamicSession, StaticSession, Artifact, Screen, Finding, ProjectAssessment, CollaborationStatus, CollaboratorMatch, GithubCollaboratorSnapshot } from '../types';
import './ProjectDetailScreen.css';

type Props = {
  project: Project;
  onNavigate: (screen: Screen) => void;
  onProjectUpdated?: (project: Project) => void;
  initialAction?: 'static' | 'dynamic';
  initialStaticSessionId?: string;
};

type ActivityState = 'all' | 'queued' | 'running' | 'needs_approval' | 'success' | 'needs_attention' | 'cancelled';

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  action: 'source' | 'findings' | 'activity' | 'actions';
  actionLabel: string;
  filter?: { category?: string; search?: string };
};

type AssessmentInfoPage = 'severity' | 'priority' | 'risk';

type ReadinessItem = {
  id: string;
  label: string;
  count: number;
  state: 'ready' | 'insufficient' | 'missing';
};

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

export function ProjectDetailScreen({ project, onNavigate, onProjectUpdated, initialAction, initialStaticSessionId: _initialStaticSessionId }: Props) {
  const [currentProject, setCurrentProject] = useState(project);
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [showDynamicForm, setShowDynamicForm] = useState(initialAction === 'dynamic');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ProjectReportExportResult | null>(null);
  const [reportHistory, setReportHistory] = useState<ProjectReportHistoryEntry[]>([]);
  const [reportHistoryLoading, setReportHistoryLoading] = useState(false);
  const [reportHistoryError, setReportHistoryError] = useState<string | null>(null);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [reportLinks, setReportLinks] = useState<Record<string, ProjectReportDownloadLinks>>({});
  const [renewingReportId, setRenewingReportId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('project-overview');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activityQuery, setActivityQuery] = useState('');
  const [activityType, setActivityType] = useState<'all' | 'review' | 'dynamic'>('all');
  const [activityDateTime, setActivityDateTime] = useState('');
  const [activityState, setActivityState] = useState<ActivityState>('all');
  const [activityPage, setActivityPage] = useState(0);
  const [projectFindings, setProjectFindings] = useState<Finding[]>([]);
  const [assessmentData, setAssessmentData] = useState<ProjectAssessment | null>(null);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [latestTraceabilitySummary, setLatestTraceabilitySummary] = useState<{ complete: number; incomplete: number; missing: number; attention: number } | null>(null);
  const [latestTraceabilityReview, setLatestTraceabilityReview] = useState<StaticSession | null>(null);
  const [traceabilitySummaryLoading, setTraceabilitySummaryLoading] = useState(false);
  const [assessmentInfoPage, setAssessmentInfoPage] = useState<AssessmentInfoPage | null>(null);
  const [attentionPage, setAttentionPage] = useState(0);
  const [settingsDraft, setSettingsDraft] = useState({ name: project.name, description: project.description, workspacePath: project.workspacePath });
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [collaborationStatus, setCollaborationStatus] = useState<CollaborationStatus | null>(null);
  const [collaborationStatusLoading, setCollaborationStatusLoading] = useState(false);
  const [collaborationQuery, setCollaborationQuery] = useState('');
  const [githubCollaborators, setGithubCollaborators] = useState<GithubCollaboratorSnapshot | null>(null);
  const [githubCollaboratorsLoading, setGithubCollaboratorsLoading] = useState(false);
  const [githubCollaboratorsSyncing, setGithubCollaboratorsSyncing] = useState(false);
  const [githubCollaboratorsError, setGithubCollaboratorsError] = useState<string | null>(null);
  const [showCollaboratorDialog, setShowCollaboratorDialog] = useState(false);
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [collaboratorMatches, setCollaboratorMatches] = useState<CollaboratorMatch[]>([]);
  const [selectedCollaborator, setSelectedCollaborator] = useState<CollaboratorMatch | null>(null);
  const [collaboratorSearchLoading, setCollaboratorSearchLoading] = useState(false);
  const [collaboratorInviteLoading, setCollaboratorInviteLoading] = useState(false);
  const [collaboratorError, setCollaboratorError] = useState<string | null>(null);
  const [collaboratorNotice, setCollaboratorNotice] = useState<string | null>(null);
  const [repositoryInfoOpen, setRepositoryInfoOpen] = useState(false);
  const collaboratorSearchRequest = useRef(0);
  const [attentionDetailItem, setAttentionDetailItem] = useState<AttentionItem | null>(null);
  const [findingsFilter, setFindingsFilter] = useState<{ riskLevel?: 'critical_or_high'; status?: 'unresolved'; category?: string; search?: string } | null>(null);

  const { state: activeReviewState } = useActiveReviewState();

  useEffect(() => {
    setShowDynamicForm(initialAction === 'dynamic');
    if (!initialAction) return;
    const sectionId = 'project-overview';
    setActiveSection(sectionId);
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }, [initialAction, project.id]);

  const loadDynamicSessions = useCallback(async () => {
    try { setDynamicSessions(await api.listDynamicSessions(project.id)); } catch {}
  }, [project.id]);

  const loadStaticSessions = useCallback(async () => {
    try { setStaticSessions(await api.listStaticSessions(project.id)); } catch {}
  }, [project.id]);

  const loadArtifacts = useCallback(async () => {
    try {
      setArtifacts(await api.listArtifacts(project.id));
      setArtifactsError(null);
    } catch (cause) {
      setArtifacts([]);
      setArtifactsError(userFacingError(cause, 'Sources could not be loaded.'));
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
    setCollaborationQuery('');
  }, [project.description, project.id, project.name, project.workspacePath]);

  useEffect(() => { loadDynamicSessions(); loadStaticSessions(); loadArtifacts(); loadProjectFindings(); loadReportHistory(); }, [loadDynamicSessions, loadStaticSessions, loadArtifacts, loadProjectFindings, loadReportHistory]);

  useEffect(() => {
    if (typeof api.getProjectAssessment !== 'function') {
      setAssessmentData(null);
      return;
    }
    let cancelled = false;
    api.getProjectAssessment(project.id)
      .then(data => { if (!cancelled) setAssessmentData(data.status === 'available' ? data : null); })
      .catch(() => { if (!cancelled) setAssessmentData(null); });
    return () => { cancelled = true; };
  }, [project.id, projectFindings, staticSessions]);

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
    const hasActive = dynamicSessions.some(s => s.status === 'running' || s.status === 'queued') ||
      staticSessions.some(s => s.status === 'running' || s.status === 'queued');
    if (!hasActive) return;
    const interval = setInterval(() => { loadDynamicSessions(); loadStaticSessions(); }, 2000);
    return () => clearInterval(interval);
  }, [dynamicSessions, staticSessions, loadDynamicSessions, loadStaticSessions]);

  const handleCreateDynamic = async (data: { targetUrl: string; goal: string; missionType: 'user_journey' | 'smoke'; maxSteps: number }) => {
    setError(null);
    try {
      const session = await api.createDynamicSession(project.id, data);
      setShowDynamicForm(false);
      onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: session.id });
    } catch (e) { setError(userFacingError(e, 'Dynamic Testing could not be started.')); throw e; }
  };

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
    name: session.name,
    kind: 'Dynamic Testing' as const,
    rawStatus: session.status,
    status: projectActivityLifecycle(session, 'dynamic'),
    createdAt: session.updatedAt || session.createdAt,
  }))]
    .filter(activity => activityType === 'all' || (activityType === 'review' ? activity.kind === 'Review' : activity.kind === 'Dynamic Testing'))
    .filter(activity => {
      if (activityState === 'all') return true;
      if (activityState === 'needs_attention') return activity.status === 'Failed';
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

  useEffect(() => {
    setActivityPage(page => Math.min(page, activityPageCount - 1));
  }, [activityPageCount]);

  useEffect(() => {
    setActivityPage(0);
  }, [activityDateTime, activityQuery, activityState, activityType]);

  const unresolvedFindings = useMemo(() => projectFindings
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

  const displayedRiskFindings = assessmentData?.status === 'available' ? assessmentData.riskItems : riskFindings;

  const latestReview = useMemo(() => [...staticSessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null, [staticSessions]);
  const latestDynamicTest = useMemo(() => [...dynamicSessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null, [dynamicSessions]);
  const latestReviewState = latestReview ? projectActivityLifecycle(latestReview, 'review') : null;
  const latestDynamicState = latestDynamicTest ? projectActivityLifecycle(latestDynamicTest, 'dynamic') : null;

  useEffect(() => {
    const completedReview = [...staticSessions]
      .filter(review => review.status === 'success' && review.currentDecision?.decision === 'approved')
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
  }, [assessmentData, project.id, staticSessions]);

  const recurringPatterns = useMemo(() => {
    const approvedSessionIds = new Set(staticSessions.filter(review => review.status === 'success' && review.currentDecision?.decision === 'approved').map(review => review.id));
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

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (artifactsError) {
      items.push({
        id: 'sources-unavailable',
        title: 'Sources could not be checked',
        detail: 'The source service is unavailable. Retry before starting a Review.',
        action: 'source',
        actionLabel: 'Inspect',
      });
    }

    [...staticSessions, ...dynamicSessions]
      .filter(session => session.status === 'blocked' || session.status === 'failure')
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .forEach(session => items.push({
        id: `session-${session.id}`,
        title: `${session.name} needs attention`,
        detail: userFacingError(session.failureReason, 'The activity did not complete. Inspect the activity details before retrying.'),
        action: 'activity',
        actionLabel: 'Inspect',
      }));

    recurringPatterns.forEach(pattern => items.push({
      id: `recurring-${pattern.label}`,
      title: `Recurring Finding Patterns · ${pattern.label}`,
      detail: `${pattern.sessions.size} completed Review session${pattern.sessions.size === 1 ? '' : 's'} contain this pattern.`,
      action: 'findings',
      actionLabel: 'Review',
      filter: pattern.filter,
    }));

    unresolvedFindings.forEach(finding => items.push({
      id: `finding-${finding.id}`,
      title: finding.title,
      detail: `${finding.severity} finding from ${finding.source === 'static' ? 'Review' : 'Dynamic Testing'}.`,
      action: 'findings',
      actionLabel: 'Review',
    }));

    if (!artifactsError && artifacts.length === 0) {
      items.push({
        id: 'sources-missing',
        title: 'Add sources to this project',
        detail: 'Upload a document or import a repository before starting a Review.',
        action: 'source',
        actionLabel: 'Set up',
      });
    }

    if (staticSessions.length === 0 && dynamicSessions.length === 0 && artifacts.length > 0) {
      items.push({
        id: 'first-review',
        title: 'Start the first Review',
        detail: 'The project has sources ready for its first file review.',
        action: 'actions',
        actionLabel: 'Start',
      });
    }

    return items;
  }, [artifacts.length, artifactsError, dynamicSessions, recurringPatterns, staticSessions, unresolvedFindings]);

  const readinessItems = useMemo<ReadinessItem[]>(() => {
    const entries = [
      { id: 'repository', label: 'Repository', count: artifacts.filter(artifact => artifact.source === 'repository').length },
      { id: 'requirements', label: 'Requirement specification', count: artifacts.filter(artifact => artifact.type === 'requirement').length },
      { id: 'design', label: 'Design documentation', count: artifacts.filter(artifact => artifact.type === 'design').length },
      { id: 'standards', label: 'Coding standards', count: artifacts.filter(artifact => artifact.type === 'coding_standard').length },
    ];
    return entries.map(item => ({
      ...item,
      state: item.count === 0 ? 'missing' : item.id === 'repository' || item.count > 1 ? 'ready' : 'insufficient',
    }));
  }, [artifacts]);

  const attentionPageCount = Math.max(1, Math.ceil(attentionItems.length / 3));
  const visibleAttentionItems = attentionItems.slice(attentionPage * 3, attentionPage * 3 + 3);

  const riskSummary = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    riskLevelFindings.forEach(finding => {
      const level = finding.riskLevel as keyof typeof counts;
      if (level in counts) counts[level] += 1;
    });
    return assessmentData?.status === 'available' && assessmentData.summary ? {
      critical: assessmentData.summary.critical,
      high: assessmentData.summary.high,
      medium: assessmentData.summary.medium,
      low: assessmentData.summary.low,
    } : counts;
  }, [assessmentData, riskLevelFindings]);

  useEffect(() => {
    setAttentionPage(page => Math.min(page, attentionPageCount - 1));
  }, [attentionPageCount]);

  const handleAttentionAction = (item: AttentionItem) => {
    if (item.action === 'actions') {
      setActionsOpen(true);
      return;
    }
    if (item.action === 'activity') {
      setActivityState('needs_attention');
      setActiveSection('project-overview');
      requestAnimationFrame(() => document.getElementById('project-recent-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (item.action === 'findings') setFindingsFilter(item.filter ?? null);
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

  const loadCollaborationStatus = useCallback(async () => {
    setCollaborationStatusLoading(true);
    try {
      setCollaborationStatus(await api.getCollaborationStatus(project.id));
    } catch (cause) {
      setCollaborationStatus({
        available: false,
        repository: null,
        message: userFacingError(cause, 'GitHub collaboration status is unavailable. Check your connection and try again.'),
      });
    } finally {
      setCollaborationStatusLoading(false);
    }
  }, [project.id]);

  const loadGithubCollaborators = useCallback(async () => {
    setGithubCollaboratorsLoading(true);
    setGithubCollaboratorsError(null);
    try {
      setGithubCollaborators(await api.getProjectCollaborators(project.id));
    } catch (cause) {
      setGithubCollaboratorsError(userFacingError(cause, 'Saved collaborators could not be loaded.'));
    } finally {
      setGithubCollaboratorsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (activeSection !== 'project-collaborations') return;
    void loadCollaborationStatus();
    void loadGithubCollaborators();
  }, [activeSection, loadCollaborationStatus, loadGithubCollaborators]);

  const openCollaboratorDialog = () => {
    setCollaboratorEmail('');
    setCollaboratorMatches([]);
    setSelectedCollaborator(null);
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    setRepositoryInfoOpen(false);
    setCollaborationStatus(null);
    setShowCollaboratorDialog(true);
    void loadCollaborationStatus();
  };

  const searchForCollaborator = useCallback(async (email = collaboratorEmail.trim()) => {
    const normalizedEmail = email.trim();
    const requestId = ++collaboratorSearchRequest.current;
    if (!normalizedEmail) {
      setCollaboratorMatches([]);
      setCollaboratorSearchLoading(false);
      setCollaboratorError(null);
      return;
    }
    if (!collaborationStatus?.repository) {
      setCollaboratorMatches([]);
      setCollaboratorSearchLoading(false);
      return;
    }
    setCollaboratorSearchLoading(true);
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    setSelectedCollaborator(null);
    try {
      const result = await api.searchCollaborators(project.id, normalizedEmail);
      if (requestId !== collaboratorSearchRequest.current) return;
      setCollaboratorMatches(result.matches);
    } catch (cause) {
      if (requestId !== collaboratorSearchRequest.current) return;
      setCollaboratorMatches([]);
      setCollaboratorError('GitHub search is unavailable right now. Try again later.');
    } finally {
      if (requestId === collaboratorSearchRequest.current) setCollaboratorSearchLoading(false);
    }
  }, [collaboratorEmail, collaborationStatus?.repository, project.id]);

  useEffect(() => {
    if (!showCollaboratorDialog) return;
    const normalizedEmail = collaboratorEmail.trim();
    if (!normalizedEmail || !collaborationStatus?.repository) {
      setCollaboratorMatches([]);
      setCollaboratorSearchLoading(false);
      if (!normalizedEmail) setCollaboratorError(null);
      return;
    }
    const timer = window.setTimeout(() => { void searchForCollaborator(normalizedEmail); }, 350);
    return () => window.clearTimeout(timer);
  }, [collaboratorEmail, collaborationStatus?.repository, searchForCollaborator, showCollaboratorDialog]);

  const handleSyncFromGithub = async () => {
    setCollaboratorError(null);
    setGithubCollaboratorsError(null);
    setCollaboratorNotice(null);
    setGithubCollaboratorsSyncing(true);
    try {
      const snapshot = await api.syncGithubCollaborators(project.id);
      setGithubCollaborators(snapshot);
      setCollaboratorNotice(`Synced ${snapshot.collaborators.length} collaborator${snapshot.collaborators.length === 1 ? '' : 's'} from GitHub.`);
    } catch (cause) {
      const message = userFacingError(cause, 'GitHub collaborators could not be synced. Check repository access and try again.');
      setGithubCollaboratorsError(message);
      setCollaboratorError(message);
    } finally {
      setGithubCollaboratorsSyncing(false);
    }
  };

  const visibleGithubCollaborators = (githubCollaborators?.collaborators ?? []).filter(collaborator =>
    collaborator.login.toLowerCase().includes(collaborationQuery.trim().toLowerCase()),
  );

  const inviteSelectedCollaborator = async () => {
    if (!selectedCollaborator) return;
    setCollaboratorInviteLoading(true);
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    try {
      const result = await api.inviteCollaborator(project.id, selectedCollaborator.login);
      setCollaboratorNotice(result.status === 'already_collaborator'
        ? `@${result.username} already has access to ${result.repository.owner}/${result.repository.repo}.`
        : `Invitation sent to @${result.username} for ${result.repository.owner}/${result.repository.repo}.`);
      setSelectedCollaborator(null);
    } catch (cause) {
      setCollaboratorError(userFacingError(cause, 'The collaborator could not be added. Try again.'));
    } finally {
      setCollaboratorInviteLoading(false);
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
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setShowDynamicForm(true); }}>
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
        <button className={activeSection === 'project-findings' ? 'active' : ''} aria-current={activeSection === 'project-findings' ? 'page' : undefined} onClick={() => moveToSection('project-findings')}>Findings</button>
        <button className={activeSection === 'project-source' ? 'active' : ''} aria-current={activeSection === 'project-source' ? 'page' : undefined} onClick={() => moveToSection('project-source')}>Source</button>
        <button className={activeSection === 'project-collaborations' ? 'active' : ''} aria-current={activeSection === 'project-collaborations' ? 'page' : undefined} onClick={() => moveToSection('project-collaborations')}>Collaborators</button>
        <button className={activeSection === 'project-settings' ? 'active' : ''} aria-current={activeSection === 'project-settings' ? 'page' : undefined} onClick={() => moveToSection('project-settings')}>Settings</button>
      </nav>

      {error && <p className="form-error command-inline-alert"><AlertCircle size={14} /> {error}</p>}
      {exportResult && <section className="export-result success" aria-labelledby="report-export-heading">
        <h2 className="export-result-message" id="report-export-heading">Project report generated</h2>
        <p className="report-export-summary" role="status" aria-live="polite">One immutable snapshot was rendered as JSON, Markdown, and PDF.</p>
        <div className="report-export-meta">
          <span>Stored privately in Supabase</span>
          <span>Generated {formatProjectDateTime(exportResult.generatedAt)}</span>
          {exportResult.reportId && <span>Export ID <code>{exportResult.reportId}</code></span>}
          {exportResult.expiresAt && <span>Download links expire {formatProjectDateTime(exportResult.expiresAt)}</span>}
        </div>
        <nav className="report-export-downloads" aria-label="Report downloads">
            {exportResult.downloads.json && <a className="btn-secondary" href={exportResult.downloads.json} target="_blank" rel="noreferrer" download>Download JSON</a>}
            {exportResult.downloads.markdown && <a className="btn-secondary" href={exportResult.downloads.markdown} target="_blank" rel="noreferrer" download>Download Markdown</a>}
            {exportResult.downloads.pdf && <a className="btn-secondary" href={exportResult.downloads.pdf} target="_blank" rel="noreferrer" download>Download PDF</a>}
            {!exportResult.downloads.json && !exportResult.downloads.markdown && !exportResult.downloads.pdf && <span>Download links are unavailable. The report record was retained; try exporting again to request fresh links.</span>}
        </nav>
        <details className="report-integrity">
          <summary>Integrity checksums</summary>
          <dl>
            <div><dt>Snapshot JSON</dt><dd><code>{exportResult.checksums.snapshot}</code></dd></div>
            <div><dt>Markdown</dt><dd><code>{exportResult.checksums.markdown}</code></dd></div>
            <div><dt>PDF</dt><dd><code>{exportResult.checksums.pdf}</code></dd></div>
            <div><dt>Package</dt><dd><code>{exportResult.checksums.package}</code></dd></div>
          </dl>
        </details>
        <details className="report-preview">
          <summary>Preview Markdown contents</summary>
          <pre className="report-content">{exportResult.markdown}</pre>
        </details>
      </section>}
      <div className="detail-grid" id="project-overview">
        {/* Artifacts */}
        {activeSection === 'project-source' && <section className="card detail-card sources-card" id="project-source">
          <ArtifactsPanel projectId={project.id} onOpenSettings={() => onNavigate({ name: 'settings' })} />
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
                {attentionItems.length > 0 && <span className="panel-count">{attentionItems.length} item{attentionItems.length === 1 ? '' : 's'}</span>}
              </div>
              {visibleAttentionItems.length > 0 ? (
                <div className="project-attention-list">
                   {visibleAttentionItems.map(item => {
                     const needsDisclosure = attentionNeedsDisclosure(item.detail);
                     return (
                       <div key={item.id} className="project-attention-row">
                         <div className="project-attention-copy">
                           <strong>{item.title}</strong>
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
              ) : (
                <div className="project-overview-empty"><ShieldAlert size={22} aria-hidden="true" /><p>No items need attention right now.</p></div>
              )}
              {attentionItems.length > 3 && (
                 <div className="project-pagination-footer">
                 <div className="project-pagination" aria-label="Need attention pages">
                   <span className="project-pagination-slot project-pagination-slot-start"><button type="button" className="btn-secondary" onClick={() => setAttentionPage(page => Math.max(0, page - 1))} disabled={attentionPage === 0}>Previous</button></span>
                   <span className="project-pagination-label">Page {attentionPage + 1} of {attentionPageCount}</span>
                   <span className="project-pagination-slot project-pagination-slot-end"><button type="button" className="btn-secondary" onClick={() => setAttentionPage(page => Math.min(attentionPageCount - 1, page + 1))} disabled={attentionPage >= attentionPageCount - 1}>Next</button></span>
                 </div>
                 </div>
               )}
            </section>

            <section className="card detail-card project-readiness-card" aria-labelledby="project-readiness-heading">
              <div className="panel-header">
                <div><h2 id="project-readiness-heading"><ShieldAlert size={19} /> Readiness</h2></div>
                {artifactsError && <span className="panel-count readiness-unavailable">Unavailable</span>}
              </div>
              {artifactsError ? (
                <div className="project-overview-empty"><Info size={22} aria-hidden="true" /><p>Source readiness could not be checked.</p></div>
              ) : (
                <ul className="project-readiness-list">
                  {readinessItems.map(item => (
                    <li key={item.id} className={item.state}>
                      <span className="readiness-indicator" aria-hidden="true">
                        {item.state === 'ready' ? <CheckCircle2 size={18} /> : item.state === 'insufficient' ? <TriangleAlert size={18} /> : <CircleX size={18} />}
                      </span>
                      <span><strong>{item.label}</strong><small>{item.count > 0 ? `${item.count} source${item.count === 1 ? '' : 's'} available` : 'No source available'}</small></span>
                      <span className="readiness-state">{item.state === 'ready' ? 'Ready' : item.state === 'insufficient' ? 'Insufficient' : 'Missing'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card detail-card project-activity-summary" id="project-recent-activity" aria-labelledby="project-recent-activity-heading">
             <div className="panel-header project-activity-header">
               <div className="project-activity-title"><h2 id="project-recent-activity-heading"><Clock3 size={19} /> Recent activity</h2><div className="project-activity-type-toggle" role="group" aria-label="Activity type">
                 <button type="button" className={activityType === 'all' ? 'active' : ''} aria-label="All activity" aria-pressed={activityType === 'all'} title="All activity" onClick={() => setActivityType('all')}><ListFilter size={16} aria-hidden="true" /></button>
                 <button type="button" className={activityType === 'review' ? 'active' : ''} aria-pressed={activityType === 'review'} onClick={() => setActivityType('review')}><FileCheck2 size={16} aria-hidden="true" /><span>Review</span></button>
                 <button type="button" className={activityType === 'dynamic' ? 'active' : ''} aria-pressed={activityType === 'dynamic'} onClick={() => setActivityType('dynamic')}><MonitorPlay size={16} aria-hidden="true" /><span>Dynamic Testing</span></button>
               </div></div>
               <span className="panel-count">{Math.min(5, projectActivities.length)} of {projectActivities.length}</span>
             </div>
             <div className="project-activity-filters" aria-label="Filter recent activity">
               <label className="project-activity-search"><span className="visually-hidden">Search activity</span><input type="search" aria-label="Search activity" value={activityQuery} onChange={event => setActivityQuery(event.target.value)} placeholder="Activity name or state" /></label>
               <label htmlFor="project-activity-datetime">Datetime<input id="project-activity-datetime" type="datetime-local" value={activityDateTime} onChange={event => setActivityDateTime(event.target.value)} /></label>
               <label htmlFor="project-activity-state">State<Select id="project-activity-state" value={activityState} onChange={value => setActivityState(value as ActivityState)} options={[{ value: 'all', label: 'All states' }, { value: 'queued', label: 'Queued' }, { value: 'running', label: 'In progress' }, { value: 'needs_approval', label: 'Need Approval' }, { value: 'success', label: 'Completed' }, { value: 'needs_attention', label: 'Failed' }, { value: 'cancelled', label: 'Cancelled' }]} /></label>
             </div>
            {visibleProjectActivities.map(activity => (
              <button key={`${activity.kind}-${activity.id}`} type="button" className="project-activity-row" onClick={() => activity.kind === 'Review' ? onNavigate({ name: 'review-activity', projectId: project.id, sessionId: activity.id, reviewName: activity.name }) : onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: activity.id })}>
                <span className="project-activity-main"><strong>{activity.name} <span className="project-activity-id">{formatEntityId(activity.id)}</span> <time dateTime={activity.createdAt}>done at {formatProjectDateTime(activity.createdAt)}</time></strong><small>{activity.kind}</small></span>
                <StatusBadge label={activity.status} />
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
            {projectActivities.length === 0 && <p className="card-empty">{staticSessions.length + dynamicSessions.length === 0 ? 'No activity yet. Start a Review or Dynamic Testing from Action.' : 'No activity matches these filters.'}</p>}
            {projectActivities.length > 5 && <nav className="project-pagination project-activity-pagination" aria-label="Recent activity pages">
              <span className="project-pagination-range">{activityPage * 5 + 1}–{Math.min((activityPage + 1) * 5, projectActivities.length)} of {projectActivities.length}</span>
              <span className="project-pagination-controls"><button type="button" className="btn-secondary" onClick={() => setActivityPage(page => Math.max(0, page - 1))} disabled={activityPage === 0} aria-label="Previous activity page"><ChevronLeft size={16} aria-hidden="true" /></button><span className="project-pagination-label">Page {activityPage + 1} of {activityPageCount}</span><button type="button" className="btn-secondary" onClick={() => setActivityPage(page => Math.min(activityPageCount - 1, page + 1))} disabled={activityPage >= activityPageCount - 1} aria-label="Next activity page"><ChevronRight size={16} aria-hidden="true" /></button></span>
            </nav>}
          </section>
        </>}

        {activeSection === 'project-assessment' && <section className="card detail-card project-risk-card" id="project-assessment" aria-labelledby="project-risk-heading">
          <div className="panel-header">
            <div>
              <h2 id="project-risk-heading"><ShieldAlert size={19} /> Assessment <button type="button" className="command-icon-button assessment-info-button" aria-label="Assessment information" title="How Assessment risk is measured" onClick={() => setAssessmentInfoPage('severity')}><Info size={16} aria-hidden="true" /></button></h2>
            </div>
              <span className="panel-count">{findingsError ? 'Unavailable' : findingsLoading ? 'Loading…' : assessmentData?.status === 'available' && assessmentData.summary ? `${assessmentData.summary.classified} classified${assessmentData.summary.unclassified > 0 ? ` · ${assessmentData.summary.unclassified} unavailable` : ''}` : `${riskLevelFindings.length} classified${currentFindings.length > riskLevelFindings.length ? ` · ${currentFindings.length - riskLevelFindings.length} unavailable` : ''}`}</span>
          </div>
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
          <AssessmentInfoDialog page={assessmentInfoPage} onPageChange={setAssessmentInfoPage} onClose={() => setAssessmentInfoPage(null)} />
        </section>}

        {/* Dynamic Testing: test runs open from Recent activity or the header action. */}
        {false && <section className="card detail-card dynamic-card" id="project-dynamic">
          <div className="panel-header">
            <h3>
              <Play size={18} /> Dynamic Testing
            </h3>
            {!showDynamicForm && (
              <button className="btn-primary" onClick={() => setShowDynamicForm(true)}>
                <Plus size={16} /> New test
              </button>
            )}
          </div>
          {showDynamicForm && (
            <Modal
              isOpen={showDynamicForm}
              onClose={() => { setShowDynamicForm(false); setError(null); }}
              title="New test"
              width={640}
            >
              <DynamicTestForm
                onSubmit={handleCreateDynamic}
                onCancel={() => { setShowDynamicForm(false); setError(null); }}
              />
            </Modal>
          )}
          {dynamicSessions.length > 0 ? (
            <div className="session-list">
              {dynamicSessions.map(s => (
                <button key={s.id} type="button" className="session-row session-row-link"
                  onClick={() => onNavigate({ name: 'dynamic-session', projectId: project.id, sessionId: s.id })}>
                  <div className="session-info-compact">
                    <span className="session-name">{s.name}</span>
                    <span className="session-type">{s.targetUrl}</span>
                  </div>
                  <div className="session-meta">
                    <StatusBadge label={s.status} />
                    <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !showDynamicForm && <p className="card-empty">No tests yet.</p>
          )}
        </section>}

        {activeSection === 'project-findings' && <div id="project-findings">
           <FindingsPanel
             projectId={project.id}
             presentation="project"
            pageSize={5}
            initialFilter={findingsFilter}
            refreshKey={
              activeReviewState?.session.projectId === project.id
                ? `${activeReviewState.session.id}:${activeReviewState.session.status}`
               : undefined
             }
           />
        </div>}

        {activeSection === 'project-collaborations' && <section className="card detail-card project-collaboration-card" id="project-collaborations">
          <div className="panel-header project-collaboration-header">
            <div><h2><Users size={19} /> Collaborators</h2></div>
            <div className="project-collaboration-actions">
              <button type="button" className="btn-secondary" onClick={() => void handleSyncFromGithub()} disabled={githubCollaboratorsSyncing || collaborationStatusLoading || !collaborationStatus?.available}><RotateCw size={16} aria-hidden="true" /> {githubCollaboratorsSyncing ? 'Syncing…' : 'Sync from GitHub'}</button>
              <button type="button" className="btn-secondary" onClick={openCollaboratorDialog}><UserPlus size={16} aria-hidden="true" /> Add collaborator</button>
            </div>
          </div>
          <div className="project-collaboration-search-row">
            <label className="project-collaboration-search" htmlFor="project-collaboration-search"><span className="visually-hidden">Search collaborators</span><span className="project-collaboration-search-control"><Search size={15} aria-hidden="true" /><input id="project-collaboration-search" type="search" value={collaborationQuery} onChange={event => setCollaborationQuery(event.target.value)} placeholder="GitHub username" /></span></label>
          </div>
          {collaborationStatusLoading && <p className="project-collaboration-status" role="status">Checking GitHub collaboration…</p>}
          {githubCollaboratorsLoading && <p className="project-collaboration-status" role="status">Loading collaborators…</p>}
          {githubCollaboratorsError && <p className="command-inline-alert" role="alert">{githubCollaboratorsError}</p>}
          {collaboratorNotice && <p className="collaborator-dialog-notice" role="status">{collaboratorNotice}</p>}
          {!collaborationStatusLoading && !githubCollaboratorsLoading && visibleGithubCollaborators.length > 0 && <div className="project-collaborator-list" role="list" aria-label="GitHub collaborators">
            {visibleGithubCollaborators.map(collaborator => <div className="project-collaborator-row" role="listitem" key={collaborator.id}>
              {collaborator.avatarUrl ? <img src={collaborator.avatarUrl} alt="" /> : <span className="collaborator-avatar" aria-hidden="true"><Users size={16} /></span>}
              <span><strong>@{collaborator.login}</strong><small>{collaborator.permission} access</small></span>
            </div>)}
          </div>}
          {!collaborationStatusLoading && !githubCollaboratorsLoading && !githubCollaboratorsError && visibleGithubCollaborators.length === 0 && (
            <div className="project-collaboration-empty" role="status">
              <Users size={24} aria-hidden="true" />
              <strong>{collaborationQuery.trim() ? 'Collaborator not found' : githubCollaborators?.syncedAt ? 'No repository collaborators' : 'No collaborators synced yet'}</strong>
              <p>{collaborationQuery.trim() ? `No collaborator matches “${collaborationQuery.trim()}”.` : !collaborationStatus?.available ? collaborationStatus?.message ?? 'Connect a GitHub repository and account to sync collaborators.' : githubCollaborators?.syncedAt ? 'The latest GitHub sync found no collaborators with repository access.' : 'Sync from GitHub to see people with repository access.'}</p>
            </div>
          )}
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

      {showDynamicForm && (
        <Modal
          isOpen={showDynamicForm}
          onClose={() => { setShowDynamicForm(false); setError(null); }}
          title="New test"
          width={640}
        >
          <DynamicTestForm
            onSubmit={handleCreateDynamic}
            onCancel={() => { setShowDynamicForm(false); setError(null); }}
          />
        </Modal>
      )}

      <Modal
        isOpen={showCollaboratorDialog}
        onClose={collaboratorInviteLoading ? () => undefined : () => setShowCollaboratorDialog(false)}
        title="Add collaborator"
        width={560}
      >
        <div className="collaborator-dialog">
          <div className="collaborator-repository-heading">
            <p className="collaborator-repository"><GitBranch size={14} aria-hidden="true" /> {collaborationStatus?.repository ? `${collaborationStatus.repository.owner}/${collaborationStatus.repository.repo}` : 'No GitHub repository connected'}</p>
            <span className="collaborator-repository-info" onMouseEnter={() => setRepositoryInfoOpen(true)} onMouseLeave={() => setRepositoryInfoOpen(false)}>
              <button type="button" className="collaborator-info-button" aria-label="Repository information" aria-expanded={repositoryInfoOpen} aria-controls="collaborator-repository-info" onClick={() => setRepositoryInfoOpen(open => !open)}><Info size={16} aria-hidden="true" /></button>
              {repositoryInfoOpen && <span id="collaborator-repository-info" className="collaborator-repository-tooltip" role="tooltip">GitHub only returns accounts whose email is publicly searchable.</span>}
            </span>
          </div>
          <p className="collaborator-dialog-intro">Search GitHub by email, then review the account and confirm before sending an invitation.</p>
          <form className="collaborator-search-form" onSubmit={event => { event.preventDefault(); void searchForCollaborator(); }}>
            <label htmlFor="collaborator-email">GitHub account email</label>
            <span className="collaborator-email-control"><input id="collaborator-email" type="email" value={collaboratorEmail} onChange={event => setCollaboratorEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" disabled={collaborationStatusLoading || !collaborationStatus?.repository} aria-describedby="collaborator-email-status" /><Search size={16} aria-hidden="true" /></span>
          </form>
          <div className="collaborator-sync-row">
            <button type="button" className="btn-secondary" onClick={() => void handleSyncFromGithub()} disabled={githubCollaboratorsSyncing || !collaborationStatus?.available}><RotateCw size={15} aria-hidden="true" /> {githubCollaboratorsSyncing ? 'Syncing…' : 'Sync collaborators from GitHub'}</button>
            <span className="collaborator-sync-hint">Refreshes the saved list from GitHub.</span>
          </div>
          <div id="collaborator-email-status" aria-live="polite">
            {collaboratorSearchLoading && <p className="collaborator-dialog-status" role="status">Searching GitHub…</p>}
            {!collaboratorSearchLoading && collaboratorEmail.trim() && !collaboratorError && collaborationStatus?.repository && collaboratorMatches.length === 0 && <p className="collaborator-dialog-status" role="status">Collaborator not found. Try another email address.</p>}
          </div>
          {collaboratorError && <p className="command-inline-alert" role="alert"><AlertCircle size={14} /> {collaboratorError}</p>}
          {collaboratorNotice && <p className="collaborator-dialog-notice" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {collaboratorNotice}</p>}
          {collaboratorMatches.length > 0 && <div className="collaborator-results" aria-label="GitHub account matches">
            <h4>Matching accounts</h4>
            {collaboratorMatches.map(match => (
              <button key={match.id} type="button" className={`collaborator-result ${selectedCollaborator?.id === match.id ? 'selected' : ''}`} onClick={() => { setSelectedCollaborator(match); setCollaboratorNotice(null); }} aria-pressed={selectedCollaborator?.id === match.id}>
                {match.avatarUrl ? <img src={match.avatarUrl} alt="" /> : <span className="collaborator-avatar" aria-hidden="true"><Users size={16} /></span>}
                <span><strong>{match.login}</strong><small>{match.type} account</small></span>
                {selectedCollaborator?.id === match.id && <CheckCircle2 size={18} aria-hidden="true" />}
              </button>
            ))}
          </div>}
          {selectedCollaborator && <div className="collaborator-confirmation" role="group" aria-label="Confirm collaborator invitation">
            <p>Invite <strong>@{selectedCollaborator.login}</strong> to <strong>{collaborationStatus?.repository?.owner}/{collaborationStatus?.repository?.repo}</strong>?</p>
            <p className="collaborator-confirmation-warning">This sends an external GitHub invitation. Confirm only when you are ready.</p>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setSelectedCollaborator(null)} disabled={collaboratorInviteLoading}>Choose another</button>
              <button type="button" className="btn-primary" onClick={() => void inviteSelectedCollaborator()} disabled={collaboratorInviteLoading}>{collaboratorInviteLoading ? 'Sending…' : 'Send invitation'}</button>
            </div>
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
