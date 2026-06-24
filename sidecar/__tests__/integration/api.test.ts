import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { createTestDb, closeTestDb, insertTestProject } from '../helpers/testHelpers';
import { setTestDb, clearTestDb } from '../../src/db';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the AI and review modules to avoid real API calls
vi.mock('../../src/aiClient.js', () => ({
  testAiProvider: vi.fn().mockResolvedValue({ status: 'pass', message: 'ok' }),
}));

vi.mock('../../src/staticReview.js', () => ({
  runStaticReview: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/dynamicRunner.js', () => ({
  runDynamicSession: vi.fn().mockResolvedValue(undefined),
  cancelSession: vi.fn(),
}));

vi.mock('../../src/dynamicSessions.js', () => ({
  createDynamicSession: vi.fn().mockResolvedValue({ id: 'ds-1', status: 'queued' }),
  listDynamicSessions: vi.fn().mockResolvedValue([]),
  getDynamicSession: vi.fn().mockResolvedValue(null),
  getActiveSession: vi.fn().mockResolvedValue(null),
  listDynamicEvidence: vi.fn().mockResolvedValue([]),
  updateDynamicSessionStatus: vi.fn().mockResolvedValue(undefined),
}));

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

async function req(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const url = `${baseUrl}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

describe('API Integration', () => {
  beforeEach(async () => {
    const db = await createTestDb();
    setTestDb(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-api-test-'));
    insertTestProject(db, 'proj-1', tmpDir);

    // Dynamically import the server to start it fresh each test
    // We need to import the modules that the server uses
    const { listProjects, getProject, createProject, deleteProject } = await import('../../src/projects');
    const { getAiSettings, updateAiSetting, validateUpdateRequest } = await import('../../src/settings');
    const { listArtifacts, getArtifact, createArtifact, deleteArtifact, importArtifactsFromRepo, detectArtifactType } = await import('../../src/artifacts');
    const { createStaticSession, listStaticSessions, getStaticSession, getActiveStaticSession, listStaticFindings, listAllFindings, updateFindingStatus, updateStaticSessionStatus } = await import('../../src/staticSessions');
    const { exportProjectReport, exportSessionReport } = await import('../../src/reportExport');

    server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      const parseBody = (): Promise<Record<string, unknown>> => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve({}); }
        });
      });

      const url = req.url ?? '';

      try {
        // Health
        if (req.method === 'GET' && url === '/health') return json(200, { status: 'ok' });

        // Projects
        if (req.method === 'GET' && url === '/projects') return json(200, await listProjects());

        if (req.method === 'POST' && url === '/projects') {
          const body = await parseBody();
          return json(201, await createProject(body.name as string, body.description as string, body.workspacePath as string));
        }

        // Artifacts
        const artMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/artifacts$/);
        if (artMatch && req.method === 'GET') return json(200, await listArtifacts(artMatch[1]));

        if (artMatch && req.method === 'POST') {
          const body = await parseBody();
          const buf = Buffer.from(body.content as string, 'base64');
          const type = (body.type as string) || detectArtifactType(body.fileName as string);
          return json(201, await createArtifact(artMatch[1], type as any, body.fileName as string, buf));
        }

        const artIdMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/artifacts\/([a-zA-Z0-9_-]+)$/);
        if (artIdMatch && req.method === 'DELETE') {
          const deleted = await deleteArtifact(artIdMatch[2]);
          return deleted ? json(200, { ok: true }) : json(404, { error: 'Not found' });
        }

        // Static sessions
        const ssMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/static-sessions$/);
        if (ssMatch && req.method === 'GET') return json(200, await listStaticSessions(ssMatch[1]));

        if (ssMatch && req.method === 'POST') {
          const body = await parseBody();
          const session = await createStaticSession(ssMatch[1], body.name as string, 'code_review', { instructions: body.instructions ?? '' });
          return json(201, session);
        }

        const ssIdMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/static-sessions\/([a-zA-Z0-9_-]+)$/);
        if (ssIdMatch && req.method === 'GET') {
          const session = await getStaticSession(ssIdMatch[1], ssIdMatch[2]);
          return session ? json(200, session) : json(404, { error: 'Not found' });
        }

        const sfMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/static-sessions\/([a-zA-Z0-9_-]+)\/findings$/);
        if (sfMatch && req.method === 'GET') return json(200, await listStaticFindings(sfMatch[1], sfMatch[2]));

        // Findings
        const fMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/findings$/);
        if (fMatch && req.method === 'GET') return json(200, await listAllFindings(fMatch[1]));

        const fIdMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/findings\/([a-zA-Z0-9_-]+)$/);
        if (fIdMatch && req.method === 'PUT') {
          const body = await parseBody();
          const status = typeof body.status === 'string' ? body.status : '';
          const validStatuses = ['new', 'accepted', 'dismissed', 'fixed'];
          if (!validStatuses.includes(status)) return json(400, { error: 'Invalid status' });
          await updateFindingStatus(fIdMatch[2], status as any);
          return json(200, { ok: true });
        }

        // Reports
        const rMatch = url.match(/^\/projects\/([a-zA-Z0-9_-]+)\/reports\/export$/);
        if (rMatch && req.method === 'POST') {
          const reportPath = await exportProjectReport(rMatch[1]);
          return json(200, { reportPath });
        }

        json(404, { error: 'Not found' });
      } catch (e) {
        json(500, { error: 'Internal server error' });
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    server.close();
    clearTestDb();
    closeTestDb();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('GET /health', () => {
    it('should return ok', async () => {
      const { status, data } = await req('GET', '/health');
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
    });
  });

  describe('Projects', () => {
    it('GET /projects should list projects', async () => {
      const { status, data } = await req('GET', '/projects');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /projects should create a project', async () => {
      const newTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-new-'));
      const { status, data } = await req('POST', '/projects', {
        name: 'New Project',
        description: 'A new project',
        workspacePath: newTmpDir,
      });
      expect(status).toBe(201);
      expect(data.name).toBe('New Project');
      fs.rmSync(newTmpDir, { recursive: true, force: true });
    });
  });

  describe('Artifacts', () => {
    it('GET /projects/:id/artifacts should list artifacts', async () => {
      const { status, data } = await req('GET', '/projects/proj-1/artifacts');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('POST /projects/:id/artifacts should upload an artifact', async () => {
      const content = Buffer.from('Hello World').toString('base64');
      const { status, data } = await req('POST', '/projects/proj-1/artifacts', {
        fileName: 'test.md',
        content,
        type: 'requirement',
      });
      expect(status).toBe(201);
      expect(data.fileName).toBe('test.md');
      expect(data.type).toBe('requirement');
      expect(data.id).toBeDefined();
    });

    it('POST /projects/:id/artifacts should auto-detect type', async () => {
      const content = Buffer.from('const x = 1;').toString('base64');
      const { status, data } = await req('POST', '/projects/proj-1/artifacts', {
        fileName: 'app.ts',
        content,
      });
      expect(status).toBe(201);
      expect(data.type).toBe('source_code');
    });

    it('DELETE /projects/:id/artifacts/:aid should delete artifact', async () => {
      const content = Buffer.from('test').toString('base64');
      const { data: created } = await req('POST', '/projects/proj-1/artifacts', {
        fileName: 'to-delete.txt',
        content,
      });

      const { status } = await req('DELETE', `/projects/proj-1/artifacts/${created.id}`);
      expect(status).toBe(200);

      const { data: list } = await req('GET', '/projects/proj-1/artifacts');
      expect(list.find((a: any) => a.id === created.id)).toBeUndefined();
    });

    it('DELETE should return 404 for non-existent artifact', async () => {
      const { status } = await req('DELETE', '/projects/proj-1/artifacts/nonexistent');
      expect(status).toBe(404);
    });
  });

  describe('Static Sessions', () => {
    it('GET /projects/:id/static-sessions should list sessions', async () => {
      const { status, data } = await req('GET', '/projects/proj-1/static-sessions');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('POST /projects/:id/static-sessions should create a session', async () => {
      // First create an artifact to reference
      const content = Buffer.from('# Requirements').toString('base64');
      const { data: artifact } = await req('POST', '/projects/proj-1/artifacts', {
        fileName: 'req.md',
        content,
        type: 'requirement',
      });

      const { status, data } = await req('POST', '/projects/proj-1/static-sessions', {
        name: 'Test Review',
        instructions: 'Focus on completeness',
      });
      expect(status).toBe(201);
      expect(data.name).toBe('Test Review');
      expect(data.reviewType).toBe('code_review');
      expect(data.status).toBe('queued');
    });

    it('GET /projects/:id/static-sessions/:sid should get session', async () => {
      const content = Buffer.from('# Requirements').toString('base64');
      const { data: artifact } = await req('POST', '/projects/proj-1/artifacts', {
        fileName: 'req.md',
        content,
        type: 'requirement',
      });
      const { data: created } = await req('POST', '/projects/proj-1/static-sessions', {
        name: 'My Review',
        instructions: 'Focus on clarity',
      });

      const { status, data } = await req('GET', `/projects/proj-1/static-sessions/${created.id}`);
      expect(status).toBe(200);
      expect(data.id).toBe(created.id);
      expect(data.name).toBe('My Review');
    });

    it('GET /projects/:id/static-sessions/:sid should return 404 for non-existent', async () => {
      const { status } = await req('GET', '/projects/proj-1/static-sessions/nonexistent');
      expect(status).toBe(404);
    });

    it('GET /projects/:id/static-sessions/:sid/findings should list findings', async () => {
      const content = Buffer.from('# Requirements').toString('base64');
      const { data: artifact } = await req('POST', '/projects/proj-1/artifacts', {
        fileName: 'req.md',
        content,
        type: 'requirement',
      });
      const { data: session } = await req('POST', '/projects/proj-1/static-sessions', {
        name: 'Review',
        instructions: '',
      });

      const { status, data } = await req('GET', `/projects/proj-1/static-sessions/${session.id}/findings`);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Findings', () => {
    it('GET /projects/:id/findings should list all findings', async () => {
      const { status, data } = await req('GET', '/projects/proj-1/findings');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('PUT /projects/:id/findings/:fid should update finding status', async () => {
      // Create a session and finding via direct DB for this test
      const { createStaticSession: createSS, createFinding: createF } = await import('../../src/staticSessions');
      const session = await createSS('proj-1', 'Review', 'requirement_review', {});
      const finding = await createF('proj-1', session.id, {
        severity: 'high', title: 'Test', description: 'Desc',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });

      const { status } = await req('PUT', `/projects/proj-1/findings/${finding.id}`, { status: 'accepted' });
      expect(status).toBe(200);

      // Verify via direct DB query
      const { listAllFindings } = await import('../../src/staticSessions');
      const findings = await listAllFindings('proj-1');
      expect(findings[0].status).toBe('accepted');
    });

    it('PUT should reject invalid status', async () => {
      const { createStaticSession: createSS, createFinding: createF } = await import('../../src/staticSessions');
      const session = await createSS('proj-1', 'Review', 'requirement_review', {});
      const finding = await createF('proj-1', session.id, {
        severity: 'high', title: 'Test', description: 'Desc',
        category: 'test', evidenceText: '', recommendation: '', confidence: 'high',
      });

      const { status, data } = await req('PUT', `/projects/proj-1/findings/${finding.id}`, { status: 'INVALID' });
      expect(status).toBe(400);
    });
  });

  describe('Reports', () => {
    it('POST /projects/:id/reports/export should generate report', async () => {
      const { status, data } = await req('POST', '/projects/proj-1/reports/export');
      expect(status).toBe(200);
      expect(data.reportPath).toBeDefined();
      expect(fs.existsSync(data.reportPath)).toBe(true);
      fs.unlinkSync(data.reportPath);
    });
  });
});
