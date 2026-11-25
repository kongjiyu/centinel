import { DynamicContractError } from '../dynamic/types.js';
import type { LocalWorkspace } from './localWorkspace.js';
import { toClientStaticSession } from '../review/sessionPresentation.js';
import { presentFrozenReviewSource } from '../review/frozenSourceContent.js';
import { isPublicReviewHarnessEvent } from '../review/harnessEvents.js';
import { REVIEW_HARNESS } from '../review/harness.js';
import { analysisMapFromEvents } from '../review/assessmentBatches.js';
import type { LocalReviewRuntime } from '../review/localReviewRuntime.js';
import { isAssessmentHeld } from '../review/assessmentHold.js';
import { createLocalProject, importLocalProjectRepository, resolveLocalWorkspaceFolder } from './localProjectSources.js';
import { uploadLocalDocument } from './localDocuments.js';
import { loadLocalProjectAssessment, loadLocalProjectFindings } from '../review/localProjectFindings.js';

export async function handleLocalWorkspaceRoute(workspace: LocalWorkspace, owner: string,
  method: string | undefined, url: URL, readBody: () => Promise<Record<string, unknown>>,
  getReviewRuntime: () => Promise<LocalReviewRuntime>, notifyReadiness: (project: string, trigger: string) => void,
  github: Parameters<typeof createLocalProject>[3]) {
  const [, , projectId, ...segments] = url.pathname.split('/');
  if (method === 'GET' && url.pathname === '/projects') {
    return { status: 200, body: await Promise.all(workspace.projects(owner).map(project => workspace.projectWorkspace(owner, project))) };
  }
  if (method === 'POST' && url.pathname === '/projects') {
    const project = await createLocalProject(workspace, owner, await readBody(), github);
    notifyReadiness(project.id, 'project_created');
    return { status: 201, body: await workspace.projectWorkspace(owner, project) };
  }
  if (!projectId) throw new DynamicContractError(503, 'This operation is unavailable in the local workspace pilot.');
  const project = workspace.project(owner, projectId);
  if (!project) throw new DynamicContractError(404, 'Project not found on this device.');
  if (method === 'POST' && segments.length === 2 && segments[0] === 'artifacts' && segments[1] === 'import-repo') {
    const { repoPath } = await readBody();
    const imported = await importLocalProjectRepository(workspace, owner, project, repoPath);
    notifyReadiness(projectId, 'repository_imported');
    return { status: 200, body: imported };
  }
  if (segments[0] === 'artifacts' && method === 'POST' && segments.length === 1) {
    const body = await readBody();
    const document = uploadLocalDocument(workspace, owner, project, body);
    if (body.reviewReference !== true) notifyReadiness(projectId, 'document_uploaded');
    return { status: 201, body: document };
  }
  if (segments[0] === 'artifacts' && method === 'DELETE' && segments.length === 2) {
    if (!workspace.removeCurrentArtifact(owner, projectId, segments[1])) throw new DynamicContractError(404, 'Artifact not found on this device.');
    notifyReadiness(projectId, 'source_removed');
    return { status: 200, body: { ok: true } };
  }
  if (segments[0] === 'artifacts' && method === 'POST' && segments.length === 3 && segments[2] === 'currency') {
    const { action } = await readBody();
    if (action !== 'confirm' && action !== 'deprecate' && action !== 'restore') throw new DynamicContractError(400, 'Choose confirm, deprecate or restore.');
    const currency = workspace.setArtifactCurrency(owner, projectId, segments[1], action);
    if (!currency) throw new DynamicContractError(404, 'Artifact not found on this device.');
    if (action !== 'confirm') notifyReadiness(projectId, 'source_changed');
    return { status: 200, body: currency };
  }
  if (segments[0] === 'findings' && method === 'PUT' && segments.length === 2) {
    const { status } = await readBody();
    if (status !== 'new' && status !== 'accepted' && status !== 'dismissed' && status !== 'fixed') {
      throw new DynamicContractError(400, 'Choose a valid finding status.');
    }
    if (!workspace.reviews(owner).updateFindingStatus(projectId, segments[1], status)) {
      throw new DynamicContractError(404, 'Finding not found on this device.');
    }
    return { status: 200, body: { ok: true } };
  }
  if (method === 'PUT' && !segments.length) {
    const body = await readBody();
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    if (name !== undefined && (!name || name.length > 80)) throw new DynamicContractError(400, 'Project name must be between 1 and 80 characters.');
    if (description !== undefined && description.length > 500) throw new DynamicContractError(400, 'Description must be 500 characters or less.');
    const workspacePath = body.workspacePath === undefined ? undefined : await resolveLocalWorkspaceFolder(body.workspacePath);
    if (name === undefined && description === undefined && workspacePath === undefined) {
      return { status: 200, body: await workspace.projectWorkspace(owner, project) };
    }
    const updated = workspace.updateProject(owner, projectId, { name, description, workspacePath });
    if (!updated) throw new DynamicContractError(404, 'Project not found on this device.');
    if (description !== undefined && description !== project.description) notifyReadiness(projectId, 'project_updated');
    return { status: 200, body: await workspace.projectWorkspace(owner, updated) };
  }
  if (segments[0] === 'requirements') {
    const [, id, action] = segments;
    const store = workspace.requirements(owner, projectId);
    store.requireImported();
    if (method === 'GET' && segments.length === 1) return { status: 200, body: store.list() };
    if (method === 'POST' && segments.length === 1) {
      const body = await readBody();
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) throw new DynamicContractError(400, 'title is required');
      const record = store.create({
        title,
        description: typeof body.description === 'string' ? body.description.trim() : '',
        category: typeof body.category === 'string' ? body.category.trim() : '',
        priority: typeof body.priority === 'string' ? body.priority.trim() : 'medium',
      });
      notifyReadiness(projectId, 'requirements_changed');
      return { status: 201, body: record };
    }
    if (method === 'GET' && id && segments.length <= 3) {
      const requirement = store.get(id);
      if (!requirement) throw new DynamicContractError(404, 'Requirement not found.');
      if (segments.length === 2) return { status: 200, body: requirement };
      if (action === 'mappings') return { status: 200, body: store.mappings(id) };
    }
    if (id && segments.length === 2 && (method === 'PUT' || method === 'DELETE')) {
      if (method === 'DELETE') {
        if (!store.delete(id)) throw new DynamicContractError(404, 'Requirement not found.');
        notifyReadiness(projectId, 'requirements_changed');
        return { status: 200, body: { ok: true } };
      }
      const body = await readBody();
      const fields = Object.fromEntries(['title', 'description', 'category', 'priority']
        .flatMap(key => typeof body[key] === 'string' ? [[key, body[key]]] : []));
      const updated = store.update(id, fields);
      if (!updated) throw new DynamicContractError(404, 'Requirement not found.');
      notifyReadiness(projectId, 'requirements_changed');
      return { status: 200, body: updated };
    }
    throw new DynamicContractError(503, 'This requirement operation is unavailable in the local workspace pilot.');
  }
  if (segments[0] === 'static-sessions' && segments.length === 1 && method === 'POST') {
    const body = await readBody();
    const scope = body.scope as Record<string, unknown> | undefined;
    const ids = (value: unknown): string[] => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > 200 || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new DynamicContractError(400, 'Select valid local Review items.');
      }
      return [...new Set(value.map(item => item.trim()))];
    };
    const artifactIds = ids(scope?.artifactIds ?? body.artifactIds ?? body.selectedArtifactIds);
    const requirementIds = ids(scope?.requirementIds ?? body.requirementIds ?? body.selectedRequirementIds);
    const standardIds = ids(scope?.standardIds ?? body.standardIds ?? body.selectedStandardIds);
    if (!artifactIds.length) throw new DynamicContractError(400, 'Select at least one local artifact for this Review.');
    if (isAssessmentHeld(projectId)) throw new DynamicContractError(503, 'Model-backed Review is paused for this project.');
    const available = new Map(workspace.artifacts(owner, projectId).filter(item => item.versionId && !item.currency?.deprecated).map(item => [item.id, item]));
    const references = body.supportiveDocuments ?? [];
    if (!Array.isArray(references) || references.length > 5 || references.some(value => !value || typeof value.id !== 'string' || !artifactIds.includes(value.id))) {
      throw new DynamicContractError(400, 'Supply up to five reference files included in the Review scope.');
    }
    const referenceIds = new Set<string>(references.map(reference => reference.id));
    const authority = workspace.requirements(owner, projectId);
    const requirements = authority.confirmed();
    const rules = authority.rules();
    authority.candidates();
    if (artifactIds.some(id => !available.has(id)) || requirementIds.some(id => !requirements.some(item => item.id === id))
      || standardIds.some(id => available.get(id)?.type !== 'coding_standard'
        && !rules.some(item => item.standardId === id || item.sourceArtifactId === id))) {
      throw new DynamicContractError(400, 'The Review scope includes items unavailable in this local project.');
    }
    const sourceIds = [...new Set([...artifactIds, ...standardIds.filter(id => available.get(id)?.type === 'coding_standard')])];
    const repositorySourceId = typeof body.repositorySourceId === 'string' ? body.repositorySourceId.trim() : '';
    const repositoryRevision = typeof body.repositoryRevision === 'string' ? body.repositoryRevision.trim() : '';
    let repositoryArtifactVersions: Record<string, string> | undefined;
    if (repositorySourceId || repositoryRevision) {
      const repository = workspace.connectedSources(owner);
      const selected = repository.listProjectSources(projectId).find(item => item.id === repositorySourceId);
      const code = artifactIds.map(id => available.get(id)!).filter(item => item.source === 'repository');
      const items = new Map(repository.listItems(repositorySourceId).filter(item => item.status === 'available')
        .map(item => [item.artifactId, item.artifactVersionId]));
      if (!repositoryRevision || selected?.kind !== 'github_repository' || selected.status !== 'active' || selected.syncStatus !== 'ready'
        || selected.latestSyncRun?.status !== 'success' || selected.remoteRevision !== repositoryRevision || !code.length
        || code.some(item => item.sourceId !== repositorySourceId || items.get(item.id) !== item.versionId)) {
        throw new DynamicContractError(409, 'The selected GitHub revision is unavailable or changed. Reload Review scope and select it again.');
      }
      repositoryArtifactVersions = Object.fromEntries(code.map(item => [item.id, item.versionId!]));
    }
    const supportiveDocuments = [...referenceIds].map(id => ({ id, name: available.get(id)!.fileName }));
    const comparisonParentReviewId = typeof body.comparisonParentReviewId === 'string' ? body.comparisonParentReviewId.trim() : undefined;
    if (body.comparisonParentReviewId !== undefined && !comparisonParentReviewId) {
      throw new DynamicContractError(400, 'Supply a Review ID for the comparison.');
    }
    const runtime = await getReviewRuntime();
    const result = runtime.track(await runtime.orchestrator.start({
      projectId, name: typeof body.name === 'string' ? body.name : undefined,
      reviewType: typeof body.reviewType === 'string' ? body.reviewType : 'code_review',
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() || undefined : undefined,
      scope: { artifactIds: sourceIds, requirementIds, standardIds },
      artifacts: sourceIds.map(id => available.get(id)!),
      comparisonParentReviewId,
      config: {
        instructions: typeof body.instructions === 'string' ? body.instructions.trim() : '',
        reviewer: typeof body.reviewer === 'string' ? body.reviewer.trim() : '',
        reviewMode: typeof body.reviewMode === 'string' ? body.reviewMode : 'regular',
        baseRef: typeof body.baseRef === 'string' ? body.baseRef.trim() : '',
        headRef: typeof body.headRef === 'string' ? body.headRef.trim() : '',
        pullRequest: typeof body.pullRequest === 'string' ? body.pullRequest.trim() : '',
        ...(supportiveDocuments.length ? { supportiveDocuments } : {}),
        ...(repositoryArtifactVersions ? { repositorySourceId, repositoryRevision, repositoryArtifactVersions,
          ...(typeof body.repositoryBranch === 'string' && body.repositoryBranch.trim() ? { repositoryBranch: body.repositoryBranch.trim().slice(0, 256) } : {}) } : {}),
        ...(body.scopeMode === 'full' || body.scopeMode === 'focused' ? { scopeMode: body.scopeMode } : {}),
      },
    }));
    return { status: result.reused ? 200 : 201, body: toClientStaticSession(result.review) };
  }
  if (segments[0] === 'static-sessions' && segments.length === 3 && segments[2] === 'cancel' && method === 'POST') {
    const review = await workspace.reviews(owner).getReview(segments[1]);
    if (!review || review.projectId !== projectId) throw new DynamicContractError(404, 'Review not found on this device.');
    const runtime = await getReviewRuntime();
    await runtime.orchestrator.cancel({ reviewId: review.id });
    return { status: 200, body: { ok: true } };
  }
  if (segments[0] === 'static-sessions' && segments.length === 3 && segments[2] === 'retry' && method === 'POST') {
    const review = await workspace.reviews(owner).getReview(segments[1]);
    if (!review || review.projectId !== projectId) throw new DynamicContractError(404, 'Review not found on this device.');
    if (isAssessmentHeld(projectId)) throw new DynamicContractError(503, 'Model-backed Review is paused for this project.');
    const body = await readBody();
    if (Object.hasOwn(body, 'reuseValidatedBatches') && typeof body.reuseValidatedBatches !== 'boolean') {
      return { status: 400, body: { error: 'reuseValidatedBatches must be a boolean.', code: 'invalid_batch_reuse' } };
    }
    const runtime = await getReviewRuntime();
    const result = runtime.track(await runtime.orchestrator.retry({ reviewId: review.id,
      refreshSourceManifest: body.refreshSourceManifest === true, reuseValidatedBatches: body.reuseValidatedBatches === true,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined,
    }));
    return { status: result.reused ? 200 : 201, body: toClientStaticSession(result.review) };
  }
  if (method !== 'GET') throw new DynamicContractError(503, 'This operation is unavailable in the local workspace pilot.');
  if (!segments.length) return { status: 200, body: await workspace.projectWorkspace(owner, project) };
  if (segments[0] === 'dynamic-sessions') {
    const legacy = workspace.legacyDynamic(owner);
    if (segments.length === 1) return { status: 200, body: legacy.list(projectId) };
    const session = legacy.get(projectId, segments[1]);
    if (!session) throw new DynamicContractError(404, 'Saved browser session was not found on this device.');
    if (segments.length === 2) return { status: 200, body: session };
    if (segments.length === 3 && segments[2] === 'evidence') return { status: 200, body: legacy.listEvidence(projectId, session.id) };
  }
  if (segments.length === 1 && segments[0] === 'findings') {
    return { status: 200, body: await loadLocalProjectFindings(workspace.reviews(owner), projectId) };
  }
  if (segments.length === 1 && segments[0] === 'assessment') {
    return { status: 200, body: await loadLocalProjectAssessment(workspace.reviews(owner), projectId) };
  }
  if (segments[0] === 'static-sessions') {
    if (!isAssessmentHeld(projectId)) await getReviewRuntime();
    const reviews = workspace.reviews(owner);
    if (segments.length === 1) return { status: 200, body: (await reviews.listReviews(projectId)).map(toClientStaticSession) };
    const review = await reviews.getReview(segments[1]);
    if (!review || review.projectId !== projectId) throw new DynamicContractError(404, 'Review not found on this device.');
    if (segments.length === 2) return { status: 200, body: { ...toClientStaticSession(review), currentDecision: reviews.listDecisions(review.id)[0] ?? null } };
    if (segments.length === 3 && segments[2] === 'source-manifest') {
      return { status: 200, body: await workspace.reviewManifest(owner, review) };
    }
    if (segments.length === 3 && segments[2] === 'decisions') {
      const limit = Number(url.searchParams.get('limit') || 50);
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
        throw new DynamicContractError(400, 'Choose a decision history limit of 1–100 and an offset of 0–1000000.');
      }
      return { status: 200, body: reviews.listDecisions(review.id).slice(offset, offset + limit) };
    }
    if (segments.length === 3 && segments[2] === 'traceability') {
      const snapshot = await reviews.getTraceabilitySnapshot(review.id);
      if (!snapshot) throw new DynamicContractError(404, 'Traceability has not been captured for this Review.');
      return { status: 200, body: snapshot };
    }
    if (segments.length === 3 && segments[2] === 'findings') {
      return { status: 200, body: reviews.listFindingRows(projectId, review.id) };
    }
    if (segments.length === 3 && segments[2] === 'harness') {
      const events = (await reviews.listAudit(projectId, review.id)).filter(event => isPublicReviewHarnessEvent(event.event));
      const { id, name, status, progress, modelStatus, updatedAt } = review;
      return { status: 200, body: { workflow: REVIEW_HARNESS, review: { id, name, status, progress, modelStatus, updatedAt },
        events, analysisMap: analysisMapFromEvents(events) } };
    }
    if (segments.length === 5 && segments[2] === 'source-artifacts' && segments[4] === 'content' && review.sourceManifestId) {
      const artifacts = await reviews.loadSourceManifestArtifacts(review.sourceManifestId);
      const artifact = artifacts?.find(item => item.id === segments[3] && item.projectId === projectId);
      if (!artifact?.versionId) throw new DynamicContractError(404, 'Frozen Review source unavailable.');
      const saved = workspace.sourceBytes(owner, projectId, artifact.id, artifact.versionId);
      if (!saved || saved.contentHash !== artifact.contentHash) throw new DynamicContractError(404, 'Frozen Review source unavailable.');
      return { status: 200, body: await presentFrozenReviewSource({ ...artifact, versionId: saved.versionId },
        saved.content, saved.contentHash, saved.mimeType) };
    }
    throw new DynamicContractError(503, 'This Review operation is unavailable in the local workspace pilot.');
  }
  if (segments[0] === 'artifacts' && segments.length === 1) {
    const artifacts = workspace.artifacts(owner, projectId);
    return { status: 200, body: url.searchParams.get('view') === 'presence' ? { hasSources: artifacts.length > 0 } : artifacts };
  }
  if (segments[0] === 'artifacts' && segments.length === 3 && segments[2] === 'content') {
    const source = workspace.content(owner, projectId, segments[1], url.searchParams.get('versionId') ?? undefined);
    if (!source) throw new DynamicContractError(404, 'Artifact version not found on this device.');
    return { status: 200, body: source };
  }
  throw new DynamicContractError(503, 'This operation is unavailable in the local workspace pilot.');
}
