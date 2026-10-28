import { describe, expect, it } from 'vitest';
import { sanitizeReviewRequestUsageContext } from '../../src/review/usageContext.js';

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
});
