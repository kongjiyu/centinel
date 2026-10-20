// Isolated UI acceptance: every application/auth request uses fictional fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installProjectReadinessFixture } from './project-readiness-qa-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(new URL('../sidecar/package.json', import.meta.url))('playwright');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executablePath = process.env.CENTINEL_QA_BROWSER || (existsSync(edge) ? edge : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const output = path.join(root, 'evidence/source-update-review-2026-10-19');
await fs.mkdir(output, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = await installProjectReadinessFixture(context);
state.session.status = 'pending_approval';
state.session.modelStatus = 'succeeded';
state.session.completedAt = '2026-10-18T00:00:00Z';
state.session.configJson = JSON.stringify({ instructions: 'Verify checkout decisions and recovery.', artifactIds: ['fixture-code', 'fixture-package', 'fixture-config', 'fixture-artifact'], requirementIds: [], standardIds: [] });
state.session.progressJson = JSON.stringify({ stage: 'complete', updatedAt: state.session.completedAt });
state.readiness.snapshot.findings = [];
const data = { mode: 'changed', findings: [] };
const ids = ['fixture-code', 'fixture-package', 'fixture-config', 'fixture-artifact'];
const headers = { 'access-control-allow-origin': '*' };
const reviewStarts = [];
await context.route('**/projects/*/static-sessions/fixture-linked-child', r => r.fulfill({ headers, json: { ...state.session, id: 'fixture-linked-child', parentSessionId: state.session.id, status: 'running' } }));
await context.route(/\/static-sessions\/fixture-linked-child\/(harness|evidence-sufficiency|correlations|traceability|model-usage)$/, r => r.fulfill({ status: 404, headers, json: { error: 'Unavailable in this isolated fixture' } }));
await context.route('**/projects/*/static-sessions', r => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (r.request().method() === 'POST') {
    reviewStarts.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, headers, json: { ...state.session, id: 'fixture-linked-child', parentSessionId: state.session.id, status: 'running' } });
  }
  return r.fulfill({ headers, json: [state.session] });
});
await context.route('**/projects/*/findings', r => r.fulfill({ headers, json: data.findings }));
await context.route('**/projects/*/static-sessions/*/source-manifest', r => {
  const selected = data.mode === 'added' ? ids.slice(0, 1) : ids;
  return r.fulfill({ headers, json: {
    sessionId: state.session.id, projectId: state.project.id,
    status: data.mode === 'unverified' ? 'unavailable' : 'available',
    capturedAt: data.mode === 'current' ? '2026-10-20T00:00:00Z' : '2026-10-18T00:00:00Z',
    artifactCount: data.mode === 'unverified' ? null : selected.length,
    sources: data.mode === 'unverified' ? [] : selected.map(id => ({ id, sessionId: state.session.id,
      sourceId: id, sourceKind: 'document', label: id, artifactIds: [id], filesReviewed: 1,
      contentHashes: [data.mode === 'changed' ? 'prior-hash' : 'fixture-hash'], capturedAt: '2026-10-18T00:00:00Z' })),
  } });
});
const page = await context.newPage();
page.on('pageerror', error => console.error('Page error:', error.message));
page.setDefaultTimeout(8_000);
const writes = [];
page.on('request', request => { if (request.method() !== 'GET' && request.method() !== 'OPTIONS') writes.push(new URL(request.url()).pathname); });
async function openProject() {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('row', { name: 'Open Readiness verification overview', exact: true }).click();
}
try {
  await page.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('row', { name: 'Open Readiness verification overview', exact: true }).click();
  await page.getByText('Sources changed', { exact: true }).waitFor();
  const viewports = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1200, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - (innerWidth <= 720 ? 72 : 232)) < 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `${viewport.width}-source-reminder.png`) });
    viewports.push(viewport);
  }
  await page.getByRole('button', { name: 'Start Review', exact: true }).click();
  await page.getByRole('form', { name: 'Start review' }).waitFor();
  await page.getByText(`Review updated sources against ${state.session.name}.`, { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Review objective', exact: true }).inputValue(), 'Verify checkout decisions and recovery.');
  assert.equal(writes.some(value => value.endsWith('/static-sessions')), false);
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('form[aria-label="Start review"]'));
  assert.equal(reviewStarts.length, 1);
  assert.equal(reviewStarts[0].comparisonParentReviewId, state.session.id);
  assert.equal(reviewStarts[0].instructions, 'Verify checkout decisions and recovery.');
  assert.deepEqual([...reviewStarts[0].artifactIds].sort(), [...ids].sort());
  data.mode = 'added';
  await openProject();
  await page.getByText('New sources need review', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Need attention', exact: true }).getByRole('button', { name: /See More/ }).click();
  assert.match(await page.getByRole('dialog').innerText(), /3 new project sources/);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  data.mode = 'unverified';
  await openProject();
  await page.getByText('Review needs checking', { exact: true }).waitFor();
  data.mode = 'current';
  await openProject();
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  data.findings = [{ id: 'fixture-resolved', projectId: state.project.id, sessionId: 'parent-review',
    source: 'static', verifier: 'model', severity: 'high', priority: 'High', title: 'Deletion lacks a decision',
    description: 'The earlier review found a missing decision.', recommendation: 'Add a decision or recovery path.',
    evidenceText: 'Fictional UI fixture.', status: 'new', confidence: 'high', createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z', artifactId: 'fixture-code', category: 'Human error',
    filePath: 'src/checkout.ts', lineNumber: 10, fromRemarks: false,
    resolutionEvidence: { status: 'resolved', basis: 'not_reproduced_in_comparable_review',
      reviewId: state.session.id, reviewName: 'Re-review', sourceManifestId: 'fixture-manifest',
      previousSourceVersion: 'old-version', reviewedSourceVersion: 'new-version' } }];
  // Remount after replacing the fictional project response.
  await openProject();
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  await page.getByRole('button', { name: 'See more about Deletion lacks a decision', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Finding details', exact: true });
  assert.match(await page.getByRole('table', { name: 'Project findings', exact: true }).innerText(), /Resolved/);
  assert.match(await details.innerText(), /Not reproduced in the comparable re-review/);
  await details.getByRole('button', { name: 'Open review Re-review', exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - 232) < 1);
  await page.screenshot({ path: path.join(output, '1440-resolution-evidence.png') });
  assert.equal(writes.some(value => value.includes('/findings/')), false);
  const results = { passed: true, viewports, checks: ['changed sources', 'added sources', 'unavailable evidence', 'no automatic review start', 'prior objective and scope prefilled', 'explicit fictional linked review submission', 'resolved badge and basis', 'no finding decision writes'] };
  await fs.writeFile(path.join(output, 'ui-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') });
  console.error((await page.locator('body').innerText()).slice(0, 6000));
  throw error;
} finally { await context.close(); await browser.close(); }
