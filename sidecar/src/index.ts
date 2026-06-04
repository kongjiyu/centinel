#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { config as readEnv } from 'dotenv';
import { listProjects, getProject, createProject, deleteProject } from './projects';
import { getAiSettings, updateAiSetting, validateUpdateRequest } from './settings';
import { testAiProvider } from './aiClient';
import {
  createDynamicSession,
  listDynamicSessions,
  getDynamicSession,
  getActiveSession,
  listDynamicEvidence,
  updateDynamicSessionStatus,
} from './dynamicSessions';
import { runDynamicSession, cancelSession } from './dynamicRunner';
import {
  listArtifacts,
  getArtifact,
  createArtifact,
  deleteArtifact,
  importArtifactsFromRepo,
  initSyncDb,
  detectArtifactType,
} from './artifacts';
import {
  createStaticSession,
  listStaticSessions,
  getStaticSession,
  getActiveStaticSession,
  listStaticFindings,
  listAllFindings,
  updateFindingStatus,
  updateStaticSessionStatus,
  updateStaticSessionProgress,
  listReviewArtifacts,
} from './staticSessions';
import { runStaticReview } from './staticReview';
import { exportProjectReport, exportSessionReport } from './reportExport';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
readEnv({ path: path.resolve(__dirname, '../../.env') });

const evidenceDir = path.resolve(__dirname, '../../evidence/phase-0');
const dataDir = path.resolve(__dirname, '../../data');

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Route matchers
function matchProjectId(url: string): string | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)$/);
  return m ? m[1] : null;
}

function matchDynamicSessions(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions$/);
  return m ? { projectId: m[1] } : null;
}

function matchDynamicSession(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchDynamicEvidence(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)\/evidence$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchDynamicCancel(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)\/cancel$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchArtifacts(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts$/);
  return m ? { projectId: m[1] } : null;
}

function matchArtifact(url: string): { projectId: string; artifactId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], artifactId: m[2] } : null;
}

function matchImportRepo(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/artifacts\/import-repo$/);
  return m ? { projectId: m[1] } : null;
}

function matchStaticSessions(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions$/);
  return m ? { projectId: m[1] } : null;
}

function matchStaticSession(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticFindings(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/findings$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchStaticCancel(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/cancel$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchFindings(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/findings$/);
  return m ? { projectId: m[1] } : null;
}

function matchFinding(url: string): { projectId: string; findingId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/findings\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], findingId: m[2] } : null;
}

function matchReportExport(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/reports\/export$/);
  return m ? { projectId: m[1] } : null;
}

function matchSessionReportExport(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/static-sessions\/([a-f0-9-]+)\/report$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchReviewArtifacts(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/artifacts$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

const PORT = 37701;
const HOST = 'localhost';

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? '';

  try {
    // Health
    if (req.method === 'GET' && url === '/health') {
      return json(res, 200, { status: 'ok' });
    }

    // AI Settings
    if (req.method === 'GET' && url === '/settings/ai') {
      return json(res, 200, await getAiSettings());
    }

    if (req.method === 'PUT' && (url === '/settings/ai/text' || url === '/settings/ai/vision')) {
      const id = url === '/settings/ai/text' ? 'text' : 'vision';
      const body = await parseJsonBody(req);
      const validationError = validateUpdateRequest(body);
      if (validationError) return json(res, 400, validationError);
      const updated = await updateAiSetting(id, {
        compatibilityMode: body.compatibilityMode as 'openai' | 'anthropic',
        apiKey: (body.apiKey as string).trim(),
        baseUrl: (body.baseUrl as string).trim(),
        model: (body.model as string).trim(),
      });
      return json(res, 200, updated);
    }

    if (req.method === 'POST' && (url === '/settings/ai/text/test' || url === '/settings/ai/vision/test')) {
      const id = url === '/settings/ai/text/test' ? 'text' : 'vision';
      const screenshotPath = path.join(evidenceDir, 'playwright-screenshot.png');
      return json(res, 200, await testAiProvider(id, id === 'vision' ? screenshotPath : undefined));
    }

    // Projects
    if (req.method === 'GET' && url === '/projects') {
      return json(res, 200, await listProjects());
    }

    if (req.method === 'POST' && url === '/projects') {
      const body = await parseJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
      if (!name) return json(res, 400, { error: 'Project name is required' });
      if (name.length > 80) return json(res, 400, { error: 'Project name must be 80 characters or less' });
      if (description.length > 500) return json(res, 400, { error: 'Description must be 500 characters or less' });
      if (!workspacePath) return json(res, 400, { error: 'Workspace path is required' });
      return json(res, 201, await createProject(name, description, workspacePath));
    }

    // Dynamic sessions - list
    const dsMatch = matchDynamicSessions(url);
    if (dsMatch && req.method === 'GET') {
      return json(res, 200, await listDynamicSessions(dsMatch.projectId));
    }

    // Dynamic sessions - create
    if (dsMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
      const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
      const missionType = body.missionType === 'smoke' ? 'smoke' : 'user_journey';
      const maxSteps = typeof body.maxSteps === 'number' ? body.maxSteps : 15;

      if (!targetUrl) return json(res, 400, { error: 'targetUrl is required' });
      try { new URL(targetUrl); } catch { return json(res, 400, { error: 'targetUrl must be a valid URL' }); }
      if (!goal) return json(res, 400, { error: 'goal is required' });

      const active = await getActiveSession(dsMatch.projectId);
      if (active) return json(res, 409, { error: 'A dynamic session is already running' });

      const project = await getProject(dsMatch.projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });

      const session = await createDynamicSession(dsMatch.projectId, targetUrl, goal, missionType, maxSteps);

      // Run asynchronously
      runDynamicSession(session, project.workspacePath).catch(err => {
        console.error('[runner] error:', err);
        updateDynamicSessionStatus(session.id, 'failure', '', String(err)).catch(() => {});
      });

      return json(res, 201, session);
    }

    // Dynamic session - cancel (must be before get)
    const dcMatch = matchDynamicCancel(url);
    if (dcMatch && req.method === 'POST') {
      const session = await getDynamicSession(dcMatch.projectId, dcMatch.sessionId);
      if (!session) return json(res, 404, { error: 'Session not found' });
      if (session.status !== 'running' && session.status !== 'queued') {
        return json(res, 400, { error: 'Session is not active' });
      }
      cancelSession(dcMatch.sessionId);
      await updateDynamicSessionStatus(dcMatch.sessionId, 'cancelled', '', 'Cancelled by user');
      return json(res, 200, { ok: true });
    }

    // Dynamic session - evidence
    const deMatch = matchDynamicEvidence(url);
    if (deMatch && req.method === 'GET') {
      return json(res, 200, await listDynamicEvidence(deMatch.projectId, deMatch.sessionId));
    }

    // Dynamic session - get
    const dMatch = matchDynamicSession(url);
    if (dMatch && req.method === 'GET') {
      const session = await getDynamicSession(dMatch.projectId, dMatch.sessionId);
      if (!session) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, session);
    }

    // Project get
    const projectId = matchProjectId(url);
    if (projectId && req.method === 'GET') {
      const project = await getProject(projectId);
      if (!project) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, project);
    }

    // Project delete
    if (projectId && req.method === 'DELETE') {
      const deleted = await deleteProject(projectId);
      if (!deleted) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, { ok: true });
    }

    // === Artifacts ===

    // Import artifacts from repo path
    const importMatch = matchImportRepo(url);
    if (importMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const repoPath = typeof body.repoPath === 'string' ? body.repoPath.trim() : '';
      if (!repoPath) return json(res, 400, { error: 'repoPath is required' });
      try {
        const result = await importArtifactsFromRepo(importMatch.projectId, repoPath);
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    // List artifacts
    const artMatch = matchArtifacts(url);
    if (artMatch && req.method === 'GET') {
      return json(res, 200, await listArtifacts(artMatch.projectId));
    }

    // Upload artifact
    if (artMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      const content = typeof body.content === 'string' ? body.content : '';
      const type = typeof body.type === 'string' ? body.type.trim() : '';
      if (!fileName) return json(res, 400, { error: 'fileName is required' });
      if (!content) return json(res, 400, { error: 'content is required (base64 encoded)' });
      const artifactType = type || detectArtifactType(fileName);
      const buffer = Buffer.from(content, 'base64');
      const artifact = await createArtifact(artMatch.projectId, artifactType as any, fileName, buffer);
      return json(res, 201, artifact);
    }

    // Delete artifact
    const artIdMatch = matchArtifact(url);
    if (artIdMatch && req.method === 'DELETE') {
      const deleted = await deleteArtifact(artIdMatch.artifactId);
      if (!deleted) return json(res, 404, { error: 'Artifact not found' });
      return json(res, 200, { ok: true });
    }

    // === Static Sessions ===

    // List static sessions
    const ssMatch = matchStaticSessions(url);
    if (ssMatch && req.method === 'GET') {
      return json(res, 200, await listStaticSessions(ssMatch.projectId));
    }

    // Create and run static session
    if (ssMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const reviewType = typeof body.reviewType === 'string' ? body.reviewType.trim() : '';
      const artifactIds = Array.isArray(body.artifactIds) ? body.artifactIds : [];
      const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';

      if (!name) return json(res, 400, { error: 'name is required' });
      const validTypes = ['requirement_review', 'code_review', 'requirement_to_code_traceability', 'cross_artifact_consistency'];
      if (!validTypes.includes(reviewType)) return json(res, 400, { error: 'Invalid reviewType' });

      const activeSession = await getActiveStaticSession(ssMatch.projectId);
      if (activeSession) return json(res, 409, { error: 'A static review session is already running' });

      // Load artifacts — use all if none specified
      let artifacts = [];
      if (artifactIds.length > 0) {
        for (const aid of artifactIds) {
          const a = await getArtifact(aid);
          if (!a) return json(res, 400, { error: `Artifact ${aid} not found` });
          artifacts.push(a);
        }
      } else {
        artifacts = await listArtifacts(ssMatch.projectId);
      }

      const session = await createStaticSession(ssMatch.projectId, name, reviewType as any, { artifactIds }, remarks);

      // Run review asynchronously
      runStaticReview(session, artifacts, async (progress) => {
        await updateStaticSessionProgress(session.id, progress);
      }).catch(err => {
        console.error('[static-review] error:', err);
      });

      return json(res, 201, session);
    }

    // Static session - cancel (must be before get)
    const scMatch = matchStaticCancel(url);
    if (scMatch && req.method === 'POST') {
      const session = await getStaticSession(scMatch.projectId, scMatch.sessionId);
      if (!session) return json(res, 404, { error: 'Session not found' });
      if (session.status !== 'running' && session.status !== 'queued') {
        return json(res, 400, { error: 'Session is not active' });
      }
      await updateStaticSessionStatus(scMatch.sessionId, 'cancelled', '', 'Cancelled by user');
      return json(res, 200, { ok: true });
    }

    // Static session - findings
    const sfMatch = matchStaticFindings(url);
    if (sfMatch && req.method === 'GET') {
      return json(res, 200, await listStaticFindings(sfMatch.projectId, sfMatch.sessionId));
    }

    // Static session - report export
    const srMatch = matchSessionReportExport(url);
    if (srMatch && req.method === 'POST') {
      try {
        const reportPath = await exportSessionReport(srMatch.projectId, srMatch.sessionId);
        return json(res, 200, { reportPath });
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    // Static session - review artifacts
    const raMatch = matchReviewArtifacts(url);
    if (raMatch && req.method === 'GET') {
      return json(res, 200, await listReviewArtifacts(raMatch.projectId, raMatch.sessionId));
    }

    // Static session - get
    const ssIdMatch = matchStaticSession(url);
    if (ssIdMatch && req.method === 'GET') {
      const session = await getStaticSession(ssIdMatch.projectId, ssIdMatch.sessionId);
      if (!session) return json(res, 404, { error: 'Session not found' });
      return json(res, 200, session);
    }

    // === Unified Findings ===

    // List all findings for project
    const fMatch = matchFindings(url);
    if (fMatch && req.method === 'GET') {
      return json(res, 200, await listAllFindings(fMatch.projectId));
    }

    // Update finding status
    const fIdMatch = matchFinding(url);
    if (fIdMatch && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const status = typeof body.status === 'string' ? body.status : '';
      const validStatuses = ['new', 'accepted', 'dismissed', 'fixed'];
      if (!validStatuses.includes(status)) return json(res, 400, { error: 'Invalid status' });
      await updateFindingStatus(fIdMatch.findingId, status as any);
      return json(res, 200, { ok: true });
    }

    // === Reports ===

    // Export project report
    const rMatch = matchReportExport(url);
    if (rMatch && req.method === 'POST') {
      try {
        const reportPath = await exportProjectReport(rMatch.projectId);
        return json(res, 200, { reportPath });
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[server] error:', e);
    json(res, 500, { error: 'Internal server error' });
  }
});

// Initialize sync db reference for repo import
initSyncDb().catch(err => {
  console.error('[server] Failed to init sync db:', err);
});

server.listen(Number(PORT), HOST, () => {
  console.error(`[server] Centinel sidecar listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
