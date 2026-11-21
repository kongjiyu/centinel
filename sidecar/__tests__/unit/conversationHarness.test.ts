import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConversationRuntime, parseConversationInput, validateConversationPlan, type ConversationDeps } from '../../src/conversation/service.js';
import type { ConversationRequest, ConversationInput } from '../../src/conversation/types.js';
import { DynamicContractError } from '../../src/dynamic/types.js';
import type { ConversationStore } from '../../src/conversation/store.js';

class MemoryStore implements ConversationStore {
  records = new Map<string, ConversationRequest>();
  failUpdate = false;
  async get(projectId: string, id: string) {
    const row = this.records.get(id);
    return row?.projectId === projectId ? structuredClone(row) : null;
  }
  async list(projectId: string) { return [...this.records.values()].filter(row => row.projectId === projectId).map(row => structuredClone(row)); }
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
  it('rejects malformed and unbound problem references', () => {
    const { input } = fixture();
    expect(() => parseConversationInput({ ...input, references: [{ findingId: randomUUID() }] })).toThrow();
    expect(() => parseConversationInput({ ...input, references: [{ reviewId: randomUUID(), text: 'forged evidence' }] })).toThrow();
    expect(parseConversationInput({ ...input, references: [{ reviewId: randomUUID(), findingId: randomUUID() }] })).toMatchObject({ text: input.text });
  });
  it('keeps attachment labels aligned after canonicalizing references and rejects malformed labels', () => {
    const { input } = fixture();
    const review = { reviewId: randomUUID(), findingId: randomUUID() };
    const document = { artifactId: randomUUID() };
    const normalized = parseConversationInput({ ...input,
      references: [review, document, review], referenceLabels: ['Specific issue', 'Design.md', 'Duplicate label'] });
    expect(normalized.references).toEqual([document, review]);
    expect(normalized.referenceLabels).toEqual(['Design.md', 'Specific issue']);
    expect(parseConversationInput(input)).not.toHaveProperty('referenceLabels');
    expect(() => parseConversationInput({ ...input, references: [review], referenceLabels: [] })).toThrow('Invalid attachment labels');
    expect(() => parseConversationInput({ ...input, references: [review], referenceLabels: ['x'.repeat(161)] })).toThrow('Invalid attachment labels');
    expect(() => parseConversationInput({ ...input, references: [review], referenceLabels: ['a\nb'] })).toThrow('Invalid attachment labels');
  });
  it('persists display labels but only sends exact scoped IDs to the evidence resolver and never executes a check for explanation', async () => {
    const { input, runtime, deps, store } = fixture();
    const reference = { reviewId: randomUUID(), findingId: randomUUID() };
    const request = parseConversationInput({ ...input, references: [reference], referenceLabels: ['A different issue name'] });
    const boundEvidence = { ...evidence[0], id: 'finding:' + reference.findingId,
      text: JSON.stringify({ title: 'Actual saved issue', reviewId: reference.reviewId, excerpt: 'Expected the generic sign-in error.' }) };
    vi.mocked(deps.resolve).mockResolvedValue([boundEvidence]);
    vi.mocked(deps.plan).mockResolvedValue({ action: 'explain', reply: 'The saved finding concerns the sign-in error.',
      citations: [boundEvidence.id], claims: [{ citation: boundEvidence.id, excerpt: 'Expected the generic sign-in error.' }], scope: [] });
    await runtime.accept('project', request, deps);
    const saved = await waitFor(store, request.id, 'completed');
    expect(saved.input.referenceLabels).toEqual(['A different issue name']);
    expect(deps.resolve).toHaveBeenCalledWith('project', [reference], expect.any(AbortSignal));
    expect(saved.citations).toEqual([boundEvidence.id]);
    expect(saved.resolvedAttachmentNames).toEqual(['Actual saved issue']);
    expect(saved.reply).toBe('The saved finding concerns the sign-in error.');
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
  });
  it('safely discloses a stale attachment without using its label, guessing evidence, or executing', async () => {
    const { input, runtime, deps, store } = fixture();
    const reference = { reviewId: randomUUID(), findingId: randomUUID() };
    const request = parseConversationInput({ ...input, references: [reference], referenceLabels: ['Stale selection'] });
    vi.mocked(deps.resolve).mockRejectedValue(new DynamicContractError(404, 'A private internal reference detail'));
    await runtime.accept('project', request, deps);
    const saved = await waitFor(store, request.id, 'failed');
    expect(saved.error).toBe('An attached item could not be found in this project. Open the saved check or select the attachment again.');
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
    await runtime.close();
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
    expect(deps.plan).toHaveBeenCalledWith(expect.anything(), evidence, expect.any(AbortSignal));
    expect(saved.context).toEqual([{ id: 'finding:f1', hash: 'hash', artifactId: 'source-1', versionId: 'version-1' }]);
    expect(JSON.stringify(saved)).not.toContain(evidence[0].text);
    expect(deps.execute).not.toHaveBeenCalled();
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
