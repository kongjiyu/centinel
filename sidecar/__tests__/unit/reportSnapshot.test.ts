import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProjectReportSnapshot, renderProjectReport, renderProjectReportFiles, renderProjectReportJson } from '../../src/reportExport.js';
import { makeReportChecksums } from '../../src/report/storage.js';
import { calculateProjectRisk } from '../../src/projectRisk.js';
import type { ReportSnapshotSource } from '../../src/report/snapshot.js';
import type { Project } from '../../src/projects.js';
import type { Artifact } from '../../src/artifacts.js';
import type { Requirement, RequirementMapping } from '../../src/staticDomainTypes.js';
import type { DynamicEvidence, DynamicSession } from '../../src/dynamicSessions.js';
import type { Finding, ReviewDecisionRecord, StaticSession } from '../../src/staticDomainTypes.js';
import type { ReviewSourceManifest, ReviewTraceabilitySnapshot } from '../../src/review/evidenceTypes.js';
import type { TokenUsageSummary } from '../../src/tokenUsage.js';

const project: Project = {
  id: 'proj-1', name: 'Test Project', description: 'Quality workspace', workspacePath: path.resolve('fixtures/project'),
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
};
const artifact: Artifact = {
  id: 'artifact-1', projectId: project.id, type: 'requirement', source: 'document',
  fileName: 'requirements.md', filePath: path.join(project.workspacePath, 'requirements.md'),
  originalPath: null, contentHash: 'hash-1', createdAt: '2026-09-20T00:00:00.000Z',
};
const standard: Artifact = {
  ...artifact, id: 'standard-1', type: 'coding_standard', fileName: 'security-standard.md',
  filePath: path.join(project.workspacePath, 'security-standard.md'), contentHash: 'hash-2',
};
const requirement: Requirement = {
  id: 'requirement-1', projectId: project.id, title: 'Reject invalid credentials',
  description: 'Invalid credentials must not create a session.', category: 'security', priority: 'high',
  createdAt: '2026-09-20T00:00:00.000Z',
};
const mapping: RequirementMapping = {
  id: 'mapping-1', requirementId: requirement.id, fileId: artifact.id, symbolId: null,
  coverageStatus: 'complete', confidence: 0.96,
};
const review: StaticSession = {
  id: 'review-1', projectId: project.id, name: 'Security review', reviewType: 'requirement_review',
  status: 'success', configJson: '{"instructions":"PRIVATE_REVIEW_CONFIG"}',
  progressJson: '{"thoughts":["PRIVATE_HIDDEN_REASONING"]}', remarks: 'PRIVATE_REVIEW_REMARK',
  finalSummary: 'Reviewed auth requirements and persisted source evidence.', failureReason: '',
  createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:02:00.000Z',
  baseRef: '', headRef: '', changedFilesJson: '[]', parentSessionId: '', reviewDiffJson: '',
};
const finding: Finding = {
  id: 'finding-1', projectId: project.id, sessionId: review.id, source: 'static',
  severity: 'critical', priority: 'high', title: 'Credential comparison is not constant-time',
  description: 'Authentication compares secret values using a timing-sensitive branch.',
  status: 'carryover', createdAt: '2026-09-20T10:01:00.000Z', artifactId: artifact.id,
  category: 'security', evidenceText: 'if (candidate === storedSecret) { ... }',
  recommendation: 'Use a constant-time comparison helper.', confidence: 'high',
  fromRemarks: false, filePath: path.join(project.workspacePath, 'src', 'auth.ts'), lineNumber: 42,
};
const manifest: ReviewSourceManifest = {
  sessionId: review.id, projectId: project.id, status: 'available',
  capturedAt: '2026-09-20T10:01:00.000Z', updatedAt: '2026-09-20T10:01:00.000Z', artifactCount: 1,
  sources: [{
    id: 'source-1', sessionId: review.id, sourceId: artifact.id, sourceKind: 'document',
    label: 'requirements.md', artifactIds: [artifact.id], filesReviewed: 1, contentHashes: [artifact.contentHash],
    capturedAt: '2026-09-20T10:01:00.000Z',
  }],
};
const traceability: ReviewTraceabilitySnapshot = {
  sessionId: review.id, projectId: project.id, status: 'available',
  capturedAt: '2026-09-20T10:02:00.000Z', updatedAt: '2026-09-20T10:02:00.000Z',
  summary: { complete: 1, incomplete: 0, missing: 0, attention: 0 },
  records: [{
    requirementId: requirement.id, title: requirement.title, description: requirement.description,
    category: requirement.category, state: 'complete', mappingIds: [mapping.id],
    sourceArtifactIds: [artifact.id], confidence: 0.96, capturedAt: '2026-09-20T10:02:00.000Z',
  }],
};
const decision: ReviewDecisionRecord = {
  id: 'decision-1', sessionId: review.id, projectId: project.id, decision: 'approved',
  comment: 'Approved with the carryover item tracked.', reviewer: 'Quality lead',
  createdAt: '2026-09-20T10:03:00.000Z',
  attachments: [{ id: 'attachment-1', fileName: 'approval-note.txt', mimeType: 'text/plain', createdAt: '2026-09-20T10:03:00.000Z' }],
};
const dynamic: DynamicSession = {
  id: 'dynamic-1', projectId: project.id, type: 'dynamic', name: 'Sign-in smoke test', status: 'success',
  targetUrl: 'https://app.example.test/sign-in?access_token=private-url-token',
  goal: 'Confirm sign-in rejects invalid credentials.', missionType: 'smoke', browserMode: 'headed', maxSteps: 6,
  finalSummary: 'The sign-in page loaded and rejected invalid credentials.', failureReason: '',
  createdAt: '2026-09-20T11:00:00.000Z', updatedAt: '2026-09-20T11:02:00.000Z',
};
const dynamicEvidence: DynamicEvidence[] = [
  { id: 'ev-1', type: 'action_trace', filePath: path.join(project.workspacePath, 'action-trace.json'), summary: 'User-visible action trace.', createdAt: dynamic.updatedAt },
  { id: 'ev-2', type: 'console_log', filePath: path.join(project.workspacePath, 'console.json'), summary: 'PRIVATE_CONSOLE_PAYLOAD', createdAt: dynamic.updatedAt },
  { id: 'ev-3', type: 'ai_response', filePath: path.join(project.workspacePath, 'model-response.json'), summary: 'Hidden model response file.', createdAt: dynamic.updatedAt },
];
const emptyUsage: TokenUsageSummary = {
  totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, calls: 0 }, byGroup: [], recent: [],
};
const reviewUsage: TokenUsageSummary = {
  totals: { input: 120, output: 42, cacheRead: 10, cacheCreation: 4, calls: 1 },
  byGroup: [{
    provider: 'custom', apiFormat: 'openai-compatible', model: 'review-model',
    totalInput: 120, totalOutput: 42, totalCacheRead: 10, totalCacheCreation: 4, totalCalls: 1,
  }], recent: [],
};
const projectUsage: TokenUsageSummary = {
  totals: { input: 128, output: 45, cacheRead: 10, cacheCreation: 4, calls: 2 },
  byGroup: reviewUsage.byGroup, recent: [],
};

function fixtureSource(populated: boolean): ReportSnapshotSource {
  const findings = populated ? [finding] : [];
  return {
    getProject: async projectId => projectId === project.id ? project : null,
    listStaticSessions: async () => populated ? [review] : [],
    listDynamicSessions: async () => populated ? [dynamic] : [],
    listDynamicEvidence: async () => populated ? dynamicEvidence : [],
    listDynamicActions: async () => populated ? [{
      step: 1, action: 'navigate', target: 'Sign-in page',
      result: 'Loaded; Authorization: Bearer private-action-token',
    }] : [],
    listAllFindings: async () => findings,
    listStaticFindings: async () => findings,
    listArtifacts: async () => populated ? [artifact, standard] : [],
    listRequirements: async () => populated ? [requirement] : [],
    getRequirementMappings: async () => populated ? [mapping] : [],
    getProjectAssessment: async projectId => ({
      projectId, status: 'available', policyVersion: 'risk-v1', ...calculateProjectRisk(findings),
      traceability: populated
        ? { status: 'available', reviewId: review.id, summary: traceability.summary }
        : { status: 'unavailable', reviewId: null, summary: null },
    }),
    getReviewSourceManifest: async () => populated ? manifest : null,
    getReviewTraceabilitySnapshot: async () => populated ? traceability : null,
    getCurrentDecision: async () => populated ? decision : null,
    getTokenUsageSummary: async (_projectId, reviewId) => populated ? (reviewId ? reviewUsage : projectUsage) : emptyUsage,
  };
}

describe('immutable project report from a persistence-neutral source', () => {
  it('marks absent history unavailable and deeply freezes one canonical snapshot', async () => {
    const snapshot = await buildProjectReportSnapshot(project.id, {
      source: fixtureSource(false), reportId: 'report-unavailable', generatedAt: '2026-09-21T00:00:00.000Z',
    });
    expect(snapshot.latestReview).toBeNull();
    expect(snapshot.latestDynamicTest).toBeNull();
    expect(snapshot.modelUsage.status).toBe('unavailable');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.riskAssessment)).toBe(true);
    expect(Object.isFrozen(snapshot.findings)).toBe(true);
    expect(renderProjectReportJson(snapshot)).toContain('"reportId": "report-unavailable"');
    expect(renderProjectReport(snapshot)).toContain('Unavailable: no terminal Review record');
  });

  it('includes findings, states, evidence, traceability, usage, and latest Dynamic facts without private reasoning', async () => {
    const snapshot = await buildProjectReportSnapshot(project.id, {
      source: fixtureSource(true), reportId: 'report-complete', generatedAt: '2026-09-21T00:00:00.000Z',
    });
    const json = renderProjectReportJson(snapshot);
    const markdown = renderProjectReport(snapshot);
    expect(snapshot.riskAssessment.currentFindingCount).toBe(1);
    expect(snapshot.riskAssessment.critical).toBe(1);
    expect(snapshot.findings[0].status).toBe('carryover');
    expect(snapshot.latestReview?.reportedFindings).toHaveLength(0);
    expect(snapshot.latestReview?.carryoverFindings).toHaveLength(1);
    expect(snapshot.latestReview?.decision?.attachments[0].fileName).toBe('approval-note.txt');
    expect(snapshot.latestReview?.sourceManifest.artifactCount).toBe(1);
    expect(snapshot.latestReview?.traceability.records[0].state).toBe('complete');
    expect(snapshot.latestReview?.modelUsage.totals?.input).toBe(120);
    expect(snapshot.modelUsage.totals?.calls).toBe(2);
    expect(snapshot.requirements.items[0].mappings[0].coverageStatus).toBe('complete');
    expect(snapshot.standards.items[0].title).toBe('security-standard.md');
    expect(snapshot.latestDynamicTest?.actionTrace[0].result).toContain('[redacted]');
    expect(snapshot.latestDynamicTest?.evidence.map(item => item.type)).toEqual(['action_trace']);
    for (const fact of [
      'Test Project', 'Credential comparison is not constant-time', 'carryover', 'security-standard.md',
      'Reject invalid credentials', 'Approved with the carryover item tracked.', '120', 'Sign-in smoke test',
    ]) {
      expect(json).toContain(fact);
      expect(markdown).toContain(fact);
    }
    for (const secret of [
      'PRIVATE_CONSOLE_PAYLOAD', 'PRIVATE_REVIEW_REMARK', 'PRIVATE_REVIEW_CONFIG',
      'PRIVATE_HIDDEN_REASONING', 'private-action-token', 'private-url-token', 'Hidden model response file',
    ]) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
  });

  it('renders one immutable snapshot in three formats with verifiable hashes', async () => {
    const snapshot = await buildProjectReportSnapshot(project.id, {
      source: fixtureSource(true), reportId: 'report-fixture', generatedAt: '2026-09-23T00:00:00.000Z',
      outputFiles: { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' },
    });
    const { json, markdown, pdf } = await renderProjectReportFiles(snapshot);
    const checksums = makeReportChecksums({ json, markdown, pdf });
    expect(JSON.parse(json).metadata.outputFiles).toEqual({ json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' });
    expect(markdown).toContain(dynamic.finalSummary);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(checksums.snapshot).toBe(crypto.createHash('sha256').update(json).digest('hex'));
    expect(checksums.markdown).toBe(crypto.createHash('sha256').update(markdown).digest('hex'));
    expect(checksums.pdf).toBe(crypto.createHash('sha256').update(pdf).digest('hex'));
    const visualOutput = process.env.CENTINEL_REPORT_VISUAL_TEST_OUTPUT;
    if (visualOutput) {
      fs.mkdirSync(path.dirname(visualOutput), { recursive: true });
      fs.writeFileSync(visualOutput, pdf);
    }
  });

  it('rejects an unknown project without creating a report', async () => {
    await expect(buildProjectReportSnapshot('missing', { source: fixtureSource(false) })).rejects.toThrow('Project not found');
  });
});
