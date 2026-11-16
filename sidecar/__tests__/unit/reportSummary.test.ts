import { describe, expect, it } from 'vitest';
import { renderProjectReportMarkdown } from '../../src/report/markdown.js';
import { renderProjectReportPdf } from '../../src/report/pdf.js';
import { friendlyDate, summarizeReport } from '../../src/report/summary.js';
import { reportBrowserTests } from '../../src/report/snapshot.js';
import type { ProjectReportFinding, ProjectReportSnapshot, ReportCurrentFinding } from '../../src/report/types.js';

function finding(id: string, riskLevel: ProjectReportFinding['riskLevel'], overrides: Partial<ProjectReportFinding> = {}): ProjectReportFinding {
  return {
    id, projectId: 'p', sessionId: 'r', source: 'static', severity: riskLevel ?? 'info', priority: null, riskLevel,
    title: 'Issue ' + id, description: 'What is wrong with ' + id, status: 'new', createdAt: '2026-10-01T00:00:00.000Z',
    artifactId: null, category: 'security', evidenceText: '', recommendation: 'Fix ' + id, confidence: 'high',
    fromRemarks: false, filePath: 'src/' + id + '.ts', lineNumber: 7, ...overrides,
  };
}

function current(item: ProjectReportFinding, disposition: ReportCurrentFinding['effectiveDisposition'] = item.status): ReportCurrentFinding {
  return { ...item, persistedStatus: item.status, effectiveStatus: item.status, effectiveDisposition: disposition, latestOccurrence: null, lineageReferences: [], resolutionEvidence: null };
}

const usage = { status: 'unavailable' as const, reason: 'none', reviewSessionId: null, totals: null, byModel: [] };

function snapshot(overrides: Partial<ProjectReportSnapshot> = {}): ProjectReportSnapshot {
  return {
    metadata: { schemaVersion: 'centinel-project-report-v1', reportId: 'report-1', generatedAt: '2026-11-01T07:31:43.006Z', actorId: 'u', actorEmail: 'owner@example.com', generatorVersion: 'project-report-v4', riskPolicyVersion: 'risk-v1', outputFiles: { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' } },
    project: { id: 'p', name: 'Demo App', description: '', workspacePath: '/tmp', createdAt: '', updatedAt: '' },
    riskAssessment: { status: 'available', policyVersion: 'risk-v1', currentFindingCount: 0, critical: 0, high: 0, medium: 0, low: 0, unclassified: 0, items: [] },
    findings: [],
    currentFindings: { status: 'available', reason: null, items: [] },
    sourceInventory: { status: 'available', artifactCount: 0, artifacts: [] },
    requirements: { status: 'available', items: [] },
    standards: { status: 'available', items: [] },
    latestReview: null,
    modelUsage: usage,
    latestDynamicTest: null,
    ...overrides,
  } as ProjectReportSnapshot;
}

const review = (status: 'success' | 'failure' = 'success', decision: 'approved' | null = null): ProjectReportSnapshot['latestReview'] => ({
  status: 'available',
  session: { id: 'r', projectId: 'p', name: 'Launch review', reviewType: 'full', status, createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:20:00.000Z', summary: null, failureReason: status === 'failure' ? 'Provider timed out' : null },
  summary: null, findings: [], reportedFindings: [], carryoverFindings: [], recurringFindings: [], findingClassificationStatus: 'available',
  sourceManifest: { status: 'available', artifactCount: 12, capturedAt: null, sources: [] },
  traceability: { status: 'available', summary: { complete: 3, incomplete: 1, missing: 2, attention: 3 }, records: [], capturedAt: null },
  decision: decision ? { id: 'd', reviewId: 'r', projectId: 'p', decision, comment: null, actorId: 'u', createdAt: '2026-10-30T11:00:00.000Z', attachments: [] } as never : null,
  modelUsage: usage,
});

describe('plain-language report summary', () => {
  it('says "Not checked yet" when no review or browser test has finished', () => {
    const summary = summarizeReport(snapshot());
    expect(summary).toMatchObject({ tone: 'neutral', headline: 'Not checked yet', openIssues: 0, seriousIssues: 0 });
    expect(summary.codeReview.label).toBe('Not run');
    expect(summary.nextSteps).toEqual([
      'Run a code review so Centinel can check your source files.',
      'Run a browser test so Centinel can check your website in a real browser.',
    ]);
  });

  it('asks to fix serious open issues first and ignores resolved or dismissed ones', () => {
    const critical = finding('a', 'critical');
    const high = finding('b', 'high');
    const fixed = finding('c', 'critical');
    const dismissed = finding('d', 'medium', { status: 'dismissed' });
    const low = finding('e', 'low');
    const summary = summarizeReport(snapshot({
      latestReview: review(),
      currentFindings: { status: 'available', reason: null, items: [current(low), current(critical), current(fixed, 'resolved'), current(dismissed), current(high)] },
    }));
    expect(summary).toMatchObject({ tone: 'critical', headline: 'Fix before release', openIssues: 3, seriousIssues: 2 });
    expect(summary.riskCounts).toEqual({ critical: 1, high: 1, medium: 0, low: 1, unclassified: 0 });
    expect(summary.topIssues.map(issue => issue.id)).toEqual(['a', 'b', 'e']);
    expect(summary.topIssues[0]).toMatchObject({ whatIsWrong: 'What is wrong with a', howToFix: 'Fix a', location: 'src/a.ts:7', origin: 'Code review' });
    expect(summary.nextSteps[0]).toBe('Fix "Issue a": Fix a');
    expect(summary.nextSteps).toHaveLength(3);
  });

  it('flags a failed browser test as needing attention even with no open issues', () => {
    const summary = summarizeReport(snapshot({
      latestReview: review('success', 'approved'),
      latestDynamicTest: {
        status: 'available',
        session: { id: 't', projectId: 'p', name: 'Checkout', status: 'failure', targetUrl: 'http://localhost:3000', goal: 'Buy an item', missionType: 'user_journey', maxSteps: 10, createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:05:00.000Z' },
        summary: null, failureReason: 'The pay button did nothing.', evidence: [],
        actionTrace: [{ step: 1, action: 'click', target: 'Pay', result: 'ok' }, { step: 2, action: 'check', target: 'Receipt', result: 'failed: not shown' }],
      },
    }));
    expect(summary).toMatchObject({ tone: 'warning', headline: 'Needs attention' });
    expect(summary.explanation).toBe('No serious issues are open. The latest browser test failed.');
    expect(summary.browserTest).toMatchObject({ label: 'Failed', tone: 'critical' });
    expect(summary.browserTest.detail).toBe('The pay button did nothing. Recorded 2 steps, 1 failed.');
    expect(summary.codeReview.label).toBe('Approved');
    expect(summary.requirements).toEqual({ complete: 3, incomplete: 1, missing: 2 });
    expect(summary.nextSteps).toContain('Link 2 requirements to the code that implements them, so Centinel can check coverage.');
  });

  it('reads the Supabase Review lifecycle and shows a repeated issue once, explained issues first', () => {
    const pending = review();
    (pending as { session: { status: string } }).session.status = 'pending_approval';
    const rule = finding('rule', 'critical', { title: '[secrets-api-key] Possible hardcoded credential', filePath: 'src/users.js', lineNumber: 3 });
    const summary = summarizeReport(snapshot({
      latestReview: pending,
      currentFindings: { status: 'available', reason: null, items: [current(rule), current({ ...rule, id: 'rule-again' }), current(finding('idor', 'critical', { title: 'Order Ownership Check Missing' }))] },
    }));
    expect(summary.codeReview.label).toBe('Needs approval');
    expect(summary.topIssues.map(issue => issue.id)).toEqual(['idor', 'rule']);
    expect(summary.remainingIssues).toBe(0);
    expect(summarizeReport(snapshot({ latestReview: pending })).nextSteps).toContain('Open the latest code review and approve it or request changes.');
  });

  it('reports "Looking good" only when checks ran and nothing is open', () => {
    const summary = summarizeReport(snapshot({ latestReview: review('success', 'approved') }));
    expect(summary).toMatchObject({ tone: 'good', headline: 'Looking good', openIssues: 0 });
  });

  it('labels a partly verified review "Completed with gaps" and lists the unverified parts in every format', async () => {
    const base = review('success')!;
    const gaps = { ...base, session: { ...base.session, status: 'pending_approval' as never, coverage: { coverage: 'partial' as const, unverifiedPartCount: 1,
      unverifiedParts: [{ reason: 'semantic_support' as const, files: ['src/checkout.ts'], features: ['POST /checkout'] }] } } };
    const report = snapshot({ latestReview: gaps });
    const summary = summarizeReport(report);
    expect(summary.codeReview).toMatchObject({ label: 'Completed with gaps', tone: 'warning' });
    expect(summary.codeReview.detail).toContain('1 part of the code could not be verified');
    expect(summary.unverifiedParts).toEqual(['src/checkout.ts: the conclusions could not be backed up with evidence from the code.']);
    expect(summary).toMatchObject({ headline: 'Needs attention' });
    expect(summary.explanation).toContain('completed with gaps');
    const markdown = renderProjectReportMarkdown(report);
    expect(markdown).toContain('**Code review — Completed with gaps.**');
    expect(markdown).toContain('    - src/checkout.ts: the conclusions could not be backed up with evidence from the code.');
    expect((await renderProjectReportPdf(report)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(summarizeReport(snapshot({ latestReview: review() })).unverifiedParts).toEqual([]);
  });

  it('counts reworded repeats of one issue once and keeps the raw occurrence count', () => {
    const verified = finding('auth', 'critical', { title: 'Missing Account Update Authorization', filePath: 'backend/user-routes.ts', lineNumber: 87, mergedObservationCount: 2 });
    const reworded = finding('auth-2', 'high', { title: 'Account update authorization not enforced', filePath: 'backend/user-routes.ts', lineNumber: 91 });
    const otherIssue = finding('amount', 'medium', { title: 'Payment amount not validated', filePath: 'backend/user-routes.ts', lineNumber: 89, category: 'business' });
    const report = snapshot({ latestReview: review(), currentFindings: { status: 'available', reason: null, items: [current(reworded), current(verified), current(otherIssue)] } });
    const summary = summarizeReport(report);
    expect(summary).toMatchObject({ openIssues: 2, openOccurrences: 5, seriousIssues: 1 });
    expect(summary.riskCounts).toEqual({ critical: 1, high: 0, medium: 1, low: 0, unclassified: 0 });
    expect(summary.topIssues.map(issue => issue.id)).toEqual(['auth', 'amount']);
    expect(renderProjectReportMarkdown(report)).toContain('| 2 (5 occurrences) | 1 |');
  });

  it('formats readable UTC dates', () => {
    expect(friendlyDate('2026-11-01T07:31:43.006Z')).toBe('1 Nov 2026, 07:31 UTC');
    expect(friendlyDate(null)).toBe('Unavailable');
  });

  it('puts the summary first and technical details second in Markdown and PDF', async () => {
    const report = snapshot({ latestReview: review(), currentFindings: { status: 'available', reason: null, items: [current(finding('a', 'high'))] } });
    const markdown = renderProjectReportMarkdown(report);
    const summaryAt = markdown.indexOf('## Part 1: Summary');
    const technicalAt = markdown.indexOf('## Part 2: Technical details');
    expect(summaryAt).toBeGreaterThan(-1);
    expect(technicalAt).toBeGreaterThan(summaryAt);
    expect(markdown.slice(summaryAt, technicalAt)).toContain('**Fix before release**');
    expect(markdown.slice(technicalAt)).toContain('**Project ID:** `p`');
    const pdf = await renderProjectReportPdf(report);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

describe('browser tests from Auto test in the report', () => {
  const autoSession = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1, id: 'auto-1', projectId: 'p', ownerId: 'u', folder: '/x', createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:08:00.000Z', stage: 'completed',
    error: null, repository: null, launch: { recipeId: 'r', label: 'node server.js', framework: 'node', url: 'http://localhost:4101', portHonored: true, installing: false, log: '' },
    exploration: null, lanes: [], laneLimit: 3, laneNote: null, dropped: [], summary: { passed: 1, failed: 1, uncertain: 0, blocked: 0, notTested: 0, limitations: ['Only the journeys listed were tested; this is not a complete test of the app.'] },
    tests: [
      { id: 't1', name: 'Unknown email gets the generic error', goal: 'Type nobody@example.com and click Sign in.', rationale: '', requirementRef: 'REQ-1', sourceRefs: [{ path: 'server.js', line: 43 }], startPath: '/', state: 'failed', runId: 'run-1',
        checks: [{ id: 'c1', criterionId: 'REQ-1', description: 'Generic error shown', required: true, kind: 'visible_text', expected: 'Email or password is incorrect.' }],
        checkResults: [{ checkId: 'c1', criterionId: 'REQ-1', verdict: 'failed', observed: 'Expected visible text absent.', reason: '', evidenceIds: [] }], explanation: 'AI text that must not appear' },
      { id: 't2', name: 'Checkout total', goal: 'Add a mug.', rationale: '', requirementRef: null, sourceRefs: [], startPath: '/', state: 'passed', runId: 'run-2', checks: [], checkResults: [] },
    ],
    ...overrides,
  });

  it('takes only the latest finished full Auto test, never conversation requests', () => {
    const latest = reportBrowserTests([autoSession(), autoSession({ id: 'ask', createdAt: '2026-11-14T10:00:00.000Z', request: { text: 'x', base: null, history: [] } })] as never);
    expect(latest).toMatchObject({ sessionId: 'auto-1', passed: 1, failed: 1, startedWith: 'node server.js' });
    expect(latest?.tests[0].checks[0]).toEqual({ description: 'Generic error shown', expected: 'Email or password is incorrect.', verdict: 'failed', observed: 'Not shown on the page.' });
    expect(JSON.stringify(latest)).not.toContain('AI text that must not appear');
    expect(reportBrowserTests([autoSession({ stage: 'failed' })] as never)).toBeNull();
  });

  it('puts the browser results in the summary, the Markdown and the PDF', async () => {
    const report = snapshot({ browserTests: reportBrowserTests([autoSession()] as never) });
    const summary = summarizeReport(report);
    expect(summary.browserTest).toMatchObject({ source: 'auto', label: '1 of 2 failed', tone: 'critical' });
    expect(summary.nextSteps.join(' ')).toContain('"Unknown email gets the generic error" did not pass');
    const markdown = renderProjectReportMarkdown(report);
    expect(markdown).toContain('- **Browser tests — 1 of 2 failed.**');
    expect(markdown).toContain('### 1. Unknown email gets the generic error — Failed');
    expect(markdown).toContain('| Generic error shown | Email or password is incorrect. | failed | Not shown on the page. |');
    expect(markdown).toContain('**Related code:** `server.js:43`');
    expect((await renderProjectReportPdf(report)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('summarises the full check even when a single test ran later', () => {
    const later = { status: 'available', session: { id: 'd', projectId: 'p', name: 'Single test', status: 'success', targetUrl: 'http://x', goal: 'g', missionType: 'guided', maxSteps: 5, createdAt: '2026-11-14T10:00:00.000Z', updatedAt: '2026-11-14T10:01:00.000Z' }, summary: null, failureReason: null, evidence: [], actionTrace: [] };
    const summary = summarizeReport(snapshot({ browserTests: reportBrowserTests([autoSession()] as never), latestDynamicTest: later as never }));
    expect(summary.browserTest).toMatchObject({ source: 'auto', label: '1 of 2 failed' });
  });

  it('keeps an older report without browser tests unchanged', () => {
    expect(summarizeReport(snapshot()).browserTest.source ?? null).toBeNull();
    expect(renderProjectReportMarkdown(snapshot())).toContain('*Unavailable: no full browser test (Auto test) has finished for this project.*');
  });
});
