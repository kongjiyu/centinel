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
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_path TEXT,
      content_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'documents',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS static_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      review_type TEXT NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      progress_json TEXT NOT NULL DEFAULT '{}',
      remarks TEXT NOT NULL DEFAULT '',
      final_summary TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS review_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      artifact_type TEXT NOT NULL DEFAULT 'analysis',
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES static_sessions(id)
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

  // Migrate: add columns to findings if they don't exist (existing DBs)
  const migrateCol = (col: string, colDef: string) => {
    try { db.run(`ALTER TABLE findings ADD COLUMN ${col} ${colDef}`); } catch { /* already exists */ }
  };
  migrateCol('artifact_id', 'TEXT');
  migrateCol('category', "TEXT NOT NULL DEFAULT ''");
  migrateCol('evidence_text', "TEXT NOT NULL DEFAULT ''");
  migrateCol('recommendation', "TEXT NOT NULL DEFAULT ''");
  migrateCol('confidence', "TEXT NOT NULL DEFAULT ''");

  // Migrate: add remarks column to static_sessions if missing
  try { db.run("ALTER TABLE static_sessions ADD COLUMN remarks TEXT NOT NULL DEFAULT ''"); } catch { /* already exists */ }

  // Migrate: add progress_json column to static_sessions if missing
  try { db.run("ALTER TABLE static_sessions ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}'"); } catch { /* already exists */ }

  // Migrate: add from_remarks column to findings if missing
  try { db.run("ALTER TABLE findings ADD COLUMN from_remarks INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }

  // Migrate: add source column to artifacts if missing
  try { db.run("ALTER TABLE artifacts ADD COLUMN source TEXT NOT NULL DEFAULT 'documents'"); } catch { /* already exists */ }

  // Phase 2: Repository Indexing
  db.run(`
    CREATE TABLE IF NOT EXISTS repo_index (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      parent_path TEXT,
      file_type TEXT,
      language TEXT,
      file_size INTEGER,
      symbol_count INTEGER DEFAULT 0,
      indexed_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS code_symbols (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      symbol_type TEXT NOT NULL,
      name TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      signature TEXT,
      exports INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (file_id) REFERENCES repo_index(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS code_relationships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_file_id TEXT NOT NULL,
      target_file_path TEXT,
      target_symbol TEXT,
      relationship_type TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (source_file_id) REFERENCES repo_index(id)
    )
  `);

  // Phase 4: Static Analysis Results
  db.run(`
    CREATE TABLE IF NOT EXISTS static_analysis_results (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      file_path TEXT NOT NULL,
      line_number INTEGER,
      rule_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      evidence TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Phase 6: Requirements
  db.run(`
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS requirement_mappings (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      file_id TEXT,
      symbol_id TEXT,
      coverage_status TEXT NOT NULL DEFAULT 'unknown',
      confidence REAL DEFAULT 0,
      FOREIGN KEY (requirement_id) REFERENCES requirements(id)
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
  if (!dbInstance || isTestMode) return;
  const data = dbInstance.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}
