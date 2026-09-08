import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, HelpCircle, Plus } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader } from '../components/CommandUI';
import { ProjectCreateModal } from '../components/ProjectCreateModal';
import { StaticReviewForm, type StaticReviewFormData } from '../components/StaticReviewForm';
import { Select } from '../components/Select';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import type { Artifact, Project, Screen, StaticSession } from '../types';
import './ReviewEntryScreen.css';

type Props = {
  projects: Project[];
  initialProjectId?: string;
  onNavigate: (screen: Screen) => void;
  onCreateProject: (name: string, description: string, workspacePath: string) => Promise<Project | void>;
};

const CURRENCY_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

type ContextStatus = 'available' | 'unavailable' | 'unknown';

function isStale(artifact: Artifact): boolean {
  if (artifact.source !== 'documents' && artifact.source !== 'drive') return false;
  const timestamp = Date.parse(artifact.createdAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp > CURRENCY_INTERVAL_MS;
}

function inheritedStatus(
  artifacts: Artifact[],
  types: Artifact['type'][],
  state: 'ready' | 'loading' | 'error' | 'empty',
): ContextStatus {
  if (state === 'loading' || state === 'error') return 'unknown';
  return artifacts.some(artifact => types.includes(artifact.type)) ? 'available' : 'unavailable';
}

function ContextStatusLabel({ status }: { status: ContextStatus }) {
  if (status === 'available') return <span className="review-context-status review-context-status-available"><CheckCircle2 size={14} aria-hidden="true" />Available</span>;
  if (status === 'unknown') return <span className="review-context-status review-context-status-unknown"><HelpCircle size={14} aria-hidden="true" />Could not be checked</span>;
  return <span className="review-context-status review-context-status-unavailable">Not available</span>;
}

function InheritedProjectContext({
  artifacts,
  state,
  projectSelected,
  onOpenSources,
}: {
  artifacts: Artifact[];
  state: 'ready' | 'loading' | 'error' | 'empty';
  projectSelected: boolean;
  onOpenSources: () => void;
}) {
  const status = projectSelected ? state : 'empty';
  const items = [
    { label: 'Repository or source code', types: ['source_code'] as Artifact['type'][] },
    { label: 'Requirements specification', types: ['requirement'] as Artifact['type'][] },
    { label: 'Coding standard', types: ['coding_standard'] as Artifact['type'][] },
    { label: 'Design or supporting documents', types: ['design', 'other'] as Artifact['type'][] },
  ];

  return (
    <section className="review-form-section review-project-context-section" aria-labelledby="inherited-project-context-heading">
      <div className="review-form-section-heading review-project-context-heading">
        <div>
          <h3 id="inherited-project-context-heading">Inherited project context</h3>
          <p>These sources are inherited from the selected project and managed from its Source tab.</p>
        </div>
        {projectSelected && (
          <button type="button" className="review-entry-source-action btn-secondary" onClick={onOpenSources}>
            Open project sources
          </button>
        )}
      </div>
      {!projectSelected ? (
        <p className="review-entry-context-empty">Select a project to check its inherited source context.</p>
      ) : (
        <ul className="review-context-list">
          {items.map(item => (
            <li key={item.label}>
              <span>{item.label}</span>
              <ContextStatusLabel status={inheritedStatus(artifacts, item.types, status)} />
            </li>
          ))}
        </ul>
      )}
      {state === 'error' && <p className="review-entry-source-error" role="alert"><AlertCircle size={15} aria-hidden="true" /> Sources could not be checked. Open the project Source tab and try again.</p>}
      {state === 'empty' && projectSelected && <p className="review-entry-context-empty">No active project sources are available. Add a source in the project Source tab before starting.</p>}
    </section>
  );
}

export function ReviewEntryScreen({ projects, initialProjectId, onNavigate, onCreateProject }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || projects[0]?.id || '');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeSession, setActiveSession] = useState<StaticSession | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const { controls: activeReviewControls } = useActiveReviewState();

  useEffect(() => {
    if (initialProjectId && projects.some(project => project.id === initialProjectId)) {
      setSelectedProjectId(initialProjectId);
      return;
    }
    if (!projects.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id || '');
    }
  }, [initialProjectId, projects, selectedProjectId]);

  const selectedProject = projects.find(project => project.id === selectedProjectId) || null;

  const loadSources = useCallback(async () => {
    if (!selectedProjectId) {
      setArtifacts([]);
      setActiveSession(null);
      setSourceError(null);
      return;
    }
    setLoadingSources(true);
    setSourceError(null);
    setActiveSession(null);
    try {
      setArtifacts(await api.listArtifacts(selectedProjectId));
      // The active-session endpoint is already part of the client contract.
      // Some isolated consumers do not provide it, so the UI treats that as
      // an unavailable optional check rather than inventing a conflict.
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
      setSourceError(`Sources could not be loaded: ${String(cause)}`);
    } finally {
      setLoadingSources(false);
    }
  }, [selectedProjectId]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const staleSourceCount = useMemo(() => artifacts.filter(isStale).length, [artifacts]);
  const sourceState: 'ready' | 'loading' | 'error' | 'empty' = loadingSources
    ? 'loading'
    : sourceError
      ? 'error'
      : artifacts.length === 0
        ? 'empty'
        : 'ready';
  const sourceBlocked = !selectedProject || loadingSources || Boolean(sourceError) || artifacts.length === 0 || Boolean(activeSession);
  const sourceBlockingMessage = !selectedProject
    ? 'Create or select a project before starting this review.'
    : loadingSources
      ? 'Checking the project sources…'
      : sourceError
        ? 'Sources could not be checked. Open the project Source tab, then try again.'
        : activeSession
          ? 'A review is already in progress for this project. Open its activity before starting another review.'
        : artifacts.length === 0
          ? 'Add at least one active source in the project Source tab before starting this review.'
          : undefined;

  const handleCreateReview = async (data: StaticReviewFormData) => {
    if (!selectedProject) throw new Error('Choose a project before starting a review.');
    if (loadingSources) throw new Error('Sources are still loading. Try again in a moment.');
    if (sourceError) throw new Error('Sources could not be checked. Open the project Source tab and try again.');
    if (activeSession) throw new Error('A review is already in progress for this project.');
    if (artifacts.length === 0) throw new Error('Add at least one active source before starting a review.');
    const session = await api.createStaticSession(selectedProject.id, data);
    activeReviewControls.trackSession(session, selectedProject.name);
    onNavigate({ name: 'review-activity', projectId: selectedProject.id, sessionId: session.id });
  };

  const handleProjectCreated = (project: Project) => {
    setSelectedProjectId(project.id);
    setShowProjectModal(false);
  };

  const projectContext = (
    <InheritedProjectContext
      artifacts={artifacts}
      state={sourceState}
      projectSelected={Boolean(selectedProject)}
      onOpenSources={() => selectedProject && onNavigate({ name: 'project-detail', projectId: selectedProject.id })}
    />
  );

  const projectField = (
    <section className="review-form-section review-project-select-section" aria-labelledby="project-context-heading">
      <div className="review-form-section-heading">
        <h3 id="project-context-heading">Project context</h3>
        <p>Choose the project whose active sources this review should inherit.</p>
      </div>
      <div className="review-entry-project-field form-field">
        <label htmlFor="review-entry-project">Project <span className="field-required" aria-hidden="true">*</span></label>
        <Select
          id="review-entry-project"
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          disabled={projects.length === 0}
          placeholder={projects.length === 0 ? 'No projects available' : 'Select a project'}
          options={projects.map(project => ({ value: project.id, label: project.name }))}
        />
        <button type="button" className="review-entry-create-link" onClick={() => setShowProjectModal(true)}>
          <Plus size={14} aria-hidden="true" /> Create project
        </button>
      </div>
      {projectContext}
    </section>
  );

  return (
    <div className="screen command-review-entry review-entry-screen">
      <CommandPageHeader
        eyebrow="Review / New review"
        title="Start review"
        description="Configure the objective, project context, and code scope for this review."
        onBack={() => onNavigate({ name: 'dashboard' })}
      />

      <section className="review-entry-surface" aria-labelledby="new-review-form-title">
        <div className="review-entry-heading">
          <div>
            <span className="command-eyebrow">Review setup</span>
            <h2 id="new-review-form-title">Start with a clear objective</h2>
            <p>Centinel reviews the selected project&apos;s active sources without asking you to upload them here.</p>
          </div>
          <FileText size={20} aria-hidden="true" />
        </div>

        <StaticReviewForm
          projectId={selectedProject?.id ?? ''}
          onSubmit={handleCreateReview}
          onCancel={() => onNavigate({ name: 'dashboard' })}
          staleSourceCount={staleSourceCount}
          submitDisabled={sourceBlocked}
          submitDisabledReason={sourceBlockingMessage}
          beforeObjective={projectField}
        />
      </section>

      <ProjectCreateModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onCreate={onCreateProject}
        onCreated={handleProjectCreated}
      />
    </div>
  );
}
