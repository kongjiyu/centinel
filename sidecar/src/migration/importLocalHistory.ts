import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ConversationRequest } from '../conversation/types.js';
import type { AutoTestSession } from '../dynamic/autonomous/orchestrator.js';
import { centinelHome } from '../paths.js';
import { LocalHistory } from '../store/localHistory.js';

const [owner, project, filename, stagingDirectory, ...extra] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (!owner || !project || !filename || !uuid.test(owner) || !uuid.test(project) || !isAbsolute(filename)
  || stagingDirectory !== undefined && !isAbsolute(stagingDirectory) || extra.length) {
  throw new Error('Usage: pnpm --filter @centinel/sidecar migrate:history <owner UUID> <project UUID> <absolute JSON path> [absolute staging home]');
}

type SavedHistory = {
  conversations?: ConversationRequest[];
  autoTests?: AutoTestSession[];
};
const parsed = JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')) as SavedHistory & {
  history?: SavedHistory; project?: { id?: string; ownerId?: string };
};
if (parsed?.project && (parsed.project.ownerId !== owner || parsed.project.id !== project)) {
  throw new Error('The workspace archive does not match the selected owner and project.');
}
const archive = parsed?.history ?? parsed;
const conversationStates = new Set(['completed', 'failed', 'paused', 'interrupted', 'cancelled']);
const autoTestStages = new Set(['completed', 'failed', 'cancelled']);
const validIdentity = (record: ConversationRequest | AutoTestSession) => record
  && typeof record.id === 'string' && uuid.test(record.id)
  && record.ownerId === owner && record.projectId === project
  && typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt));
if (!Array.isArray(archive?.conversations) || !Array.isArray(archive?.autoTests)
  || archive.conversations.some(record => !validIdentity(record) || !conversationStates.has(record.state)
    || !Number.isSafeInteger(record.revision) || record.revision < 0 || typeof record.input?.text !== 'string'
    || !Array.isArray(record.input.references) || !Array.isArray(record.events))
  || archive.autoTests.some(record => !validIdentity(record) || record.schemaVersion !== 1 || !autoTestStages.has(record.stage)
    || !Array.isArray(record.tests) || !Array.isArray(record.lanes))) {
  throw new Error('History export contains an invalid, unfinished, or out-of-scope record.');
}

const history = new LocalHistory(join(stagingDirectory ?? centinelHome(), 'data', 'project-history.sqlite'));
try {
  console.log(JSON.stringify(history.importSaved(owner, project, archive.conversations, archive.autoTests)));
} finally {
  history.close();
}
