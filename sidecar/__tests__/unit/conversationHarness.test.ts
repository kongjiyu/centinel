import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConversationBrowserStartupError, ConversationRuntime, parseConversationInput, validateConversationPlan, type ConversationDeps } from '../../src/conversation/service.js';
import type { ConversationRequest, ConversationInput } from '../../src/conversation/types.js';
import type { ConversationStore } from '../../src/conversation/store.js';
import { ReviewCancelledError } from '../../src/review/retry.js';
import { conversationModelRequest } from '../../src/conversation/plan.js';
import { browserTargets, validateBrowserTargets, visibleTextPreset } from '../../src/conversation/verification.js';
import { presetToTest } from '../../src/dynamic/autonomous/planner.js';

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
  it.each([
    [null, 'The failed Browser assertion count is unavailable.'],
    [0, 'The Browser Check recorded 0 failed assertions.'],
  ])('reports the saved Browser count %s without a generated answer', async (failedAssertions, expected) => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'browser:b1', hash: 'browser', text: JSON.stringify({
      failedAssertions, tests: failedAssertions === null ? [{ name: 'Checkout', state: 'blocked' }] : [],
    }) }]);
    await runtime.accept('project', { ...input, references: [{ autoTestId: 'b1' }],
      text: 'How many failed Browser assertions can we confirm for this saved combined Check, and what did the Browser leave incomplete?' }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved.reply?.startsWith(expected)).toBe(true);
    if (failedAssertions === null) expect(saved.reply).toContain('Checkout · blocked');
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('accepts an exact quotation across JSON escaping and discards execution scope from explanations', () => {
    const nativeExcerpt = 'The page displays "Ceramic Mug".';
    const saved = [{ id: 'browser:b1', text: JSON.stringify({ observation: nativeExcerpt }), hash: 'saved' }];
    const explanation = { action: 'explain', reply: 'The saved observation names Ceramic Mug.',
      scope: ['unbound/path.js'], citations: ['browser:b1'], claims: [{ citation: 'browser:b1', excerpt: nativeExcerpt }] };
    expect(validateConversationPlan(explanation, saved, 'browser').scope).toEqual([]);
    expect(() => validateConversationPlan({ ...explanation,
      claims: [{ citation: 'browser:b1', excerpt: 'The page displays "Canvas Bag".' }] }, saved, 'browser')).toThrow();
  });

  it('offers actions by mode and leaves the action for a saved problem question to the provider', async () => {
    const { input, store, runtime, deps } = fixture();
    const record = await runtime.accept('project', { ...input, text: 'Walk me through the saved finding.' }, deps);
    const schema = conversationModelRequest(record, evidence, []).outputSchema;
    expect(schema.properties.action.enum).toEqual(['explain', 'suggest', 'clarify', 'code', 'browser']);
    const code = conversationModelRequest({ ...record, input: { ...record.input, mode: 'code', text: 'Review src' } }, evidence, []);
    expect(code.outputSchema.properties.action.enum).toEqual(['explain', 'suggest', 'clarify', 'code']);
    expect(conversationModelRequest({ ...record, input: { ...record.input, replyToTurnId: 'prior' } }, evidence, []).outputSchema.properties.action.enum)
      .toEqual(['explain', 'suggest', 'clarify']);
    await waitFor(store, input.id, 'completed');
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('lets the provider propose a scoped Browser check for a request with an introductory phrase', async () => {
    const { input, runtime, deps, store } = fixture();
    const project = { id: 'project:project', text: '{"name":"Sample Shop"}', hash: 'inventory' };
    const text = 'In the Browser, verify that the signed-out Sample Shop catalogue shows "Ceramic Mug" on the home page.';
    vi.mocked(deps.resolve).mockResolvedValue([project]);
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'browser', reply: 'Check the catalogue on the home page.', citations: [project.id],
      claims: [{ citation: project.id, excerpt: 'Sample Shop' }], scope: [], questionOptions: ['This extra choice is ignored'] });
    await runtime.accept('project', { ...input, mode: 'browser', permission: 'ask', text }, deps);
    const waiting = await waitFor(store, input.id, 'awaiting_permission');
    expect(waiting).toMatchObject({ action: 'browser' });
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.confirm(waiting, waiting.revision, deps);
    await waitFor(store, input.id, 'completed');
    expect(deps.execute).toHaveBeenCalledOnce();
    const targets = browserTargets([project], text);
    const preset = visibleTextPreset(targets)!;
    expect(preset).toMatchObject({ startPath: '/', controls: [], checks: [{ kind: 'visible_text', expected: 'Ceramic Mug' }] });
    const test = presetToTest(preset, { appUrl: 'http://localhost:4000', projectId: 'project' })!;
    expect(() => validateBrowserTargets([test], targets)).not.toThrow();
    expect(() => validateBrowserTargets([{ ...test, controls: [{ selector: 'button', actions: ['click'] }] }], targets)).toThrow();
  });

  it('uses a file reference for a paraphrase without requiring a verbatim supporting quote', async () => {
    const { input, runtime, deps, store } = fixture();
    const file = { id: 'artifact:source', artifactId: 'source', hash: 'file', text: '{"path":"src/products.js","content":"function listProducts() {}"}' };
    const reply = 'This file defines the product list function.';
    const plan = { action: 'explain', reply, scope: [], citations: [file.id], claims: [{ citation: file.id, excerpt: 'The product list function' }] };
    vi.mocked(deps.resolve).mockResolvedValue([file]);
    vi.mocked(deps.plan).mockResolvedValue(plan);
    await runtime.accept('project', { ...input, text: 'Use the attached file to explain the product catalog.', references: [{ artifactId: 'source' }] }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ reply, citations: [file.id] });
    expect(deps.execute).not.toHaveBeenCalled();
    expect(() => validateConversationPlan({ ...plan, action: 'code', scope: ['source'] }, [file], 'both')).toThrow();
    expect(() => validateConversationPlan({ ...plan, citations: ['artifact:other'] }, [file], 'both')).toThrow();
  });

  it('keeps a clarification question usable when the provider supplies one invalid choice', () => {
    const reply = 'What text should the page show?';
    expect(validateConversationPlan({ action: 'clarify', reply, citations: [], scope: [], questionOptions: ['Only choice'] }, [], 'browser'))
      .toEqual({ action: 'clarify', reply, citations: [], scope: [] });
  });

  it('lets the provider answer without executing even after locating a named Review scope', async () => {
    const { input, runtime, deps, store } = fixture();
    const scope = { id: 'module:project', text: '{"roots":["src"],"rootCount":1,"count":1}', hash: 'module' };
    vi.mocked(deps.resolve).mockResolvedValue([scope,
      { id: 'module-source:file', artifactId: 'file', versionId: 'v1', text: '{"path":"src/catalogue.ts"}', hash: 'file' }]);
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: null, action: 'explain', reply: 'I found the source folder.',
      citations: [scope.id], claims: [{ citation: scope.id, excerpt: 'src' }], scope: [] });
    await runtime.accept('project', { ...input, mode: 'code', text: 'Review src' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'explain', scope: [] });
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it('answers an unbound proceed without planning or executing an earlier check', async () => {
    const { input, runtime, deps, store } = fixture();
    await runtime.accept('project', { ...input, text: 'proceed' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', reply: expect.stringContaining('name the repository folder') });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it.each([
    ['What did this saved check find?', 'review:r1', { name: 'Cypress QA', findingCount: 56, findingExamples: [{ title: 'Window interface mismatch' }] }, '56 problems'],
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

  it('summarizes one saved Check as status bullets without planning or executing', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([
      { id: 'review:r1', hash: 'code', text: JSON.stringify({ name: 'Catalogue', status: 'pending_approval', findingCount: 2, coverageIncomplete: true }) },
      { id: 'browser:b1', hash: 'browser', text: JSON.stringify({ stage: 'completed', failedAssertions: 1 }) },
    ]);
    await runtime.accept('project', { ...input, text: 'Where are we at now?', references: [{ reviewId: 'r1', autoTestId: 'b1' }] }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved).toMatchObject({ action: 'explain', replyFormat: 'markdown', citations: ['review:r1', 'browser:b1'] });
    expect(saved.reply).toContain('- **Code** — review ended · 2 saved findings.');
    expect(saved.reply).toContain('- **Browser** — check ended · 1 failed assertion');
    expect(saved.reply).toContain('- **Still open**');
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('answers a standard attached Check overview from the saved records without a provider', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([
      { id: 'review:r1', hash: 'code', text: JSON.stringify({ name: 'Catalogue', objective: 'Check the catalogue', findingCount: 2 }) },
      { id: 'browser:b1', hash: 'browser', text: JSON.stringify({ failedAssertions: 1, tests: [] }) },
    ]);
    await runtime.accept('project', { ...input, text: 'Explain the attached check.', references: [{ reviewId: 'r1', autoTestId: 'b1' }] }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved).toMatchObject({ action: 'explain', replyOrigin: 'saved_evidence', replyFormat: 'markdown',
      reply: 'The saved Code check recorded 2 problems. The Browser-proven problem count is unavailable. The saved Browser check recorded 1 failed Browser assertion.',
      citations: ['review:r1', 'browser:b1'] });
    expect(saved.explanation?.sections[0]).toMatchObject({ presentation: 'check', check: { code: { problemCount: 2 } } });
    expect(saved.explanation?.sections[1]).toMatchObject({ presentation: 'check', check: { browser: { failedAssertionCount: 1 } } });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['What was the objective?', 'Objective unavailable.'],
    ['What was the Code objective?', 'Objective unavailable.'],
  ])('answers a direct saved-Check objective question deterministically: %s', async (text, answer) => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'review:r1', hash: 'saved',
      text: JSON.stringify({ name: 'Catalogue', status: 'completed' }) }]);
    await runtime.accept('project', { ...input, text, references: [{ reviewId: 'r1' }] }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved).toMatchObject({ action: 'explain', replyOrigin: 'saved_evidence', replyFormat: 'markdown',
      reply: answer, citations: ['review:r1'] });
    expect(saved.explanation?.sections[0]).toMatchObject({ presentation: 'check', check: { objectiveUnavailable: true } });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('keeps other fields in scope when an unavailable objective is part of a multi-part question', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'review:r1', hash: 'saved',
      text: JSON.stringify({ name: 'Catalogue', status: 'completed', qualityEvidence: [
        { quality: 'Security', impact: 'The saved route does not check who owns this cart.' },
      ] }) }]);
    vi.mocked(deps.plan).mockRejectedValue(new ReviewCancelledError('Planner deadline reached'));
    await runtime.accept('project', { ...input,
      text: 'What was the objective, and what security impact was saved?', references: [{ reviewId: 'r1' }] }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved).toMatchObject({ replyOrigin: 'saved_evidence', answerUnavailable: true, citations: ['review:r1'] });
    expect(saved.reply).toContain('The saved objective is unavailable.');
    expect(saved.reply).toContain('The saved route does not check who owns this cart.');
    expect(deps.plan).toHaveBeenCalledOnce();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('shows the original attached problem and recommendation for a standard overview', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'finding:f1', hash: 'saved',
      text: JSON.stringify({ title: 'Display mismatch', description: 'The saved display differs.', path: 'src/cart.ts',
        excerpt: 'renderTotal()', recommendation: 'Use the computed total.' }) }]);
    await runtime.accept('project', { ...input, text: 'Explain the attached problem.',
      references: [{ reviewId: 'r1', findingId: 'f1' }] }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ replyOrigin: 'saved_evidence',
      explanation: { sections: [{ evidenceId: 'finding:f1', excerpt: 'renderTotal()',
        points: ['Saved recommendation: Use the computed total.'] }] } });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('asks for observable behavior when a Browser request supplies no scope or assertion', async () => {
    const { input, runtime, deps, store } = fixture();
    await runtime.accept('project', { ...input, mode: 'browser', text: 'Run a Browser check.' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify', reply: expect.stringContaining('what should the page show') });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('keeps a read-only saved result visible when the planner deadline expires', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'review:r1', hash: 'saved',
      text: JSON.stringify({ name: 'Catalogue', objective: 'Check the catalogue', status: 'blocked', findingCount: 0 }) }]);
    vi.mocked(deps.plan).mockRejectedValue(new ReviewCancelledError('Planner deadline reached'));
    await runtime.accept('project', { ...input, text: 'What quality attributes did this check cover?', references: [{ reviewId: 'r1' }] }, deps);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved).toMatchObject({ action: 'explain', replyOrigin: 'saved_evidence', answerUnavailable: true, citations: ['review:r1'] });
    expect(saved.explanation?.sections[0]).toMatchObject({ presentation: 'check', check: { code: { problemCount: 0 } } });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('recalls a relevant older turn as cited discussion with compact Check context', async () => {
    const { input, runtime, deps, store } = fixture();
    const oldId = randomUUID();
    const old: ConversationRequest = { id: oldId, revision: 1, projectId: 'project', ownerId: 'owner',
      state: 'completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z', inputHash: 'saved',
      input: { ...input, id: oldId, text: 'The catalogue Check should use the copper fixture.',
        references: [{ checkId: randomUUID(), checkFocus: 'Check the catalogue', reviewId: randomUUID() }] },
      reply: 'x'.repeat(1000) + ' Use the copper fixture. ' + 'y'.repeat(1000) };
    store.records.set(oldId, old);
    for (let index = 1; index <= 8; index++) {
      const id = randomUUID();
      const createdAt = `2026-01-0${index + 1}T00:00:00Z`;
      store.records.set(id, { ...old, id, createdAt, updatedAt: createdAt,
        input: { ...input, id, text: 'Other discussion', references: [] }, reply: 'Other answer' });
    }
    deps.store.findEarlierCompleted = vi.fn().mockResolvedValue([old]);
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply: 'Use the copper fixture.', citations: ['conversation:' + oldId],
      claims: [{ citation: 'conversation:' + oldId, excerpt: 'Use the copper fixture.' }], scope: [] });
    await runtime.accept('project', { ...input, text: 'What did you say earlier about the copper fixture?' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ citations: ['conversation:' + oldId], scope: [] });
    const recalled = vi.mocked(deps.plan).mock.calls[0][3].find(item => item.id === 'conversation:' + oldId)!;
    expect(JSON.parse(recalled.text)).toMatchObject({ excerptsOnly: true, checks: [{ focus: 'Check the catalogue' }] });
    expect(recalled.text).not.toContain(old.input.references[0].reviewId);
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

  it('continues a Browser clarification from custom user criteria and still waits for Ask first', async () => {
    const { input, runtime, deps, store } = fixture();
    const saved = { id: 'finding:f1', hash: 'saved', artifactId: 'source-1', versionId: 'v1',
      text: JSON.stringify({ path: 'src/auth/login.ts', title: 'Sign-in issue', requirement: { description: 'Users can sign in to the store.' } }) };
    vi.mocked(deps.resolve).mockResolvedValue([saved]);
    vi.mocked(deps.plan)
      .mockResolvedValueOnce({ action: 'clarify', reply: 'What should the page show?', questionOptions: ['Run a Browser check', 'Keep explaining'], citations: [], scope: [] })
      .mockResolvedValueOnce({ executionIntent: 'current_request', action: 'browser', reply: 'Check the saved sign-in behavior.', citations: ['finding:f1'], scope: [],
        claims: [{ citation: 'finding:f1', excerpt: 'src/auth/login.ts' }] });
    await runtime.accept('project', { ...input, text: 'Check this issue', mode: 'browser', permission: 'auto', references: [{ reviewId: 'r1', findingId: 'f1' }] }, deps);
    const question = await waitFor(store, input.id, 'completed');
    const questionId = question.pendingQuestionId!;
    await runtime.answerQuestion(question, { revision: question.revision, questionId,
      answer: { kind: 'custom', text: 'Run a Browser check and confirm the page shows "Welcome back".' } }, deps, true);
    const waiting = await waitFor(store, input.id, 'awaiting_permission');
    expect(waiting).toMatchObject({ action: 'browser', input: { permission: 'ask' }, continuation: {
      questionId, answerKind: 'custom', answer: 'Run a Browser check and confirm the page shows "Welcome back".' },
      questions: [{ answer: { automatic: false, kind: 'custom' } }] });
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.confirm(waiting, waiting.revision, deps);
    await waitFor(store, input.id, 'completed');
    expect(deps.execute).toHaveBeenCalledOnce();
    expect(deps.execute.mock.calls[0][0].action).toBe('browser');
  });

  it('resumes a Browser-only question with a manually supplied visible-text criterion and no attachment', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([{ id: 'project:project', text: '{"name":"Sample Shop"}', hash: 'project' }]);
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'custom_answer', action: 'browser', reply: 'Check the catalogue.', citations: ['project:project'],
      claims: [{ citation: 'project:project', excerpt: 'Sample Shop' }], scope: [] });
    await runtime.accept('project', { ...input, mode: 'browser', text: 'Run a browser check', references: [] }, deps);
    const question = await waitFor(store, input.id, 'completed');
    await runtime.answerQuestion(question, { revision: question.revision, questionId: question.pendingQuestionId!,
      answer: { kind: 'custom', text: 'Test the signed-out catalog and verify it shows "Ceramic Mug".' } }, deps);
    const finished = await waitFor(store, input.id, 'completed');
    expect(finished).toMatchObject({ action: 'browser', continuation: { answerKind: 'custom' }, questions: [{ answer: { kind: 'custom' } }] });
    expect(deps.plan).toHaveBeenCalledOnce();
    expect(deps.execute).toHaveBeenCalledOnce();
  });

  it.each([
    ['Describe this issue', false],
    ['Check this issue', true],
  ])('does not let an automatic option create execution intent or the only Browser criterion (%s)', async (text, explicitRequest) => {
    const { input, runtime, deps, store } = fixture();
    const saved = { id: 'finding:f1', hash: 'saved', artifactId: 'source-1', versionId: 'v1',
      text: JSON.stringify({ path: 'src/auth/login.ts', title: 'Sign-in issue', requirement: { description: 'Users can sign in to the store.' } }) };
    vi.mocked(deps.resolve).mockResolvedValue([saved]);
    vi.mocked(deps.plan)
      .mockResolvedValueOnce({ action: 'clarify', reply: 'Choose a Browser verification.', questionOptions: [
        'Run a Browser check and verify the page shows "Forged"', 'Ask me what the page should show'], citations: [], scope: [] })
      .mockResolvedValueOnce({ executionIntent: 'custom_answer', action: 'browser', reply: 'Run the suggested Browser check.', citations: ['finding:f1'], scope: [],
        claims: [{ citation: 'finding:f1', excerpt: 'src/auth/login.ts' }] });
    await runtime.accept('project', { ...input, text, mode: 'browser', permission: 'auto', references: [{ reviewId: 'r1', findingId: 'f1' }] }, deps);
    const question = await waitFor(store, input.id, 'completed');
    await runtime.answerQuestion(question, { revision: question.revision, questionId: question.pendingQuestionId!,
      answer: { kind: 'option', selectedOption: 0 }, automatic: true }, deps);
    const resumed = await waitFor(store, input.id, 'completed');
    expect(resumed.questions?.[0].answer).toMatchObject({ automatic: true, kind: 'option' });
    expect(resumed.action).toBe('clarify');
    expect(resumed.pendingQuestionId).toBeTruthy();
    expect(deps.execute).not.toHaveBeenCalled();
    expect(explicitRequest || text === 'Describe this issue').toBe(true);
  });

  it('uses question ID and revision CAS so a manual answer racing the timeout starts one continuation', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.plan).mockResolvedValueOnce({ action: 'clarify', reply: 'Which option should I use?',
      questionOptions: ['Use the first path', 'Use the second path'], citations: [], scope: [] });
    await runtime.accept('project', { ...input, text: 'Describe this issue' }, deps);
    const question = await waitFor(store, input.id, 'completed');
    const submission = (request: ConversationRequest, answer: { kind: 'option'; selectedOption: number } | { kind: 'custom'; text: string }, automatic = false) =>
      runtime.answerQuestion(request, { revision: question.revision, questionId: question.pendingQuestionId!, answer, automatic }, deps);
    const results = await Promise.allSettled([
      submission(structuredClone(question), { kind: 'option', selectedOption: 0 }, true),
      submission(structuredClone(question), { kind: 'custom', text: 'Use a different safe option.' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const saved = await waitFor(store, input.id, 'completed');
    expect(saved.questions).toHaveLength(1);
    expect(saved.questions?.[0].answer).toBeDefined();
    expect(deps.plan).toHaveBeenCalledTimes(2);
  });

  it.each(['code', 'browser'] as const)('handles an explicit module Review in %s mode without expanding its file scope', async mode => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([
      { id: 'module:project', text: '{"roots":["cypress"],"rootCount":1,"count":1}', hash: 'module' },
      { id: 'module-source:a', artifactId: 'a', versionId: 'v1', text: '{"path":"cypress/example.ts"}', hash: 'file' },
      { id: 'other', artifactId: 'b', text: '{}', hash: 'other' },
    ]);
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'code' });
    await runtime.accept('project', { ...input, mode, permission: 'ask', text: 'conduct a review on automation module' }, deps);
    const saved = await waitFor(store, input.id, mode === 'code' ? 'awaiting_permission' : 'completed');
    expect(saved).toMatchObject(mode === 'code' ? { action: 'code', scope: ['a'], reply: expect.stringContaining('cypress') }
      : { action: 'clarify', scope: [], questionOptions: ['Code review only', 'Keep Browser mode'] });
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.plan).toHaveBeenCalledTimes(mode === 'code' ? 1 : 0);
    let waiting = saved;
    if (mode === 'browser') {
      const questionId = saved.pendingQuestionId!;
      await runtime.answerQuestion(saved, { revision: saved.revision, questionId, answer: { kind: 'option', selectedOption: 0 } }, deps);
      waiting = await waitFor(store, input.id, 'awaiting_permission');
      expect(waiting).toMatchObject({ action: 'code', scope: ['a'], selectedOption: 0, reviewContinuation: { sourceRequestId: input.id } });
      await runtime.answerQuestion(waiting, { revision: saved.revision, questionId, answer: { kind: 'option', selectedOption: 0 } }, deps);
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
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'code' });
    await runtime.accept('project', { ...input, mode: 'browser', permission: 'auto', text: 'Review cypress' }, deps);
    const question = await waitFor(store, input.id, 'completed');
    await runtime.answerQuestion(question, { revision: question.revision, questionId: question.pendingQuestionId!,
      answer: { kind: 'option', selectedOption: 0 } }, deps, askFirst);
    await waitFor(store, input.id, askFirst ? 'awaiting_permission' : 'completed');
    expect(deps.execute).toHaveBeenCalledTimes(askFirst ? 0 : 1);
    expect(deps.plan).toHaveBeenCalledOnce();
  });
  it.each(['auto', 'ask'] as const)('uses only the bound source for a Code fallback after Browser startup failure (%s)', async permission => {
    const { input, runtime, deps, store } = fixture();
    const actions: string[] = [];
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'browser', reply: 'Check the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
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
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'browser', reply: 'Check the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    vi.mocked(deps.execute).mockRejectedValue(new ConversationBrowserStartupError('App unavailable'));
    await runtime.accept('project', { ...input, mode, text }, deps);
    expect(await waitFor(store, input.id, 'failed')).toMatchObject({ action: 'browser' });
    expect(deps.execute).toHaveBeenCalledOnce();
  });

  it('blocks a model proposal for Browser when the person explicitly requests a Code check in combined mode', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'browser', reply: 'Check the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await runtime.accept('project', { ...input, text: 'Run a code check for the sign-in error' }, deps);
    expect(await waitFor(store, input.id, 'completed')).toMatchObject({ action: 'clarify' });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('asks for a narrower scope instead of silently rerunning a subset of a whole large Review', async () => {
    const { input, runtime, deps, store } = fixture();
    vi.mocked(deps.resolve).mockResolvedValue([...evidence, { id: 'review:r1', hash: 'r1', text: '{"omittedSourceCount":11}' }]);
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'code', reply: 'Verify this Review.', citations: ['finding:f1'], scope: ['source-1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }] });
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
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'code', reply: 'Verify the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: ['source-1'] });
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
    resolve({ executionIntent: 'current_request', action: 'browser', reply: 'Test the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
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
    resolve({ executionIntent: 'current_request', action: 'browser', reply: 'Test the sign-in error.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
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
    input.references = [{ reviewId: 'r1', findingId: 'f1' }];
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'browser', reply: 'Test sign-in.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
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
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: null, action: 'browser', reply: 'Test sign-in.', citations: ['finding:f1'], claims: [{ citation: 'finding:f1', excerpt: 'Expected the generic sign-in error.' }], scope: [] });
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
    input.references = [{ reviewId: 'r1', findingId: 'f1' }];
    let proceed!: () => void;
    let admitted = false;
    vi.mocked(deps.plan).mockResolvedValue({ executionIntent: 'current_request', action: 'browser', reply: 'Test sign-in.', citations: ['finding:f1'],
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
