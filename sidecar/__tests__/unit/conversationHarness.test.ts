import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConversationBrowserStartupError, ConversationRuntime, parseConversationInput, validateConversationPlan, type ConversationDeps } from '../../src/conversation/service.js';
import type { ConversationRequest, ConversationInput } from '../../src/conversation/types.js';
import type { ConversationStore } from '../../src/conversation/store.js';

class MemoryStore implements ConversationStore {
  records = new Map<string, ConversationRequest>();
  failUpdate = false;
  listEarlierTurns = vi.fn<NonNullable<ConversationStore['listEarlierTurns']>>().mockImplementation(async (projectId, ownerId, before, limit) =>
    (await this.list(projectId)).filter(row => row.ownerId === ownerId && row.createdAt < before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit));
  async get(projectId: string, id: string) {
    const row = this.records.get(id);
    return row?.projectId === projectId ? structuredClone(row) : null;
  }
  async list(projectId: string) { return [...this.records.values()].filter(row => row.projectId === projectId).map(row => structuredClone(row)); }
  async listEarlierCompleted(projectId: string, ownerId: string, before: string, limit: number) {
    return (await this.list(projectId)).filter(row => row.ownerId === ownerId && row.state === 'completed' && row.createdAt < before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async create(record: ConversationRequest) {
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, structuredClone(record)); return true;
  }
  async update(record: ConversationRequest, revision: number) {
    if (this.failUpdate) throw new Error('storage down');
    if (this.records.get(record.id)?.revision !== revision) return false;
    this.records.set(record.id, structuredClone(record)); return true;
  }
}
const evidence = [{ id: 'finding:f1', text: JSON.stringify({ path: 'login.ts', note: 'Expected the generic sign-in error.', requirement: { description: 'Show “Generic error”.' } }), hash: 'hash', artifactId: 'source-1', versionId: 'version-1' }];
function fixture() {
  const store = new MemoryStore();
  const runtime = new ConversationRuntime();
  const deps: ConversationDeps = {
    ownerId: 'owner', store, held: () => false, authorize: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(evidence),
    plan: vi.fn().mockResolvedValue({ action: 'explain', reply: 'The saved finding concerns the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] }),
    execute: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
  };
  const input: ConversationInput = { id: randomUUID(), text: 'Explain the sign-in problem', mode: 'both', permission: 'auto', references: [] };
  return { store, runtime, deps, input };
}
async function waitFor(store: MemoryStore, id: string, state: ConversationRequest['state']) {
  await vi.waitFor(() => expect(store.records.get(id)?.state).toBe(state));
  return structuredClone(store.records.get(id)!);
}

describe('conversation request harness', () => {
  it('answers an unbound proceed without planning or executing an earlier check', async () => {
    const { input, runtime, deps, store } = fixture();
    await runtime.accept('project', { ...input, text: 'proceed' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', reply: expect.stringContaining('name the repository folder') });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it.each([
    ['Explain this saved check.', 'review:r1', { name: 'Cypress QA', findingCount: 56, findingExamples: [{ title: 'Window interface mismatch' }] }, '56 findings'],
    ['Explain what this saved problem means.', 'finding:f1', { title: 'Window interface mismatch', description: 'The declared property name differs.', path: 'support.ts' }, 'The original source excerpt is unavailable'],
    ['Explain what happened to this problem, how it works', 'finding:f1', { title: 'Window interface mismatch', description: 'The declared property name differs.', excerpt: 'interface Window {}' }, 'interface Window {}'],
    ['What happend to this issue?', 'finding:f1', { title: 'Window interface mismatch', description: 'The declared property name differs.' }, 'The original source excerpt is unavailable'],
    ['Explain', 'browser:b1', { tests: [{ name: 'Sign-in form', state: 'passed', checks: [{ observed: 'Username field visible' }] }] }, 'Username field visible'],
  ] as const)('retains the cited record for %s when the generated answer fails validation', async (text, id, data, fragment) => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id, hash: 'saved', text: JSON.stringify(data), unavailable: id.startsWith('finding:') }]);
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply: 'Unsupported answer', citations: [], scope: [] });
    const references = id.startsWith('browser:') ? [{ autoTestId: 'b1' }] : [{ reviewId: 'r1' }];
    await runtime.accept('project', { ...input, text, references }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'explain', replyOrigin: 'saved_evidence', answerUnavailable: true, citations: [id], reply: expect.stringContaining(fragment) });
    expect(deps.plan).toHaveBeenCalledOnce();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('generates a question-specific answer alongside the original problem details', async () => {
    const { input, runtime, deps, store } = fixture();
    const saved = { id: 'finding:f1', hash: 'saved', text: JSON.stringify({ title: 'Sign-in issue', path: 'src/auth/login.ts', originalStatus: 'new' }) };
    vi.mocked(deps.resolve).mockResolvedValue([saved]);
    const reply = '| Module | Saved path |\n| --- | --- |\n| Authentication | `src/auth/login.ts` |';
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply, citations: [saved.id], scope: [], claims: [{ citation: saved.id, excerpt: 'src/auth/login.ts' }] });
    await runtime.accept('project', { ...input, text: 'Explain this issue. Which module is affected?', references: [{ reviewId: 'r1', findingId: 'f1' }] }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ reply, replyFormat: 'markdown', explanation: { sections: [{ title: 'Sign-in issue', evidenceId: saved.id }] } });
    expect(deps.plan).toHaveBeenCalledOnce();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it.each(['code', 'browser'] as const)('handles an explicit module Review in %s mode without expanding its file scope', async mode => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([
      { id: 'module:project', text: '{"roots":["cypress"],"rootCount":1,"count":1}', hash: 'module' },
      { id: 'module-source:a', artifactId: 'a', versionId: 'v1', text: '{"path":"cypress/example.ts"}', hash: 'file' },
      { id: 'other', artifactId: 'b', text: '{}', hash: 'other' },
    ]);
    await runtime.accept('project', { ...input, mode, permission: 'ask', text: 'conduct a review on automation module' }, deps);
    const saved = await waitFor(store, input.id, mode === 'code' ? 'awaiting_permission' : 'completed');
    expect(saved).toMatchObject(mode === 'code' ? { action: 'code', scope: ['a'], reply: expect.stringContaining('cypress') }
      : { action: 'clarify', scope: [], questionOptions: ['Code review only', 'Keep Browser mode'] });
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.plan).not.toHaveBeenCalled();
    let waiting = saved;
    if (mode === 'browser') {
      await runtime.answerQuestion(saved, saved.revision, 0, deps);
      waiting = await waitFor(store, input.id, 'awaiting_permission');
      expect(waiting).toMatchObject({ action: 'code', scope: ['a'], selectedOption: 0, reviewContinuation: { sourceRequestId: input.id } });
      await runtime.answerQuestion(waiting, saved.revision, 0, deps);
      expect(deps.resolve).toHaveBeenCalledTimes(2);
    }
    await runtime.confirm(waiting, waiting.revision, deps);
    await waitFor(store, input.id, 'completed');
    expect(deps.execute).toHaveBeenCalledOnce();
  });

  it.each([false, true])('honors the current Ask first setting when answering a new Code choice (%s)', async askFirst => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([
      { id: 'module:project', text: '{"roots":["cypress"],"rootCount":1,"count":1}', hash: 'module' },
      { id: 'module-source:a', artifactId: 'a', text: '{}', hash: 'file' },
    ]);
    await runtime.accept('project', { ...input, mode: 'browser', permission: 'auto', text: 'Review cypress' }, deps);
    const question = await waitFor(store, input.id, 'completed');
    await runtime.answerQuestion(question, question.revision, 0, deps, askFirst);
    await waitFor(store, input.id, askFirst ? 'awaiting_permission' : 'completed');
    expect(deps.execute).toHaveBeenCalledTimes(askFirst ? 0 : 1);
    expect(deps.plan).not.toHaveBeenCalled();
  });
  it.each(['auto', 'ask'] as const)('uses only the bound source for a Code fallback after Browser startup failure (%s)', async permission => {
    const { input, runtime, deps, store } = fixture();
    const actions: string[] = [];
    vi.mocked(deps.plan).mockResolvedValue({ action: 'browser', reply: 'Check the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    vi.mocked(deps.execute).mockImplementation(async (record, _signal, checkpoint) => {
      actions.push(record.action!);
      if (record.action === 'browser') {
        await checkpoint({ autoTestId: 'saved-attempt' });
        throw new ConversationBrowserStartupError('App unavailable');
      }
      expect(record.scope).toEqual(['source-1']);
      await checkpoint({ reviewId: 'saved-review' });
    });
    await runtime.accept('project', { ...input, mode: 'both', permission, text: 'Verify the sign-in behavior' }, deps);
    if (permission === 'ask') {
      const initial = await waitFor(store, input.id, 'awaiting_permission');
      await runtime.confirm(initial, initial.revision, deps);
      await vi.waitFor(() => expect(store.records.get(input.id)).toMatchObject({ state: 'awaiting_permission', fallbackReason: 'browser_startup', action: 'code' }));
      expect(actions).toEqual(['browser']);
      const proposed = (await store.get('project', input.id))!;
      await runtime.confirm(proposed, proposed.revision, deps);
    }
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'code', fallbackReason: 'browser_startup', autoTestId: 'saved-attempt', reviewId: 'saved-review' });
    expect(actions).toEqual(['browser', 'code']);
  });

  it.each([['browser', 'Run a browser test for sign-in'], ['both', 'Run a browser test for sign-in, no Code review']] as const)(
    'keeps a Browser-only request in its requested mode after startup failure (%s)', async (mode, text) => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.plan).mockResolvedValue({ action: 'browser', reply: 'Check the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    vi.mocked(deps.execute).mockRejectedValue(new ConversationBrowserStartupError('App unavailable'));
    await runtime.accept('project', { ...input, mode, text }, deps);
    expect(await waitFor(store, input.id, 'failed')).toMatchObject({ action: 'browser' });
    expect(deps.execute).toHaveBeenCalledOnce();
  });

  it('blocks a model proposal for Browser when the person explicitly requests a Code check in combined mode', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.plan).mockResolvedValue({ action: 'browser', reply: 'Check the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await runtime.accept('project', { ...input, text: 'Run a code check for the sign-in error' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify' });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('asks for a narrower scope instead of silently rerunning a subset of a whole large Review', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([...evidence, { id: 'review:r1', hash: 'r1', text: '{"omittedSourceCount":11}' }]);
    vi.mocked(deps.plan).mockResolvedValue({ action: 'code', reply: 'Verify this Review.', citations: ['finding:f1'], scope: ['source-1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }] });
    await runtime.accept('project', { ...input, text: 'Run a code check for the attached Review' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', reply: expect.stringContaining('more source files') });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('answers exact project-name recall from saved context even when planning is unavailable', async () => {
    const { input, runtime, deps, store } = fixture();
    const priorId = randomUUID();
    await store.create({ id: priorId, projectId: 'project', ownerId: deps.ownerId, createdAt: '2026-01-01T00:00:00Z', updatedAt: '', revision: 0,
      input, inputHash: 'fixture', state: 'completed', action: 'explain', reply: 'The inventory names the project Cypress QA.', policyVersion: 'fixture', events: [] });
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'project:project', text: '{"name":"Cypress QA"}', hash: 'inventory' }]);
    vi.mocked(deps.plan).mockRejectedValue(new Error('provider unavailable'));
    await runtime.accept('project', { ...input, text: 'Repeat the exact project name from your immediately preceding reply. Cite that earlier conversation turn. Do not start a check.' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ reply: 'Cypress QA', replyOrigin: 'saved_recall', citations: ['conversation:' + priorId] });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rejects malformed and unbound problem references', () => {
    const { input } = fixture();
    expect(() => parseConversationInput({ ...input, references: [{ findingId: randomUUID() }] })).toThrow();
    expect(() => parseConversationInput({ ...input, references: [{ reviewId: randomUUID(), text: 'forged evidence' }] })).toThrow();
    expect(parseConversationInput({ ...input, references: [{ reviewId: randomUUID(), findingId: randomUUID() }] })).toMatchObject({ text: input.text });
  });
  it('checks membership before storing or reading evidence', async () => {
    const { store, runtime, deps, input } = fixture();
    vi.mocked(deps.authorize).mockRejectedValue(new Error('forbidden'));
    await expect(runtime.accept('project', input, deps)).rejects.toThrow('forbidden');
    expect(store.records.size).toBe(0);
    expect(deps.resolve).not.toHaveBeenCalled();
  });
  it('answers general questions without requiring a citation to ambient project inventory or history', async () => {
    const { store, runtime, deps, input } = fixture();
    const inventory = { id: 'project:project', text: '{"name":"Sample shop"}', hash: 'fixture' };
    vi.mocked(deps.resolve).mockResolvedValue([inventory]);
    await store.create({ id: randomUUID(), projectId: 'project', ownerId: deps.ownerId, revision: 0,
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', input, inputHash: 'fixture',
      policyVersion: 'fixture', state: 'completed', reply: 'Earlier discussion of the sample shop.', events: [] });
    const reply = 'A unit test checks a small piece of behavior in isolation.';
    vi.mocked(deps.plan).mockResolvedValue({ action: 'general', reply, citations: [], claims: [], scope: [] });
    await runtime.accept('project', { ...input, text: 'What is a unit test?' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'explain', reply, citations: [], scope: [] });
    expect(vi.mocked(deps.plan).mock.calls[0][3]).toHaveLength(1);
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('rejects general answers outside the allowed context or with evidence or executable scope', () => {
    const general = { action: 'general', reply: 'A unit test checks isolated behavior.', citations: [], claims: [], scope: [] };
    expect(() => validateConversationPlan(general, evidence, 'both')).toThrow();
    expect(() => validateConversationPlan({ ...general, citations: ['finding:f1'] }, evidence, 'both', [], true)).toThrow();
    expect(() => validateConversationPlan({ ...general, scope: ['source-1'] }, evidence, 'both', [], true)).toThrow();
  });

  it('explains only from resolved evidence and stores a source-free context manifest', async () => {
    const { store, runtime, deps, input } = fixture();
    await runtime.accept('project', input, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(deps.plan).toHaveBeenCalledWith(expect.anything(), evidence, expect.any(AbortSignal), []);
    expect(saved.context).toEqual([{ id: 'finding:f1', hash: 'hash', artifactId: 'source-1', versionId: 'version-1' }]);
    expect(JSON.stringify(saved)).not.toContain(evidence[0].text);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('keeps a bounded history receipt and excludes history from executable scope', async () => {
    const { store, runtime, deps, input } = fixture();
    const rows = Array.from({ length: 7 }, (_, index): ConversationRequest => ({
      id: randomUUID(), projectId: 'project', ownerId: 'owner', revision: 0, createdAt: `2026-01-0${index + 1}T00:00:00Z`, updatedAt: '',
      input, inputHash: 'fixture', policyVersion: 'fixture', state: 'completed', action: 'explain', reply: 'Earlier public result', events: [],
      scope: ['historical-asset'],
    }));
    for (const row of rows) await store.create(row);
    await runtime.accept('project', input, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved.recall).toEqual({ turns: 6, status: 'limited' });
    const history = vi.mocked(deps.plan).mock.calls[0][3];
    expect(history.map(item => item.id)).toEqual(rows.slice(1).map(row => 'conversation:' + row.id));
    expect(JSON.stringify(history)).not.toContain('historical-asset');
    const plan = { action: 'code', reply: 'Check the attached file.', scope: ['source-1'], citations: [history[0].id],
      claims: [{ citation: history[0].id, excerpt: 'Earlier public result' }] };
    expect(() => validateConversationPlan(plan, evidence, 'code', history)).toThrow('selected for this request');
  });

  it('stops a saturated evidence packet before model planning', async () => {
    const { store, runtime, deps, input } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'artifact:large', text: 'x'.repeat(64_000), hash: 'large' }]);
    await runtime.accept('project', input, deps);
    const saved = await waitFor(store, input.id, 'failed');
    expect(saved.failureStage).toBe('context');
    expect(deps.plan).not.toHaveBeenCalled();
  });

  it.each([['Username is required', 'completed'], ['"Username is required"', 'completed'], ['An account is mandatory', 'failed']] as const)(
    'can attach omitted evidence only when the requested repeat is verbatim (%s)', async (reply, expected) => {
      const { store, runtime, deps, input } = fixture();
      const priorId = randomUUID();
      await store.create({ id: priorId, ownerId: deps.ownerId, projectId: 'project', revision: 0, createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '', input, inputHash: 'fixture', policyVersion: 'fixture', state: 'completed', action: 'explain',
        reply: 'The validation reads "Username is required".', events: [] });
      vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply, scope: [], citations: [], claims: [] });
      await runtime.accept('project', { ...input, text: 'Repeat the exact wording from your previous reply.' }, deps);
      const saved = await waitFor(store, input.id, expected);
      if (expected === 'completed') expect(saved.citations).toEqual(['conversation:' + priorId]);
      else expect(saved.failureStage).toBe('validation');
      expect(deps.execute).not.toHaveBeenCalled();
    },
  );

  it('quotes the latest completed reply exactly without planning or loading evidence', async () => {
    const { store, runtime, deps, input } = fixture();
    const priorId = randomUUID();
    const reply = '**Synthetic** earlier answer.';
    await store.create({ id: priorId, projectId: 'project', ownerId: deps.ownerId, revision: 0,
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', input, inputHash: 'fixture',
      policyVersion: 'fixture', state: 'completed', action: 'explain', reply, replyFormat: 'markdown', events: [] });
    await runtime.accept('project', { ...input, text: 'Quote your previous reply.' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'explain', reply, replyFormat: 'markdown',
      citations: ['conversation:' + priorId], recall: { status: 'recalled', turns: 1 } });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.resolve).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('does not replace an ineligible latest reply with older completed history', async () => {
    const { store, runtime, deps, input } = fixture();
    const base = { projectId: 'project', ownerId: deps.ownerId, revision: 0, input, inputHash: 'fixture',
      policyVersion: 'fixture', events: [] as ConversationRequest['events'] };
    await store.create({ ...base, id: randomUUID(), createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
      state: 'completed', reply: 'Older answer.' });
    await store.create({ ...base, id: randomUUID(), createdAt: '2000-01-02T00:00:00.000Z', updatedAt: '2000-01-02T00:00:00.000Z',
      state: 'running', reply: 'Still running.' });
    await runtime.accept('project', { ...input, text: 'Quote your previous reply.' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', citations: [], recall: { status: 'missing', turns: 0 } });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it.each(['What does that mean?', 'proceed', 'conduct a review'])('uses the explicitly selected reply for %s', async text => {
    const { store, runtime, deps, input } = fixture();
    const selectedId = randomUUID(), newerId = randomUUID();
    const row = { projectId: 'project', ownerId: deps.ownerId, revision: 0, input, inputHash: 'fixture',
      updatedAt: '2000-01-01T00:00:00.000Z', policyVersion: 'fixture', state: 'completed' as const, events: [] };
    await store.create({ ...row, id: selectedId, createdAt: '2000-01-01T00:00:00.000Z', reply: 'Selected synthetic context.' });
    await store.create({ ...row, id: newerId, createdAt: '2000-01-02T00:00:00.000Z', reply: 'Unselected recent context.' });
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply: 'The selected context describes the saved finding.',
      citations: ['conversation:' + selectedId], claims: [{ citation: 'conversation:' + selectedId, excerpt: 'Selected synthetic context.' }], scope: [] });
    await runtime.accept('project', { ...input, text, replyToTurnId: selectedId }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved.replyTo).toEqual({ turnId: selectedId, status: 'resolved' });
    expect(saved.citations).toEqual(['conversation:' + selectedId]);
    expect(store.listEarlierTurns).not.toHaveBeenCalled();
    expect(deps.plan.mock.calls[0][1]).toContainEqual(expect.objectContaining({ id: 'conversation:' + selectedId, kind: 'prior_reply' }));
    expect(deps.plan.mock.calls[0][1]).not.toContainEqual(expect.objectContaining({ id: 'conversation:' + newerId }));
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('validates an exact quoted phrase against the selected reply text', async () => {
    const { store, runtime, deps, input } = fixture();
    const selectedId = randomUUID();
    await store.create({ id: selectedId, projectId: 'project', ownerId: deps.ownerId, revision: 0,
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', input, inputHash: 'fixture',
      policyVersion: 'fixture', state: 'completed', reply: 'The saved reply says "Username is required".', events: [] });
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply: '"Username is required"', citations: [], scope: [] });
    await runtime.accept('project', { ...input, text: 'Repeat the exact wording from your previous reply.', replyToTurnId: selectedId }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ reply: '"Username is required"', citations: ['conversation:' + selectedId],
      replyTo: { turnId: selectedId, status: 'resolved' } });
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('combines the selected reply with current attachments and requires a current citation', async () => {
    const { store, runtime, deps, input } = fixture();
    const selectedId = randomUUID();
    await store.create({ id: selectedId, projectId: 'project', ownerId: deps.ownerId, revision: 0,
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', input, inputHash: 'fixture',
      policyVersion: 'fixture', state: 'completed', reply: 'Earlier synthetic review context.', events: [] });
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply: 'The new attachment adds context to the earlier review.', scope: [],
      citations: [evidence[0].id, 'conversation:' + selectedId], claims: [
        { citation: evidence[0].id, excerpt: 'Expected the generic sign-in error.' },
        { citation: 'conversation:' + selectedId, excerpt: 'Earlier synthetic review context.' },
      ] });
    await runtime.accept('project', { ...input, text: 'Explain this with that earlier reply.', references: [{ artifactId: randomUUID() }],
      replyToTurnId: selectedId }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved).toMatchObject({ action: 'explain', replyTo: { turnId: selectedId, status: 'resolved' }, citations: [evidence[0].id, 'conversation:' + selectedId] });
    expect(deps.plan.mock.calls[0][1].map(item => item.id)).toEqual([evidence[0].id, 'conversation:' + selectedId]);
    expect(JSON.stringify(saved)).not.toContain('Earlier synthetic review context.');
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it.each(['code', 'browser'] as const)('does not execute a %s action through Reply to', async action => {
    const { store, runtime, deps, input } = fixture();
    const selectedId = randomUUID();
    await store.create({ id: selectedId, projectId: 'project', ownerId: deps.ownerId, revision: 0,
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', input, inputHash: 'fixture',
      policyVersion: 'fixture', state: 'completed', reply: 'Earlier synthetic context.', events: [] });
    vi.mocked(deps.plan).mockResolvedValue({ action, reply: 'Run this selected scope.', citations: ['finding:f1'],
      claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: action === 'code' ? ['source-1'] : [] });
    await runtime.accept('project', { ...input, text: 'Run a ' + action + ' check for this item', references: [{ artifactId: randomUUID() }],
      replyToTurnId: selectedId }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', replyTo: { turnId: selectedId, status: 'resolved' } });
    expect(deps.execute).not.toHaveBeenCalled();
    await expect(runtime.confirm((await store.get('project', input.id))!, (await store.get('project', input.id))!.revision, deps)).rejects.toThrow();
    await runtime.close();
  });

  it('fails closed for a Reply to target owned by someone else', async () => {
    const { store, runtime, deps, input } = fixture();
    const selectedId = randomUUID();
    await store.create({ id: selectedId, projectId: 'project', ownerId: 'different-owner', revision: 0,
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', input, inputHash: 'fixture',
      policyVersion: 'fixture', state: 'completed', reply: 'Private synthetic context.', events: [] });
    await runtime.accept('project', { ...input, text: 'Explain this more clearly.', replyToTurnId: selectedId }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', citations: [], replyTo: { turnId: selectedId, status: 'unavailable' } });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it.each(['What does that mean?', 'Which one failed?', 'Can you explain it?'])('clarifies an unattached ambiguous %s', async text => {
    const { runtime, deps, store, input } = fixture();
    await runtime.accept('project', { ...input, text }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', citations: [], reply: expect.stringContaining('Reply to') });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('coalesces concurrent sends and rejects a changed request under the same ID', async () => {
    const { store, runtime, deps, input } = fixture();
    await Promise.all([runtime.accept('project', input, deps), runtime.accept('project', input, deps)]);
    await waitFor(store, input.id, 'completed');
    expect(deps.plan).toHaveBeenCalledOnce();
    await expect(runtime.accept('project', { ...input, text: 'Run everything instead' }, deps)).rejects.toThrow('already used');
    await runtime.accept('project', input, deps);
    expect(deps.plan).toHaveBeenCalledOnce();
  });
  it('rejects cross-project reuse of a request ID', async () => {
    const { runtime, deps, input } = fixture();
    await runtime.accept('project', input, deps);
    await expect(runtime.accept('other-project', input, deps)).rejects.toThrow();
    await runtime.close();
  });
  it('blocks execution when evidence cannot be resolved', async () => {
    const { store, runtime, deps, input } = fixture();
    vi.mocked(deps.resolve).mockRejectedValue(new Error('wrong project or missing version'));
    await runtime.accept('project', input, deps);
    await waitFor(store, input.id, 'failed');
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rejects unsupported citations, scope expansion and missing frozen evidence', () => {
    const valid = { action: 'code', reply: 'Verify the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: ['source-1'] };
    expect(() => validateConversationPlan({ ...valid, citations: ['invented'] }, evidence, 'both')).toThrow();
    expect(() => validateConversationPlan({ ...valid, scope: ['another-file'] }, evidence, 'both')).toThrow();
    expect(() => validateConversationPlan(valid, [{ ...evidence[0], unavailable: true }], 'both')).toThrow();
    expect(() => validateConversationPlan(valid, evidence, 'browser')).toThrow();
  });
  it('requires the exact reviewed revision for Ask first and admits one child', async () => {
    const { store, runtime, deps, input } = fixture();
    input.text = 'Run a code check for this problem';
    vi.mocked(deps.plan).mockResolvedValue({ action: 'code', reply: 'Verify the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: ['source-1'] });
    await runtime.accept('project', { ...input, permission: 'ask' }, deps);
    const pending = await waitFor(store, input.id, 'awaiting_permission');
    expect(deps.execute).not.toHaveBeenCalled();
    await expect(runtime.confirm(pending, pending.revision - 1, deps)).rejects.toThrow();
    await Promise.allSettled([runtime.confirm(structuredClone(pending), pending.revision, deps), runtime.confirm(structuredClone(pending), pending.revision, deps)]);
    await waitFor(store, input.id, 'completed');
    expect(deps.execute).toHaveBeenCalledOnce();
  });
  it('honors a restrictive permission change while the model is planning', async () => {
    const { store, runtime, deps, input } = fixture();
    input.text = 'Test the sign-in error';
    let resolve!: (plan: unknown) => void;
    vi.mocked(deps.plan).mockImplementation(() => new Promise(done => { resolve = done; }));
    await runtime.accept('project', input, deps);
    await vi.waitFor(() => expect(deps.plan).toHaveBeenCalledOnce());
    await runtime.permission('project', 'ask', deps);
    resolve({ action: 'browser', reply: 'Test the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await waitFor(store, input.id, 'awaiting_permission');
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('preserves cancellation when a late model response arrives', async () => {
    const { store, runtime, deps, input } = fixture();
    let resolve!: (plan: unknown) => void;
    vi.mocked(deps.plan).mockImplementation(() => new Promise(done => { resolve = done; }));
    await runtime.accept('project', input, deps);
    await vi.waitFor(() => expect(deps.plan).toHaveBeenCalledOnce());
    await runtime.cancel((await store.get('project', input.id))!, deps);
    resolve({ action: 'browser', reply: 'Test the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await runtime.close();
    expect(store.records.get(input.id)?.state).toBe('cancelled');
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('stops before provider work when a required checkpoint fails', async () => {
    const { store, runtime, deps, input } = fixture();
    store.failUpdate = true;
    await runtime.accept('project', input, deps);
    await runtime.close();
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    store.failUpdate = false;
    store.records.get(input.id)!.leaseUntil = '2000-01-01T00:00:00Z';
    const restarted = new ConversationRuntime();
    await restarted.reconcile((await store.get('project', input.id))!, deps);
    expect(store.records.get(input.id)?.state).toBe('interrupted');
  });
  it('retains a child reference across final persistence failure without relaunch', async () => {
    const { store, runtime, deps, input } = fixture();
    input.text = 'Run a browser test';
    vi.mocked(deps.plan).mockResolvedValue({ action: 'browser', reply: 'Test sign-in.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    vi.mocked(deps.execute).mockImplementation(async (_record, _signal, checkpoint) => {
      await checkpoint({ autoTestId: 'child' });
      store.failUpdate = true;
    });
    await runtime.accept('project', input, deps);
    await vi.waitFor(() => expect(deps.execute).toHaveBeenCalledOnce());
    await runtime.close();
    store.failUpdate = false;
    store.records.get(input.id)!.leaseUntil = '2000-01-01T00:00:00Z';
    const restarted = new ConversationRuntime();
    const saved = await restarted.reconcile((await store.get('project', input.id))!, deps);
    expect(saved).toMatchObject({ state: 'interrupted', autoTestId: 'child' });
    expect(deps.execute).toHaveBeenCalledOnce();
  });
  it('honors assessment holds before evidence or provider access', async () => {
    const { store, runtime, deps, input } = fixture();
    deps.held = () => true;
    await runtime.accept('project', input, deps);
    await waitFor(store, input.id, 'paused');
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.plan).not.toHaveBeenCalled();
  });
  it('asks for intent when the model proposes a run for an explanation request', async () => {
    const { store, runtime, deps, input } = fixture();
    vi.mocked(deps.plan).mockResolvedValue({ action: 'browser', reply: 'Test sign-in.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await runtime.accept('project', input, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved.action).toBe('clarify');
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rejects unsupported quotes and new resolution claims even with a real citation ID', () => {
    const valid = { action: 'explain', reply: 'The saved evidence describes the sign-in error.', citations: ['finding:f1'],
      claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] };
    expect(() => validateConversationPlan(valid, evidence, 'both')).not.toThrow();
    expect(() => validateConversationPlan({ ...valid, reply: 'The problem has been resolved.' }, evidence, 'both')).toThrow();
    expect(() => validateConversationPlan({ ...valid, claims: [{ citation: 'finding:f1', excerpt: 'The code is repaired.' }] }, evidence, 'both')).toThrow();
  });
  it('cancels a running request when permissions become restrictive before its next action', async () => {
    const { store, runtime, deps, input } = fixture();
    input.text = 'Run a browser test';
    let proceed!: () => void;
    let admitted = false;
    vi.mocked(deps.plan).mockResolvedValue({ action: 'browser', reply: 'Test sign-in.', citations: ['finding:f1'],
      claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    vi.mocked(deps.execute).mockImplementation(async (_record, signal) => {
      await new Promise<void>(done => { proceed = done; });
      signal.throwIfAborted();
      admitted = true;
    });
    await runtime.accept('project', input, deps);
    await vi.waitFor(() => expect(deps.execute).toHaveBeenCalledOnce());
    await runtime.permission('project', 'ask', deps);
    proceed();
    await runtime.close();
    expect(admitted).toBe(false);
    expect(store.records.get(input.id)?.state).toBe('cancelled');
  });
  it('does not interrupt a healthy leased request when another same-owner device reads it', async () => {
    const { store, runtime, deps, input } = fixture();
    let complete!: (result: unknown) => void;
    vi.mocked(deps.plan).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await runtime.accept('project', input, deps);
    await vi.waitFor(() => expect(deps.plan).toHaveBeenCalledOnce());
    const secondDevice = new ConversationRuntime();
    const current = await secondDevice.reconcile((await store.get('project', input.id))!, deps);
    expect(current.state).toBe('planning');
    expect(current.workerId).toBeTruthy();
    complete({ action: 'explain', reply: 'The saved evidence concerns the sign-in error.', citations: ['finding:f1'],
      claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await waitFor(store, input.id, 'completed');
    await runtime.close();
  });
});
