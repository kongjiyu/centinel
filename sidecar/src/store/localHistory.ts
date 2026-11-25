import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ConversationStore } from '../conversation/store.js';
import type { ConversationRequest } from '../conversation/types.js';
import type { AutoTestSession } from '../dynamic/autonomous/orchestrator.js';
import type { AutoTestStore } from '../dynamic/autonomous/store.js';

const activeStates = "'accepted', 'planning', 'awaiting_permission', 'running'";

function decode<T>(row: Record<string, unknown>): T {
  return JSON.parse(String(row.payload)) as T;
}

/** History lives on this device under the authenticated account and project IDs. */
export class LocalHistory {
  private database?: DatabaseSync;

  constructor(private readonly filename: string) {}

  private get db() {
    if (this.database) return this.database;
    if (this.filename !== ':memory:') mkdirSync(dirname(this.filename), { recursive: true });
    const db = new DatabaseSync(this.filename);
    try {
      db.exec(`
        PRAGMA busy_timeout = 2000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS conversation_history (
          owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL,
          state TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY (owner, project, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS conversation_history_recent
          ON conversation_history (owner, project, created DESC, id DESC);
        CREATE INDEX IF NOT EXISTS conversation_history_active
          ON conversation_history (owner, project, id) WHERE state IN (${activeStates});
        CREATE TABLE IF NOT EXISTS auto_test_history (
          owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, created TEXT NOT NULL,
          payload TEXT NOT NULL, PRIMARY KEY (owner, project, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS auto_test_history_recent
          ON auto_test_history (owner, project, created DESC, id DESC);
      `);
      this.database = db;
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  /** Import already validated history in one transaction, preserving any live local copy. */
  importSaved(owner: string, project: string, conversations: ConversationRequest[], autoTests: AutoTestSession[]) {
    if ([...conversations, ...autoTests].some(record => record.ownerId !== owner || record.projectId !== project)) {
      throw new Error('Imported history does not belong to the selected account and project.');
    }
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const conversation = db.prepare('INSERT INTO conversation_history VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
      const autoTest = db.prepare('INSERT INTO auto_test_history VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
      let importedConversations = 0;
      let importedAutoTests = 0;
      for (const record of conversations) {
        importedConversations += Number(conversation.run(owner, project, record.id, record.createdAt,
          record.state, record.revision, JSON.stringify(record)).changes);
      }
      for (const session of autoTests) {
        importedAutoTests += Number(autoTest.run(owner, project, session.id, session.createdAt, JSON.stringify(session)).changes);
      }
      db.exec('COMMIT');
      return { importedConversations, importedAutoTests };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  conversations(owner: string): ConversationStore {
    const recent = (project: string, before: string | null, limit: number, completed = false) => {
      const cutoff = before === null ? '' : 'AND created < ?';
      const state = completed ? "AND state = 'completed'" : '';
      const query = this.db.prepare(`SELECT payload FROM conversation_history WHERE owner = ? AND project = ?
        ${cutoff} ${state} ORDER BY created DESC, id DESC LIMIT ?`);
      const rows = before === null ? query.all(owner, project, limit) : query.all(owner, project, before, limit);
      return rows.map(decode<ConversationRequest>);
    };
    return {
      get: async (project, id) => {
        const row = this.db.prepare('SELECT payload FROM conversation_history WHERE owner = ? AND project = ? AND id = ?').get(owner, project, id);
        return row ? decode<ConversationRequest>(row) : null;
      },
      list: async (project, before) => before && before.ownerId !== owner ? [] : recent(project, before?.createdAt ?? null, 50),
      listEarlierCompleted: async (project, actor, before, limit) => actor === owner ? recent(project, before, limit, true) : [],
      listEarlierTurns: async (project, actor, before, limit) => actor === owner ? recent(project, before, limit) : [],
      listActive: async (project, actor) => actor === owner
        ? this.db.prepare(`SELECT payload FROM conversation_history WHERE owner = ? AND project = ?
            AND state IN (${activeStates}) ORDER BY id`).all(owner, project).map(decode<ConversationRequest>) : [],
      create: async record => {
        if (record.ownerId !== owner) return false;
        return this.db.prepare('INSERT INTO conversation_history VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
          .run(owner, record.projectId, record.id, record.createdAt, record.state, record.revision, JSON.stringify(record)).changes === 1;
      },
      update: async (record, revision) => {
        if (record.ownerId !== owner) return false;
        return this.db.prepare(`UPDATE conversation_history SET state = ?, revision = ?, payload = ?
          WHERE owner = ? AND project = ? AND id = ? AND revision = ?`)
          .run(record.state, record.revision, JSON.stringify(record), owner, record.projectId, record.id, revision).changes === 1;
      },
    };
  }

  autoTests(owner: string): AutoTestStore {
    return {
      list: async (project, limit = 10) => this.db.prepare(`SELECT payload FROM auto_test_history WHERE owner = ? AND project = ?
        ORDER BY created DESC, id DESC LIMIT ?`).all(owner, project, limit).map(decode<AutoTestSession>),
      get: async (project, id) => {
        const row = this.db.prepare('SELECT payload FROM auto_test_history WHERE owner = ? AND project = ? AND id = ?').get(owner, project, id);
        return row ? decode<AutoTestSession>(row) : null;
      },
      save: async session => {
        if (session.ownerId !== owner) throw new Error('Auto test history owner mismatch.');
        this.db.prepare(`INSERT INTO auto_test_history VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (owner, project, id) DO UPDATE SET payload = excluded.payload`)
          .run(owner, session.projectId, session.id, session.createdAt, JSON.stringify(session));
      },
    };
  }
}
