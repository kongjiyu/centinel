import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import fs, { rm } from 'node:fs/promises';
import { createServer as createProviderServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { AuthGatewayError, type AuthGateway } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import type { ProjectReadinessCoordinator } from '../../src/readiness/service.js';
import { ModelProviderError } from '../../src/review/retry.js';
import { LocalWorkspace, type WorkspaceSource } from '../../src/store/localWorkspace.js';
import { readPromptAnalysisMap } from '../fixtures/promptAnalysisMap.js';
import { resolveModelProviderChain } from '../../src/review/modelProviderResolver.js';
import { encryptSecret } from '../../src/tokenVault.js';
import type { ConnectedSourceProviderAdapter } from '../../src/integrations/types.js';
import { describeRepositoryIndex, indexFrozenArtifacts, retrieveFrozenContext } from '../../src/review/localRepositoryIndex.js';
import { INDEX_RELATIVE_DIRECTORY, portableIndexFiles } from '../../src/review/openCodebaseIndex.js';
import { localIndexKey } from '../../src/review/localIndexRetention.js';
import { encodeRepositorySnapshot, repositoryIndexArchiveSha256 } from '../../src/review/repositoryIndexSnapshot.js';
import { verifyPortableIndexArchives } from '../../src/review/localIndexArchive.js';
import type { DynamicHistorySnapshot } from '../../src/dynamic/localHistory.js';
import type { DynamicRun, MissionRevision } from '../../src/dynamic/types.js';
import { DynamicService } from '../../src/dynamic/service.js';
import { checkEnvironment } from '../../src/dynamic/environment/preflight.js';
import type { ReviewHistorySnapshot } from '../../src/review/localReviewRecords.js';
import type { StaticReviewRecord } from '../../src/review/types.js';

it('serves reopened owner projects and exact frozen versions with application-data requests blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-local-workspace-'));
  const owner = randomUUID(), projectId = randomUUID(), artifactId = randomUUID();
  const createdAt = '2026-11-24T00:00:00.000Z';
  const project = { id: projectId, ownerId: owner, name: 'Workspace fixture', description: '', workspacePath: '', createdAt, updatedAt: createdAt };
  const source = (text: string): WorkspaceSource => {
    const bytes = Buffer.from(text);
    return { bytes, mimeType: 'text/plain', artifact: {
      id: artifactId, versionId: randomUUID(), projectId, fileName: 'fixture.ts', filePath: 'src/fixture.ts',
      originalPath: null, createdAt, source: 'repository', type: 'source_code',
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    } };
  };
  const old = source('export const value = 1;\r\n');
  const current = source('export const value = 2;\n');
  const requirement = { id: randomUUID(), projectId, title: 'Show the count', description: 'Keep the display visible.',
    category: 'Behavior', priority: 'medium', createdAt, updatedAt: createdAt };
  const mapping = { id: randomUUID(), projectId, requirementId: requirement.id, standardId: null, artifactId,
    fileId: artifactId, symbolId: null, coverageStatus: 'complete', confidence: 1, createdAt,
    mappingVersionId: old.artifact.versionId, mappingContentHash: old.artifact.contentHash };
  const traceability = { requirements: [requirement], mappings: [mapping], candidates: [], standardRules: [] };
  const imported = new LocalWorkspace(directory);
  const reopened = new LocalWorkspace(directory);
  const remote = vi.fn(() => { throw new Error('Hosted application data blocked by fixture.'); });
  const auth = {
    authenticate: async (headers: { authorization?: string }) => {
      if (!headers.authorization) throw new AuthGatewayError('Sign in.', 401, 'unauthenticated');
      const userId = headers.authorization === 'Bearer owner' ? owner : 'other-owner';
      return { userId, user: { id: userId }, client: { from: remote, rpc: remote, storage: { from: remote } } };
    },
    requireProjectMember: remote,
  } as unknown as AuthGateway;
  const readiness = { close() {}, adoptSession() {} } as unknown as ProjectReadinessCoordinator;
  const assess = vi.fn(async () => ({
    settings: { provider: 'custom' as const, apiFormat: 'openai-compatible' as const, model: 'fixture' },
    result: { categories: [] },
  }));
  const analyze = vi.fn(async request => ({
    settings: { provider: 'custom' as const, apiFormat: 'openai-compatible' as const, model: 'local-fixture' },
    result: request.stage === 'conversation_plan' ? conversationReply(request.prompt)
      : { findings: [], featureAssessments: readPromptAnalysisMap(request).features.map(feature => ({
      featureId: feature.id, assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({
        domain, status: 'assessed', outcome: 'no_issue_identified', summary: 'The frozen local code was assessed.', evidence: feature.entryPoints,
      })),
    })) },
  }));
  const conversationReply = (prompt: string) => {
    const { evidence } = JSON.parse(prompt) as { evidence: Array<{ id: string }> };
    const finding = evidence.find(item => item.id.startsWith('finding:'));
    if (finding) return { action: 'explain', reply: 'The saved finding says the count is missing from the display.', scope: [],
      citations: [finding.id], claims: [{ citation: finding.id, excerpt: 'The display is missing.' }], questionOptions: [] };
    return { action: 'general', reply: 'A unit test checks a small part of a program.', scope: [], citations: [], claims: [], questionOptions: [] };
  };
  const createServer = (workspace: LocalWorkspace) => createSidecarServer(auth, { localWorkspace: workspace, historyPath: join(directory, 'history.sqlite'),
    readinessCoordinator: readiness, localReviewFixtureProvider: { analyze },
    localReadinessFixtureProvider: { analyze: assess } });
  let server = createServer(reopened);
  const providerRequests = vi.fn();
  const providerServer = createProviderServer((request, response) => {
    providerRequests(request.url, request.headers.authorization);
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.endsWith('/embeddings')) {
        const { input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const entries = Array.isArray(input) ? input : [input];
        response.end(JSON.stringify({ data: entries.map((_, index) => ({ index, embedding: Array(1536).fill(0.01) })),
          model: 'fixture-embedding', usage: { prompt_tokens: 9, total_tokens: 9 } }));
      } else {
        response.end(JSON.stringify({ choices: [{ message: { content: '{"status":"ok"}' } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }));
      }
    });
  });
  let restarted: LocalWorkspace | undefined;
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '0');
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST', '');
  vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'fictional-local-test-encryption-key');
  try {
    const settings = { ownerId: owner, projectId, purpose: 'static_review', provider: 'custom',
      apiFormat: 'openai-compatible', model: 'configured-local-fixture', baseUrl: 'https://fixture.example.invalid/v1',
      secretCiphertext: encryptSecret('synthetic-provider-secret') };
    imported.importSnapshot(owner, project, [old, current], traceability, [settings]);
    expect(() => imported.importSnapshot(owner, project, [{ ...current, bytes: old.bytes }])).toThrow(/source hashes/);
    expect(() => imported.importSnapshot(owner, project, [{ ...old, artifact: {
      ...old.artifact, versionId: current.artifact.versionId,
    } }])).toThrow(/frozen version ID/);
    const reviews = imported.reviews(owner);
    const reviewId = randomUUID();
    const operation = { operation: 'start' as const, idempotencyKey: 'saved-review', projectId, reviewId, createdAt };
    const review = await reviews.createReview({ id: reviewId, projectId, name: 'Frozen fixture Review', reviewType: 'code_review',
      status: 'queued', idempotencyKey: operation.idempotencyKey, scope: { artifactIds: [artifactId] }, config: {},
      lineage: { parentReviewId: null, lineageRootId: reviewId, reusedSourceManifest: false }, createdAt });
    await reviews.saveOperation(operation);
    await reviews.saveOperation(operation);
    expect(await reviews.findOperation('start', operation.idempotencyKey, projectId)).toEqual(operation);
    expect(await reviews.findReviewByIdempotencyKey(projectId, operation.idempotencyKey)).toEqual(review);
    const transitions = await Promise.all([
      reviews.transitionReview(reviewId, ['queued'], { status: 'running' }),
      reviews.transitionReview(reviewId, ['queued'], { status: 'cancelled' }),
    ]);
    expect(transitions.filter(Boolean)).toHaveLength(1);
    const manifest = await reviews.saveSourceManifest(reviewId, projectId, [old.artifact], 'capture');
    await expect(reviews.saveSourceManifest(reviewId, projectId, [old.artifact], 'capture')).resolves.toEqual(manifest);
    await expect(reviews.saveSourceManifest(reviewId, projectId, [current.artifact], 'capture')).rejects.toThrow('cannot be changed');
    expect(await imported.reviews('other-owner').loadSourceManifestArtifacts(manifest.id)).toBeNull();
    const capture = { scope: { artifactIds: [artifactId], requirementIds: [requirement.id] },
      sourceManifestId: manifest.id, artifacts: [old.artifact], grounding: {
        confirmedRequirements: [{ ...requirement, sourceCandidateId: null, sourceLocator: null, sourceVersion: null, confidence: null }],
        enabledStandardRules: [],
      } };
    const trace = await reviews.captureTraceabilitySnapshot(reviewId, projectId, capture);
    expect(trace.records[0]).toMatchObject({ requirementId: requirement.id, state: 'complete', evidenceStatus: 'verified' });
    const retryId = randomUUID();
    await reviews.createRetryReview({ id: retryId, projectId, name: 'Saved-source retry', reviewType: 'code_review',
      status: 'queued', idempotencyKey: 'saved-retry', scope: capture.scope, config: {}, sourceManifestId: manifest.id,
      lineage: { parentReviewId: reviewId, lineageRootId: reviewId, reusedSourceManifest: true }, createdAt });
    expect(await reviews.captureTraceabilitySnapshot(retryId, projectId, { ...capture, reuseFromReviewId: reviewId }))
      .toEqual({ ...trace, sessionId: retryId });
    const leaseInput = { projectId, reviewId, workerId: 'first', leaseToken: 'first-token', now: createdAt,
      expiresAt: '2026-11-24T00:00:30.000Z' };
    const leases = imported.reviewLeases(owner);
    expect(await leases.acquireLease(leaseInput)).toMatchObject({ workerId: 'first', attempt: 1 });
    expect(await leases.acquireLease({ ...leaseInput, workerId: 'second', leaseToken: 'second-token' })).toBeNull();
    const checkpoint = { reviewId, projectId, workerId: 'first', leaseToken: 'first-token', stage: 'freezing_sources',
      completedStages: [], updatedAt: createdAt };
    await leases.saveCheckpoint(checkpoint);
    const finding = { id: randomUUID(), reviewId, projectId, source: 'model' as const, title: 'Count must be displayed',
      description: 'The display is missing.', severity: 'medium', category: 'Behavior', filePath: 'src/fixture.ts',
      lineNumber: 1, artifactId, sourceVersion: old.artifact.versionId, evidence: 'export const value = 1;',
      recommendation: 'Display the count.', confidence: 'high', fingerprint: 'test-fingerprint', createdAt };
    await reviews.saveFinding(finding);
    await reviews.saveFinding({ ...finding, id: randomUUID() });
    const uncertain = { ...finding, id: randomUUID(), sourceLocator: { citationEvidence: { verification: 'needs_verification' } } };
    await reviews.saveFinding(uncertain);
    expect((await reviews.listReviewFindings(reviewId)).map(item => item.id).sort()).toEqual([finding.id, uncertain.id].sort());
    await expect(reviews.saveFinding({ ...finding, projectId: 'different-project' })).rejects.toThrow(/FOREIGN KEY/i);
    const progress = { stage: 'analysis', completedStages: ['context'], updatedAt: '2026-11-24T00:01:00.000Z' };
    await reviews.updateProgress(reviewId, progress);
    await reviews.updateProgress(reviewId, { stage: 'context', completedStages: [], updatedAt: createdAt });
    const attempt = { id: randomUUID(), reviewId, projectId, stage: 'analysis', attempt: 2, provider: 'fixture',
      apiFormat: 'fixture', model: 'synthetic', durationMs: 0, outcome: 'in_progress' as const, createdAt };
    await reviews.recordModelAttempt(attempt);
    await reviews.recordModelAttempt({ ...attempt, outcome: 'success', durationMs: 100, errorMessage: 'Private synthetic diagnostic' });
    await reviews.recordModelAttempt(attempt);
    await expect(reviews.recordModelAttempt({ ...attempt, stage: 'other' })).rejects.toThrow('another attempt');
    const event = { reviewId, projectId, event: 'harness_step_started', stage: 'analysis', createdAt };
    await reviews.recordAudits([event, event]);
    await expect(reviews.recordAudits([{ ...event, event: 'bad_batch_marker' }, { ...event, projectId: 'different-project' }]))
      .rejects.toThrow(/FOREIGN KEY/i);
    expect((await reviews.listAudit(projectId, reviewId)).some(item => item.event === 'bad_batch_marker')).toBe(false);
    const sufficiency = { id: randomUUID(), reviewId, projectId, reviewType: 'code_review', readiness: 'ready' as const,
      gaps: [], contradictions: [], artifactCount: 1, availableArtifactCount: 1, staleArtifactCount: 0,
      confirmedRequirementCount: 0, enabledStandardRuleCount: 0, assessedAt: createdAt };
    await reviews.saveEvidenceSufficiency(sufficiency);
    await reviews.saveEvidenceSufficiency({ ...sufficiency, id: randomUUID() });
    imported.close();
    const chain = await resolveModelProviderChain(reopened.modelConfigurations(owner), { ownerId: owner, projectId });
    expect(chain.primary).toMatchObject({ ownerId: owner, model: settings.model, apiKey: 'synthetic-provider-secret' });
    expect(await reopened.modelConfigurations('other-owner').getModelConfiguration({ ownerId: owner, projectId })).toBeNull();
    const restartedLeases = reopened.reviewLeases(owner);
    expect(await restartedLeases.getCheckpoint(reviewId)).toEqual(checkpoint);
    expect(await restartedLeases.listExpiredLeases('2026-11-24T00:00:30.000Z')).toMatchObject([{ reviewId, leaseToken: 'first-token' }]);
    const nextLease = { ...leaseInput, workerId: 'second', leaseToken: 'second-token', now: '2026-11-24T00:00:30.000Z',
      expiresAt: '2026-11-24T00:01:00.000Z' };
    expect(await restartedLeases.acquireLease(nextLease)).toMatchObject({ workerId: 'second', attempt: 2 });
    await expect(restartedLeases.saveCheckpoint(checkpoint)).rejects.toThrow('no longer owned');
    expect(await reopened.reviewLeases('other-owner').getCheckpoint(reviewId)).toBeNull();
    expect(await restartedLeases.releaseLease({ ...leaseInput, now: nextLease.now })).toBe(false);
    expect(await restartedLeases.releaseLease(nextLease)).toBe(true);
    expect(await reopened.reviews(owner).getEvidenceSufficiency(reviewId)).toEqual(sufficiency);
    expect(await reopened.reviews(owner).getModelAttemptCount(reviewId, 'analysis')).toBe(2);
    expect(await reopened.reviews('other-owner').listReviewFindings(reviewId)).toEqual([]);
    const db = new DatabaseSync(join(directory, 'workspace.sqlite'), { readOnly: true });
    try {
      const stored = db.prepare('SELECT outcome, payload FROM local_review_attempt WHERE owner = ? AND review = ?').all(owner, reviewId);
      expect(stored).toHaveLength(1);
      expect(stored[0].outcome).toBe('success');
      expect(String(stored[0].payload)).not.toContain('Private synthetic diagnostic');
    } finally {
      db.close();
    }
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    let base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const get = (path: string, account = 'owner') => fetch(base + path, { headers: { Authorization: 'Bearer ' + account } });
    const path = '/projects/' + projectId;
    expect(await (await get('/projects')).json()).toMatchObject([{ ...project, managedWorkspaceReady: false }]);
    expect(await (await get(path)).json()).toMatchObject({ ...project, managedWorkspaceReady: false });
    expect(await (await get(path + '/artifacts')).json()).toEqual([current.artifact]);
    expect(await (await get(path + '/artifacts?view=presence')).json()).toEqual({ hasSources: true });
    const requirements = path + '/requirements';
    expect(await (await get(requirements)).json()).toEqual([requirement]);
    expect(await (await get(requirements + '/' + requirement.id + '/mappings')).json()).toEqual([mapping]);
    const write = (target: string, method: string, account: string, body?: object) => fetch(base + target, {
      method, headers: { Authorization: 'Bearer ' + account, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const settingsPath = '/settings/ai';
    const savedProvider = { provider: 'custom', apiFormat: 'openai-compatible', model: 'owner-local-fixture',
      baseUrl: 'https://fixture.example.invalid/v1', apiKey: 'fictional-owner-provider-key' };
    expect((await write(settingsPath + '/shared', 'PUT', 'owner', { ...savedProvider, saveOnly: true })).status).toBe(200);
    expect((await write(settingsPath + '/shared/use', 'POST', 'owner', { slot: 'api', model: 'stale-selection' })).status).toBe(409);
    expect((await write(settingsPath + '/shared/use', 'POST', 'owner', { slot: 'api', model: savedProvider.model })).status).toBe(200);
    const modelSettings = await (await get(settingsPath)).json();
    expect(modelSettings).toEqual(expect.arrayContaining(['text', 'vision'].map(id => expect.objectContaining({ id, model: savedProvider.model, hasApiKey: true }))));
    expect(JSON.stringify(modelSettings)).not.toContain(savedProvider.apiKey);
    expect(await (await get(settingsPath, 'other')).json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ model: savedProvider.model })]));
    expect((await write(settingsPath + '/shared', 'PUT', 'owner', { ...savedProvider, apiKey: '', baseUrl: 'https://other.example.invalid/v1' })).status).toBe(400);
    await new Promise<void>(done => providerServer.listen(0, '127.0.0.1', done));
    const providerBase = 'http://127.0.0.1:' + (providerServer.address() as AddressInfo).port + '/v1';
    const textTest = await write(settingsPath + '/text/test', 'POST', 'owner', { ...savedProvider, baseUrl: providerBase + '/chat/completions' });
    expect(await textTest.json()).toMatchObject({ status: 'pass' });
    const embedding = { ...savedProvider, baseUrl: providerBase, model: 'fixture-embedding', embeddingProvider: 'custom' };
    expect((await write(settingsPath + '/embedding', 'PUT', 'owner', embedding)).status).toBe(200);
    expect(await (await write(settingsPath + '/embedding/test', 'POST', 'owner')).json()).toMatchObject({ status: 'pass' });
    expect(providerRequests.mock.calls).toEqual([['/v1/chat/completions', `Bearer ${savedProvider.apiKey}`],
      ['/v1/embeddings', `Bearer ${savedProvider.apiKey}`]]);
    const usagePath = settingsPath + '/usage';
    expect(await (await get(usagePath + '?callKind=test')).json()).toMatchObject({ totals: { calls: 2, providerReportedTotalTokens: 16 } });
    expect(await (await get(usagePath + '?callKind=test', 'other')).json()).toMatchObject({ totals: { calls: 0 } });
    expect(await (await get(settingsPath + '/embedding/models')).json()).toMatchObject({ usageAvailable: true,
      usage: [{ model: 'fixture-embedding', knownTokens: 9, calls: 1, unknownCalls: 0 }] });
    const folder = join(directory, 'new-repository');
    mkdirSync(folder);
    const file = join(folder, 'fresh.ts');
    writeFileSync(file, 'export const fresh = 1;\r\n');
    const secondFolder = join(directory, 'second-repository');
    mkdirSync(secondFolder);
    writeFileSync(join(secondFolder, 'fresh.ts'), 'export const secondary = true;\n');
    const newProjectResponse = await write('/projects', 'POST', 'owner', { name: 'Local creation fixture', sources: [
      { type: 'local-repository', path: folder }, { type: 'local-repository', path: secondFolder },
    ] });
    expect(newProjectResponse.status).toBe(201);
    const newProject = await newProjectResponse.json();
    expect(newProject.sourceImportWarnings).toBeUndefined();
    const newProjectPath = '/projects/' + newProject.id;
    const fallbackChain = await resolveModelProviderChain(reopened.modelConfigurations(owner), { ownerId: owner, projectId: newProject.id });
    expect(fallbackChain.primary).toMatchObject({ model: savedProvider.model, apiKey: savedProvider.apiKey });
    expect((await resolveModelProviderChain(reopened.modelConfigurations(owner), { ownerId: owner, projectId })).primary.model).toBe(settings.model);
    const inventory = newProjectPath + '/artifacts';
    const refresh = inventory + '/import-repo';
    expect((await get(newProjectPath, 'other')).status).toBe(404);
    expect((await write(refresh, 'POST', 'other', { repoPath: folder })).status).toBe(404);
    expect(await (await get(newProjectPath + '/requirements')).json()).toEqual([]);
    const initial = await (await get(inventory)).json();
    expect(initial).toHaveLength(2);
    const primary = initial.find((item: { filePath: string }) => item.filePath === 'fresh.ts');
    const secondary = initial.find((item: { filePath: string }) => item.filePath.startsWith('local-repositories/'));
    expect(primary).toMatchObject({ fileName: 'fresh.ts', source: 'repository', originalPath: file });
    expect(secondary).toMatchObject({ fileName: 'fresh.ts', localRepositoryName: 'second-repository' });
    expect(await (await write(refresh, 'POST', 'owner', { repoPath: folder })).json())
      .toMatchObject({ complete: true, imported: [{ id: primary.id, versionId: primary.versionId }] });
    writeFileSync(file, 'export const fresh = 2;\n');
    const refreshResponse = await write(refresh, 'POST', 'owner', { repoPath: folder });
    expect(refreshResponse.status).toBe(200);
    const [updatedSource] = (await refreshResponse.json()).imported;
    expect(updatedSource.id).toBe(primary.id);
    expect(updatedSource.versionId).not.toBe(primary.versionId);
    const newPreview = inventory + '/' + primary.id + '/content';
    expect(await (await get(newPreview + '?versionId=' + primary.versionId)).json()).toMatchObject({
      content: Buffer.from('export const fresh = 1;\r\n').toString('base64'), versionId: primary.versionId,
    });
    const upload = { fileName: 'specs/requirements.md', type: 'requirement',
      content: Buffer.from('# Requirements\r\n' + 'The counter shows the total.\r\n'.repeat(3500)).toString('base64') };
    expect((await write(inventory, 'POST', 'other', upload)).status).toBe(404);
    expect((await write(inventory, 'POST', 'owner', { ...upload, fileName: '../requirements.md' })).status).toBe(400);
    expect((await write(inventory, 'POST', 'owner', { ...upload, content: 'junk===' })).status).toBe(400);
    const documentResponse = await write(inventory, 'POST', 'owner', upload);
    expect(documentResponse.status).toBe(201);
    const document = await documentResponse.json();
    expect(document).toMatchObject({ fileName: upload.fileName, source: 'documents', type: 'requirement' });
    const documentPreview = inventory + '/' + document.id + '/content';
    expect(await (await get(documentPreview)).json()).toMatchObject({ versionId: document.versionId, content: upload.content });
    const referenceUpload = await write(inventory, 'POST', 'owner', { fileName: 'reference.md', type: 'other',
      content: Buffer.from('# Reference\r\n').toString('base64'), reviewReference: true });
    expect(referenceUpload.status).toBe(201);
    const reference = await referenceUpload.json();
    const currency = inventory + '/' + reference.id + '/currency';
    expect(await (await write(currency, 'POST', 'owner', { action: 'confirm' })).json()).toMatchObject({ confirmedBy: owner });
    expect(await (await write(currency, 'POST', 'owner', { action: 'deprecate' })).json()).toMatchObject({ confirmedBy: owner, deprecatedBy: owner, deprecated: true });
    const referenceScope = { scope: { artifactIds: [primary.id, reference.id] }, supportiveDocuments: [{ id: reference.id }] };
    const referenceStart = newProjectPath + '/static-sessions';
    expect((await write(referenceStart, 'POST', 'owner', referenceScope)).status).toBe(400);
    expect(await (await write(currency, 'POST', 'owner', { action: 'restore' })).json()).toMatchObject({ confirmedBy: owner, deprecatedBy: null, deprecated: false });
    const scopedDocumentReview = await write(referenceStart, 'POST', 'owner', referenceScope);
    expect(scopedDocumentReview.status).toBe(201);
    const referenceReview = await scopedDocumentReview.json();
    expect(JSON.parse(referenceReview.configJson).supportiveDocuments).toEqual([{ id: reference.id, name: 'reference.md' }]);
    const frozenReference = referenceStart + '/' + referenceReview.id + '/source-artifacts/' + reference.id + '/content';
    await vi.waitFor(async () => {
      expect(await (await get(frozenReference)).json()).toMatchObject({ versionId: reference.versionId, content: Buffer.from('# Reference\r\n').toString('base64') });
    });
    expect((await write(inventory + '/' + reference.id, 'DELETE', 'other')).status).toBe(404);
    expect((await write(inventory + '/' + reference.id, 'DELETE', 'owner')).status).toBe(200);
    expect(await (await get(inventory)).json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: reference.id })]));
    expect((await get(frozenReference)).status).toBe(200);
    expect((await write(path, 'PUT', 'other', { name: 'Forbidden' })).status).toBe(404);
    expect((await write(path, 'PUT', 'owner', { name: '  ' })).status).toBe(400);
    expect((await write(path, 'PUT', 'owner', { name: 'Renamed locally' })).status).toBe(200);
    expect((await write(requirements + '/' + requirement.id, 'PUT', 'other', { title: 'Forbidden' })).status).toBe(404);
    const edited = await write(requirements + '/' + requirement.id, 'PUT', 'owner', { priority: 'high' });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ ...requirement, priority: 'high', updatedAt: expect.any(String) });
    const created = await write(requirements, 'POST', 'owner', { title: 'Another requirement' });
    expect(created.status).toBe(201);
    const added = await created.json();
    expect((await write(requirements + '/' + added.id, 'DELETE', 'owner')).status).toBe(200);
    imported.importSnapshot(owner, project, [old, current], traceability);
    imported.close();
    expect(await (await get(requirements)).json()).toMatchObject([{ id: requirement.id, priority: 'high' }]);
    expect(await (await get(path)).json()).toMatchObject({ id: projectId, name: 'Renamed locally', description: project.description });
    expect((await write(path, 'PUT', 'owner', { workspacePath: join(directory, 'missing') })).status).toBe(400);
    expect(await (await write(path, 'PUT', 'owner', { workspacePath: folder })).json()).toMatchObject({ workspacePath: realpathSync(folder) });
    const preview = path + '/artifacts/' + artifactId + '/content';
    expect(await (await get(preview)).json()).toMatchObject({ versionId: current.artifact.versionId });
    expect(await (await get(preview + '?versionId=' + old.artifact.versionId)).json()).toMatchObject({
      versionId: old.artifact.versionId, contentHash: old.artifact.contentHash, content: old.bytes.toString('base64'),
    });
    const reviewPath = path + '/static-sessions/' + reviewId;
    const frozenPreview = reviewPath + '/source-artifacts/' + artifactId + '/content';
    expect(await (await get(path + '/static-sessions')).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reviewId, status: 'running' }), expect.objectContaining({ id: retryId, status: 'queued' }),
    ]));
    expect(await (await get(reviewPath)).json()).toMatchObject({ id: reviewId, name: 'Frozen fixture Review' });
    const savedFindings = await (await get(reviewPath + '/findings')).json();
    expect(savedFindings).toHaveLength(2);
    expect(savedFindings).toEqual(expect.arrayContaining([expect.objectContaining({
      id: finding.id, status: 'new', verifier: 'model', artifactVersionId: old.artifact.versionId, evidenceText: finding.evidence,
    })]));
    const projectFindings = path + '/findings';
    const updateFinding = projectFindings + '/' + finding.id;
    expect(await (await get(projectFindings)).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: finding.id, status: 'new' })]));
    expect((await write(updateFinding, 'PUT', 'other', { status: 'fixed' })).status).toBe(404);
    expect((await write(newProjectPath + '/findings/' + finding.id, 'PUT', 'owner', { status: 'fixed' })).status).toBe(404);
    expect((await write(updateFinding, 'PUT', 'owner', { status: 'fixed' })).status).toBe(200);
    expect((await write(updateFinding, 'PUT', 'owner', { status: 'fixed' })).status).toBe(200);
    expect(await (await get(reviewPath + '/findings')).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: finding.id, status: 'fixed' })]));
    expect(await (await get(projectFindings)).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: finding.id, status: 'fixed' })]));
    expect(await (await get(path + '/assessment')).json()).toMatchObject({ projectId, status: 'available' });
    expect(await reopened.reviews(owner).listReviewFindings(reviewId)).toEqual(expect.arrayContaining([finding]));
    expect(await (await get(reviewPath + '/harness')).json()).toMatchObject({
      review: { id: reviewId, progress }, events: [expect.objectContaining({ event: 'harness_step_started' })],
    });
    expect(await (await get(reviewPath + '/traceability')).json()).toEqual(trace);
    const cancel = path + '/static-sessions/' + retryId + '/cancel';
    expect((await write(cancel, 'POST', 'other')).status).toBe(404);
    expect(await (await write(cancel, 'POST', 'owner')).json()).toEqual({ ok: true });
    expect(await (await get(path + '/static-sessions/' + retryId)).json()).toMatchObject({ status: 'cancelled' });
    const startPath = path + '/static-sessions';
    expect(await (await get('/static-sessions/active')).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reviewId, status: 'running' }),
    ]));
    const startRequest = { name: 'Local execution fixture', scope: { artifactIds: [artifactId] }, idempotencyKey: 'local-execution' };
    const start = await write(startPath, 'POST', 'owner', startRequest);
    expect(start.status).toBe(201);
    const started = await start.json();
    expect((await write(startPath, 'POST', 'owner', startRequest)).status).toBe(200);
    await vi.waitFor(async () => {
      const result = await (await get(startPath + '/' + started.id)).json();
      expect(result).toMatchObject({ status: 'pending_approval', modelStatus: 'succeeded' });
    }, { timeout: 5000 });
    expect(analyze).toHaveBeenCalled();
    expect(await (await get(startPath + '/' + started.id + '/source-artifacts/' + artifactId + '/content')).json())
      .toMatchObject({ versionId: current.artifact.versionId, content: current.bytes.toString('base64') });
    const dynamicContextPath = startPath + '/' + started.id + '/dynamic-context';
    const savedDynamicContext = await (await get(dynamicContextPath)).json();
    expect(savedDynamicContext).toMatchObject({ projectId, reviewId: started.id, provenance: 'review-snapshot',
      sources: expect.arrayContaining([expect.objectContaining({ id: artifactId, version: current.artifact.versionId })]) });
    expect((await get(dynamicContextPath, 'other')).status).toBe(404);
    const missionInput = { name: 'Verify saved requirement', goal: 'Check the display', targetUrl: 'http://localhost:3000', maxSteps: 3,
      contextAcknowledged: true, context: { provenance: 'review-snapshot', reviewId: started.id, approvalState: 'approved', sources: [] },
      checks: [{ id: 'display', criterionId: requirement.id + ':statement', description: 'Read the display',
        required: true, kind: 'visible_text', expected: 'Count' }] };
    const authored = await write(path + '/dynamic/missions', 'POST', 'owner', missionInput);
    expect(authored.status).toBe(201);
    expect(await authored.json()).toMatchObject({ revision: 1, context: savedDynamicContext });
    const reports = path + '/reports';
    expect((await write(reports + '/export', 'POST', 'other', { reviewId: started.id })).status).toBe(404);
    expect((await write(newProjectPath + '/reports/export', 'POST', 'owner', { reviewId: started.id })).status).toBe(404);
    const exported = await write(reports + '/export', 'POST', 'owner', { reviewId: started.id });
    expect(exported.status).toBe(200);
    const report = await exported.json();
    expect(report.storage).toBe('private-local');
    const reportLinks = reports + '/' + report.reportId + '/links';
    expect((await write(reportLinks, 'POST', 'other')).status).toBe(404);
    expect((await fetch(base + '/local-report-download')).status).toBe(404);
    const changedReportUrl = new URL(report.downloads.json);
    const key = changedReportUrl.searchParams.get('key')!;
    changedReportUrl.searchParams.set('key', (key[0] === 'a' ? 'b' : 'a') + key.slice(1));
    expect((await fetch(changedReportUrl)).status).toBe(404);
    const reportJson = await (await fetch(report.downloads.json)).text();
    expect(createHash('sha256').update(reportJson).digest('hex')).toBe(report.checksums.snapshot);
    expect(JSON.parse(reportJson)).toMatchObject({ metadata: { reviewId: started.id }, project: { id: projectId },
      latestReview: { session: { id: started.id }, sourceManifest: { status: 'available', artifactCount: 1 } },
      currentFindings: { status: 'available', items: expect.arrayContaining([expect.objectContaining({ id: finding.id, persistedStatus: 'fixed' })]) } });
    const reportPdf = Buffer.from(await (await fetch(report.downloads.pdf)).arrayBuffer());
    expect(reportPdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(reportPdf).digest('hex')).toBe(report.checksums.pdf);
    expect(await (await get(frozenPreview)).json()).toMatchObject({
      versionId: old.artifact.versionId, artifactVersionId: old.artifact.versionId, content: old.bytes.toString('base64'),
    });
    expect((await get(frozenPreview, 'different-user')).status).toBe(404);
    expect((await get(path, 'different-user')).status).toBe(404);
    expect((await get(preview, 'different-user')).status).toBe(404);
    expect(await (await get('/projects', 'different-user')).json()).toEqual([]);
    expect((await fetch(base + path)).status).toBe(401);
    expect((await fetch(base + path, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })).status).toBe(503);
    const chat = path + '/conversation-requests';
    const submit = async (text: string, references: object[] = [], mode = 'code') => {
      const id = randomUUID();
      const response = await write(chat, 'POST', 'owner', { id, text, mode, permission: 'auto', references });
      expect(response.status).toBe(202);
      return chat + '/' + id;
    };
    const general = await submit('What is a unit test?');
    await vi.waitFor(async () => {
      expect(await (await get(general)).json()).toMatchObject({ state: 'completed', action: 'explain', citations: [],
        reply: 'A unit test checks a small part of a program.' });
    });
    expect((await get(general, 'other')).status).toBe(404);
    const problem = await submit('Explain this issue', [{ reviewId, findingId: finding.id }]);
    await vi.waitFor(async () => {
      expect(await (await get(problem)).json()).toMatchObject({ state: 'completed', action: 'explain',
        reply: 'The saved finding says the count is missing from the display.', citations: ['finding:' + finding.id],
        recall: { turns: 1, status: 'loaded' } });
    });
    expect(analyze.mock.calls.some(([request]) => request.stage === 'conversation_plan'
      && JSON.parse(request.prompt).earlierTurns.some((item: { text: string }) => item.text.includes('What is a unit test?')))).toBe(true);
    const savedEvidence = await (await get(problem + '/evidence')).json();
    expect(JSON.stringify(savedEvidence.sections)).toContain('export const value = 1;');
    expect(JSON.stringify(savedEvidence.sections)).not.toContain('export const value = 2;');
    const scoped = await submit('Conduct a review on src module', [], 'browser');
    let questionRevision = 0;
    await vi.waitFor(async () => {
      const result = await (await get(scoped)).json();
      expect(result).toMatchObject({ state: 'completed', action: 'clarify', questionOptions: ['Code review only', 'Keep Browser mode'] });
      questionRevision = result.revision;
    });
    expect((await write(scoped + '/answer', 'POST', 'owner', { revision: questionRevision, selectedOption: 0 })).status).toBe(200);
    let scopedReviewId = '';
    await vi.waitFor(async () => {
      const result = await (await get(scoped)).json();
      expect(result).toMatchObject({ state: 'completed', action: 'code', reviewId: expect.any(String),
        executionSources: [{ id: artifactId, versionId: current.artifact.versionId, hash: current.artifact.contentHash }] });
      scopedReviewId = result.reviewId;
    }, { timeout: 5000 });
    expect(await (await get(startPath + '/' + scopedReviewId)).json()).toMatchObject({ modelStatus: 'succeeded' });
    const chatDb = new DatabaseSync(join(directory, 'workspace.sqlite'), { readOnly: true });
    try {
      expect(chatDb.prepare('SELECT outcome FROM conversation_model_attempt WHERE owner = ? AND project = ?').all(owner, projectId))
        .toEqual([{ outcome: 'success' }, { outcome: 'success' }]);
    } finally { chatDb.close(); }
    const object = join(directory, 'objects', old.artifact.contentHash);
    expect(readFileSync(object)).toEqual(old.bytes);
    writeFileSync(object, Buffer.alloc(old.bytes.length));
    expect((await get(preview + '?versionId=' + old.artifact.versionId)).status).toBe(503);
    expect((await get(frozenPreview)).status).toBe(503);
    const readinessPath = path + '/readiness';
    expect((await get(readinessPath, 'other')).status).toBe(404);
    expect((await write(readinessPath, 'POST', 'other')).status).toBe(404);
    expect((await write(readinessPath, 'POST', 'owner')).status).toBe(202);
    await vi.waitFor(async () => {
      expect(await (await get(readinessPath)).json()).toMatchObject({ status: 'completed', stale: false,
        snapshot: { projectId, categories: expect.arrayContaining([expect.objectContaining({ id: 'repository' })]) } });
    }, { timeout: 5000 });
    const savedReadiness = (await reopened.readiness(owner).latest(projectId))!;
    assess.mockRejectedValueOnce(new ModelProviderError('Synthetic private provider diagnostic', { code: 'quota_exhausted', retryable: false }));
    expect((await write(readinessPath, 'POST', 'owner')).status).toBe(202);
    await vi.waitFor(async () => {
      const paused = await (await get(readinessPath)).json();
      expect(paused).toMatchObject({ status: 'paused', errorCode: 'quota_exhausted', snapshot: { id: savedReadiness.snapshot?.id } });
      expect(JSON.stringify(paused)).not.toContain('Synthetic private provider diagnostic');
    });
    const interruptedProject = reopened.createProject(owner, { name: 'Interrupted assessment fixture', description: '', workspacePath: '' });
    const interruptedPath = '/projects/' + interruptedProject.id + '/readiness';
    const interrupted = { ...savedReadiness, projectId: interruptedProject.id, requestId: randomUUID(), status: 'running' as const,
      sourceFingerprint: 'changed-while-closed', snapshot: null, completedAt: null };
    expect(() => reopened.importSnapshot(owner, interruptedProject, [], undefined, undefined, [savedReadiness])).toThrow(/another project/);
    reopened.importSnapshot(owner, interruptedProject, [], undefined, undefined, [interrupted]);
    expect(await reopened.readiness(owner).latest(interruptedProject.id)).toEqual(interrupted);
    const readinessCalls = assess.mock.calls.length;
    expect(readinessCalls).toBeGreaterThan(0);
    const readinessDb = new DatabaseSync(join(directory, 'workspace.sqlite'), { readOnly: true });
    try {
      expect(readinessDb.prepare("SELECT id FROM local_grounding_attempt WHERE owner = ? AND project = ? AND outcome = 'success'").all(owner, projectId).length)
        .toBeGreaterThan(0);
    } finally { readinessDb.close(); }
    expect(remote).not.toHaveBeenCalled();
    const calls = analyze.mock.calls.length;
    const providerCalls = providerRequests.mock.calls.length;
    const savedIndexUsage = reopened.modelUsageRecords(owner, projectId, started.id).index;
    expect(savedIndexUsage.map(item => item.metadata.embeddingInputType).sort()).toEqual(['document', 'query']);
    expect(savedIndexUsage.every(item => item.outcome === 'success')).toBe(true);
    const buildPath = path + '/repository-index/build';
    const syncPath = path + '/repository-index/sync';
    const latestIndex = await reopened.sourceIndexJobs(owner).latest(projectId, owner);
    expect(latestIndex?.state).toBe('ready');
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    restarted = new LocalWorkspace(directory);
    server = createServer(restarted);
    await new Promise<void>(done => server.listen(0, 'localhost', done));
    base = 'http://localhost:' + (server.address() as AddressInfo).port;
    expect(await (await get(usagePath + '?callKind=test')).json()).toMatchObject({ totals: { calls: 2, providerReportedTotalTokens: 16 } });
    expect(await (await get(buildPath)).json()).toMatchObject({ state: 'ready', fingerprint: latestIndex?.fingerprint });
    expect(await (await write(syncPath, 'POST', 'owner', {})).json()).toEqual({ state: 'unchanged', fingerprint: latestIndex?.fingerprint });
    expect((await get(buildPath, 'other')).status).toBe(404);
    await indexFrozenArtifacts({ workspace: restarted }, owner, projectId, [current.artifact], undefined, started.id);
    expect(providerRequests).toHaveBeenCalledTimes(providerCalls);
    expect(await (await get(startPath + '/' + started.id)).json()).toMatchObject({ id: started.id, modelStatus: 'succeeded' });
    const reviewUsagePath = usagePath + '?projectId=' + projectId + '&sessionId=' + started.id;
    expect(await (await get(reviewUsagePath)).json()).toMatchObject({ reviewUsage: expect.any(Object),
      recent: expect.arrayContaining([expect.objectContaining({ sessionId: started.id })]) });
    expect((await get(reviewUsagePath, 'other')).status).toBe(404);
    expect(await (await get(reviewUsagePath + '&scope=embedding')).json()).toMatchObject({ totals: { calls: 2, providerReportedTotalTokens: 18 } });
    expect(restarted.modelUsageRecords(owner, projectId, started.id).index).toEqual(savedIndexUsage);
    expect(await (await get(startPath + '/' + started.id + '/source-artifacts/' + artifactId + '/content')).json())
      .toMatchObject({ versionId: current.artifact.versionId, content: current.bytes.toString('base64') });
    const retrieval = await retrieveFrozenContext({ workspace: restarted }, owner, projectId, [current.artifact],
      1_000, undefined, started.id, 'value');
    expect(retrieval.selectedChunks).toEqual(expect.arrayContaining([expect.objectContaining({
      artifactId, artifactVersionId: current.artifact.versionId, content: 'export const value = 2;',
    })]));
    const identity = await describeRepositoryIndex({ workspace: restarted }, owner, projectId, [current.artifact]);
    const indexFolder = join(restarted.repositoryIndexRoot, localIndexKey(owner, projectId, identity.fingerprint));
    const selectedStage = JSON.parse(readFileSync(join(indexFolder, 'location.json'), 'utf8')) as string;
    const portableFiles = join(indexFolder, selectedStage, INDEX_RELATIVE_DIRECTORY);
    const archiveBytes = await encodeRepositorySnapshot(portableFiles, identity, await portableIndexFiles(portableFiles));
    const archives = await verifyPortableIndexArchives([{ identity, archiveSha256: repositoryIndexArchiveSha256(archiveBytes),
      contentBase64: archiveBytes.toString('base64') }], projectId, [current.artifact]);
    const archiveStage = mkdtempSync(join(tmpdir(), 'ci-archive-'));
    const archiveWorkspace = new LocalWorkspace(archiveStage);
    try {
      const configuration = restarted.modelConfigurations(owner).readModelSetting(owner, 'embedding')!;
      archiveWorkspace.importSnapshot(owner, project, [current], undefined, undefined, undefined, undefined, {
        fingerprint: 'e'.repeat(64), currentVersionIds: [current.artifact.versionId],
        repositoryIndexes: archives, ownerModelSettings: [configuration],
      });
      const beforeArchiveRestore = providerRequests.mock.calls.length;
      await indexFrozenArtifacts({ workspace: archiveWorkspace }, owner, projectId, [current.artifact]);
      expect(providerRequests).toHaveBeenCalledTimes(beforeArchiveRestore);
      const restoredContext = await retrieveFrozenContext({ workspace: archiveWorkspace }, owner, projectId, [current.artifact],
        1000, undefined, undefined, 'value');
      expect(restoredContext.selectedChunks).toEqual(expect.arrayContaining([expect.objectContaining({
        artifactId, artifactVersionId: current.artifact.versionId, content: 'export const value = 2;',
      })]));
    } finally {
      archiveWorkspace.close();
      await rm(archiveStage, { recursive: true, force: true, maxRetries: 8, retryDelay: 30 });
    }
    await expect(retrieveFrozenContext({ workspace: restarted }, 'other-owner', projectId, [current.artifact], 1_000))
      .rejects.toThrow(/local project is unavailable/);
    expect(await (await get(general)).json()).toMatchObject({ state: 'completed', action: 'explain' });
    expect(await (await get(scoped)).json()).toMatchObject({ state: 'completed', reviewId: scopedReviewId });
    expect(await (await get(reports)).json()).toMatchObject([{ id: report.reportId, checksum: report.checksums.package }]);
    expect((await fetch(base + '/local-report-download?key=' + key)).status).toBe(404);
    expect(await (await get(readinessPath)).json()).toMatchObject({ status: 'paused', errorCode: 'quota_exhausted', snapshot: { id: savedReadiness.snapshot?.id } });
    expect(await (await get(interruptedPath)).json()).toMatchObject({ status: 'failed', errorCode: 'interrupted', requestId: interrupted.requestId });
    restarted.importSnapshot(owner, interruptedProject, [], undefined, undefined, [interrupted]);
    expect(await (await get(interruptedPath)).json()).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(assess).toHaveBeenCalledTimes(readinessCalls);
    expect((await write(readinessPath, 'POST', 'owner')).status).toBe(202);
    await vi.waitFor(async () => {
      const completed = await (await get(readinessPath)).json();
      expect(completed.status).toBe('completed');
      expect(completed.snapshot.id).not.toBe(savedReadiness.snapshot?.id);
    });
    expect((await write(interruptedPath, 'POST', 'owner')).status).toBe(202);
    await vi.waitFor(async () => {
      const resolved = await (await get(interruptedPath)).json();
      expect(resolved.status).toBe('completed');
      expect(resolved.requestId).not.toBe(interrupted.requestId);
    });
    const renewed = await (await write(reportLinks, 'POST', 'owner')).json();
    expect(await (await fetch(renewed.downloads.json)).text()).toBe(reportJson);
    expect(await (await get(inventory)).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: primary.id, versionId: updatedSource.versionId }),
      expect.objectContaining({ id: secondary.id, versionId: secondary.versionId }),
    ]));
    expect(await (await get(settingsPath)).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'text', model: savedProvider.model })]));
    expect(await (await get(documentPreview)).json()).toMatchObject({ versionId: document.versionId, content: upload.content });
    expect((await get(frozenReference)).status).toBe(200);
    expect(await (await get(projectFindings)).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: finding.id, status: 'fixed' })]));
    const repeatId = randomUUID();
    const previousTurn = general.split('/').at(-1);
    expect((await write(chat, 'POST', 'owner', { id: repeatId, text: 'Repeat your previous answer', mode: 'code', permission: 'auto',
      references: [], replyToTurnId: previousTurn })).status).toBe(202);
    await vi.waitFor(async () => {
      expect(await (await get(chat + '/' + repeatId)).json()).toMatchObject({ state: 'completed',
        reply: 'A unit test checks a small part of a program.', replyTo: { turnId: previousTurn, status: 'resolved' } });
    });
    expect(analyze).toHaveBeenCalledTimes(calls);
    const heldProject = restarted.createProject(owner, { name: 'Source hold fixture', description: '', workspacePath: '' });
    const heldArtifact = { ...current.artifact, projectId: heldProject.id };
    restarted.importSnapshot(owner, heldProject, [{ ...current, artifact: heldArtifact }]);
    const heldPath = '/projects/' + heldProject.id + '/repository-index/build';
    const callsBeforeHold = providerRequests.mock.calls.length;
    const volume = vi.spyOn(fs, 'statfs').mockResolvedValueOnce({
      type: 0n, bsize: 4096n, blocks: 1n, bfree: 1n, bavail: 1n, files: 1n, ffree: 1n,
    });
    try {
      expect((await write(heldPath + '?mode=ensure', 'POST', 'owner')).status).toBe(200);
      await vi.waitFor(async () => {
        expect(await (await get(heldPath)).json()).toMatchObject({ state: 'failed', errorCode: 'local_index_disk_full' });
      });
      expect(providerRequests).toHaveBeenCalledTimes(callsBeforeHold);
    } finally {
      volume.mockRestore();
    }
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '1');
    expect((await write(heldPath, 'POST', 'owner', {})).status).toBe(200);
    await vi.waitFor(async () => {
      expect(await restarted!.sourceIndexJobs(owner).hold(heldProject.id, owner)).toMatchObject({ code: 'assessment_paused' });
      expect(await (await get(heldPath)).json()).toMatchObject({ state: 'paused', errorCode: 'assessment_paused' });
    });
    vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '0');
    expect(await (await write(heldPath + '?mode=ensure', 'POST', 'owner')).json()).toMatchObject({ state: 'paused' });
    expect(providerRequests).toHaveBeenCalledTimes(callsBeforeHold);
    expect(await (await write(heldPath, 'POST', 'owner', {})).json()).toMatchObject({ state: 'queued' });
    await vi.waitFor(async () => {
      expect(await (await get(heldPath)).json()).toMatchObject({ state: 'ready' });
    }, { timeout: 10_000 });
    expect(await restarted.sourceIndexJobs(owner).hold(heldProject.id, owner)).toMatchObject({ code: null });
    expect(providerRequests).toHaveBeenCalledTimes(callsBeforeHold + 1);
    const retryPath = startPath + '/' + retryId + '/retry';
    expect((await write(retryPath, 'POST', 'other', {})).status).toBe(404);
    expect((await write(retryPath, 'POST', 'owner', { reuseValidatedBatches: 'yes' })).status).toBe(400);
    expect((await write(retryPath, 'POST', 'owner', { reuseValidatedBatches: true, refreshSourceManifest: true })).status).toBe(409);
    writeFileSync(join(directory, 'objects', old.artifact.contentHash), old.bytes);
    const retryRequest = await write(retryPath, 'POST', 'owner', { idempotencyKey: 'retry-from-local-pilot' });
    expect(retryRequest.status).toBe(201);
    const retried = await retryRequest.json();
    await vi.waitFor(async () => {
      const review = await (await get(startPath + '/' + retried.id)).json();
      expect(review, review.failureReason).toMatchObject({ modelStatus: 'succeeded' });
    }, { timeout: 7000 });
    expect((await write(retryPath, 'POST', 'owner', { idempotencyKey: 'retry-from-local-pilot' })).status).toBe(200);
    expect(remote).not.toHaveBeenCalled();
  } finally {
    if (server.listening) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    if (providerServer.listening) await new Promise<void>((done, reject) => providerServer.close(error => error ? reject(error) : done()));
    imported.close();
    reopened.close();
    restarted?.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 30 });
  }
}, 35_000);

it('reopens staged Dynamic runs, frozen test revisions and hash-verified evidence without hosted reads', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-dynamic-history-'));
  const owner = randomUUID(), projectId = randomUUID(), missionId = randomUUID();
  const createdAt = '2026-11-24T00:00:00.000Z';
  const project = { id: projectId, ownerId: owner, name: 'Dynamic history fixture', description: '', workspacePath: '', createdAt, updatedAt: createdAt };
  const check = { id: 'check-welcome', criterionId: 'criterion-welcome', description: 'Show welcome text',
    required: true, kind: 'visible_text' as const, expected: 'Welcome' };
  const original: MissionRevision = { id: randomUUID(), missionId, projectId, revision: 1, createdBy: owner, createdAt,
    name: 'Original saved test', goal: 'Read the welcome message', targetUrl: 'http://localhost:3000', maxSteps: 3,
    checks: [check], context: null, contextAcknowledged: false };
  const current = { ...original, id: randomUUID(), revision: 2, name: 'Edited saved test' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+p8AAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(png).digest('hex');
  const ref = { id: 'recorded-screenshot', kind: 'screenshot' as const, sha256, availability: 'local' as const, capturedAt: createdAt };
  const run: DynamicRun = {
    id: randomUUID(), projectId, missionId, revision: original, idempotencyKey: 'run-one', state: 'completed',
    createdBy: owner, createdAt, updatedAt: createdAt, legacySessionId: randomUUID(), verdict: 'passed', reason: null,
    checks: [{ checkId: check.id, criterionId: check.criterionId, verdict: 'passed', observed: 'Welcome',
      evidenceIds: [ref.id], checkedAt: createdAt, reason: 'Saved observation' }],
    evidence: [ref, { ...ref, id: 'checks-with-missing-bytes', kind: 'checks', sha256: 'b'.repeat(64) }],
  };
  const active: DynamicRun = { ...run, id: randomUUID(), idempotencyKey: 'run-two', state: 'running', verdict: 'not_tested',
    createdAt: '2026-11-23T00:00:00.000Z', updatedAt: '2026-11-23T00:00:00.000Z',
    checks: [], evidence: [], lease: { workerId: 'hosted-worker', heartbeatAt: createdAt, expiresAt: createdAt } };
  const dynamicHistory: DynamicHistorySnapshot = { missions: [{ id: missionId, projectId, currentRevisionId: current.id,
    createdBy: owner, createdAt, displayName: 'Renamed test', archivedAt: createdAt, archivedBy: owner }],
  revisions: [original, current], runs: [run, active],
  evidence: [{ runId: run.id, evidenceId: ref.id, contentBase64: png.toString('base64') }] };
  const profile = { id: randomUUID(), projectId, name: 'Imported sandbox', targetUrl: 'http://localhost:3000/',
    allowedOrigins: ['http://localhost:3000'], viewport: { width: 1024, height: 768 }, accountRole: '', requiredVariables: ['TEST_SECRET'],
    startupInstructions: '', targetVersion: 'fixture', dataResourceKey: 'shared-fixture', version: 4, updatedAt: createdAt, updatedBy: owner };
  const environments = { profiles: [profile], data: [{ profileId: profile.id, state: 'in_use' as const, preparedVersion: 4,
    preparation: { note: 'Original preparation', at: createdAt, actorId: owner, profileVersion: 4 }, runId: active.id, events: [] }] };
  const reviewId = randomUUID();
  const manifestId = randomUUID();
  const review: StaticReviewRecord = { id: reviewId, projectId, name: 'Archived source Review', reviewType: 'code_review',
    status: 'approved', idempotencyKey: 'old-review', scope: {}, config: {},
    lineage: { parentReviewId: null, lineageRootId: reviewId, reusedSourceManifest: false }, sourceManifestId: manifestId,
    deterministicFindingCount: 0, modelFindingCount: 1, modelStatus: 'succeeded', summary: 'Saved summary', failureReason: '',
    progress: null, revision: 8, createdAt, updatedAt: createdAt };
  const interruptedReview: StaticReviewRecord = { ...review, id: randomUUID(), status: 'running', idempotencyKey: 'held-review',
    lineage: { parentReviewId: reviewId, lineageRootId: reviewId, reusedSourceManifest: true } };
  const frozenBytes = Buffer.from('export const archivedValue = 4;\n');
  const frozen: WorkspaceSource = { bytes: frozenBytes, mimeType: 'text/plain', artifact: {
    id: randomUUID(), versionId: randomUUID(), projectId, fileName: 'saved.ts', filePath: 'src/saved.ts', originalPath: null,
    type: 'source_code', source: 'repository', createdAt, contentHash: createHash('sha256').update(frozenBytes).digest('hex'),
  } };
  const absent = { ...frozen.artifact, id: randomUUID(), versionId: randomUUID(), contentHash: 'd'.repeat(64) };
  const findingId = randomUUID();
  const attachment = { id: randomUUID(), fileName: 'Approval note.txt', mimeType: 'text/plain', createdAt };
  const absentAttachment = { ...attachment, id: randomUUID(), fileName: 'Archived missing note.txt' };
  const note = Buffer.from('Synthetic approval note\n');
  const noteHash = createHash('sha256').update(note).digest('hex');
  const decision = { id: randomUUID(), projectId, sessionId: reviewId, decision: 'approved' as const, comment: 'Original approval',
    reviewer: owner, createdAt, attachments: [attachment, absentAttachment] };
  const reviewHistory: ReviewHistorySnapshot = {
    reviews: [review, interruptedReview], manifests: [{ id: manifestId, reviewId, mode: 'capture', artifacts: [frozen.artifact, absent], capturedAt: createdAt }],
    missingSourceVersionIds: [absent.versionId], decisions: [decision],
    decisionFiles: [{ reviewId, decisionId: decision.id, attachmentId: attachment.id, contentHash: noteHash, contentBase64: note.toString('base64') }],
    operations: [{ projectId, reviewId, operation: 'start', idempotencyKey: review.idempotencyKey, createdAt }],
    findings: [{ finding: { id: findingId, projectId, reviewId, source: 'model', title: 'Saved proof', description: 'Original description',
      severity: 'low', artifactId: frozen.artifact.id, filePath: frozen.artifact.filePath, lineNumber: 1, evidence: frozenBytes.toString().trim(),
      sourceVersion: frozen.artifact.versionId, createdAt },
    stateChanges: [
      { id: randomUUID(), projectId, findingId, actorId: owner, fromStatus: 'accepted', toStatus: 'fixed',
        comment: 'Original resolution', createdAt },
      { id: randomUUID(), projectId, findingId, actorId: owner, fromStatus: 'new', toStatus: 'accepted',
        comment: 'Original acceptance', createdAt: '2026-11-23T00:00:00.000Z' },
    ] }],
  };
  const stage = new LocalWorkspace(directory);
  const workspace = new LocalWorkspace(directory);
  const remote = vi.fn(() => { throw new Error('Hosted application data blocked by fixture.'); });
  const auth = { authenticate: async (headers: { authorization?: string }) => {
    const userId = headers.authorization === 'Bearer owner' ? owner : 'other-owner';
    return { userId, user: { id: userId }, client: { from: remote, rpc: remote, storage: { from: remote } } };
  }, requireProjectMember: remote } as unknown as AuthGateway;
  const server = createSidecarServer(auth, { localWorkspace: workspace, historyPath: join(directory, 'history.sqlite') });
  vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'fixture-environment-value-key');
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '0');
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST', projectId);
  try {
    const staging = { fingerprint: 'c'.repeat(64), currentVersionIds: [], dynamicHistory, environments, reviewHistory };
    const traceability = { requirements: [], mappings: [] };
    const load = (snapshot = staging) => stage.importSnapshot(owner, project, [frozen], traceability, undefined, undefined, undefined, snapshot);
    expect(() => load({ ...staging, dynamicHistory: { ...dynamicHistory,
      evidence: [{ runId: run.id, evidenceId: ref.id, contentBase64: Buffer.from('unverified').toString('base64') }] } })).toThrow(/checksum/);
    expect(stage.project(owner, projectId)).toBeNull();
    expect(() => load({ ...staging, reviewHistory: { ...reviewHistory, missingSourceVersionIds: [] } })).toThrow(/verified frozen Review source/);
    expect(stage.project(owner, projectId)).toBeNull();
    load();
    load();
    const otherProject = stage.createProject(owner, { name: 'Unrelated local project', description: '', workspacePath: '' });
    stage.close();
    await new Promise<void>(done => server.listen(0, 'localhost', done));
    const origin = 'http://localhost:' + (server.address() as AddressInfo).port;
    const base = '/projects/' + projectId;
    const request = (path: string, actor = 'owner', body?: object) => fetch(origin + path, {
      headers: { Authorization: 'Bearer ' + actor, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    expect(await (await request(base + '/dynamic/missions')).json()).toEqual(dynamicHistory.missions);
    expect(await (await request(base + '/dynamic/revisions/' + current.id)).json()).toEqual(current);
    const listedRuns = await (await request(base + '/dynamic/runs')).json();
    expect(listedRuns).toHaveLength(2);
    expect(listedRuns).toEqual(expect.arrayContaining([expect.objectContaining({ id: run.id, evidenceStorage: 'device' })]));
    const runPath = base + '/dynamic/runs/' + run.id;
    expect(await (await request(runPath)).json()).toEqual(run);
    expect(await (await request(base + '/dynamic/runs/' + active.id)).json()).toMatchObject({ state: 'interrupted', verdict: 'not_tested', lease: null });
    const evidencePath = runPath + '/evidence/local/';
    const proof = await request(evidencePath + ref.id);
    expect(proof.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await proof.arrayBuffer())).toEqual(png);
    expect((await request(evidencePath + 'checks-with-missing-bytes')).status).toBe(404);
    expect((await request(evidencePath + ref.id, 'other')).status).toBe(404);
    expect((await request('/projects/' + otherProject.id + '/dynamic/runs/' + run.id)).status).toBe(404);
    expect((await request(runPath, 'other')).status).toBe(404);
    const runsPath = base + '/dynamic/runs';
    const operation = 'new-local-browser-run';
    expect(await (await request(runsPath, 'owner', { revisionId: run.revision.id, idempotencyKey: run.idempotencyKey })).json()).toEqual(run);
    expect((await request(runsPath, 'owner', { revisionId: current.id, idempotencyKey: operation })).status).toBe(409);
    const reviewPath = base + '/static-sessions/' + reviewId;
    expect(await (await request(reviewPath)).json()).toMatchObject({ id: reviewId, status: 'approved', currentDecision: decision });
    expect(await (await request(reviewPath + '/decisions?limit=1')).json()).toEqual([decision]);
    expect(await (await request(reviewPath + '/findings')).json()).toMatchObject([{ id: findingId, status: 'fixed' }]);
    expect(await (await request(reviewPath + '/source-manifest')).json()).toMatchObject({
      snapshotId: manifestId, status: 'incomplete', artifactCount: 2, capturedAt: createdAt,
    });
    expect((await request(reviewPath + '/decisions', 'other')).status).toBe(404);
    const attachmentPath = reviewPath + '/decisions/' + decision.id + '/attachments/';
    expect((await request(attachmentPath + attachment.id, 'other')).status).toBe(404);
    expect((await request(attachmentPath + absentAttachment.id)).status).toBe(404);
    const download = await (await request(attachmentPath + attachment.id)).json();
    expect(download).toMatchObject({ id: attachment.id, contentHash: noteHash, fileName: attachment.fileName });
    const file = await fetch(download.signedUrl);
    expect(file.headers.get('Content-Disposition')).toContain('Approval%20note.txt');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(note);
    const invalidLink = new URL(download.signedUrl);
    invalidLink.searchParams.set('key', 'invalid');
    expect((await fetch(invalidLink)).status).toBe(404);
    const sourcePath = (review: string, artifact: string) => base + '/static-sessions/' + review + '/source-artifacts/' + artifact + '/content';
    expect(await (await request(sourcePath(interruptedReview.id, frozen.artifact.id))).json()).toMatchObject({
      versionId: frozen.artifact.versionId, content: frozenBytes.toString('base64'),
    });
    expect((await request(sourcePath(reviewId, absent.id))).status).toBe(404);
    expect(await (await request(base + '/static-sessions/' + interruptedReview.id)).json()).toMatchObject({ status: 'blocked' });
    const profilesPath = base + '/dynamic/environments';
    const profilePath = profilesPath + '/' + profile.id;
    expect(await (await request(profilesPath)).json()).toEqual([profile]);
    expect(await (await request(profilePath + '/data')).json()).toMatchObject({ state: 'cleanup_required',
      resource: { reserved: true, ownerProfileId: profile.id }, runId: active.id });
    expect((await request(profilePath + '/data', 'other')).status).toBe(404);
    const privateValue = 'fictional-environment-credential';
    expect(await (await request(profilePath + '/values', 'owner', { values: { TEST_SECRET: privateValue } })).json())
      .toEqual({ variableNames: ['TEST_SECRET'] });
    expect(await (await request(profilePath + '/values')).json()).toEqual({ variableNames: ['TEST_SECRET'] });
    expect((await request(profilePath, 'owner', { ...profile, startupInstructions: privateValue })).status).toBe(400);
    const missionsPath = base + '/dynamic/missions';
    const missionPath = missionsPath + '/' + missionId;
    const nextRevision = { ...current, name: 'New saved revision' };
    expect((await request(missionPath + '/revisions', 'owner', nextRevision)).status).toBe(409);
    expect((await request(missionPath + '/unarchive', 'other', {})).status).toBe(404);
    expect((await request(missionPath + '/unarchive', 'owner', {})).status).toBe(200);
    expect((await request(missionPath + '/rename', 'owner', { name: privateValue })).status).toBe(400);
    expect(await (await request(missionPath + '/rename', 'owner', { name: ' Updated title ' })).json())
      .toMatchObject({ currentRevisionId: current.id, displayName: 'Updated title' });
    const editedTest = await request(missionPath + '/revisions', 'owner', nextRevision);
    expect(editedTest.status).toBe(201);
    const newest = await editedTest.json();
    expect(newest).toMatchObject({ missionId, revision: 3, name: nextRevision.name });
    expect(await (await request(base + '/dynamic/revisions/' + original.id)).json()).toEqual(original);
    expect(await (await request(runPath)).json()).toEqual(run);
    expect((await request(profilePath, 'owner', { ...profile, dataResourceKey: 'different' })).status).toBe(409);
    const secondProfile = await (await request(profilesPath, 'owner', { ...profile, name: 'Second sandbox' })).json();
    const secondProfilePath = profilesPath + '/' + secondProfile.id;
    const prep = { outcome: 'completed', note: 'Check synthetic baseline before use' };
    expect((await request(secondProfilePath + '/preparation', 'owner', prep)).status).toBe(409);
    const cleanup = await request(profilePath + '/cleanup', 'owner', { outcome: 'completed', note: 'Checked synthetic cleanup' });
    expect(await cleanup.json()).toMatchObject({ state: 'unprepared', resource: { reserved: false },
      events: [{ runId: active.id, kind: 'cleanup', actorId: owner }] });
    expect(await (await request(secondProfilePath + '/preparation', 'owner', prep)).json()).toMatchObject({
      state: 'ready', preparedVersion: 1, resource: { reserved: true, ownerProfileId: secondProfile.id },
    });
    const edited = await request(secondProfilePath, 'owner', { ...secondProfile, name: 'Edited sandbox' });
    expect(await edited.json()).toMatchObject({ version: 2, name: 'Edited sandbox' });
    expect((await request(secondProfilePath, 'owner', { ...secondProfile, name: 'Stale sandbox' })).status).toBe(409);
    const reopened = new LocalWorkspace(directory);
    try {
      const [savedTest] = reopened.dynamicHistory(owner).listMissions(projectId);
      expect(savedTest.currentRevisionId).toBe(newest.id);
      expect(savedTest.displayName).toBeUndefined();
      expect(await reopened.environments(owner).get(projectId, secondProfile.id)).toMatchObject({ version: 2, name: 'Edited sandbox' });
      expect(await reopened.environments(owner).data(projectId, secondProfile.id)).toMatchObject({ state: 'unprepared',
        preparedVersion: 1, resource: { reserved: true }, events: [{ kind: 'preparation', note: prep.note }] });
    } finally { reopened.close(); }
    const exported = await request(base + '/reports/export', 'owner', { reviewId });
    expect(exported.status).toBe(200);
    const exportedReport = await exported.json();
    const report = await (await fetch(exportedReport.downloads.json)).json();
    // The original run remains authoritative after the saved test is renamed.
    expect(report.latestDynamicTest.session).toMatchObject({ id: run.id, name: original.name, status: 'success' });
    expect(report.latestReview).toMatchObject({ session: { id: reviewId }, decision });
    const unavailable = await request(runsPath, 'owner', { revisionId: newest.id, idempotencyKey: operation });
    expect(unavailable.status).toBe(409);
    expect((await unavailable.json()).error).toContain('screenshot provider');
    const repository = workspace.dynamicRuns(owner);
    expect(await repository.getRunByKey(projectId, operation)).toBeNull();
    await expect(repository.createRun(projectId, owner, newest, operation)).rejects.toThrow(/reserved target/);
    const environmentRepository = workspace.environments(owner);
    const savedProfile = await environmentRepository.get(projectId, secondProfile.id);
    const preflight = async () => checkEnvironment(savedProfile, ['TEST_SECRET'], true, async () => new Response(null, { status: 204 }),
      await environmentRepository.data(projectId, savedProfile.id));
    const incomplete = await preflight();
    const blocked = await repository.createRun(projectId, owner, newest, 'blocked-preflight', incomplete);
    expect(await repository.claimRun(projectId, blocked.run.id, 'fixture-worker', 'fixture-token', null)).toBeNull();
    await new DynamicService(repository).stop(projectId, blocked.run.id, 'blocked', 'Preflight failed.');
    expect(await environmentRepository.data(projectId, savedProfile.id)).toMatchObject({ state: 'unprepared', runId: null });
    expect((await request(secondProfilePath + '/preparation', 'owner', prep)).status).toBe(200);
    const ready = await preflight();
    await expect(repository.createRun(projectId, owner, newest, 'stale-preflight', { ...ready, version: 1 })).rejects.toThrow(/Repeat preflight/);
    expect(await repository.getRunByKey(projectId, 'stale-preflight')).toBeNull();
    const queued = await repository.createRun(projectId, owner, newest, operation, ready);
    expect(await repository.createRun(projectId, owner, newest, operation, ready)).toEqual({ run: queued.run, reused: true });
    await expect(repository.createRun(projectId, owner, newest, 'different-work', ready)).rejects.toThrow(/already active/);
    expect(await environmentRepository.data(projectId, savedProfile.id)).toMatchObject({ state: 'in_use', runId: queued.run.id });
    expect((await request(secondProfilePath + '/cleanup', 'owner', prep)).status).toBe(409);
    const claim = await repository.claimRun(projectId, queued.run.id, 'fixture-worker', 'fixture-private-token', queued.run.id);
    expect(claim).toMatchObject({ state: 'running' });
    expect(await repository.claimRun(projectId, queued.run.id, 'other-worker', 'other-token', null)).toBeNull();
    expect(await repository.heartbeatRun(projectId, queued.run.id, 'fixture-worker', 'bad-token')).toBe(false);
    expect(await repository.heartbeatRun(projectId, queued.run.id, 'fixture-worker', 'fixture-private-token')).toBe(true);
    const newlySavedPath = runsPath + '/' + queued.run.id;
    expect(await (await request(newlySavedPath)).text()).not.toContain('fixture-private-token');
    expect((await request(newlySavedPath + '/cancel', 'other', {})).status).toBe(404);
    expect(await (await request(newlySavedPath + '/cancel', 'owner', {})).json()).toMatchObject({ state: 'cancelled', lease: null });
    expect(await repository.heartbeatRun(projectId, queued.run.id, 'fixture-worker', 'fixture-private-token')).toBe(false);
    const diagnosticDir = join(workspace.dynamicRunFiles(owner, projectId), 'sessions', queued.run.id, 'logs');
    mkdirSync(diagnosticDir, { recursive: true });
    writeFileSync(join(diagnosticDir, 'console.json'), JSON.stringify({ message: 'fixture diagnostic',
      screenshotPath: '/home/fixture/private.png', cookie: 'fixture-private-cookie' }));
    const diagnosticPath = newlySavedPath + '/evidence';
    expect((await request(diagnosticPath + '/artifacts', 'other', {})).status).toBe(404);
    expect((await request(diagnosticPath + '/sync', 'owner', {})).status).toBe(409);
    const savedDiagnostics = await (await request(diagnosticPath + '/artifacts', 'owner', {})).json();
    expect(savedDiagnostics.omitted).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'trace' })]));
    expect(await (await request(diagnosticPath + '/artifacts', 'owner', {})).json()).toEqual(savedDiagnostics);
    const diagnostic = savedDiagnostics.copies.find((copy: { kind: string }) => copy.kind === 'partial_console');
    expect(diagnostic).toMatchObject({ criterionProof: false, expiresAt: null, availability: 'available' });
    const diagnosticContentPath = diagnosticPath + '/' + diagnostic.id + '/content';
    expect(await (await request(diagnosticContentPath)).json()).toEqual({ schemaVersion: 1, criterionProof: false,
      privacyVersion: 1, content: { message: 'fixture diagnostic' } });
    writeFileSync(join(diagnosticDir, 'console.json'), '{"message":"changed"}');
    expect((await request(diagnosticPath + '/artifacts', 'owner', {})).status).toBe(409);
    expect((await request(diagnosticContentPath, 'other')).status).toBe(404);
    expect(await environmentRepository.data(projectId, savedProfile.id)).toMatchObject({ state: 'cleanup_required', runId: queued.run.id });
    expect((await request(secondProfilePath + '/cleanup', 'owner', prep)).status).toBe(200);
    expect((await request(secondProfilePath + '/preparation', 'owner', prep)).status).toBe(200);
    const service = new DynamicService(repository);
    const completed = await service.start(projectId, owner, newest.id, 'complete-local-run', await preflight());
    await service.claim(projectId, completed.run.id);
    const localRef = { ...ref, id: randomUUID() };
    const checks = [{ ...run.checks[0], evidenceIds: [localRef.id] }];
    const jsonBytes = Buffer.from(JSON.stringify(checks));
    const jsonRef = { ...localRef, id: randomUUID(), kind: 'checks' as const, sha256: createHash('sha256').update(jsonBytes).digest('hex') };
    await expect(service.finish(projectId, completed.run.id, checks, [localRef, jsonRef])).rejects.toThrow(/must be retained/);
    await expect(service.finish(projectId, completed.run.id, checks, [localRef, jsonRef], undefined, () => png)).rejects.toThrow(/checksum/);
    expect(await repository.getRun(projectId, completed.run.id)).toMatchObject({ state: 'running', evidence: [] });
    expect(await environmentRepository.data(projectId, savedProfile.id)).toMatchObject({ state: 'in_use', runId: completed.run.id });
    const completedRun = await service.finish(projectId, completed.run.id, checks, [localRef, jsonRef], undefined,
      item => item.id === localRef.id ? png : jsonBytes);
    expect(completedRun).toMatchObject({ state: 'completed', verdict: 'passed', evidence: [localRef, jsonRef] });
    const completedPath = runsPath + '/' + completed.run.id;
    const storedScreenshot = await request(completedPath + '/evidence/local/' + localRef.id);
    expect(Buffer.from(await storedScreenshot.arrayBuffer())).toEqual(png);
    const storedChecks = await request(completedPath + '/evidence/local/' + jsonRef.id);
    expect(await storedChecks.json()).toEqual(checks);
    const copiesPath = completedPath + '/evidence';
    const savedCopies = await (await request(copiesPath + '/sync', 'owner', {})).json();
    expect(savedCopies).toHaveLength(2);
    const screenshotCopy = savedCopies.find((copy: { evidenceId: string }) => copy.evidenceId === localRef.id);
    expect(Buffer.from(await (await request(copiesPath + '/' + screenshotCopy.id + '/content')).arrayBuffer())).toEqual(png);
    const deletion = await (await request(copiesPath + '/' + screenshotCopy.id + '/delete', 'owner', {})).json();
    expect(deletion).toMatchObject({ availability: 'deleted', sha256: localRef.sha256 });
    expect((await request(copiesPath + '/' + screenshotCopy.id + '/content')).status).toBe(409);
    expect(Buffer.from(await (await request(completedPath + '/evidence/local/' + localRef.id)).arrayBuffer())).toEqual(png);
    const diagnosticReport = await workspace.dynamicReports(owner).capture(projectId, queued.run.id, randomUUID());
    expect(diagnosticReport.evidenceCopies).toEqual(expect.arrayContaining([diagnostic]));
    expect(diagnosticReport.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({
      id: diagnostic.evidenceId, kind: 'partial_console', criterionProof: false,
    })]));
    expect(await environmentRepository.data(projectId, savedProfile.id)).toMatchObject({ state: 'cleanup_required', runId: completed.run.id });
    try {
      expect(await reopened.dynamicRuns(owner).getRun(projectId, queued.run.id)).toMatchObject({
        id: queued.run.id, state: 'cancelled', revision: { id: newest.id },
      });
      expect(await reopened.dynamicRuns(owner).getRun(projectId, completed.run.id)).toEqual(completedRun);
      expect(reopened.evidenceCopies(owner).list(projectId, completed.run.id)).toEqual(expect.arrayContaining([deletion]));
      expect(JSON.parse(reopened.evidenceCopies(owner).content(projectId, queued.run.id, diagnostic.id).bytes.toString())).toMatchObject({
        content: { message: 'fixture diagnostic' }, criterionProof: false,
      });
    } finally {
      reopened.close();
    }
    writeFileSync(join(directory, 'objects', sha256), 'corrupted');
    expect((await request(evidencePath + ref.id)).status).toBe(503);
    expect(remote).not.toHaveBeenCalled();
  } finally {
    if (server.listening) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    stage.close();
    workspace.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 30 });
  }
});

it('starts saved Browser Runs and Auto Tests from desktop and chat with hosted application data blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-local-browser-run-'));
  const owner = randomUUID();
  const workspace = new LocalWorkspace(directory);
  const html = `<!doctype html><title>Test fixture</title><h1>Welcome to the fixture</h1><button id="continue">Continue</button>
    <label for="upload">Sample file</label><input type="file" id="upload"><p id="receipt"></p>
    <a id="fixture" href="/fixture.txt" download>Download sample</a>
    <script>document.querySelector('#upload').addEventListener('change', async event => {
      const response = await fetch('/fixture-upload', { method: 'POST', body: event.target.files[0] });
      if (response.ok) document.querySelector('#receipt').textContent = 'Sample file received';
    });</script>`;
  const project = workspace.createProject(owner, { name: 'Local welcome page', description: '', workspacePath: '' });
  const remote = vi.fn(() => { throw new Error('Hosted application data blocked by fixture.'); });
  const auth = { authenticate: async (headers: { authorization?: string }) => {
    const userId = headers.authorization === 'Bearer owner' ? owner : randomUUID();
    return { userId, user: { id: userId }, client: { from: remote, rpc: remote, storage: { from: remote } } };
  }, requireProjectMember: remote } as unknown as AuthGateway;
  const retainedCookie = 'synthetic-session-cookie-148';
  const requestsWithSession = vi.fn();
  const fixtureBytes = Buffer.from('public synthetic browser fixture');
  const transfers = { upload: vi.fn<(bytes: Buffer) => void>(), download: vi.fn() };
  const page = createProviderServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/fixture-upload') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      transfers.upload(Buffer.concat(chunks));
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/fixture.txt') {
      transfers.download();
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': fixtureBytes.length,
        'Content-Disposition': 'attachment; filename="fixture.txt"' }).end(fixtureBytes);
      return;
    }
    if (request.method === 'GET' && request.url === '/' && request.headers.cookie === 'qa=' + retainedCookie) requestsWithSession();
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'qa=' + retainedCookie + '; HttpOnly; Path=/' });
    response.end(html);
  });
  const modelCalls = vi.fn();
  const fileActions: object[] = [];
  const provider = createProviderServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    const { messages } = JSON.parse(Buffer.concat(parts).toString('utf8')) as { messages: Array<{ role: string; content: string }> };
    const system = messages.find(message => message.role === 'system')!.content;
    let result: object;
    if (system.includes('senior QA engineer planning')) {
      result = { reply: 'I will check the welcome heading.', tests: [{ name: 'Welcome heading', goal: 'Read the visible heading',
        rationale: 'The heading identifies the page.', startPath: '/', requirementRef: null, sourceRefs: [], controls: [],
        checks: [{ kind: 'visible_text', description: 'The welcome heading appears.', expected: 'Welcome to the fixture', selector: null }],
      }] };
    } else if (system.includes('understand saved software quality evidence')) {
      const prompt = messages.find(message => message.role === 'user')!.content.split('\n', 1)[0];
      const supplied = JSON.parse(prompt) as { evidence: Array<{ id: string; text: string }> };
      const evidence = supplied.evidence.find(item => item.id.startsWith('browser:'))!;
      result = { action: 'browser', reply: 'Run the saved welcome test against the current page.', scope: [], questionOptions: [],
        citations: [evidence.id], claims: [{ citation: evidence.id, excerpt: 'Welcome to the fixture' }] };
    } else {
      result = fileActions.shift() ?? { action: 'finish_success', summary: 'Evaluate the welcome criterion.', reasoning: 'The welcome page is visible.' };
    }
    modelCalls(request.url);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }));
  });
  let server = createSidecarServer(auth, { localWorkspace: workspace, localBrowserHeadless: true, historyPath: join(directory, 'history.sqlite') });
  const listen = async (listener: ReturnType<typeof createProviderServer>) => {
    await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
    return 'http://127.0.0.1:' + (listener.address() as AddressInfo).port;
  };
  const close = async (listener: ReturnType<typeof createProviderServer>) => {
    if (listener.listening) await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
  };
  vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'fixture-browser-model-key');
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '0');
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST', project.id);
  let reopened: LocalWorkspace | undefined;
  try {
    const targetUrl = await listen(page);
    const providerUrl = await listen(provider);
    let base = await listen(server);
    const request = (path: string, method = 'GET', body?: object, actor = 'owner') => fetch(base + path, {
      method, headers: { Authorization: 'Bearer ' + actor, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const model = { provider: 'custom', apiFormat: 'openai-compatible', model: 'local-browser-fixture',
      baseUrl: providerUrl + '/v1/chat/completions', apiKey: 'fictional-browser-provider-key' };
    expect((await request('/settings/ai/shared', 'PUT', { ...model, saveOnly: true })).status).toBe(200);
    expect((await request('/settings/ai/shared/use', 'POST', { slot: 'api', model: model.model })).status).toBe(200);
    const dynamic = '/projects/' + project.id + '/dynamic';
    const projectPath = '/projects/' + project.id;
    const emptyProject = await (await request(projectPath)).json();
    expect(emptyProject).toMatchObject({ workspacePath: '', managedWorkspaceReady: false, managedWorkspacePath: expect.any(String) });
    const autoTestInput = { request: 'Check that the page shows the welcome heading.', startupPermission: 'ask' };
    expect((await request(dynamic + '/autonomous', 'POST', autoTestInput)).status).toBe(400);
    writeFileSync(join(emptyProject.managedWorkspacePath, 'index.html'), html);
    expect(await (await request(projectPath)).json()).toMatchObject({
      workspacePath: '', managedWorkspaceReady: true, managedWorkspacePath: emptyProject.managedWorkspacePath,
    });
    const saved = await request(dynamic + '/missions', 'POST', {
      name: 'Welcome check', goal: 'Read the welcome heading', targetUrl, maxSteps: 2, context: null,
      checks: [{ id: 'welcome', criterionId: 'welcome', required: true, kind: 'visible_text',
        expected: 'Welcome to the fixture', description: 'The welcome heading appears.' }],
    });
    expect(saved.status).toBe(201);
    const revision = await saved.json();
    const savedEnvironment = await request(dynamic + '/environments', 'POST', {
      name: 'Local fixture', targetUrl, allowedOrigins: [targetUrl], viewport: { width: 800, height: 600 },
      accountRole: '', requiredVariables: [], startupInstructions: '', targetVersion: 'fixture',
      sessionReference: 'fixture-session', sessionReadySelector: 'h1',
    });
    expect(savedEnvironment.status).toBe(201);
    const environment = await savedEnvironment.json();
    const profilePath = dynamic + '/environments/' + environment.id;
    const sessionPath = profilePath + '/session';
    const capture = await (await request(sessionPath, 'POST', { operation: 'open' })).json();
    expect(capture).toMatchObject({ state: 'open', captureId: expect.any(String) });
    expect(await (await request(profilePath + '/data')).json()).toMatchObject({ state: 'preparing', resource: { reserved: true } });
    expect((await request(profilePath + '/preparation', 'POST', { outcome: 'completed', note: 'Fixture prepared' })).status).toBe(409);
    const saveSession = { operation: 'save', captureId: capture.captureId, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    expect((await request(sessionPath, 'POST', saveSession, 'other')).status).toBe(404);
    const captured = await (await request(sessionPath, 'POST', saveSession)).json();
    expect(captured).toMatchObject({ availability: 'available', version: expect.any(String) });
    expect(JSON.stringify(captured)).not.toContain(retainedCookie);
    expect(await (await request(profilePath + '/data')).json()).toMatchObject({ state: 'unprepared' });
    const selectorScan = dynamic + '/control-discovery';
    expect((await request(selectorScan, 'POST', { targetUrl: providerUrl, environmentId: environment.id })).status).toBe(400);
    const selectors = await (await request(selectorScan, 'POST', { targetUrl, environmentId: environment.id })).json();
    expect(selectors.controls).toEqual(expect.arrayContaining([expect.objectContaining({ selector: '#continue' })]));
    expect(requestsWithSession).toHaveBeenCalled();
    requestsWithSession.mockClear();
    expect((await request(profilePath + '/preparation', 'POST', { outcome: 'completed', note: 'Fixture prepared' })).status).toBe(200);
    const input = { revisionId: revision.id, environmentId: environment.id, idempotencyKey: 'run-welcome' };
    const pending = await request(dynamic + '/runs', 'POST', input);
    expect(pending.status).toBe(201);
    const { id } = await pending.json();
    const runPath = dynamic + '/runs/' + id;
    await expect.poll(async () => (await (await request(runPath)).json()).state, { timeout: 15_000 }).not.toMatch(/queued|running/);
    const completed = await (await request(runPath)).json();
    expect(completed).toMatchObject({ state: 'completed', verdict: 'passed', checks: [{ verdict: 'passed' }],
      evidence: [{ kind: 'screenshot' }, { kind: 'checks' }] });
    expect(requestsWithSession).toHaveBeenCalled();
    expect(JSON.stringify(completed)).not.toContain(retainedCookie);
    const uploadsPath = profilePath + '/uploads';
    const fixture = { name: 'sample.txt', mimeType: 'text/plain', base64: fixtureBytes.toString('base64'), publicTestData: true };
    expect((await request(uploadsPath, 'POST', fixture, 'other')).status).toBe(404);
    expect((await request(uploadsPath, 'POST', { ...fixture, base64: Buffer.from(retainedCookie).toString('base64') })).status).toBe(400);
    const uploaded = await request(uploadsPath, 'POST', fixture);
    expect(uploaded.status).toBe(201);
    const upload = await uploaded.json();
    const grant = { id: upload.id, selector: '#upload', sha256: upload.sha256, bytes: upload.bytes, mimeType: upload.mimeType };
    expect(await (await request(uploadsPath + '/permissions', 'POST', { version: environment.version, uploads: [grant] })).json())
      .toMatchObject({ version: environment.version + 1, actionPolicy: { uploads: [grant] } });
    expect((await request(uploadsPath + '/permissions', 'POST', { version: environment.version, uploads: [grant] })).status).toBe(409);
    const download = { selector: '#fixture', url: targetUrl + '/fixture.txt', maxBytes: 100, mimeType: 'text/plain', publicTestData: true };
    expect(await (await request(profilePath + '/downloads', 'POST', { version: environment.version + 1, downloads: [download] })).json())
      .toMatchObject({ version: environment.version + 2, actionPolicy: { downloads: [download], uploads: [grant] } });
    expect(modelCalls.mock.calls).toEqual([['/v1/chat/completions']]);
    expect(await (await request(profilePath + '/data')).json()).toMatchObject({ state: 'cleanup_required', runId: id });
    const screenshot = await request(runPath + '/steps/final/screenshot');
    expect(screenshot.headers.get('content-type')).toBe('image/png');
    const bytes = Buffer.from(await screenshot.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(completed.evidence[0].sha256);
    expect(await (await request('/settings/ai/usage?callKind=dynamic')).json()).toMatchObject({ totals: { calls: 1, input: 12, output: 8 } });
    expect((await request(runPath + '/steps/final/screenshot', 'GET', undefined, 'other')).status).toBe(404);

    const fileRevision = await request(dynamic + '/missions', 'POST', { name: 'File delivery', goal: 'Round trip fixture files',
      targetUrl, maxSteps: 4, context: null, checks: [
        { id: 'receipt', criterionId: 'receipt', required: true, kind: 'visible_text', expected: 'Sample file received',
          description: 'Target received the upload.' },
        { id: 'digest', criterionId: 'digest', required: true, kind: 'download_sha256', url: download.url, expected: upload.sha256,
          description: 'Download matches the approved fixture hash.' },
      ] });
    expect(fileRevision.status).toBe(201);
    expect((await request(profilePath + '/cleanup', 'POST', { outcome: 'completed', note: 'Prior fixture run cleared' })).status).toBe(200);
    expect((await request(profilePath + '/preparation', 'POST', { outcome: 'completed', note: 'File fixture prepared' })).status).toBe(200);
    fileActions.push({ action: 'upload_file', selector: '#upload', fixtureId: upload.id, reasoning: 'Use the approved fixture.' },
      { action: 'download_file', selector: '#fixture', reasoning: 'Capture the approved public fixture.' });
    const fileStart = await request(dynamic + '/runs', 'POST', { revisionId: (await fileRevision.json()).id,
      environmentId: environment.id, idempotencyKey: 'run-with-actual-files' });
    expect(fileStart.status).toBe(201);
    const filePath = dynamic + '/runs/' + (await fileStart.json()).id;
    await expect.poll(async () => (await (await request(filePath)).json()).state, { timeout: 20_000 }).not.toMatch(/queued|running/);
    const fileRun = await (await request(filePath)).json();
    expect(fileRun, JSON.stringify({ state: fileRun.state, reason: fileRun.reason, checks: fileRun.checks })).toMatchObject({
      state: 'completed', verdict: 'passed', checks: [{ verdict: 'passed' }, { verdict: 'passed', observed: 'Captured SHA-256: ' + upload.sha256 }],
    });
    expect(transfers.upload.mock.calls).toEqual([[fixtureBytes]]);
    expect(transfers.download).toHaveBeenCalledTimes(1);
    const manifestRef = fileRun.evidence.find((item: { kind: string }) => item.kind === 'file_manifest');
    const savedManifest = await (await request(filePath + '/evidence/local/' + manifestRef.id)).json();
    expect(savedManifest.downloads).toMatchObject([{ sha256: upload.sha256, bytes: fixtureBytes.length, permissionUrl: download.url }]);
    const savedDownload = savedManifest.downloads[0];
    const downloadedPath = filePath + '/downloads/' + savedDownload.id;
    expect(await (await request(downloadedPath)).json()).toMatchObject({ ...savedDownload, base64: fixture.base64 });
    expect((await request(downloadedPath, 'GET', undefined, 'other')).status).toBe(404);
    const copyRoute = filePath + '/evidence';
    const copies = await request(copyRoute + '/artifacts', 'POST', {});
    expect(copies.status).toBe(200);
    const copy = (await copies.json()).copies[0];
    expect(copy).toMatchObject({ kind: 'download', criterionProof: false, sha256: upload.sha256 });
    const copiedPath = copyRoute + '/' + copy.id + '/content';
    const startAutoTest = await request(dynamic + '/autonomous', 'POST', autoTestInput);
    expect(startAutoTest.status).toBe(202);
    const autoTestId = (await startAutoTest.json()).id;
    const autoTestPath = dynamic + '/autonomous/' + autoTestId;
    await expect.poll(async () => (await (await request(autoTestPath)).json()).stage, { timeout: 20_000 }).toMatch(/completed|failed|cancelled/);
    const session = await (await request(autoTestPath)).json();
    expect(session).toMatchObject({ stage: 'completed', summary: { passed: 1 }, tests: [{ state: 'passed' }] });
    const testId = session.tests[0].id;
    const conversation = '/projects/' + project.id + '/conversation-requests';
    const conversationId = randomUUID();
    const turnPath = conversation + '/' + conversationId;
    expect((await request(conversation, 'POST', { id: conversationId, mode: 'browser', permission: 'ask',
      text: 'Run this saved browser check again.', references: [{ autoTestId, testId }] })).status).toBe(202);
    await expect.poll(async () => (await (await request(turnPath)).json()).state, { timeout: 10_000 }).toMatch(/awaiting_permission|failed/);
    const awaiting = await (await request(turnPath)).json();
    expect(awaiting.state, JSON.stringify({ stage: awaiting.failureStage, reason: awaiting.validationReason })).toBe('awaiting_permission');
    expect(awaiting.autoTestId).toBeUndefined();
    expect(await (await request(dynamic + '/autonomous')).json()).toHaveLength(1);
    expect((await request(turnPath + '/confirm', 'POST', { revision: awaiting.revision }, 'other')).status).toBe(404);
    expect((await request(turnPath + '/confirm', 'POST', { revision: awaiting.revision })).status).toBe(202);
    await expect.poll(async () => (await (await request(turnPath)).json()).state, { timeout: 20_000 }).toMatch(/completed|failed|cancelled/);
    const turn = await (await request(turnPath)).json();
    expect(turn).toMatchObject({ state: 'completed', verificationBindings: [expect.objectContaining({ criteriaHash: expect.any(String) })] });
    expect(turn.autoTestId).not.toBe(autoTestId);
    const childPath = dynamic + '/autonomous/' + turn.autoTestId;
    const child = await (await request(childPath)).json();
    expect(child).toMatchObject({ stage: 'completed', tests: [{ state: 'passed', checks: session.tests[0].checks }] });
    expect((await request(childPath, 'GET', undefined, 'other')).status).toBe(404);
    expect(await (await request('/settings/ai/usage?callKind=dynamic')).json()).toMatchObject({ totals: { calls: 7, input: 84, output: 56 } });
    await close(server);
    workspace.close();
    reopened = new LocalWorkspace(directory);
    server = createSidecarServer(auth, { localWorkspace: reopened, localBrowserHeadless: true, historyPath: join(directory, 'history.sqlite') });
    base = await listen(server);
    expect(await (await request(runPath)).json()).toEqual(completed);
    expect(await (await request(projectPath)).json()).toMatchObject({ managedWorkspaceReady: true, managedWorkspacePath: emptyProject.managedWorkspacePath });
    expect(await (await request(sessionPath)).json()).toMatchObject({ session: { availability: 'available', version: captured.version } });
    expect(await (await request(uploadsPath)).json()).toMatchObject([{ id: upload.id, sha256: grant.sha256 }]);
    expect(await (await request(downloadedPath)).json()).toMatchObject({ ...savedDownload, base64: fixture.base64 });
    expect((await request(downloadedPath, 'DELETE')).status).toBe(200);
    expect((await request(downloadedPath)).status).toBe(404);
    expect(Buffer.from(await (await request(copiedPath)).arrayBuffer())).toEqual(fixtureBytes);
    expect(await (await request(runPath + '/steps')).json()).toMatchObject({ state: 'completed', finalScreenshot: true });
    expect((await request(dynamic + '/runs', 'POST', input)).status).toBe(200);
    expect(await (await request(childPath)).json()).toEqual(child);
    expect(await (await request(turnPath)).json()).toEqual(turn);
    expect(modelCalls).toHaveBeenCalledTimes(8);
    expect(remote).not.toHaveBeenCalled();
  } finally {
    await Promise.all([close(server), close(page), close(provider)]);
    workspace.close();
    reopened?.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 30 });
  }
}, 60_000);

it('stores connected source runs and exact file versions with hosted access limited to App Connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-connected-source-'));
  const owner = randomUUID();
  const device = new LocalWorkspace(directory);
  const project = device.createProject(owner, { name: 'Connected fixture', description: '', workspacePath: '' });
  const blocked = vi.fn(() => { throw new Error('Hosted project data access blocked'); });
  const readIntegration = vi.fn();
  const authenticate = async (headers: { authorization?: string }) => {
    if (!headers.authorization) throw new AuthGatewayError('Sign in.', 401, 'unauthenticated');
    const userId = headers.authorization === 'Bearer owner' ? owner : 'other-owner';
    const integration = { id: 'fixture-connection', owner_id: owner, provider: 'github', account_label: 'Fixture', account_id: '1',
      token_reference: encryptSecret(JSON.stringify({ accessToken: 'fictional-github-key' })), scopes: 'repo', status: 'connected' };
    const from = (table: string) => {
      if (table !== 'integrations') return blocked();
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => { readIntegration(userId); return { data: userId === owner ? integration : null }; } };
      return query;
    };
    return { userId, user: { id: userId }, client: { from, storage: { from: blocked }, rpc: blocked } };
  };
  const auth = { authenticate, requireProjectMember: blocked } as unknown as AuthGateway;
  let revision = 'one';
  const first = 'export const display = 1;\n';
  const second = 'export const display = 2;\n';
  const listItems = vi.fn<ConnectedSourceProviderAdapter['listItems']>(async (credentials) => {
    expect(credentials.accessToken).toBe('fictional-github-key');
    return { nextCursor: null, done: true, completeSnapshot: true, items: revision === 'removed' ? [] : [{ remoteId: 'display-item',
      path: 'src/display.ts', name: 'display.ts', mimeType: 'text/plain', revision, metadata: {},
      content: Buffer.from(revision === 'one' ? first : second) }] };
  });
  const adapters: ConnectedSourceProviderAdapter[] = [{ provider: 'github', browse: async () => ({ entries: [], nextCursor: null }),
    prepareSync: async () => ({ remoteRevision: revision, cursor: null }), listItems }];
  const create = (workspace: LocalWorkspace) => createSidecarServer(auth, { localWorkspace: workspace,
    localSourceFixtureAdapters: adapters, historyPath: join(directory, 'history.sqlite') });
  let server = create(device);
  let reopened: LocalWorkspace | undefined;
  vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'fictional-connected-source-encryption-key');
  vi.stubEnv('CENTINEL_AI_ASSESSMENT_PAUSED', '1');
  const close = () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  let base = '';
  const start = async () => {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  };
  const request = (path: string, body?: object, account = 'owner') => fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + account, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const projectPath = '/projects/' + project.id;
  const sources = projectPath + '/sources';
  try {
    await start();
    expect(await (await request(sources)).json()).toEqual([]);
    expect((await request(sources, undefined, 'other')).status).toBe(404);
    expect(readIntegration).not.toHaveBeenCalled();
    const created = await request(sources, { provider: 'github', remoteId: 'fictional/display', name: 'Display', kind: 'github_repository', idempotencyKey: 'first' });
    expect(created.status).toBe(201);
    const { source, syncResult } = await created.json();
    expect(syncResult).toMatchObject({ complete: true, imported: 1 });
    const artifacts = projectPath + '/artifacts';
    const [original] = await (await request(artifacts)).json();
    expect(original).toMatchObject({ projectId: project.id, sourceId: source.id, filePath: `connected/${source.id}/src/display.ts` });
    const sync = sources + '/' + source.id + '/sync';
    const history = sources + '/' + source.id + '/sync-history';
    expect(await (await request(sync, { idempotencyKey: 'first' })).json()).toMatchObject({ run: { id: syncResult.run.id } });
    expect(listItems).toHaveBeenCalledTimes(1);
    revision = 'two';
    expect(await (await request(sync, { idempotencyKey: 'second' })).json()).toMatchObject({ complete: true, updated: 1 });
    const [updated] = await (await request(artifacts)).json();
    expect(updated.id).toBe(original.id);
    expect(updated.versionId).not.toBe(original.versionId);
    const preview = artifacts + '/' + original.id + '/content';
    expect(await (await request(preview + '?versionId=' + original.versionId)).json()).toMatchObject({ content: Buffer.from(first).toString('base64') });
    expect(await (await request(preview)).json()).toMatchObject({ content: Buffer.from(second).toString('base64') });
    const journal = device.connectedSources(owner);
    const queued = await journal.startSyncRun(source, 'recovery');
    expect(await journal.startSyncRun(source, 'recovery')).toEqual(queued);
    const staged = new LocalWorkspace(join(directory, 'staged'));
    try {
      const snapshot = { sources: await journal.listSources(project.id), items: await journal.listSourceItems(source.id), runs: await journal.listSyncRuns(source.id) };
      expect(() => staged.importSnapshot(owner, project, [], undefined, undefined, undefined, snapshot)).toThrow(/unavailable frozen bytes/);
      expect(staged.project(owner, project.id)).toBeNull();
      // Entries can arrive out of chronological order in an export.
      const versions = [updated, original].map((artifact, index) => ({ artifact, bytes: Buffer.from(index ? first : second), mimeType: 'text/plain' }));
      const receipt = { fingerprint: 'a'.repeat(64), currentVersionIds: [updated.versionId] };
      const importStaged = (selection = receipt) =>
        staged.importSnapshot(owner, project, versions, undefined, undefined, undefined, snapshot, selection);
      expect(() => importStaged({ ...receipt, currentVersionIds: [original.versionId, updated.versionId] })).toThrow(/current-source manifest/);
      expect(staged.project(owner, project.id)).toBeNull();
      importStaged();
      expect(staged.artifacts(owner, project.id)).toMatchObject([{ versionId: updated.versionId }]);
      expect(staged.sourceBytes(owner, project.id, original.id, original.versionId)?.content.toString()).toBe(first);
      expect(staged.removeCurrentArtifact(owner, project.id, original.id)).toBe(true);
      importStaged();
      expect(staged.artifacts(owner, project.id)).toEqual([]);
      expect(() => importStaged({ ...receipt, fingerprint: 'b'.repeat(64) })).toThrow(/different copy/);
      expect(await staged.connectedSources(owner).listSyncRuns(source.id)).toMatchObject(snapshot.runs.map(run => ({ id: run.id, leaseExpiresAt: null })));
      expect(await staged.connectedSources(owner).listSourceItems(source.id)).toMatchObject([{ id: snapshot.items[0].id, artifactVersionId: updated.versionId }]);
    } finally { staged.close(); }
    await close();
    reopened = new LocalWorkspace(directory);
    server = create(reopened);
    await start();
    await vi.waitFor(async () => {
      expect(await (await request(sources)).json()).toMatchObject([{ id: source.id, latestSyncRun: { id: queued.id, status: 'success' } }]);
    });
    expect(await (await request(history)).json()).toHaveLength(3);
    expect(await (await request(preview)).json()).toMatchObject({ versionId: updated.versionId });
    revision = 'removed';
    expect(await (await request(sync, { idempotencyKey: 'third' })).json()).toMatchObject({ complete: true, removed: 1 });
    expect(await (await request(artifacts)).json()).toEqual([]);
    expect(await (await request(preview + '?versionId=' + original.versionId)).json()).toMatchObject({ versionId: original.versionId });
    revision = 'one';
    const bootstrap = await request('/projects', { name: 'GitHub bootstrap fixture',
      sources: [{ type: 'github', repoUrl: 'https://github.com/fictional/bootstrap.git' }] });
    expect(bootstrap.status).toBe(201);
    const createdProject = await bootstrap.json();
    expect(createdProject.sourceImportWarnings).toBeUndefined();
    expect(createdProject).toMatchObject({ workspacePath: '', managedWorkspaceReady: false, managedWorkspacePath: expect.any(String) });
    await vi.waitFor(async () => {
      expect(await (await request('/projects/' + createdProject.id + '/sources')).json()).toMatchObject([
        { remoteId: 'fictional/bootstrap', latestSyncRun: { status: 'success' } },
      ]);
      expect(await (await request('/projects/' + createdProject.id + '/artifacts')).json()).toMatchObject([{ fileName: 'display.ts' }]);
    }, { timeout: 5000 });
    expect(await (await request('/projects/' + createdProject.id)).json()).toMatchObject({
      managedWorkspaceReady: false, managedWorkspacePath: createdProject.managedWorkspacePath,
    });
    expect((await request('/projects/' + createdProject.id, undefined, 'other')).status).toBe(404);
    expect(blocked).not.toHaveBeenCalled();
  } finally {
    if (server.listening) await close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 30 });
  }
});
