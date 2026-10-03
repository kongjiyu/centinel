import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, CircleHelp, FileCheck2, FolderOpen, GitBranch, Plus, RotateCcw } from 'lucide-react';
import { api, type CreateStaticSessionPayload } from '../api/client';
import { CommandPageHeader } from '../components/CommandUI';
import { ProjectCreateModal, type ProjectCreateSource } from '../components/ProjectCreateModal';
import { Select } from '../components/Select';
import { userFacingError } from '../utils/userFacingError';
import type { Artifact, Project, Requirement, Screen, StaticSession } from '../types';
import './ReviewEntryScreen.css';

type Props = {
  projects: Project[];
  initialProjectId?: string;
  onNavigate: (screen: Screen) => void;
  onCreateProject: (name: string, description: string, workspacePath: string, source: ProjectCreateSource) => Promise<Project | void>;
};

type ScopeItem = {
  id: string;
  label: string;
  detail: string;
  kind: 'artifact' | 'requirement' | 'standard';
};

const MAX_OBJECTIVE_LENGTH = 2000;
const CURRENCY_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

function isDeprecated(artifact: Artifact): boolean {
  const record = artifact as Artifact & { status?: string; deprecated?: boolean };
  return record.deprecated === true || record.status?.toLowerCase() === 'deprecated';
}

function isStale(artifact: Artifact): boolean {
  if (artifact.source !== 'documents' && artifact.source !== 'drive') return false;
  const timestamp = Date.parse(artifact.createdAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp > CURRENCY_INTERVAL_MS;
}

function sourceLabel(artifact: Artifact): string {
  const path = artifact.filePath || artifact.originalPath || '';
  return path && path !== artifact.fileName ? `${artifact.fileName} · ${path}` : artifact.fileName;
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

function groupArtifacts(artifacts: Artifact[]): { sources: ScopeItem[]; standards: ScopeItem[] } {
  const sources: ScopeItem[] = [];
  const standards: ScopeItem[] = [];
  artifacts.filter(artifact => !isDeprecated(artifact)).forEach(artifact => {
    const item: ScopeItem = {
      id: artifact.id,
      label: artifact.fileName || artifact.filePath || 'Unnamed source',
      detail: sourceLabel(artifact),
      kind: artifact.type === 'coding_standard' ? 'standard' : 'artifact',
    };
    (item.kind === 'standard' ? standards : sources).push(item);
  });
  return { sources, standards };
}

function requirementItems(requirements: Requirement[]): ScopeItem[] {
  return requirements.map(requirement => ({
    id: requirement.id,
    label: requirement.title || 'Unnamed requirement',
    detail: requirement.category || requirement.description || 'Project requirement',
    kind: 'requirement',
  }));
}

export function ReviewEntryScreen({ projects, initialProjectId, onNavigate, onCreateProject }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || projects[0]?.id || '');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<Set<string>>(new Set());
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<Set<string>>(new Set());
  const [selectedStandardIds, setSelectedStandardIds] = useState<Set<string>>(new Set());
  const [activeSession, setActiveSession] = useState<StaticSession | null>(null);
  const [loadingScope, setLoadingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState('');
  const [objective, setObjective] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [pullRequest, setPullRequest] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const idempotencyKey = useRef<string>(makeIdempotencyKey());

  useEffect(() => {
    if (initialProjectId && projects.some(project => project.id === initialProjectId)) {
      setSelectedProjectId(initialProjectId);
      return;
    }
    if (!projects.some(project => project.id === selectedProjectId)) setSelectedProjectId(projects[0]?.id || '');
  }, [initialProjectId, projects, selectedProjectId]);

  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;

  const loadScope = useCallback(async () => {
    if (!selectedProjectId) {
      setArtifacts([]);
      setRequirements([]);
      setSelectedArtifactIds(new Set());
      setSelectedRequirementIds(new Set());
      setSelectedStandardIds(new Set());
      setActiveSession(null);
      setScopeError(null);
      setLoadingScope(false);
      return;
    }
    setLoadingScope(true);
    setScopeError(null);
    setActiveSession(null);
    try {
      const [nextArtifacts, nextRequirements] = await Promise.all([
        api.listArtifacts(selectedProjectId),
        typeof api.listRequirements === 'function' ? api.listRequirements(selectedProjectId) : Promise.resolve([] as Requirement[]),
      ]);
      const activeArtifacts = nextArtifacts.filter(artifact => !isDeprecated(artifact));
      setArtifacts(activeArtifacts);
      setRequirements(nextRequirements);
      setSelectedArtifactIds(new Set(activeArtifacts.filter(artifact => artifact.type !== 'coding_standard').map(artifact => artifact.id)));
      setSelectedStandardIds(new Set(activeArtifacts.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifact.id)));
      setSelectedRequirementIds(new Set(nextRequirements.map(requirement => requirement.id)));

      // This check is advisory. A sidecar that has not implemented the list
      // endpoint yet must not turn otherwise valid source context into a fake
      // source failure; the create route remains the final authority.
      if (typeof api.listActiveStaticSessions === 'function') {
        try {
          const active = await api.listActiveStaticSessions();
          setActiveSession(active.find(session => session.projectId === selectedProjectId) ?? null);
        } catch {
          setActiveSession(null);
        }
      }
    } catch (cause) {
      setArtifacts([]);
      setRequirements([]);
      setSelectedArtifactIds(new Set());
      setSelectedRequirementIds(new Set());
      setSelectedStandardIds(new Set());
      setScopeError(userFacingError(cause, 'Project scope could not be loaded.'));
    } finally {
      setLoadingScope(false);
    }
  }, [selectedProjectId]);

  useEffect(() => { void loadScope(); }, [loadScope]);
  useEffect(() => { if (formError) errorRef.current?.focus(); }, [formError]);

  const groups = useMemo(() => groupArtifacts(artifacts), [artifacts]);
  const requirementsScope = useMemo(() => requirementItems(requirements), [requirements]);
  const selectedCount = selectedArtifactIds.size + selectedRequirementIds.size + selectedStandardIds.size;
  const staleSourceCount = useMemo(() => artifacts.filter(isStale).length, [artifacts]);
  const hasScope = artifacts.length > 0 || requirements.length > 0;
  const sourceBlocked = !selectedProject || loadingScope || Boolean(scopeError) || !hasScope || selectedCount === 0 || Boolean(activeSession);

  const blockingReason = !selectedProject
    ? 'Create or select a project before starting this review.'
    : loadingScope
      ? 'Checking the project scope…'
      : scopeError
        ? 'Project scope could not be checked. Retry the scope request before starting.'
        : activeSession
          ? 'A review is already active for this project. Open its activity before starting another review.'
          : !hasScope
            ? 'Add at least one artifact, requirement, or coding standard in the project Source tab before starting this review.'
            : selectedCount === 0
              ? 'Select at least one artifact, requirement, or coding standard for this review.'
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

  const renderScopeItems = (items: ScopeItem[], groupLabel: string, emptyLabel: string) => (
    <fieldset className="review-scope-group">
      <legend>{groupLabel}</legend>
      {items.length === 0 ? <p className="review-scope-empty">{emptyLabel}</p> : <div className="review-scope-list">
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
    };
    setSubmitting(true);
    try {
      const session = await api.createStaticSession(selectedProject.id, payload);
      onNavigate({ name: 'review-activity', projectId: selectedProject.id, sessionId: session.id, reviewName: session.name });
    } catch (cause) {
      setFormError(userFacingError(cause, 'The review could not be started. Check the project sources and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleProjectCreated = (project: Project) => {
    setSelectedProjectId(project.id);
    setShowProjectModal(false);
  };

  return (
    <div className="screen command-review-entry review-entry-screen">
      <CommandPageHeader
        eyebrow="Review workspace"
        title="Start your review"
        description="Choose the project evidence and requirements to examine, then describe the outcome you need from this review."
        onBack={() => onNavigate({ name: 'dashboard' })}
      />

      <form className="review-entry-form" aria-label="Start review" onSubmit={event => { void handleCreateReview(event); }}>
        <section className="review-form-section review-entry-basics" aria-labelledby="review-entry-details-heading">
          <div className="review-form-section-heading"><div><h2 id="review-entry-details-heading">Review details</h2><p>Give this review a name and keep its purpose easy to find in the activity history.</p></div></div>
          <div className="review-entry-field form-field">
            <label htmlFor="review-entry-name">Review name <span className="field-required" aria-hidden="true">*</span></label>
            <input id="review-entry-name" aria-label="Review name" value={reviewName} onChange={event => setReviewName(event.target.value)} maxLength={120} placeholder="For example, Sprint 3 evidence review" required />
          </div>
          <div className="review-entry-field form-field">
            <label htmlFor="review-entry-project">Project <span className="field-required" aria-hidden="true">*</span></label>
            <div className="review-project-row">
              <Select id="review-entry-project" aria-label="Project" value={selectedProjectId} onChange={setSelectedProjectId} disabled={projects.length === 0} placeholder={projects.length === 0 ? 'No projects available' : 'Select a project'} options={projects.map(project => ({ value: project.id, label: project.name }))} />
              <button type="button" className="btn-secondary review-create-project-button" onClick={() => setShowProjectModal(true)}><Plus size={15} aria-hidden="true" /> Create project</button>
            </div>
            {selectedProject && <p className="field-help review-project-context"><FolderOpen size={14} aria-hidden="true" /> {selectedProject.workspacePath || 'Workspace path not supplied'}</p>}
          </div>
        </section>

        <section className="review-form-section review-entry-scope" aria-labelledby="review-entry-scope-heading">
          <div className="review-form-section-heading review-scope-heading"><div><h2 id="review-entry-scope-heading">Review scope</h2><p>Select the current project artifacts, requirements, and coding standards that should be included in the immutable review snapshot.</p></div><span className="review-scope-selection-note">{selectedCount > 0 ? `${selectedCount} selected` : 'No scope selected'}</span></div>
          {loadingScope && <p className="review-scope-status" role="status"><RotateCcw size={15} aria-hidden="true" /> Checking project scope…</p>}
          {scopeError && <div className="review-scope-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><div><strong>Scope could not be loaded</strong><p>{scopeError}</p><button type="button" className="btn-link" onClick={() => void loadScope()}>Retry scope check</button></div></div>}
          {!loadingScope && !scopeError && !hasScope && <div className="review-scope-empty-state"><FileCheck2 size={22} aria-hidden="true" /><div><strong>No project scope is available</strong><p>Add artifacts, requirements, or coding standards from the project Source tab before starting a Review.</p><button type="button" className="btn-secondary" onClick={() => selectedProject && onNavigate({ name: 'project-detail', projectId: selectedProject.id })}>Open project sources</button></div></div>}
          {!loadingScope && !scopeError && hasScope && <div className="review-scope-groups">
            {renderScopeItems(groups.sources, 'Artifacts', 'No active artifacts are available.')}
            {renderScopeItems(requirementsScope, 'Requirements', 'No project requirements are available.')}
            {renderScopeItems(groups.standards, 'Coding standards', 'No coding standards are available.')}
          </div>}
          {staleSourceCount > 0 && <p className="review-scope-currency" role="note"><CircleHelp size={15} aria-hidden="true" /> {staleSourceCount} document source{staleSourceCount === 1 ? '' : 's'} has not been confirmed within the default 90-day currency interval. It remains selectable; the service validates source currency at submission.</p>}
        </section>

        <section className="review-form-section review-entry-objective" aria-labelledby="review-entry-objective-heading">
          <div className="review-form-section-heading"><div><h2 id="review-entry-objective-heading">Objective and instructions</h2><p>Describe what the reviewer should verify. The text is saved with the review and shown in its activity record.</p></div></div>
          <div className="form-field">
            <label htmlFor="review-entry-objective">Review objective <span className="field-required" aria-hidden="true">*</span></label>
            <textarea id="review-entry-objective" aria-label="Review objective" rows={6} value={objective} onChange={event => setObjective(event.target.value)} maxLength={MAX_OBJECTIVE_LENGTH} placeholder="For example, verify that the checkout implementation satisfies the payment and recovery requirements." required />
            <div className="review-objective-footer"><span>Keep instructions focused on the evidence you need.</span><span className="review-character-count">{objective.length}/{MAX_OBJECTIVE_LENGTH}</span></div>
          </div>
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

        {formError && <div ref={errorRef} className="review-entry-error" role="alert" tabIndex={-1}><AlertCircle size={16} aria-hidden="true" /> <span>{formError}</span></div>}
        {blockingReason && <p className="review-entry-submit-hint" role="status">{blockingReason}</p>}
        <div className="review-entry-actions"><button type="submit" className="btn-primary review-entry-submit" disabled={submitting || sourceBlocked}>{submitting ? 'Starting review…' : 'Start review'}</button><button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'dashboard' })} disabled={submitting}>Cancel</button></div>
      </form>

      <ProjectCreateModal isOpen={showProjectModal} onClose={() => setShowProjectModal(false)} onCreate={onCreateProject} onCreated={handleProjectCreated} />
    </div>
  );
}
