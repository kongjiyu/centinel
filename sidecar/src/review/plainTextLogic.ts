/**
 * Plain-text review units use original whole-line ranges so provider citations
 * remain tied to the immutable frozen source. Most units stay at or below
 * 24,000 characters. A single long line remains indivisible: it is retained as
 * one explicit unit and the downstream 64,000-character context gate decides
 * whether it can be sent.
 */
import { detectArtifactType, type Artifact } from '../artifacts.js';

export const PLAIN_TEXT_LOGIC_SEGMENT_CHARACTERS = 24_000;

/** Unknown repository text retains source intent without changing document kinds. */
export function hasPlainTextSourceIntent(artifact: Artifact): boolean {
  return artifact.type === 'source_code' || artifact.type === 'other'
    && ['repository', 'directory'].includes(artifact.source)
    && detectArtifactType(artifact.fileName) === 'other'
    && !/\.(?:json|yaml|yml|html|css)$/i.test(artifact.fileName);
}

export type PlainTextLogicSourceRange = {
  lineStart: number;
  lineEnd: number;
};

export type PlainTextLogicSegment = {
  sourceRange: PlainTextLogicSourceRange;
  characterCount: number;
};

/** UTF-8 validity alone also admits binary data made of control characters. */
export function isReadablePlainText(source: string): boolean {
  return !/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(source);
}

/** Split textual source into adjacent, whole-line ranges without dropping data. */
export function segmentPlainTextLogic(source: string): PlainTextLogicSegment[] {
  if (!source.length) return [];

  const lines = source.split('\n');
  const segments: PlainTextLogicSegment[] = [];
  let start = 0;
  let size = 0;

  const flush = (endExclusive: number) => {
    if (endExclusive <= start) return;
    segments.push({
      sourceRange: { lineStart: start + 1, lineEnd: endExclusive },
      characterCount: lines.slice(start, endExclusive).join('\n').length,
    });
    start = endExclusive;
    size = 0;
  };

  for (let index = 0; index < lines.length; index++) {
    const lineLength = lines[index]!.length;
    // Whole-line citations are required. Keep a long line isolated so the
    // request planner can apply its larger hard context limit without slicing
    // evidence away from its original line number.
    if (lineLength > PLAIN_TEXT_LOGIC_SEGMENT_CHARACTERS) {
      flush(index);
      segments.push({
        sourceRange: { lineStart: index + 1, lineEnd: index + 1 },
        characterCount: lineLength,
      });
      start = index + 1;
      continue;
    }

    const addition = lineLength + (index > start ? 1 : 0);
    if (size > 0 && size + addition > PLAIN_TEXT_LOGIC_SEGMENT_CHARACTERS) flush(index);
    size += lineLength + (index > start ? 1 : 0);
  }

  flush(lines.length);
  return segments;
}
