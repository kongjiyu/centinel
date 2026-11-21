import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthGateway, AuthenticatedRequest } from '../../src/auth/gateway.js';
import { AuthGatewayError } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import type { ConversationRequest } from '../../src/conversation/types.js';
import type { ProjectReadinessCoordinator } from '../../src/readiness/service.js';

const { rows, plan, resolveEvidence } = vi.hoisted(() => ({
  rows: new Map<string, ConversationRequest>(), plan: vi.fn(), resolveEvidence: vi.fn(),
}));
vi.mock('../../src/conversation/plan.js', () => ({ planConversation: plan }));
vi.mock('../../src/conversation/evidence.js', () => ({ resolveConversationEvidence: resolveEvidence }));
vi.mock('../../src/conversation/store.js', () => ({
  SupabaseConversationStore: class {
    async list(project: string) { return [...rows.values()].filter(record => record.projectId === project).map(record => structuredClone(record)); }
    async listEarlierTurns(project: string, owner: string, before: string, limit: number) {
      return [...rows.values()].filter(row => row.projectId === project && row.ownerId === owner
        && row.createdAt < before)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(row => structuredClone(row));
    }
    async get(project: string, id: string) { const row = rows.get(id); return row?.projectId === project ? structuredClone(row) : null; }
    async create(record: ConversationRequest) { if (rows.has(record.id)) return false; rows.set(record.id, structuredClone(record)); return true; }
    async update(record: ConversationRequest, revision: number) {
      if (rows.get(record.id)?.revision !== revision) return false;
      rows.set(record.id, structuredClone(record)); return true;
    }
  },
}));
const projectId = '11111111-1111-4111-8111-111111111111';
let server: Server;
let base: string;
let previousHold: string | undefined;
beforeEach(async () => {
  rows.clear(); vi.clearAllMocks();
  previousHold = process.env.CENTINEL_AI_ASSESSMENT_PAUSED;
  process.env.CENTINEL_AI_ASSESSMENT_PAUSED = '0';
  resolveEvidence.mockResolvedValue([{ id: 'review:one', text: 'saved evidence', hash: 'hash' }]);
  plan.mockResolvedValue({ action: 'explain', reply: 'This is a saved code observation.', citations: ['review:one'],
    claims: [{ citation: 'review:one', excerpt: 'saved evidence' }], scope: [] });
  const auth = {
    authenticate: async (headers: { authorization?: string }) => {
      if (!headers.authorization) throw new AuthGatewayError('Sign in.', 401, 'unauthenticated');
      return { userId: 'owner', accessToken: headers.authorization, client: { marker: headers.authorization },
        verifiedIssuedAt: headers.authorization.includes('newer') ? 200 : 100,
        user: { id: 'owner' }, suppliedUserId: null } as unknown as AuthenticatedRequest;
    },
    requireProjectMember: async (_auth: unknown, id: string) => { if (id !== projectId) throw new AuthGatewayError('Forbidden.', 403, 'forbidden'); },
  } as unknown as AuthGateway;
  const readiness = { adoptSession() {}, close() {} } as unknown as ProjectReadinessCoordinator;
  server = createSidecarServer(auth, { readinessCoordinator: readiness });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  if (previousHold === undefined) delete process.env.CENTINEL_AI_ASSESSMENT_PAUSED;
  else process.env.CENTINEL_AI_ASSESSMENT_PAUSED = previousHold;
});
const post = (path: string, body: unknown, token = true) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body),
});
it('authenticates the public route and returns the same persisted request after duplicate POSTs', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const input = { id: randomUUID(), text: 'Explain the evidence', mode: 'code', permission: 'auto', references: [] };
  expect((await post(path, input, false)).status).toBe(401);
  expect((await post('/projects/22222222-2222-4222-8222-222222222222/conversation-requests', input)).status).toBe(403);
  const [first, second] = await Promise.all([post(path, input), post(path, input)]);
  expect(first.status).toBe(202); expect(second.status).toBe(202);
  await vi.waitFor(() => expect(rows.get(input.id)?.state).toBe('completed'));
  expect(plan).toHaveBeenCalledOnce();
  const read = await fetch(base + path, { headers: { Authorization: 'Bearer fixture' } });
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject([{ id: input.id, reply: 'This is a saved code observation.', replyFormat: 'markdown', state: 'completed' }]);
  expect((await post(path, { ...input, text: 'A different request' })).status).toBe(409);
});
it('quotes an owner-scoped saved reply through the HTTP path without asking the planner', async () => {
  const id = randomUUID();
  const earlier = '2000-01-01T00:00:00.000Z';
  rows.set(id, { id, projectId, ownerId: 'owner', revision: 1, inputHash: 'fixture', createdAt: earlier, updatedAt: earlier,
    input: { id, text: 'Earlier synthetic request', mode: 'code', permission: 'ask', references: [] },
    state: 'completed', reply: '**Synthetic** earlier answer.', replyFormat: 'markdown', policyVersion: 'fixture', events: [] });
  const nextId = randomUUID();
  expect((await post('/projects/' + projectId + '/conversation-requests', {
    id: nextId, text: 'Quote your previous reply', mode: 'code', permission: 'ask', references: [],
  })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(nextId)).toMatchObject({
    state: 'completed', action: 'explain', reply: '**Synthetic** earlier answer.', replyFormat: 'markdown', citations: ['conversation:' + id],
    recall: { status: 'recalled', turns: 1 },
  }));
  expect(plan).not.toHaveBeenCalled();
  expect(resolveEvidence).not.toHaveBeenCalled();
});
it('rejects a forged evidence reference on the HTTP entry point', async () => {
  const response = await post('/projects/' + projectId + '/conversation-requests', {
    id: randomUUID(), text: 'Explain', mode: 'code', permission: 'auto', references: [{ findingId: randomUUID() }],
  });
  expect(response.status).toBe(400);
  expect(resolveEvidence).not.toHaveBeenCalled();
  expect(plan).not.toHaveBeenCalled();
});
it('adopts a newer same-owner session without letting an older poll revert it', async () => {
  let complete!: (value: unknown) => void;
  plan.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const path = '/projects/' + projectId + '/conversation-requests';
  const input = { id: randomUUID(), text: 'Explain the evidence', mode: 'code', permission: 'auto', references: [] };
  expect((await post(path, input)).status).toBe(202);
  await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
  const currentClient = plan.mock.calls[0][0];
  await fetch(base + path, { headers: { Authorization: 'Bearer newer-session' } });
  await fetch(base + path, { headers: { Authorization: 'Bearer old-session' } });
  expect(currentClient().marker).toBe('Bearer newer-session');
  complete({ action: 'explain', reply: 'This is a saved code observation.', citations: ['review:one'],
    claims: [{ citation: 'review:one', excerpt: 'saved evidence' }], scope: [] });
  await vi.waitFor(() => expect(rows.get(input.id)?.state).toBe('completed'));
});

it('uses a newly attached source even when the request resembles an earlier-reply quote', async () => {
  const previousId = randomUUID();
  const artifactId = randomUUID();
  const requestId = randomUUID();
  const earlier = '2000-01-01T00:00:00.000Z';
  rows.set(previousId, { id: previousId, projectId, ownerId: 'owner', revision: 1,
    inputHash: 'fixture', createdAt: earlier, updatedAt: earlier, input: {
      id: previousId, text: 'Earlier synthetic request', mode: 'code', permission: 'ask', references: [],
    }, state: 'completed', reply: 'Old fixture result.', policyVersion: 'fixture', events: [] });
  const id = 'artifact:' + artifactId;
  const evidence = [{ id, text: 'A newer synthetic layout note.', hash: 'fixture', artifactId }];
  resolveEvidence.mockResolvedValue(evidence);
  plan.mockResolvedValue({ action: 'explain', reply: '**New attachment:** a synthetic layout note.', scope: [],
    citations: [id], claims: [{ citation: id, excerpt: 'synthetic layout note' }] });
  expect((await post('/projects/' + projectId + '/conversation-requests', {
    id: requestId, text: 'Quote your previous reply.', mode: 'code', permission: 'ask', references: [{ artifactId }],
  })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(requestId)).toMatchObject({
    state: 'completed', replyFormat: 'markdown', citations: [id],
    reply: '**New attachment:** a synthetic layout note.',
  }));
  expect(rows.get(requestId)?.recall).toBeUndefined();
  expect(resolveEvidence).toHaveBeenCalledOnce();
  expect(plan).toHaveBeenCalledOnce();
});
