import { describe, it, expect } from 'vitest';
import {
  createRequirement,
  listRequirements,
  getRequirement,
  updateRequirement,
  deleteRequirement,
  mapRequirementToCode,
  getRequirementMappings,
} from '../../src/requirements.js';
import { setTestDb, clearTestDb, getDb } from '../../src/db.js';

async function setupTestDb() {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    workspace_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT DEFAULT '', category TEXT DEFAULT '', priority TEXT DEFAULT 'medium',
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS requirement_mappings (
    id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL, file_id TEXT,
    symbol_id TEXT, coverage_status TEXT DEFAULT 'unknown', confidence REAL DEFAULT 0
  )`);
  setTestDb(db);
  // Seed project
  db.run("INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['test-project-1', 'Test', '', '/tmp', new Date().toISOString(), new Date().toISOString()]);
  return db;
}

describe('requirements', () => {
  describe('createRequirement', () => {
    it('creates a requirement with all fields', async () => {
      await setupTestDb();
      const req = await createRequirement('test-project-1', 'Login Validation', 'User must authenticate', 'auth', 'high');
      expect(req.id).toBeDefined();
      expect(req.title).toBe('Login Validation');
      expect(req.description).toBe('User must authenticate');
      expect(req.category).toBe('auth');
      expect(req.priority).toBe('high');
      expect(req.projectId).toBe('test-project-1');
      clearTestDb();
    });

    it('creates a requirement with defaults', async () => {
      await setupTestDb();
      const req = await createRequirement('test-project-1', 'Basic Feature', '', '', '');
      expect(req.category).toBe('');
      expect(req.priority).toBe('');
      clearTestDb();
    });
  });

  describe('listRequirements', () => {
    it('lists all requirements for a project', async () => {
      await setupTestDb();
      await createRequirement('test-project-1', 'Req 1', '', '', '');
      await createRequirement('test-project-1', 'Req 2', '', '', '');
      const list = await listRequirements('test-project-1');
      expect(list.length).toBe(2);
      clearTestDb();
    });

    it('returns empty array for project with no requirements', async () => {
      await setupTestDb();
      const list = await listRequirements('test-project-1');
      expect(list).toHaveLength(0);
      clearTestDb();
    });
  });

  describe('getRequirement', () => {
    it('returns a requirement by id', async () => {
      await setupTestDb();
      const created = await createRequirement('test-project-1', 'Find Me', '', '', '');
      const found = await getRequirement(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Find Me');
      clearTestDb();
    });

    it('returns null for non-existent id', async () => {
      await setupTestDb();
      const found = await getRequirement('non-existent-id');
      expect(found).toBeNull();
      clearTestDb();
    });
  });

  describe('updateRequirement', () => {
    it('updates title and priority', async () => {
      await setupTestDb();
      const created = await createRequirement('test-project-1', 'Old Title', '', '', 'low');
      const updated = await updateRequirement(created.id, { title: 'New Title', priority: 'critical' });
      expect(updated.title).toBe('New Title');
      expect(updated.priority).toBe('critical');
      clearTestDb();
    });

    it('throws for non-existent requirement', async () => {
      await setupTestDb();
      await expect(updateRequirement('non-existent', { title: 'x' })).rejects.toThrow();
      clearTestDb();
    });
  });

  describe('deleteRequirement', () => {
    it('deletes an existing requirement', async () => {
      await setupTestDb();
      const created = await createRequirement('test-project-1', 'Delete Me', '', '', '');
      const deleted = await deleteRequirement(created.id);
      expect(deleted).toBe(true);
      const found = await getRequirement(created.id);
      expect(found).toBeNull();
      clearTestDb();
    });

    it('returns false for non-existent requirement', async () => {
      await setupTestDb();
      const deleted = await deleteRequirement('non-existent');
      expect(deleted).toBe(false);
      clearTestDb();
    });
  });

  describe('mapRequirementToCode', () => {
    it('creates a mapping', async () => {
      await setupTestDb();
      const req = await createRequirement('test-project-1', 'Auth Req', '', '', '');
      const mapping = await mapRequirementToCode(req.id, 'file-123', 'symbol-456', 'implemented', 0.9);
      expect(mapping.id).toBeDefined();
      expect(mapping.requirementId).toBe(req.id);
      expect(mapping.fileId).toBe('file-123');
      expect(mapping.coverageStatus).toBe('implemented');
      expect(mapping.confidence).toBe(0.9);
      clearTestDb();
    });
  });

  describe('getRequirementMappings', () => {
    it('returns mappings for a requirement', async () => {
      await setupTestDb();
      const req = await createRequirement('test-project-1', 'Mapped Req', '', '', '');
      await mapRequirementToCode(req.id, 'file-1', null, 'implemented', 0.8);
      await mapRequirementToCode(req.id, 'file-2', null, 'partial', 0.5);
      const mappings = await getRequirementMappings(req.id);
      expect(mappings.length).toBe(2);
      clearTestDb();
    });

    it('returns empty array for requirement with no mappings', async () => {
      await setupTestDb();
      const req = await createRequirement('test-project-1', 'Unmapped', '', '', '');
      const mappings = await getRequirementMappings(req.id);
      expect(mappings).toHaveLength(0);
      clearTestDb();
    });
  });
});
