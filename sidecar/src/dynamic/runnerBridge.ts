import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { ModelProviderSettings } from '../review/types.js';
import type { TokenUsageInput } from '../tokenUsage.js';
import { addEvidence, createDynamicSession, getDynamicSession } from '../dynamicSessions.js';
import { DYNAMIC_HEARTBEAT_MS } from './recovery.js';
import { cancelSession, runDynamicSession } from '../dynamicRunner.js';
import { checkPage } from './checker.js';
import { DynamicService } from './service.js';
import type { DynamicRun, EvidenceReference } from './types.js';

/** Attach a frozen Mission revision to the existing local browser executor. */
export async function executeMissionRun(service: DynamicService, run: DynamicRun, workspace: string,
  providers: { vision: ModelProviderSettings; text?: ModelProviderSettings; recordUsage?: (usage: TokenUsageInput) => Promise<unknown> }) {
  let legacySessionId: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending = false;
  try {
    const current = await service.requireRun(run.projectId, run.id);
    if (current.state !== 'queued') return;
    const session = await createDynamicSession(run.projectId, run.revision.targetUrl, run.revision.goal, 'user_journey', run.revision.maxSteps);
    legacySessionId = session.id;
    await service.claim(run.projectId, run.id, session.id);
    heartbeatTimer = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void service.heartbeat(run.projectId, run.id).then(alive => {
        if (!alive) cancelSession(session.id);
      }).catch(() => cancelSession(session.id)).finally(() => { heartbeatPending = false; });
    }, DYNAMIC_HEARTBEAT_MS);
    heartbeatTimer.unref();
    await runDynamicSession(session, workspace, {
      ...providers,
      verifyOutcome: async (page, signal) => {
        const result = await verifyAndRetain(service, run, page, path.join(workspace, 'sessions', session.id, 'logs'), signal);
        await addEvidence(run.projectId, session.id, 'screenshot', path.join(workspace, 'sessions', session.id, 'logs', 'criterion-page.png'), 'Independent criterion screenshot', result.evidence[0].id);
        await addEvidence(run.projectId, session.id, 'session_summary', path.join(workspace, 'sessions', session.id, 'logs', 'checks.json'), 'Independent criterion results', result.evidence[1].id);
        return result.verdict;
      },
    });
    const final = await service.requireRun(run.projectId, run.id);
    if (final.state !== 'running') return;
    const local = await getDynamicSession(run.projectId, session.id);
    await service.stop(run.projectId, run.id, local?.status === 'cancelled' ? 'cancelled' : 'blocked', local?.failureReason || 'Execution ended without independently verified criteria.');
  } catch {
    const current = await service.requireRun(run.projectId, run.id);
    if (['queued', 'running'].includes(current.state)) await service.stop(run.projectId, run.id, 'blocked', 'Browser or persistence unavailable; inspect local evidence and retry.');
    // A lost claim may have created a queued legacy session; do not leave it active.
    if (legacySessionId) {
      const { updateDynamicSessionStatus } = await import('../dynamicSessions.js');
      await updateDynamicSessionStatus(legacySessionId, 'blocked', '', 'Mission execution stopped.').catch(() => {});
    }
  } finally { if (heartbeatTimer) clearInterval(heartbeatTimer); }
}

/** Also usable by a scripted development baseline, without pretending it is an LLM run. */
export async function verifyAndRetain(service: DynamicService, run: DynamicRun, page: Page, outputDirectory: string, signal?: AbortSignal) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const screenshotPath = path.join(outputDirectory, 'criterion-page.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const screenshot: EvidenceReference = { id: crypto.randomUUID(), kind: 'screenshot', sha256: crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex'), availability: 'local', capturedAt: new Date().toISOString() };
  const results = await checkPage(page, run.revision.checks, [screenshot.id], signal);
  const resultsPath = path.join(outputDirectory, 'checks.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  const evidence: EvidenceReference[] = [screenshot, { id: crypto.randomUUID(), kind: 'checks', sha256: crypto.createHash('sha256').update(fs.readFileSync(resultsPath)).digest('hex'), availability: 'local', capturedAt: new Date().toISOString() }];
  return service.finish(run.projectId, run.id, results, evidence);
}
