import { installConnectionReviewFixture } from './connection-review-qa-fixture.mjs';

// Isolated browser fixture: no real authentication, provider calls or data writes.
export async function installProjectReadinessFixture(context) {
  const state = await installConnectionReviewFixture(context);
  const timestamp = '2026-10-19T12:00:00.000Z';
  state.project.name = 'Readiness verification';
  state.run.status = 'success';
  state.source.syncStatus = 'ready';
  const files = [
    ['fixture-code', 'src/checkout.ts', 'source_code', 'repository'],
    ['fixture-package', 'package.json', 'other', 'repository'],
    ['fixture-config', 'tsconfig.json', 'other', 'repository'],
    ['fixture-artifact', 'checkout.md', 'requirement', 'documents'],
  ].map(([id, filePath, type, source]) => ({ id, projectId: state.project.id, versionId: `version-${id}`,
    fileName: filePath.split('/').at(-1), filePath, type, source, originalPath: null, contentHash: 'fixture-hash', createdAt: timestamp }));
  await context.route('**/projects/*/artifacts', route => route.fulfill({
    headers: { 'access-control-allow-origin': '*' }, json: files,
  }));
  state.readinessCalls = [];
  state.readiness = {
    projectId: state.project.id, requestId: 'fixture-job', status: 'completed', trigger: 'manual',
    requestedAt: timestamp, startedAt: timestamp, completedAt: timestamp, error: null, stale: false,
    snapshot: { id: 'fixture-assessment', projectId: state.project.id, sourceFingerprint: 'fixture-version', assessedAt: timestamp,
      categories: [
        { id: 'repository', state: 'completed', checksPassed: 3, checksTotal: 3 },
        { id: 'requirements', state: 'incomplete', checksPassed: 6, checksTotal: 7 },
        { id: 'design', state: 'missing', checksPassed: 0, checksTotal: 6 },
        { id: 'standards', state: 'completed', checksPassed: 3, checksTotal: 3 },
      ].map(category => ({ ...category, label: category.id, sourceCount: 1, gapIds: [] })),
      findings: [{ id: 'requirements-exceptions', category: 'requirements', title: 'Cancellation outcome is not defined',
        description: 'The checkout rules do not explain what happens when payment is cancelled.',
        recommendation: 'Define the order outcome and how the user can retry.', severity: 'warning',
        references: [{ artifactId: 'fixture-artifact', path: 'checkout.md', excerpt: 'Payment starts after the order is confirmed.' }] },
      { id: 'design-missing', category: 'design', title: 'Design documentation is missing',
        description: 'No component, interface or failure-flow design was supplied.',
        recommendation: 'Add the design decisions for checkout and recovery.', severity: 'warning', references: [] }],
    },
  };
  await context.route('**/projects/*/readiness', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } });
    state.readinessCalls.push(route.request().method());
    if (route.request().method() === 'POST') { state.readiness.status = 'running'; state.readiness.error = null; }
    return route.fulfill({ status: route.request().method() === 'POST' ? 202 : 200,
      headers: { 'access-control-allow-origin': '*' }, json: state.readiness });
  });
  return state;
}
