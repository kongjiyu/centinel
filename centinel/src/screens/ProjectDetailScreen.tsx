import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Download, Plus, FolderOpen, Play, BarChart3, AlertCircle, FileText, GitBranch, RotateCw, Clock3, ChevronLeft, ChevronRight, ChevronDown, Users, Settings, ShieldAlert, Info, Trash2, Search, UserPlus, CheckCircle2, TriangleAlert, CircleX, ListFilter, FileCheck2, MonitorPlay } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { api } from '../api/client';
import { DynamicTestForm } from './DynamicTestForm';
import { ReviewModal } from '../components/ReviewModal';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FindingsPanel } from '../components/FindingsPanel';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ActiveSessionInline } from '../components/ActiveSessionInline';
import { ActiveSessionComplete } from '../components/ActiveSessionComplete';
import { ReviewDecisionPill } from '../components/ReviewDecisionBar';
import { TestPlanPanel } from '../components/TestPlanPanel';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { projectActivityLifecycle, projectActivityLifecycleTone } from '../reviewViewModel';
import { userFacingError } from '../utils/userFacingError';
import { formatEntityId } from '../utils/entityId';
import type { Project, DynamicSession, StaticSession, Artifact, Screen, Finding, CollaborationStatus, CollaboratorMatch } from '../types';
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
};

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

const REVIEW_TYPE_LABELS: Record<string, string> = {
  requirement_review: 'Requirement Review',
  code_review: 'Code Inspection',
  requirement_to_code_traceability: 'Traceability',
  cross_artifact_consistency: 'Consistency',
};

export function ProjectDetailScreen({ project, onNavigate, onProjectUpdated, initialAction, initialStaticSessionId }: Props) {
  const [currentProject, setCurrentProject] = useState(project);
  const [dynamicSessions, setDynamicSessions] = useState<DynamicSession[]>([]);
  const [staticSessions, setStaticSessions] = useState<StaticSession[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [showDynamicForm, setShowDynamicForm] = useState(initialAction === 'dynamic');
  const [showStaticForm, setShowStaticForm] = useState(initialAction === 'static');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(initialStaticSessionId ?? null);
  const [findingsBySession, setFindingsBySession] = useState<Record<string, Finding[]>>({});
  const [activeSection, setActiveSection] = useState('project-overview');
  const [reReviewSession, setReReviewSession] = useState<StaticSession | null>(null);
  const [reReviewName, setReReviewName] = useState('');
  const [reReviewInstructions, setReReviewInstructions] = useState('');
  const [creatingReReview, setCreatingReReview] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activityQuery, setActivityQuery] = useState('');
  const [activityType, setActivityType] = useState<'all' | 'review' | 'dynamic'>('all');
  const [activityDateTime, setActivityDateTime] = useState('');
  const [activityState, setActivityState] = useState<ActivityState>('all');
  const [activityPage, setActivityPage] = useState(0);
  const [projectFindings, setProjectFindings] = useState<Finding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
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

  const { state: activeReviewState, controls: activeReviewControls } = useActiveReviewState();

  useEffect(() => {
    setShowStaticForm(initialAction === 'static');
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

  const ensureFindingsLoaded = useCallback(async (sessionId: string) => {
    if (findingsBySession[sessionId]) return;
    try {
      const findings = await api.listStaticFindings(project.id, sessionId);
      setFindingsBySession(prev => ({ ...prev, [sessionId]: findings }));
    } catch {}
  }, [findingsBySession, project.id]);

  useEffect(() => {
    setOpenSessionId(initialStaticSessionId ?? null);
    if (initialStaticSessionId) void ensureFindingsLoaded(initialStaticSessionId);
  }, [ensureFindingsLoaded, initialStaticSessionId, project.id]);

  useEffect(() => {
    setSettingsDraft({ name: project.name, description: project.description, workspacePath: project.workspacePath });
    setSettingsError(null);
    setCurrentProject(project);
    setSettingsEditing(false);
    setCollaborationQuery('');
  }, [project.description, project.id, project.name, project.workspacePath]);

  useEffect(() => { loadDynamicSessions(); loadStaticSessions(); loadArtifacts(); loadProjectFindings(); }, [loadDynamicSessions, loadStaticSessions, loadArtifacts, loadProjectFindings]);

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

    if (snapshot.status === 'success') {
      setFindingsBySession(prev => ({
        ...prev,
        [snapshot.id]: snapshot.findings,
      }));
    }
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

  const handleCreateStatic = async (data: { name: string; instructions: string; baseRef?: string; headRef?: string; parentSessionId?: string }) => {
    setError(null);
    try {
      const session = await api.createStaticSession(project.id, data);
      setStaticSessions(prev => [session, ...prev.filter(item => item.id !== session.id)]);
      setOpenSessionId(session.id);
      activeReviewControls.trackSession(session, project.name);
      setShowStaticForm(false);
    } catch (e) { setError(userFacingError(e, 'The Review could not be started.')); throw e; }
  };

  const onReReviewClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    s: StaticSession
  ) => {
    e.stopPropagation();
    setReReviewSession(s);
    setReReviewName(`Re-review of ${s.name}`);
    setReReviewInstructions(s.remarks || '');
  };

  const handleCreateReReview = async () => {
    if (!reReviewSession || !reReviewName.trim()) return;
    setCreatingReReview(true);
    try {
      await handleCreateStatic({
        name: reReviewName.trim(),
        instructions: reReviewInstructions.trim(),
        baseRef: reReviewSession.baseRef,
        headRef: reReviewSession.headRef,
        parentSessionId: reReviewSession.id,
      });
      setReReviewSession(null);
    } finally {
      setCreatingReReview(false);
    }
  };

  const handleExportReport = async () => {
    setExporting(true);
    try {
      await api.exportProjectReport(project.id);
    } catch (cause) {
      setError(`Export failed. ${userFacingError(cause, 'Try again.')}`);
    } finally {
      setExporting(false);
    }
  };

  const moveToSection = (sectionId: string) => {
    setActionsOpen(false);
    setActiveSection(sectionId);
    requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const staleSourceCount = artifacts.filter(artifact => {
    if (artifact.source !== 'documents' && artifact.source !== 'drive') return false;
    const ingestedAt = Date.parse(artifact.createdAt);
    return Number.isFinite(ingestedAt) && Date.now() - ingestedAt > 90 * 24 * 60 * 60 * 1000;
  }).length;

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

  const unresolvedFindings = useMemo(() => {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return projectFindings
      .filter(finding => !['accepted', 'dismissed', 'fixed'].includes(finding.status))
      .sort((a, b) => (severityOrder[a.severity.toLowerCase()] ?? 99) - (severityOrder[b.severity.toLowerCase()] ?? 99) || Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  }, [projectFindings]);

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
  }, [artifacts.length, artifactsError, dynamicSessions, staticSessions, unresolvedFindings]);

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

  const latestReview = useMemo(() => [...staticSessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null, [staticSessions]);
  const latestDynamicTest = useMemo(() => [...dynamicSessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0] ?? null, [dynamicSessions]);
  const latestReviewState = latestReview ? projectActivityLifecycle(latestReview, 'review') : null;
  const latestDynamicState = latestDynamicTest ? projectActivityLifecycle(latestDynamicTest, 'dynamic') : null;
  const assessmentDimensions = useMemo(() => {
    const unresolvedCritical = unresolvedFindings.filter(finding => finding.severity.toLowerCase() === 'critical').length;
    const unresolvedHigh = unresolvedFindings.filter(finding => finding.severity.toLowerCase() === 'high').length;
    const reviewRisk = !latestReview
      ? 'Insufficient evidence'
      : unresolvedCritical > 0
        ? 'High'
        : unresolvedHigh > 0 || unresolvedFindings.length > 0
          ? 'Medium'
          : 'Low';
    const dynamicRisk = !latestDynamicTest
      ? 'Insufficient evidence'
      : latestDynamicState === 'Failed'
        ? 'High'
        : latestDynamicState === 'Completed'
          ? 'Low'
          : 'Medium';
    return [
      { id: 'security', label: 'Security', source: 'Review', state: reviewRisk, evidence: latestReview ? `${unresolvedFindings.length} unresolved finding${unresolvedFindings.length === 1 ? '' : 's'}` : 'No Review evidence recorded.' },
      { id: 'traceability', label: 'Requirement traceability', source: 'Review', state: latestReview ? (projectFindings.length > 0 ? 'Medium' : 'Insufficient evidence') : 'Insufficient evidence', evidence: latestReview ? 'Review mappings and linked findings' : 'No Review evidence recorded.' },
      { id: 'reliability', label: 'Reliability', source: 'Dynamic Testing', state: dynamicRisk, evidence: latestDynamicTest?.finalSummary || latestDynamicState || 'No Dynamic Testing evidence recorded.' },
      { id: 'maintainability', label: 'Maintainability', source: 'Review', state: latestReview ? (unresolvedFindings.length > 0 ? 'Medium' : 'Low') : 'Insufficient evidence', evidence: latestReview ? 'Source findings and recommendations' : 'No Review evidence recorded.' },
      { id: 'coverage', label: 'Evidence coverage', source: 'Review + Dynamic Testing', state: latestReview || latestDynamicTest ? 'Medium' : 'Insufficient evidence', evidence: `${artifacts.length} source${artifacts.length === 1 ? '' : 's'} available across the project` },
    ];
  }, [artifacts.length, latestDynamicState, latestDynamicTest, latestReview, projectFindings.length, unresolvedFindings]);

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
        message: 'This build does not connect to a collaboration service, so no invitations or roles are represented here.',
      });
    } finally {
      setCollaborationStatusLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (activeSection !== 'project-collaborations') return;
    void loadCollaborationStatus();
  }, [activeSection, loadCollaborationStatus]);

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

  const handleSyncFromGithub = () => {
    setCollaboratorError(null);
    setCollaboratorNotice('GitHub sync is not available in this build, so existing collaborator data was not changed.');
  };

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
                  <FolderOpen size={16} aria-hidden="true" /> Review
                </button>
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setShowDynamicForm(true); }}>
                  <Play size={16} aria-hidden="true" /> Dynamic testing
                </button>
                <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); void handleExportReport(); }} disabled={exporting}>
                  <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export report'}
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
      <div className="detail-grid" id="project-overview">
        {/* Artifacts */}
        {activeSection === 'project-source' && <section className="card detail-card sources-card" id="project-source">
          <ArtifactsPanel projectId={project.id} />
        </section>}

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
                <span className="project-activity-main"><strong>{activity.name} <span className="project-activity-id">{formatEntityId(activity.id)}</span> <time dateTime={activity.createdAt}>done at {formatProjectDateTime(activity.createdAt)}</time></strong><small>{activity.kind} <span className="project-activity-see-more">… See more</span></small></span>
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
              <h2 id="project-risk-heading"><ShieldAlert size={19} /> Assessment</h2>
              <p className="project-risk-summary">Evidence-led risk context from the latest Review and Dynamic Testing runs. These signals are not a composite score.</p>
            </div>
            <span className="panel-count">{latestReview || latestDynamicTest ? 'Evidence available' : 'No evidence yet'}</span>
          </div>
          <div className="project-assessment-summary">
            <div><strong>Review</strong><span>{latestReview?.name || 'No review run recorded'}</span><small>{latestReviewState || 'Start a Review to collect evidence'}</small></div>
            <div><strong>Dynamic Testing</strong><span>{latestDynamicTest?.name || 'No dynamic test recorded'}</span><small>{latestDynamicState || 'Start Dynamic Testing to collect evidence'}</small></div>
            <div><strong>Sources</strong><span>{artifacts.length} available</span><small>Used as assessment context</small></div>
          </div>
          <div className="project-assessment-dimensions" role="list" aria-label="Project risk dimensions">
            {assessmentDimensions.map(dimension => <article key={dimension.id} className="project-assessment-dimension" role="listitem">
              <div className="project-assessment-dimension-heading"><h3>{dimension.label}</h3><StatusBadge label={dimension.state} tone={dimension.state === 'High' ? 'danger' : dimension.state === 'Medium' ? 'warning' : dimension.state === 'Low' ? 'success' : 'neutral'} /></div>
              <p>{dimension.evidence}</p>
              <small>Evidence source: {dimension.source}</small>
            </article>)}
          </div>
        </section>}

        {/* Static Review: review runs open from Recent activity or Review entry. */}
        {false && <section className="card detail-card" id="project-review">
          <div className="panel-header">
            <h3>
              <BarChart3 size={18} /> Review
            </h3>
            <div className="panel-actions">
              <button className="btn-secondary" onClick={() => onNavigate({ name: 'requirements', projectId: project.id })}>
                Requirements
              </button>
              {!showStaticForm && (
                <button className="btn-primary" onClick={() => setShowStaticForm(true)}>
                  <Plus size={16} /> New review
                </button>
              )}
            </div>
          </div>
          {showStaticForm && (
            <ReviewModal projectId={project.id} onSubmit={handleCreateStatic}
              staleSourceCount={staleSourceCount}
              onClose={() => { setShowStaticForm(false); setError(null); }} />
          )}
          {staticSessions.length > 0 ? (
            <div className="session-list">
              {staticSessions.map(s => {
                const isActive = s.status === 'running' || s.status === 'queued';
                const isOpen = openSessionId === s.id;
                const handleClick = () => {
                  onNavigate({ name: 'review-activity', projectId: project.id, sessionId: s.id, reviewName: s.name });
                };
                return (
                  <div key={s.id} className={`session-block ${isOpen ? 'open' : ''}`}>
                    <div className="session-row">
                      <button
                      type="button"
                      className="session-row-main"
                      onClick={handleClick}
                      aria-expanded={isOpen}
                    >
                      <div className="session-info-compact">
                        <span className="session-name">{s.name}</span>
                        <span className="session-type">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
                        {s.baseRef && s.headRef && (
                          <span
                            className="session-scope-badge"
                            data-testid="session-scope-badge"
                            title={`Scoped to files changed between ${s.baseRef} and ${s.headRef}`}
                          >
                            <GitBranch size={10} /> {s.baseRef} → {s.headRef}
                          </span>
                        )}
                      </div>
                      <div className="session-meta">
                        <StatusBadge label={s.status} />
                        {s.status === 'success' && (
                          <ReviewDecisionPill decision={s.currentDecision ?? null} />
                        )}
                        <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
                      </div>
                      </button>
                      {s.status === 'success' && !s.parentSessionId && (
                        <button
                          className="btn-ghost btn-re-review"
                          onClick={(e) => onReReviewClick(e, s)}
                          data-testid="re-review-button"
                          title="Start a new review that carries over unresolved findings from this one"
                          type="button"
                        >
                          <RotateCw size={13} /> Re-review
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      isActive ? (
                        <ActiveSessionInline projectId={project.id} sessionId={s.id} />
                      ) : (
                        <ActiveSessionComplete
                          projectId={project.id}
                          sessionId={s.id}
                          findings={findingsBySession[s.id] ?? []}
                          parentSessionId={s.parentSessionId}
                        />
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            !showStaticForm && <p className="card-empty">No reviews yet.</p>
          )}
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
            <button type="button" className="btn-secondary" onClick={openCollaboratorDialog}><UserPlus size={16} aria-hidden="true" /> Add collaborator</button>
          </div>
          <div className="project-collaboration-search-row">
            <label className="project-collaboration-search" htmlFor="project-collaboration-search"><span className="visually-hidden">Search collaborators</span><span className="project-collaboration-search-control"><Search size={15} aria-hidden="true" /><input id="project-collaboration-search" type="search" value={collaborationQuery} onChange={event => setCollaborationQuery(event.target.value)} placeholder="Name or email" /></span></label>
          </div>
          {collaborationStatusLoading && <p className="project-collaboration-status" role="status">Checking GitHub collaboration…</p>}
          {!collaborationStatusLoading && collaborationStatus && (
            <div className="project-collaboration-empty" role="status">
              <Users size={24} aria-hidden="true" />
              <strong>Collaborator not found</strong>
              <p>{collaborationQuery.trim() ? `No collaborator matches “${collaborationQuery.trim()}”.` : 'No collaborator data is available for this project yet.'} Add a collaborator or sync from GitHub.</p>
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

        {false && <section className="card detail-card project-report-card" id="project-reports">
          <div className="panel-header">
            <div>
              <h3><FileText size={18} /> Reports</h3>
              <p className="panel-description">Export a combined project report with the latest Review and Dynamic Testing results.</p>
            </div>
            <button className="btn-primary" onClick={handleExportReport} disabled={exporting}>
              <Download size={16} /> {exporting ? 'Exporting…' : 'Export report'}
            </button>
          </div>
        </section>}

        {/* Test Plan (Group 2c) — module-grouped test items derived
            from the static review. Mounts below findings so the
            reviewer can scan defects and the test plan to address
            them in one pass. */}
        {false && <section className="card detail-card test-plan-card" id="project-suggested-tests">
          <TestPlanPanel
            projectId={project.id}
            sessionId={
              activeReviewState?.session?.projectId === project.id
                ? activeReviewState?.session?.id
                : staticSessions.find(s => s.status === 'success')?.id
            }
          />
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

      {showStaticForm && (
        <ReviewModal
          projectId={project.id}
          onSubmit={handleCreateStatic}
          staleSourceCount={staleSourceCount}
          onClose={() => { setShowStaticForm(false); setError(null); }}
        />
      )}

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
        isOpen={reReviewSession !== null}
        onClose={creatingReReview ? () => undefined : () => setReReviewSession(null)}
        title="Start re-review"
        width={520}
      >
        <p className="modal-intro">Carry the existing scope into a new review and update the instructions if needed.</p>
        <div className="form-field">
          <label htmlFor="re-review-name">Review name</label>
          <input
            id="re-review-name"
            value={reReviewName}
            onChange={event => setReReviewName(event.target.value)}
            maxLength={120}
          />
        </div>
        <div className="form-field">
          <label htmlFor="re-review-instructions">Instructions <span className="field-optional">Optional</span></label>
          <textarea
            id="re-review-instructions"
            value={reReviewInstructions}
            onChange={event => setReReviewInstructions(event.target.value)}
            rows={4}
          />
        </div>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => setReReviewSession(null)} disabled={creatingReReview}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void handleCreateReReview()} disabled={creatingReReview || !reReviewName.trim()}>
            {creatingReReview ? 'Starting…' : 'Start re-review'}
          </button>
        </div>
      </Modal>

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
            <button type="button" className="btn-secondary" onClick={handleSyncFromGithub}><RotateCw size={15} aria-hidden="true" /> Sync collaborators from GitHub</button>
            <span className="collaborator-sync-hint">Existing collaborator data is not changed.</span>
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
