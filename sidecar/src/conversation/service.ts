import { createHash, randomUUID } from 'node:crypto';
import type { ConversationInput, ConversationReference, ConversationRequest } from './types.js';
import type { ConversationStore } from './store.js';
import { DynamicContractError } from '../dynamic/types.js';
import { browserTargets } from './verification.js';
import { compactCanonicalJson } from '../report/canonical.js';
import { explainSavedSelection } from './savedExplanation.js';

export type Evidence = { id: string; text: string; hash: string; artifactId?: string; versionId?: string; unavailable?: boolean };
export type ConversationPlan = { action: NonNullable<ConversationRequest['action']>; reply: string; citations: string[]; scope: string[]; explanation?: ConversationRequest['explanation'] };
export class ConversationBrowserStartupError extends Error {}
export type ConversationDeps = {
  ownerId: string;
  store: ConversationStore;
  authorize(projectId: string): Promise<void>;
  resolve(projectId: string, references: ConversationReference[], signal: AbortSignal): Promise<Evidence[]>;
  plan(record: ConversationRequest, evidence: Evidence[], signal: AbortSignal, earlierTurns: Evidence[]): Promise<unknown>;
  execute(record: ConversationRequest, signal: AbortSignal, checkpoint: (patch: Partial<ConversationRequest>) => Promise<void>): Promise<void>;
  cancel(record: ConversationRequest): Promise<void>;
  held(projectId: string): boolean;
};
const terminal = new Set(['completed', 'failed', 'paused', 'cancelled', 'interrupted']);
const MAX_CONTEXT_CHARACTERS = 64_000;
const MAX_RECALL_CHARACTERS = 8_000;
const MAX_RECALLED_TURNS = 6;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const hash = (value: unknown) => createHash('sha256').update(compactCanonicalJson(value)).digest('hex');

async function recallEarlierTurns(record: ConversationRequest, store: ConversationStore, budget: number) {
  const earlierTurns: Evidence[] = [];
  let status: NonNullable<ConversationRequest['recall']>['status'] = 'loaded';
  try {
    const candidates = await store.listEarlierCompleted(record.projectId, record.ownerId, record.createdAt, MAX_RECALLED_TURNS + 1);
    for (const row of candidates) {
      if (row.ownerId !== record.ownerId || row.projectId !== record.projectId || row.state !== 'completed'
        || row.id === record.id || !(Date.parse(row.createdAt) < Date.parse(record.createdAt)) || !row.reply) continue;
      // Keep prior discussion separate from executable evidence and frozen sources.
      const turn = { request: row.input.text, reply: row.reply };
      const item = { id: 'conversation:' + row.id, text: compactCanonicalJson(turn), hash: hash(turn) };
      if (earlierTurns.length >= MAX_RECALLED_TURNS || compactCanonicalJson([item, ...earlierTurns]).length > budget) {
        status = 'limited';
        break;
      }
      earlierTurns.unshift(item);
    }
  } catch {
    earlierTurns.length = 0;
    status = 'unavailable';
  }
  return { earlierTurns, recall: { turns: earlierTurns.length, status } };
}

export function parseConversationInput(body: Record<string, unknown>): ConversationInput {
  if (typeof body.id !== 'string' || !uuid.test(body.id) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000
    || !['code', 'browser', 'both'].includes(String(body.mode)) || !['ask', 'auto', 'bypass'].includes(String(body.permission))
    || !Array.isArray(body.references) || body.references.length > 12) throw new DynamicContractError(400, 'Supply a message and up to twelve check or problem references.');
  const references = body.references.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DynamicContractError(400, 'Invalid evidence reference.');
    const ref = value as Record<string, unknown>;
    const keys = Object.keys(ref);
    if (!keys.length || keys.some(key => !['reviewId', 'autoTestId', 'findingId', 'testId', 'artifactId'].includes(key) || typeof ref[key] !== 'string' || !uuid.test(ref[key] as string))
      || ref.findingId && !ref.reviewId || ref.testId && !ref.autoTestId || ref.artifactId && keys.length !== 1
      || !ref.reviewId && !ref.autoTestId && !ref.artifactId) throw new DynamicContractError(400, 'Invalid evidence reference.');
    return Object.fromEntries(['reviewId', 'autoTestId', 'findingId', 'testId', 'artifactId'].filter(key => ref[key]).map(key => [key, String(ref[key]).toLowerCase()])) as ConversationReference;
  });
  const unique = new Map(references.map(reference => [JSON.stringify(reference), reference]));
  return { id: body.id.toLowerCase(), text: body.text.trim(), mode: body.mode as ConversationInput['mode'], permission: body.permission as ConversationInput['permission'],
    references: [...unique].sort(([a], [b]) => a.localeCompare(b)).map(([, reference]) => reference) };
}

export function validateConversationPlan(raw: unknown, evidence: Evidence[], mode: ConversationInput['mode'], earlierTurns: Evidence[] = []): ConversationPlan {
  const plan = raw as (ConversationPlan & { claims?: Array<{ citation: string; excerpt: string }> }) | null;
  const supported = [...evidence, ...earlierTurns];
  const ids = new Set(supported.map(item => item.id));
  const artifacts = new Set(evidence.filter(item => !item.unavailable).map(item => item.artifactId).filter(Boolean));
  if (!plan || !['explain', 'suggest', 'code', 'browser', 'clarify'].includes(plan.action) || typeof plan.reply !== 'string'
    || !plan.reply.trim() || plan.reply.length > 6000 || !Array.isArray(plan.citations) || plan.citations.length > 24
    || plan.citations.some(id => typeof id !== 'string' || !ids.has(id)) || !Array.isArray(plan.scope) || plan.scope.length > 200
    || plan.scope.some(id => typeof id !== 'string' || !artifacts.has(id))) throw new Error('The agent response could not be validated.');
  if (supported.length && plan.action !== 'clarify' && !plan.citations.length) throw new Error('The response needs saved evidence references.');
  if (plan.action !== 'clarify' && supported.length) {
    if (!Array.isArray(plan.claims) || !plan.claims.length || plan.claims.length > 24
      || plan.claims.some(claim => !claim || typeof claim.excerpt !== 'string' || claim.excerpt.length < 2 || claim.excerpt.length > 512
        || !plan.citations.includes(claim.citation) || !supported.some(item => item.id === claim.citation && item.text.includes(claim.excerpt)))
      || plan.citations.some(id => !plan.claims!.some(claim => claim.citation === id))) throw new Error('The response lacks exact supporting evidence quotes.');
  }
  if (/\b(?:i|we|centinel|this (?:check|request)|the (?:problem|issue|bug|code|app|test))\s+(?:(?:is|was|has been|have been|have|has)\s+)?(?:fixed|repaired|resolved|verified|passed)\b/i.test(plan.reply)) {
    throw new Error('Conversation analysis cannot establish a new verification or resolution outcome.');
  }
  if (plan.action === 'code' && (mode === 'browser' || !plan.scope.length) || plan.action === 'browser' && mode === 'code') {
    throw new Error('The proposed action exceeds the selected check mode or available scope.');
  }
  if (['code', 'browser'].includes(plan.action) && evidence.some(item => item.unavailable)) throw new Error('Required historical evidence is unavailable. Explain the evidence or choose a readable check.');
  if (['code', 'browser'].includes(plan.action) && earlierTurns.length && !evidence.some(item => plan.citations.includes(item.id))) {
    throw new Error('Execution requires a citation to the evidence selected for this request.');
  }
  return { action: plan.action, reply: plan.reply.trim(), citations: [...new Set(plan.citations)], scope: [...new Set(plan.scope)] };
}

function validatePlanWithLiteralRecall(raw: unknown, record: ConversationRequest, evidence: Evidence[], earlierTurns: Evidence[]) {
  try {
    return validateConversationPlan(raw, evidence, record.input.mode, earlierTurns);
  } catch (error) {
    const plan = raw as Partial<ConversationPlan> | null;
    const previous = earlierTurns.at(-1);
    const reply = typeof plan?.reply === 'string' ? plan.reply.trim() : '';
    if (!previous || plan?.action !== 'explain' || !Array.isArray(plan.scope) || plan.scope.length
      || reply.length < 2 || reply.length > 512 || !/\b(?:repeat|quote)\b/i.test(record.input.text)
      || !/\b(?:previous|preceding|earlier|last)\s+(?:answer|reply|turn|response)\b/i.test(record.input.text)) throw error;
    const historicalReply: unknown = JSON.parse(previous.text).reply;
    const excerpt = JSON.stringify(reply).slice(1, -1);
    if (typeof historicalReply !== 'string' || !historicalReply.includes(reply) || excerpt.length > 512) throw error;
    // A literal echo is independently quotable. Keep the same plan validator and never repair execution.
    return validateConversationPlan({ ...plan, citations: [previous.id], claims: [{ citation: previous.id, excerpt }] },
      evidence, record.input.mode, earlierTurns);
  }
}

function explicitVerification(text: string) {
  const request = text.trim().replace(/^(?:please\s+|(?:can|could|would)\s+you\s+)/i, '');
  return /^(?:run|rerun|re-run|test|retest|recheck|verify|check)\b/i.test(request)
    && !/^(?:run|test|check|verify)\s+(?:suggestions?|ideas?|options?)\b/i.test(request);
}

function requestedCheckMode(text: string): 'code' | 'browser' | undefined {
  const mode = /\b(?:run|rerun|re-run|test|retest|recheck|verify|check)\s+(?:(?:this|that|a|the)\s+)?(code|browser)\s+(?:check|review|test|verification)\b/i.exec(text)?.[1]?.toLowerCase();
  return mode === 'code' || mode === 'browser' ? mode : undefined;
}

function recallProjectName(record: ConversationRequest, evidence: Evidence[], earlierTurns: Evidence[]): unknown {
  const text = record.input.text;
  const earlier = earlierTurns.at(-1);
  const inventory = evidence.find(item => item.id === 'project:' + record.projectId);
  if (!earlier || !inventory || !/\brepeat\b[^.!?]*\b(?:exact\s+)?project name\b[^.!?]*\b(?:previous|preceding|last)\s+(?:reply|answer|response)\b/i.test(text)) return null;
  const name: unknown = JSON.parse(inventory.text).name;
  const prior: unknown = JSON.parse(earlier.text).reply;
  if (typeof name !== 'string' || !name.trim() || typeof prior !== 'string' || !prior.includes(name)) return null;
  const excerpt = JSON.stringify(name).slice(1, -1);
  if (excerpt.length < 2 || excerpt.length > 512 || !earlier.text.includes(excerpt)) return null;
  return { action: 'explain', reply: name, scope: [], citations: [earlier.id], claims: [{ citation: earlier.id, excerpt }] };
}

function browserFallbackScope(evidence: Evidence[], record: ConversationRequest) {
  const browserOnly = /\b(?:browser[- ]only|only (?:in the )?browser)\b/i.test(record.input.text);
  const excludesCode = /\b(?:no|skip|exclude|without|do not (?:run|start)|don['’]t (?:run|start))\s+(?:a\s+|the\s+)?(?:code|static)\b/i.test(record.input.text);
  if (record.input.mode !== 'both' || browserOnly || excludesCode) return [];
  const targets = browserTargets(evidence, record.input.text);
  const paths = new Set(targets.flatMap(target => target.paths));
  return [...new Set(evidence.flatMap(item => {
    if (!item.artifactId || item.unavailable) return [];
    const path: unknown = JSON.parse(item.text).path;
    return typeof path === 'string' && paths.has(path.replace(/\\/g, '/').replace(/^\.\//, '')) ? [item.artifactId] : [];
  }))];
}

function eventStage(patch: Partial<ConversationRequest>) {
  if (patch.state) return patch.state;
  if (patch.input) return 'permission_changed';
  if (patch.context) return 'context_resolved';
  if (patch.action) return 'scope_validated';
  if (patch.executionSources) return 'current_sources_frozen';
  if (patch.verificationBindings) return 'criteria_bound';
  if (patch.reviewId || patch.autoTestId) return 'child_admitted';
  return 'checkpoint';
}

export class ConversationRuntime {
  private workerId = randomUUID();
  private active = new Map<string, AbortController>();
  private pending = new Set<Promise<unknown>>();
  private writes = new Map<string, Promise<unknown>>();
  async accept(projectId: string, input: ConversationInput, deps: ConversationDeps) {
    await deps.authorize(projectId);
    const now = new Date().toISOString();
    const record: ConversationRequest = {
      id: input.id, projectId, ownerId: deps.ownerId, input, inputHash: hash(input), revision: 0,
      state: 'accepted', workerId: this.workerId, leaseUntil: new Date(Date.now() + 120_000).toISOString(),
      policyVersion: 'conversation-2026-11-21.2', createdAt: now, updatedAt: now, events: [{ stage: 'accepted', at: now }],
    };
    if (!await deps.store.create(record)) {
      const existing = await deps.store.get(projectId, input.id);
      if (!existing || existing.ownerId !== deps.ownerId || existing.inputHash !== record.inputHash) throw new DynamicContractError(409, 'This request ID was already used for another message.');
      return this.reconcile(existing, deps);
    }
    this.start(record, deps, false);
    return record;
  }
  async reconcile(record: ConversationRequest, deps: ConversationDeps) {
    if (record.ownerId !== deps.ownerId) return record;
    if (record.workerId !== this.workerId && record.leaseUntil && Date.parse(record.leaseUntil) > Date.now()) return record;
    if (!terminal.has(record.state) && record.state !== 'awaiting_permission' && !this.active.has(record.id)) {
      return this.patch(record, { state: 'interrupted', error: 'The request was interrupted. Send a new request to continue.' }, deps);
    }
    return record;
  }
  private async patch(record: ConversationRequest, patch: Partial<ConversationRequest>, deps: ConversationDeps) {
    const write = (this.writes.get(record.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const heartbeat = Object.keys(patch).length === 1 && patch.leaseUntil !== undefined;
      if (heartbeat && (terminal.has(record.state) || record.state === 'awaiting_permission')) return record;
      const next = { ...record, ...patch, revision: record.revision + 1, updatedAt: new Date().toISOString(),
        events: heartbeat ? record.events : [...record.events, { stage: eventStage(patch), at: new Date().toISOString(),
          ...(patch.input ? { permission: patch.input.permission } : {}) }] };
      if (terminal.has(next.state) || next.state === 'awaiting_permission') delete next.leaseUntil;
      if (!await deps.store.update(next, record.revision)) throw new DynamicContractError(409, 'The request changed. Reload its saved state.');
      Object.assign(record, next);
      if (!next.leaseUntil) delete record.leaseUntil;
      return record;
    });
    this.writes.set(record.id, write);
    try { return await write; } finally { if (this.writes.get(record.id) === write) this.writes.delete(record.id); }
  }
  async confirm(record: ConversationRequest, revision: number, deps: ConversationDeps) {
    if (record.ownerId !== deps.ownerId || record.state !== 'awaiting_permission' || revision !== record.revision) throw new DynamicContractError(409, 'The request changed. Review its scope again.');
    await deps.authorize(record.projectId);
    await this.patch(record, { state: 'running', workerId: this.workerId, leaseUntil: new Date(Date.now() + 120_000).toISOString() }, deps);
    this.start(record, deps, true);
    return record;
  }
  async permission(projectId: string, permission: ConversationInput['permission'], deps: ConversationDeps) {
    const saved = deps.store.listActive ? await deps.store.listActive(projectId, deps.ownerId) : await deps.store.list(projectId);
    const records = new Map(saved.map(record => [record.id, record]));
    for (const record of this.activeRecords.values()) if (record.projectId === projectId) records.set(record.id, record);
    for (const stored of records.values()) {
      if (stored.ownerId !== deps.ownerId || !['accepted', 'planning', 'awaiting_permission', 'running'].includes(stored.state)) continue;
      const record = this.activeRecords.get(stored.id) ?? stored;
      const restrictive = permission === 'ask' && record.input.permission !== 'ask' && record.state === 'running';
      await this.patch(record, { input: { ...record.input, permission } }, deps);
      if (restrictive) await this.cancel(record, deps);
    }
  }
  private activeRecords = new Map<string, ConversationRequest>();
  async cancel(record: ConversationRequest, deps: ConversationDeps) {
    if (record.ownerId !== deps.ownerId) throw new DynamicContractError(409, 'Only the request owner can cancel it.');
    if (terminal.has(record.state)) return record;
    record = this.activeRecords.get(record.id) ?? record;
    await this.patch(record, { state: 'cancelled' }, deps);
    this.active.get(record.id)?.abort();
    try { await deps.cancel(record); } catch {
      await this.patch(record, { error: 'Cancellation was recorded. A child operation could not confirm cleanup. Refresh its saved execution.' }, deps);
    }
    return record;
  }
  private start(record: ConversationRequest, deps: ConversationDeps, confirmed: boolean) {
    const controller = new AbortController();
    this.active.set(record.id, controller);
    this.activeRecords.set(record.id, record);
    let heartbeatPending = false;
    const heartbeat = setInterval(() => {
      if (heartbeatPending || controller.signal.aborted) return;
      heartbeatPending = true;
      void deps.authorize(record.projectId).then(() => this.patch(record, { leaseUntil: new Date(Date.now() + 120_000).toISOString() }, deps))
        .catch(() => controller.abort()).finally(() => { heartbeatPending = false; });
    }, 10_000);
    heartbeat.unref();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]);
    const work = this.run(record, deps, signal, confirmed).finally(() => {
      clearInterval(heartbeat);
      this.active.delete(record.id); this.activeRecords.delete(record.id); this.pending.delete(work);
    });
    this.pending.add(work);
  }
  private async run(record: ConversationRequest, deps: ConversationDeps, signal: AbortSignal, confirmed: boolean) {
    let failureStage: NonNullable<ConversationRequest['failureStage']> = confirmed ? 'execution' : 'context';
    const checkpoint = async (patch: Partial<ConversationRequest>) => {
      signal.throwIfAborted();
      await deps.authorize(record.projectId);
      await this.patch(record, patch, deps);
    };
    try {
      if (deps.held(record.projectId)) { await checkpoint({ state: 'paused', error: 'AI assessment is paused. Send a new request after resuming.' }); return; }
      if (!confirmed) {
        await checkpoint({ state: 'planning' });
        const evidence = await deps.resolve(record.projectId, record.input.references, signal);
        const promptLength = compactCanonicalJson({ request: record.input.text, mode: record.input.mode, evidence, earlierTurns: [] }).length;
        if (promptLength > MAX_CONTEXT_CHARACTERS) throw new Error('The selected evidence exceeds the context limit. Select fewer problems.');
        const { earlierTurns, recall } = await recallEarlierTurns(record, deps.store, Math.min(MAX_RECALL_CHARACTERS, MAX_CONTEXT_CHARACTERS - promptLength + 2));
        await checkpoint({ context: evidence.map(({ text: _, ...item }) => item), recall });
        failureStage = 'planning';
        const explanation = !explicitVerification(record.input.text) ? explainSavedSelection(evidence, record.input.text) : null;
        const recalled = recallProjectName(record, evidence, earlierTurns);
        const raw = explanation ?? recalled ?? await deps.plan(record, evidence, signal, earlierTurns);
        failureStage = 'validation';
        let plan = explanation ?? validatePlanWithLiteralRecall(raw, record, evidence, earlierTurns);
        const requested = requestedCheckMode(record.input.text);
        if (['code', 'browser'].includes(plan.action) && (!explicitVerification(record.input.text) || requested && plan.action !== requested)) {
          plan = { action: 'clarify', reply: 'Would you like an explanation, a suggested fix, or a verification run for the attached evidence?', citations: [], scope: [] };
        }
        if (plan.action === 'code' && evidence.some(item => item.id.startsWith('review:') && JSON.parse(item.text).omittedSourceCount > 0)) {
          plan = { action: 'clarify', reply: 'This saved Check covers more source files than a scoped follow-up can verify. Attach the specific problems or source files to check.', citations: [], scope: [] };
        }
        if (plan.action === 'browser') {
          try {
            browserTargets(evidence, record.input.text);
          } catch {
            plan = { action: 'clarify', reply: 'Attach a saved browser test, or attach the relevant source and state the expected message in quotation marks.', citations: [], scope: [] };
          }
        }
        const fallbackScope = plan.action === 'browser' ? browserFallbackScope(evidence, record) : [];
        await checkpoint({ ...plan, ...(explanation ? { replyOrigin: 'saved_evidence' } : recalled ? { replyOrigin: 'saved_recall' }
          : { replyFormat: 'markdown' }), ...(fallbackScope.length ? { fallbackScope } : {}) });
        if (!['code', 'browser'].includes(plan.action)) { await checkpoint({ state: 'completed' }); return; }
        if (record.input.permission === 'ask') { await checkpoint({ state: 'awaiting_permission' }); return; }
        await checkpoint({ state: 'running' });
      }
      failureStage = 'execution';
      signal.throwIfAborted();
      if (deps.held(record.projectId)) {
        await checkpoint({ state: 'paused', error: 'AI assessment was paused before execution. Send a new request after resuming.' });
        return;
      }
      try {
        await deps.execute(record, signal, checkpoint);
      } catch (error) {
        if (!(error instanceof ConversationBrowserStartupError) || record.action !== 'browser' || record.input.mode !== 'both' || !record.fallbackScope?.length) throw error;
        await checkpoint({ action: 'code', scope: record.fallbackScope, fallbackReason: 'browser_startup',
          state: record.input.permission === 'ask' ? 'awaiting_permission' : 'running' });
        if (record.state === 'awaiting_permission') return;
        await deps.execute(record, signal, checkpoint);
      }
      await checkpoint({ state: 'completed' });
    } catch (error) {
      if (signal.aborted) return;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const paused = /quota|credit|billing|rate_limit|capacity|assessment_paused|provider_paused|provider_unavailable/.test(code);
      try { await this.patch(record, { state: paused ? 'paused' : 'failed', failureStage,
        error: paused ? 'The provider paused this request. Resume through a new request when available.'
          : error instanceof ConversationBrowserStartupError ? 'The app could not start. Inspect the saved Browser attempt or try again after the app starts.'
            : 'This request could not finish. Its saved evidence and child executions remain available.' }, deps); } catch { /* failed checkpoint remains nonterminal for interruption recovery */ }
    }
  }
  async close() {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled(this.pending);
  }
}
