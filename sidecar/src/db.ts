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

  // Phase 8: Review Decisions (P0-3)
  //
  // A session-level lifecycle event distinct from per-finding status.
  //   - 'approved'        — the reviewer's overall sign-off; the report can ship
  //   - 'changes_requested' — blocking; new findings or unresolved issues remain
  //   - 'commented'       — non-blocking note, no verdict yet
  // The most recent decision for a session is the "current" one; full history
  // is preserved so the audit trail shows how the team got there.
  db.run(`
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      reviewer TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES static_sessions(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
  // Index: list decisions for a session in reverse chronological order.
  db.run(`CREATE INDEX IF NOT EXISTS idx_review_decisions_session ON review_decisions(session_id, created_at DESC)`);
  // Index: list all decisions on a project (for the "review activity" feed
  // if/when we surface one on the project dashboard).
  db.run(`CREATE INDEX IF NOT EXISTS idx_review_decisions_project ON review_decisions(project_id, created_at DESC)`);

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

  // Migrate: add file_path + line_number to findings for precise location display
  migrateCol('file_path', "TEXT NOT NULL DEFAULT ''");
  migrateCol('line_number', 'INTEGER');

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
      confidence TEXT NOT NULL DEFAULT 'high',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
  // Migration: older databases (pre-noise-filter era) were created without
  // the confidence column. dedupeAgainstStaticFindings reads it to rank
  // static findings vs AI findings; without the column that query throws
  // "no such column: confidence" mid-pipeline. Backfill with 'high' — static
  // rules are deterministic so 'high' is the correct implicit value.
  addColumnIfMissing(db, 'static_analysis_results', 'confidence', "TEXT NOT NULL DEFAULT 'high'");

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

  // Phase 7: AI Token Usage
  //
  // One row per AI call (text or vision, test or review). The provider
  // reports its own usage block which we persist verbatim. Cost is not
  // computed here — pricing varies wildly per provider, model, and contract;
  // that's a dashboard concern. The `call_kind` column distinguishes the
  // origin so the Settings page can show "5 review calls" vs "12 test calls"
  // separately.
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
  // Composite index: the Settings page filters by scope + groups by
  // (provider, api_format, model). Sessions are paged in chronological
  // order, so created_at covers both ad-hoc and per-session queries.
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_usage_scope ON token_usage(scope, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id, round_number)`);

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

/**
 * Migration helper: add a column to a table if it doesn't already exist.
 * CREATE TABLE IF NOT EXISTS won't add columns to a pre-existing table, so
 * schema additions for already-deployed databases need an explicit ALTER.
 * Safe to call on every startup — the PRAGMA check makes it a no-op when
 * the column is already there.
 */
function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  definition: string
): void {
  const infoStmt = db.prepare(`PRAGMA table_info(${table})`);
  const existing = new Set<string>();
  while (infoStmt.step()) {
    const row = infoStmt.get() as unknown[];
    // PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
    existing.add(row[1] as string);
  }
  infoStmt.free();
  if (existing.has(column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
