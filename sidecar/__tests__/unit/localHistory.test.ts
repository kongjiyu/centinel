import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ConversationRequest } from '../../src/conversation/types.js';
import { newAutoTestSession } from '../../src/dynamic/autonomous/orchestrator.js';
import { LocalHistory } from '../../src/store/localHistory.js';

it('reopens local history with stable IDs, isolated accounts and revision checks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'centinel-history-'));
  const path = join(directory, 'history.sqlite');
  const history = new LocalHistory(path);
  const reopened = new LocalHistory(path);
  const owner = 'owner', project = 'project';
  const id = randomUUID(), createdAt = '2026-11-24T00:00:00.000Z';
  const original: ConversationRequest = {
    id, ownerId: owner, projectId: project, revision: 0, createdAt, updatedAt: createdAt,
    input: { id, text: 'What is a unit test?', mode: 'both', permission: 'ask', references: [] },
    inputHash: 'fixture', policyVersion: 'fixture', state: 'accepted', events: [],
  };
  const completed: ConversationRequest = { ...original, revision: 1, state: 'completed', reply: 'A focused behavior check.' };
  const session = { ...newAutoTestSession({ id: randomUUID(), ownerId: owner, projectId: project, folder: directory }), stage: 'completed' as const };
  try {
    const conversations = history.conversations(owner);
    expect(await conversations.create(original)).toBe(true);
    expect(await conversations.create(original)).toBe(false);
    expect(await conversations.listActive?.(project, owner)).toEqual([original]);
    expect(await conversations.update(completed, 0)).toBe(true);
    expect(await conversations.update(original, 0)).toBe(false);
    expect(history.importSaved(owner, project, [original], [session])).toEqual({ importedConversations: 0, importedAutoTests: 1 });
    expect(history.importSaved(owner, project, [original], [session])).toEqual({ importedConversations: 0, importedAutoTests: 0 });
    history.close();

    expect(await reopened.conversations(owner).list(project)).toEqual([completed]);
    expect(await reopened.conversations(owner).listEarlierCompleted(project, owner, '2026-11-25', 6)).toEqual([completed]);
    expect(await reopened.conversations('other').get(project, id)).toBeNull();
    expect(await reopened.conversations(owner).get('other', id)).toBeNull();
    expect(await reopened.autoTests(owner).get(project, session.id)).toEqual(session);
    expect(await reopened.autoTests('other').list(project)).toEqual([]);
  } finally {
    history.close();
    reopened.close();
    rmSync(directory, { recursive: true });
  }
});
