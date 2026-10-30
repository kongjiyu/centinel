import { describe, expect, it } from 'vitest';
import { sanitizeReviewRequestUsageContext, sourcePacketReferencesFromBatch } from '../../src/review/usageContext.js';

const validSource = {
  artifactId: 'artifact-a', artifactVersionId: 'version-1', contentHash: 'hash-1',
  filePath: 'src/auth.ts', lineStart: 1, lineEnd: 4,
};

describe('Review request usage context sanitizer', () => {
  it('keeps an oversized source inventory incomplete when sanitized repeatedly', () => {
    const oversized = Array.from({ length: 1_025 }, (_, index) => ({
      ...validSource,
      artifactId: `artifact-${index}`,
      artifactVersionId: `version-${index}`,
      contentHash: `hash-${index}`,
      filePath: `src/file-${index}.ts`,
    }));

    const once = sanitizeReviewRequestUsageContext({ phase: 'initial_analysis', sources: oversized });
    const twice = sanitizeReviewRequestUsageContext(once);

    expect(once?.sources).toHaveLength(1_024);
    expect(once?.sourcesComplete).toBe(false);
    expect(twice?.sources).toHaveLength(1_024);
    expect(twice?.sourcesComplete).toBe(false);
  });

  it('keeps an invalid-reference inventory incomplete when sanitized repeatedly', () => {
    const once = sanitizeReviewRequestUsageContext({
      phase: 'initial_analysis',
      sources: [validSource, { ...validSource, filePath: 'x'.repeat(2_049) }],
    });
    const twice = sanitizeReviewRequestUsageContext(once);

    expect(once?.sources).toEqual([validSource]);
    expect(once?.sourcesComplete).toBe(false);
    expect(twice?.sources).toEqual([validSource]);
    expect(twice?.sourcesComplete).toBe(false);
  });

  it('does not invent an empty complete inventory when source references are absent', () => {
    const sanitized = sanitizeReviewRequestUsageContext({ phase: 'semantic_support' });

    expect(sanitized).toEqual({ phase: 'semantic_support' });
    expect(sanitized).not.toHaveProperty('sources');
    expect(sanitized).not.toHaveProperty('sourcesComplete');
  });

  it('retains distinct same-line window offsets in safe request metadata', () => {
    const lineWindow = (startOffset: number, endOffsetExclusive: number) => ({
      startOffset, endOffsetExclusive, originalLineLength: 50_000,
      offsetUnit: 'utf16_code_units' as const, partialLine: true as const,
    });
    const sources = sourcePacketReferencesFromBatch([
      { artifact: { id: 'css', versionId: 'v1', contentHash: 'h1', filePath: 'dist/app.css' }, lineStart: 249_666, lineEnd: 249_666, lineWindow: lineWindow(0, 24_000) },
      { artifact: { id: 'css', versionId: 'v1', contentHash: 'h1', filePath: 'dist/app.css' }, lineStart: 249_666, lineEnd: 249_666, lineWindow: lineWindow(24_000, 48_000) },
    ]);
    const sanitized = sanitizeReviewRequestUsageContext({ phase: 'initial_analysis', sources });

    expect(sources).toHaveLength(2);
    expect(sanitized?.sources).toEqual(sources);
    expect(sanitized?.sourcesComplete).toBe(true);
  });

  it('keeps legacy full-line references and marks malformed window provenance incomplete', () => {
    const malformed = sanitizeReviewRequestUsageContext({ phase: 'initial_analysis', sources: [validSource, {
      ...validSource, lineStart: 1, lineEnd: 1,
      lineWindow: { startOffset: 24_000, endOffsetExclusive: 48_000, originalLineLength: 40_000,
        offsetUnit: 'utf16_code_units', partialLine: true },
    }] });

    expect(malformed?.sources).toEqual([validSource]);
    expect(malformed?.sourcesComplete).toBe(false);
  });
});
