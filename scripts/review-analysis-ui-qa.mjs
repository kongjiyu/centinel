import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { installProjectReadinessFixture } from './project-readiness-qa-fixture.mjs';

// Isolated fictional data: every auth/API request is intercepted. No live writes.
export async function runReviewAnalysisQa(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const state = await installProjectReadinessFixture(context);
  Object.assign(state.session, { status: 'pending_approval', configJson: JSON.stringify({ instructions: 'Check delete decisions and recovery.' }), progressJson: JSON.stringify({ stage: 'complete', updatedAt: '2026-10-20T00:01:00Z' }) });
  const map = { schemaVersion: 1, status: 'partial', coverage: { sourceArtifacts: 2, parsedArtifacts: 1, exhaustive: false, unresolvedEdgeCount: 1,
    limitations: ['Runtime and dependency paths still need verification.'], unsupportedArtifacts: [{ artifactId: 'py', filePath: 'worker.py', reason: 'Unsupported language.' }] },
    features: [{ id: 'delete', label: 'Delete account', provisional: true, entryPoints: [],
      paths: [{ id: 'normal', kind: 'normal', label: 'The delete handler receives the request.', status: 'inferred', evidence: [{ artifactId: 'fixture-code', filePath: 'src/checkout.ts', lineNumber: 1, sourceVersion: 'fixture' }] }],
      assessments: ['security', 'business', 'technical', 'personnel'].map(domain => ({ domain, status: domain === 'personnel' ? 'assessed' : 'unverified', outcome: domain === 'personnel' ? 'potential_gap' : 'unverified', summary: domain === 'personnel' ? 'The delete action has no recorded recovery decision.' : '' })),
      unresolved: [{ reason: 'Undo and dependency outcomes remain unverified.' }] }] };
  const trace = { workflow: { version: 'fixture', reference: '', stages: [] }, review: { id: state.session.id, name: state.session.name, status: 'pending_approval', progress: { stage: 'complete', completedStages: [] }, modelStatus: 'succeeded', updatedAt: '2026-10-20T00:01:00Z' },
    events: ['started', 'completed'].map((kind, i) => ({ reviewId: state.session.id, event: `harness_step_${kind}`, stage: 'model_analysis', createdAt: `2026-10-20T00:0${i}:00Z`, detail: { step: 'run_model', executionId: 'fixture', ...(i ? { durationMs: 60000 } : {}) } })), analysisMap: map };
  const headers = { 'access-control-allow-origin': '*' };
  await context.route('**/projects/*/static-sessions', r => r.fulfill({ headers, json: [state.session] }));
  await context.route('**/static-sessions/*/harness', r => r.fulfill({ headers, json: trace }));
  await context.route(/\/static-sessions\/[^/]+\/(evidence-sufficiency|source-manifest|traceability|correlations)$/, r => r.fulfill({ status: 404, headers, json: { error: 'Unavailable in this fixture' } }));
  const page = await context.newPage(); page.setDefaultTimeout(8_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1420/');
  await page.getByRole('row', { name: 'Open Readiness verification overview', exact: true }).click();
  await page.getByText(state.session.name, { exact: false }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByRole('heading', { name: 'Features and paths checked' }).waitFor();
  await page.getByText('Delete account · 1 mapped path', { exact: true }).click();
  await page.getByText('Path coverage and open questions', { exact: true }).click();
  await page.getByText('Coverage limits', { exact: true }).click();
  await page.getByText('The delete action has no recorded recovery decision.', { exact: false }).waitFor({ state: 'visible' });
  assert(await page.getByText('worker.py: Unsupported language.', { exact: true }).isVisible());
  const directory = new URL('../evidence/review-analysis-ui-2026-10-20/', import.meta.url); await fs.mkdir(directory, { recursive: true });
  const viewports = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1200, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('heading', { name: 'Features and paths checked' }).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, `Horizontal page overflow at ${viewport.width}`);
    const path = new URL(`activity-${viewport.width}.png`, directory).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1');
    await page.screenshot({ path, fullPage: true, animations: 'disabled' }); viewports.push({ ...viewport, noPageOverflow: true });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  // Off-happy path: old review with no saved feature map.
  trace.analysisMap = null;
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  // Harness is fetched on load; reload the isolated app and navigate again.
  await page.reload();
  await page.getByRole('row', { name: 'Open Readiness verification overview', exact: true }).click();
  await page.getByText(state.session.name, { exact: false }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByText('Feature and path coverage was not recorded for this review.', { exact: true }).waitFor();
  const report = { mode: 'isolated-browser-fixtures', viewports, olderReviewUnavailableCopy: true, pageErrors: errors, liveAuthOrPersistenceVerified: false };
  await fs.writeFile(new URL('results.json', directory), JSON.stringify(report, null, 2));
  return { report, context, page };
}
