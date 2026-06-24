import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, closeTestDb, insertTestProject } from '../helpers/testHelpers';
import { setTestDb, clearTestDb } from '../../src/db';
import {
  computeContentHash,
  detectArtifactType,
  listArtifacts,
  getArtifact,
  deleteArtifact,
  readArtifactContent,
} from '../../src/artifacts';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('artifacts', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const db = await createTestDb();
    setTestDb(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-test-'));
    insertTestProject(db, 'proj-1', tmpDir);
  });

  afterEach(() => {
    clearTestDb();
    closeTestDb();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('computeContentHash', () => {
    it('should return consistent SHA-256 hash for same file', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'hello world');
      const hash1 = computeContentHash(filePath);
      const hash2 = computeContentHash(filePath);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return different hash for different content', () => {
      const file1 = path.join(tmpDir, 'a.txt');
      const file2 = path.join(tmpDir, 'b.txt');
      fs.writeFileSync(file1, 'hello');
      fs.writeFileSync(file2, 'world');
      expect(computeContentHash(file1)).not.toBe(computeContentHash(file2));
    });

    it('should hash empty file', () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      fs.writeFileSync(filePath, '');
      const hash = computeContentHash(filePath);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      // SHA-256 of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('detectArtifactType', () => {
    it('should detect requirement types from extension', () => {
      expect(detectArtifactType('requirements.txt')).toBe('requirement');
      expect(detectArtifactType('spec.md')).toBe('requirement');
    });

    it('should detect source code types', () => {
      expect(detectArtifactType('app.js')).toBe('source_code');
      expect(detectArtifactType('index.ts')).toBe('source_code');
      expect(detectArtifactType('main.py')).toBe('source_code');
      expect(detectArtifactType('App.java')).toBe('source_code');
      expect(detectArtifactType('Program.cs')).toBe('source_code');
      expect(detectArtifactType('page.tsx')).toBe('source_code');
      expect(detectArtifactType('component.jsx')).toBe('source_code');
      expect(detectArtifactType('style.css')).toBe('source_code');
      expect(detectArtifactType('index.html')).toBe('source_code');
      expect(detectArtifactType('main.go')).toBe('source_code');
      expect(detectArtifactType('app.rb')).toBe('source_code');
      expect(detectArtifactType('lib.rs')).toBe('source_code');
      expect(detectArtifactType('main.cpp')).toBe('source_code');
      expect(detectArtifactType('util.c')).toBe('source_code');
      expect(detectArtifactType('types.h')).toBe('source_code');
    });

    it('should detect other types for data files', () => {
      expect(detectArtifactType('config.json')).toBe('other');
      expect(detectArtifactType('docker.yaml')).toBe('other');
      expect(detectArtifactType('docker-compose.yml')).toBe('other');
    });

    it('should return other for unknown extensions', () => {
      expect(detectArtifactType('image.png')).toBe('other');
      expect(detectArtifactType('readme.rst')).toBe('other');
      expect(detectArtifactType('data.xml')).toBe('other');
    });

    it('should handle case insensitivity', () => {
      expect(detectArtifactType('README.MD')).toBe('requirement');
      expect(detectArtifactType('APP.JS')).toBe('source_code');
    });
  });

  describe('listArtifacts', () => {
    it('should return empty array when no artifacts exist', async () => {
      const result = await listArtifacts('proj-1');
      expect(result).toEqual([]);
    });

    it('should return artifacts ordered by created_at DESC', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1000).toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'req.md', '/tmp/req.md', null, 'hash1', now]
      );
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-2', 'proj-1', 'source_code', 'app.ts', '/tmp/app.ts', null, 'hash2', later]
      );

      const result = await listArtifacts('proj-1');
      expect(result).toHaveLength(2);
      expect(result[0].fileName).toBe('app.ts');
      expect(result[1].fileName).toBe('req.md');
    });

    it('should not return artifacts from other projects', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      insertTestProject(db, 'proj-2', '/tmp/other');
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'req.md', '/tmp/req.md', null, 'hash1', now]
      );
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-2', 'proj-2', 'source_code', 'app.ts', '/tmp/app.ts', null, 'hash2', now]
      );

      const result = await listArtifacts('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('art-1');
    });

    it('should map all fields correctly', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'req.md', '/tmp/req.md', '/orig/req.md', 'abc123', now]
      );

      const result = await listArtifacts('proj-1');
      expect(result[0]).toEqual({
        id: 'art-1',
        projectId: 'proj-1',
        type: 'requirement',
        source: 'documents',
        fileName: 'req.md',
        filePath: '/tmp/req.md',
        originalPath: '/orig/req.md',
        contentHash: 'abc123',
        createdAt: now,
      });
    });
  });

  describe('getArtifact', () => {
    it('should return artifact by id', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'req.md', '/tmp/req.md', '/orig/req.md', 'hash1', now]
      );

      const result = await getArtifact('art-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('art-1');
      expect(result!.fileName).toBe('req.md');
      expect(result!.type).toBe('requirement');
      expect(result!.originalPath).toBe('/orig/req.md');
    });

    it('should return null for non-existent artifact', async () => {
      const result = await getArtifact('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('deleteArtifact', () => {
    it('should delete artifact and remove file from disk', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const filePath = path.join(tmpDir, 'test-artifact.txt');
      fs.writeFileSync(filePath, 'test content');
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'test.txt', filePath, null, 'hash1', now]
      );

      const result = await deleteArtifact('art-1');
      expect(result).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);

      const artifact = await getArtifact('art-1');
      expect(artifact).toBeNull();
    });

    it('should return false for non-existent artifact', async () => {
      const result = await deleteArtifact('nonexistent');
      expect(result).toBe(false);
    });

    it('should succeed even if file does not exist on disk', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'missing.txt', '/nonexistent/path/file.txt', null, 'hash1', now]
      );

      const result = await deleteArtifact('art-1');
      expect(result).toBe(true);
    });
  });

  describe('readArtifactContent', () => {
    it('should read file content as utf-8', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const filePath = path.join(tmpDir, 'readable.txt');
      fs.writeFileSync(filePath, 'Hello, World!');
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'readable.txt', filePath, null, 'hash1', now]
      );

      const content = await readArtifactContent('art-1');
      expect(content).toBe('Hello, World!');
    });

    it('should throw for non-existent artifact', async () => {
      await expect(readArtifactContent('nonexistent')).rejects.toThrow('Artifact not found');
    });

    it('should read multi-line content preserving formatting', async () => {
      const db = await import('../../src/db').then(m => m.getDb());
      const filePath = path.join(tmpDir, 'multiline.md');
      const content = '# Title\n\nSome content\n- item 1\n- item 2\n';
      fs.writeFileSync(filePath, content);
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['art-1', 'proj-1', 'requirement', 'multiline.md', filePath, null, 'hash1', now]
      );

      const result = await readArtifactContent('art-1');
      expect(result).toBe(content);
    });
  });
});
