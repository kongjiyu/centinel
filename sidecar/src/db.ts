import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance: Database | null = null;
let dbPath = path.resolve(__dirname, '../../data/centinel.sqlite');

export function getDbPath(): string {
  return dbPath;
}

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    dbInstance = new SQL.Database(buffer);
  } else {
    dbInstance = new SQL.Database();
  }

  initSchema(dbInstance);
  saveDb();
  return dbInstance;
}

function initSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      source TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS dynamic_session_details (
      session_id TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      goal TEXT NOT NULL,
      mission_type TEXT NOT NULL,
      browser_mode TEXT NOT NULL,
      max_steps INTEGER NOT NULL,
      final_summary TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_provider_settings (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      compatibility_mode TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Seed defaults if empty
  const stmt = db.prepare("SELECT COUNT(*) FROM ai_provider_settings WHERE id = 'text'");
  stmt.step();
  const count = (stmt.get() as unknown[])[0] as number;
  stmt.free();

  if (count === 0) {
    const now = new Date().toISOString();
    db.run(
      "INSERT INTO ai_provider_settings (id, label, compatibility_mode, api_key, base_url, model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['text', 'Text Generation', 'anthropic', '', 'https://api.xiaomimimo.com/anthropic/v1/messages', 'mimo-v2.5-pro', now]
    );
    db.run(
      "INSERT INTO ai_provider_settings (id, label, compatibility_mode, api_key, base_url, model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['vision', 'Multimodal Vision', 'anthropic', '', 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages', 'mimo-v2.5', now]
    );
  }
}

export function saveDb() {
  if (!dbInstance) return;
  const data = dbInstance.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}
