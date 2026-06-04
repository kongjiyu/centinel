import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, closeTestDb, insertTestProject } from '../helpers/testHelpers';
import { setTestDb, clearTestDb } from '../../src/db';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dynamicSessions to avoid playwright dependency
vi.mock('../../src/dynamicSessions.js', () => ({
  listDynamicSessions: vi.fn().mockResolvedValue([]),
  getDynamicSession: vi.fn().mockResolvedValue(null),
  listDynamicEvidence: vi.fn().mockResolvedValue([]),
}));

import { exportProjectReport, exportSessionReport } from '../../src/reportExport';
import { createStaticSession, createFinding } from '../../src/staticSessions';

describe('reportExport', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const db = await createTestDb();
    setTestDb(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-report-test-'));
    insertTestProject(db, 'proj-1', tmpDir);
  });

  afterEach(() => {
    clearTestDb();
    closeTestDb();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('exportProjectReport', () => {
    it('should generate a report file in workspace/reports/', async () => {
      const reportPath = await exportProjectReport('proj-1');

      expect(fs.existsSync(reportPath)).toBe(true);
      expect(reportPath).toContain(path.join(tmpDir, 'reports'));
      expect(reportPath).toMatch(/\.md$/);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('# Centinel QA Report');
      expect(content).toContain('Test Project');
    });

    it('should include summary table with zero findings', async () => {
      const reportPath = await exportProjectReport('proj-1');
      const content = fs.readFileSync(reportPath, 'utf-8');

      expect(content).toContain('## Summary');
      expect(content).toContain('| Total Findings | 0 |');
    });

    it('should include static session findings in report', async () => {
      const session = await createStaticSession('proj-1', 'Requirement Review', 'requirement_review', {});
      await createFinding('proj-1', session.id, {
        severity: 'critical',
        title: 'Vague requirement',
        description: 'The requirement uses ambiguous language',
        category: 'unclear_requirement',
        evidenceText: 'The system shall be fast',
        recommendation: 'Define specific metrics',
        confidence: 'high',
      });
      await createFinding('proj-1', session.id, {
        severity: 'medium',
        title: 'Missing detail',
        description: 'No error handling specified',
        category: 'missing_detail',
        evidenceText: '',
        recommendation: 'Add error handling section',
        confidence: 'medium',
      });

      const reportPath = await exportProjectReport('proj-1');
      const content = fs.readFileSync(reportPath, 'utf-8');

      expect(content).toContain('| Total Findings | 2 |');
      expect(content).toContain('🔴 Critical');
      expect(content).toContain('🟡 Medium');
      expect(content).toContain('Vague requirement');
      expect(content).toContain('Missing detail');
      expect(content).toContain('## Static Review Sessions');
      expect(content).toContain('Requirement Review');
      expect(content).toContain('Finding Details');
    });

    it('should include finding details with evidence and recommendation', async () => {
      const session = await createStaticSession('proj-1', 'Code Review', 'code_review', {});
      await createFinding('proj-1', session.id, {
        severity: 'high',
        title: 'Null pointer risk',
        description: 'Accessing property without null check',
        category: 'potential_bug',
        evidenceText: 'const x = obj.prop;',
        recommendation: 'Add null check before access',
        confidence: 'high',
      });

      const reportPath = await exportProjectReport('proj-1');
      const content = fs.readFileSync(reportPath, 'utf-8');

      expect(content).toContain('**Evidence:**');
      expect(content).toContain('const x = obj.prop;');
      expect(content).toContain('**Recommendation:** Add null check before access');
    });

    it('should handle project with no sessions', async () => {
      const reportPath = await exportProjectReport('proj-1');
      const content = fs.readFileSync(reportPath, 'utf-8');

      expect(content).toContain('*No static review sessions completed.*');
    });

    it('should throw for non-existent project', async () => {
      await expect(exportProjectReport('nonexistent')).rejects.toThrow('Project not found');
    });
  });

  describe('exportSessionReport', () => {
    it('should generate a session-level report', async () => {
      const session = await createStaticSession('proj-1', 'My Review', 'requirement_review', {});
      await createFinding('proj-1', session.id, {
        severity: 'high',
        title: 'Issue Found',
        description: 'Description of the issue',
        category: 'unclear_requirement',
        evidenceText: 'Evidence text',
        recommendation: 'Fix it',
        confidence: 'high',
      });

      const reportPath = await exportSessionReport('proj-1', session.id);
      expect(fs.existsSync(reportPath)).toBe(true);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('# Static Review Report: My Review');
      expect(content).toContain('Test Project');
      expect(content).toContain('requirement review');
      expect(content).toContain('Issue Found');
      expect(content).toContain('## Findings');
      expect(content).toContain('## Finding Details');
    });

    it('should handle session with no findings', async () => {
      const session = await createStaticSession('proj-1', 'Clean Review', 'code_review', {});

      const reportPath = await exportSessionReport('proj-1', session.id);
      const content = fs.readFileSync(reportPath, 'utf-8');

      expect(content).toContain('*No findings generated for this session.*');
    });

    it('should throw for non-existent session', async () => {
      await expect(exportSessionReport('proj-1', 'nonexistent')).rejects.toThrow('Session not found');
    });

    it('should throw for non-existent project', async () => {
      await expect(exportSessionReport('nonexistent', 'ss-1')).rejects.toThrow('Project not found');
    });

    it('should sort findings by severity', async () => {
      const session = await createStaticSession('proj-1', 'Review', 'requirement_review', {});
      await createFinding('proj-1', session.id, {
        severity: 'low', title: 'Low Issue', description: '', category: '',
        evidenceText: '', recommendation: '', confidence: 'low',
      });
      await createFinding('proj-1', session.id, {
        severity: 'critical', title: 'Critical Issue', description: '', category: '',
        evidenceText: '', recommendation: '', confidence: 'high',
      });
      await createFinding('proj-1', session.id, {
        severity: 'medium', title: 'Medium Issue', description: '', category: '',
        evidenceText: '', recommendation: '', confidence: 'medium',
      });

      const reportPath = await exportSessionReport('proj-1', session.id);
      const content = fs.readFileSync(reportPath, 'utf-8');

      // Critical should appear before medium, which should appear before low
      const critPos = content.indexOf('Critical Issue');
      const medPos = content.indexOf('Medium Issue');
      const lowPos = content.indexOf('Low Issue');
      expect(critPos).toBeLessThan(medPos);
      expect(medPos).toBeLessThan(lowPos);
    });
  });
});
