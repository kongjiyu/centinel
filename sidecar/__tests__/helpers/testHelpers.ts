import initSqlJs, { Database } from 'sql.js';

let testDb: Database | null = null;

export async function createTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  testDb = new SQL.Database();

  testDb.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  testDb.run(`
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

  testDb.run(`
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
      file_path TEXT NOT NULL DEFAULT '',
      line_number INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  testDb.run(`
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

  testDb.run(`
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

  testDb.run(`
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

  testDb.run(`
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
      base_ref TEXT NOT NULL DEFAULT '',
      head_ref TEXT NOT NULL DEFAULT '',
      changed_files_json TEXT NOT NULL DEFAULT '[]',
      parent_session_id TEXT NOT NULL DEFAULT '',
      review_diff_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Test plan (Group 2c). The schema mirrors db.ts; if the real
  // schema adds a column, this seed needs to match.
  testDb.run(`
    CREATE TABLE IF NOT EXISTS test_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      module TEXT NOT NULL,
      component TEXT,
      file_path TEXT NOT NULL DEFAULT '',
      line_number INTEGER,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      rationale TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  testDb.run(`
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

  testDb.run(`
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

  return testDb;
}

export function getTestDb(): Database {
  if (!testDb) throw new Error('Test DB not initialized');
  return testDb;
}

export function closeTestDb() {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

export function insertTestProject(db: Database, id: string = 'proj-1', workspacePath: string = '/tmp/test-workspace') {
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'Test Project', 'A test project', workspacePath, now, now]
  );
}

export function insertTestArtifact(
  db: Database,
  id: string = 'art-1',
  projectId: string = 'proj-1',
  type: string = 'requirement',
  fileName: string = 'requirements.md',
  filePath: string = '/tmp/artifacts/art-1_requirements.md'
) {
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, type, fileName, filePath, null, `hash-${id}`, now]
  );
}

export function insertTestStaticSession(
  db: Database,
  id: string = 'ss-1',
  projectId: string = 'proj-1',
  status: string = 'success'
) {
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, 'Test Review', 'requirement_review', status, '{}', '{}', '', 'Test summary', '', now, now, '', '', '[]', '', '']
  );
}

export function insertTestFinding(
  db: Database,
  id: string = 'find-1',
  projectId: string = 'proj-1',
  sessionId: string = 'ss-1',
  filePath: string = '',
  lineNumber: number | null = null
) {
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, sessionId, 'static', 'high', 'Test Finding', 'A test finding description', 'new', now, null, 'unclear_requirement', 'Some evidence', 'Fix it', 'high', 0, filePath, lineNumber]
  );
}
