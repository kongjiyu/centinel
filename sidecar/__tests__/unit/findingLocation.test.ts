import { describe, it, expect } from 'vitest';
import { extractLocation } from '../../src/staticReview.js';

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
