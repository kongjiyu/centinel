import { describe, expect, it } from 'vitest';
import { rankHybridChunks, retrievalQueryTerms } from '../../src/review/retrievalRanking.js';

describe('hybrid frozen chunk ranking', () => {
  it('splits natural language and identifier terms deterministically', () => {
    expect(retrievalQueryTerms('Why does parseUserConfig fail for user_config?'))
      .toEqual(['parse', 'user', 'config', 'fail']);
    expect(retrievalQueryTerms('I use x and user_config'))
      .toEqual(['use', 'x', 'user', 'config']);
  });

  it('finds a matching later chunk instead of favoring the first ordered chunk', () => {
    const ranked = rankHybridChunks([
      { key: 'first', order: 0, content: 'export const ready = true;' },
      { key: 'later', order: 5, content: 'function parseUserConfig(input) { return input.user_config; }' },
    ], 'parseUserConfig user_config');
    expect(ranked[0].candidate.key).toBe('later');
    expect(ranked[0].mode).toBe('lexical');
  });

  it('fuses semantic and lexical ranks while retaining semantic-only evidence', () => {
    const ranked = rankHybridChunks([
      { key: 'lexical', order: 0, content: 'source contains account policy terms' },
      { key: 'both', order: 1, content: 'source applies account policy with validated scope' },
      { key: 'semantic', order: 2, content: 'configuration path' },
    ], 'account policy', ['semantic', 'both'], 3);
    // Reciprocal-rank fusion ties the lexical-only and semantic-only rows;
    // the pure lexical score breaks that tie in favor of lexical relevance.
    expect(ranked.map(item => item.candidate.key)).toEqual(['both', 'lexical', 'semantic']);
    expect(ranked[0].mode).toBe('hybrid');
    expect(ranked[1].mode).toBe('lexical');
    expect(ranked[2].mode).toBe('semantic');
  });

  it('keeps same-content chunks distinct when their versioned ranges differ', () => {
    const ranked = rankHybridChunks([
      { key: 'version-1:0-8', order: 0, content: 'account policy' },
      { key: 'version-1:80-88', order: 1, content: 'account policy' },
    ], 'account policy');
    expect(ranked.map(item => item.candidate.key)).toEqual(['version-1:0-8', 'version-1:80-88']);
  });

  it('preserves semantic rank positions when earlier RPC results were filtered', () => {
    const ranked = rankHybridChunks([
      { key: 'valid-later', order: 0, content: 'configuration path' },
    ], 'unrelated terms', ['\u0000filtered-row-0', 'valid-later']);

    expect(ranked[0]).toMatchObject({
      candidate: { key: 'valid-later' }, semanticRank: 2, mode: 'semantic',
    });
    expect(ranked[0]?.score).toBeCloseTo(1 / 62);
  });
});
