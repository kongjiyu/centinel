#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { config as readEnv } from 'dotenv';
import { listProjects, getProject, createProject, deleteProject } from './projects';
import { getAiSettings, getAiSetting, updateAiSetting, validateUpdateRequest } from './settings';
import { testAiProvider } from './aiClient';

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

function extractProjectId(url: string): string | null {
  const match = url.match(/^\/projects\/([a-f0-9-]+)$/);
  return match ? match[1] : null;
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
      const settings = await getAiSettings();
      return json(res, 200, settings);
    }

    // Update AI setting (text or vision)
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

    // Test AI provider
    if (req.method === 'POST' && (url === '/settings/ai/text/test' || url === '/settings/ai/vision/test')) {
      const id = url === '/settings/ai/text/test' ? 'text' : 'vision';
      const screenshotPath = path.join(evidenceDir, 'playwright-screenshot.png');
      const result = await testAiProvider(id, id === 'vision' ? screenshotPath : undefined);
      return json(res, 200, result);
    }

    // Projects list
    if (req.method === 'GET' && url === '/projects') {
      const projects = await listProjects();
      return json(res, 200, projects);
    }

    // Project create
    if (req.method === 'POST' && url === '/projects') {
      const body = await parseJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';

      if (!name) return json(res, 400, { error: 'Project name is required' });
      if (name.length > 80) return json(res, 400, { error: 'Project name must be 80 characters or less' });
      if (description.length > 500) return json(res, 400, { error: 'Description must be 500 characters or less' });
      if (!workspacePath) return json(res, 400, { error: 'Workspace path is required' });

      const project = await createProject(name, description, workspacePath);
      return json(res, 201, project);
    }

    // Project get
    const projectId = extractProjectId(url);
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
