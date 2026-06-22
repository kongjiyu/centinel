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
  isEvidenceFilePath,
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
  listActiveStaticSessions,
  listStaticFindings,
  listAllFindings,
  updateFindingStatus,
  updateStaticSessionStatus,
  updateStaticSessionProgress,
  listReviewArtifacts,
} from './staticSessions';
import { runStaticReview } from './staticReview';
import { exportProjectReport, exportSessionReport, exportDynamicSessionReport } from './reportExport';
import { indexProject, getIndexedFiles, getFileSymbols, getDependencies, getDependents } from './repoIndex';
import { retrieveContext, searchByKeyword, getRelatedFiles } from './contextRetrieval';
import { runStaticAnalysis as runStaticEngine, getStaticFindings } from './staticEngine';
import {
  createRequirement,
  listRequirements,
  getRequirement,
  updateRequirement,
  deleteRequirement,
  mapRequirementToCode,
  getRequirementMappings,
} from './requirements';

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

function matchStaticActive(url: string): boolean {
  return url === '/static-sessions/active';
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

function matchDynamicSessionReportExport(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/dynamic-sessions\/([a-f0-9-]+)\/report$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchReviewArtifacts(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([^/]+)\/static-sessions\/([^/]+)\/artifacts$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchRequirements(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements$/);
  return m ? { projectId: m[1] } : null;
}

function matchRequirement(url: string): { projectId: string; reqId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], reqId: m[2] } : null;
}

function matchRequirementMap(url: string): { projectId: string; reqId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements\/([a-f0-9-]+)\/map$/);
  return m ? { projectId: m[1], reqId: m[2] } : null;
}

function matchRequirementMappings(url: string): { projectId: string; reqId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/requirements\/([a-f0-9-]+)\/mappings$/);
  return m ? { projectId: m[1], reqId: m[2] } : null;
}

function matchRepoIndex(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/index$/);
  return m ? { projectId: m[1] } : null;
}

function matchRepoIndexStatus(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/index\/status$/);
  return m ? { projectId: m[1] } : null;
}

function matchRepoIndexFile(url: string): { projectId: string; fileId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/index\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], fileId: m[2] } : null;
}

function matchRepoSearch(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/index\/search$/);
  return m ? { projectId: m[1] } : null;
}

function matchStaticAnalysis(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/analysis$/);
  return m ? { projectId: m[1] } : null;
}

function matchStaticAnalysisSession(url: string): { projectId: string; sessionId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/analysis\/session\/([a-f0-9-]+)$/);
  return m ? { projectId: m[1], sessionId: m[2] } : null;
}

function matchContextRetrieval(url: string): { projectId: string } | null {
  const m = url.match(/^\/projects\/([a-f0-9-]+)\/retrieve$/);
  return m ? { projectId: m[1] } : null;
}

const PORT = 37701;
const HOST = 'localhost';

// Track indexing status per project
const indexStatus = new Map<string, { status: 'idle' | 'indexing' | 'done' | 'error'; fileCount: number; error?: string }>();

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
        provider: body.provider as 'mimo' | 'gemini' | 'custom',
        apiFormat: body.apiFormat as 'openai-compatible' | 'anthropic-compatible' | 'google-native',
        apiKey: (body.apiKey as string).trim(),
        baseUrl: (body.baseUrl as string).trim(),
        model: (body.model as string).trim(),
      });
      return json(res, 200, updated);
    }

    if (req.method === 'POST' && (url === '/settings/ai/text/test' || url === '/settings/ai/vision/test')) {
      const id = url === '/settings/ai/text/test' ? 'text' : 'vision';
      const screenshotPath = path.join(evidenceDir, 'playwright-screenshot.png');
      // Optional body of form-state overrides so Test reflects what the user
      // just typed (not just what's persisted). Empty body / no body is fine —
      // we fall through to using the saved setting.
      let overrides: Parameters<typeof testAiProvider>[2] = {};
      try {
        const raw = await parseJsonBody(req);
        if (raw && typeof raw === 'object') overrides = raw as Parameters<typeof testAiProvider>[2];
      } catch {
        // Empty or malformed body — use the saved setting.
      }
      return json(res, 200, await testAiProvider(id, id === 'vision' ? screenshotPath : undefined, overrides));
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
      const maxSteps = Math.min(25, Math.max(1, typeof body.maxSteps === 'number' ? body.maxSteps : 15));

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

    // Dynamic session - report export
    const drMatch = matchDynamicSessionReportExport(url);
    if (drMatch && req.method === 'POST') {
      try {
        const result = await exportDynamicSessionReport(drMatch.projectId, drMatch.sessionId);
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
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
        // Trigger indexing in background after import
        const projectId = importMatch.projectId;
        indexStatus.set(projectId, { status: 'indexing', fileCount: result.imported.length });
        listArtifacts(projectId).then(artifacts => {
          return indexProject(projectId, artifacts);
        }).then(() => {
          indexStatus.set(projectId, { status: 'done', fileCount: result.imported.length });
          console.log(`[index] Project ${projectId} indexed ${result.imported.length} files`);
        }).catch(err => {
          indexStatus.set(projectId, { status: 'error', fileCount: 0, error: String(err) });
          console.error(`[index] Project ${projectId} indexing failed:`, err);
        });
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

    // List active static sessions across all projects (for toast polling)
    if (req.method === 'GET' && matchStaticActive(url)) {
      return json(res, 200, await listActiveStaticSessions());
    }

    // Create and run static session
    if (ssMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const reviewType = body.reviewType;
      const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';

      if (!name) return json(res, 400, { error: 'name is required' });

      const VALID_REVIEW_TYPES = ['requirement_review', 'code_review', 'requirement_to_code_traceability', 'cross_artifact_consistency'];
      if (typeof reviewType !== 'string' || !VALID_REVIEW_TYPES.includes(reviewType)) {
        return json(res, 400, { error: `reviewType must be one of: ${VALID_REVIEW_TYPES.join(', ')}` });
      }

      const activeSession = await getActiveStaticSession(ssMatch.projectId);
      if (activeSession) return json(res, 409, { error: 'A static review session is already running' });

      const allArtifacts = await listArtifacts(ssMatch.projectId);
      if (allArtifacts.length === 0) {
        return json(res, 400, { error: 'No artifacts found. Upload or import files first.' });
      }

      // The agent picks which artifacts to inspect; the project workspace makes all of them available.
      const session = await createStaticSession(
        ssMatch.projectId,
        name,
        reviewType,
        { instructions },
        instructions
      );

      runStaticReview(session, allArtifacts, async (progress) => {
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
        const result = await exportProjectReport(rMatch.projectId);
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String(e) });
      }
    }

    // === Requirements ===

    // List requirements
    const reqListMatch = matchRequirements(url);
    if (reqListMatch && req.method === 'GET') {
      return json(res, 200, await listRequirements(reqListMatch.projectId));
    }

    // Create requirement
    if (reqListMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      const priority = typeof body.priority === 'string' ? body.priority.trim() : 'medium';
      if (!title) return json(res, 400, { error: 'title is required' });
      const requirement = await createRequirement(reqListMatch.projectId, title, description, category, priority);
      return json(res, 201, requirement);
    }

    // Add mapping to requirement (must be before single requirement get)
    const reqMapMatch = matchRequirementMap(url);
    if (reqMapMatch && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const fileId = typeof body.fileId === 'string' ? body.fileId : null;
      const symbolId = typeof body.symbolId === 'string' ? body.symbolId : null;
      const coverageStatus = typeof body.coverageStatus === 'string' ? body.coverageStatus : 'unknown';
      const confidence = typeof body.confidence === 'number' ? body.confidence : 0;
      const mapping = await mapRequirementToCode(reqMapMatch.reqId, fileId, symbolId, coverageStatus, confidence);
      return json(res, 201, mapping);
    }

    // List mappings for requirement (must be before single requirement get)
    const reqMappingsMatch = matchRequirementMappings(url);
    if (reqMappingsMatch && req.method === 'GET') {
      return json(res, 200, await getRequirementMappings(reqMappingsMatch.reqId));
    }

    // Update requirement
    const reqUpdateMatch = matchRequirement(url);
    if (reqUpdateMatch && req.method === 'PUT') {
      const body = await parseJsonBody(req);
      const updates: Record<string, string> = {};
      if (typeof body.title === 'string') updates.title = body.title;
      if (typeof body.description === 'string') updates.description = body.description;
      if (typeof body.category === 'string') updates.category = body.category;
      if (typeof body.priority === 'string') updates.priority = body.priority;
      try {
        const updated = await updateRequirement(reqUpdateMatch.reqId, updates);
        return json(res, 200, updated);
      } catch (e) {
        return json(res, 404, { error: String(e) });
      }
    }

    // Delete requirement
    if (reqUpdateMatch && req.method === 'DELETE') {
      const deleted = await deleteRequirement(reqUpdateMatch.reqId);
      if (!deleted) return json(res, 404, { error: 'Requirement not found' });
      return json(res, 200, { ok: true });
    }

    // Get single requirement
    if (reqUpdateMatch && req.method === 'GET') {
      const requirement = await getRequirement(reqUpdateMatch.reqId);
      if (!requirement) return json(res, 404, { error: 'Requirement not found' });
      return json(res, 200, requirement);
    }

    // === Repository Indexing ===

    // Index status (check if indexing is complete)
    const riStatusMatch = matchRepoIndexStatus(url);
    if (riStatusMatch && req.method === 'GET') {
      const status = indexStatus.get(riStatusMatch.projectId) || { status: 'idle', fileCount: 0 };
      return json(res, 200, status);
    }

    // Index project (trigger indexing)
    const riMatch = matchRepoIndex(url);
    if (riMatch && req.method === 'POST') {
      const artifacts = await listArtifacts(riMatch.projectId);
      await indexProject(riMatch.projectId, artifacts);
      return json(res, 200, { ok: true, indexed: artifacts.length });
    }

    // Get indexed files
    if (riMatch && req.method === 'GET') {
      return json(res, 200, await getIndexedFiles(riMatch.projectId));
    }

    // Get symbols for a file
    const riFileMatch = matchRepoIndexFile(url);
    if (riFileMatch && req.method === 'GET') {
      return json(res, 200, await getFileSymbols(riFileMatch.fileId));
    }

    // Search index
    const riSearchMatch = matchRepoSearch(url);
    if (riSearchMatch && req.method === 'GET') {
      const q = new URL(url, `http://localhost`).searchParams.get('q') || '';
      return json(res, 200, await searchByKeyword(riSearchMatch.projectId, q));
    }

    // === Context Retrieval ===

    const crMatch = matchContextRetrieval(url);
    if (crMatch && req.method === 'GET') {
      const reviewType = new URL(url, `http://localhost`).searchParams.get('type') || 'code_review';
      return json(res, 200, await retrieveContext(crMatch.projectId, reviewType));
    }

    // === Static Analysis ===

    // Run static analysis on project
    const saMatch = matchStaticAnalysis(url);
    if (saMatch && req.method === 'POST') {
      const artifacts = await listArtifacts(saMatch.projectId);
      const findings = await runStaticEngine(saMatch.projectId, artifacts);
      return json(res, 200, { findings, count: findings.length });
    }

    // Get static analysis findings
    if (saMatch && req.method === 'GET') {
      return json(res, 200, await getStaticFindings(saMatch.projectId));
    }

    // Get static analysis findings for a session
    const saSessionMatch = matchStaticAnalysisSession(url);
    if (saSessionMatch && req.method === 'GET') {
      return json(res, 200, await getStaticFindings(saSessionMatch.projectId, saSessionMatch.sessionId));
    }

    // Evidence file serving
    if (req.method === 'GET' && url.startsWith('/evidence-file')) {
      const urlObj = new URL(url, `http://${HOST}:${PORT}`);
      const filePath = urlObj.searchParams.get('path');

      if (!filePath) {
        return json(res, 400, { error: 'Missing path parameter' });
      }

      // Validate the path exists in evidence table (prevents arbitrary file access)
      const isEvidence = await isEvidenceFilePath(filePath);
      if (!isEvidence) {
        return json(res, 403, { error: 'File not registered as evidence', path: filePath });
      }

      // Validate file exists on disk
      if (!fs.existsSync(filePath)) {
        return json(res, 404, { error: 'File not found on disk', path: filePath });
      }

      // Validate it's an image file
      const ext = path.extname(filePath).toLowerCase();
      const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
      if (!allowedExts.includes(ext)) {
        return json(res, 403, { error: 'Only image files are allowed', ext });
      }

      // Set content type based on extension
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Stream the file
      try {
        const fileStream = fs.createReadStream(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        fileStream.pipe(res);
        fileStream.on('error', (err) => {
          console.error('[server] Error streaming file:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error reading file' }));
          }
        });
      } catch (err) {
        console.error('[server] Error serving file:', err);
        return json(res, 500, { error: 'Error serving file' });
      }
      return;
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
