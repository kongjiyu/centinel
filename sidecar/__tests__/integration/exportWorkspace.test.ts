import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthGateway } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import { exportOwnerWorkspace, readOnlyMigrationFetch } from '../../src/migration/exportWorkspace.js';
import { LocalReportRoutes } from '../../src/report/localRoutes.js';
import { reportFileChecksums } from '../../src/report/storage.js';
import { LocalWorkspace } from '../../src/store/localWorkspace.js';
import { LocalHistory } from '../../src/store/localHistory.js';
import { listModelProviderSettings } from '../../src/modelSettings.js';
import { resolveModelProviderChain } from '../../src/review/modelProviderResolver.js';
import { encryptSecret } from '../../src/tokenVault.js';
import { repositoryIndexIdentity, repositorySnapshotPath } from '../../src/review/repositoryIndexSnapshot.js';
import { repositoryIndexPublicationId } from '../../src/review/repositoryIndexSync.js';
import { batchCacheReceiptId, canonicalBatchCacheJson, type ValidatedBatchCacheRecord } from '../../src/review/batchCheckpoint.js';

beforeEach(() => vi.stubEnv('CENTINEL_TOKEN_ENCRYPTION_KEY', 'synthetic-migration-key'));
afterEach(() => vi.unstubAllEnvs());

const fixtureOrigin = 'https://migration-fixture.invalid';
const owner = randomUUID(), project = randomUUID(), artifact = randomUUID(), profile = randomUUID();
const review = randomUUID(), manifest = randomUUID(), finding = randomUUID(), decision = randomUUID(), attachment = randomUUID();
const lineageRootId = randomUUID();
const mission = randomUUID(), revision = randomUUID(), runId = randomUUID(), copy = randomUUID(), expired = randomUUID();
const stoppedRun = randomUUID(), diagnosticId = randomUUID(), diagnosticCopy = randomUUID(), registeredOnly = randomUUID();
const dynamicFinding = randomUUID(), observation = randomUUID(), findingEvent = randomUUID();
const dynamicReport = randomUUID();
const unitRun = randomUUID(), unitReport = randomUUID(), unitEvent = randomUUID();
const hookId = randomUUID();
const legacySession = randomUUID(), legacyScreenshot = randomUUID(), legacyMissing = randomUUID();
const reportId = randomUUID(), missingReport = randomUUID(), originalActor = randomUUID();
const stamp = '2026-11-24T00:00:00.000Z';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const approvalBytes = Buffer.from('Synthetic archived approval\n');
const checkResult = { checkId: 'welcome', criterionId: 'greeting', verdict: 'failed', observed: '',
  reason: 'The saved greeting was missing.', checkedAt: stamp, evidenceIds: ['check-evidence', 'expired-evidence'] };
const checksBytes = Buffer.from(JSON.stringify([checkResult]));
const legacyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+p8AAAAASUVORK5CYII=', 'base64');
const legacyImagePath = project + '/legacy/' + legacySession + '/screenshot.png';
const evidencePath = [project, 'dynamic-v1', runId, copy, hash(checksBytes) + '.json'].join('/');
const diagnosticBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, criterionProof: false, privacyVersion: 1,
  content: { message: 'The saved browser stopped.' } }));
const diagnosticPath = [project, 'dynamic-v1', stoppedRun, diagnosticCopy, hash(diagnosticBytes) + '.json'].join('/');
const batchRecord: ValidatedBatchCacheRecord = { version: 1, ownerId: owner, projectId: project, originReviewId: review,
  requestHash: '7'.repeat(64), policyVersion: 'fixture-policy', validationVersion: 'fixture-validator', providerFingerprint: '8'.repeat(64),
  generation: { findings: [], featureAssessments: [] }, supportRecords: [] };
const outputFiles = { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' };
const reportPackages = [reportId, missingReport].map(id => {
  const snapshot = { project: { id: project, name: 'Synthetic saved project' }, metadata: { reportId: id, actorId: originalActor,
    generatedAt: stamp, generatorVersion: 'fixture-v1', riskPolicyVersion: 'fixture-policy', outputFiles } };
  const files = { json: Buffer.from(JSON.stringify(snapshot) + '\r\n'), markdown: Buffer.from('# Original report\r\n'),
    pdf: Buffer.from('%PDF-1.7\n% Synthetic report content\n%%EOF') };
  return { files, row: { id, project_id: project, actor_id: originalActor, created_at: stamp, generator_version: 'fixture-v1',
    policy_version: 'fixture-policy', snapshot, checksum: reportFileChecksums(files).package } };
}).sort((a, b) => a.row.id.localeCompare(b.row.id));
const versions = [Buffer.from('old code\r\n'), Buffer.from('new code\n')].map((bytes, index) => {
  const digest = hash(bytes);
  return {
    bytes, metadata: { id: randomUUID(), project_id: project, artifact_id: artifact, version_number: index + 1,
      content_hash: digest, byte_size: bytes.length, content_type: 'text/plain', created_at: stamp, storage_path: `${project}/${artifact}/${digest}` },
  };
});
const indexIdentity = repositoryIndexIdentity({ projectId: project,
  embedding: { provider: 'none', model: 'structural-only', dimensions: 0, endpointHash: hash(Buffer.from('none')) },
  sources: [{ artifactId: artifact, versionId: versions[1].metadata.id, filePath: 'src/source.ts', contentHash: versions[1].metadata.content_hash }],
});
const fixtureIndexBytes = Buffer.from('closed fixture index');
const indexArchive = gzipSync(JSON.stringify({ schemaVersion: 1, identity: indexIdentity,
  files: [{ name: 'codebase.db', sha256: hash(fixtureIndexBytes), bytes: fixtureIndexBytes.length, content: fixtureIndexBytes.toString('base64') }] }));

function fixture(options: { differentOwner?: boolean; corrupt?: boolean; changed?: boolean; corruptReport?: boolean;
  corruptDiagnostic?: boolean; changedDiagnostic?: boolean; corruptIndex?: boolean; corruptBatch?: boolean } = {}) {
  const encryptedBatch = Buffer.from(encryptSecret(canonicalBatchCacheJson(batchRecord)));
  const batchArchive = gzipSync(encryptedBatch);
  const batchPath = `${project}/_review-batch-cache/v1/${owner}/${project}/${batchRecord.requestHash}/${hash(batchArchive)}.json.gz`;
  const requestRecord = { id: randomUUID(), ownerId: owner, projectId: project, state: 'running',
    createdAt: stamp, updatedAt: stamp, revision: 1, input: { text: 'Check the saved source', references: [] }, events: [] };
  const session = { id: randomUUID(), ownerId: owner, projectId: project, schemaVersion: 1, stage: 'completed',
    createdAt: stamp, updatedAt: stamp, tests: [], lanes: [] };
  const missionRevision = { id: revision, missionId: mission, projectId: project, revision: 1, createdBy: owner, createdAt: stamp,
    name: 'Saved smoke check', goal: 'Verify welcome text', targetUrl: 'http://localhost:3000', maxSteps: 2,
    checks: [{ id: 'welcome', criterionId: 'greeting', kind: 'visible_text', required: true, expected: 'Welcome',
      description: 'Read welcome text' }], context: null, contextAcknowledged: false };
  const dynamicEvidence = ['check-evidence', 'expired-evidence'].map(id => ({
    id, kind: 'checks', sha256: hash(checksBytes), availability: 'local', capturedAt: stamp,
  }));
  const reportedRun = { id: runId, projectId: project, missionId: mission, revision: missionRevision, createdBy: owner,
    createdAt: stamp, updatedAt: stamp, verdict: 'failed', state: 'completed', reason: null, checks: [checkResult], evidence: dynamicEvidence };
  const diagnostic = { id: diagnosticId, projectId: project, runId: stoppedRun, slot: 'console', kind: 'partial_console',
    sha256: hash(diagnosticBytes), sourceSha256: 'f'.repeat(64), bytes: diagnosticBytes.length, mimeType: 'application/json',
    sourceManifestId: null, permissionUrl: null, capturedAt: stamp, registeredBy: owner, createdAt: stamp,
    privacyVersion: 1, criterionProof: false };
  const registered = { ...diagnostic, id: registeredOnly, slot: 'trace', kind: 'partial_trace' };
  const hostedCopy = (id: string, evidenceId: string) => ({ id, projectId: project, runId, evidenceId, kind: 'checks',
    sha256: hash(checksBytes), bytes: checksBytes.length, mimeType: 'application/json', executorId: owner, syncedBy: owner, createdAt: stamp });
  const environment = { id: profile, projectId: project, name: 'Sandbox', targetUrl: 'http://localhost:3000/',
    allowedOrigins: ['http://localhost:3000'], viewport: { width: 800, height: 600 }, accountRole: '', requiredVariables: [],
    startupInstructions: '', targetVersion: 'v1', version: 1, updatedAt: stamp, updatedBy: owner };
  const archivedUnit = { id: unitRun, projectId: project, environmentId: profile, kind: 'unit', state: 'interrupted',
    verdict: 'not_tested', createdBy: owner, createdAt: stamp, updatedAt: stamp, timeoutMs: 50_000,
    command: { program: 'node', script: 'unit', fingerprint: 'a'.repeat(64), authorizationId: 'b'.repeat(64), gitCommit: null,
      frameworkVersion: '4.1.8', cliSha256: 'c'.repeat(64), nodeVersion: 'v22.21.1' },
    environment: { ...environment, preparation: null, resourceKey: 'profile:' + profile },
    result: null, reason: 'The saved test process was interrupted.' };
  const archivedCleanup = { kind: 'cleanup', outcome: 'completed', note: 'Confirmed the saved workspace was clean.',
    actorId: originalActor, createdAt: stamp };
  const rows: Record<string, Record<string, unknown>[]> = {
    projects: [{ id: project, owner_id: options.differentOwner ? randomUUID() : owner, name: 'Synthetic project', description: '',
      workspace_path: '', created_at: stamp, updated_at: stamp }],
    artifacts: [{ id: artifact, project_id: project, name: 'source.ts', path: 'src/source.ts', kind: 'source_code',
      metadata: { source: 'repository' }, created_at: stamp, updated_at: stamp }],
    artifact_versions: versions.map(item => item.metadata),
    report_exports: reportPackages.map(item => item.row),
    model_configurations: [
      { project_id: null, purpose: 'static_review', model: 'older', updated_at: '2026-11-23T00:00:00.000Z' },
      { project_id: null, purpose: 'static_review', model: 'active-model' },
      { project_id: null, purpose: 'provider_draft_api', model: 'saved-draft', enabled: false },
      { project_id: project, purpose: 'static_review', model: 'project-model' },
      { project_id: null, purpose: 'vision', model: 'other-account', owner_id: randomUUID() },
    ].map(item => ({ id: randomUUID(), owner_id: owner, provider: 'custom', api_format: 'openai-compatible',
      base_url: 'https://provider.example/v1', secret_ciphertext: encryptSecret('synthetic-provider-api-key'),
      created_at: stamp, updated_at: stamp, metadata: { note: 'discard unrelated metadata' }, ...item }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    review_sessions: [{ id: review, project_id: project, name: 'Archived Review', review_type: 'code_review',
      status: 'approved', idempotency_key: 'fixture-review', source_manifest_id: manifest,
      lineage: { parentReviewId: null, lineageRootId, reusedSourceManifest: false }, created_at: stamp, updated_at: stamp }],
    review_source_snapshots: [{ id: manifest, project_id: project, review_session_id: review, created_at: stamp, snapshot: {
      mode: 'capture', capturedAt: stamp, artifacts: [{ id: artifact, project_id: project, version_id: versions[0].metadata.id,
        path: 'src/source.ts', name: 'source.ts', kind: 'source_code', created_at: stamp,
        metadata: { source: 'repository', contentHash: versions[0].metadata.content_hash } }],
    } }],
    review_decisions: [{ id: decision, project_id: project, review_session_id: review, decision: 'approved',
      comment: 'Original owner decision', reviewer: owner, created_at: stamp }],
    review_decision_attachments: [{ id: attachment, project_id: project, review_session_id: review, decision_id: decision,
      storage_path: [project, review, decision, 'approval.txt'].join('/'), file_name: 'approval.txt', mime_type: 'text/plain',
      content_hash: hash(approvalBytes), byte_size: approvalBytes.length, created_at: stamp }],
    findings: [{ id: finding, project_id: project, review_session_id: review, source: 'static', verifier: 'model',
      title: 'Archived finding', description: 'Original finding details', status: 'carryover', severity: 'low',
      created_at: stamp, updated_at: stamp }],
    model_usage_records: [
      { project_id: project, review_session_id: review, stage: 'model_analysis', input_tokens: 30, output_tokens: 4,
        metadata: { apiFormat: 'openai-compatible', providerReportedTotalTokens: 34 } },
      { project_id: project, review_session_id: review, stage: 'source_indexing', input_tokens: 10,
        metadata: { scope: 'embedding', indexTrigger: 'review', providerReportedTotalTokens: 10 } },
      { project_id: project, review_session_id: null, stage: 'source_indexing', input_tokens: 9,
        metadata: { scope: 'embedding', indexTrigger: 'source_changed', providerReportedTotalTokens: 9 } },
      { project_id: null, review_session_id: null, stage: 'embedding-provider-test',
        metadata: { scope: 'embedding', callKind: 'test', providerResponse: 'private fixture response' } },
      { project_id: project, review_session_id: null, stage: 'browser-plan',
        metadata: { scope: 'vision', callKind: 'dynamic', dynamicSessionId: runId, providerReportedTotalTokens: 7 } },
      { project_id: project, review_session_id: null, stage: 'source_indexing', owner_id: randomUUID(),
        metadata: { scope: 'embedding', providerReportedTotalTokens: 999 } },
    ].map(item => ({ id: randomUUID(), owner_id: owner, outcome: 'success', attempt: 1,
      model: 'fixture-model', provider: 'custom', duration_ms: 25, created_at: stamp, ...item }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    dynamic_missions: [{ id: mission, project_id: project, payload: { id: mission, projectId: project,
      currentRevisionId: revision, createdBy: owner, createdAt: stamp } }],
    dynamic_mission_revisions: [{ id: revision, project_id: project, payload: missionRevision }],
    dynamic_sessions: [{ id: legacySession, project_id: project, name: 'Legacy browser test', target_url: 'http://localhost:3000',
      goal: 'Read the greeting', mission_type: 'smoke', status: 'success', created_at: stamp, updated_at: '2026-11-25T00:00:00.000Z' }],
    dynamic_actions: [{ id: randomUUID(), project_id: project, dynamic_session_id: legacySession, step: 1,
      action: 'read', target: 'Greeting', result: 'Welcome', created_at: stamp }],
    dynamic_evidence: [
      { id: legacyScreenshot, project_id: project, dynamic_session_id: legacySession, type: 'screenshot', summary: 'Greeting screenshot',
        storage_path: legacyImagePath, metadata: { sha256: hash(legacyImage) }, created_at: stamp },
      { id: legacyMissing, project_id: project, dynamic_session_id: legacySession, type: 'screenshot', summary: 'Missing screenshot',
        storage_path: project + '/legacy/' + legacySession + '/missing.png', created_at: stamp },
    ].sort((a, b) => a.id.localeCompare(b.id)),
    dynamic_runs: [
      { id: runId, project_id: project, payload: { ...reportedRun, idempotencyKey: 'saved-run', legacySessionId: null } },
      { id: stoppedRun, project_id: project, payload: { ...reportedRun, id: stoppedRun, state: 'blocked', verdict: 'not_tested',
        checks: [], evidence: [], idempotencyKey: 'stopped-run', legacySessionId: null } },
    ].sort((a, b) => a.id.localeCompare(b.id)),
    dynamic_run_artifacts: [diagnostic, registered].map(item => ({ id: item.id, project_id: project,
      run_id: stoppedRun, slot: item.slot, payload: item })).sort((a, b) => a.id.localeCompare(b.id)),
    dynamic_report_snapshots: [{ id: dynamicReport, project_id: project, run_id: runId, created_by: originalActor, payload: {
      metadata: { schemaVersion: 'centinel-dynamic-report-v1', generatorVersion: 'dynamic-report-1',
        reportId: dynamicReport, runId, projectId: project, actorId: originalActor, generatedAt: stamp },
      run: reportedRun, findings: [], artifacts: [], evidenceCopies: [], dataEvents: [],
      modelUsage: { status: 'unavailable', calls: [] }, limitations: ['Original report text.'],
    } }],
    dynamic_unit_runs: [{ id: unitRun, project_id: project, profile_id: profile, actor_id: owner,
      payload: { ...archivedUnit, idempotencyKey: 'original-unit-test' } }],
    dynamic_unit_data_events: [{ id: unitEvent, project_id: project, unit_run_id: unitRun, payload: archivedCleanup }],
    dynamic_unit_reports: [{ id: unitReport, project_id: project, unit_run_id: unitRun, actor_id: originalActor, payload: {
      metadata: { schemaVersion: 'centinel-unit-report-v1', generatorVersion: 'unit-report-1', reportId: unitReport,
        projectId: project, runId: unitRun, actorId: originalActor, generatedAt: stamp },
      run: archivedUnit, cleanupEvents: [archivedCleanup], limitations: ['Saved Unit report.'],
    } }],
    dynamic_hook_operations: [{ id: hookId, project_id: project, profile_id: profile, actor_id: originalActor, payload: {
      id: hookId, projectId: project, environmentId: profile, kind: 'cleanup', state: 'completed', verdict: 'passed',
      createdBy: originalActor, createdAt: stamp, updatedAt: stamp, idempotencyKey: 'recorded-cleanup', environment,
      command: { program: 'pnpm', script: 'cleanup', fingerprint: 'd'.repeat(64), authorizationId: 'e'.repeat(64), gitCommit: null },
      result: { outcome: 'passed', exitCode: 0, signal: null, output: 'Cleaned', truncated: false, durationMs: 20 }, reason: null,
    } }],
    dynamic_findings: [{ id: dynamicFinding, project_id: project, payload: { id: dynamicFinding, projectId: project, missionId: mission,
      key: hash(Buffer.from(JSON.stringify([mission, 'welcome', 'greeting', missionRevision.targetUrl]).replaceAll('","', '", "'))),
      version: 2, source: 'dynamic_checker', title: 'Read welcome text', category: 'functional', verification: 'confirmed',
      remediation: 'open', severity: 'low', priority: 'medium', confidence: 'high', confidenceBasis: 'Confirmed in the saved browser run.',
      observationCount: 1, createdAt: stamp, updatedAt: stamp } }],
    dynamic_finding_observations: [{ id: observation, project_id: project, finding_id: dynamicFinding, payload: {
      id: observation, projectId: project, findingId: dynamicFinding, runId, revisionId: revision, executorId: owner,
      checkId: 'welcome', criterionId: 'greeting', definition: missionRevision.checks[0], result: checkResult,
      evidence: dynamicEvidence, targetUrl: missionRevision.targetUrl, targetVersion: null, goal: missionRevision.goal, createdAt: stamp } }],
    dynamic_finding_events: [{ id: findingEvent, project_id: project, finding_id: dynamicFinding, payload: {
      id: findingEvent, projectId: project, findingId: dynamicFinding, version: 2, actorId: originalActor,
      kind: 'verification', decision: 'confirmed', note: 'Confirmed in the saved browser run.',
      severity: 'low', priority: 'medium', confidence: 'high', createdAt: stamp } }],
    dynamic_evidence_copies: [
      { id: copy, project_id: project, run_id: runId, evidence_id: 'check-evidence', object_path: evidencePath, state: 'available',
        expires_at: '2099-01-01T00:00:00.000Z', updated_at: stamp, payload: hostedCopy(copy, 'check-evidence') },
      { id: expired, project_id: project, run_id: runId, evidence_id: 'expired-evidence',
        object_path: [project, 'dynamic-v1', runId, expired, hash(checksBytes) + '.json'].join('/'), state: 'available',
        expires_at: '2001-01-01T00:00:00.000Z', updated_at: stamp, payload: hostedCopy(expired, 'expired-evidence') },
      { id: diagnosticCopy, project_id: project, run_id: stoppedRun, evidence_id: diagnosticId, object_path: diagnosticPath,
        state: 'available', expires_at: '2099-01-01T00:00:00.000Z', updated_at: stamp, payload: {
          ...hostedCopy(diagnosticCopy, diagnosticId), runId: stoppedRun, kind: diagnostic.kind, sha256: diagnostic.sha256,
          bytes: diagnostic.bytes, sourceSha256: diagnostic.sourceSha256, criterionProof: false, privacyVersion: 1 } },
    ].sort((a, b) => a.id.localeCompare(b.id)),
    dynamic_environments: [{ id: profile, project_id: project, payload: environment }],
    dynamic_environment_data: [{ profile_id: profile, project_id: project, state: 'ready', prepared_version: 1, run_id: null,
      preparation: { note: 'Original baseline', actorId: owner, at: stamp, profileVersion: 1 }, resource_key: 'profile:' + profile, resource_reserved: true }],
    dynamic_environment_events: [{ id: randomUUID(), profile_id: profile, project_id: project, kind: 'preparation',
      outcome: 'completed', note: 'Original baseline', actor_id: owner, created_at: stamp }],
    audit_events: [
      { id: batchCacheReceiptId(owner, project, batchRecord.requestHash), project_id: project, actor_id: owner, entity_id: review,
        entity_type: 'static_review', event_type: 'review_batch_cache_saved', created_at: stamp,
        payload: { version: 1, ownerId: owner, projectId: project, originReviewId: review, requestHash: batchRecord.requestHash,
          archivePath: batchPath, archiveSha256: hash(batchArchive), archiveBytes: batchArchive.length, recordSha256: hash(encryptedBatch) } },
      { id: repositoryIndexPublicationId(indexIdentity), project_id: project, actor_id: originalActor, entity_type: 'repository_index',
        event_type: 'repository_index_published', payload: { schemaVersion: 1, fingerprint: indexIdentity.fingerprint, identity: indexIdentity,
          archivePath: repositorySnapshotPath(indexIdentity), archiveSha256: hash(indexArchive), archiveBytes: indexArchive.length } },
      { id: requestRecord.id, project_id: project, actor_id: owner, entity_type: 'project_conversation', event_type: 'project_conversation_request',
        payload: { request: requestRecord } },
      { id: session.id, project_id: project, actor_id: owner, entity_type: 'dynamic_autonomous', event_type: 'dynamic_autonomous_session',
        payload: { session } },
      { id: randomUUID(), project_id: project, actor_id: 'someone-else', entity_type: 'project_conversation', event_type: 'project_conversation_request',
        payload: { request: { ...requestRecord, ownerId: 'someone-else' } } },
    ],
  };
  let firstInventoryReads = 0;
  let evidenceCopyReads = 0;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe(fixtureOrigin);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, aud: 'authenticated', role: 'authenticated' });
    const prefix = '/storage/v1/object/project-artifacts/';
    if (url.pathname === prefix + batchPath) {
      return new Response(Uint8Array.from(options.corruptBatch ? Buffer.alloc(batchArchive.length) : batchArchive));
    }
    if (url.pathname === prefix + repositorySnapshotPath(indexIdentity)) {
      return new Response(Uint8Array.from(options.corruptIndex ? Buffer.alloc(indexArchive.length) : indexArchive));
    }
    if (url.pathname.startsWith(prefix)) {
      const item = versions.find(version => version.metadata.storage_path === url.pathname.slice(prefix.length));
      return item ? new Response(Uint8Array.from(options.corrupt ? Buffer.from('corrupted') : item.bytes)) : new Response(null, { status: 404 });
    }
    if (url.pathname === '/storage/v1/object/decision-attachments/' + [project, review, decision, 'approval.txt'].join('/')) {
      return new Response(Uint8Array.from(approvalBytes));
    }
    if (url.pathname === '/storage/v1/object/dynamic-evidence/' + evidencePath) return new Response(Uint8Array.from(checksBytes));
    if (url.pathname === '/storage/v1/object/dynamic-evidence/' + diagnosticPath) {
      return new Response(Uint8Array.from(options.corruptDiagnostic ? Buffer.alloc(diagnosticBytes.length) : diagnosticBytes));
    }
    if (url.pathname === '/storage/v1/object/dynamic-evidence/' + legacyImagePath) return new Response(Uint8Array.from(legacyImage));
    if (url.pathname.endsWith('/missing.png')) {
      return Response.json({ statusCode: '404', message: 'Fixture object missing' }, { status: 404 });
    }
    if (url.pathname.startsWith('/storage/v1/object/project-reports/')) {
      const [, , , , , reportProject, id, filename] = url.pathname.split('/');
      const report = reportPackages.find(item => item.row.id === id);
      const format = (Object.keys(outputFiles) as (keyof typeof outputFiles)[]).find(key => outputFiles[key] === filename);
      if (!report || reportProject !== project || !format || id === missingReport && format === 'pdf') {
        return Response.json({ statusCode: '404', error: 'not_found', message: 'Fixture object missing' }, { status: 404 });
      }
      const bytes = options.corruptReport && format === 'markdown' ? Buffer.from('Corrupted report') : report.files[format];
      return new Response(Uint8Array.from(bytes));
    }
    const table = url.pathname.replace('/rest/v1/', '');
    const items = (rows[table] ?? []).filter(row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      if (value.startsWith('gt.')) return String(row[key]) > value.slice(3);
      if (value === 'is.null') return row[key] === null;
      return true;
    }));
    let page = items.slice(Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('offset') ?? 0) + Number(url.searchParams.get('limit') ?? 1000));
    if (table === 'artifact_versions' && !url.searchParams.has('id') && Number(url.searchParams.get('offset') ?? 0) === 0 && ++firstInventoryReads > 1
      && options.changed) page = page.map(row => ({ ...row, byte_size: Number(row.byte_size) + 1 }));
    if (table === 'dynamic_evidence_copies' && ++evidenceCopyReads > 1 && options.changedDiagnostic) {
      page = page.filter(row => row.id !== diagnosticCopy);
    }
    return Response.json(new Headers(init?.headers).get('accept') === 'application/vnd.pgrst.object+json' ? page[0] ?? null : page);
  });
  const gateway = new AuthGateway({ clientFactory: token => createClient(fixtureOrigin, 'fixture-publishable', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer ' + token },
      fetch: readOnlyMigrationFetch(transport) },
  }) });
  return { gateway, transport };
}

it('exports bearer-scoped fixture bytes and owner history and reopens them in an isolated workspace', async () => {
  const { gateway, transport } = fixture();
  const auth = await gateway.authenticate({ authorization: 'Bearer fixture-token' });
  const snapshot = await exportOwnerWorkspace(auth, project);
  expect(snapshot.project.ownerId).toBe(owner);
  expect(snapshot.currentVersionIds).toEqual([versions[1].metadata.id]);
  expect(snapshot.sources.map(item => Buffer.from(item.contentBase64, 'base64'))).toEqual(versions.map(item => item.bytes));
  expect(snapshot.history.conversations).toHaveLength(1);
  expect(snapshot.history.conversations[0].state).toBe('interrupted');
  expect(snapshot.exportReceipt).toMatchObject({ cutoverReady: false, sourceVersions: 2, scope: 'owner-project',
    reviewBatchCacheRecords: 1,
    repositoryIndexArchives: 1, incompatibleRepositoryIndexes: 0, unavailableRepositoryIndexes: 0,
    dynamicEvidenceReferences: 2, dynamicEvidenceFiles: 1, dynamicCopyRecords: 3, dynamicCopyFiles: 2,
    dynamicArtifactRecords: 2, reports: 2, verifiedReportPackages: 1,
    dynamicFindings: 1, dynamicFindingObservations: 1, dynamicFindingEvents: 1, dynamicReports: 1,
    unitRuns: 1, unitCleanupEvents: 1, unitReports: 1, hookOperations: 1,
    ownerModelSettings: 2, projectModelSettings: 1, omittedModelSettings: 1, modelUsageRows: 5,
    legacyDynamicSessions: 1, legacyDynamicEvidence: 2, legacyDynamicEvidenceFiles: 1 });
  expect(JSON.stringify(snapshot.modelUsage)).not.toMatch(/private fixture response/);
  expect(JSON.stringify(snapshot.ownerModelSettings)).not.toMatch(/synthetic-provider-api-key|other-account|discard unrelated metadata/);
  expect(snapshot.reviewHistory.reviews).toMatchObject([{ id: review, lineage: { lineageRootId } }]);
  expect(snapshot.reviewHistory.decisions).toMatchObject([{ id: decision, attachments: [{ id: attachment }] }]);
  expect(transport.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true);
  const directory = mkdtempSync(join(tmpdir(), 'centinel-export-fixture-'));
  const workspace = new LocalWorkspace(directory);
  const history = new LocalHistory(join(directory, 'history.sqlite'));
  try {
    workspace.importSnapshot(owner, snapshot.project, snapshot.sources.map(({ contentBase64, ...item }) =>
      ({ ...item, bytes: Buffer.from(contentBase64, 'base64') })), snapshot.traceability, snapshot.modelConfigurations,
    snapshot.readinessJobs, snapshot.connectedSources, { currentVersionIds: snapshot.currentVersionIds, dynamicHistory: snapshot.dynamicHistory,
      environments: snapshot.environments, reviewHistory: snapshot.reviewHistory, reports: snapshot.reports,
      ownerModelSettings: snapshot.ownerModelSettings, modelUsage: snapshot.modelUsage, legacyDynamic: snapshot.legacyDynamic,
      fingerprint: hash(Buffer.from(JSON.stringify(snapshot))) });
    history.importSaved(owner, project, snapshot.history.conversations, snapshot.history.autoTests);
    expect(workspace.evidenceCopies(owner).artifacts(project, stoppedRun).map(item => item.id)).toEqual([diagnosticId, registeredOnly]);
    expect(workspace.evidenceCopies(owner).list(project, stoppedRun)).toMatchObject([{ id: diagnosticCopy, evidenceId: diagnosticId,
      criterionProof: false, availability: 'available' }]);
    expect(workspace.evidenceCopies(owner).content(project, stoppedRun, diagnosticCopy).bytes).toEqual(diagnosticBytes);
    expect(workspace.evidenceCopies(owner).list(project, runId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expired, availability: 'expired' }), expect.objectContaining({ id: copy, availability: 'available' }),
    ]));
    expect(() => workspace.evidenceCopies(owner).content(project, runId, expired)).toThrow(/unavailable/);
    expect(workspace.evidenceCopies('other').list(project, stoppedRun)).toEqual([]);
    const providerSettings = workspace.modelConfigurations(owner);
    expect(await listModelProviderSettings(providerSettings, owner)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'text', model: 'active-model', hasApiKey: true,
        savedProviders: { api: expect.objectContaining({ model: 'saved-draft' }) } }),
    ]));
    const provider = await resolveModelProviderChain(providerSettings, { ownerId: owner, projectId: project });
    expect(provider.primary).toMatchObject({ model: 'project-model', apiKey: 'synthetic-provider-api-key' });
    expect(providerSettings.readModelSetting('another-owner', 'static_review')).toBeNull();
    const nextProject = { ...snapshot.project, id: randomUUID() };
    workspace.importSnapshot(owner, nextProject, [], undefined, undefined, undefined, undefined, {
      currentVersionIds: [], fingerprint: 'f'.repeat(64),
      ownerModelSettings: snapshot.ownerModelSettings.map(row => ({ ...row, model: 'older-export' })),
      modelUsage: snapshot.modelUsage.filter(row => row.projectId === null),
    });
    expect(providerSettings.readModelSetting(owner, 'static_review')?.model).toBe('active-model');
    expect(workspace.modelUsageRecords(owner).archived).toHaveLength(5);
    const invalidProject = { ...snapshot.project, id: randomUUID() };
    expect(() => workspace.importSnapshot(owner, invalidProject, [], undefined, undefined, undefined, undefined, {
      currentVersionIds: [], fingerprint: 'a'.repeat(64),
      ownerModelSettings: snapshot.ownerModelSettings.map(row => ({ ...row, secret_ciphertext: 'plaintext-secret' })),
    })).toThrow(/encrypted credentials/);
    expect(workspace.project(owner, invalidProject.id)).toBeNull();
    expect(workspace.sourceBytes(owner, project, artifact, versions[0].metadata.id)?.content).toEqual(versions[0].bytes);
    expect(workspace.sourceBytes(owner, project, artifact)?.content).toEqual(versions[1].bytes);
    expect((await workspace.environments(owner).data(project, profile)).resource?.reserved).toBe(true);
    expect(workspace.reviews(owner).listFindingRows(project, review)).toMatchObject([{ id: finding, status: 'carryover' }]);
    expect(workspace.reviews(owner).updateFindingStatus(project, finding, 'fixed')).toBe(true);
    expect(workspace.reviews(owner).listFindingRows(project, review)).toMatchObject([{ id: finding, status: 'fixed' }]);
    expect(workspace.reviews(owner).listModelAttempts(project, review)).toMatchObject([{ usage: { providerReportedTotalTokens: 34 } }]);
    expect(workspace.decisionFileBytes(owner, project, review, decision, attachment)).toEqual(approvalBytes);
    expect(workspace.dynamicHistory(owner).evidence(project, runId, 'check-evidence')?.bytes).toEqual(checksBytes);
    expect(workspace.dynamicHistory(owner).evidence(project, runId, 'expired-evidence')).toBeNull();
    expect(await workspace.dynamicFindings(owner).get(project, dynamicFinding)).toEqual(snapshot.dynamicHistory.findings?.[0]);
    expect(await workspace.dynamicReports(owner).get(project, dynamicReport)).toEqual(snapshot.dynamicHistory.reports?.[0]);
    expect(await workspace.unitRuns(owner).get(project, unitRun)).toEqual(snapshot.dynamicHistory.units?.runs[0]);
    expect(await workspace.unitReports(owner).get(project, unitReport)).toEqual(snapshot.dynamicHistory.units?.reports?.[0]);
    expect(await workspace.hooks(owner).get(project, hookId)).toEqual(snapshot.dynamicHistory.hooks?.[0]);
    expect(await workspace.dynamicFindings(owner).collect(project, runId)).toMatchObject([{ id: dynamicFinding, observationCount: 1, version: 2 }]);
    expect(workspace.legacyDynamic(owner).image(project, legacySession, legacyScreenshot)?.bytes).toEqual(legacyImage);
    expect(workspace.legacyDynamic(owner).image(project, legacySession, legacyMissing)).toBeNull();
    expect(await history.conversations(owner).list(project)).toMatchObject([{ state: 'interrupted' }]);
    expect(await history.autoTests(owner).list(project)).toMatchObject([{ stage: 'completed' }]);
    const savedReport = reportPackages.find(item => item.row.id === reportId)!;
    expect(workspace.listReports(owner, project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reportId, actorId: originalActor, checksum: savedReport.row.checksum }),
      expect.objectContaining({ id: missingReport, storage: { json: null, markdown: null, pdf: null } }),
    ]));
    for (const format of Object.keys(outputFiles) as (keyof typeof outputFiles)[]) {
      expect(workspace.reportBytes(owner, project, reportId, format)).toEqual(savedReport.files[format]);
    }
    const routes = new LocalReportRoutes(workspace, history);
    await expect(routes.projectRoute(owner, null, project, ['reports', missingReport, 'links'], 'POST', 'http://localhost',
      async () => ({}))).rejects.toMatchObject({ status: 409 });
    expect(workspace.reportAvailability('another-owner', project, reportId)).toBe('missing');
  } finally {
    workspace.close();
    history.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

it('rejects exports for members, rejects corrupt source bytes, and blocks writes at the transport', async () => {
  const member = fixture({ differentOwner: true });
  const auth = await member.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(auth, project)).rejects.toThrow(/project owned/);
  expect(member.transport.mock.calls.every(([input]) => !String(input).includes('/artifacts'))).toBe(true);
  const corrupt = fixture({ corrupt: true });
  const corruptAuth = await corrupt.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(corruptAuth, project)).rejects.toThrow(/hash verification failed/);
  const corruptedCopy = fixture({ corruptDiagnostic: true });
  const corruptedCopyAuth = await corruptedCopy.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(corruptedCopyAuth, project)).rejects.toThrow(/checksum verification/);
  const changedCopy = fixture({ changedDiagnostic: true });
  const changedCopyAuth = await changedCopy.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(changedCopyAuth, project)).rejects.toThrow(/Dynamic evidence inventory changed/);
  const corruptedIndex = fixture({ corruptIndex: true });
  const corruptedIndexAuth = await corruptedIndex.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(corruptedIndexAuth, project)).rejects.toThrow(/repository index archive failed its recorded checksum/);
  const corruptedBatch = fixture({ corruptBatch: true });
  const corruptedBatchAuth = await corruptedBatch.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(corruptedBatchAuth, project)).rejects.toThrow(/archive hash does not match its receipt/);
  const changed = fixture({ changed: true });
  const changedAuth = await changed.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(changedAuth, project)).rejects.toThrow(/inventory changed during export/);
  const alteredReport = fixture({ corruptReport: true });
  const alteredAuth = await alteredReport.gateway.authenticate({ authorization: 'Bearer fixture-token' });
  await expect(exportOwnerWorkspace(alteredAuth, project)).rejects.toThrow(/report package checksum/);
  const transport = vi.fn<typeof fetch>();
  expect(() => readOnlyMigrationFetch(transport)(fixtureOrigin, { method: 'PATCH' })).toThrow(/only permits hosted reads/);
  expect(transport).not.toHaveBeenCalled();
});

it('runs the actual export and stage commands against a loopback fixture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-export-cli-'));
  const target = join(directory, 'archive.json');
  const staging = join(directory, 'data', 'local-workspace');
  const { transport } = fixture();
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
      const result = await transport(new URL(req.url!, fixtureOrigin), { headers, method: req.method });
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch { res.writeHead(500).end(); }
  });
  const run = promisify(execFile);
  let desktopSidecar: ReturnType<typeof createSidecarServer> | undefined;
  try {
    mkdirSync(join(directory, 'data'));
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const env = { ...process.env, CENTINEL_HOME: directory, CENTINEL_MIGRATION_ACCESS_TOKEN: 'fixture-token',
      SUPABASE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port, SUPABASE_ANON_KEY: 'fixture-publishable' };
    const cli = (script: string, ...args: string[]) => run(process.execPath, ['--import', 'tsx', 'src/migration/' + script + '.ts', ...args],
      { env, timeout: 12_000 });
    const result = await cli('exportLocalWorkspace', project, target);
    expect(JSON.parse(result.stdout)).toMatchObject({ sourceVersions: 2, reviews: 1, decisionFiles: 1, cutoverReady: false });
    const original = readFileSync(target);
    expect(original.toString()).not.toContain('fixture-token');
    await expect(cli('exportLocalWorkspace', project, target)).rejects.toThrow(/EEXIST/);
    expect(readFileSync(target)).toEqual(original);
    const altered = JSON.parse(original.toString()) as Awaited<ReturnType<typeof exportOwnerWorkspace>>;
    const alteredPackage = altered.reports.find(item => item.history.id === reportId)?.files;
    expect(alteredPackage).toBeTruthy();
    alteredPackage!.markdown = Buffer.from('Changed after export').toString('base64');
    const alteredPath = join(directory, 'altered.json');
    writeFileSync(alteredPath, JSON.stringify(altered));
    await expect(cli('importLocalWorkspace', owner, alteredPath, staging)).rejects.toThrow(/package checksum/);
    const alteredDiagnostic = JSON.parse(original.toString()) as Awaited<ReturnType<typeof exportOwnerWorkspace>>;
    const item = alteredDiagnostic.dynamicHistory.evidenceCopies?.copies.find(item => item.copy.id === diagnosticCopy);
    expect(item?.contentBase64).toBeTruthy();
    item!.contentBase64 = Buffer.alloc(diagnosticBytes.length).toString('base64');
    const alteredDiagnosticPath = join(directory, 'altered-diagnostic.json');
    writeFileSync(alteredDiagnosticPath, JSON.stringify(alteredDiagnostic));
    await expect(cli('importLocalWorkspace', owner, alteredDiagnosticPath, staging)).rejects.toThrow(/copy failed size or checksum/);
    const failedStage = new LocalWorkspace(staging);
    try { expect(failedStage.project(owner, project)).toBeNull(); }
    finally { failedStage.close(); }
    const oldDb = join(directory, 'old-centinel.sqlite');
    const oldWorkspace = join(directory, 'old-workspace');
    const oldSession = join(oldWorkspace, 'sessions', legacySession, 'screenshots');
    mkdirSync(oldSession, { recursive: true });
    const originalScreenshot = join(oldSession, 'recovered.png');
    writeFileSync(originalScreenshot, legacyImage);
    const unregisteredScreenshot = join(directory, 'outside.png');
    writeFileSync(unregisteredScreenshot, legacyImage);
    const outsideId = randomUUID();
    const old = new DatabaseSync(oldDb);
    try {
      old.exec(`
        CREATE TABLE projects (id TEXT, workspace_path TEXT);
        CREATE TABLE sessions (id TEXT, project_id TEXT, type TEXT, name TEXT, status TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE dynamic_session_details (session_id TEXT, target_url TEXT, goal TEXT, mission_type TEXT, max_steps INTEGER,
          final_summary TEXT, failure_reason TEXT);
        CREATE TABLE evidence (id TEXT, project_id TEXT, session_id TEXT, type TEXT, file_path TEXT, summary TEXT, created_at TEXT);
      `);
      old.prepare('INSERT INTO projects VALUES (?, ?)').run(project, oldWorkspace);
      old.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(legacySession, project, 'dynamic', 'Old descriptor', 'success', stamp, stamp);
      old.prepare('INSERT INTO dynamic_session_details VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(legacySession, 'http://localhost:3000', 'Read greeting', 'smoke', 2, '', '');
      const insert = old.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?)');
      insert.run(legacyMissing, project, legacySession, 'screenshot', originalScreenshot, 'Recovered from device', stamp);
      insert.run(outsideId, project, legacySession, 'screenshot', unregisteredScreenshot, 'Outside session directory', stamp);
    } finally { old.close(); }
    const oldBytes = readFileSync(oldDb);
    await cli('importLocalWorkspace', owner, target, staging, '--legacy-db', oldDb);
    await cli('importLocalWorkspace', owner, target, staging, '--legacy-db', oldDb);
    expect(readFileSync(oldDb)).toEqual(oldBytes);
    await cli('importLocalHistory', owner, project, target, directory);
    const workspace = new LocalWorkspace(staging);
    const history = new LocalHistory(join(directory, 'data', 'project-history.sqlite'));
    try {
      expect(workspace.artifacts(owner, project)).toMatchObject([{ versionId: versions[1].metadata.id }]);
      expect(await workspace.repositoryIndexArchives(owner).load(indexIdentity)).toEqual(indexArchive);
      expect(await workspace.repositoryIndexArchives(originalActor).load(indexIdentity)).toBeNull();
      expect(await workspace.reviewBatchCache(owner).load(project, batchRecord.requestHash)).toEqual(batchRecord);
      expect(await workspace.reviewBatchCache(originalActor).load(project, batchRecord.requestHash)).toBeNull();
      expect(await workspace.reviewBatchCache(owner).load(project, '9'.repeat(64))).toBeNull();
      const cacheDb = new DatabaseSync(join(staging, 'workspace.sqlite'), { readOnly: true });
      try {
        const row = cacheDb.prepare('SELECT payload FROM local_review_batch_cache WHERE owner = ? AND project = ?').get(owner, project);
        expect(row?.payload).toEqual(expect.any(String));
        expect(String(row?.payload)).not.toContain(batchRecord.policyVersion);
      } finally { cacheDb.close(); }
      expect(workspace.decisionFileBytes(owner, project, review, decision, attachment)).toEqual(approvalBytes);
      expect(workspace.dynamicHistory(owner).evidence(project, runId, 'check-evidence')?.bytes).toEqual(checksBytes);
      expect(workspace.reportAvailability(owner, project, reportId)).toBe('available');
      expect(workspace.legacyDynamic(owner).image(project, legacySession, legacyMissing)?.bytes).toEqual(legacyImage);
      expect(workspace.legacyDynamic(owner).image(project, legacySession, outsideId)).toBeNull();
      expect(await history.conversations(owner).list(project)).toHaveLength(1);
    } finally { history.close(); workspace.close(); }
    const remote = vi.fn(() => { throw new Error('Hosted data must be blocked after staging.'); });
    const localAuth = { authenticate: async (headers: { authorization?: string }) => {
      const userId = headers.authorization === 'Bearer staged-owner' ? owner : 'different-owner';
      return { userId, user: { id: userId }, client: { from: remote, rpc: remote, storage: { from: remote } } };
    }, requireProjectMember: remote } as unknown as AuthGateway;
    const stagedServer = createSidecarServer(localAuth, { localWorkspace: new LocalWorkspace(staging), historyPath: join(directory, 'data', 'project-history.sqlite') });
    desktopSidecar = stagedServer;
    await new Promise<void>(done => stagedServer.listen(0, '127.0.0.1', done));
    const reports = 'http://127.0.0.1:' + (stagedServer.address() as AddressInfo).port + '/projects/' + project + '/reports';
    const saved = reportPackages.find(item => item.row.id === reportId)!;
    const headers = { Authorization: 'Bearer staged-owner' };
    const diagnosticRoute = new URL(`/projects/${project}/dynamic/runs/${stoppedRun}/evidence/${diagnosticCopy}/content`, reports);
    expect(Buffer.from(await (await fetch(diagnosticRoute, { headers })).arrayBuffer())).toEqual(diagnosticBytes);
    expect((await fetch(diagnosticRoute, { headers: { Authorization: 'Bearer other' } })).status).toBe(404);
    expect(await (await fetch(reports, { headers })).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reportId, checksum: saved.row.checksum, actorId: originalActor }),
    ]));
    const renew = (id: string, authorization = headers.Authorization) => fetch(reports + '/' + id + '/links',
      { headers: { Authorization: authorization }, method: 'POST' });
    expect((await renew(missingReport)).status).toBe(409);
    expect((await renew(reportId, 'Bearer other')).status).toBe(404);
    const links = await (await renew(reportId)).json();
    for (const format of Object.keys(outputFiles) as (keyof typeof outputFiles)[]) {
      const response = await fetch(links.downloads[format]);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(saved.files[format]);
    }
    writeFileSync(join(staging, 'objects', hash(saved.files.pdf)), 'corrupted');
    expect((await fetch(links.downloads.pdf)).status).toBe(503);
    const settingsUrl = 'http://127.0.0.1:' + (stagedServer.address() as AddressInfo).port + '/settings/ai';
    const settings = await (await fetch(settingsUrl, { headers })).json();
    expect(settings).toEqual(expect.arrayContaining([expect.objectContaining({ model: 'active-model', hasApiKey: true })]));
    expect(JSON.stringify(settings)).not.toMatch(/synthetic-provider-api-key|secret_ciphertext/);
    const usageUrl = settingsUrl + '/usage';
    const usage = async (query: string) => (await fetch(usageUrl + query, { headers })).json();
    expect(await usage('?callKind=test&scope=embedding')).toMatchObject({ totals: { calls: 1, unknownTotalCalls: 1 } });
    expect(await usage('?projectId=' + project + '&scope=embedding')).toMatchObject({ totals: { calls: 2, providerReportedTotalTokens: 19 } });
    expect(await usage('?projectId=' + project + '&sessionId=' + review)).toMatchObject({ totals: { calls: 2, providerReportedTotalTokens: 44 } });
    expect(await usage('?projectId=' + project + '&sessionId=' + runId + '&callKind=dynamic'))
      .toMatchObject({ totals: { calls: 1, providerReportedTotalTokens: 7 }, recent: [{ sessionId: runId }] });
    expect(await (await fetch(usageUrl + '?callKind=test', { headers: { Authorization: 'Bearer other' } })).json())
      .toMatchObject({ totals: { calls: 0 } });
    const generated = await fetch(reports + '/export', { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: review }) });
    expect(generated.status).toBe(200);
    const generatedLinks = await generated.json();
    expect(await (await fetch(generatedLinks.downloads.json)).json()).toMatchObject({
      latestReview: { modelUsage: { totals: { calls: 2, providerReportedTotalTokens: 44 } } },
      latestDynamicTest: { session: { id: legacySession, status: 'success' }, actionTrace: [{ action: 'read', target: 'Greeting', result: 'Welcome' }] },
    });
    const origin = new URL(reports).origin;
    const findingsPath = origin + '/projects/' + project + '/dynamic/findings/' + dynamicFinding;
    const reportBase = origin + '/projects/' + project + '/dynamic';
    const historicalHook = reportBase + '/environments/' + profile + '/hooks/' + hookId;
    expect(await (await fetch(historicalHook, { headers })).json()).toMatchObject({ id: hookId, state: 'completed', createdBy: originalActor });
    expect((await fetch(historicalHook, { headers: { Authorization: 'Bearer other' } })).status).toBe(404);
    const runReports = reportBase + '/runs/' + runId + '/reports';
    const capturedId = randomUUID();
    const capture = (reportId: string) => fetch(runReports, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId }),
    });
    const captured = await capture(capturedId);
    expect(captured.status).toBe(201);
    const frozen = await captured.json();
    expect(frozen).toMatchObject({ metadata: { reportId: capturedId, actorId: owner },
      findings: [{ finding: { id: dynamicFinding, remediation: 'open' } }],
      modelUsage: { status: 'available', calls: [{ stage: 'browser-plan', input: null, output: null }] },
      localEvidence: [{ evidenceId: 'check-evidence', status: 'available' }, { evidenceId: 'expired-evidence', status: 'missing' }],
    });
    expect(await (await fetch(findingsPath, { headers })).json()).toMatchObject({
      finding: { id: dynamicFinding, verification: 'confirmed', version: 2 },
      observations: [{ id: observation, runId }],
      events: [{ id: findingEvent, actorId: originalActor }],
    });
    expect((await fetch(findingsPath, { headers: { Authorization: 'Bearer other' } })).status).toBe(404);
    const decide = (version: number) => fetch(findingsPath + '/remediation', { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, status: 'in_progress', note: 'Started follow-up in C:\\Users\\example\\project.' }) });
    expect(await (await decide(2)).json()).toMatchObject({ id: dynamicFinding, remediation: 'in_progress', version: 3 });
    expect((await decide(2)).status).toBe(409);
    expect(await (await fetch(findingsPath, { headers })).json()).toMatchObject({
      events: [{ id: findingEvent, actorId: originalActor }, { kind: 'remediation', actorId: owner, version: 3 }],
    });
    expect(await (await capture(capturedId)).json()).toEqual(frozen);
    expect((await capture(dynamicReport)).status).toBe(404);
    expect(await (await fetch(runReports, { headers })).json()).toMatchObject([
      { reportId: capturedId, actorId: owner }, { reportId: dynamicReport, actorId: originalActor },
    ]);
    const recordedReport = reportBase + '/reports/' + dynamicReport;
    expect(await (await fetch(recordedReport, { headers })).json()).toMatchObject({
      metadata: { actorId: originalActor, generatedAt: stamp }, limitations: ['Original report text.'],
    });
    expect((await fetch(recordedReport, { headers: { Authorization: 'Bearer other' } })).status).toBe(404);
    for (const [format, mime] of Object.entries({ json: 'application/json', markdown: 'text/markdown', pdf: 'application/pdf' })) {
      const download = await fetch(reportBase + '/reports/' + capturedId + '/' + format, { headers });
      expect(download.headers.get('content-type')).toContain(mime);
      const data = Buffer.from(await download.arrayBuffer());
      expect(download.headers.get('x-centinel-sha256')).toBe(hash(data));
      if (format === 'json') expect(JSON.parse(data.toString())).toEqual(frozen);
      if (format === 'markdown') expect(data.toString()).toContain('Missing on device');
      if (format === 'pdf') expect(data.subarray(0, 4).toString()).toBe('%PDF');
    }
    writeFileSync(join(staging, 'objects', hash(checksBytes)), 'corrupted');
    const updatedReport = await (await capture(randomUUID())).json();
    expect(updatedReport).toMatchObject({
      findings: [{ finding: { remediation: 'in_progress' }, events: [expect.any(Object), { note: 'Started follow-up in [local path withheld]' }] }],
      localEvidence: [{ evidenceId: 'check-evidence', status: 'unverifiable' }, { evidenceId: 'expired-evidence', status: 'missing' }],
    });
    expect(await (await capture(capturedId)).json()).toEqual(frozen);
    const legacyPath = origin + '/projects/' + project + '/dynamic-sessions';
    expect(await (await fetch(legacyPath, { headers })).json()).toMatchObject([{ id: legacySession }]);
    expect(await (await fetch(legacyPath + '/' + legacySession, { headers })).json()).toMatchObject({ id: legacySession, status: 'success' });
    const screenshots = await (await fetch(legacyPath + '/' + legacySession + '/evidence', { headers })).json();
    const image = screenshots.find((item: { id: string }) => item.id === legacyScreenshot);
    const imageUrl = origin + '/evidence-file?path=' + encodeURIComponent(image.filePath);
    const screenshot = await fetch(imageUrl, { headers });
    expect(screenshot.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await screenshot.arrayBuffer())).toEqual(legacyImage);
    expect((await fetch(imageUrl, { headers: { Authorization: 'Bearer other' } })).status).toBe(404);
    expect((await fetch(origin + '/evidence-file?path=' + encodeURIComponent(target), { headers })).status).toBe(404);
    writeFileSync(join(staging, 'objects', hash(legacyImage)), 'corrupted');
    expect((await fetch(imageUrl, { headers })).status).toBe(503);
    expect(remote).not.toHaveBeenCalled();
  } finally {
    if (desktopSidecar?.listening) await new Promise<void>(done => desktopSidecar!.close(() => done()));
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 25_000);
