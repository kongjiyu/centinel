import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, FileCheck2, Paperclip, Plus, RotateCcw } from 'lucide-react';
import { api, type CreateStaticSessionPayload } from '../api/client';
import { CommandPageHeader } from '../components/CommandUI';
import { ProjectCreateModal } from '../components/ProjectCreateModal';
import type { ProjectCreationResult, ProjectRepositoryInput } from '../types';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import { userFacingError } from '../utils/userFacingError';
import { isWorkflowProviderConfigured } from '../providerReadiness';
import type { Artifact, ConnectedSource, ConnectedSourceBrowseEntry, Project, Requirement, ReviewScopeSelection, ReviewSourceManifest, Screen, StaticSession } from '../types';
import './ReviewEntryScreen.css';

type Props = {
  projects: Project[];
  initialProjectId?: string;
  comparisonParentReviewId?: string;
  onNavigate: (screen: Screen) => void;
  onCreateProject: (name: string, description: string, sources: ProjectRepositoryInput[]) => Promise<ProjectCreationResult | void>;
};

type ScopeItem = {
  id: string;
  label: string;
  detail: string;
  kind: 'artifact' | 'requirement' | 'standard';
};

type RepositoryScope = {
  identity: string;
  label: string;
  detail: string;
  artifactIds: string[];
};

type ScopeGroups = {
  repositories: RepositoryScope[];
  documents: ScopeItem[];
  standards: ScopeItem[];
};

const MAX_REFERENCES = 5;
const REFERENCE_EXTENSIONS = /\.(?:md|txt|pdf|json|csv|ya?ml)$/i;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

function encodeReference(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

type UnavailableSavedMember = {
  kind: 'source' | 'requirement' | 'coding standard';
  id: string;
};

const MAX_OBJECTIVE_LENGTH = 2000;

function isDeprecated(artifact: Artifact): boolean {
  const record = artifact as Artifact & { status?: string; deprecated?: boolean };
  return artifact.currency?.deprecated === true || record.deprecated === true || record.status?.toLowerCase() === 'deprecated';
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // The fallback below is sufficient for older WebViews; the service still
    // treats the key as opaque and scopes it to the authenticated user.
  }
  return `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function artifactItem(artifact: Artifact, kind: ScopeItem['kind']): ScopeItem {
  return {
    id: artifact.id,
    label: artifact.fileName || 'Unnamed document',
    detail: kind === 'standard' ? 'Coding standard' : artifact.type === 'requirement' ? 'Attached requirement' : 'Attached document',
    kind,
  };
}

function groupArtifacts(artifacts: Artifact[], project: Project, connectedSources: ConnectedSource[]): ScopeGroups {
  const repositoryArtifacts = artifacts.filter(artifact => artifact.source === 'repository');
  const bySource = new Map<string, Artifact[]>();
  for (const artifact of repositoryArtifacts) {
    const identity = artifact.sourceId ? `connected:${artifact.sourceId}` : `local:${project.id}`;
    const files = bySource.get(identity) ?? [];
    files.push(artifact);
    bySource.set(identity, files);
  }
  const repositories: RepositoryScope[] = [...bySource].map(([identity, sourceArtifacts]) => {
    if (sourceArtifacts[0]?.localRepositoryName) {
      return { identity, label: sourceArtifacts[0].localRepositoryName, detail: 'Local repository', artifactIds: sourceArtifacts.map(artifact => artifact.id) };
    }
    if (identity.startsWith('connected:')) {
      const sourceId = identity.slice('connected:'.length);
      const connectedSource = connectedSources.find(source => source.id === sourceId && source.projectId === project.id && source.kind === 'github_repository');
      return {
        identity,
        label: connectedSource?.name.trim() || 'Repository unavailable',
        detail: connectedSource ? 'Connected repository' : `Saved source identity ${sourceId}`,
        artifactIds: sourceArtifacts.map(artifact => artifact.id),
      };
    }
    // Local imports currently do not persist a repository id. Keep them under
    // the project-owned local-import identity and state that limitation rather
    // than deriving a repository from a display name or path label.
    return {
      identity,
      label: 'Local imported code',
      detail: 'Repository identity is unavailable for these local imports',
      artifactIds: sourceArtifacts.map(artifact => artifact.id),
    };
  });
  const supportingArtifacts = artifacts.filter(artifact => artifact.source !== 'repository');
  return {
    repositories,
    documents: supportingArtifacts.filter(artifact => artifact.type !== 'coding_standard').map(artifact => {
      const connection = connectedSources.find(source => source.id === artifact.sourceId);
      return { ...artifactItem(artifact, 'artifact'), detail: connection?.name || (artifact.source === 'drive' ? 'Google Drive' : 'Project file') };
    }),
    standards: supportingArtifacts.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifactItem(artifact, 'standard')),
  };
}

function unavailableSavedMembers(scope: ReviewScopeSelection, artifacts: Artifact[], requirements: Requirement[]): UnavailableSavedMember[] {
  const artifactIds = new Set(artifacts.map(artifact => artifact.id));
  const requirementIds = new Set(requirements.map(requirement => requirement.id));
  return [
    ...scope.artifactIds.filter(id => !artifactIds.has(id)).map(id => ({ kind: 'source' as const, id })),
    ...scope.requirementIds.filter(id => !requirementIds.has(id)).map(id => ({ kind: 'requirement' as const, id })),
    ...scope.standardIds.filter(id => !artifactIds.has(id)).map(id => ({ kind: 'coding standard' as const, id })),
  ];
}

function parseReviewConfig(session: StaticSession): Record<string, unknown> {
  try {
    const config = JSON.parse(session.configJson) as unknown;
    return config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))) : [];
}

function priorScope(session: StaticSession, config: Record<string, unknown>): ReviewScopeSelection | null {
  const savedScope = session.scope && typeof session.scope === 'object'
    ? session.scope as Record<string, unknown>
    : config.scope && typeof config.scope === 'object' && !Array.isArray(config.scope)
      ? config.scope as Record<string, unknown>
      : {};
  const scope: ReviewScopeSelection = {
    artifactIds: stringIds(savedScope.artifactIds ?? config.artifactIds ?? config.selectedArtifactIds),
    requirementIds: stringIds(savedScope.requirementIds ?? config.requirementIds ?? config.selectedRequirementIds),
    standardIds: stringIds(savedScope.standardIds ?? config.standardIds ?? config.selectedStandardIds),
  };
  return scope.artifactIds.length + scope.requirementIds.length + scope.standardIds.length > 0 ? scope : null;
}

function comparisonFailure(session: StaticSession, projectId: string, manifest: ReviewSourceManifest | null): string | null {
  if (session.projectId !== projectId) return 'The saved Review is not part of this project.';
  const eligibleStatus = ['pending_approval', 'completed', 'approved', 'changes_requested'].includes(session.status);
  if (!eligibleStatus || session.modelStatus !== 'succeeded') {
    return 'The saved Review does not have the completed model evidence required for comparison.';
  }
  let progressComplete = false;
  try {
    const progress = JSON.parse(session.progressJson) as { stage?: unknown };
    progressComplete = progress.stage === 'complete';
  } catch { /* Older sessions may not have structured progress. */ }
  if (!progressComplete) {
    return 'The saved Review has no confirmed successful completion record for comparison.';
  }
  const hasSavedArtifacts = Boolean(manifest?.sources.some(source => source.artifactIds.length > 0));
  if (!manifest || manifest.projectId !== projectId || manifest.sessionId !== session.id || manifest.status !== 'available' || !hasSavedArtifacts) {
    return 'The saved Review source manifest is unavailable for comparison.';
  }
  return null;
}

export function ReviewEntryScreen({ projects, initialProjectId, comparisonParentReviewId: initialComparisonParentReviewId, onNavigate, onCreateProject }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || projects[0]?.id || '');
  const [comparisonParentReviewId, setComparisonParentReviewId] = useState<string | null>(initialComparisonParentReviewId || null);
  const [comparisonParentReview, setComparisonParentReview] = useState<StaticSession | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const comparisonPrefilledFor = useRef<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [connectedSources, setConnectedSources] = useState<ConnectedSource[]>([]);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<Set<string>>(new Set());
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<Set<string>>(new Set());
  const [selectedStandardIds, setSelectedStandardIds] = useState<Set<string>>(new Set());
  const [activeSession, setActiveSession] = useState<StaticSession | null>(null);
  const [loadingScope, setLoadingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  // The unsent name and objective survive a detour to add sources or requirements.
  const draftKey = 'centinel:review-entry-draft';
  const savedDraft = (() => { try { return JSON.parse(window.sessionStorage.getItem(draftKey) ?? 'null') as { name?: string; objective?: string } | null; } catch { return null; } })();
  const [reviewName, setReviewName] = useState(comparisonParentReviewId ? '' : savedDraft?.name ?? '');
  const [objective, setObjective] = useState(comparisonParentReviewId ? '' : savedDraft?.objective ?? '');
  useEffect(() => {
    try {
      if (reviewName || objective) window.sessionStorage.setItem(draftKey, JSON.stringify({ name: reviewName, objective }));
      else window.sessionStorage.removeItem(draftKey);
    } catch { /* storage is optional */ }
  }, [reviewName, objective]);
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [pullRequest, setPullRequest] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const referenceInput = useRef<HTMLInputElement>(null);
  const [reviewScopeMode, setReviewScopeMode] = useState<'full' | 'focused'>(initialComparisonParentReviewId ? 'focused' : 'full');
  const [onlineRepositoryId, setOnlineRepositoryId] = useState('');
  const [repositoryRevision, setRepositoryRevision] = useState('');
  const [repositoryBranch, setRepositoryBranch] = useState('');
  const [remoteBranches, setRemoteBranches] = useState<ConnectedSourceBrowseEntry[]>([]);
  const [remoteCommits, setRemoteCommits] = useState<ConnectedSourceBrowseEntry[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const uploadedReferences = useRef(new Map<File, { projectId: string; artifact: Artifact }>());
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // null while unknown: a failed settings read must not block a Review that
  // the service can still validate itself.
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.aiSettings()
      .then(async settings => {
        const configured = isWorkflowProviderConfigured(settings, 'text');
        const setting = settings.find(item => item.id === 'text');
        let ready = configured;
        if (configured && setting?.provider === 'codex' && typeof api.codexStatus === 'function') ready = (await api.codexStatus()).connected;
        if (configured && setting?.provider === 'gemini' && setting.connectionMethod === 'oauth') ready = (await api.geminiOAuthStatus()).connected;
        if (!cancelled) setProviderReady(ready);
      })
      .catch(() => { if (!cancelled) setProviderReady(null); });
    return () => { cancelled = true; };
  }, []);
  const errorRef = useRef<HTMLDivElement>(null);
  const idempotencyKey = useRef<string>(makeIdempotencyKey());
  const scopeRequestId = useRef(0);
  const selectionInitializedFor = useRef<string | null>(null);
  const lastInitialProjectId = useRef(initialProjectId);
  const comparisonProjectId = useRef(initialProjectId || projects[0]?.id || '');
  const routeComparisonParentReviewId = useRef(initialComparisonParentReviewId || null);

  useEffect(() => {
    if (lastInitialProjectId.current !== initialProjectId) {
      lastInitialProjectId.current = initialProjectId;
      if (initialProjectId && projects.some(project => project.id === initialProjectId)) {
        setSelectedProjectId(initialProjectId);
      }
      return;
    }
    if (!projects.some(project => project.id === selectedProjectId)) setSelectedProjectId(projects[0]?.id || '');
  }, [initialProjectId, projects, selectedProjectId]);

  useEffect(() => {
    const nextParentId = initialComparisonParentReviewId || null;
    if (routeComparisonParentReviewId.current === nextParentId) return;
    routeComparisonParentReviewId.current = nextParentId;
    setComparisonParentReviewId(nextParentId);
    setComparisonParentReview(null);
    setComparisonError(null);
    setComparisonLoading(false);
    comparisonPrefilledFor.current = null;
    selectionInitializedFor.current = null;
    comparisonProjectId.current = initialProjectId || selectedProjectId;
    setReviewName('');
    setObjective('');
    setBaseRef('');
    setHeadRef('');
    setPullRequest('');
  }, [initialComparisonParentReviewId, initialProjectId, selectedProjectId]);

  useEffect(() => {
    if (!comparisonParentReviewId) {
      comparisonProjectId.current = selectedProjectId;
      return;
    }
    if (comparisonProjectId.current && comparisonProjectId.current !== selectedProjectId) {
      setComparisonParentReviewId(null);
      setComparisonParentReview(null);
      setComparisonError(null);
      setComparisonLoading(false);
      comparisonPrefilledFor.current = null;
      selectionInitializedFor.current = null;
      setReviewName('');
      setObjective('');
      setBaseRef('');
      setHeadRef('');
      setPullRequest('');
    }
  }, [comparisonParentReviewId, selectedProjectId]);

  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;
  useEffect(() => {
    setOnlineRepositoryId('');
    setRepositoryRevision('');
    setRepositoryBranch('');
    setRemoteBranches([]);
    setRemoteCommits([]);
    setReferenceFiles([]);
    setReferenceError(null);
    uploadedReferences.current.clear();
  }, [selectedProjectId]);

  const loadScope = useCallback(async () => {
    const requestId = ++scopeRequestId.current;
    const isCurrentRequest = () => scopeRequestId.current === requestId;
    if (!selectedProjectId || !selectedProject) {
      setArtifacts([]);
      setRequirements([]);
      setSelectedArtifactIds(new Set());
      setSelectedRequirementIds(new Set());
      setSelectedStandardIds(new Set());
      setActiveSession(null);
      setScopeError(null);
      setComparisonParentReview(null);
      setComparisonError(null);
      setComparisonLoading(false);
      setLoadingScope(false);
      return;
    }
    setLoadingScope(true);
    setScopeError(null);
    setActiveSession(null);
    setComparisonParentReview(null);
    setComparisonError(null);
    setComparisonLoading(Boolean(comparisonParentReviewId));
    try {
      const [nextArtifacts, nextRequirements, nextConnectedSources] = await Promise.all([
        api.listArtifacts(selectedProjectId),
        typeof api.listRequirements === 'function' ? api.listRequirements(selectedProjectId) : Promise.resolve([] as Requirement[]),
        typeof api.listConnectedSources === 'function' ? api.listConnectedSources(selectedProjectId).catch(() => [] as ConnectedSource[]) : Promise.resolve([] as ConnectedSource[]),
      ]);
      if (!isCurrentRequest()) return;
      const pinnedSources = new Set(nextConnectedSources.filter(source => source.selectedScope.reviewSnapshot === true).map(source => source.id));
      const activeArtifacts = nextArtifacts.filter(artifact => !isDeprecated(artifact) && (comparisonParentReviewId || !artifact.sourceId || !pinnedSources.has(artifact.sourceId)));
      setArtifacts(activeArtifacts);
      setRequirements(nextRequirements);
      setConnectedSources(nextConnectedSources);
      if (!comparisonParentReviewId && selectionInitializedFor.current !== selectedProjectId) {
        setSelectedArtifactIds(new Set(activeArtifacts.filter(artifact => artifact.type !== 'coding_standard').map(artifact => artifact.id)));
        setSelectedStandardIds(new Set(activeArtifacts.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifact.id)));
        setSelectedRequirementIds(new Set(nextRequirements.map(requirement => requirement.id)));
        selectionInitializedFor.current = selectedProjectId;
      }

      if (comparisonParentReviewId) {
        try {
          const reviews = await api.listStaticSessions(selectedProjectId);
          if (!isCurrentRequest()) return;
          const parentReview = reviews.find(review => review.id === comparisonParentReviewId && review.projectId === selectedProjectId);
          if (!parentReview) {
            setComparisonError('The prior Review could not be found in this project. Retry the lookup or clear the comparison before starting an independent Review.');
          } else {
            const manifest = await api.getReviewSourceManifest(selectedProjectId, parentReview.id);
            if (!isCurrentRequest()) return;
            const failure = comparisonFailure(parentReview, selectedProjectId, manifest ?? null);
            const config = parseReviewConfig(parentReview);
            const savedScope = priorScope(parentReview, config);
            if (failure) {
              setComparisonError(`${failure} Retry the lookup or clear the comparison before starting an independent Review.`);
            } else if (!savedScope) {
              setComparisonError('The saved Review scope is unavailable for comparison. Retry the lookup or clear the comparison before starting an independent Review.');
            } else {
              setComparisonParentReview(parentReview);
              if (comparisonPrefilledFor.current !== parentReview.id) {
                setReviewScopeMode('focused');
                const prefilledName = parentReview.name.trim().slice(0, 120);
                setReviewName(prefilledName);
                setObjective(typeof config.instructions === 'string' ? config.instructions : '');
                setBaseRef(typeof config.baseRef === 'string' ? config.baseRef : '');
                setHeadRef(typeof config.headRef === 'string' ? config.headRef : '');
                setPullRequest(typeof config.pullRequest === 'string' ? config.pullRequest : '');
                const artifactIds = new Set(savedScope.artifactIds ?? []);
                const standardIds = new Set(savedScope.standardIds ?? []);
                const requirementIds = new Set(savedScope.requirementIds ?? []);
                setSelectedArtifactIds(artifactIds);
                setSelectedStandardIds(standardIds);
                setSelectedRequirementIds(requirementIds);
                selectionInitializedFor.current = selectedProjectId;
                comparisonPrefilledFor.current = parentReview.id;
              }
            }
          }
        } catch (cause) {
          if (isCurrentRequest()) {
            setComparisonParentReview(null);
            setComparisonError(`${userFacingError(cause, 'The prior Review could not be loaded.')} Retry the lookup or clear the comparison before starting an independent Review.`);
          }
        }
      }

      // This check is advisory. A sidecar that has not implemented the list
      // endpoint yet must not turn otherwise valid source context into a fake
      // source failure; the create route remains the final authority.
      if (typeof api.listActiveStaticSessions === 'function') {
        try {
          const active = await api.listActiveStaticSessions();
          if (!isCurrentRequest()) return;
          setActiveSession(active.find(session => session.projectId === selectedProjectId) ?? null);
        } catch {
          if (isCurrentRequest()) setActiveSession(null);
        }
      }
    } catch (cause) {
      if (!isCurrentRequest()) return;
      setArtifacts([]);
      setRequirements([]);
      setSelectedArtifactIds(new Set());
      setSelectedRequirementIds(new Set());
      setSelectedStandardIds(new Set());
      setScopeError(userFacingError(cause, 'Project scope could not be loaded.'));
    } finally {
      if (isCurrentRequest()) {
        setComparisonLoading(false);
        setLoadingScope(false);
      }
    }
  }, [comparisonParentReviewId, selectedProject, selectedProjectId]);

  useEffect(() => { void loadScope(); }, [loadScope]);
  useEffect(() => { if (formError) errorRef.current?.focus(); }, [formError]);

  const clearComparison = useCallback(() => {
    scopeRequestId.current += 1;
    setComparisonParentReviewId(null);
    setComparisonParentReview(null);
    setComparisonError(null);
    setComparisonLoading(false);
    comparisonPrefilledFor.current = null;
    comparisonProjectId.current = selectedProjectId;
    setFormError(null);
    setReviewScopeMode('full');
    setBaseRef('');
    setHeadRef('');
    setPullRequest('');
  }, [selectedProjectId]);

  const handleProjectSelection = (nextProjectId: string) => {
    if (nextProjectId !== selectedProjectId && comparisonParentReviewId) {
      scopeRequestId.current += 1;
      setComparisonParentReviewId(null);
      setComparisonParentReview(null);
      setComparisonError(null);
      setComparisonLoading(false);
      comparisonPrefilledFor.current = null;
      comparisonProjectId.current = nextProjectId;
      setReviewName('');
      setObjective('');
      setBaseRef('');
      setHeadRef('');
      setPullRequest('');
    }
    setSelectedProjectId(nextProjectId);
  };

  const groups = useMemo(() => selectedProject ? groupArtifacts(artifacts, selectedProject, connectedSources) : { repositories: [], documents: [], standards: [] }, [artifacts, connectedSources, selectedProject]);
  const onlineRepositories = connectedSources.filter(source => source.kind === 'github_repository' && source.selectedScope.reviewSnapshot !== true && source.status === 'active'
    && source.syncStatus === 'ready' && source.remoteRevision && groups.repositories.some(group => group.identity === `connected:${source.id}`));
  const onlineRepository = onlineRepositories.find(source => source.id === onlineRepositoryId);
  const revision = onlineRepository?.remoteRevision;
  const revisionGit = artifacts.find(artifact => artifact.sourceId === onlineRepositoryId && artifact.git?.commit === revision)?.git;
  const revisionBranch = revisionGit?.branch || (typeof onlineRepository?.selectedScope.branch === 'string' ? onlineRepository.selectedScope.branch : '');
  const remoteId = onlineRepository?.remoteId;
  useEffect(() => {
    if (!remoteId || typeof api.browseConnectedSources !== 'function') return;
    let cancelled = false;
    void api.browseConnectedSources('github', { remoteId, pageSize: 100 }).then(page => {
      if (!cancelled) setRemoteBranches(page.items.filter(item => item.kind === 'branch'));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [remoteId]);
  useEffect(() => {
    if (!remoteId || !repositoryBranch || repositoryBranch === 'saved' || typeof api.browseConnectedSources !== 'function') return;
    let cancelled = false;
    void api.browseConnectedSources('github', { remoteId, branch: repositoryBranch, pageSize: 100 }).then(page => {
      if (!cancelled) setRemoteCommits(page.items.filter(item => item.kind === 'commit'));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [remoteId, repositoryBranch]);
  const branchOptions = remoteBranches.map(branch => ({ value: branch.id, label: branch.name }));
  if (revisionBranch && !branchOptions.some(branch => branch.value === revisionBranch)) branchOptions.push({ value: revisionBranch, label: revisionBranch });
  if (revision && !revisionBranch && branchOptions.length === 0) branchOptions.push({ value: 'saved', label: 'Saved revision' });
  const revisionOptions = remoteCommits.map(commit => ({ value: commit.id, label: commit.name || 'Commit message unavailable', description: commit.id }));
  if (revision && (repositoryBranch === revisionBranch || repositoryBranch === 'saved') && !revisionOptions.some(commit => commit.value === revision)) {
    revisionOptions.push({ value: revision, label: revisionGit?.subject || 'Saved commit', description: revision });
  }
  const effectiveArtifacts = artifacts.filter(artifact => (!onlineRepositoryId || artifact.source !== 'repository' || artifact.sourceId === onlineRepositoryId)
    && (reviewScopeMode === 'full' || (onlineRepositoryId && artifact.sourceId === onlineRepositoryId)
      || selectedArtifactIds.has(artifact.id) || selectedStandardIds.has(artifact.id)));
  const selectedCount = effectiveArtifacts.length + selectedRequirementIds.size + referenceFiles.length;
  const isArtifactSelected = (id: string) => selectedArtifactIds.has(id) || selectedStandardIds.has(id);
  const selectedRepositoryCount = groups.repositories.filter(repository => repository.artifactIds.length > 0 && repository.artifactIds.every(isArtifactSelected)).length;
  const hasPartialRepositorySelection = groups.repositories.some(repository => repository.artifactIds.some(isArtifactSelected) && !repository.artifactIds.every(isArtifactSelected));
  const selectedDocumentCount = groups.documents.filter(item => selectedArtifactIds.has(item.id)).length;
  const selectionSummary = [
    selectedRepositoryCount > 0 ? `${selectedRepositoryCount} ${selectedRepositoryCount === 1 ? 'repository' : 'repositories'}` : null,
    hasPartialRepositorySelection ? 'Partial saved repository scope' : null,
    selectedDocumentCount > 0 ? `${selectedDocumentCount} ${selectedDocumentCount === 1 ? 'document' : 'documents'}` : null,
  ].filter(Boolean).join(' · ');
  const hasScope = artifacts.length > 0 || requirements.length > 0 || referenceFiles.length > 0;
  const unavailableMembers = useMemo(() => unavailableSavedMembers({ artifactIds: [...selectedArtifactIds], requirementIds: [...selectedRequirementIds], standardIds: [...selectedStandardIds] }, artifacts, requirements), [artifacts, requirements, selectedArtifactIds, selectedRequirementIds, selectedStandardIds]);
  const comparisonBlocked = Boolean(comparisonParentReviewId && (!comparisonParentReview || comparisonLoading || comparisonError));
  const sourceBlocked = !selectedProject || loadingScope || Boolean(scopeError) || !hasScope || selectedCount === 0 || (reviewScopeMode === 'focused' && unavailableMembers.length > 0) || Boolean(activeSession) || comparisonBlocked;

  const blockingReason = !selectedProject
    ? 'Create or select a project before starting this review.'
    : loadingScope
      ? 'Checking the project scope…'
      : scopeError
        ? 'Project scope could not be checked. Retry the scope request before starting.'
        : comparisonParentReviewId && comparisonLoading
          ? 'Checking the prior Review comparison…'
          : comparisonParentReviewId && comparisonError
            ? 'The prior Review comparison is unavailable. Retry the lookup or choose an independent Review.'
            : comparisonParentReviewId && !comparisonParentReview
              ? 'The prior Review comparison must be verified before starting.'
        : activeSession
          ? 'A review is already active for this project. Open its activity before starting another review.'
          : !hasScope
            ? 'Add project sources or reference files before starting this review.'
            : selectedCount === 0
              ? 'Select at least one project source or reference file for this review.'
              : reviewScopeMode === 'focused' && unavailableMembers.length > 0
                ? 'One or more saved comparison inputs are unavailable. Remove them explicitly or restore them in the project before starting.'
              : undefined;

  const toggleSelection = (item: ScopeItem) => {
    const update = (current: Set<string>) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    };
    if (item.kind === 'artifact') setSelectedArtifactIds(update);
    if (item.kind === 'standard') setSelectedStandardIds(update);
    if (item.kind === 'requirement') setSelectedRequirementIds(update);
  };

  const toggleRepository = (repository: RepositoryScope) => {
    const isFullySelected = repository.artifactIds.length > 0 && repository.artifactIds.every(isArtifactSelected);
    const standardIds = new Set(groups.standards.map(item => item.id));
    const update = (current: Set<string>, ids: string[]) => {
      const next = new Set(current);
      for (const id of ids) {
        if (isFullySelected) next.delete(id);
        else next.add(id);
      }
      return next;
    };
    setSelectedArtifactIds(current => update(current, repository.artifactIds.filter(id => !standardIds.has(id))));
    setSelectedStandardIds(current => update(current, repository.artifactIds.filter(id => standardIds.has(id))));
  };

  const renderScopeItems = (items: ScopeItem[], groupLabel: string, emptyLabel: string, emptyAction?: React.ReactNode) => (
    <fieldset className="review-scope-group">
      <legend>{groupLabel}</legend>
      {items.length === 0 ? <p className="review-scope-empty">{emptyLabel}{emptyAction && <> {emptyAction}</>}</p> : <div className="review-scope-list">
        {items.map(item => {
          const selected = item.kind === 'artifact'
            ? selectedArtifactIds.has(item.id)
            : item.kind === 'standard'
              ? selectedStandardIds.has(item.id)
              : selectedRequirementIds.has(item.id);
          return <label key={`${item.kind}-${item.id}`} className={`review-scope-item${selected ? ' is-selected' : ''}`}>
            <input type="checkbox" checked={selected} onChange={() => toggleSelection(item)} />
            <span className="review-scope-check" aria-hidden="true">{selected && <Check size={13} strokeWidth={2.2} />}</span>
            <span className="review-scope-item-copy"><strong>{item.label}</strong><small title={item.detail}>{item.detail}</small></span>
          </label>;
        })}
      </div>}
    </fieldset>
  );

  const renderRepositories = () => (
    <fieldset className="review-scope-group">
      <legend>Repositories</legend>
      {groups.repositories.length === 0 ? <p className="review-scope-empty">No imported repositories are available.</p> : <div className="review-scope-list review-repository-list">
        {groups.repositories.map(repository => {
          const selectedIds = repository.artifactIds.filter(isArtifactSelected);
          const selected = selectedIds.length === repository.artifactIds.length;
          const partial = selectedIds.length > 0 && !selected;
          return <label key={repository.identity} className={`review-scope-item review-repository-item${selected ? ' is-selected' : ''}${partial ? ' is-partial' : ''}`}>
            <input type="checkbox" aria-label={`Repository ${repository.label}`} checked={selected} ref={element => { if (element) element.indeterminate = partial; }} onChange={() => toggleRepository(repository)} />
            <span className="review-scope-check" aria-hidden="true">{selected && <Check size={13} strokeWidth={2.2} />}</span>
            <span className="review-scope-item-copy"><strong>{repository.label}</strong><small title={repository.detail}>{repository.detail}</small></span>
          </label>;
        })}
      </div>}
    </fieldset>
  );

  const removeUnavailableMember = (member: UnavailableSavedMember) => {
    const update = (current: Set<string>) => { const next = new Set(current); next.delete(member.id); return next; };
    if (member.kind === 'source') setSelectedArtifactIds(update);
    if (member.kind === 'coding standard') setSelectedStandardIds(update);
    if (member.kind === 'requirement') setSelectedRequirementIds(update);
  };

  const addReferences = (incoming: FileList | File[]) => {
    if (submitting) return;
    const files = Array.from(incoming);
    if (!files.length) return;
    if (referenceFiles.length + files.length > MAX_REFERENCES) {
      setReferenceError('Attach up to five reference files.');
      return;
    }
    if (files.some(file => !REFERENCE_EXTENSIONS.test(file.name) || file.size === 0 || file.size > MAX_REFERENCE_BYTES)) {
      setReferenceError('Choose non-empty PDF, Markdown, text, JSON, CSV, or YAML files up to 10 MiB each.');
      return;
    }
    setReferenceError(null);
    setReferenceFiles(current => [...current, ...files]);
  };

  const handleCreateReview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (submitting) return;
    if (!selectedProject) return setFormError('Choose a project before starting a review.');
    if (!reviewName.trim()) return setFormError('Review name is required.');
    if (!objective.trim()) return setFormError('Review objective is required.');
    if (objective.trim().length > MAX_OBJECTIVE_LENGTH) return setFormError(`Review objective must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`);
    if (sourceBlocked) return setFormError(blockingReason || 'Select valid project scope before starting this review.');
    if (onlineRepositoryId && (!onlineRepository || !repositoryBranch || !revisionOptions.some(option => option.value === repositoryRevision))) {
      return setFormError('Select a branch and commit for this repository.');
    }
    if (baseRef.trim() && !headRef.trim()) return setFormError('Add a head branch or commit when a base ref is supplied.');
    if (headRef.trim() && !baseRef.trim()) return setFormError('Add a base branch or commit when a head ref is supplied.');

    setSubmitting(true);
    try {
      let repositorySourceId = onlineRepository?.id;
      let reviewArtifacts = effectiveArtifacts;
      if (onlineRepository && repositoryRevision !== onlineRepository.remoteRevision) {
        const remoteId = `${onlineRepository.remoteId}@${repositoryRevision}`;
        const saved = connectedSources.find(source => source.remoteId === remoteId && source.status === 'active'
          && source.syncStatus === 'ready' && source.remoteRevision === repositoryRevision);
        const snapshot = saved ?? (await api.importConnectedSource(selectedProject.id, {
          provider: 'github', kind: 'github_repository', remoteId, remoteUrl: onlineRepository.remoteUrl,
          name: `${onlineRepository.name} · ${repositoryRevision.slice(0, 7)}`, selectedScope: { reviewSnapshot: true },
        })).source;
        if (snapshot.syncStatus !== 'ready' || snapshot.remoteRevision !== repositoryRevision) {
          throw new Error('The selected commit has not finished importing. Retry after it is ready.');
        }
        repositorySourceId = snapshot.id;
        const snapshotFiles = (await api.listArtifacts(selectedProject.id)).filter(artifact => artifact.sourceId === snapshot.id && !isDeprecated(artifact));
        if (!snapshotFiles.length) throw new Error('The selected commit has no imported files available for Review.');
        reviewArtifacts = [...effectiveArtifacts.filter(artifact => artifact.source !== 'repository'), ...snapshotFiles];
      }
      const references: Array<{ id: string; name: string }> = [];
      for (const file of referenceFiles) {
        const saved = uploadedReferences.current.get(file);
        const artifact = saved?.projectId === selectedProject.id ? saved.artifact : await api.uploadArtifact(selectedProject.id, {
          fileName: file.name, content: await encodeReference(file), type: 'other', reviewReference: true,
        });
        uploadedReferences.current.set(file, { projectId: selectedProject.id, artifact });
        references.push({ id: artifact.id, name: artifact.fileName });
      }
      const artifactIds = [...new Set([...reviewArtifacts.filter(artifact => artifact.type !== 'coding_standard').map(artifact => artifact.id), ...references.map(file => file.id)])];
      const standardIds = reviewArtifacts.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifact.id);
      const requirementIds = reviewScopeMode === 'full' ? requirements.map(requirement => requirement.id) : [...selectedRequirementIds];
      const scope = {
        artifactIds,
        requirementIds,
        standardIds,
        ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
        ...(headRef.trim() ? { headRef: headRef.trim() } : {}),
        ...(pullRequest.trim() ? { pullRequest: pullRequest.trim() } : {}),
      };
      const payload: CreateStaticSessionPayload = {
        name: reviewName.trim(),
        instructions: objective.trim(),
        reviewMode: pullRequest.trim() ? 'pull-request' : baseRef.trim() ? 'changed-files' : 'regular',
        reviewer: 'Project owner',
        ...(pullRequest.trim() ? { pullRequest: pullRequest.trim() } : {}),
        ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
        ...(headRef.trim() ? { headRef: headRef.trim() } : {}),
        scope,
        artifactIds,
        requirementIds,
        standardIds,
        selectedArtifactIds: artifactIds,
        selectedRequirementIds: requirementIds,
        selectedStandardIds: standardIds,
        scopeMode: reviewScopeMode,
        ...(references.length ? { supportiveDocuments: references } : {}),
        ...(repositorySourceId ? { repositorySourceId, repositoryRevision, ...(repositoryBranch !== 'saved' ? { repositoryBranch } : {}) } : {}),
        idempotencyKey: idempotencyKey.current,
        ...(comparisonParentReview && comparisonParentReview.id === comparisonParentReviewId
          ? { comparisonParentReviewId: comparisonParentReview.id }
          : {}),
      };
      const session = await api.createStaticSession(selectedProject.id, payload);
      try { window.sessionStorage.removeItem(draftKey); } catch { /* storage is optional */ }
      onNavigate({ name: 'review-activity', projectId: selectedProject.id, sessionId: session.id, reviewName: session.name });
    } catch (cause) {
      const errorMessage = userFacingError(cause, 'The review could not be started. Check the project sources and try again.');
      setFormError(comparisonParentReviewId
        ? `The linked Review could not be verified, so no new Review was started. ${errorMessage} Retry the comparison or clear it before starting an independent Review.`
        : errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleProjectCreated = (project: Project) => {
    handleProjectSelection(project.id);
    setShowProjectModal(false);
  };

  return (
    <div className="screen command-review-entry review-entry-screen">
      <CommandPageHeader eyebrow="Review" title="Start a Review" onBack={() => onNavigate({ name: 'dashboard' })} />
      <form className="review-entry-form" aria-label="Start review" onSubmit={event => { void handleCreateReview(event); }}>
        <section className="review-form-section review-entry-basics" aria-labelledby="review-entry-details-heading">
          <h2 id="review-entry-details-heading" className="review-entry-section-title">Review details</h2>
          <div className="review-entry-field review-name-field form-field">
            <label htmlFor="review-entry-name">Review name <span className="field-required" aria-hidden="true">*</span></label>
            <input id="review-entry-name" aria-label="Review name" value={reviewName} onChange={event => setReviewName(event.target.value)} maxLength={120} placeholder="For example, Sprint 3 evidence review" required />
          </div>
          <div className="review-entry-field review-project-field form-field">
            <label htmlFor="review-entry-project">Project <span className="field-required" aria-hidden="true">*</span></label>
            <div className="review-project-row">
              <Select id="review-entry-project" aria-label="Project" value={selectedProjectId} onChange={handleProjectSelection} disabled={submitting || projects.length === 0} placeholder={projects.length === 0 ? 'No projects available' : 'Select a project'} options={projects.map(project => ({ value: project.id, label: project.name }))} />
              <button type="button" className="btn-secondary review-create-project-button" disabled={submitting} onClick={() => setShowProjectModal(true)}><Plus size={15} aria-hidden="true" /> Create project</button>
            </div>
            {comparisonLoading && comparisonParentReviewId && <p className="review-comparison-loading" role="status">Checking the saved Review comparison…</p>}
            {comparisonError && comparisonParentReviewId && <div className="review-comparison-error" role="alert"><strong>Comparison unavailable</strong><p>{comparisonError}</p><div><button type="button" className="btn-link" onClick={() => void loadScope()}>Retry comparison</button><button type="button" className="btn-link" onClick={clearComparison}>Start an independent Review</button></div></div>}
            {comparisonParentReview && comparisonParentReview.id === comparisonParentReviewId && <div className="review-comparison-context" role="note"><strong>Comparing updated sources with {comparisonParentReview.name}.</strong><p>Its saved selection is preselected. Scope changes may affect finding comparison.</p><button type="button" className="btn-link" onClick={clearComparison}>Start an independent Review</button></div>}
          </div>
        </section>

        <section className="review-form-section review-entry-objective" aria-labelledby="review-entry-objective-heading">
          <h2 id="review-entry-objective-heading" className="review-entry-section-title">Goal</h2>
          <div className="form-field">
            <label htmlFor="review-entry-objective">What should this Review verify? <span className="field-required" aria-hidden="true">*</span></label>
            <textarea id="review-entry-objective" aria-label="Review objective" rows={4} value={objective} onChange={event => setObjective(event.target.value)} maxLength={MAX_OBJECTIVE_LENGTH} placeholder="For example, verify checkout authorization and recovery requirements." required />
            <div className="review-objective-footer"><span className="review-character-count">{objective.length}/{MAX_OBJECTIVE_LENGTH}</span></div>
          </div>
          <div className="form-field">
            <label htmlFor="review-entry-references">References <span className="field-optional">(optional)</span></label>
            <input id="review-entry-references" ref={referenceInput} type="file" hidden multiple accept=".pdf,.md,.txt,.json,.csv,.yaml,.yml" disabled={submitting} onChange={event => { if (event.target.files) addReferences(event.target.files); event.target.value = ''; }} />
            <button type="button" className="review-reference-drop" disabled={submitting} onClick={() => referenceInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addReferences(event.dataTransfer.files); }}>
              <Paperclip size={20} aria-hidden="true" />
              <span>Drop files here or attach</span>
              <small>Up to five files, 10 MiB each</small>
            </button>
            {referenceError && <p role="alert">{referenceError}</p>}
            {referenceFiles.length > 0 && <ul className="review-reference-list">{referenceFiles.map((file, index) => <li key={index}><span>{file.name}</span><button type="button" className="btn-link" aria-label={`Remove ${file.name}`} disabled={submitting} onClick={() => { setReferenceFiles(current => current.filter((_, item) => item !== index)); setReferenceError(null); }}>Remove</button></li>)}</ul>}
          </div>
        </section>

        <section className="review-form-section review-entry-scope" aria-labelledby="review-entry-scope-heading">
          <div className="review-form-section-heading review-scope-heading">
            <div><h2 id="review-entry-scope-heading" className="review-entry-section-title">Review scope</h2></div>
          </div>
          <fieldset className="review-scope-modes" aria-label="Review type" disabled={submitting}>
            <label className="review-scope-mode"><input type="radio" name="review-scope-mode" checked={reviewScopeMode === 'full'} onChange={() => setReviewScopeMode('full')} /><span><strong>Full review</strong><small>Review all active project sources and the references you attach.</small></span></label>
            <label className="review-scope-mode"><input type="radio" name="review-scope-mode" checked={reviewScopeMode === 'focused'} onChange={() => setReviewScopeMode('focused')} /><span><strong>Focused review</strong><small>Use the goal to focus on relevant areas within the selected sources.</small></span></label>
          </fieldset>
          {loadingScope && <p className="review-scope-status" role="status"><RotateCcw size={15} aria-hidden="true" /> Checking project scope…</p>}
          {scopeError && <div className="review-scope-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><div><strong>Project sources are unavailable</strong><p>{scopeError}</p><button type="button" className="btn-link" onClick={() => void loadScope()}>Retry</button></div></div>}
          {!loadingScope && !scopeError && !hasScope && <div className="review-scope-empty-state"><FileCheck2 size={22} aria-hidden="true" /><div><strong>No project sources found</strong><button type="button" className="btn-secondary" onClick={() => selectedProject && onNavigate({ name: 'project-detail', projectId: selectedProject.id, initialSection: 'source' })}>Open project sources</button></div></div>}
          {!loadingScope && !scopeError && hasScope && reviewScopeMode === 'focused' && <div className="review-source-picker-trigger">
            <button type="button" className="btn-secondary" disabled={submitting} onClick={() => setSourcePickerOpen(true)}>Choose sources</button>
            <p className="review-scope-summary">{selectionSummary || 'No project sources selected'}</p>
          </div>}
        </section>

        <section className="review-form-section review-entry-advanced">
          <button type="button" className="review-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}><span><ChevronDown size={16} aria-hidden="true" /> Advanced scope</span></button>
          {advancedOpen && <div className="review-advanced-fields">
            <div className="review-advanced-grid">
              <div className="form-field review-advanced-repository"><label htmlFor="review-entry-online-repo">Online repository</label><Select id="review-entry-online-repo" aria-label="Online repository" value={onlineRepositoryId || 'review-scope'} disabled={submitting || !onlineRepositories.length} onChange={id => { setOnlineRepositoryId(id === 'review-scope' ? '' : id); setRepositoryBranch(''); setRepositoryRevision(''); setRemoteBranches([]); setRemoteCommits([]); }} options={[{ value: 'review-scope', label: 'Use review scope' }, ...onlineRepositories.map(source => ({ value: source.id, label: source.name }))]} /></div>
              <div className="form-field"><label htmlFor="review-entry-branch">Branch</label><Select id="review-entry-branch" aria-label="Branch" value={repositoryBranch} placeholder="Select a branch" disabled={submitting || !branchOptions.length} onChange={branch => { setRepositoryBranch(branch); setRepositoryRevision(''); setRemoteCommits([]); }} options={branchOptions} /></div>
              <div className="form-field"><label htmlFor="review-entry-revision">Commit</label><Select id="review-entry-revision" aria-label="Commit" value={repositoryRevision} placeholder="Select a commit" disabled={submitting || !repositoryBranch || !revisionOptions.length} onChange={setRepositoryRevision} options={revisionOptions} /></div>
            </div>
          </div>}
        </section>

        {providerReady === false && <div className="review-entry-error review-entry-provider" role="alert"><AlertCircle size={16} aria-hidden="true" /> <span>The Model Provider for Review is not ready. Connect ChatGPT or save an API provider and model in Settings, then come back to start this review.</span><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'settings' })}>Open Settings</button></div>}
        {formError && <div ref={errorRef} className="review-entry-error" role="alert" tabIndex={-1}><AlertCircle size={16} aria-hidden="true" /> <span>{formError}</span></div>}
        {blockingReason && <p className="review-entry-submit-hint" role="status">{blockingReason}</p>}
        <div className="review-entry-actions"><button type="submit" className="btn-primary review-entry-submit" disabled={submitting || sourceBlocked || providerReady === false}>{submitting ? 'Starting review…' : 'Start review'}</button><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'dashboard' })} disabled={submitting}>Cancel</button></div>
      </form>

      <Modal isOpen={sourcePickerOpen} onClose={() => setSourcePickerOpen(false)} title="Choose review sources" width={740}>
        <div className="review-scope-groups">
          {!onlineRepository && renderRepositories()}
          {renderScopeItems([...groups.documents, ...groups.standards], 'Imported files', 'No imported files are available.')}
          {unavailableMembers.length > 0 && <fieldset className="review-scope-group review-unavailable-group"><legend>Unavailable saved inputs</legend><div className="review-scope-list">{unavailableMembers.map(member => <label key={`${member.kind}-${member.id}`} className="review-scope-item is-selected"><input type="checkbox" checked onChange={() => removeUnavailableMember(member)} /><span className="review-scope-check" aria-hidden="true"><Check size={13} /></span><span className="review-scope-item-copy"><strong>{member.kind}</strong><small>{member.id} · remove from this Review</small></span></label>)}</div></fieldset>}
        </div>
        <div className="form-actions"><button type="button" className="btn-primary" onClick={() => setSourcePickerOpen(false)}>Done</button></div>
      </Modal>

      <ProjectCreateModal isOpen={showProjectModal} onClose={() => setShowProjectModal(false)} onCreate={onCreateProject} onCreated={handleProjectCreated} />
    </div>
  );
}
