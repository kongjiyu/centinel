import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthGateway, AuthenticatedRequest } from '../../src/auth/gateway.js';
import { AuthGatewayError } from '../../src/auth/gateway.js';
import { createSidecarServer } from '../../src/index.js';
import type { ConversationRequest } from '../../src/conversation/types.js';
import type { ProjectReadinessCoordinator } from '../../src/readiness/service.js';
import { DynamicContractError } from '../../src/dynamic/types.js';
import { newAutoTestSession } from '../../src/dynamic/autonomous/orchestrator.js';

const { rows, plan, resolveEvidence, readHistory, storage } = vi.hoisted(() => ({
  rows: new Map<string, ConversationRequest>(), plan: vi.fn(), resolveEvidence: vi.fn(), readHistory: vi.fn(), storage: { real: false },
}));
vi.mock('../../src/conversation/plan.js', () => ({ planConversation: plan }));
vi.mock('../../src/conversation/evidence.js', () => ({ resolveConversationEvidence: resolveEvidence }));
vi.mock('../../src/store/localHistory.js', async importOriginal => {
  const { LocalHistory } = await importOriginal<typeof import('../../src/store/localHistory.js')>();
  class FixtureConversationStore {
    async list(project: string) {
      await readHistory();
      return [...rows.values()].filter(record => record.projectId === project).map(record => structuredClone(record));
    }
    async listEarlierCompleted(project: string, owner: string, before: string, limit: number) {
      return (await this.list(project)).filter(row => row.ownerId === owner && row.createdAt < before && row.state === 'completed')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    }
    async listEarlierTurns(project: string, owner: string, before: string, limit: number) {
      return [...rows.values()].filter(row => row.projectId === project && row.ownerId === owner && row.createdAt < before)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit).map(row => structuredClone(row));
    }
    async get(project: string, id: string) { const row = rows.get(id); return row?.projectId === project ? structuredClone(row) : null; }
    async create(record: ConversationRequest) { if (rows.has(record.id)) return false; rows.set(record.id, structuredClone(record)); return true; }
    async update(record: ConversationRequest, revision: number) {
      if (rows.get(record.id)?.revision !== revision) return false;
      rows.set(record.id, structuredClone(record)); return true;
    }
  }
  return { LocalHistory: class extends LocalHistory {
    override conversations(owner: string) { return storage.real ? super.conversations(owner) : new FixtureConversationStore(); }
  } };
});
const projectId = '11111111-1111-4111-8111-111111111111';
let server: Server;
let base: string;
let previousHold: string | undefined;
let historyDirectory: string;
beforeEach(async () => {
  rows.clear(); vi.clearAllMocks();
  storage.real = false;
  historyDirectory = mkdtempSync(join(tmpdir(), 'centinel-http-history-'));
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
  server = createSidecarServer(auth, { readinessCoordinator: readiness, historyPath: join(historyDirectory, 'history.sqlite') });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await rm(historyDirectory, { recursive: true, force: true, maxRetries: 5 });
  if (previousHold === undefined) delete process.env.CENTINEL_AI_ASSESSMENT_PAUSED;
  else process.env.CENTINEL_AI_ASSESSMENT_PAUSED = previousHold;
});
const post = (path: string, body: unknown, token = true) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body),
});
it('fetches local conversations and Auto Test history through the normal HTTP routes without a PostgREST client', async () => {
  storage.real = true;
  const { LocalHistory } = await vi.importActual<typeof import('../../src/store/localHistory.js')>('../../src/store/localHistory.js');
  const history = new LocalHistory(join(historyDirectory, 'history.sqlite'));
  const session = { ...newAutoTestSession({ id: randomUUID(), ownerId: 'owner', projectId, folder: historyDirectory }), stage: 'completed' as const };
  try {
    await history.autoTests('owner').save(session);
  } finally {
    history.close();
  }
  const path = '/projects/' + projectId;
  const id = randomUUID();
  expect((await post(path + '/conversation-requests', { id, text: 'Explain the evidence', mode: 'code', permission: 'auto', references: [] })).status).toBe(202);
  const headers = { Authorization: 'Bearer fixture' };
  await vi.waitFor(async () => {
    const response = await fetch(base + path + '/conversation-requests', { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ id, state: 'completed' }]);
  });
  const auto = await fetch(base + path + '/dynamic/autonomous', { headers });
  expect(auto.status).toBe(200);
  expect(await auto.json()).toMatchObject([{ id: session.id, stage: 'completed' }]);
  expect(readHistory).not.toHaveBeenCalled();
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
  expect(await read.json()).toMatchObject([{ id: input.id, reply: 'This is a saved code observation.', state: 'completed' }]);
  expect((await post(path, { ...input, text: 'A different request' })).status).toBe(409);
});

it('quotes the immediately preceding saved reply over HTTP without planning or evidence resolution', async () => {
  const priorId = randomUUID();
  const earlier = '2000-01-01T00:00:00.000Z';
  const reply = '**Synthetic** earlier answer.';
  rows.set(priorId, { id: priorId, projectId, ownerId: 'owner', revision: 1, inputHash: 'fixture', createdAt: earlier, updatedAt: earlier,
    input: { id: priorId, text: 'Earlier synthetic request', mode: 'code', permission: 'ask', references: [] },
    state: 'completed', action: 'explain', reply, replyFormat: 'markdown', policyVersion: 'fixture', events: [] });
  const id = randomUUID();
  const path = '/projects/' + projectId + '/conversation-requests';
  expect((await post(path, { id, text: 'Quote your previous reply.', mode: 'code', permission: 'ask', references: [] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'completed', action: 'explain', reply,
    replyFormat: 'markdown', citations: ['conversation:' + priorId], recall: { status: 'recalled', turns: 1 } }));
  expect(plan).not.toHaveBeenCalled();
  expect(resolveEvidence).not.toHaveBeenCalled();
});

it('honors an explicitly selected older Reply to target instead of the recent answer', async () => {
  const olderId = randomUUID(), recentId = randomUUID(), id = randomUUID();
  const saved = (turnId: string, createdAt: string, text: string): ConversationRequest => ({
    id: turnId, projectId, ownerId: 'owner', revision: 1, inputHash: 'fixture', createdAt, updatedAt: createdAt,
    input: { id: turnId, text: 'Earlier synthetic request', mode: 'code', permission: 'ask', references: [] },
    state: 'completed', action: 'explain', reply: text, replyFormat: 'markdown', policyVersion: 'fixture', events: [],
  });
  rows.set(olderId, saved(olderId, '2000-01-01T00:00:00.000Z', '**The selected older answer.**'));
  rows.set(recentId, saved(recentId, '2000-01-02T00:00:00.000Z', 'Unselected recent answer.'));
  const path = '/projects/' + projectId + '/conversation-requests';
  expect((await post(path, { id, text: 'Quote your previous reply.', mode: 'code', permission: 'ask', references: [], replyToTurnId: olderId })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'completed', reply: '**The selected older answer.**', replyFormat: 'markdown',
    citations: ['conversation:' + olderId], replyTo: { turnId: olderId, status: 'resolved' } }));
  expect(rows.get(id)?.reply).not.toContain('Unselected recent answer.');
  expect(plan).not.toHaveBeenCalled();
  expect(resolveEvidence).not.toHaveBeenCalled();
});

it('uses a newly attached source when the request resembles a previous-reply quote', async () => {
  const previousId = randomUUID(), artifactId = randomUUID(), requestId = randomUUID();
  const earlier = '2000-01-01T00:00:00.000Z';
  rows.set(previousId, { id: previousId, projectId, ownerId: 'owner', revision: 1, inputHash: 'fixture', createdAt: earlier, updatedAt: earlier,
    input: { id: previousId, text: 'Earlier synthetic request', mode: 'code', permission: 'ask', references: [] },
    state: 'completed', reply: 'Old fixture result.', policyVersion: 'fixture', events: [] });
  const source = 'artifact:' + artifactId;
  resolveEvidence.mockResolvedValue([{ id: source, text: JSON.stringify({ path: 'checkout-note.md', note: 'A newer synthetic layout note.' }), hash: 'fixture', artifactId }]);
  plan.mockResolvedValue({ action: 'explain', reply: '**New attachment:** a synthetic layout note.', scope: [],
    citations: [source], claims: [{ citation: source, excerpt: 'synthetic layout note' }] });
  expect((await post('/projects/' + projectId + '/conversation-requests', { id: requestId, text: 'Quote your previous reply.', mode: 'code', permission: 'ask',
    references: [{ artifactId }], referenceLabels: ['Checkout note.md'] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(requestId)).toMatchObject({ state: 'completed', replyFormat: 'markdown', citations: [source],
    input: { referenceLabels: ['Checkout note.md'] }, resolvedAttachmentNames: ['checkout-note.md'], reply: '**New attachment:** a synthetic layout note.' }));
  expect(plan).toHaveBeenCalledOnce();
  expect(resolveEvidence).toHaveBeenCalledOnce();
});

it('marks an explicitly selected reply unavailable without using another eligible turn', async () => {
  const decoyId = randomUUID(), targetId = randomUUID(), id = randomUUID();
  const saved = (turnId: string, createdAt: string, ownerId = 'owner') => ({
    id: turnId, projectId, ownerId, revision: 1, inputHash: 'fixture', createdAt, updatedAt: createdAt,
    input: { id: turnId, text: 'Earlier synthetic request', mode: 'code' as const, permission: 'ask' as const, references: [] },
    state: 'completed' as const, reply: 'Unrelated synthetic reply.', policyVersion: 'fixture', events: [],
  });
  rows.set(decoyId, saved(decoyId, '2000-01-02T00:00:00.000Z'));
  rows.set(targetId, saved(targetId, '2000-01-01T00:00:00.000Z', 'different-owner'));
  const path = '/projects/' + projectId + '/conversation-requests';
  expect((await post(path, { id, text: 'Explain this more clearly.', mode: 'code', permission: 'ask', references: [], replyToTurnId: targetId })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'completed', action: 'clarify', replyTo: { turnId: targetId, status: 'unavailable' } }));
  expect(rows.get(id)?.reply).not.toContain('Unrelated synthetic reply.');
  expect(rows.get(id)?.citations).not.toContain('conversation:' + decoyId);
  expect(plan).not.toHaveBeenCalled();
});
it('rejects a forged evidence reference on the HTTP entry point', async () => {
  const response = await post('/projects/' + projectId + '/conversation-requests', {
    id: randomUUID(), text: 'Explain', mode: 'code', permission: 'auto', references: [{ findingId: randomUUID() }],
  });
  expect(response.status).toBe(400);
  expect(resolveEvidence).not.toHaveBeenCalled();
  expect(plan).not.toHaveBeenCalled();
});

it('records a safe reason when an explicit Review produces a plan with no eligible file scope', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  const logger = vi.spyOn(console, 'warn').mockImplementation(() => {});
  plan.mockResolvedValueOnce({ action: 'code', reply: 'Private proposed reply', citations: ['review:one'],
    claims: [{ citation: 'review:one', excerpt: 'saved evidence' }], scope: [] });
  try {
    expect((await post(path, { id, text: 'Verify the order behavior in code', mode: 'code', permission: 'ask', references: [] })).status).toBe(202);
    await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'completed', action: 'clarify', reply: expect.stringContaining('Which repository folder') }));
    expect(rows.get(id)).not.toHaveProperty('reviewId');
    expect(logger).toHaveBeenCalledWith(`[conversation] Response validation rejected request ${id} (scope_unbound).`);
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/Private proposed reply|saved evidence|Verify the order behavior/);
  } finally { logger.mockRestore(); }
});

it.each(['Proceed with Code only first', 'Conduct a review'])('asks for scope directly for %s', async text => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  expect((await post(path, { id, text, mode: 'code', permission: 'ask', references: [] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'completed', action: 'clarify', reply: expect.stringMatching(/Which (?:repository )?folder/) }));
  expect(plan).not.toHaveBeenCalled();
  expect(resolveEvidence).not.toHaveBeenCalled();
  expect(rows.get(id)).not.toHaveProperty('reviewId');
  expect(rows.get(id)).not.toHaveProperty('autoTestId');
});

it('saves only a valid revision-bound option without dispatching a check', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  plan.mockResolvedValueOnce({ action: 'clarify', reply: 'Which verification should I run?', questionOptions: ['Code review only', 'Code and browser'], citations: [], scope: [] });
  expect((await post(path, { id, text: 'What should I verify?', mode: 'both', permission: 'ask', references: [] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)?.state).toBe('completed'));
  const revision = rows.get(id)!.revision;
  const answer = path + '/' + id + '/answer';
  expect((await post(answer, { revision, selectedOption: 3 })).status).toBe(400);
  expect((await post(answer, { revision: revision - 1, selectedOption: 1 })).status).toBe(409);
  const saved = await post(answer, { revision, selectedOption: 1 });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ state: 'completed', selectedOption: 1, revision: revision + 1 });
  expect((await post(answer, { revision, selectedOption: 1 })).status).toBe(200);
  expect((await post(answer, { revision, selectedOption: 0 })).status).toBe(409);
  expect(rows.get(id)).not.toHaveProperty('reviewId');
  expect(rows.get(id)).not.toHaveProperty('autoTestId');
  expect(plan).toHaveBeenCalledOnce();
});

it('resumes an already answered automation question from the original user request', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const priorId = randomUUID();
  const id = randomUUID();
  const priorText = 'Conduct a review on automation module';
  const question = 'Which verification should I run for the automation module?';
  const prior: ConversationRequest = { id: priorId, projectId, ownerId: 'owner', revision: 1, state: 'failed', createdAt: '2026-11-23T01:00:00Z',
    updatedAt: '2026-11-23T01:00:00Z', inputHash: 'fixture', policyVersion: 'legacy', events: [],
    input: { id: priorId, text: priorText, mode: 'both', permission: 'ask', references: [] } };
  rows.set(priorId, prior);
  rows.set(id, { ...prior, id, createdAt: '2026-11-23T01:01:00Z', state: 'completed', action: 'clarify', selectedOption: 0, reply: question,
    questionOptions: ['Code review only', 'Code and browser'], input: { ...prior.input, id, text: 'try again' } });
  resolveEvidence.mockResolvedValue([{ id: 'module:' + projectId, text: '{"roots":["cypress"],"rootCount":1,"count":1}', hash: 'module' },
    { id: 'module-source:file', artifactId: 'file', text: '{}', hash: 'file' }]);
  expect((await post(path + '/' + id + '/answer', { revision: 1, selectedOption: 0 })).status).toBe(200);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'awaiting_permission', action: 'code', scope: ['file'], selectedOption: 0,
    input: { text: 'try again' }, reviewContinuation: { sourceRequestId: priorId, text: priorText, question } }));
  expect(resolveEvidence).toHaveBeenCalledWith(expect.anything(), 'owner', projectId, [], expect.any(AbortSignal), false, priorText, expect.anything());
  expect(plan).not.toHaveBeenCalled();
  expect((await post(path + '/' + id + '/answer', { revision: 1, selectedOption: 0 })).status).toBe(200);
  expect(resolveEvidence).toHaveBeenCalledOnce();
});

it('asks for the folder after a Code choice when no trusted request supplies scope', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  plan.mockResolvedValueOnce({ action: 'clarify', reply: 'Which verification should I run for the automation module?', questionOptions: ['Code review only', 'Code and browser'], citations: [], scope: [] });
  expect((await post(path, { id, text: 'try again', mode: 'both', permission: 'ask', references: [] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)?.state).toBe('completed'));
  const saved = await post(path + '/' + id + '/answer', { revision: rows.get(id)!.revision, selectedOption: 0 });
  expect(await saved.json()).toMatchObject({ state: 'completed', action: 'clarify', selectedOption: 0, reply: expect.stringContaining('Which repository folder') });
  expect(resolveEvidence).toHaveBeenCalledOnce();
  expect(rows.get(id)).not.toHaveProperty('reviewId');
});

it('returns a recoverable history error while still admitting a new request', async () => {
  readHistory.mockRejectedValueOnce(new DynamicContractError(503, 'Conversation history is temporarily unavailable.'));
  const path = '/projects/' + projectId + '/conversation-requests';
  const authorization = { headers: { Authorization: 'Bearer fixture' } };
  expect((await fetch(base + path, authorization)).status).toBe(503);
  const id = randomUUID();
  expect((await post(path, { id, text: 'Explain the evidence', mode: 'code', permission: 'auto', references: [] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)?.state).toBe('completed'));
  expect(await (await fetch(base + path, authorization)).json()).toMatchObject([{ id, state: 'completed' }]);
});

it('prepares the Review requested in the screenshot even if history cannot be read', async () => {
  readHistory.mockRejectedValueOnce(new DynamicContractError(503, 'History read failed (57014).'));
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  const input = { id, text: 'proceed a review on automation module', mode: 'code', permission: 'ask', references: [] };
  resolveEvidence.mockResolvedValueOnce([
    { id: 'module:' + projectId, text: '{"roots":["cypress"],"rootCount":1,"count":1}', hash: 'module' },
    { id: 'module-source:file', artifactId: 'file', text: '{}', hash: 'file' },
  ]);
  expect((await post(path, input)).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'awaiting_permission', action: 'code', scope: ['file'] }));
  expect(plan).not.toHaveBeenCalled();
  expect(readHistory).not.toHaveBeenCalled();
  const authorization = { headers: { Authorization: 'Bearer fixture' } };
  expect((await fetch(base + path, authorization)).status).toBe(503);
  const status = await fetch(base + path + '/' + id, authorization);
  expect(await status.json()).toMatchObject({ id, state: 'awaiting_permission' });
});

it('gives a safe reattachment instruction when a saved reference is unavailable', async () => {
  resolveEvidence.mockRejectedValueOnce(new DynamicContractError(404, 'Private context detail.'));
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  expect((await post(path, { id, text: 'Explain this problem', mode: 'browser', permission: 'auto',
    references: [{ reviewId: randomUUID(), findingId: randomUUID() }] })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)).toMatchObject({ state: 'failed', failureStage: 'context', failureReason: 'missing_reference' }));
  const read = await fetch(base + path + '/' + id, { headers: { Authorization: 'Bearer fixture' } });
  expect(await read.json()).toMatchObject({ error: 'An attached record is unavailable. Reattach the saved Check or problem and send a new message.' });
  expect(plan).not.toHaveBeenCalled();
});

it('loads an older turn’s inline evidence from its saved attachment without planning or writing a new turn', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const id = randomUUID();
  const references = [{ reviewId: randomUUID(), findingId: randomUUID() }];
  rows.set(id, { id, projectId, ownerId: 'owner', revision: 1, state: 'failed', createdAt: '2026-11-21T00:00:00Z',
    updatedAt: '2026-11-21T00:00:00Z', inputHash: 'old', policyVersion: 'old', events: [],
    input: { id, text: 'What happened?', mode: 'code', permission: 'auto', references } });
  resolveEvidence.mockResolvedValueOnce([{ id: 'finding:' + references[0].findingId, hash: 'saved', text: JSON.stringify({
    title: 'Saved problem', nearby: { firstLine: 1, citedLine: 2, text: 'return savedValue;' },
  }) }]);
  const response = await fetch(`${base}${path}/${id}/evidence`, { headers: { Authorization: 'Bearer fixture' } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ unavailable: 0, sections: [{ title: 'Saved problem', sourceWindow: { text: 'return savedValue;' } }] });
  expect(resolveEvidence).toHaveBeenCalledWith(expect.anything(), 'owner', projectId, references, expect.any(AbortSignal), true, '', expect.anything());
  expect(rows.get(id)).toMatchObject({ state: 'failed', revision: 1 });
  expect(plan).not.toHaveBeenCalled();
  rows.set(id, { ...rows.get(id)!, ownerId: 'another-owner' });
  expect((await fetch(`${base}${path}/${id}/evidence`, { headers: { Authorization: 'Bearer fixture' } })).status).toBe(404);
  expect(resolveEvidence).toHaveBeenCalledOnce();
});

it('recalls a completed turn after reload and validates a citation without inheriting its source scope', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const first = { id: randomUUID(), text: 'Explain the sign-in label', mode: 'code', permission: 'auto', references: [] };
  expect((await post(path, first)).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(first.id)?.state).toBe('completed'));
  const saved = rows.get(first.id)!;
  const foreignId = randomUUID();
  rows.set(foreignId, { ...saved, id: foreignId, ownerId: 'other', reply: 'Foreign owner text.' });
  const foreign = await fetch(base + path + '/' + foreignId, { headers: { Authorization: 'Bearer fixture' } });
  expect(foreign.status).toBe(404);
  plan.mockResolvedValueOnce({ action: 'explain', reply: 'Here is what the earlier turn said.', citations: ['conversation:' + first.id],
    claims: [{ citation: 'conversation:' + first.id, excerpt: 'This is a saved code observation.' }], scope: [] });
  const followUp = { ...first, id: randomUUID(), text: 'What did you say earlier?', mode: 'browser' };
  expect((await post(path, followUp)).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(followUp.id)?.state).toBe('completed'));
  const earlier = plan.mock.calls.at(-1)![4];
  expect(earlier).toEqual([{ id: 'conversation:' + first.id, hash: expect.any(String), text: expect.stringContaining('This is a saved code observation.') }]);
  expect(rows.get(followUp.id)).toMatchObject({ recall: { turns: 1, status: 'loaded' }, scope: [], context: [{ id: 'review:one' }] });
  expect(rows.get(followUp.id)?.context?.[0]).not.toHaveProperty('text');
});

it('returns the exact previous project name and durable citation through HTTP without the planner', async () => {
  const path = '/projects/' + projectId + '/conversation-requests';
  const previousId = randomUUID();
  const first = { id: previousId, text: 'What is this project called?', mode: 'code' as const, permission: 'auto' as const, references: [] };
  const prior: ConversationRequest = { id: previousId, projectId, ownerId: 'owner', input: first, inputHash: 'receipt', revision: 5,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', state: 'completed', action: 'explain',
    policyVersion: 'fixture', reply: 'The project inventory shows Cypress QA.', events: [] };
  rows.set(previousId, prior);
  resolveEvidence.mockResolvedValue([{ id: 'project:' + projectId, text: '{"name":"Cypress QA"}', hash: 'inventory' }]);
  plan.mockRejectedValue(new Error('unavailable'));
  const id = randomUUID();
  expect((await post(path, { ...first, id, text: 'Repeat the exact project name from your immediately preceding reply. Cite that earlier conversation turn. Do not start a check.' })).status).toBe(202);
  await vi.waitFor(() => expect(rows.get(id)?.state).toBe('completed'));
  const read = await fetch(base + path + '/' + id, { headers: { Authorization: 'Bearer fixture' } });
  expect(await read.json()).toMatchObject({ state: 'completed', reply: 'Cypress QA', replyOrigin: 'saved_recall', citations: ['conversation:' + previousId] });
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
