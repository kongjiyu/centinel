import { describe, expect, it } from 'vitest';
import { ReviewHarness } from '../../src/review/harness.js';
import { validateFindingLocations } from '../../src/review/locationValidation.js';
import type { ReviewAuditEvent, StaticFindingInput } from '../../src/review/types.js';
import type { Artifact } from '../../src/artifacts.js';

describe('Review harness audit boundaries', () => {
  it('pairs persisted start and completion events without recording operation contents', async () => {
    const events: Array<Omit<ReviewAuditEvent, 'createdAt'>> = [];
    const harness = new ReviewHarness({ reviewId: 'review', projectId: 'project' }, async event => { events.push(event); });
    expect(await harness.step('model_analysis', 'run_model', { attempt: 1 }, async () => 'private source and token', () => ({ findings: 2 }))).toBe('private source and token');
    expect(events.map(event => event.event)).toEqual(['harness_step_started', 'harness_step_completed']);
    expect(events[1].detail).toMatchObject({ executionId: events[0].detail?.executionId, output: { findings: 2 }, durationMs: expect.any(Number) });
    expect(JSON.stringify(events)).not.toContain('private source and token');
  });

  it.each(['Error', 'AbortError'])('records a safe outcome for %s and preserves the original exception', async name => {
    const events: Array<Omit<ReviewAuditEvent, 'createdAt'>> = [];
    const harness = new ReviewHarness({ reviewId: 'review', projectId: 'project' }, async event => { events.push(event); });
    const error = new Error('secret API token');
    error.name = name;
    await expect(harness.step('model_analysis', 'run_model', {}, async () => { throw error; })).rejects.toBe(error);
    expect(events[1].event).toBe(name === 'AbortError' ? 'harness_step_cancelled' : 'harness_step_failed');
    expect(JSON.stringify(events)).not.toContain('secret API token');
  });

  it('does not run a step if its start cannot be audited', async () => {
    let ran = false;
    const harness = new ReviewHarness({ reviewId: 'review', projectId: 'project' }, async () => { throw new Error('storage'); });
    await expect(harness.step('freezing_sources', 'freeze_manifest', {}, async () => { ran = true; })).rejects.toThrow('storage');
    expect(ran).toBe(false);
  });
});

describe('frozen source location validation', () => {
  const artifact: Artifact = { id: 'source', projectId: 'project', type: 'source_code', source: 'repository', fileName: 'auth.ts', filePath: 'src/auth.ts', originalPath: null, contentHash: 'hash', createdAt: '2026-10-11T00:00:00Z' };
  const finding = { title: 'Ownership', filePath: 'src/auth.ts', lineNumber: 2 } as StaticFindingInput;
  const sources = [{ artifact, content: 'first\nsecond' }];

  it('pins supported locations to the frozen artifact and version', () => {
    expect(validateFindingLocations([finding], sources)).toMatchObject({ verifiedLocations: 1, rejectedLocations: 0, findings: [{ artifactId: 'source', filePath: 'src/auth.ts', lineNumber: 2, sourceVersion: 'hash' }] });
  });

  it('removes invented locations and out-of-range lines without deleting observations', () => {
    const result = validateFindingLocations([{ ...finding, filePath: 'invented.ts' }, { ...finding, lineNumber: 99 }], sources);
    expect(result.rejectedLocations).toBe(2);
    expect(result.findings[0]).toMatchObject({ title: 'Ownership', artifactId: null, filePath: '', lineNumber: null });
    expect(result.findings[1]).toMatchObject({ artifactId: 'source', lineNumber: null });
  });

  it('does not trust contradictory IDs or ambiguous basenames', () => {
    const duplicate = { artifact: { ...artifact, id: 'other', filePath: 'lib/auth.ts' }, content: 'first\nsecond' };
    const result = validateFindingLocations([{ ...finding, artifactId: 'source', filePath: 'lib/auth.ts' }, { ...finding, filePath: 'auth.ts' }], [...sources, duplicate]);
    expect(result.rejectedLocations).toBe(2);
    expect(result.findings.every(item => item.artifactId === null && item.filePath === '')).toBe(true);
  });
});
