import { describe, expect, it } from 'vitest';
import { renderProjectReportMarkdown } from '../../src/report/markdown.js';
import { renderProjectReportPdf } from '../../src/report/pdf.js';
import { friendlyDate, summarizeReport } from '../../src/report/summary.js';
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
    expect(summary.nextSteps).toContain('Add or link code for 2 requirements with no matching implementation.');
  });

  it('reports "Looking good" only when checks ran and nothing is open', () => {
    const summary = summarizeReport(snapshot({ latestReview: review('success', 'approved') }));
    expect(summary).toMatchObject({ tone: 'good', headline: 'Looking good', openIssues: 0 });
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
