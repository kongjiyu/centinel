/** Scripted development acceptance on the real local RWA. No LLM/auth bypass claim. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryDynamicRepository } from '../inMemoryRepository.js';
import { DynamicService } from '../service.js';
import { verifyAndRetain } from '../runnerBridge.js';
import { createStaticContextFixture } from './staticContextStub.js';

export async function runLocalBaseline(targetUrl: string, outputDirectory: string) {
  const target = new URL(targetUrl);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.protocol !== 'http:') throw new Error('Development baseline only supports a local HTTP target.');
  const service = new DynamicService(new InMemoryDynamicRepository());
  const projectId = 'scripted-development-project';
  const actorId = 'scripted-development-tester';
  const revision = await service.saveMission(projectId, actorId, {
    name: 'Seeded user reaches authenticated home', goal: 'Sign in and verify the authenticated home page.',
    targetUrl: target.origin, maxSteps: 15, context: createStaticContextFixture(projectId), contextAcknowledged: false,
    checks: [
      { id: 'home-url', criterionId: 'MOCK-RWA-AUTH-01-C1', description: 'Authenticated home URL', kind: 'url', expected: `${target.origin}/`, required: true },
      { id: 'balance-label', criterionId: 'MOCK-RWA-AUTH-01-C1', description: 'Account balance is visible', kind: 'visible_text', expected: 'Account Balance', required: true },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const first = await service.start(projectId, actorId, revision.id, 'baseline-pass');
    await service.claim(projectId, first.run.id);
    await page.goto(`${target.origin}/signin`);
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill(process.env.CENTINEL_RWA_USERNAME ?? 'Heath93');
    // Public upstream fixture default, never added to mission snapshots/results.
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(process.env.CENTINEL_RWA_PASSWORD ?? 's3cret');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL(`${target.origin}/`);
    await page.getByRole('heading', { name: 'Account Balance', exact: true }).waitFor();
    const passed = await verifyAndRetain(service, first.run, page, path.join(outputDirectory, first.run.id));
    const second = await service.start(projectId, actorId, revision.id, 'baseline-controlled-failure');
    await service.claim(projectId, second.run.id);
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.waitForURL(`${target.origin}/signin`);
    const failed = await verifyAndRetain(service, second.run, page, path.join(outputDirectory, second.run.id));
    const cancelled = await service.start(projectId, actorId, revision.id, 'baseline-cancelled');
    await service.stop(projectId, cancelled.run.id, 'cancelled', 'Scripted cancellation case.');
    const blocked = await service.start(projectId, actorId, revision.id, 'baseline-blocked');
    await service.stop(projectId, blocked.run.id, 'blocked', 'Synthetic provider unavailable case; no LLM called.');
    if (passed.verdict !== 'passed' || failed.verdict !== 'failed') throw new Error('Actual browser state did not match the baseline expectations.');
    const report = { schemaVersion: 1, mode: 'scripted-development', targetUrl: target.origin, providerAcceptance: 'not_exercised', storage: 'explicit-in-memory-test-repository',
      note: 'The failed Run is a deliberately unmet criterion after sign-out, not an upstream defect or autonomous-agent evaluation.',
      mission: revision, runs: await service.repository.listRuns(projectId), capturedAt: new Date().toISOString() };
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'baseline.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLocalBaseline(process.argv[2] ?? 'http://localhost:3000', path.resolve(process.argv[3] ?? 'output/playwright/dynamic-baseline'));
  console.log(JSON.stringify({ mode: result.mode, runs: result.runs.map(run => ({ id: run.id, state: run.state, verdict: run.verdict })), output: path.resolve(process.argv[3] ?? 'output/playwright/dynamic-baseline') }));
}
