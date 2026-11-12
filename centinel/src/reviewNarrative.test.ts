import { describe, expect, it } from 'vitest';
import { buildReviewNarrative, objectivePoints, plainReviewText, formatReviewDuration } from './reviewNarrative';
import type { ReviewHarnessTrace, HarnessEvent } from './reviewHarness';
import type { Finding, StaticSession } from './types';

const session = { id: 'review-1', projectId: 'project-1', name: 'Observer review', status: 'pending_approval',
  configJson: JSON.stringify({ instructions: 'Verify N1 against observer.ts. Reject invalid input.' }),
  progressJson: JSON.stringify({ stage: 'complete', updatedAt: '2026-10-18T00:01:00Z' }), remarks: '', failureReason: '' } as StaticSession;
const finding = { id: 'finding-1', title: 'Parser accepts malformed input', category: 'business logic', verifier: 'model',
  description: 'FULL PRIVATE FINDING DETAIL', recommendation: 'Reject the marker.', evidenceText: 'parser.ts:31', filePath: 'parser.ts', lineNumber: 31, status: 'new' } as Finding;
const event = (step: string, kind: string, time: string, detail: Record<string, unknown> = {}, stage = 'freezing_sources'): HarnessEvent => ({
  reviewId: session.id, stage, event: 'harness_step_' + kind, createdAt: time, detail: { step, executionId: step, ...detail },
});
const trace = (events: HarnessEvent[], modelStatus = 'succeeded'): ReviewHarnessTrace => ({
  workflow: { version: 'v1', reference: '', stages: [] }, review: { id: session.id, name: session.name, status: session.status, modelStatus, progress: { stage: 'complete', completedStages: [] }, updatedAt: '' }, events,
});
describe('review narrative', () => {
  it('summarizes recorded project comparison outcomes without inventing verification for older reviews', () => {
    const result = buildReviewNarrative({ session, findings: [], trace: trace([event('correlate_findings', 'completed', '2026-10-18T00:01:00Z',
      { output: { checkedProjectHistory: true, counts: { new: 1, recurring: 2, regressed: 0, resolved: 3, carried_over: 1 }, ambiguousCount: 1 } }, 'persisting_evidence')]) });
    expect(result.summary.outcome).toContain('3 not reproduced after comparable source changes');
    expect(result.stages[4].outcome).toContain('1 uncertain matches');
    const legacy = buildReviewNarrative({ session, findings: [], trace: trace([event('correlate_findings', 'completed', '2026-10-18T00:01:00Z', {}, 'persisting_evidence')]) });
    expect(legacy.summary.outcome).not.toContain('I compared the findings');
  });
  it('does not report zero findings while the findings are still loading', () => {
    expect(buildReviewNarrative({ session, findings: [], findingsLoading: true }).summary.outcome).toContain('The findings are still loading.');
    expect(buildReviewNarrative({ session, findings: [finding] }).summary.outcome).toContain('There is 1 finding for this review');
  });
  it('preserves original sentence references and offers a simpler presentation', () => {
    expect(objectivePoints('Verify src/observer.test.ts at version 1.2. Reject invalid input.\n- Require N1 approval.')).toEqual(['Verify src/observer.test.ts at version 1.2.', 'Reject invalid input.', 'Require N1 approval.']);
    expect(objectivePoints(null)).toEqual([]);
    expect(plainReviewText('Assess N1 in acceptance_requirements.md at frozen revision 250f2610daf41ce646d847eff8bb43ead6cf0363.')).toBe('Assess N1 in the acceptance criteria at the selected version.');
    expect(plainReviewText('Verify persistence/cursor atomicity.')).toContain('saving data and updating progress together');
  });
  it('uses stage-specific finding links and excludes full descriptions and raw metadata', () => {
    const events = [event('run_model', 'completed', '2026-10-18T00:01:00Z', { input: { prompt: 'PRIVATE PROMPT' }, output: { reasoning: 'PRIVATE THOUGHT' }, durationMs: 2000 }, 'model_analysis')];
    const result = buildReviewNarrative({ session, trace: trace(events), findings: [finding, { ...finding, id: 'old', title: 'Separate historic issue', verifier: undefined }] });
    expect(result.stages[3].findings).toEqual([{ id: finding.id, label: plainReviewText(finding.title), aspect: 'Business rules', filePath: 'parser.ts', lineNumber: 31 }]);
    expect(result.stages[0].findings).toEqual([]);
    expect(result.unassignedFindings.map(item => item.id)).toEqual(['old']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|FULL PRIVATE FINDING DETAIL/);
  });
  it('describes paths in the submitted batch while their assessments are pending', () => {
    const activity = trace([event('run_model', 'started', '2026-10-18T00:00:00Z',
      { input: { featureIds: ['checkout'], reasoning: 'PRIVATE THOUGHT' } }, 'model_analysis')]);
    activity.analysisMap = {
      schemaVersion: 1, status: 'unverified',
      coverage: { sourceArtifacts: 1, parsedArtifacts: 1, exhaustive: false, unresolvedEdgeCount: 0, limitations: [], unsupportedArtifacts: [] },
      features: [{ id: 'checkout', label: 'Checkout', provisional: true, entryPoints: [], assessments: [], unresolved: [],
        paths: [{ id: 'stock', label: 'Check stock', kind: 'branch', status: 'unverified', evidence: [] }] }],
    };
    const result = buildReviewNarrative({ session: { ...session, status: 'running' }, trace: activity, findings: [] });
    expect(result.stages[3].features?.[0].summary).toContain('Check stock');
    expect(result.stages[3].features?.[0].summary).toContain('pending validation');
    expect(JSON.stringify(result)).not.toContain('PRIVATE THOUGHT');
  });
  it('computes elapsed wall time without adding overlapping and nested steps', () => {
    const events = [
      event('read_source', 'started', '2026-10-18T00:00:00Z'),
      event('load_grounding', 'started', '2026-10-18T00:00:02Z'),
      event('load_grounding', 'completed', '2026-10-18T00:00:09Z', { durationMs: 7000 }),
      event('read_source', 'completed', '2026-10-18T00:00:10Z', { durationMs: 10000 }),
    ];
    const result = buildReviewNarrative({ session: { ...session, updatedAt: '2027-01-01T00:00:00Z' }, trace: trace(events), findings: [] });
    expect(result.timing.duration).toBe('10s');
    expect(result.stages[0].duration).toBe('10s');
    expect(result.timing.endedAt).toBe('2026-10-18T00:00:10.000Z');
  });
  it('recovers timing when audit timestamps tie or a start row is missing', () => {
    const result = buildReviewNarrative({ session, trace: trace([event('run_model', 'completed', '2026-10-18T00:01:00Z', { durationMs: 35416 }, 'model_analysis')]), findings: [] });
    expect(result.timing.duration).toBe('35s');
    expect(result.stages[3].duration).toBe('35s');
    expect(formatReviewDuration(null)).toBe('Not recorded');
    expect(formatReviewDuration(3601000)).toBe('1h 0m 1s');
  });
  it('preserves the recorded execution stop boundary without treating later decisions as execution time', () => {
    const events = [event('run_model', 'failed', '2026-10-18T00:01:00Z', { durationMs: 30000 }, 'model_analysis')];
    for (const status of ['blocked', 'failed', 'cancelled'] as const) {
      const stopped = buildReviewNarrative({ session: { ...session, status, updatedAt: '2027-01-01T00:00:00Z' }, trace: trace(events, 'partial'), findings: [] });
      expect(stopped.timing).toEqual({ duration: '30s', endedAt: '2026-10-18T00:01:00.000Z' });
    }
  });
  it('reports live elapsed time and never treats interrupted work as a pass', () => {
    const events = [event('read_source', 'started', '2026-10-18T00:00:00Z')];
    const live = buildReviewNarrative({ session: { ...session, status: 'running' }, trace: trace(events), findings: [], now: Date.parse('2026-10-18T00:00:12Z') });
    expect(live.timing.duration).toBe('12s');
    expect(live.timing.endedAt).toBeNull();
    expect(live.stages[0].state).toBe('In progress');
    expect(live.stages[0]).toMatchObject({
      focus: 'Selected file versions and confirmed requirements.',
      goal: 'Record what this Review can assess and where evidence is missing.',
      next: 'No action needed while the Review runs.',
    });
    expect(live.stages[1].state).toBe('Not started');
    const failed = buildReviewNarrative({ session: { ...session, status: 'failed' }, trace: trace(events), findings: [] });
    expect(failed.stages[0].state).toBe('Interrupted');
    expect(failed.stages[1].state).toBe('Not reached');
    expect(failed.summary.next).toContain('retry');
  });
  it('does not invent history, completed checks or timing', () => {
    const result = buildReviewNarrative({ session, findings: [finding] });
    expect(result.stages).toEqual([]);
    expect(result.timing.duration).toBe('Not recorded');
    expect(result.summary.blockers.join(' ')).toContain('activity history is unavailable');
    const wrong = trace([event('read_source', 'completed', '2026-10-18T00:00:00Z')]); wrong.review.id = 'other';
    expect(buildReviewNarrative({ session, trace: wrong, findings: [] }).detailedHistoryAvailable).toBe(false);
  });
  it('explains the recorded active stage while detailed history is unavailable', () => {
    const running = { ...session, status: 'running' as const, progressJson: JSON.stringify({
      stage: 'model_analysis', completedStages: ['freezing_sources'],
    }) };
    const result = buildReviewNarrative({ session: running, findings: [] });
    expect(result.stages[3]).toMatchObject({
      state: 'In progress', duration: 'Not recorded', outcome: '',
      goal: 'Identify behaviour gaps and record what remains unverified.',
    });
    expect(result.stages[0].state).toBe('Completed');
    expect(result.stages[4].state).toBe('Not started');
  });
  it('keeps incomplete analysis, missing findings and human decisions distinct', () => {
    const result = buildReviewNarrative({ session, trace: trace([], 'partial'), findings: [], findingsError: 'offline' });
    expect(result.summary.outcome).toContain('only complete part');
    expect(result.summary.outcome).toContain('count is unavailable');
    expect(result.summary.blockers.join(' ')).toContain('behaviour review could not');
    const approved = buildReviewNarrative({ session, findings: [finding], decision: { decision: 'approved' } as any });
    expect(approved.summary.outcome).toContain('You approved');
    expect(approved.summary.next).toContain('does not fix');
    const changes = buildReviewNarrative({ session: { ...session, currentDecision: { decision: 'changes_requested' } as any }, findings: [] });
    expect(changes.summary.outcome).toContain('You requested changes');
    expect(changes.summary.next).toContain('Address the requested changes');
  });
  it('keeps document gaps in the document-check stage', () => {
    const doc = { ...finding, id: 'doc', evidenceGap: { assessmentId: 'a', code: 'missing_documents' } };
    const result = buildReviewNarrative({ session, trace: trace([event('load_grounding', 'completed', '2026-10-18T00:00:00Z', { output: { confirmedRequirements: 0 } })]), findings: [doc] });
    expect(result.stages[0].findings[0].id).toBe('doc');
    expect(result.stages[3].findings).toEqual([]);
    expect(result.stages[0].outcome).toContain('couldn’t confirm');
  });
});
