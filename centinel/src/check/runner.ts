import { api, type CreateStaticSessionPayload } from '../api/client';
import { projectLocalFolder } from './projectWorkspace';
import type { Artifact, ArtifactType, Project } from '../types';
import { userFacingError } from '../utils/userFacingError';
import { readPrefs } from './projectPrefs';
import { getCheck, saveCheck, updateCheck } from './store';
import type { CheckDocument, CheckRecord, StartCheckInput } from './types';

/**
 * Starts a Check from the Start screen: finds or creates the project, adds the
 * documents, then starts the existing Review and Auto test flows. It runs outside
 * any component so leaving the Live screen does not stop it. Every step uses the
 * existing service APIs; nothing here produces a result on its own.
 */

type Api = typeof api;
const GITHUB_IMPORT_TIMEOUT_MS = 10 * 60_000;
const LOCAL_IMPORT_REASONS: Record<string, string> = {
  file_limit: 'the repository import reached its file limit',
  file_too_large: 'the file exceeds the import size limit',
  file_unreadable: 'ORIN could not read the file',
  storage_upload_failed: 'the file could not be uploaded to project storage',
  version_commit_failed: 'the file version could not be recorded',
  artifact_save_failed: 'the file could not be saved to the project',
};

function newId(): string {
  try { if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID(); } catch { /* fall through */ }
  return `check-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Names the skipped files (up to three) so the person can tell whether they matter. */
export function skippedNote(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  const more = paths.length > 3 ? ` and ${paths.length - 3} more` : '';
  return `${paths.length === 1 ? '1 file in the folder was' : `${paths.length} files in the folder were`} not reviewed (unsupported type or too large): ${shown}${more}.`;
}

export function folderName(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

export function githubRepositoryName(url: string): string | null {
  const match = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** A document name decides only the source type label; it never changes what is checked. */
export function documentType(name: string): ArtifactType {
  const lower = name.toLowerCase();
  if (/requirement|\breq\b|\bprd\b|user[-_ ]?stor|spec/.test(lower)) return 'requirement';
  if (/standard|guideline|style|convention|lint/.test(lower)) return 'coding_standard';
  if (/design|architecture|\badr\b/.test(lower)) return 'design';
  return 'other';
}

function isDeprecated(artifact: Artifact): boolean {
  const record = artifact as Artifact & { status?: string; deprecated?: boolean };
  return artifact.currency?.deprecated === true || record.deprecated === true || record.status?.toLowerCase() === 'deprecated';
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type RunnerDeps = {
  api: Api;
  projects: () => Project[];
  onProjectCreated?: (project: Project) => void;
  now?: () => Date;
};

export function startCheck(input: StartCheckInput, deps: RunnerDeps): CheckRecord {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const selectedProject = input.projectId ? deps.projects().find(project => project.id === input.projectId) : undefined;
  const folder = projectLocalFolder(selectedProject) || input.folder;
  const repositoryName = input.githubUrl ? githubRepositoryName(input.githubUrl) : null;
  const projectName = selectedProject?.name ?? (folder ? folderName(folder) : repositoryName ?? 'Project');
  const check: CheckRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    projectName,
    ...(selectedProject ? { projectId: selectedProject.id } : {}),
    ...(input.referenceCheckIds?.length ? { referenceCheckIds: input.referenceCheckIds } : {}),
    ...(input.sourceArtifactIds?.length ? { sourceArtifactIds: input.sourceArtifactIds } : {}),
    ...(folder ? { folder } : {}),
    ...(input.githubUrl ? { githubUrl: input.githubUrl.trim() } : {}),
    documents: input.documents.map(document => document.name),
    focus: input.focus.trim(),
    mode: input.mode,
    phase: 'preparing',
    prepStep: 'project',
    notes: [],
  };
  saveCheck(check);
  void prepare(check.id, { ...input, folder }, deps, selectedProject);
  return check;
}

async function prepare(checkId: string, input: StartCheckInput, deps: RunnerDeps, selectedProject?: Project) {
  const { api } = deps;
  let titleProjectId: string | undefined;
  const note = (text: string) => updateCheck(checkId, { notes: [...(getCheck(checkId)?.notes ?? []), text] });
  try {
    if (input.mode === 'browser' && input.sourceArtifactIds?.length) {
      throw new Error('Library files need a code review. Choose Code or Code and browser.');
    }
    if (input.referenceCheckIds?.some(id => !selectedProject || getCheck(id)?.projectId !== selectedProject.id)) {
      throw new Error('An attached check is no longer available for this project. Select it again.');
    }
    // 1. Project: reuse the project for this folder, or create it.
    let project = selectedProject;
    if (input.projectId && !project) throw new Error('This project is no longer available. Choose another project.');
    if (input.folder) {
      const folder = normalizePath(input.folder);
      project ??= deps.projects().find(item => {
        const localFolder = projectLocalFolder(item);
        return localFolder && normalizePath(localFolder) === folder;
      });
      if (project) {
        // Refresh the saved copy so the Review sees the folder as it is now.
        if (input.mode !== 'browser') {
          const refreshed = await api.importRepoArtifacts(project.id, input.folder);
          if (refreshed.complete === false) {
            const failures = refreshed.failures ?? [];
            if (!failures.length) note('The local file inventory could not be completed.');
            for (const { filePath, reason } of failures.slice(0, 5)) {
              const description = LOCAL_IMPORT_REASONS[reason] ?? LOCAL_IMPORT_REASONS.artifact_save_failed;
              note(`${filePath}: ${description}.`);
            }
            if (failures.length > 5) note(`${failures.length - 5} more source files could not be imported.`);
          } else if (refreshed.complete === undefined && refreshed.skipped.length) {
            note(skippedNote(refreshed.skipped));
          }
        }
      } else {
        const created = await api.createProject(folderName(input.folder), '', '', [{ type: 'local-repository', path: input.folder }]);
        project = created;
        deps.onProjectCreated?.(created);
        for (const warning of created.sourceImportWarnings ?? []) note(warning);
      }
    } else if (!project && input.githubUrl) {
      const name = githubRepositoryName(input.githubUrl) ?? 'GitHub project';
      const created = await api.createProject(name.split('/').pop() ?? name, '', '', [{ type: 'github', repoUrl: input.githubUrl.trim() }]);
      project = created;
      deps.onProjectCreated?.(created);
      for (const warning of created.sourceImportWarnings ?? []) note(warning);
    }
    if (!project) throw new Error('Add a project folder or a GitHub link to start.');
    updateCheck(checkId, { projectId: project.id, projectName: project.name, prepStep: 'documents' });
    titleProjectId = project.id;

    // 2. Documents.
    const uploadedIds: string[] = [];
    for (const document of input.documents) {
      uploadedIds.push(document.saved?.projectId === project.id ? document.saved.artifactId : (await uploadDocument(api, project.id, document)).id);
    }

    // 3. GitHub import finishes in the background; wait for it before reviewing.
    if (input.githubUrl && !input.folder) {
      updateCheck(checkId, { prepStep: 'github' });
      await waitForGithubImport(api, project.id);
    }

    // 4. Code review.
    const wantsCode = input.mode !== 'browser';
    const wantsBrowser = input.mode !== 'code';
    if (wantsCode) {
      updateCheck(checkId, { prepStep: 'review' });
      const focus = input.focus.trim();
      const review = await startReview(api, project.id, project.name, focus, input.sourceArtifactIds, uploadedIds);
      updateCheck(checkId, { reviewId: review.id });
    }

    // 5. Browser tests need the app on this computer.
    if (wantsBrowser) {
      if (!input.folder) {
        note('Browser tests did not run: they need a project folder on this computer. A GitHub link can only be reviewed.');
      } else {
        updateCheck(checkId, { prepStep: 'browser' });
        try {
          const request = input.browserRequest?.trim();
          const session = await api.startAutoTest(project.id, { folder: input.folder, startupPermission: input.startupPermission ?? readPrefs(project.id).mode,
            ...(request ? { request } : {}) });
          updateCheck(checkId, { autoTestId: session.id });
        } catch (cause) {
          note(`Browser tests did not start: ${userFacingError(cause, 'the browser test service was not available.')}`);
        }
      }
    }

    const current = getCheck(checkId);
    if (!current?.reviewId && !current?.autoTestId) throw new Error(current?.notes[current.notes.length - 1] ?? 'Nothing could be started for this check.');
    updateCheck(checkId, { phase: 'running', prepStep: undefined,
      ...(input.mode === 'both' && !current.autoTestId ? { mode: 'code', requestedMode: 'both' } : {}) });
  } catch (cause) {
    updateCheck(checkId, { phase: 'failed', error: userFacingError(cause, 'The check could not start. Try again.'), finishedAt: new Date().toISOString() });
  } finally {
    if (titleProjectId && typeof api.generateCheckTitle === 'function') {
      const projectId = titleProjectId;
      void api.generateCheckTitle(projectId, { focus: input.focus.trim(), mode: input.mode, documents: input.documents.slice(0, 8).map(document => folderName(document.name).slice(0, 100)) })
        .then(({ title }) => {
          if (title && getCheck(checkId)?.projectId === projectId) updateCheck(checkId, { title });
        })
        .catch(() => undefined);
    }
  }
}

async function uploadDocument(api: Api, projectId: string, document: CheckDocument) {
  return api.uploadArtifact(projectId, { fileName: document.name, content: document.base64, type: documentType(folderName(document.name)) });
}

export async function saveCheckDocuments(api: Api, projectId: string, documents: CheckDocument[]) {
  const failed: string[] = [];
  const saved: CheckDocument[] = [];
  for (const document of documents) {
    try {
      const artifact = await uploadDocument(api, projectId, document);
      saved.push({ ...document, saved: { projectId, artifactId: artifact.id } });
    } catch {
      failed.push(document.name);
      saved.push(document);
    }
  }
  return { documents: saved, failed };
}

async function waitForGithubImport(api: Api, projectId: string) {
  const deadline = Date.now() + GITHUB_IMPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const sources = await api.listConnectedSources(projectId).catch(() => []);
    const github = sources.filter(source => source.provider === 'github');
    if (github.some(source => source.syncStatus === 'error')) throw new Error('The GitHub repository could not be imported. Check that your GitHub account can read it.');
    if (github.length && github.every(source => source.syncStatus === 'ready')) return;
    await sleep(3000);
  }
  throw new Error('The GitHub repository is still importing. Open the project under Details to follow it, then start the check again.');
}

async function startReview(api: Api, projectId: string, name: string, focus: string, sources: string[] = [], uploadedIds: string[] = []) {
  const [artifacts, requirements] = await Promise.all([
    api.listArtifacts(projectId),
    typeof api.listRequirements === 'function' ? api.listRequirements(projectId).catch(() => []) : Promise.resolve([]),
  ]);
  const active = artifacts.filter(artifact => !isDeprecated(artifact));
  if (!active.length) throw new Error('No readable files were found in the project, so nothing could be reviewed.');
  const selected = new Set([...sources, ...uploadedIds]);
  const available = new Set(active.map(artifact => artifact.id));
  if (sources.some(id => !available.has(id))) throw new Error('An attached source is no longer available. Select it again from the library.');
  const files = active.filter(artifact => artifact.type !== 'coding_standard');
  const focused = sources.length > 0;
  const artifactIds = (focused ? files.filter(artifact => selected.has(artifact.id)) : files).map(artifact => artifact.id);
  if (focused && !artifactIds.length) throw new Error('Attach at least one source file or document alongside coding standards.');
  const standardIds = active.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifact.id);
  const requirementIds = requirements.map(requirement => requirement.id);
  const payload: CreateStaticSessionPayload = {
    name,
    instructions: focus,
    reviewMode: 'regular',
    reviewer: 'Project owner',
    scope: { artifactIds, requirementIds, standardIds },
    artifactIds,
    requirementIds,
    standardIds,
    selectedArtifactIds: artifactIds,
    selectedRequirementIds: requirementIds,
    selectedStandardIds: standardIds,
    scopeMode: focused ? 'focused' : 'full',
    idempotencyKey: newId(),
  };
  return api.createStaticSession(projectId, payload);
}
