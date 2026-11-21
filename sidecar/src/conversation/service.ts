import { createHash, randomUUID } from 'node:crypto';
import type { ConversationInput, ConversationReference, ConversationRequest } from './types.js';
import type { ConversationStore } from './store.js';
import { DynamicContractError } from '../dynamic/types.js';
import { resolveAttachmentNames } from './attachmentNames.js';
import { browserTargets } from './verification.js';
import { compactCanonicalJson } from '../report/canonical.js';

export type Evidence = { id: string; text: string; hash: string; artifactId?: string; versionId?: string; unavailable?: boolean };
export type ConversationPlan = { action: NonNullable<ConversationRequest['action']>; reply: string; replyFormat?: 'markdown'; citations: string[]; scope: string[] };
export type ConversationDeps = {
  ownerId: string;
  store: ConversationStore;
  authorize(projectId: string): Promise<void>;
  resolve(projectId: string, references: ConversationReference[], signal: AbortSignal): Promise<Evidence[]>;
  plan(record: ConversationRequest, evidence: Evidence[], signal: AbortSignal): Promise<unknown>;
  execute(record: ConversationRequest, signal: AbortSignal, checkpoint: (patch: Partial<ConversationRequest>) => Promise<void>): Promise<void>;
  cancel(record: ConversationRequest): Promise<void>;
  held(projectId: string): boolean;
};
const terminal = new Set(['completed', 'failed', 'paused', 'cancelled', 'interrupted']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const hash = (value: unknown) => createHash('sha256').update(compactCanonicalJson(value)).digest('hex');

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
  const labels = body.referenceLabels;
  if (labels !== undefined && (!Array.isArray(labels) || labels.length !== references.length
    || labels.some(label => label !== null && (typeof label !== 'string' || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label))))) {
    throw new DynamicContractError(400, 'Invalid attachment labels.');
  }
  const unique = new Map<string, { reference: ConversationReference; label: string | null }>();
  references.forEach((reference, index) => {
    const key = JSON.stringify(reference);
    const label = Array.isArray(labels) && typeof labels[index] === 'string' ? labels[index].trim() || null : null;
    if (!unique.has(key) || (!unique.get(key)?.label && label)) unique.set(key, { reference, label });
  });
  const ordered = [...unique].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
  return { id: body.id.toLowerCase(), text: body.text.trim(), mode: body.mode as ConversationInput['mode'], permission: body.permission as ConversationInput['permission'],
    references: ordered.map(item => item.reference),
    ...(ordered.some(item => item.label) ? { referenceLabels: ordered.map(item => item.label) } : {}) };
}

export function validateConversationPlan(raw: unknown, evidence: Evidence[], mode: ConversationInput['mode']): ConversationPlan {
  const plan = raw as (ConversationPlan & { claims?: Array<{ citation: string; excerpt: string }> }) | null;
  const ids = new Set(evidence.map(item => item.id));
  const artifacts = new Set(evidence.filter(item => !item.unavailable).map(item => item.artifactId).filter(Boolean));
  if (!plan || !['explain', 'suggest', 'code', 'browser', 'clarify'].includes(plan.action) || typeof plan.reply !== 'string'
    || !plan.reply.trim() || plan.reply.length > 6000 || !Array.isArray(plan.citations) || plan.citations.length > 24
    || plan.citations.some(id => typeof id !== 'string' || !ids.has(id)) || !Array.isArray(plan.scope) || plan.scope.length > 200
    || plan.scope.some(id => typeof id !== 'string' || !artifacts.has(id))) throw new Error('The agent response could not be validated.');
  if (evidence.length && plan.action !== 'clarify' && !plan.citations.length) throw new Error('The response needs saved evidence references.');
  if (plan.action !== 'clarify' && evidence.length) {
    if (!Array.isArray(plan.claims) || !plan.claims.length || plan.claims.length > 24
      || plan.claims.some(claim => !claim || typeof claim.excerpt !== 'string' || claim.excerpt.length < 2 || claim.excerpt.length > 512
        || !plan.citations.includes(claim.citation) || !evidence.some(item => item.id === claim.citation && item.text.includes(claim.excerpt)))
      || plan.citations.some(id => !plan.claims!.some(claim => claim.citation === id))) throw new Error('The response lacks exact supporting evidence quotes.');
  }
  if (/\b(?:i|we|centinel|this (?:check|request)|the (?:problem|issue|bug|code|app|test))\s+(?:(?:is|was|has been|have been|have|has)\s+)?(?:fixed|repaired|resolved|verified|passed)\b/i.test(plan.reply)) {
    throw new Error('Conversation analysis cannot establish a new verification or resolution outcome.');
  }
  if (plan.action === 'code' && (mode === 'browser' || !plan.scope.length) || plan.action === 'browser' && mode === 'code') {
    throw new Error('The proposed action exceeds the selected check mode or available scope.');
  }
  if (['code', 'browser'].includes(plan.action) && evidence.some(item => item.unavailable)) throw new Error('Required historical evidence is unavailable. Explain the evidence or choose a readable check.');
  return { action: plan.action, reply: plan.reply.trim(), ...(['explain', 'suggest'].includes(plan.action) && { replyFormat: 'markdown' as const }), citations: [...new Set(plan.citations)], scope: [...new Set(plan.scope)] };
}

function previousReplyRequested(text: string) {
  return /^(?:(?:please|(?:can|could|would)\s+you)\s+)?(?:repeat|quote)\s+(?:the\s+|your\s+)?(?:exact\s+)?(?:previous|last)\s+(?:answer|reply|response)[.!?]?$/i.test(text.trim());
}

function olderReplyRequested(text: string) {
  return /^(?:(?:please|(?:can|could|would)\s+you)\s+)?(?:repeat|quote|explain)\s+(?:the\s+|your\s+)?(?:(?:first|second|third|older|earlier)\s+(?:answer|reply|response)|(?:answer|reply|response)\s+before\s+(?:the\s+)?last)[.!?]?$/i.test(text.trim());
}
const MAX_RECALLED_REPLY = 6_000;

async function quotePreviousReply(record: ConversationRequest, store: ConversationStore): Promise<Partial<ConversationRequest>> {
  try {
    if (!store.listEarlierTurns) throw new Error("Recall unavailable");
    const [row] = await store.listEarlierTurns(record.projectId, record.ownerId, record.createdAt, 1);
    if (row && Date.parse(row.updatedAt) <= Date.parse(record.createdAt) && row.projectId === record.projectId && row.ownerId === record.ownerId
      && row.id !== record.id && row.state === "completed" && Date.parse(row.createdAt) < Date.parse(record.createdAt)
      && typeof row.reply === "string" && row.reply.trim() && row.reply.length <= MAX_RECALLED_REPLY) {
      return { action: "explain", reply: row.reply, ...(row.replyFormat === "markdown" && { replyFormat: "markdown" as const }), citations: ["conversation:" + row.id], scope: [],
        recall: { status: "recalled", turns: 1 }, state: "completed" };
    }
    return { action: "clarify", reply: "The immediately preceding reply is not available to quote in this project. Paste it here if you want me to use it.",
      citations: [], scope: [], recall: { status: "missing", turns: 0 }, state: "completed" };
  } catch {
    return { action: "clarify", reply: "The previous reply could not be loaded. Paste it here if you want me to use it.",
      citations: [], scope: [], recall: { status: "unavailable", turns: 0 }, state: "completed" };
  }
}

function explicitVerification(text: string) {
  const request = text.trim().replace(/^(?:please\s+|(?:can|could|would)\s+you\s+)/i, '');
  return /^(?:run|rerun|re-run|test|retest|recheck|verify|check)\b/i.test(request)
    && !/^(?:run|test|check|verify)\s+(?:suggestions?|ideas?|options?)\b/i.test(request);
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
      policyVersion: 'conversation-2026-11-18.1', createdAt: now, updatedAt: now, events: [{ stage: 'accepted', at: now }],
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
    const checkpoint = async (patch: Partial<ConversationRequest>) => {
      signal.throwIfAborted();
      await deps.authorize(record.projectId);
      await this.patch(record, patch, deps);
    };
    let resolvingAttachments = false;
    try {
      if (deps.held(record.projectId)) { await checkpoint({ state: 'paused', error: 'AI assessment is paused. Send a new request after resuming.' }); return; }
      if (!confirmed) {
        await checkpoint({ state: 'planning' });
        if (!record.input.references.length && previousReplyRequested(record.input.text)) {
          const recalled = await quotePreviousReply(record, deps.store);
          signal.throwIfAborted();
          await deps.authorize(record.projectId);
          await checkpoint(recalled);
          return;
        }
        if (!record.input.references.length && olderReplyRequested(record.input.text)) {
          await checkpoint({ action: 'clarify', reply: 'Paste the earlier reply you mean so I can use the right one.',
            citations: [], scope: [], state: 'completed' });
          return;
        }
        resolvingAttachments = record.input.references.length > 0;
        const evidence = await deps.resolve(record.projectId, record.input.references, signal);
        resolvingAttachments = false;
        if (JSON.stringify(evidence).length > 64000) throw new Error('The selected evidence exceeds the context limit. Select fewer problems.');
        const names = resolveAttachmentNames(record.input.references, evidence);
        await checkpoint({ context: evidence.map(({ text: _, ...item }) => item),
          ...(names.some(Boolean) ? { resolvedAttachmentNames: names } : {}) });
        const raw = await deps.plan(record, evidence, signal);
        let plan = validateConversationPlan(raw, evidence, record.input.mode);
        if (['code', 'browser'].includes(plan.action) && !explicitVerification(record.input.text)) {
          plan = { action: 'clarify', reply: 'Would you like an explanation, a suggested fix, or a verification run for the attached evidence?', citations: [], scope: [] };
        }
        if (plan.action === 'browser') {
          try {
            browserTargets(evidence, record.input.text);
          } catch {
            plan = { action: 'clarify', reply: 'For this problem, state the expected message in quotation marks or attach its saved browser test so the verification has an independent criterion.', citations: [], scope: [] };
          }
        }
        await checkpoint({ ...plan });
        if (!['code', 'browser'].includes(plan.action)) { await checkpoint({ state: 'completed' }); return; }
        if (record.input.permission === 'ask') { await checkpoint({ state: 'awaiting_permission' }); return; }
        await checkpoint({ state: 'running' });
      }
      signal.throwIfAborted();
      if (deps.held(record.projectId)) {
        await checkpoint({ state: 'paused', error: 'AI assessment was paused before execution. Send a new request after resuming.' });
        return;
      }
      await deps.execute(record, signal, checkpoint);
      await checkpoint({ state: 'completed' });
    } catch (error) {
      if (signal.aborted) return;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const paused = /quota|credit|billing|rate_limit|capacity|assessment_paused|provider_paused|provider_unavailable/.test(code);
      const unavailable = resolvingAttachments && error instanceof DynamicContractError && error.status === 404;
      const message = paused ? 'The provider paused this request. Resume through a new request when available.'
        : unavailable ? 'An attached item could not be found in this project. Open the saved check or select the attachment again.'
          : 'This request could not finish. Its saved evidence and child executions remain available.';
      try { await this.patch(record, { state: paused ? 'paused' : 'failed', error: message }, deps); } catch { /* failed checkpoint remains nonterminal for interruption recovery */ }
    }
  }
  async close() {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled(this.pending);
  }
}
