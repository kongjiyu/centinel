import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, closeTestDb, insertTestProject, insertTestArtifact } from '../helpers/testHelpers';
import { setTestDb, clearTestDb, getDb } from '../../src/db';
import {
  createStaticSession,
  listStaticSessions,
  getStaticSession,
  getActiveStaticSession,
  listActiveStaticSessions,
  updateStaticSessionStatus,
  createFinding,
  listStaticFindings,
  listAllFindings,
  updateFindingStatus,
} from '../../src/staticSessions';
import type { Database } from 'sql.js';

describe('staticSessions', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
    setTestDb(db);
    insertTestProject(db, 'proj-1');
  });

  afterEach(() => {
    clearTestDb();
    closeTestDb();
  });

  describe('createStaticSession', () => {
    it('should create a session with correct fields', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'My Review', reviewType: 'requirement_review', configJson: { instructions: 'Focus on security' } });

      expect(session.id).toBeDefined();
      expect(session.projectId).toBe('proj-1');
      expect(session.name).toBe('My Review');
      expect(session.reviewType).toBe('requirement_review');
      expect(session.status).toBe('queued');
      expect(session.configJson).toBe(JSON.stringify({ instructions: 'Focus on security' }));
      expect(session.finalSummary).toBe('');
      expect(session.failureReason).toBe('');
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it('should persist to database', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Persisted Review', reviewType: 'code_review', configJson: {} });

      const found = await getStaticSession('proj-1', session.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Persisted Review');
      expect(found!.reviewType).toBe('code_review');
    });

    it('should support all review types', async () => {
      const types = ['requirement_review', 'code_review', 'requirement_to_code_traceability', 'cross_artifact_consistency'] as const;
      for (const type of types) {
        const session = await createStaticSession({ projectId: 'proj-1', name: `Review ${type}`, reviewType: type, configJson: {} });
        expect(session.reviewType).toBe(type);
      }
    });
  });

  describe('listStaticSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const result = await listStaticSessions('proj-1');
      expect(result).toEqual([]);
    });

    it('should return sessions ordered by created_at DESC', async () => {
      await createStaticSession({ projectId: 'proj-1', name: 'First', reviewType: 'requirement_review', configJson: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      await createStaticSession({ projectId: 'proj-1', name: 'Second', reviewType: 'code_review', configJson: {} });

      const result = await listStaticSessions('proj-1');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Second');
      expect(result[1].name).toBe('First');
    });

    it('should not return sessions from other projects', async () => {
      insertTestProject(db, 'proj-2');
      await createStaticSession({ projectId: 'proj-1', name: 'Project 1 Review', reviewType: 'requirement_review', configJson: {} });
      await createStaticSession({ projectId: 'proj-2', name: 'Project 2 Review', reviewType: 'code_review', configJson: {} });

      const result = await listStaticSessions('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Project 1 Review');
    });
  });

  describe('getStaticSession', () => {
    it('should return session by project and session id', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'My Review', reviewType: 'requirement_review', configJson: { key: 'value' } });

      const result = await getStaticSession('proj-1', created.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.name).toBe('My Review');
      expect(result!.configJson).toBe(JSON.stringify({ key: 'value' }));
    });

    it('should return null for non-existent session', async () => {
      const result = await getStaticSession('proj-1', 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when session exists but under different project', async () => {
      insertTestProject(db, 'proj-2');
      const created = await createStaticSession({ projectId: 'proj-1', name: 'My Review', reviewType: 'requirement_review', configJson: {} });

      const result = await getStaticSession('proj-2', created.id);
      expect(result).toBeNull();
    });
  });

  describe('getActiveStaticSession', () => {
    it('should return queued session', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Queued', reviewType: 'requirement_review', configJson: {} });

      const result = await getActiveStaticSession('proj-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
    });

    it('should return running session', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Running', reviewType: 'requirement_review', configJson: {} });
      await updateStaticSessionStatus(created.id, 'running', '', '');

      const result = await getActiveStaticSession('proj-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('running');
    });

    it('should return null when no active session exists', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Done', reviewType: 'requirement_review', configJson: {} });
      await updateStaticSessionStatus(created.id, 'success', 'Done', '');

      const result = await getActiveStaticSession('proj-1');
      expect(result).toBeNull();
    });

    it('should return null for cancelled sessions', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Cancelled', reviewType: 'requirement_review', configJson: {} });
      await updateStaticSessionStatus(created.id, 'cancelled', '', 'User cancelled');

      const result = await getActiveStaticSession('proj-1');
      expect(result).toBeNull();
    });
  });

  describe('updateStaticSessionStatus', () => {
    it('should update status to success with summary', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      await updateStaticSessionStatus(created.id, 'success', 'All done', '');

      const result = await getStaticSession('proj-1', created.id);
      expect(result!.status).toBe('success');
      expect(result!.finalSummary).toBe('All done');
      expect(result!.failureReason).toBe('');
    });

    it('should update status to failure with reason', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      await updateStaticSessionStatus(created.id, 'failure', '', 'API error');

      const result = await getStaticSession('proj-1', created.id);
      expect(result!.status).toBe('failure');
      expect(result!.finalSummary).toBe('');
      expect(result!.failureReason).toBe('API error');
    });

    it('should update the updated_at timestamp', async () => {
      const created = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const originalUpdatedAt = created.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));
      await updateStaticSessionStatus(created.id, 'running', '', '');

      const result = await getStaticSession('proj-1', created.id);
      expect(result!.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('createFinding', () => {
    it('should create a finding with all fields', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const finding = await createFinding('proj-1', session.id, {
        severity: 'high',
        title: 'Unclear requirement',
        description: 'The requirement is ambiguous',
        category: 'unclear_requirement',
        evidenceText: 'Section 2.1 says...',
        recommendation: 'Clarify the language',
        confidence: 'high',
      });

      expect(finding.id).toBeDefined();
      expect(finding.projectId).toBe('proj-1');
      expect(finding.sessionId).toBe(session.id);
      expect(finding.source).toBe('static');
      expect(finding.severity).toBe('high');
      expect(finding.title).toBe('Unclear requirement');
      expect(finding.description).toBe('The requirement is ambiguous');
      expect(finding.category).toBe('unclear_requirement');
      expect(finding.evidenceText).toBe('Section 2.1 says...');
      expect(finding.recommendation).toBe('Clarify the language');
      expect(finding.confidence).toBe('high');
      expect(finding.status).toBe('new');
    });

    it('should create finding with optional artifactId', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      insertTestArtifact(db, 'art-1', 'proj-1');
      const finding = await createFinding('proj-1', session.id, {
        severity: 'medium',
        title: 'Test',
        description: 'Desc',
        category: 'test',
        evidenceText: '',
        recommendation: '',
        confidence: 'medium',
        artifactId: 'art-1',
      });

      expect(finding.artifactId).toBe('art-1');
    });

    it('should persist to database', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const finding = await createFinding('proj-1', session.id, {
        severity: 'low',
        title: 'Persisted',
        description: 'Should persist',
        category: 'test',
        evidenceText: '',
        recommendation: '',
        confidence: 'low',
      });

      const findings = await listStaticFindings('proj-1', session.id);
      expect(findings).toHaveLength(1);
      expect(findings[0].id).toBe(finding.id);
    });
  });

  describe('listStaticFindings', () => {
    it('should return findings for a specific session', async () => {
      const session1 = await createStaticSession({ projectId: 'proj-1', name: 'Review 1', reviewType: 'requirement_review', configJson: {} });
      const session2 = await createStaticSession({ projectId: 'proj-1', name: 'Review 2', reviewType: 'code_review', configJson: {} });
      await createFinding('proj-1', session1.id, {
        severity: 'high', title: 'Finding 1', description: 'Desc 1',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });
      await createFinding('proj-1', session2.id, {
        severity: 'low', title: 'Finding 2', description: 'Desc 2',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'low',
      });

      const result = await listStaticFindings('proj-1', session1.id);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Finding 1');
    });

    it('should return empty array when no findings exist', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const result = await listStaticFindings('proj-1', session.id);
      expect(result).toEqual([]);
    });
  });

  describe('listAllFindings', () => {
    it('should return all findings across sessions for a project', async () => {
      const session1 = await createStaticSession({ projectId: 'proj-1', name: 'Review 1', reviewType: 'requirement_review', configJson: {} });
      const session2 = await createStaticSession({ projectId: 'proj-1', name: 'Review 2', reviewType: 'code_review', configJson: {} });
      await createFinding('proj-1', session1.id, {
        severity: 'high', title: 'Finding 1', description: 'Desc 1',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });
      await createFinding('proj-1', session2.id, {
        severity: 'low', title: 'Finding 2', description: 'Desc 2',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'low',
      });

      const result = await listAllFindings('proj-1');
      expect(result).toHaveLength(2);
    });

    it('should not return findings from other projects', async () => {
      insertTestProject(db, 'proj-2');
      const session1 = await createStaticSession({ projectId: 'proj-1', name: 'Review 1', reviewType: 'requirement_review', configJson: {} });
      const session2 = await createStaticSession({ projectId: 'proj-2', name: 'Review 2', reviewType: 'code_review', configJson: {} });
      await createFinding('proj-1', session1.id, {
        severity: 'high', title: 'Finding 1', description: 'Desc 1',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });
      await createFinding('proj-2', session2.id, {
        severity: 'low', title: 'Finding 2', description: 'Desc 2',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'low',
      });

      const result = await listAllFindings('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Finding 1');
    });
  });

  describe('updateFindingStatus', () => {
    it('should update finding status to accepted', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const finding = await createFinding('proj-1', session.id, {
        severity: 'high', title: 'Test', description: 'Desc',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });

      await updateFindingStatus(finding.id, 'accepted');

      const findings = await listStaticFindings('proj-1', session.id);
      expect(findings[0].status).toBe('accepted');
    });

    it('should update finding status to dismissed', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const finding = await createFinding('proj-1', session.id, {
        severity: 'high', title: 'Test', description: 'Desc',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });

      await updateFindingStatus(finding.id, 'dismissed');

      const findings = await listStaticFindings('proj-1', session.id);
      expect(findings[0].status).toBe('dismissed');
    });

    it('should update finding status to fixed', async () => {
      const session = await createStaticSession({ projectId: 'proj-1', name: 'Review', reviewType: 'requirement_review', configJson: {} });
      const finding = await createFinding('proj-1', session.id, {
        severity: 'high', title: 'Test', description: 'Desc',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });

      await updateFindingStatus(finding.id, 'fixed');

      const findings = await listStaticFindings('proj-1', session.id);
      expect(findings[0].status).toBe('fixed');
    });
  });

  describe('listActiveStaticSessions', () => {
    it('returns only queued and running sessions across all projects', async () => {
      await createStaticSession({ projectId: 'proj-1', name: 'A', reviewType: 'requirement_review', configJson: {} });
      await createStaticSession({ projectId: 'proj-2', name: 'B', reviewType: 'code_review', configJson: {} });
      await createStaticSession({ projectId: 'proj-1', name: 'Done', reviewType: 'requirement_review', configJson: {} });
      const doneId = (await listStaticSessions('proj-1')).find(s => s.name === 'Done')!.id;
      await updateStaticSessionStatus(doneId, 'success', '', '');

      const active = await listActiveStaticSessions();
      expect(active.map(s => s.name).sort()).toEqual(['A', 'B']);
    });

    it('orders active sessions by created_at DESC (newest first)', async () => {
      await createStaticSession({ projectId: 'proj-1', name: 'Older', reviewType: 'requirement_review', configJson: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      await createStaticSession({ projectId: 'proj-1', name: 'Newer', reviewType: 'requirement_review', configJson: {} });

      const active = await listActiveStaticSessions();
      expect(active[0].name).toBe('Newer');
      expect(active[1].name).toBe('Older');
    });
  });
});
