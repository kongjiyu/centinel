import {normalizeActionPolicy} from './browser/actionPolicy.js';
import {normalizeBudget} from './budgets.js';
import type {BrowserSessionState} from './environment/sessionVault.js';
import {captureProtectedPage} from './browser/capture.js';
import {redactObservationRecord} from './browser/privacy.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { ModelProviderSettings } from '../review/types.js';
import type { TokenUsageInput } from '../tokenUsage.js';
import { addEvidence, createDynamicSession, getDynamicSession } from '../dynamicSessions.js';
import { DYNAMIC_HEARTBEAT_MS } from './recovery.js';
import { ExecutionLease } from './executionLease.js';
import { cancelSession, runDynamicSession } from '../dynamicRunner.js';
import { checkPage } from './checker.js';
import { DynamicService } from './service.js';
import type { DynamicRun, EvidenceReference } from './types.js';

/** Attach a frozen Mission revision to the existing local browser executor. */
export async function executeMissionRun(service: DynamicService, run: DynamicRun, workspace: string,
  providers: { resolvePrivateValue?:(name:string)=>string|undefined;retainDownload?:(receipt:Omit<import('./browser/fileTypes.js').DownloadReceipt,'id'>,buffer:Buffer)=>import('./browser/fileTypes.js').DownloadReceipt;resolveUpload?:(grant:import('./browser/fileTypes.js').UploadGrant)=>import('./browser/fileTypes.js').UploadPayload;storageState?:BrowserSessionState; runtimeMs?:number; sensitiveValues?:readonly string[]; sensitiveSelectors?:readonly string[]; vision: ModelProviderSettings; text?: ModelProviderSettings; recordUsage?: (usage: TokenUsageInput) => Promise<unknown> }) {
  let legacySessionId: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let watchdogTimer: ReturnType<typeof setInterval> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let lease: ExecutionLease | undefined;
  let leaseReason: string | null = null;
  let heartbeatPending = false;
  try {
    const current = await service.requireRun(run.projectId, run.id);
    if (current.state !== 'queued') return;
    const limits=normalizeBudget(run.executionBudget??run.environment?.budgets);
    limits.maxSteps=Math.min(limits.maxSteps,run.revision.maxSteps);
    const session = await createDynamicSession(run.projectId, run.environment?.targetUrl ?? run.revision.targetUrl, run.revision.goal, 'user_journey', limits.maxSteps);
    legacySessionId = session.id;
    const claimStarted = performance.now();
    const durationMs = Math.min(providers.runtimeMs ?? 300_000,limits.runtimeMs);
    lease = new ExecutionLease(claimStarted, durationMs, reason => { leaseReason = reason; cancelSession(session.id); });
    await service.claim(run.projectId, run.id, session.id);
    if (!lease.canForward()) throw new Error('Local execution lease expired before claim confirmation.');
    deadlineTimer = setTimeout(() => { lease?.fail('Run reached its local execution deadline. Check cleanup before retrying.'); }, Math.max(0, durationMs - (performance.now() - claimStarted)));
    deadlineTimer.unref();
    watchdogTimer = setInterval(() => { lease?.canForward(); }, 1000);
    watchdogTimer.unref();
    heartbeatTimer = setInterval(() => {
      if (!lease?.canForward() || heartbeatPending) return;
      heartbeatPending = true;
      const requestStarted = performance.now();
      void service.heartbeat(run.projectId, run.id).then(alive => {
        lease?.confirm(requestStarted, alive);
      }).catch(() => lease?.fail('Run worker lease unavailable. Check cleanup before retrying.')).finally(() => { heartbeatPending = false; });
    }, DYNAMIC_HEARTBEAT_MS);
    heartbeatTimer.unref();
    await runDynamicSession(session, workspace, {
      ...providers,
      budgets:limits,
      observationMode:'dom_first',
      ...(run.revision.mode==='exploratory'?{exploratoryChecks:run.revision.checks,checkpointExploration:async(snapshot:import('./browser/exploration.js').ExplorationSnapshot)=>{if(!lease?.canForward())throw new DOMException('Execution lease unavailable','AbortError');await service.checkpointExploration(run.projectId,run.id,snapshot);if(!lease?.canForward())throw new DOMException('Execution lease unavailable','AbortError');}}:{}),
      actionPolicy:normalizeActionPolicy(run.actionPolicy??run.environment?.actionPolicy),
      runtimeMs: Math.max(1000, Math.floor(durationMs - (performance.now() - claimStarted))),
      canForward: () => lease?.canForward() === true,
      viewport: run.environment?.viewport,
      sessionReadySelector:run.environment?.sessionReadySelector,
      allowedOrigins:run.environment?.allowedOrigins??[new URL(run.revision.targetUrl).origin],
      verifyOutcome: async (page, signal, privacy) => {
        if (!lease?.canForward() || signal.aborted) throw new DOMException('Execution lease unavailable', 'AbortError');
        const result = await verifyAndRetain(service, run, page, path.join(workspace, 'sessions', session.id, 'logs'), signal,privacy);
        await addEvidence(run.projectId, session.id, 'screenshot', path.join(workspace, 'sessions', session.id, 'logs', 'criterion-page.png'), 'Independent criterion screenshot', result.evidence[0].id);
        await addEvidence(run.projectId, session.id, 'session_summary', path.join(workspace, 'sessions', session.id, 'logs', 'checks.json'), 'Independent criterion results', result.evidence[1].id);
        if(result.evidence[2])await addEvidence(run.projectId,session.id,'session_summary',path.join(workspace,'sessions',session.id,'logs','file-manifest.json'),'Independent captured-file manifest',result.evidence[2].id);
        return {verdict:result.verdict,checks:result.checks};
      },
    });
    const final = await service.requireRun(run.projectId, run.id);
    if (final.state !== 'running') return;
    const local = await getDynamicSession(run.projectId, session.id);
    await service.stop(run.projectId, run.id, leaseReason ? 'blocked' : local?.status === 'cancelled' ? 'cancelled' : 'blocked', leaseReason || local?.failureReason || 'Execution ended without independently verified criteria.');
  } catch {
    const current = await service.requireRun(run.projectId, run.id);
    if (['queued', 'running'].includes(current.state)) await service.stop(run.projectId, run.id, 'blocked', leaseReason || 'Browser or persistence unavailable; inspect local evidence and retry.');
    // A lost claim may have created a queued legacy session; do not leave it active.
    if (legacySessionId) {
      const { updateDynamicSessionStatus } = await import('../dynamicSessions.js');
      await updateDynamicSessionStatus(legacySessionId, 'blocked', '', 'Mission execution stopped.').catch(() => {});
    }
  } finally { lease?.close(); if (heartbeatTimer) clearInterval(heartbeatTimer); if (watchdogTimer) clearInterval(watchdogTimer); if (deadlineTimer) clearTimeout(deadlineTimer); }
}

/** Also usable by a scripted development baseline, without pretending it is an LLM run. */
export async function verifyAndRetain(service: DynamicService, run: DynamicRun, page: Page, outputDirectory: string, signal?: AbortSignal, privacy:{sensitiveValues?:readonly string[];sensitiveSelectors?:readonly string[];downloads?:readonly import('./browser/fileTypes.js').DownloadReceipt[]}={}) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const screenshotPath = path.join(outputDirectory, 'criterion-page.png');
  await captureProtectedPage(page,screenshotPath,{secrets:privacy.sensitiveValues,sensitiveSelectors:privacy.sensitiveSelectors,signal});
  const screenshot: EvidenceReference = { id: crypto.randomUUID(), kind: 'screenshot', sha256: crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex'), availability: 'local', capturedAt: new Date().toISOString() };
  const manifest=privacy.downloads?{id:crypto.randomUUID(),kind:'file_manifest' as const,sha256:'',availability:'local' as const,capturedAt:new Date().toISOString()}:undefined;
  if(manifest){const content=JSON.stringify({schemaVersion:1,downloads:privacy.downloads},null,2);fs.writeFileSync(path.join(outputDirectory,'file-manifest.json'),content,{mode:0o600});manifest.sha256=crypto.createHash('sha256').update(content).digest('hex');}
  const results = redactObservationRecord(await checkPage(page, run.revision.checks, [screenshot.id], signal,{...privacy,downloadEvidenceIds:manifest?[manifest.id]:[]}),privacy.sensitiveValues??[]);
  const resultsPath = path.join(outputDirectory, 'checks.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  const evidence: EvidenceReference[] = [screenshot, { id: crypto.randomUUID(), kind: 'checks', sha256: crypto.createHash('sha256').update(fs.readFileSync(resultsPath)).digest('hex'), availability: 'local', capturedAt: new Date().toISOString() },...(manifest?[manifest]:[])];
  if (signal?.aborted) throw new DOMException('Execution stopped before verification persisted', 'AbortError');
  return service.finish(run.projectId, run.id, results, evidence);
}
