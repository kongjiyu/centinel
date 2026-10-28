import { describe, expect, it } from 'vitest';
import {
  chunkFrozenSource,
  SOURCE_CHUNK_MAX_CHARS,
  SOURCE_CHUNK_POLICY,
} from '../../src/review/sourceChunks.js';

function artifact(filePath: string, type = 'source_code') {
  return { id: 'artifact-1', filePath, type };
}

function expectExactCoverage(source: string, chunks: ReturnType<typeof chunkFrozenSource>) {
  expect(chunks.map(chunk => chunk.content).join('')).toBe(source);
  expect(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.content, 'utf8'))).equals(Buffer.from(source, 'utf8'))).toBe(true);
  expect(new Set(chunks.map(chunk => chunk.id)).size).toBe(chunks.length);
  let offset = 0;
  for (const [ordinal, chunk] of chunks.entries()) {
    expect(chunk.ordinal).toBe(ordinal);
    expect(chunk.startOffset).toBe(offset);
    expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
    expect(chunk.content).toBe(source.slice(chunk.startOffset, chunk.endOffset));
    offset = chunk.endOffset;
  }
  expect(offset).toBe(source.length);
}

describe('chunkFrozenSource', () => {
  it('exports a versioned, bounded policy', () => {
    expect(SOURCE_CHUNK_POLICY).toMatch(/^source-chunk-\d{4}-\d{2}-\d{2}-.+-v\d+$/);
    expect(SOURCE_CHUNK_MAX_CHARS).toBe(2_400);
  });

  it('keeps standalone functions, classes, and direct arrow functions as semantic units', () => {
    const source = [
      'const seed = 1;',
      '',
      '/** greeting docs */',
      'export function greet(name: string) {',
      '  return `Hello, ${name}`;',
      '}',
      '',
      'export class Worker {',
      '  run() { return 1; }',
      '}',
      '',
      'export const normalize = (value: string) => value.trim();',
      '',
    ].join('\r\n');

    const chunks = chunkFrozenSource(artifact('src/work.ts'), source);
    expectExactCoverage(source, chunks);
    expect(chunks.map(chunk => [chunk.kind, chunk.symbol])).toEqual([
      ['code', undefined],
      ['function', 'greet'],
      ['class', 'Worker'],
      ['function', 'normalize'],
    ]);
    expect(chunks.every(chunk => chunk.content.length <= SOURCE_CHUNK_MAX_CHARS)).toBe(true);
  });

  it('splits a large class at methods and fragments oversized methods with symbols', () => {
    const body = '    return 1;\n'.repeat(14);
    const source = `class Service {\n  first() {\n${body}  }\n  second = () => 2;\n}\n`;
    const chunks = chunkFrozenSource(artifact('src/service.ts'), source, { maxChars: 80 });

    expectExactCoverage(source, chunks);
    expect(chunks.every(chunk => chunk.content.length <= 80)).toBe(true);
    expect(chunks.some(chunk => chunk.kind === 'function' && chunk.symbol === 'Service.first')).toBe(true);
    expect(chunks.some(chunk => chunk.kind === 'function' && chunk.symbol === 'Service.second')).toBe(true);
    const firstMethodFragments = chunks.filter(chunk => chunk.symbol === 'Service.first');
    expect(firstMethodFragments.length).toBeGreaterThan(1);
    expect(firstMethodFragments.every(chunk => chunk.isFragment)).toBe(true);
    expect(firstMethodFragments.map(chunk => chunk.fragmentIndex)).toEqual(
      firstMethodFragments.map((_, index) => index),
    );
    expect(firstMethodFragments.every(chunk => chunk.fragmentCount === firstMethodFragments.length)).toBe(true);
  });

  it('falls back to bounded code chunks when TypeScript parsing reports malformed source', () => {
    const source = 'function broken( {\r\n  const value = ;\r\n}\r\n';
    const chunks = chunkFrozenSource(artifact('src/broken.ts'), source, { maxChars: 24 });

    expectExactCoverage(source, chunks);
    expect(chunks.every(chunk => chunk.kind === 'code')).toBe(true);
    expect(chunks.every(chunk => chunk.symbol === undefined)).toBe(true);
    expect(chunks.every(chunk => chunk.content.length <= 24)).toBe(true);
  });

  it('bounds long lines without splitting surrogate pairs or CRLF and reports original lines', () => {
    const source = `1234567🙂${'x'.repeat(17)}\r\n1234567\r\nsecond line🙂\n`;
    const chunks = chunkFrozenSource(artifact('src/data.py'), source, { maxChars: 8 });

    expectExactCoverage(source, chunks);
    expect(chunks.every(chunk => chunk.content.length <= 8)).toBe(true);
    for (let index = 0; index < chunks.length - 1; index += 1) {
      const left = chunks[index]!;
      const right = chunks[index + 1]!;
      const leftLast = left.content.charCodeAt(left.content.length - 1);
      const rightFirst = right.content.charCodeAt(0);
      expect(leftLast >= 0xd800 && leftLast <= 0xdbff && rightFirst >= 0xdc00 && rightFirst <= 0xdfff).toBe(false);
      expect(left.content.endsWith('\r') && right.content.startsWith('\n')).toBe(false);
    }
    for (const chunk of chunks) {
      const expectedLineStart = source.slice(0, chunk.startOffset).split('\n').length;
      const lastIncludedOffset = chunk.endOffset - 1;
      const lineEndProbe = source.charCodeAt(lastIncludedOffset) === 10 ? lastIncludedOffset - 1 : lastIncludedOffset;
      const expectedLineEnd = source.slice(0, lineEndProbe + 1).split('\n').length;
      expect(chunk.lineStart).toBe(expectedLineStart);
      expect(chunk.lineEnd).toBe(expectedLineEnd);
    }
    expect(chunks.some(chunk => chunk.kind === 'code')).toBe(true);
  });

  it('uses Markdown headings and paragraph boundaries while preserving fenced headings as text', () => {
    const source = [
      '# Overview',
      '',
      'First paragraph.',
      '',
      'Second paragraph includes a fenced example:',
      '',
      '```md',
      '# Not a heading',
      '```',
      '',
      '## Details',
      'Short note.',
      '',
    ].join('\r\n');
    const chunks = chunkFrozenSource(artifact('docs/guide.md', 'requirement'), source, { maxChars: 48 });

    expectExactCoverage(source, chunks);
    expect(chunks.every(chunk => chunk.content.length <= 48)).toBe(true);
    expect(chunks.some(chunk => chunk.kind === 'doc_section' && chunk.symbol === 'Overview')).toBe(true);
    expect(chunks.some(chunk => chunk.kind === 'doc_section' && chunk.symbol === 'Details')).toBe(true);
    expect(chunks.every(chunk => chunk.symbol !== 'Not a heading')).toBe(true);
    const overview = chunks.filter(chunk => chunk.symbol === 'Overview');
    expect(overview.length).toBeGreaterThan(1);
    expect(overview.every(chunk => chunk.kind === 'doc_section' && chunk.isFragment)).toBe(true);
    expect(overview.slice(0, -1).some(chunk => chunk.content.endsWith('\r\n\r\n'))).toBe(true);
  });

  it('gives repeated identical source text distinct offset-based identities', () => {
    const source = 'function same() { return 1; }function same() { return 1; }';
    const chunks = chunkFrozenSource(artifact('src/duplicates.js'), source);

    expectExactCoverage(source, chunks);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toBe(chunks[1]!.content);
    expect(chunks[0]!.id).not.toBe(chunks[1]!.id);
    expect(chunks.map(chunk => chunk.startOffset)).toEqual([0, chunks[0]!.endOffset]);
  });

  it('returns no retrieval chunks for an empty source', () => {
    expect(chunkFrozenSource(artifact('src/empty.ts'), '')).toEqual([]);
  });
});
