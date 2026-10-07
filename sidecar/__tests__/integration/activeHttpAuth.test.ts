import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createAuthGateway } from '../../src/auth/gateway.js';
import initSqlJs from 'sql.js';
import { setTestDb, clearTestDb } from '../../src/db.js';
import { createSidecarServer } from '../../src/index.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const ownerProject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerSecondProject = 'abababab-abab-4bab-8bab-abababababab';
const otherProject = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownerReview = '77777777-7777-4777-8777-777777777777';
const ownerDecision = 'dededede-dede-4ede-8ede-dededededede';
const otherDecision = 'ababdede-abab-4ded-8ded-abababababab';
const ownerDecisionAttachment = 'acacacac-acac-4aca-8aca-acacacacacac';
const ownerFinding = '88888888-8888-4888-8888-888888888888';
const ownerRequirement = '66666666-6666-4666-8666-666666666666';
const ownerArtifact = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerSecondArtifact = '33333333-3333-4333-8333-333333333333';
const ownerVersion = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherVersion = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherArtifact = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const otherRequirement = '55555555-5555-4555-8555-555555555555';
const otherStandard = '44444444-4444-4444-8444-444444444444';
const reportId = '99999999-9999-4999-8999-999999999999';
const artifactHash = 'c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c';
const projects = [
  { id: ownerProject, owner_id: ownerId, name: 'Owner project', description: '', workspace_path: 'C:/owner', created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' },
  { id: ownerSecondProject, owner_id: ownerId, name: 'Second owner project', description: '', workspace_path: 'C:/owner-second', created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' },
  { id: otherProject, owner_id: otherId, name: 'Other project', description: '', workspace_path: 'C:/other', created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' },
];
const reviews: Array<Record<string, unknown>> = [
  { id: ownerReview, project_id: ownerProject, name: 'Owner Review', review_type: 'code_review', status: 'failed', scope: {}, config: {}, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' },
];
const reviewOperations: Array<Record<string, unknown>> = [];
const reviewDecisions: Array<Record<string, unknown>> = [];
const decisionAttachments: Array<Record<string, unknown>> = [
  { id: ownerDecisionAttachment, project_id: ownerProject, review_session_id: ownerReview, decision_id: ownerDecision,
    storage_path: `${ownerProject}/${ownerReview}/${ownerDecision}/notes.md`, file_name: 'notes.md', mime_type: 'text/markdown',
    byte_size: 5, content_hash: 'hash', created_at: '2026-09-23T00:00:00Z' },
];
const auditEvents: Array<Record<string, unknown>> = [];
const findings: Array<Record<string, unknown>> = [
  { id: ownerFinding, project_id: ownerProject, review_session_id: ownerReview, status: 'new', source: 'static', severity: 'high', priority: 'high', title: 'Owner finding', description: '', category: '', evidence_text: '', recommendation: '', confidence: '', location: {}, created_at: '2026-09-23T00:00:00Z' },
];
const requirements: Array<Record<string, unknown>> = [
  { id: ownerRequirement, project_id: ownerProject, title: 'Owner requirement', description: '', category: '', priority: 'medium', created_at: '2026-09-23T00:00:00Z' },
  { id: otherRequirement, project_id: otherProject, title: 'Other requirement', description: '', category: '', priority: 'medium', created_at: '2026-09-23T00:00:00Z' },
];
const standards: Array<Record<string, unknown>> = [
  { id: otherStandard, project_id: otherProject, name: 'Other standard', created_at: '2026-09-23T00:00:00Z' },
];
const artifacts: Array<Record<string, unknown>> = [
  { id: ownerArtifact, project_id: ownerProject, name: 'policy.txt', path: 'policy.txt', kind: 'requirement', mime_type: 'text/plain', metadata: {}, created_at: '2026-09-23T00:00:00Z' },
  { id: ownerSecondArtifact, project_id: ownerSecondProject, name: 'second.txt', path: 'second.txt', kind: 'requirement', mime_type: 'text/plain', metadata: {}, created_at: '2026-09-23T00:00:00Z' },
  { id: otherArtifact, project_id: otherProject, name: 'other.txt', path: 'other.txt', kind: 'requirement', mime_type: 'text/plain', metadata: {}, created_at: '2026-09-23T00:00:00Z' },
];
const versions: Array<Record<string, unknown>> = [
  { id: ownerVersion, project_id: ownerProject, artifact_id: ownerArtifact, version_number: 1, content_hash: artifactHash, storage_path: `${ownerProject}/${ownerArtifact}/${artifactHash}`, content_type: 'text/plain', created_at: '2026-09-23T00:00:00Z' },
  { id: otherVersion, project_id: otherProject, artifact_id: otherArtifact, version_number: 1, content_hash: artifactHash, storage_path: `${otherProject}/${otherArtifact}/${artifactHash}`, content_type: 'text/plain', created_at: '2026-09-23T00:00:00Z' },
];
const reports: Array<Record<string, unknown>> = [
  { id: reportId, project_id: ownerProject, actor_id: ownerId, policy_version: 'risk-v1', generator_version: 'report-v3',
    snapshot: { metadata: { outputFiles: { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' } } },
    json_storage_path: `${ownerProject}/${reportId}/snapshot.json`, markdown_storage_path: `${ownerProject}/${reportId}/report.md`, pdf_storage_path: `${ownerProject}/${reportId}/report.pdf`, created_at: '2026-09-23T00:00:00Z' },
];
const modelUsage: Array<Record<string, unknown>> = [
  { id: 'usage-text', project_id: ownerProject, review_session_id: ownerReview, owner_id: ownerId,
    stage: 'model_analysis', attempt: 1, provider: 'custom', model: 'review-model', input_tokens: 10, output_tokens: 2,
    cache_read_tokens: 0, cache_creation_tokens: 0, metadata: { scope: 'text', callKind: 'review', apiFormat: 'openai-compatible' }, created_at: '2026-09-23T00:00:00Z' },
  { id: 'usage-embedding', project_id: ownerProject, review_session_id: ownerReview, owner_id: ownerId,
    stage: 'context_retrieval', attempt: 1, provider: 'custom', model: 'embedding-model', input_tokens: 4, output_tokens: 0,
    cache_read_tokens: 0, cache_creation_tokens: 0, metadata: { scope: 'embedding', callKind: 'review', apiFormat: 'openai-compatible' }, created_at: '2026-09-23T00:00:01Z' },
];
const projectAssessments: Array<Record<string, unknown>> = [
  { project_id: ownerProject, snapshot: {
    projectId: ownerProject, status: 'available', policyVersion: 'old-policy',
    summary: { critical: 9, high: 0, medium: 0, low: 0, classified: 9, unclassified: 0 },
    riskItems: [], traceability: { status: 'available', reviewId: ownerReview, summary: { complete: 1 } },
  } },
];
const sourceSnapshots: Array<Record<string, unknown>> = [
  { id: 'source-snapshot-1', project_id: ownerProject, review_session_id: ownerReview, status: 'available',
    snapshot: { capturedAt: '2026-09-23T00:00:00Z', artifacts: [{ id: ownerArtifact, name: 'policy.txt', kind: 'requirement', metadata: { contentHash: artifactHash } }] },
    created_at: '2026-09-23T00:00:00Z' },
];
const traceabilitySnapshots: Array<Record<string, unknown>> = [
  { id: 'traceability-snapshot-1', project_id: ownerProject, review_session_id: ownerReview, status: 'available',
    records: [{ requirementId: ownerRequirement, state: 'complete' }], summary: { complete: 1 }, created_at: '2026-09-23T00:00:00Z' },
];

function bearerClient(accessToken: string): SupabaseClient {
  const actorId = accessToken === 'owner-token' || accessToken === 'owner-refreshed-token'
    ? ownerId : accessToken === 'other-token' ? otherId : null;
  return {
    auth: {
      getUser: async () => actorId
        ? { data: { user: { id: actorId } as User }, error: null }
        : { data: { user: null }, error: { message: 'Invalid token' } },
    },
    from: (table: string) => {
      const rows: Array<Record<string, unknown>> = table === 'projects' ? projects : table === 'artifacts' ? artifacts : table === 'artifact_versions' ? versions : table === 'report_exports' ? reports : table === 'review_sessions' ? reviews : table === 'review_operations' ? reviewOperations : table === 'audit_events' ? auditEvents : table === 'findings' ? findings : table === 'requirements' ? requirements : table === 'project_standards' ? standards : table === 'model_usage_records' ? modelUsage : table === 'review_decisions' ? reviewDecisions : table === 'review_decision_attachments' ? decisionAttachments : table === 'project_assessments' ? projectAssessments : table === 'review_source_snapshots' ? sourceSnapshots : table === 'review_traceability_snapshots' ? traceabilitySnapshots : [];
      if (!['projects', 'artifacts', 'artifact_versions', 'report_exports', 'review_sessions', 'review_operations', 'review_worker_leases', 'audit_events', 'findings', 'requirements', 'project_standards', 'model_configurations', 'model_usage_records', 'review_decisions', 'review_decision_attachments', 'project_assessments', 'review_source_snapshots', 'review_traceability_snapshots', 'storage_deletion_jobs'].includes(table)) throw new Error(`Unexpected table: ${table}`);
      const filters: Array<[string, unknown]> = [];
      const includedFilters: Array<[string, unknown[]]> = [];
      let selectedRange: [number, number] | null = null;
      let mutatedRow: Record<string, unknown> | null = null;
      let updatePatch: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
        is: () => query,
        in: (field: string, values: unknown[]) => { includedFilters.push([field, values]); return query; },
        lte: () => query,
        order: () => query,
        limit: () => query,
        range: (start: number, end: number) => { selectedRange = [start, end]; return query; },
        update: (value: Record<string, unknown>) => { updatePatch = value; return query; },
        insert: (value: Record<string, unknown>) => {
          mutatedRow = { ...value };
          rows.push(mutatedRow);
          return query;
        },
        upsert: (value: Record<string, unknown>) => {
          const index = rows.findIndex(row => row.operation === value.operation
            && row.project_id === value.project_id && row.idempotency_key === value.idempotency_key);
          mutatedRow = { ...value };
          if (index < 0) rows.push(mutatedRow);
          else rows[index] = mutatedRow;
          return query;
        },
        maybeSingle: async () => {
          if (table === 'model_configurations') return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.model_configurations' in the schema cache" } };
          const row = visible()[0] ?? null;
          if (row && updatePatch) Object.assign(row, updatePatch);
          return { data: row, error: null };
        },
        single: async () => ({ data: mutatedRow ?? visible()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          const found = visible();
          if (updatePatch) for (const row of found) Object.assign(row, updatePatch);
          return Promise.resolve(resolve({ data: found, error: null }));
        },
      };
      const visible = () => {
        const filtered = rows.filter(row => {
        const projectId = table === 'projects' ? row.id : row.project_id;
        const owningProject = projects.find(project => project.id === projectId);
        return owningProject?.owner_id === actorId
          && filters.every(([field, value]) => row[field] === value)
          && includedFilters.every(([field, values]) => values.includes(row[field]));
        });
        const serverRowCap = 120;
        return selectedRange
          ? filtered.slice(selectedRange[0], Math.min(selectedRange[1] + 1, selectedRange[0] + serverRowCap))
          : filtered.slice(0, serverRowCap);
      };
      return query;
    },
    storage: {
      from: (bucket: string) => {
        if (bucket === 'project-artifacts') return { download: async () => ({ data: new Blob([Buffer.from('artifact')]), error: null }) };
        if (bucket === 'project-reports') return { createSignedUrl: async (objectPath: string) => ({ data: { signedUrl: `https://signed.example.test/${objectPath}` }, error: null }) };
        if (bucket === 'decision-attachments') return { createSignedUrl: async (objectPath: string) => ({ data: { signedUrl: `https://signed.example.test/${objectPath}` }, error: null }) };
        throw new Error(`Unexpected bucket: ${bucket}`);
      },
    },
    rpc: async (name: string, input?: Record<string, unknown>) => {
      if (name === 'claim_review_lease') return { data: null, error: null };
      if (name !== 'submit_review_decision' || !input) return { data: null, error: { message: `Unexpected RPC: ${name}` } };
      const projectId = String(input.p_project_id);
      const reviewId = String(input.p_review_id);
      const existingOperation = reviewOperations.find(item => item.project_id === projectId
        && item.operation === 'record_decision' && item.idempotency_key === input.p_idempotency_key);
      if (existingOperation) {
        const existingDecision = reviewDecisions.find(item => item.id === existingOperation.decision_id);
        return { data: { operation: existingOperation, decision: existingDecision, parent: reviews.find(item => item.id === reviewId), preparedChild: null }, error: null };
      }
      const parent = reviews.find(item => item.id === reviewId && item.project_id === projectId);
      const member = projects.find(item => item.id === projectId)?.owner_id === actorId;
      if (!member || !parent || parent.status !== 'pending_approval' || input.p_actor_id !== actorId || input.p_decision !== 'approved') {
        return { data: null, error: { message: 'Decision is not permitted for this Review.' } };
      }
      const createdAt = '2026-09-23T00:00:02Z';
      const decision = {
        id: String(input.p_decision_id), project_id: projectId, review_session_id: reviewId,
        decision: 'approved', comment: String(input.p_comment ?? ''), reviewer: String(input.p_reviewer ?? ''), created_at: createdAt,
      };
      const operation = {
        operation: 'record_decision', idempotency_key: String(input.p_idempotency_key), project_id: projectId,
        review_id: reviewId, parent_review_id: null, decision_id: decision.id, created_at: createdAt,
      };
      reviewDecisions.push(decision);
      reviewOperations.push(operation);
      parent.status = 'approved';
      parent.revision = Number(parent.revision ?? 0) + 1;
      return { data: { operation, decision, parent, preparedChild: null }, error: null };
    },
  } as unknown as SupabaseClient;
}

describe('active sidecar HTTP bearer contract', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createSidecarServer(createAuthGateway({ clientFactory: bearerClient }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  async function get(path: string, token?: string, spoofedUserId?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(spoofedUserId ? { 'X-Centinel-User-Id': spoofedUserId } : {}),
      },
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it('allows only health without a bearer and never trusts the supplied user header', async () => {
    expect((await get('/health')).status).toBe(200);
    expect(await get('/projects', undefined, ownerId)).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    expect(await get('/projects', 'expired-token')).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });

    const visible = await get('/projects', 'owner-token', otherId);
    expect(visible.status).toBe(200);
    expect((visible.body as unknown as Array<{ id: string }>).map(project => project.id)).toEqual([ownerProject, ownerSecondProject]);
    expect(await get(`/projects/${otherProject}`, 'owner-token', otherId)).toMatchObject({ status: 403, body: { code: 'project_access_denied' } });
  });

  it('guards all local Dynamic endpoints with shared project membership', async () => {
    for (const suffix of ['', '/11111111-1111-1111-1111-111111111111', '/11111111-1111-1111-1111-111111111111/evidence']) {
      expect(await get(`/projects/${otherProject}/dynamic-sessions${suffix}`, 'owner-token', otherId)).toMatchObject({ status: 403, body: { code: 'project_access_denied' } });
    }
    const cancel = await fetch(`${baseUrl}/projects/${otherProject}/dynamic-sessions/11111111-1111-1111-1111-111111111111/cancel`, { method: 'POST', headers: { Authorization: 'Bearer owner-token' } });
    expect(cancel.status).toBe(403);
  });

  it('denies another project registered screenshot before checking the local filesystem', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(); setTestDb(db);
    try {
      db.run('INSERT INTO evidence (id, project_id, session_id, type, file_path, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['evidence-1', otherProject, 'session-1', 'screenshot', '/tmp/private-screenshot.png', '', '2026-10-07']);
      expect(await get('/evidence-file?path=%2Ftmp%2Fprivate-screenshot.png', 'owner-token', otherId)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    } finally { clearTestDb(); db.close(); }
  });

  it('returns an actionable migration error when Model Provider tables are absent', async () => {
    expect(await get('/settings/ai', 'owner-token')).toMatchObject({
      status: 503,
      body: { code: 'supabase_migration_required', error: expect.stringContaining('202609210001_phase1_static_foundation.sql') },
    });
  });

  it('accepts a refreshed token for the same identity without widening project access', async () => {
    expect((await get(`/projects/${ownerProject}`, 'owner-token')).status).toBe(200);
    expect((await get(`/projects/${ownerProject}`, 'owner-refreshed-token')).status).toBe(200);
    expect((await get(`/projects/${ownerProject}`, 'other-token')).status).toBe(403);
  });

  it('starts one authenticated Review for repeated requests with the same idempotency key', async () => {
    const initialReviews = reviews.length;
    const initialOperations = reviewOperations.length;
    const body = JSON.stringify({
      name: 'HTTP source review', reviewType: 'code_review',
      scope: { artifactIds: [ownerArtifact] }, idempotencyKey: 'http-start-once',
    });
    const start = async () => {
      const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions`, {
        method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body,
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
      const first = await start();
      const second = await start();
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
    } finally {
      reviews.splice(initialReviews);
      reviewOperations.splice(initialOperations);
    }
  });

  it('returns the original idempotent Review after a selected artifact is deleted', async () => {
    const initialReviews = reviews.length;
    const initialOperations = reviewOperations.length;
    const artifactIndex = artifacts.findIndex(item => item.id === ownerArtifact);
    const body = JSON.stringify({ name: 'Deleted-source retry', scope: { artifactIds: [ownerArtifact] }, idempotencyKey: 'http-deleted-source' });
    const start = async () => {
      const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions`, {
        method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body,
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    let removed: Record<string, unknown> | undefined;
    try {
      const first = await start();
      expect(first.status).toBe(201);
      removed = artifacts.splice(artifactIndex, 1)[0];
      const repeated = await start();
      expect(repeated.status).toBe(200);
      expect(repeated.body.id).toBe(first.body.id);
    } finally {
      if (removed) artifacts.splice(artifactIndex, 0, removed);
      reviews.splice(initialReviews);
      reviewOperations.splice(initialOperations);
    }
  });

  it('rejects a Review Start with no selected scope before creating a Review', async () => {
    const initialReviews = reviews.length;
    const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Empty review', scope: { artifactIds: [], requirementIds: [], standardIds: [] } }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Select at least one artifact, requirement, or coding standard.' });
    expect(reviews).toHaveLength(initialReviews);
  });

  it('denies Review Start in another user’s project without creating a Review', async () => {
    const initialReviews = reviews.length;
    const response = await fetch(`${baseUrl}/projects/${otherProject}/static-sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other project review', scope: { artifactIds: [ownerArtifact] } }),
    });
    expect(response.status).toBe(403);
    expect(reviews).toHaveLength(initialReviews);
  });

  it('rejects selected scope records outside the project before queuing a Review', async () => {
    const initialReviews = reviews.length;
    const initialOperations = reviewOperations.length;
    try {
      for (const scope of [
        { artifactIds: [otherArtifact] },
        { artifactIds: [ownerSecondArtifact] },
        { requirementIds: [otherRequirement] },
        { standardIds: [otherStandard] },
        { artifactIds: ['not-a-uuid'] },
      ]) {
        const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions`, {
          method: 'POST',
          headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Foreign scope', scope }),
        });
        expect(response.status).toBe(400);
        expect((await response.json() as Record<string, unknown>).code).toBe('invalid_review_scope');
        expect(reviews).toHaveLength(initialReviews);
      }
    } finally {
      reviews.splice(initialReviews);
      reviewOperations.splice(initialOperations);
    }
  });

  it('validates large Review selections without mistaking the Supabase row cap for missing artifacts', async () => {
    const initialArtifacts = artifacts.length;
    const initialReviews = reviews.length;
    const initialOperations = reviewOperations.length;
    const selected = Array.from({ length: 131 }, (_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`);
    artifacts.push(...selected.map(id => ({
      id, project_id: ownerProject, name: `${id}.txt`, path: `${id}.txt`, kind: 'requirement', metadata: {}, created_at: '2026-09-23T00:00:00Z',
    })));
    try {
      const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Large scope', scope: { artifactIds: selected } }),
      });
      expect(response.status).toBe(201);
      expect(reviews).toHaveLength(initialReviews + 1);
    } finally {
      artifacts.splice(initialArtifacts);
      reviews.splice(initialReviews);
      reviewOperations.splice(initialOperations);
    }
  });

  it('cancels a queued Review and retries it once through authenticated HTTP', async () => {
    const initialReviews = reviews.length;
    const initialOperations = reviewOperations.length;
    const initialAuditEvents = auditEvents.length;
    const post = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
      const started = await post(`/projects/${ownerProject}/static-sessions`, {
        name: 'Lifecycle review', scope: { artifactIds: [ownerArtifact] }, idempotencyKey: 'http-lifecycle-start',
      });
      expect(started.status).toBe(201);
      const reviewId = String(started.body.id);
      expect((await post(`/projects/${ownerProject}/static-sessions/${reviewId}/cancel`, {})).status).toBe(200);
      expect((await get(`/projects/${ownerProject}/static-sessions/${reviewId}`, 'owner-token')).body).toMatchObject({ status: 'cancelled' });
      const retryPath = `/projects/${ownerProject}/static-sessions/${reviewId}/retry`;
      const retried = await post(retryPath, { idempotencyKey: 'http-lifecycle-retry' });
      const repeated = await post(retryPath, { idempotencyKey: 'http-lifecycle-retry' });
      expect(retried.status).toBe(201);
      expect(repeated.status).toBe(200);
      expect(repeated.body.id).toBe(retried.body.id);
      expect(retried.body.id).not.toBe(reviewId);
      expect(reviews).toHaveLength(initialReviews + 2);
    } finally {
      reviews.splice(initialReviews);
      reviewOperations.splice(initialOperations);
      auditEvents.splice(initialAuditEvents);
    }
  });

  it('previews only hash-verified artifact versions within the bearer user project', async () => {
    const path = `/projects/${ownerProject}/artifacts/${ownerArtifact}/content`;
    const preview = await get(path, 'owner-token');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ versionId: ownerVersion, content: Buffer.from('artifact').toString('base64'), contentHash: artifactHash });
    expect((await get(path, 'other-token')).status).toBe(403);
    expect((await get(`${path}?versionId=${otherVersion}`, 'owner-token')).status).toBe(404);
  });

  it('lists and renews only the bearer user private reports', async () => {
    const historyPath = `/projects/${ownerProject}/reports`;
    const history = await get(historyPath, 'owner-token');
    expect(history.status).toBe(200);
    expect((history.body as unknown as Array<{ id: string }>).map(item => item.id)).toEqual([reportId]);
    expect((await get(historyPath, 'other-token')).status).toBe(403);

    const linksPath = `${historyPath}/${reportId}/links`;
    const ownerLinks = await fetch(`${baseUrl}${linksPath}`, { method: 'POST', headers: { Authorization: 'Bearer owner-token' } });
    expect(ownerLinks.status).toBe(200);
    expect((await ownerLinks.json() as { downloads: { pdf: string } }).downloads.pdf).toContain(`${ownerProject}/${reportId}/report.pdf`);
    const otherLinks = await fetch(`${baseUrl}${linksPath}`, { method: 'POST', headers: { Authorization: 'Bearer other-token' } });
    expect(otherLinks.status).toBe(403);
    const otherExport = await fetch(`${baseUrl}${historyPath}/export`, { method: 'POST', headers: { Authorization: 'Bearer other-token' } });
    expect(otherExport.status).toBe(403);
  });

  it('rejects Review retry and cancel through another owned project before changing the Review', async () => {
    for (const operation of ['retry', 'cancel']) {
      const response = await fetch(`${baseUrl}/projects/${ownerSecondProject}/static-sessions/${ownerReview}/${operation}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'Session not found' });
    }
    expect(reviews[0].status).toBe('failed');
  });

  it('limits decision history to an existing Review in the bearer project', async () => {
    const path = `/projects/${ownerProject}/static-sessions/${ownerReview}/decisions`;
    expect(await get(path, 'owner-token')).toMatchObject({ status: 200, body: [] });
    expect((await get(path, 'other-token')).status).toBe(403);
    expect((await get(path)).status).toBe(401);
    expect(await get(`/projects/${ownerSecondProject}/static-sessions/${ownerReview}/decisions`, 'owner-token'))
      .toMatchObject({ status: 404, body: { code: 'not_found' } });
  });

  it('does not renew a decision attachment through another decision URL', async () => {
    const base = `/projects/${ownerProject}/static-sessions/${ownerReview}/decisions`;
    const valid = await get(`${base}/${ownerDecision}/attachments/${ownerDecisionAttachment}`, 'owner-token');
    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({ id: ownerDecisionAttachment, decisionId: ownerDecision });
    expect(await get(`${base}/${otherDecision}/attachments/${ownerDecisionAttachment}`, 'owner-token'))
      .toMatchObject({ status: 404, body: { code: 'not_found' } });
  });

  it('records an authenticated approval once and exposes it in Review history', async () => {
    const originalStatus = reviews[0].status;
    const initialDecisions = reviewDecisions.length;
    const initialOperations = reviewOperations.length;
    const path = `/projects/${ownerProject}/static-sessions/${ownerReview}`;
    const submit = async () => {
      const response = await fetch(`${baseUrl}${path}/decision`, {
        method: 'POST',
        headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', comment: 'The evidence is sufficient.', idempotencyKey: 'http-approval-once' }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    reviews[0].status = 'pending_approval';
    try {
      const first = await submit();
      expect(first).toMatchObject({ status: 201, body: { decision: { decision: 'approved', comment: 'The evidence is sufficient.' }, parent: { status: 'approved' } } });
      const repeated = await submit();
      expect(repeated.status).toBe(201);
      expect((repeated.body.decision as { id: string }).id).toBe((first.body.decision as { id: string }).id);
      const history = await get(`${path}/decisions`, 'owner-token');
      expect(history).toMatchObject({ status: 200, body: [{ id: (first.body.decision as { id: string }).id, decision: 'approved' }] });
      expect((await get(`${path}/decisions`, 'other-token')).status).toBe(403);
    } finally {
      reviews[0].status = originalStatus;
      reviewDecisions.splice(initialDecisions);
      reviewOperations.splice(initialOperations);
    }
  });

  it('rejects reuse of a decision idempotency key for a different Review', async () => {
    const secondReviewId = '98989898-9898-4989-8989-989898989898';
    const originalStatus = reviews[0].status;
    const initialReviews = reviews.length;
    const initialDecisions = reviewDecisions.length;
    const initialOperations = reviewOperations.length;
    reviews[0].status = 'pending_approval';
    reviews.push({ ...reviews[0], id: secondReviewId, name: 'Second Review' });
    const submit = async (reviewId: string) => {
      const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions/${reviewId}/decision`, {
        method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', idempotencyKey: 'shared-decision-key' }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
      expect((await submit(ownerReview)).status).toBe(201);
      expect(await submit(secondReviewId)).toMatchObject({ status: 409, body: { code: 'idempotency_conflict' } });
      expect(await get(`/projects/${ownerProject}/static-sessions/${secondReviewId}/decisions`, 'owner-token'))
        .toMatchObject({ status: 200, body: [] });
    } finally {
      reviews[0].status = originalStatus;
      reviews.splice(initialReviews);
      reviewDecisions.splice(initialDecisions);
      reviewOperations.splice(initialOperations);
    }
  });

  it('keeps finding state and requirement mappings scoped to the URL project', async () => {
    const findingResponse = await fetch(`${baseUrl}/projects/${ownerSecondProject}/findings/${ownerFinding}`, {
      method: 'PUT', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'fixed' }),
    });
    expect(findingResponse.status).toBe(404);
    expect(findings[0].status).toBe('new');

    const requirementPath = `/projects/${ownerSecondProject}/requirements/${ownerRequirement}`;
    const mappingResponse = await fetch(`${baseUrl}${requirementPath}/map`, {
      method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(mappingResponse.status).toBe(404);
    expect((await get(`${requirementPath}/mappings`, 'owner-token')).status).toBe(404);
  });

  it('keeps per-Review usage scoped to its actual project and applies the requested model scope', async () => {
    const base = '/settings/ai/usage?callKind=review&scope=text';
    expect(await get(`${base}&sessionId=${ownerReview}`, 'owner-token')).toMatchObject({ status: 400 });
    expect(await get(`${base}&projectId=${ownerSecondProject}&sessionId=${ownerReview}`, 'owner-token'))
      .toMatchObject({ status: 404, body: { error: 'Session not found' } });
    expect((await get(`${base}&projectId=${ownerProject}&sessionId=${ownerReview}`, 'other-token')).status).toBe(403);

    const response = await get(`${base}&projectId=${ownerProject}&sessionId=${ownerReview}`, 'owner-token');
    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({ calls: 1, input: 10, output: 2 });
    expect((response.body.recent as Array<{ id: string; scope: string }>)).toEqual([expect.objectContaining({ id: 'usage-text', scope: 'text' })]);
  });

  it('lists and opens Reviews and findings only under the bearer project', async () => {
    const path = `/projects/${ownerProject}/static-sessions`;
    const list = await get(path, 'owner-token');
    expect(list.status).toBe(200);
    expect((list.body as unknown as Array<{ id: string }>).map(item => item.id)).toEqual([ownerReview]);
    expect((await get(path, 'other-token')).status).toBe(403);
    const detail = await get(`${path}/${ownerReview}`, 'owner-token');
    expect(detail).toMatchObject({ status: 200, body: { id: ownerReview, projectId: ownerProject } });
    expect((await get(`/projects/${ownerSecondProject}/static-sessions/${ownerReview}`, 'owner-token')).status).toBe(404);
    const findingsResponse = await get(`${path}/${ownerReview}/findings`, 'owner-token');
    expect(findingsResponse.status).toBe(200);
    expect((findingsResponse.body as unknown as Array<{ id: string }>).map(item => item.id)).toEqual([ownerFinding]);
    expect((await get(`${path}/${ownerReview}/findings`, 'other-token')).status).toBe(403);
    expect((await get(`/projects/${ownerSecondProject}/static-sessions/${ownerReview}/findings`, 'owner-token')).status).toBe(404);
  });

  it('scopes immutable source and traceability snapshots to the Review in the URL project', async () => {
    const base = `/projects/${ownerProject}/static-sessions/${ownerReview}`;
    expect(await get(`${base}/source-manifest`, 'owner-token')).toMatchObject({
      status: 200, body: { status: 'available', artifactCount: 1, sources: [{ artifactIds: [ownerArtifact] }] },
    });
    expect(await get(`${base}/traceability`, 'owner-token')).toMatchObject({
      status: 200, body: { status: 'available', summary: { complete: 1 } },
    });
    for (const endpoint of ['source-manifest', 'traceability']) {
      expect((await get(`${base}/${endpoint}`, 'other-token')).status).toBe(403);
      expect(await get(`/projects/${ownerSecondProject}/static-sessions/${ownerReview}/${endpoint}`, 'owner-token'))
        .toMatchObject({ status: 404, body: { error: 'Session not found' } });
    }
  });

  it('returns every project and Review finding with its state beyond one Supabase page', async () => {
    const initialLength = findings.length;
    findings.push(...Array.from({ length: 503 }, (_, index) => ({
      id: `bulk-finding-${index}`, project_id: ownerProject, review_session_id: ownerReview,
      status: index % 2 ? 'fixed' : 'new', source: 'static', severity: 'medium', priority: 'medium',
      title: `Finding ${index}`, description: '', category: 'quality', evidence_text: '', recommendation: '',
      location: {}, created_at: '2026-09-23T00:00:00Z',
    })));
    try {
      const projectResponse = await get(`/projects/${ownerProject}/findings`, 'owner-token');
      const reviewResponse = await get(`/projects/${ownerProject}/static-sessions/${ownerReview}/findings`, 'owner-token');
      expect(projectResponse.status).toBe(200);
      expect(reviewResponse.status).toBe(200);
      const projectFindings = projectResponse.body as unknown as Array<{ id: string; status: string }>;
      const reviewFindings = reviewResponse.body as unknown as Array<{ id: string; status: string }>;
      expect(projectFindings).toHaveLength(504);
      expect(reviewFindings).toHaveLength(504);
      expect(reviewFindings.find(item => item.id === 'bulk-finding-502')).toMatchObject({ status: 'new' });
    } finally {
      findings.splice(initialLength);
    }
  });

  it('returns every project requirement beyond one Supabase page', async () => {
    const initialLength = requirements.length;
    requirements.push(...Array.from({ length: 503 }, (_, index) => ({
      id: `bulk-requirement-${index}`, project_id: ownerProject, title: `Requirement ${index}`,
      description: '', category: 'functional', priority: 'medium', created_at: '2026-09-23T00:00:00Z',
    })));
    try {
      const response = await get(`/projects/${ownerProject}/requirements`, 'owner-token');
      expect(response.status).toBe(200);
      const rows = response.body as unknown as Array<{ id: string }>;
      expect(rows).toHaveLength(504);
      expect(rows.some(row => row.id === 'bulk-requirement-502')).toBe(true);
    } finally {
      requirements.splice(initialLength);
    }
  });

  it('rejects invalid Review lifecycle transitions before launching execution', async () => {
    const completedId = '33333333-3333-4333-8333-333333333333';
    const cancelledId = '44444444-4444-4444-8444-444444444444';
    reviews.push(
      { id: completedId, project_id: ownerProject, name: 'Completed Review', review_type: 'code_review',
        status: 'completed', scope: {}, config: {}, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' },
      { id: cancelledId, project_id: ownerProject, name: 'Cancelled Review', review_type: 'code_review',
        status: 'cancelled', scope: {}, config: {}, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' },
    );
    const post = async (reviewId: string, action: string, token: string) => {
      const response = await fetch(`${baseUrl}/projects/${ownerProject}/static-sessions/${reviewId}/${action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
      expect(await post(completedId, 'cancel', 'owner-token')).toMatchObject({
        status: 409, body: { code: 'review_lifecycle_conflict' },
      });
      expect(await post(completedId, 'retry', 'owner-token')).toMatchObject({
        status: 409, body: { code: 'review_lifecycle_conflict' },
      });
      expect(await post(cancelledId, 'cancel', 'owner-token')).toMatchObject({ status: 200, body: { ok: true } });
      expect((await post(completedId, 'cancel', 'other-token')).status).toBe(403);
      expect(reviews.find(row => row.id === completedId)?.status).toBe('completed');
    } finally {
      reviews.splice(-2);
    }
  });

  it('does not disguise a denied project assessment as a service outage', async () => {
    const response = await get(`/projects/${ownerProject}/assessment`, 'other-token');
    expect(response).toMatchObject({ status: 403, body: { code: 'forbidden' } });
  });

  it('serves current risk through the authenticated assessment route after a finding is fixed', async () => {
    const path = `/projects/${ownerProject}/assessment`;
    const originalStatus = findings[0].status;
    try {
      const before = await get(path, 'owner-token');
      expect(before).toMatchObject({ status: 200, body: { summary: { critical: 1, classified: 1 } } });
      expect(before.body.traceability).toMatchObject({ reviewId: ownerReview });
      findings[0].status = 'fixed';
      const after = await get(path, 'owner-refreshed-token');
      expect(after).toMatchObject({ status: 200, body: { summary: { critical: 0, classified: 0 }, riskItems: [] } });
      expect(after.body.traceability).toMatchObject({ reviewId: ownerReview });
    } finally {
      findings[0].status = originalStatus;
    }
  });
});
