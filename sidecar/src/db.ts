import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance: Database | null = null;
let dbPath = path.resolve(__dirname, '../../data/centinel.sqlite');
let isTestMode = false;

export function getDbPath(): string {
  return dbPath;
}

export function setTestDb(db: Database) {
  dbInstance = db;
  isTestMode = true;
  // Tests use the same additive Dynamic schema as persisted local databases.
  initSchema(db);
}

export function clearTestDb() {
  dbInstance = null;
  isTestMode = false;
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
      priority TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      artifact_id TEXT,
      category TEXT NOT NULL DEFAULT '',
      evidence_text TEXT NOT NULL DEFAULT '',
      recommendation TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT '',
      from_remarks INTEGER NOT NULL DEFAULT 0,
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

  // Keep older local Dynamic findings readable without touching legacy
  // Static Review tables that are retained for explicit migration.
  const migrateFindingColumn = (col: string, colDef: string) => {
    try { db.run(`ALTER TABLE findings ADD COLUMN ${col} ${colDef}`); } catch { /* already exists */ }
  };
  migrateFindingColumn('artifact_id', 'TEXT');
  migrateFindingColumn('category', "TEXT NOT NULL DEFAULT ''");
  migrateFindingColumn('evidence_text', "TEXT NOT NULL DEFAULT ''");
  migrateFindingColumn('recommendation', "TEXT NOT NULL DEFAULT ''");
  migrateFindingColumn('confidence', "TEXT NOT NULL DEFAULT ''");
  migrateFindingColumn('priority', 'TEXT');
  migrateFindingColumn('from_remarks', 'INTEGER NOT NULL DEFAULT 0');
  migrateFindingColumn('file_path', "TEXT NOT NULL DEFAULT ''");
  migrateFindingColumn('line_number', 'INTEGER');

  // Local Dynamic Testing usage. Static Review usage is authoritative in
  // Supabase model_usage_records.
  db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      session_id TEXT,
      scope TEXT NOT NULL,
      call_kind TEXT NOT NULL DEFAULT 'review',
      stage TEXT,
      round_number INTEGER,
      provider TEXT NOT NULL,
      api_format TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_usage_scope ON token_usage(scope, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id, round_number)`);
}

export function saveDb() {
  if (!dbInstance || isTestMode) return;
  const data = dbInstance.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}
