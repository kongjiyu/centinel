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

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[server] error:', e);
    json(res, 500, { error: 'Internal server error' });
  }
});

server.listen(Number(PORT), HOST, () => {
  console.error(`[server] Centinel sidecar listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
