import type React from 'react';
import { RecentReviews } from '../components/RecentReviews';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, FileCheck2, GitBranch, Plus, RotateCcw } from 'lucide-react';
import { api, type CreateStaticSessionPayload } from '../api/client';
import { CommandPageHeader } from '../components/CommandUI';
import { ProjectCreateModal, type ProjectCreateSource } from '../components/ProjectCreateModal';
import { Select } from '../components/Select';
import { userFacingError } from '../utils/userFacingError';
import { isWorkflowProviderConfigured } from '../providerReadiness';
import type { Artifact, ConnectedSource, Project, Requirement, ReviewScopeSelection, ReviewSourceManifest, Screen, StaticSession } from '../types';
import './ReviewEntryScreen.css';

type Props = {
  projects: Project[];
  initialProjectId?: string;
  comparisonParentReviewId?: string;
  onNavigate: (screen: Screen) => void;
  onCreateProject: (name: string, description: string, workspacePath: string, source: ProjectCreateSource) => Promise<Project | void>;
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
    documents: supportingArtifacts.filter(artifact => artifact.type !== 'coding_standard').map(artifact => artifactItem(artifact, 'artifact')),
    standards: supportingArtifacts.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifactItem(artifact, 'standard')),
  };
}

function defaultArtifactIds(groups: ScopeGroups): string[] {
  return [
    ...(groups.repositories[0]?.artifactIds ?? []),
    ...groups.documents.map(item => item.id),
    ...groups.standards.map(item => item.id),
  ];
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

function requirementItems(requirements: Requirement[]): ScopeItem[] {
  return requirements.map(requirement => ({
    id: requirement.id,
    label: requirement.title || 'Unnamed requirement',
    detail: requirement.category || 'Project requirement',
    kind: 'requirement',
  }));
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
        // A saved Codex model still needs a signed-in Codex account on this device.
        const usesCodex = settings.find(item => item.id === 'text')?.provider === 'codex';
        const ready = configured && usesCodex && typeof api.codexStatus === 'function' ? (await api.codexStatus()).connected : configured;
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
      const activeArtifacts = nextArtifacts.filter(artifact => !isDeprecated(artifact));
      setArtifacts(activeArtifacts);
      setRequirements(nextRequirements);
      setConnectedSources(nextConnectedSources);
      if (!comparisonParentReviewId && selectionInitializedFor.current !== selectedProjectId) {
        const defaults = groupArtifacts(activeArtifacts, selectedProject!, nextConnectedSources);
        const defaultIds = new Set(defaultArtifactIds(defaults));
        setSelectedArtifactIds(new Set(activeArtifacts.filter(artifact => artifact.type !== 'coding_standard' && defaultIds.has(artifact.id)).map(artifact => artifact.id)));
        setSelectedStandardIds(new Set(activeArtifacts.filter(artifact => artifact.type === 'coding_standard' && defaultIds.has(artifact.id)).map(artifact => artifact.id)));
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
  const requirementsScope = useMemo(() => requirementItems(requirements), [requirements]);
  const selectedCount = selectedArtifactIds.size + selectedRequirementIds.size + selectedStandardIds.size;
  const isArtifactSelected = (id: string) => selectedArtifactIds.has(id) || selectedStandardIds.has(id);
  const selectedRepositoryCount = groups.repositories.filter(repository => repository.artifactIds.length > 0 && repository.artifactIds.every(isArtifactSelected)).length;
  const hasPartialRepositorySelection = groups.repositories.some(repository => repository.artifactIds.some(isArtifactSelected) && !repository.artifactIds.every(isArtifactSelected));
  const selectedDocumentCount = groups.documents.filter(item => selectedArtifactIds.has(item.id)).length;
  const selectedRequirementCount = requirementsScope.filter(item => selectedRequirementIds.has(item.id)).length;
  const selectedStandardCount = groups.standards.filter(item => selectedStandardIds.has(item.id)).length;
  const selectionSummary = [
    selectedRepositoryCount > 0 ? `${selectedRepositoryCount} ${selectedRepositoryCount === 1 ? 'repository' : 'repositories'}` : null,
    hasPartialRepositorySelection ? 'Partial saved repository scope' : null,
    selectedDocumentCount > 0 ? `${selectedDocumentCount} ${selectedDocumentCount === 1 ? 'document' : 'documents'}` : null,
    selectedRequirementCount > 0 ? `${selectedRequirementCount} ${selectedRequirementCount === 1 ? 'requirement' : 'requirements'}` : null,
    selectedStandardCount > 0 ? `${selectedStandardCount} ${selectedStandardCount === 1 ? 'standard' : 'standards'}` : null,
  ].filter(Boolean).join(' · ');
  const hasScope = artifacts.length > 0 || requirements.length > 0;
  const unavailableMembers = useMemo(() => unavailableSavedMembers({ artifactIds: [...selectedArtifactIds], requirementIds: [...selectedRequirementIds], standardIds: [...selectedStandardIds] }, artifacts, requirements), [artifacts, requirements, selectedArtifactIds, selectedRequirementIds, selectedStandardIds]);
  const comparisonBlocked = Boolean(comparisonParentReviewId && (!comparisonParentReview || comparisonLoading || comparisonError));
  const sourceBlocked = !selectedProject || loadingScope || Boolean(scopeError) || !hasScope || selectedCount === 0 || unavailableMembers.length > 0 || Boolean(activeSession) || comparisonBlocked;

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
            ? 'Add project sources or requirements before starting this review.'
            : selectedCount === 0
              ? 'Select at least one repository, document, requirement, or standard for this review.'
              : unavailableMembers.length > 0
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

  const handleCreateReview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!selectedProject) return setFormError('Choose a project before starting a review.');
    if (!reviewName.trim()) return setFormError('Review name is required.');
    if (!objective.trim()) return setFormError('Review objective is required.');
    if (objective.trim().length > MAX_OBJECTIVE_LENGTH) return setFormError(`Review objective must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`);
    if (sourceBlocked) return setFormError(blockingReason || 'Select valid project scope before starting this review.');
    if (baseRef.trim() && !headRef.trim()) return setFormError('Add a head branch or commit when a base ref is supplied.');
    if (headRef.trim() && !baseRef.trim()) return setFormError('Add a base branch or commit when a head ref is supplied.');

    const artifactIds = [...selectedArtifactIds];
    const standardIds = [...selectedStandardIds];
    const requirementIds = [...selectedRequirementIds];
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
      idempotencyKey: idempotencyKey.current,
      ...(comparisonParentReview && comparisonParentReview.id === comparisonParentReviewId
        ? { comparisonParentReviewId: comparisonParentReview.id }
        : {}),
    };
    setSubmitting(true);
    try {
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
      {selectedProject && !comparisonParentReviewId && <RecentReviews projectId={selectedProject.id} onNavigate={onNavigate} />}

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
              <Select id="review-entry-project" aria-label="Project" value={selectedProjectId} onChange={handleProjectSelection} disabled={projects.length === 0} placeholder={projects.length === 0 ? 'No projects available' : 'Select a project'} options={projects.map(project => ({ value: project.id, label: project.name }))} />
              <button type="button" className="btn-secondary review-create-project-button" onClick={() => setShowProjectModal(true)}><Plus size={15} aria-hidden="true" /> Create project</button>
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
        </section>

        <section className="review-form-section review-entry-scope" aria-labelledby="review-entry-scope-heading">
          <div className="review-form-section-heading review-scope-heading">
            <div><h2 id="review-entry-scope-heading">Select sources</h2><p className="review-scope-summary">{selectionSummary || 'No inputs selected'}</p></div>
          </div>
          {loadingScope && <p className="review-scope-status" role="status"><RotateCcw size={15} aria-hidden="true" /> Checking project scope…</p>}
          {scopeError && <div className="review-scope-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><div><strong>Project sources are unavailable</strong><p>{scopeError}</p><button type="button" className="btn-link" onClick={() => void loadScope()}>Retry</button></div></div>}
          {!loadingScope && !scopeError && !hasScope && <div className="review-scope-empty-state"><FileCheck2 size={22} aria-hidden="true" /><div><strong>No sources or requirements found</strong><p>Add project materials before starting a Review.</p><button type="button" className="btn-secondary" onClick={() => selectedProject && onNavigate({ name: 'project-detail', projectId: selectedProject.id, initialSection: 'source' })}>Open project sources</button></div></div>}
          {!loadingScope && !scopeError && hasScope && <div className="review-scope-groups">
            {renderRepositories()}
            {renderScopeItems(groups.documents, 'Attached documents', 'No active documents are available.')}
            {renderScopeItems(requirementsScope, 'Requirements', 'No confirmed requirements yet, so traceability will be limited.', selectedProject ? <button type="button" className="btn-link" onClick={() => onNavigate({ name: 'requirements', projectId: selectedProject.id })}>Add or confirm requirements</button> : undefined)}
            {renderScopeItems(groups.standards, 'Coding standards', 'No coding standards are available.')}
            {unavailableMembers.length > 0 && <fieldset className="review-scope-group review-unavailable-group"><legend>Unavailable saved inputs</legend><p>These exact inputs were saved with the comparison Review but are not available in this project now.</p><div className="review-scope-list">{unavailableMembers.map(member => <label key={`${member.kind}-${member.id}`} className="review-scope-item is-selected"><input type="checkbox" checked onChange={() => removeUnavailableMember(member)} /><span className="review-scope-check" aria-hidden="true"><Check size={13} strokeWidth={2.2} /></span><span className="review-scope-item-copy"><strong>{member.kind}</strong><small>{member.id} · remove from this Review</small></span></label>)}</div></fieldset>}
          </div>}
        </section>

        <section className="review-form-section review-entry-advanced">
          <button type="button" className="review-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}><span><ChevronDown size={16} aria-hidden="true" /> Advanced scope</span><small>Optional branch or pull request context</small></button>
          {advancedOpen && <div className="review-advanced-fields">
            <p className="review-advanced-help">Leave these fields blank to review the selected project scope. If you provide a branch range, both refs are required.</p>
            <div className="review-advanced-grid">
              <div className="form-field"><label htmlFor="review-entry-base-ref"><GitBranch size={14} aria-hidden="true" /> Base branch or commit</label><input id="review-entry-base-ref" value={baseRef} onChange={event => setBaseRef(event.target.value)} placeholder="main" /></div>
              <div className="form-field"><label htmlFor="review-entry-head-ref"><GitBranch size={14} aria-hidden="true" /> Head branch or commit</label><input id="review-entry-head-ref" value={headRef} onChange={event => setHeadRef(event.target.value)} placeholder="feature/checkout" /></div>
              <div className="form-field review-pull-request-field"><label htmlFor="review-entry-pull-request"><GitBranch size={14} aria-hidden="true" /> Pull request reference <span className="field-optional">Optional</span></label><input id="review-entry-pull-request" value={pullRequest} onChange={event => setPullRequest(event.target.value)} placeholder="#123 or URL" /></div>
            </div>
          </div>}
        </section>

        {providerReady === false && <div className="review-entry-error review-entry-provider" role="alert"><AlertCircle size={16} aria-hidden="true" /> <span>The Model Provider for Review is not ready. Connect Codex or save an API provider and model in Settings, then come back to start this review.</span><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'settings' })}>Open Settings</button></div>}
        {formError && <div ref={errorRef} className="review-entry-error" role="alert" tabIndex={-1}><AlertCircle size={16} aria-hidden="true" /> <span>{formError}</span></div>}
        {blockingReason && <p className="review-entry-submit-hint" role="status">{blockingReason}</p>}
        <div className="review-entry-actions"><button type="submit" className="btn-primary review-entry-submit" disabled={submitting || sourceBlocked || providerReady === false}>{submitting ? 'Starting review…' : 'Start review'}</button><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'dashboard' })} disabled={submitting}>Cancel</button></div>
      </form>

      <ProjectCreateModal isOpen={showProjectModal} onClose={() => setShowProjectModal(false)} onCreate={onCreateProject} onCreated={handleProjectCreated} />
    </div>
  );
}
