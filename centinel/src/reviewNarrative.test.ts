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
  it('preserves original sentence references and offers a simpler presentation', () => {
    expect(objectivePoints('Verify src/observer.test.ts at version 1.2. Reject invalid input.\n- Require N1 approval.')).toEqual(['Verify src/observer.test.ts at version 1.2.', 'Reject invalid input.', 'Require N1 approval.']);
    expect(objectivePoints(null)).toEqual([]);
    expect(plainReviewText('Assess N1 in acceptance_requirements.md at frozen revision 250f2610daf41ce646d847eff8bb43ead6cf0363.')).toBe('Assess N1 in the acceptance criteria at the selected version.');
    expect(plainReviewText('Verify persistence/cursor atomicity.')).toContain('saving data and updating progress together');
  });
  it('uses stage-specific finding links and excludes full descriptions and raw metadata', () => {
    const events = [event('run_model', 'completed', '2026-10-18T00:01:00Z', { input: { prompt: 'PRIVATE PROMPT' }, output: { reasoning: 'PRIVATE THOUGHT' }, durationMs: 2000 }, 'model_analysis')];
    const result = buildReviewNarrative({ session, trace: trace(events), findings: [finding, { ...finding, id: 'old', verifier: undefined }] });
    expect(result.stages[3].findings).toEqual([{ id: finding.id, label: plainReviewText(finding.title), aspect: 'Business rules' }]);
    expect(result.stages[0].findings).toEqual([]);
    expect(result.unassignedFindings.map(item => item.id)).toEqual(['old']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|FULL PRIVATE FINDING DETAIL/);
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
    expect(result.timing.completedAt).toBe('2026-10-18T00:00:10.000Z');
  });
  it('recovers timing when audit timestamps tie or a start row is missing', () => {
    const result = buildReviewNarrative({ session, trace: trace([event('run_model', 'completed', '2026-10-18T00:01:00Z', { durationMs: 35416 }, 'model_analysis')]), findings: [] });
    expect(result.timing.duration).toBe('35s');
    expect(result.stages[3].duration).toBe('35s');
    expect(formatReviewDuration(null)).toBe('Not recorded');
    expect(formatReviewDuration(3601000)).toBe('1h 0m 1s');
  });
  it('reports live elapsed time and never treats interrupted work as a pass', () => {
    const events = [event('read_source', 'started', '2026-10-18T00:00:00Z')];
    const live = buildReviewNarrative({ session: { ...session, status: 'running' }, trace: trace(events), findings: [], now: Date.parse('2026-10-18T00:00:12Z') });
    expect(live.timing.duration).toBe('12s');
    expect(live.timing.completedAt).toBeNull();
    expect(live.stages[0].state).toBe('In progress');
    expect(live.stages[0].purpose).toContain('I’ll start');
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
