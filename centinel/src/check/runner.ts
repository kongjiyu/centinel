import { api, type CreateStaticSessionPayload } from '../api/client';
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

function newId(): string {
  try { if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID(); } catch { /* fall through */ }
  return `check-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const repositoryName = input.githubUrl ? githubRepositoryName(input.githubUrl) : null;
  const projectName = input.folder ? folderName(input.folder) : repositoryName ?? 'Project';
  const check: CheckRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    projectName,
    ...(input.folder ? { folder: input.folder } : {}),
    ...(input.githubUrl ? { githubUrl: input.githubUrl.trim() } : {}),
    documents: input.documents.map(document => document.name),
    focus: input.focus.trim(),
    mode: input.mode,
    phase: 'preparing',
    prepStep: 'project',
    notes: [],
  };
  saveCheck(check);
  void prepare(check.id, input, deps);
  return check;
}

async function prepare(checkId: string, input: StartCheckInput, deps: RunnerDeps) {
  const { api } = deps;
  const note = (text: string) => updateCheck(checkId, { notes: [...(getCheck(checkId)?.notes ?? []), text] });
  try {
    // 1. Project: reuse the project for this folder, or create it.
    let project: Project | undefined;
    if (input.folder) {
      const folder = normalizePath(input.folder);
      project = deps.projects().find(item => item.workspacePath && normalizePath(item.workspacePath) === folder);
      if (project) {
        // Refresh the saved copy so the Review sees the folder as it is now.
        const refreshed = await api.importRepoArtifacts(project.id, input.folder);
        if (refreshed.skipped.length) note(`${refreshed.skipped.length} files in the folder were skipped (unsupported type or too large).`);
      } else {
        const created = await api.createProject(folderName(input.folder), '', '', [{ type: 'local-repository', path: input.folder }]);
        project = created;
        deps.onProjectCreated?.(created);
        for (const warning of created.sourceImportWarnings ?? []) note(warning);
      }
    } else if (input.githubUrl) {
      const name = githubRepositoryName(input.githubUrl) ?? 'GitHub project';
      const created = await api.createProject(name.split('/').pop() ?? name, '', '', [{ type: 'github', repoUrl: input.githubUrl.trim() }]);
      project = created;
      deps.onProjectCreated?.(created);
      for (const warning of created.sourceImportWarnings ?? []) note(warning);
    }
    if (!project) throw new Error('Add a project folder or a GitHub link to start.');
    updateCheck(checkId, { projectId: project.id, projectName: project.name, prepStep: 'documents' });

    // 2. Documents.
    for (const document of input.documents) await uploadDocument(api, project.id, document);

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
      const review = await startReview(api, project.id, project.name, input.focus.trim());
      updateCheck(checkId, { reviewId: review.id });
    }

    // 5. Browser tests need the app on this computer.
    if (wantsBrowser) {
      if (!input.folder) {
        note('Browser tests did not run: they need a project folder on this computer. A GitHub link can only be reviewed.');
      } else {
        updateCheck(checkId, { prepStep: 'browser' });
        try {
          // Tests saved for every check in the project conversation run alongside the newly planned ones.
          const pinned = readPrefs(project.id).pinned.map(({ sessionId, testId }) => ({ sessionId, testId }));
          const session = await api.startAutoTest(project.id, { folder: input.folder, ...(pinned.length ? { pinned } : {}) });
          updateCheck(checkId, { autoTestId: session.id });
        } catch (cause) {
          note(`Browser tests did not start: ${userFacingError(cause, 'the browser test service was not available.')}`);
        }
      }
    }

    const current = getCheck(checkId);
    if (!current?.reviewId && !current?.autoTestId) throw new Error(current?.notes[current.notes.length - 1] ?? 'Nothing could be started for this check.');
    updateCheck(checkId, { phase: 'running', prepStep: undefined });
  } catch (cause) {
    updateCheck(checkId, { phase: 'failed', error: userFacingError(cause, 'The check could not start. Try again.'), finishedAt: new Date().toISOString() });
  }
}

async function uploadDocument(api: Api, projectId: string, document: CheckDocument) {
  await api.uploadArtifact(projectId, { fileName: document.name, content: document.base64, type: documentType(document.name) });
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

async function startReview(api: Api, projectId: string, projectName: string, focus: string) {
  const [artifacts, requirements] = await Promise.all([
    api.listArtifacts(projectId),
    typeof api.listRequirements === 'function' ? api.listRequirements(projectId).catch(() => []) : Promise.resolve([]),
  ]);
  const active = artifacts.filter(artifact => !isDeprecated(artifact));
  if (!active.length) throw new Error('No readable files were found in the project, so nothing could be reviewed.');
  const artifactIds = active.filter(artifact => artifact.type !== 'coding_standard').map(artifact => artifact.id);
  const standardIds = active.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifact.id);
  const requirementIds = requirements.map(requirement => requirement.id);
  const payload: CreateStaticSessionPayload = {
    name: `Check · ${projectName}`,
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
    scopeMode: 'full',
    idempotencyKey: newId(),
  };
  return api.createStaticSession(projectId, payload);
}
