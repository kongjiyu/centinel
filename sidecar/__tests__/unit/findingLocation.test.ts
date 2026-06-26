/**
 * findingLocation.test.ts — location resolution for AI findings.
 *
 * Two layers:
 *  - `extractLocation` is the legacy regex fallback that pulls
 *    `path:line` out of an AI finding's free-text `artifactReference`
 *    / `evidence` fields. Still useful as a safety net.
 *  - `StageRunner.saveFindings` is the new seam: when the model
 *    supplies structured `filePath` / `lineNumber` fields, the
 *    regex MUST NOT run. The tests below pin both branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractLocation, StageRunner } from '../../src/staticReview.js';
import { createFinding } from '../../src/staticSessions.js';

vi.mock('../../src/staticSessions.js', () => ({
  createFinding: vi.fn(),
  updateStaticSessionStatus: vi.fn(),
  updateStaticSessionProgress: vi.fn(),
}));

const baseSession = {
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'Test session',
  reviewType: 'code_review' as const,
  status: 'success' as const,
  configJson: '{}',
  progressJson: '{}',
  remarks: '',
  finalSummary: '',
  failureReason: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('extractLocation', () => {
  it('parses path:line from artifactReference', () => {
    expect(extractLocation({ artifactReference: 'src/auth.ts:42' }))
      .toEqual({ filePath: 'src/auth.ts', lineNumber: 42 });
  });

  it('parses path:line with .tsx extension', () => {
    expect(extractLocation({ artifactReference: 'src/components/Button.tsx:128' }))
      .toEqual({ filePath: 'src/components/Button.tsx', lineNumber: 128 });
  });

  it('falls back to evidence "line N" when reference is bare path', () => {
    expect(extractLocation({
      artifactReference: 'src/auth.ts',
      evidence: 'See line 88 for the bug.',
    })).toEqual({ filePath: 'src/auth.ts', lineNumber: 88 });
  });

  it('returns empty when nothing matches', () => {
    expect(extractLocation({ artifactReference: 'login flow', evidence: 'bug here' }))
      .toEqual({ filePath: '', lineNumber: null });
  });

  it('handles L-prefixed lines (L88)', () => {
    expect(extractLocation({
      artifactReference: 'src/auth.ts',
      evidence: 'L88 contains the unhandled error',
    })).toEqual({ filePath: 'src/auth.ts', lineNumber: 88 });
  });
});

describe('StageRunner.saveFindings — structured location preferred over regex', () => {
  beforeEach(() => {
    vi.mocked(createFinding).mockReset();
    vi.mocked(createFinding).mockResolvedValue(undefined);
  });

  it('uses filePath/lineNumber from the finding directly (regex NOT consulted)', async () => {
    // The structured fields cross-reference the source-code header
    // exactly. Even if `artifactReference` looks like a bare path
    // (which would normally cause the regex to fall back to
    // "evidence"-scanning), the structured values win.
    const runner = new StageRunner(baseSession);
    await runner.saveFindings(
      baseSession,
      [{
        title: 'Auth check missing',
        severity: 'high',
        category: 'security_concern',
        filePath: 'src/auth.ts',
        lineNumber: 42,
        artifactReference: 'auth middleware',
        description: 'No auth guard on the route.',
        evidence: 'No line number mentioned in evidence at all.',
        recommendation: 'Add auth middleware.',
        confidence: 'high',
      }],
      [{ risk: { level: 'high' } }],
    );

    expect(createFinding).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(createFinding).mock.calls[0][2] as Record<string, unknown>;
    expect(passed.filePath).toBe('src/auth.ts');
    expect(passed.lineNumber).toBe(42);
  });

  it('falls back to extractLocation when both filePath and lineNumber are empty', async () => {
    // The model sometimes ignores the new structured fields. The
    // regex should still recover a path:line from the prose. The
    // path here has the colon-line form, so the regex will succeed
    // and a warning will be logged.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runner = new StageRunner(baseSession);
    await runner.saveFindings(
      baseSession,
      [{
        title: 'Catch swallows error',
        severity: 'medium',
        category: 'error_handling',
        filePath: '',
        lineNumber: null,
        artifactReference: 'src/handler.ts:17',
        description: 'Empty catch block.',
        evidence: 'See the offending block.',
        recommendation: 'Log the error.',
        confidence: 'medium',
      }],
      [{ risk: { level: 'medium' } }],
    );

    expect(createFinding).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(createFinding).mock.calls[0][2] as Record<string, unknown>;
    expect(passed.filePath).toBe('src/handler.ts');
    expect(passed.lineNumber).toBe(17);
    // The fallback path emits a warning so we can see how often the
    // model is ignoring the new structured fields.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('regex fallback for location')
    );
    warnSpy.mockRestore();
  });
});
