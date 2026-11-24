import { createHash, randomUUID } from 'node:crypto';
import type { ConversationInput, ConversationReference, ConversationRequest } from './types.js';
import type { ConversationStore } from './store.js';
import { DynamicContractError } from '../dynamic/types.js';
import { browserTargets } from './verification.js';
import { compactCanonicalJson } from '../report/canonical.js';
import { presentSavedSelection } from './savedExplanation.js';
import { asksForUnscopedReview, conversationApproval, conversationQuestionOptions, isCodeReviewChoice, namedReviewScope, requestsCheckExecution } from './intent.js';
import { resolveAttachmentNames } from './attachmentNames.js';

export type Evidence = { id: string; text: string; hash: string; artifactId?: string; versionId?: string; unavailable?: boolean; kind?: 'prior_reply' };
export type ConversationPlan = { action: NonNullable<ConversationRequest['action']>; reply: string; replyFormat?: 'markdown'; citations: string[]; scope: string[]; explanation?: ConversationRequest['explanation']; questionOptions?: string[] };
export class ConversationBrowserStartupError extends Error {}
export type ConversationDeps = {
  ownerId: string;
  store: ConversationStore;
  authorize(projectId: string): Promise<void>;
  resolve(projectId: string, references: ConversationReference[], signal: AbortSignal, text: string): Promise<Evidence[]>;
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
      const options = conversationQuestionOptions(row);
      if (options.length && row.selectedOption === undefined) continue;
      const turn = { request: row.input.text, reply: row.reply, ...(row.selectedOption !== undefined ? { selectedOption: options[row.selectedOption] } : {}) };
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
    || body.replyToTurnId !== undefined && (typeof body.replyToTurnId !== 'string' || !uuid.test(body.replyToTurnId))
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
    ...(typeof body.replyToTurnId === 'string' ? { replyToTurnId: body.replyToTurnId.toLowerCase() } : {}),
    references: ordered.map(item => item.reference),
    ...(ordered.some(item => item.label) ? { referenceLabels: ordered.map(item => item.label) } : {}) };
}

class ConversationValidationError extends Error {
  constructor(readonly reason: NonNullable<ConversationRequest['validationReason']>, message: string) { super(message); }
}

export function validateConversationPlan(raw: unknown, evidence: Evidence[], mode: ConversationInput['mode'], earlierTurns: Evidence[] = []): ConversationPlan {
  const plan = raw as (ConversationPlan & { claims?: Array<{ citation: string; excerpt: string }> }) | null;
  const supported = [...evidence, ...earlierTurns];
  const ids = new Set(supported.map(item => item.id));
  const artifacts = new Set(evidence.filter(item => !item.unavailable).map(item => item.artifactId).filter(Boolean));
  if (!plan || !['explain', 'suggest', 'code', 'browser', 'clarify'].includes(plan.action) || typeof plan.reply !== 'string'
    || !plan.reply.trim() || plan.reply.length > 6000 || !Array.isArray(plan.citations) || plan.citations.length > 24
    || !Array.isArray(plan.scope) || plan.scope.length > 200) throw new ConversationValidationError('response_format', 'The agent response could not be validated.');
  if (plan.citations.some(id => typeof id !== 'string' || !ids.has(id))) {
    throw new ConversationValidationError('citation_unknown', 'The response referenced evidence that was not supplied.');
  }
  if (plan.scope.some(id => typeof id !== 'string' || !artifacts.has(id))) {
    throw new ConversationValidationError('scope_unbound', 'The proposed scope is not bound to supplied files.');
  }
  if (supported.length && plan.action !== 'clarify' && !plan.citations.length) throw new ConversationValidationError('citation_missing', 'The response needs saved evidence references.');
  if (plan.action !== 'clarify' && supported.length) {
    if (!Array.isArray(plan.claims) || !plan.claims.length || plan.claims.length > 24
      || plan.claims.some(claim => !claim || typeof claim.excerpt !== 'string' || claim.excerpt.length < 2 || claim.excerpt.length > 512
        || !plan.citations.includes(claim.citation) || !supported.some(item => item.id === claim.citation && item.text.includes(claim.excerpt)))
      || plan.citations.some(id => !plan.claims!.some(claim => claim.citation === id))) throw new ConversationValidationError('quote_unmatched', 'The response lacks exact supporting evidence quotes.');
  }
  if (/\b(?:i|we|centinel|this (?:check|request)|the (?:problem|issue|bug|code|app|test))\s+(?:(?:is|was|has been|have been|have|has)\s+)?(?:fixed|repaired|resolved|verified|passed)\b/i.test(plan.reply)) {
    throw new ConversationValidationError('outcome_unverified', 'Conversation analysis cannot establish a new verification or resolution outcome.');
  }
  if (plan.action === 'code' && mode === 'browser' || plan.action === 'browser' && mode === 'code') {
    throw new ConversationValidationError('mode_conflict', 'The proposed action exceeds the selected check mode.');
  }
  if (plan.action === 'code' && !plan.scope.length) throw new ConversationValidationError('scope_unbound', 'The Code Review plan needs a file scope.');
  if (['code', 'browser'].includes(plan.action) && evidence.some(item => item.unavailable)) throw new ConversationValidationError('evidence_unavailable', 'Required historical evidence is unavailable. Explain the evidence or choose a readable check.');
  if (['code', 'browser'].includes(plan.action) && earlierTurns.length && !evidence.some(item => plan.citations.includes(item.id))) {
    throw new ConversationValidationError('current_evidence_required', 'Execution requires a citation to the evidence selected for this request.');
  }
  const options = plan.questionOptions;
  if (options !== undefined && (!Array.isArray(options) || options.length > 4 || options.length === 1
    || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 100 || /[\r\n]/.test(option))
    || new Set(options.map(option => option.trim().toLowerCase())).size !== options.length || options.length && plan.action !== 'clarify')) {
    throw new ConversationValidationError('question_options', 'The question options could not be validated.');
  }
  return { action: plan.action, reply: plan.reply.trim(), ...(['explain', 'suggest'].includes(plan.action) && { replyFormat: 'markdown' as const }), citations: [...new Set(plan.citations)], scope: [...new Set(plan.scope)],
    ...(options?.length ? { questionOptions: options.map(option => option.trim()) } : {}) };
}

function validatePlanWithLiteralRecall(raw: unknown, record: ConversationRequest, evidence: Evidence[], earlierTurns: Evidence[]) {
  try {
    return validateConversationPlan(raw, evidence, record.input.mode, earlierTurns);
  } catch (error) {
    const plan = raw as Partial<ConversationPlan> | null;
    const previous = evidence.find(item => item.kind === 'prior_reply') ?? earlierTurns.at(-1);
    const reply = typeof plan?.reply === 'string' ? plan.reply.trim() : '';
    if (!previous || plan?.action !== 'explain' || !Array.isArray(plan.scope) || plan.scope.length
      || reply.length < 2 || reply.length > 512 || !/\b(?:repeat|quote)\b/i.test(record.input.text)
      || !/\b(?:previous|preceding|earlier|last)\s+(?:answer|reply|turn|response)\b/i.test(record.input.text)) throw error;
    const historicalReply: unknown = previous.kind === 'prior_reply' ? previous.text : JSON.parse(previous.text).reply;
    const excerpt = previous.kind === 'prior_reply' ? reply : JSON.stringify(reply).slice(1, -1);
    if (typeof historicalReply !== 'string' || !historicalReply.includes(reply) || excerpt.length > 512) throw error;
    // A literal echo is independently quotable. Keep the same plan validator and never repair execution.
    return validateConversationPlan({ ...plan, citations: [previous.id], claims: [{ citation: previous.id, excerpt }] },
      evidence, record.input.mode, earlierTurns);
  }
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
    const [row] = await store.listEarlierTurns(record.projectId, record.ownerId, record.createdAt, 1);
    const acceptedAt = Date.parse(record.createdAt);
    if (row && row.projectId === record.projectId && row.ownerId === record.ownerId && row.id !== record.id
      && row.state === 'completed' && Date.parse(row.createdAt) < acceptedAt && Date.parse(row.updatedAt) <= acceptedAt
      && typeof row.reply === 'string' && row.reply.trim() && row.reply.length <= MAX_RECALLED_REPLY) {
      return { action: 'explain', reply: row.reply, ...(row.replyFormat === 'markdown' && { replyFormat: 'markdown' as const }),
        citations: ['conversation:' + row.id], scope: [], replyOrigin: 'saved_recall',
        recall: { status: 'recalled', turns: 1 }, state: 'completed' };
    }
    return { action: 'clarify', reply: 'The immediately preceding reply is not available to quote in this project. Paste it here if you want me to use it.',
      citations: [], scope: [], recall: { status: 'missing', turns: 0 }, state: 'completed' };
  } catch {
    return { action: 'clarify', reply: 'The previous reply could not be loaded. Paste it here if you want me to use it.',
      citations: [], scope: [], recall: { status: 'unavailable', turns: 0 }, state: 'completed' };
  }
}

function ambiguousUnattachedFollowUp(text: string) {
  return /^(?:what (?:does (?:that|it) mean|about (?:that|it))|(?:can you )?explain (?:that|it)|which one failed)[.!?]?$/i.test(text.trim());
}

async function loadExplicitReply(record: ConversationRequest, store: ConversationStore): Promise<{ evidence: Evidence; replyFormat?: 'markdown' } | null> {
  const id = record.input.replyToTurnId;
  if (!id || id === record.id) return null;
  try {
    const row = await store.get(record.projectId, id);
    const acceptedAt = Date.parse(record.createdAt);
    if (!row || row.id !== id || row.projectId !== record.projectId || row.ownerId !== record.ownerId
      || row.state !== 'completed' || !(Date.parse(row.createdAt) < acceptedAt && Date.parse(row.updatedAt) <= acceptedAt)
      || typeof row.reply !== 'string' || !row.reply.trim() || row.reply.length > MAX_RECALLED_REPLY) return null;
    return { evidence: { id: 'conversation:' + id, text: row.reply, hash: hash(row.reply), kind: 'prior_reply' },
      ...(row.replyFormat === 'markdown' && { replyFormat: 'markdown' as const }) };
  } catch {
    return null;
  }
}

function requestedCheckMode(text: string): 'code' | 'browser' | undefined {
  if (namedReviewScope(text)) return 'code';
  const mode = /\b(?:run|rerun|re-run|test|retest|recheck|verify|check)\s+(?:(?:this|that|a|the)\s+)?(code|browser)\s+(?:check|review|test|verification)\b/i.exec(text)?.[1]?.toLowerCase();
  return mode === 'code' || mode === 'browser' ? mode : undefined;
}

function planNamedReview(record: ConversationRequest, evidence: Evidence[]): ConversationPlan | null {
  if (!namedReviewScope(record.reviewContinuation?.text ?? record.input.text)) return null;
  const clarify = (reply: string): ConversationPlan => ({ action: 'clarify', reply, citations: [], scope: [] });
  if (record.input.mode === 'browser' && !record.reviewContinuation) return { ...clarify('Run a Code Review of the requested module?'),
    questionOptions: ['Code review only', 'Keep Browser mode'] };
  const inventory = evidence.find(item => item.id === 'module:' + record.projectId);
  if (!inventory) return clarify('Send the folder name without the saved Check or problem attachment so I can scope the Review to that folder.');
  const { roots, rootCount, count } = JSON.parse(inventory.text) as { roots: string[]; rootCount: number; count: number };
  const sources = evidence.filter(item => item.id.startsWith('module-source:') && item.artifactId && !item.unavailable);
  if (!count) return clarify('I couldn’t match that module to a saved repository folder. Which folder should I review?');
  if (rootCount > 1) return clarify(`Which folder should I review? I found these matches:\n\n${roots.map(root => `- \`${root.replaceAll('`', '')}\``).join('\n')}`);
  if (sources.length !== count) return clarify('That module exceeds the scoped Review limit. Which subfolder should I review?');
  return { action: 'code', citations: [inventory.id], scope: sources.map(item => item.artifactId!),
    reply: `**Code Review scope**\n\n- Folder or file: \`${roots[0].replaceAll('`', '')}\`\n- Saved repository files: **${count}**` };
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
  if (patch.selectedOption !== undefined) return 'question_answered';
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
      policyVersion: 'conversation-2026-11-23.1', createdAt: now, updatedAt: now, events: [{ stage: 'accepted', at: now }],
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
    if (record.ownerId !== deps.ownerId || record.state !== 'awaiting_permission' || revision !== record.revision || record.input.replyToTurnId) throw new DynamicContractError(409, 'The request changed. Review its scope again.');
    await deps.authorize(record.projectId);
    await this.patch(record, { state: 'running', workerId: this.workerId, leaseUntil: new Date(Date.now() + 120_000).toISOString() }, deps);
    this.start(record, deps, true);
    return record;
  }
  async answerQuestion(record: ConversationRequest, revision: number, selectedOption: number, deps: ConversationDeps, askFirst = false) {
    if (record.ownerId !== deps.ownerId) throw new DynamicContractError(409, 'This question is unavailable.');
    const options = conversationQuestionOptions(record);
    if (!Number.isInteger(selectedOption) || options[selectedOption] === undefined) throw new DynamicContractError(400, 'Choose one of the saved options.');
    await deps.authorize(record.projectId);
    const sameAnswer = record.selectedOption === selectedOption;
    if (sameAnswer && record.reviewContinuation) return record;
    const codeReview = isCodeReviewChoice(record.reply, options[selectedOption]);
    if (sameAnswer && !codeReview) return record;
    if (record.state !== 'completed' || record.revision !== revision || (record.selectedOption !== undefined && !sameAnswer)) {
      throw new DynamicContractError(409, 'This question changed. Check the saved response.');
    }
    if (!codeReview || record.reviewId || record.autoTestId) return this.patch(record, { selectedOption, questionOptions: options }, deps);

    let source: ConversationRequest | undefined;
    let historyUnavailable = false;
    try { source = await this.findQuestionReviewSource(record, deps); }
    catch (error) {
      if (!(error instanceof DynamicContractError) || error.status !== 503) throw error;
      historyUnavailable = true;
    }
    const reviewContinuation = { question: record.reply!, ...(source ? { sourceRequestId: source.id, text: source.input.text } : {}) };
    if (!source) return this.patch(record, { selectedOption, questionOptions: options, reviewContinuation,
      reply: `${historyUnavailable ? 'I couldn’t load the earlier scope. ' : ''}Which repository folder should I review? Reply with **Review** followed by the folder path, for example **Review cypress**.` }, deps);

    await this.patch(record, { selectedOption, questionOptions: options, reviewContinuation, reply: undefined, replyOrigin: undefined,
      ...(askFirst || source.id !== record.id ? { input: { ...record.input, permission: 'ask' as const } } : {}),
      action: undefined, citations: undefined, state: 'accepted', workerId: this.workerId, leaseUntil: new Date(Date.now() + 120_000).toISOString() }, deps);
    this.start(record, deps, false);
    return record;
  }
  private async findQuestionReviewSource(record: ConversationRequest, deps: ConversationDeps) {
    if (record.input.references.length) return undefined;
    if (namedReviewScope(record.input.text)) return record;
    // A saved question can match a user's earlier explicit module request. Its wording never supplies scope by itself.
    const match = /^Which verification should I run for the ([\w./-]+) module\?$/i.exec(record.reply?.trim() ?? '');
    if (!match) return undefined;
    const module = match[1].toLowerCase();
    const candidates = (await deps.store.list(record.projectId, { ownerId: record.ownerId, createdAt: record.createdAt })).filter(item => item.projectId === record.projectId
      && item.ownerId === record.ownerId && item.createdAt < record.createdAt && !item.input.references.length
      && namedReviewScope(item.input.text) === module).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const latest = candidates[0];
    if (!latest || latest.createdAt === candidates[1]?.createdAt || latest.reviewId || latest.autoTestId
      || !['completed', 'failed', 'interrupted'].includes(latest.state)) return undefined;
    return latest;
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
      if (this.active.get(record.id) === controller) { this.active.delete(record.id); this.activeRecords.delete(record.id); }
      this.pending.delete(work);
    });
    this.pending.add(work);
  }
  private async run(record: ConversationRequest, deps: ConversationDeps, signal: AbortSignal, confirmed: boolean) {
    let failureStage: NonNullable<ConversationRequest['failureStage']> = confirmed ? 'execution' : 'context';
    let validationReason: ConversationRequest['validationReason'];
    const checkpoint = async (patch: Partial<ConversationRequest>) => {
      signal.throwIfAborted();
      await deps.authorize(record.projectId);
      await this.patch(record, patch, deps);
    };
    try {
      const text = record.reviewContinuation?.text ?? record.input.text;
      const approval = !confirmed && conversationApproval(text);
      if (approval) {
        const reply = approval === 'code'
          ? 'Which folder should I review in Code mode? Name the repository folder or attach the files and ask for a Code Review.'
          : 'What should I run? For a Code Review, name the repository folder or file. For a Browser Check, tell me which behavior you want to verify.';
        await checkpoint({ state: 'completed', action: 'clarify', reply });
        return;
      }
      if (!confirmed && !record.input.references.length && asksForUnscopedReview(text)) {
        await checkpoint({ state: 'completed', action: 'clarify', reply: 'Which repository folder or file should I review? Reply with **Review** followed by the path.' });
        return;
      }
      if (deps.held(record.projectId)) { await checkpoint({ state: 'paused', failureReason: 'assessment_hold', error: 'AI assessment is paused. Send a new request after resuming.' }); return; }
      if (!confirmed) {
        await checkpoint({ state: 'planning' });
        const targetId = record.input.replyToTurnId;
        if (!targetId && !record.input.references.length && previousReplyRequested(record.input.text)) {
          await checkpoint(await quotePreviousReply(record, deps.store));
          return;
        }
        if (!targetId && !record.input.references.length && olderReplyRequested(record.input.text)) {
          await checkpoint({ action: 'clarify', reply: 'Paste the earlier reply you mean so I can use the right one.',
            citations: [], scope: [], state: 'completed' });
          return;
        }
        if (!targetId && !record.input.references.length && ambiguousUnattachedFollowUp(record.input.text)) {
          await checkpoint({ action: 'clarify', reply: 'Which earlier reply or saved check do you mean? Select Reply to or attach the saved evidence.',
            citations: [], scope: [], state: 'completed' });
          return;
        }
        const selected = targetId ? await loadExplicitReply(record, deps.store) : null;
        if (targetId && !selected) {
          await checkpoint({ replyTo: { turnId: targetId, status: 'unavailable' }, action: 'clarify',
            reply: 'That earlier reply is unavailable. Select another reply or send the question with the relevant evidence.',
            citations: [], scope: [], state: 'completed' });
          return;
        }
        const prior = selected?.evidence;
        if (prior && !record.input.references.length
          && (previousReplyRequested(record.input.text) || olderReplyRequested(record.input.text))) {
          await checkpoint({ replyTo: { turnId: targetId!, status: 'resolved' }, action: 'explain', reply: prior.text,
            ...(selected?.replyFormat === 'markdown' && { replyFormat: 'markdown' as const }), citations: [prior.id], scope: [], state: 'completed' });
          return;
        }
        const current = await deps.resolve(record.projectId, record.input.references, signal, text);
        const evidence = prior ? [...current, prior] : current;
        const promptLength = compactCanonicalJson({ request: text, mode: record.reviewContinuation ? 'code' : record.input.mode, evidence, earlierTurns: [] }).length;
        if (promptLength > MAX_CONTEXT_CHARACTERS) {
          await checkpoint({ state: 'failed', failureStage: 'context', failureReason: 'context_limit', error: 'The selected evidence exceeds the context limit.' });
          return;
        }
        // An explicitly selected Reply to always takes priority over ambient recent-turn recall.
        const namedReview = prior ? null : planNamedReview(record, current);
        const { earlierTurns, recall } = namedReview || prior ? { earlierTurns: [], recall: undefined }
          : await recallEarlierTurns(record, deps.store, Math.min(MAX_RECALL_CHARACTERS, MAX_CONTEXT_CHARACTERS - promptLength + 2));
        if (compactCanonicalJson({ request: text, mode: record.reviewContinuation ? 'code' : record.input.mode, evidence, earlierTurns }).length > MAX_CONTEXT_CHARACTERS) {
          await checkpoint({ state: 'failed', failureStage: 'context', failureReason: 'context_limit', error: 'The selected evidence exceeds the context limit.' });
          return;
        }
        const executionRequested = requestsCheckExecution(text);
        const savedSelection = !executionRequested && record.input.references.length ? presentSavedSelection(current) : null;
        const attachmentNames = resolveAttachmentNames(record.input.references, current);
        await checkpoint({ context: current.map(({ text: _, ...item }) => item), recall,
          ...(attachmentNames.some(Boolean) ? { resolvedAttachmentNames: attachmentNames } : {}),
          ...(prior && targetId ? { replyTo: { turnId: targetId, status: 'resolved' } as const } : {}),
          ...(savedSelection?.explanation ? { explanation: savedSelection.explanation } : {}) });
        failureStage = 'planning';
        const recalled = prior ? null : recallProjectName(record, current, earlierTurns);
        const raw = namedReview ?? recalled ?? await deps.plan(record, evidence, signal, earlierTurns);
        failureStage = 'validation';
        let savedReply = false;
        let plan: ConversationPlan;
        const proposedAction = (raw as Partial<ConversationPlan> | null)?.action;
        if (prior && (proposedAction === 'code' || proposedAction === 'browser')) {
          plan = { action: 'clarify', reply: 'A Reply to request cannot start a check. Send a separate Check request with the intended evidence.', citations: [], scope: [] };
        } else {
          try {
            plan = namedReview ?? validatePlanWithLiteralRecall(raw, record, evidence, earlierTurns);
          } catch (error) {
            if (error instanceof ConversationValidationError) {
              validationReason = error.reason;
              console.warn(`[conversation] Response validation rejected request ${record.id} (${validationReason}).`);
              if (executionRequested && validationReason === 'scope_unbound') {
                await checkpoint({ state: 'completed', action: 'clarify', reply: 'Which repository folder or file should I review? Reply with **Review** followed by the path.' });
                return;
              }
            }
            if (!savedSelection) throw error;
            savedReply = true;
            plan = savedSelection;
          }
        }
        const requested = requestedCheckMode(text);
        if (['code', 'browser'].includes(plan.action) && (!executionRequested || requested && plan.action !== requested)) {
          plan = { action: 'clarify', reply: 'Would you like an explanation, a suggested fix, or a verification run for the attached evidence?', citations: [], scope: [] };
        }
        if (prior && plan.action !== 'clarify' && record.input.references.length > 0
          && !plan.citations.some(id => current.some(item => item.id === id && !item.unavailable))) {
          plan = { action: 'clarify', reply: 'I could not ground that answer in the newly selected evidence. Select a readable attachment or say if you mean only the earlier reply.',
            citations: [], scope: [] };
        }
        if (plan.action === 'code' && evidence.some(item => item.id.startsWith('review:') && JSON.parse(item.text).omittedSourceCount > 0)) {
          plan = { action: 'clarify', reply: 'This saved Check covers more source files than a scoped follow-up can verify. Attach the specific problems or source files to check.', citations: [], scope: [] };
        }
        if (plan.action === 'browser') {
          try {
            browserTargets(evidence, record.input.text);
          } catch {
            plan = { action: 'clarify', reply: 'Which page or behavior should I verify in the browser, and what should the page show when it works?', citations: [], scope: [] };
          }
        }
        const fallbackScope = plan.action === 'browser' ? browserFallbackScope(evidence, record) : [];
        await checkpoint({ ...plan, replyFormat: plan.replyFormat ?? 'markdown',
          ...(savedReply ? { replyOrigin: 'saved_evidence', answerUnavailable: true, validationReason } : recalled && !namedReview ? { replyOrigin: 'saved_recall' } : {}),
          ...(fallbackScope.length ? { fallbackScope } : {}) });
        if (!['code', 'browser'].includes(plan.action)) { await checkpoint({ state: 'completed' }); return; }
        if (record.input.permission === 'ask') { await checkpoint({ state: 'awaiting_permission' }); return; }
        await checkpoint({ state: 'running' });
      }
      failureStage = 'execution';
      signal.throwIfAborted();
      if (record.input.replyToTurnId && ['code', 'browser'].includes(record.action ?? '')) {
        await checkpoint({ state: 'completed', action: 'clarify', reply: 'A Reply to request cannot start a check. Send a separate Check request with the intended evidence.', citations: [], scope: [] });
        return;
      }
      if (deps.held(record.projectId)) {
        await checkpoint({ state: 'paused', failureStage, failureReason: 'assessment_hold', error: 'AI assessment was paused before execution. Send a new request after resuming.' });
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
      const missingReference = failureStage === 'context' && record.input.references.length > 0
        && error instanceof DynamicContractError && error.status === 404;
      const failureReason = paused ? 'provider_paused' : missingReference ? 'missing_reference'
        : error instanceof ConversationBrowserStartupError ? 'browser_startup' : undefined;
      try { await this.patch(record, { state: paused ? 'paused' : 'failed', failureStage,
        ...(validationReason ? { validationReason } : {}),
        ...(failureReason ? { failureReason } : {}),
        error: paused ? 'The provider paused this request. Resume through a new request when available.'
          : missingReference ? 'An attached record is unavailable. Reattach the saved Check or problem and send a new message.'
          : error instanceof ConversationBrowserStartupError ? 'The app could not start. Inspect the saved Browser attempt or try again after the app starts.'
            : 'This request could not finish. Its saved evidence and child executions remain available.' }, deps); } catch { /* failed checkpoint remains nonterminal for interruption recovery */ }
    }
  }
  async close() {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled(this.pending);
  }
}
