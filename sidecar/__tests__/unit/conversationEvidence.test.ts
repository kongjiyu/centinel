import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolveConversationEvidence } from '../../src/conversation/evidence.js';
import { presentSavedSelection } from '../../src/conversation/savedExplanation.js';
import { sourceByteHash } from '../../src/review/sourceText.js';
const mocks = vi.hoisted(() => ({
  review: vi.fn(), manifest: vi.fn(), traceability: vi.fn(), findings: vi.fn(), read: vi.fn(), download: vi.fn(), artifacts: vi.fn(), autoTest: vi.fn(), currentFindings: vi.fn(),
}));
vi.mock('../../src/review/supabaseRepository.js', () => ({
  SupabaseStaticReviewRepository: class {
    getReview = mocks.review;
    loadSourceManifestArtifacts = mocks.manifest;
    getTraceabilitySnapshot = mocks.traceability;
  },
}));
vi.mock('../../src/applicationRepository.js', () => ({ CentinelApplicationRepository: class {
  downloadFrozenArtifactVersion = mocks.download;
  async getProject() { return { name: 'Fixture' }; }
} }));
vi.mock('../../src/applicationApi.js', () => ({ listClientArtifacts: mocks.artifacts, readClientArtifactContent: mocks.read }));
vi.mock('../../src/store/index.js', () => ({ SupabaseCentinelStore: class { listFindings = mocks.findings; } }));
vi.mock('../../src/dynamic/autonomous/store.js', () => ({ SupabaseAutoTestStore: class { get = mocks.autoTest; } }));
vi.mock('../../src/review/currentProjectFindings.js', () => ({ loadCurrentProjectFindings: mocks.currentFindings }));
const client = {} as SupabaseClient;
const signal = new AbortController().signal;
it('loads an uploaded version as a file reference without an earlier check and bounds long text', async () => {
  const bytes = Buffer.from('Product catalogue.\n' + 'x'.repeat(20_000));
  const contentHash = sourceByteHash(bytes);
  mocks.artifacts.mockResolvedValue([{ id: 'upload', versionId: 'v1', contentHash, fileName: 'catalogue.txt', filePath: 'uploads/catalogue.txt' }]);
  mocks.download.mockResolvedValue(bytes);
  const [item] = await resolveConversationEvidence(client, 'owner', 'project', [{ artifactId: 'upload' }], signal);
  expect(mocks.download).toHaveBeenCalledWith({ projectId: 'project', versionId: 'v1', artifactId: 'upload', expectedContentHash: contentHash }, signal);
  expect(item).toMatchObject({ id: 'artifact:upload', artifactId: 'upload', versionId: 'v1' });
  expect(JSON.parse(item.text)).toMatchObject({
    path: 'uploads/catalogue.txt', content: expect.stringContaining('Product catalogue.'), limitation: 'Only the beginning of this file is supplied.',
  });
  expect(item.text.length).toBeLessThan(20_000);
  expect(mocks.review).not.toHaveBeenCalled();
});
it('selects only versioned repository files under the named automation module', async () => {
  mocks.artifacts.mockResolvedValue([
    { id: 'a', source: 'repository', filePath: 'cypress/e2e/login.ts', versionId: 'v1' },
    { id: 'b', source: 'repository', filePath: 'src/automation.ts', versionId: 'v2' },
    { id: 'c', source: 'documents', filePath: 'cypress/requirements.md', versionId: 'v3' },
    { id: 'd', source: 'repository', filePath: 'cypress/stale.ts', versionId: 'v4', currency: { deprecated: true } },
  ]);
  const result = await resolveConversationEvidence(client, 'owner', 'project', [], signal, false, 'conduct a review on automation module');
  expect(result.map(item => item.id)).toEqual(['module:project', 'module-source:a']);
  expect(result[1]).toMatchObject({ artifactId: 'a', versionId: 'v1' });
  expect(mocks.read).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.review.mockResolvedValue({ id: 'review', projectId: 'project', name: 'Order access', status: 'completed', summary: 'Saved result', sourceManifestId: 'manifest' });
  mocks.manifest.mockResolvedValue([{ id: 'artifact', versionId: 'original-version', contentHash: 'original-hash', filePath: 'orders.ts' }]);
  mocks.traceability.mockResolvedValue({ records: [{ requirementId: 'req', description: 'Orders belong to their owner.' }] });
  mocks.findings.mockResolvedValue([{ id: 'finding', artifactId: 'artifact', artifactVersionId: 'original-version',
    title: 'Missing ownership check', status: 'new', evidenceText: 'return orders.get(id)', requirementId: 'req' }]);
  mocks.read.mockResolvedValue('function order() { return orders.get(id) }');
});
it('loads the original version and saved requirement for a selected problem', async () => {
  const result = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'finding' }], signal);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(client, 'owner', 'artifact', 'original-version', signal, 'project', 'original-hash');
  expect(JSON.parse(result.find(item => item.id === 'finding:finding')!.text)).toMatchObject({
    excerpt: 'return orders.get(id)', requirement: { requirementId: 'req', description: 'Orders belong to their owner.' },
  });
  expect(mocks.artifacts).not.toHaveBeenCalled();
});
it('keeps a historical Problem and its original excerpt while showing authoritative current status', async () => {
  mocks.currentFindings.mockResolvedValue([{ id: 'current-id', status: 'fixed', latestOccurrence: { findingId: 'finding' } }]);
  const resolved = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'finding' }], signal);
  const saved = JSON.parse(resolved.find(item => item.id === 'finding:finding')!.text);
  expect(saved.problem).toMatchObject({ originalStatus: 'new', currentStatus: 'Resolved', excerpt: 'return orders.get(id)' });
});

it('looks up the current Browser Problem by the saved run within the project', async () => {
  const savedClient = {
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockResolvedValue({ data: [{ finding_id: 'browser-finding' }] }) }),
    rpc: vi.fn().mockResolvedValue({ data: { finding: { projectId: 'project', remediation: 'resolved' } } }),
  } as unknown as SupabaseClient;
  mocks.autoTest.mockResolvedValue({ id: 'browser', projectId: 'project', stage: 'completed',
    tests: [{ id: 'test', runId: 'run', name: 'Catalogue text', state: 'failed', checks: [], checkResults: [] }] });
  const resolved = await resolveConversationEvidence(savedClient, 'owner', 'project', [{ autoTestId: 'browser', testId: 'test' }], signal);
  const saved = JSON.parse(resolved.find(item => item.id === 'browser:browser:test')!.text);
  expect(saved.problem).toMatchObject({ originalStatus: 'failed', currentStatus: 'Resolved', runId: 'run' });
  expect(savedClient.rpc).toHaveBeenCalledWith('read_dynamic_finding', { p_project_id: 'project', p_finding_id: 'browser-finding' });
});

it('preserves whole-Check counts when Browser evidence details exceed the conversation budget', async () => {
  mocks.autoTest.mockResolvedValue({ id: 'browser', projectId: 'project', stage: 'completed',
    tests: Array.from({ length: 20 }, (_, index) => ({ id: `test-${index}`, runId: `run-${index}`,
      name: `Catalogue case ${index}`, state: 'failed', checks: [{ id: 'a', description: 'Expected text'.repeat(12) }],
      checkResults: Array.from({ length: 8 }, () => ({ checkId: 'a', observed: 'Recorded observation '.repeat(15), verdict: 'failed' })) })) });
  const resolved = await resolveConversationEvidence(client, 'owner', 'project', [{ autoTestId: 'browser' }], signal);
  const evidence = resolved.find(item => item.id === 'browser:browser')!;
  const saved = JSON.parse(evidence.text);
  expect(saved).toMatchObject({ testCount: 20, failedTests: 20, failedAssertions: 20 });
  expect(saved.moreTests).toBeGreaterThan(0);
  expect(saved.tests.length + saved.moreTests).toBe(20);
  expect(evidence.text.length).toBeLessThan(20000);
});

it.each([
  [null, 'original-hash', true],
  [null, 'changed-hash', false],
  ['different-version', 'original-hash', false],
])('resolves missing artifact-version IDs only through the frozen source hash', async (artifactVersionId, sourceVersion, available) => {
  mocks.findings.mockResolvedValue([{ id: 'finding', artifactId: 'artifact', artifactVersionId, sourceVersion,
    title: 'Saved problem', evidenceText: 'return orders.get(id)' }]);
  const resolved = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'finding' }], signal);
  const finding = resolved.find(item => item.id === 'finding:finding')!;
  expect(JSON.parse(finding.text).excerpt).toBe(available ? 'return orders.get(id)' : null);
  expect(finding.unavailable).toBe(!available);
  expect(mocks.read).toHaveBeenCalledTimes(available ? 1 : 0);
});
it('rejects a cross-project Review before reading findings or source content', async () => {
  mocks.review.mockResolvedValue({ projectId: 'other-project' });
  await expect(resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal)).rejects.toThrow('unavailable');
  expect(mocks.findings).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it('resolves an entire saved check with 56 findings without reading individual source excerpts', async () => {
  mocks.findings.mockResolvedValue(Array.from({ length: 56 }, (_, i) => ({ id: `finding-${i}`, title: `Saved problem ${i}`, status: 'new' })));
  const resolved = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal);
  expect(JSON.parse(resolved.find(item => item.id === 'review:review')!.text)).toMatchObject({ findingCount: 56, moreFindings: 48 });
  expect(mocks.read).not.toHaveBeenCalled();
});
it('reports a saved full-review objective and labels a partial Browser total', async () => {
  mocks.review.mockResolvedValue({ id: 'review', projectId: 'project', status: 'completed', config: { scopeMode: 'full', instructions: 'run both' } });
  mocks.autoTest.mockResolvedValue({ id: 'browser', projectId: 'project', stage: 'completed', tests: [
    { id: 'catalog', name: 'Catalog', state: 'failed', runId: 'run', checks: [{ id: 'price' }], checkResults: [{ checkId: 'price', verdict: 'failed' }] },
    { id: 'cart', name: 'Cart', state: 'blocked', checks: [{ id: 'total' }], checkResults: [] },
  ] });
  const checkId = '123e4567-e89b-12d3-a456-426614174000';
  const evidence = await resolveConversationEvidence(client, 'owner', 'project',
    [{ checkId, checkFocus: 'Client-supplied label', reviewId: 'review', autoTestId: 'browser' }], signal);
  const savedCheck = JSON.parse(evidence.find(item => item.id === `check:${checkId}`)!.text);
  expect(savedCheck).toMatchObject({ codeObjective: 'run both' });
  expect(evidence.map(item => item.text).join(' ')).not.toContain('Client-supplied label');
  const sections = presentSavedSelection(evidence)?.explanation?.sections;
  expect(sections).toHaveLength(1);
  expect(sections?.[0]).toMatchObject({ presentation: 'check', check: {
    mode: 'both', objectiveUnavailable: false,
    code: { objective: 'run both', problemCount: 1 },
    browser: { failedAssertionCount: 1, assertionCountPartial: true, testsWithoutVerdict: 1 },
  } });
});
it('omits the default Review objective when no original user request was saved', async () => {
  mocks.review.mockResolvedValue({ id: 'review', projectId: 'project', status: 'completed', config: {
    instructions: 'Review project sources against the configured requirements and standards.',
  } });
  const evidence = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal);
  const saved = JSON.parse(evidence.find(item => item.id === 'review:review')!.text);
  expect(saved.objective).toBeUndefined();
  expect(presentSavedSelection(evidence)?.explanation?.sections[0].check).toMatchObject({ objectiveUnavailable: true });
});

it('preserves evidence across quality categories and omits bare domain labels', async () => {
  mocks.findings.mockResolvedValue([
    ...Array.from({ length: 10 }, (_, i) => ({ title: `Security finding ${i}`, description: 'A saved security impact.', category: 'security' })),
    { title: 'Routine startup log', description: 'Routine logging has no adverse effect.', category: 'technical', severity: 'info' },
    { title: 'Wrong checkout total', description: 'A rounding discrepancy changes the saved total.', category: 'technical', artifactId: 'artifact' },
    { title: 'Bare domain', category: 'business' },
    { title: 'Resolved concern', description: 'Historical issue only.', category: 'usability', status: 'fixed' },
  ]);
  const evidence = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal);
  const section = presentSavedSelection(evidence)?.explanation?.sections[0];
  expect(section?.points).toContain('Technical correctness · orders.ts · A rounding discrepancy changes the saved total.');
  expect(section?.points?.filter(point => point.startsWith('Security ·'))).toHaveLength(1);
  expect(section?.points?.join(' ')).not.toMatch(/Business behavior|Historical issue only|Routine logging/);
});
it('shows a saved file path as affected-file evidence without inferring a module', async () => {
  mocks.findings.mockResolvedValue([{ id: 'finding', title: 'Saved issue', status: 'new', severity: 'medium',
    description: 'The saved path identifies the affected file.', location: { filePath: 'src/orders/controller.ts' } }]);
  const result = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review' }], signal);
  expect(JSON.parse(result.find(item => item.id === 'review:review')!.text)).toMatchObject({
    affectedFiles: ['src/orders/controller.ts'], modules: [],
  });
});
it('rejects a finding that is absent from the selected Review', async () => {
  await expect(resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'unrelated' }], signal)).rejects.toThrow('unavailable');
  expect(mocks.read).not.toHaveBeenCalled();
});
it('retains an explicit missing-excerpt limitation instead of substituting current sources', async () => {
  mocks.read.mockRejectedValue(new Error('version unavailable'));
  const result = await resolveConversationEvidence(client, 'owner', 'project', [{ reviewId: 'review', findingId: 'finding' }], signal);
  expect(result.find(item => item.id === 'finding:finding')).toMatchObject({ unavailable: true });
  expect(mocks.artifacts).not.toHaveBeenCalled();
});
it('provides a bounded display-only window from the frozen source when an exact excerpt is unavailable', async () => {
  mocks.findings.mockResolvedValue([{ id: 'finding', artifactId: 'artifact', artifactVersionId: 'original-version',
    title: 'Missing ownership check', evidenceText: 'unverified statement', location: { lineNumber: 3 } }]);
  mocks.read.mockResolvedValue('one\ntwo\nthree\nfour\nfive\nsix');
  const refs = [{ reviewId: 'review', findingId: 'finding' }];
  const normal = await resolveConversationEvidence(client, 'owner', 'project', refs, signal);
  const display = await resolveConversationEvidence(client, 'owner', 'project', refs, signal, true);
  expect(normal.find(item => item.id === 'finding:finding')?.text).not.toContain('nearby');
  const shown = display.find(item => item.id === 'finding:finding')!;
  expect(shown.unavailable).toBe(true);
  expect(JSON.parse(shown.text)).toMatchObject({ excerpt: null, nearby: { firstLine: 1, citedLine: 3, text: 'one\ntwo\nthree\nfour\nfive' } });
});

it('keeps first-attempt Browser evidence and explanation visible without claiming proof from a stopped check', async () => {
  mocks.autoTest.mockResolvedValue({ id: 'browser', projectId: 'project', stage: 'cancelled', tests: [{
    id: 'test', name: 'Save order', state: 'cancelled', runId: 'run-2', checks: [{ id: 'confirmation', description: 'Order confirmation appears.', required: true }], checkResults: [],
    firstAttempt: { runId: 'run-1', state: 'failed', checkResults: [{ checkId: 'confirmation', verdict: 'failed', observed: 'The page stayed on the form.' }],
      explanation: 'The save response may not update the order view.' },
  }] });
  const evidence = await resolveConversationEvidence(client, 'owner', 'project', [{ autoTestId: 'browser', testId: 'test' }], signal);
  const saved = JSON.parse(evidence.find(item => item.id === 'browser:browser:test')!.text);
  expect(saved.problem).toMatchObject({ browserProof: false, browserCoverage: 'stopped', browserEvidenceAttempt: 'earlier',
    runId: 'run-1', aiExplanation: 'The save response may not update the order view.', browserChecks: [{ observed: 'The page stayed on the form.' }] });
  const plan = presentSavedSelection(evidence)!;
  expect(plan.reply).toContain('Possible cause (saved AI explanation): The save response may not update the order view.');
  expect(plan.reply).toContain('The Browser Check stopped before it finished. Remaining behavior is unchecked.');
  expect(plan.reply).not.toContain('saved failed Browser result');
  expect(plan.explanation?.sections[0].limitations).toContain('The Browser Check stopped before it finished. Remaining behavior is unchecked.');
});

it('keeps whole-Check Browser counts unconfirmed when the saved run stopped', async () => {
  mocks.autoTest.mockResolvedValue({ id: 'browser', projectId: 'project', stage: 'failed', tests: [{
    id: 'test', name: 'Save order', state: 'failed', runId: 'run-2', checks: [{ id: 'confirmation', description: 'Order confirmation appears.', required: true }],
    checkResults: [{ checkId: 'confirmation', verdict: 'failed', observed: 'The page stayed on the form.' }],
    firstAttempt: { runId: 'run-1', state: 'failed', checkResults: [{ checkId: 'confirmation', verdict: 'failed', observed: 'The page stayed on the form.' }],
      explanation: 'The saved response may not update the order view.' },
  }] });
  const checkId = '123e4567-e89b-12d3-a456-426614174000';
  const evidence = await resolveConversationEvidence(client, 'owner', 'project', [{ checkId, autoTestId: 'browser' }], signal);
  const plan = presentSavedSelection(evidence)!;
  const browser = plan.explanation?.sections[0].check?.browser;
  expect(browser).toMatchObject({ testCountPartial: true, provenProblemCount: null, failedAssertionCount: 1,
    tests: [{ browserProof: false, explanation: 'The saved response may not update the order view.' }] });
  expect(plan.reply).toContain('Possible cause');
  expect(plan.reply).toContain('Remaining behavior is unchecked.');
  expect(plan.reply).not.toContain('confirmed 1 Browser-proven problem');
});

it('preserves proof semantics for historical Browser evidence without newer coverage fields', () => {
  const plan = presentSavedSelection([{ id: 'browser:old:test', text: JSON.stringify({ selectedTestId: 'test', problem: {
    kind: 'browser', title: 'Saved historical test', originalStatus: 'failed', browserChecks: [{ expected: 'Confirmation appears', observed: 'It did not.' }],
  } }) }]);
  expect(plan?.reply).toContain('Saved Browser problem: Saved historical test.');
  expect(plan?.explanation?.sections[0].problem?.browserProof).toBeUndefined();
});
