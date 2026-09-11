import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleX, Plus } from 'lucide-react';
import { api } from '../api/client';
import { CommandPageHeader } from '../components/CommandUI';
import { ProjectCreateModal, type ProjectCreateSource } from '../components/ProjectCreateModal';
import { StaticReviewForm, type StaticReviewFormData } from '../components/StaticReviewForm';
import { Select } from '../components/Select';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import type { Artifact, Project, Screen, StaticSession } from '../types';
import { userFacingError } from '../utils/userFacingError';
import './ReviewEntryScreen.css';

type Props = {
  projects: Project[];
  initialProjectId?: string;
  onNavigate: (screen: Screen) => void;
  onCreateProject: (name: string, description: string, workspacePath: string, source: ProjectCreateSource) => Promise<Project | void>;
};

const CURRENCY_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

function isStale(artifact: Artifact): boolean {
  if (artifact.source !== 'documents' && artifact.source !== 'drive') return false;
  const timestamp = Date.parse(artifact.createdAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp > CURRENCY_INTERVAL_MS;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function ReviewEntryScreen({ projects, initialProjectId, onNavigate, onCreateProject }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || projects[0]?.id || '');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeSession, setActiveSession] = useState<StaticSession | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [reviewDocuments, setReviewDocuments] = useState<File[]>([]);
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
      setSourceError(`Sources could not be loaded. ${userFacingError(cause, 'Try again.')}`);
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
  const sourceBlocked = !selectedProject || loadingSources || Boolean(sourceError) || (artifacts.length === 0 && reviewDocuments.length === 0) || Boolean(activeSession);
  const sourceBlockingMessage = !selectedProject
    ? 'Create or select a project before starting this review.'
    : loadingSources
      ? 'Checking the project sources…'
      : sourceError
        ? 'Sources could not be checked. Open the project Source tab, then try again.'
        : activeSession
          ? 'A review is already in progress for this project. Open its activity before starting another review.'
        : artifacts.length === 0 && reviewDocuments.length === 0
          ? 'Add at least one active source in the project Source tab before starting this review.'
          : undefined;

  const handleCreateReview = async (data: StaticReviewFormData) => {
    if (!selectedProject) throw new Error('Choose a project before starting a review.');
    if (loadingSources) throw new Error('Sources are still loading. Try again in a moment.');
    if (sourceError) throw new Error('Sources could not be checked. Open the project Source tab and try again.');
    if (activeSession) throw new Error('A review is already in progress for this project.');
    if (artifacts.length === 0 && reviewDocuments.length === 0) throw new Error('Add at least one active source before starting a review.');
    const uploaded = [] as Artifact[];
    try {
      for (const file of reviewDocuments) {
        uploaded.push(await api.uploadArtifact(selectedProject.id, { fileName: file.name, content: await fileToBase64(file) }));
      }
      const session = await api.createStaticSession(selectedProject.id, {
        ...data,
        temporaryArtifactIds: uploaded.length > 0
          ? uploaded.map(artifact => artifact.id)
          : undefined,
        supportiveDocuments: reviewDocuments.length > 0
          ? reviewDocuments.map((file, index) => ({ id: uploaded[index]?.id, name: file.name }))
          : undefined,
      });
      activeReviewControls.trackSession(session, selectedProject.name);
      onNavigate({ name: 'review-activity', projectId: selectedProject.id, sessionId: session.id, reviewName: session.name });
    } catch (cause) {
      await Promise.allSettled(uploaded.map(artifact => api.deleteArtifact(selectedProject.id, artifact.id)));
      throw cause;
    }
  };

  const handleProjectCreated = (project: Project) => {
    setSelectedProjectId(project.id);
    setShowProjectModal(false);
  };

  const projectField = (
    <section className="review-form-section review-project-select-section" aria-labelledby="project-context-heading">
      <div className="review-form-section-heading">
        <h3 id="project-context-heading">Project context</h3>
        <p>Choose the project whose active sources this review should inherit.</p>
      </div>
      <div className="review-entry-project-field form-field">
        <label htmlFor="review-entry-project">Project <span className="field-required" aria-hidden="true">*</span></label>
        <div className="review-project-selection-row"><Select
            id="review-entry-project"
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            disabled={projects.length === 0}
            placeholder={projects.length === 0 ? 'No projects available' : 'Select a project'}
            options={projects.map(project => ({ value: project.id, label: project.name }))}
          />
          <p className={`review-project-source-status${selectedProject && sourceState === 'ready' && artifacts.length > 0 ? ' is-complete' : ' is-insufficient'}`} role="status">
            {selectedProject && sourceState === 'ready' && artifacts.length > 0 ? <><CheckCircle2 size={16} aria-hidden="true" />Complete source</> : <><CircleX size={16} aria-hidden="true" />Insufficient source</>}
          </p>
        </div>
        <button type="button" className="review-entry-create-link" onClick={() => setShowProjectModal(true)}>
          <Plus size={14} aria-hidden="true" /> Create project
        </button>
      </div>
    </section>
  );

  const supportiveDocuments = (
    <div className="review-document-source form-field">
      <label htmlFor="review-document-source">Supportive Documents (Optional)</label>
      <input id="review-document-source" type="file" multiple accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp" onChange={event => setReviewDocuments(Array.from(event.target.files ?? []))} />
    </div>
  );

  return (
    <div className="screen command-review-entry review-entry-screen">
      <CommandPageHeader
        eyebrow="Review workspace"
        title="Start your review"
        description="Configure the objective, project context, and review scope."
      />

      <StaticReviewForm
        projectId={selectedProject?.id ?? ''}
        onSubmit={handleCreateReview}
        onCancel={() => onNavigate({ name: 'dashboard' })}
        staleSourceCount={staleSourceCount}
        submitDisabled={sourceBlocked}
        submitDisabledReason={sourceBlockingMessage}
        projectContext={projectField}
        supportiveDocuments={supportiveDocuments}
      />

      <ProjectCreateModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onCreate={onCreateProject}
        onCreated={handleProjectCreated}
      />
    </div>
  );
}
