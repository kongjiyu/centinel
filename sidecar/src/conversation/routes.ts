import { DynamicContractError } from '../dynamic/types.js';
import { presentSavedSelection } from './savedExplanation.js';
import { parseConversationInput, type ConversationDeps, type ConversationRuntime, type Evidence } from './service.js';
import type { ConversationReference } from './types.js';

export async function handleConversationRoute(input: {
  resource: 'conversation-permission' | 'conversation-requests';
  id?: string;
  action?: string;
  method: string | undefined;
  projectId: string;
  runtime: ConversationRuntime;
  deps: ConversationDeps;
  readBody: () => Promise<Record<string, unknown>>;
  resolveEvidence: (references: ConversationReference[], signal: AbortSignal) => Promise<Evidence[]>;
}) {
  const { resource, id, action, method, readBody, projectId, runtime, deps, resolveEvidence } = input;
  const { store } = deps;
  if (resource === 'conversation-permission') {
    if (method !== 'POST') return { status: 405, body: { error: 'Unsupported conversation operation.' } };
    const { permission } = await readBody();
    if (permission !== 'ask' && permission !== 'auto' && permission !== 'bypass') throw new DynamicContractError(400, 'Invalid permission mode.');
    await runtime.permission(projectId, permission, deps);
    return { status: 200, body: { ok: true } };
  }
  if (!id && method === 'POST') return { status: 202, body: await runtime.accept(projectId, parseConversationInput(await readBody()), deps) };
  if (!id && method === 'GET') {
    const records = await store.list(projectId);
    const body = await Promise.all(records.map(async record => {
      try { return await runtime.reconcile(record, deps); }
      catch (error) {
        if (!(error instanceof DynamicContractError) || error.status !== 409) throw error;
        return record;
      }
    }));
    return { status: 200, body };
  }
  const record = id ? await store.get(projectId, id) : null;
  if (!record || (method === 'GET' && record.ownerId !== deps.ownerId)) return { status: 404, body: { error: 'Conversation request unavailable.' } };
  if (method === 'GET' && !action) return { status: 200, body: await runtime.reconcile(record, deps) };
  if (method === 'GET' && action === 'evidence') {
    const references = record.input.references.filter(ref => ref.reviewId || ref.autoTestId);
    const evidence = new Map<string, Evidence>();
    const signal = AbortSignal.timeout(25_000);
    let unavailable = 0;
    for (const reference of references.slice(0, 4)) {
      try {
        for (const item of await resolveEvidence([reference], signal)) evidence.set(item.id, item);
      } catch (error) {
        if (!(error instanceof DynamicContractError) || error.status !== 404) throw error;
        unavailable++;
      }
    }
    const explanation = presentSavedSelection([...evidence.values()])?.explanation;
    return { status: 200, body: { sections: explanation?.sections ?? [], hasMore: Boolean(explanation?.hasMore || references.length > 4), unavailable } };
  }
  if (method === 'POST' && action === 'cancel') return { status: 200, body: await runtime.cancel(record, deps) };
  if (method === 'POST' && action === 'answer') {
    const { revision, selectedOption, askFirst } = await readBody();
    if (typeof revision !== 'number' || typeof selectedOption !== 'number') throw new DynamicContractError(400, 'Choose one of the saved options.');
    return { status: 200, body: await runtime.answerQuestion(record, revision, selectedOption, deps, askFirst === true) };
  }
  if (method === 'POST' && action === 'confirm') {
    const { revision } = await readBody();
    return { status: 202, body: await runtime.confirm(record, Number(revision), deps) };
  }
  return { status: 405, body: { error: 'Unsupported conversation operation.' } };
}
