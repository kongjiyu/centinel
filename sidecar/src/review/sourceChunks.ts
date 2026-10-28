import ts from 'typescript';

/** Bump when parsing, boundaries, metadata, or fallback behavior changes. */
export const SOURCE_CHUNK_POLICY = 'source-chunk-2026-10-25-function-aware-v1';
export const SOURCE_CHUNK_MAX_CHARS = 2_400;

export type SourceChunkKind = 'code' | 'function' | 'class' | 'doc_section' | 'text';

export type SourceChunkArtifact = {
  id: string;
  filePath: string;
  type: string;
};

export type SourceChunkOptions = {
  /** Maximum UTF-16 code units per returned chunk. Defaults to 2,400. */
  maxChars?: number;
};

export type SourceChunk = {
  /** Unique and deterministic for this artifact's ordered chunk set. */
  id: string;
  artifactId: string;
  filePath: string;
  type: string;
  /** Zero-based order in the exact source reconstruction. */
  ordinal: number;
  /** JavaScript UTF-16 offsets; endOffset is exclusive. */
  startOffset: number;
  endOffset: number;
  /** One-based inclusive source line range. */
  lineStart: number;
  lineEnd: number;
  kind: SourceChunkKind;
  symbol?: string;
  /** True when one logical unit had to be divided to fit the character bound. */
  isFragment: boolean;
  /** Zero-based part index and total parts, present only for divided units. */
  fragmentIndex?: number;
  fragmentCount?: number;
  content: string;
};

type ChunkUnit = {
  start: number;
  end: number;
  kind: SourceChunkKind;
  symbol?: string;
  paragraphBoundaries?: boolean;
};

type SourceLine = {
  start: number;
  end: number;
  text: string;
};

type FunctionLikeNode = ts.FunctionExpression | ts.ArrowFunction;

const TS_JS_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
]);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java',
  '.js', '.jsx', '.mjs', '.cjs', '.json', '.kt', '.php', '.py', '.rb', '.rs',
  '.sh', '.sql', '.swift', '.ts', '.tsx', '.mts', '.cts', '.vue', '.yaml', '.yml',
]);

/**
 * Split a frozen source string into bounded, source-exact retrieval chunks.
 *
 * JS/TS files use the TypeScript parser for declaration and class-member
 * boundaries. Other languages receive bounded code chunks without AST claims.
 * Markdown uses heading sections and prefers paragraph boundaries when a
 * section must be divided. Chunks are adjacent slices with no overlap or gaps;
 * joining their `content` fields reproduces the original string exactly.
 */
export function chunkFrozenSource(
  artifact: SourceChunkArtifact,
  content: string,
  options: SourceChunkOptions = {},
): SourceChunk[] {
  if (content.length === 0) return [];

  const maxChars = normalizeMaxChars(options.maxChars);
  const extension = fileExtension(artifact.filePath);
  let units: ChunkUnit[];

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    units = markdownUnits(content);
  } else if (TS_JS_EXTENSIONS.has(extension)) {
    units = typescriptUnits(artifact.filePath, content, maxChars);
  } else {
    units = [{
      start: 0,
      end: content.length,
      kind: isCodeArtifact(artifact, extension) ? 'code' : 'text',
    }];
  }

  const lineStarts = getLineStarts(content);
  const pieces: Array<ChunkUnit & { isFragment: boolean; fragmentIndex?: number; fragmentCount?: number }> = [];
  for (const unit of units) {
    pieces.push(...splitUnit(content, unit, maxChars));
  }

  // All builders work over contiguous source ranges. Keep this assertion as a
  // defensive fallback in production so a malformed parser tree cannot drop
  // source text from an index request.
  if (!rangesCoverSource(pieces, content.length)) {
    pieces.length = 0;
    pieces.push(...splitUnit(content, {
      start: 0,
      end: content.length,
      kind: isCodeArtifact(artifact, extension) ? 'code' : 'text',
    }, maxChars));
  }

  return pieces.map((piece, ordinal) => {
    const startOffset = piece.start;
    const endOffset = piece.end;
    return {
      id: `${encodeURIComponent(artifact.id)}:${ordinal}:${startOffset}-${endOffset}`,
      artifactId: artifact.id,
      filePath: artifact.filePath,
      type: artifact.type,
      ordinal,
      startOffset,
      endOffset,
      lineStart: lineAt(lineStarts, startOffset),
      lineEnd: lineAt(lineStarts, endOffset - 1),
      kind: piece.kind,
      ...(piece.symbol ? { symbol: piece.symbol } : {}),
      isFragment: piece.isFragment,
      ...(piece.fragmentIndex !== undefined ? { fragmentIndex: piece.fragmentIndex } : {}),
      ...(piece.fragmentCount !== undefined ? { fragmentCount: piece.fragmentCount } : {}),
      content: content.slice(startOffset, endOffset),
    };
  });
}

function normalizeMaxChars(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SOURCE_CHUNK_MAX_CHARS;
  return Math.max(2, Math.floor(value));
}

function fileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function isCodeArtifact(artifact: SourceChunkArtifact, extension: string): boolean {
  return artifact.type === 'source_code' || CODE_EXTENSIONS.has(extension);
}

function scriptKind(extension: string): ts.ScriptKind {
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function typescriptUnits(filePath: string, content: string, maxChars: number): ChunkUnit[] {
  const extension = fileExtension(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(extension),
  );

  // Keep malformed inputs in a simple bounded fallback. Parser recovery can
  // produce plausible-looking nodes, but those should not be labeled semantic.
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) {
    return [{ start: 0, end: content.length, kind: 'code' }];
  }

  const units: ChunkUnit[] = [];
  let cursor = 0;
  let codeStart: number | undefined;

  for (const statement of sourceFile.statements) {
    const start = cursor;
    const end = statement.getEnd();
    const description = describeStatement(statement, sourceFile);

    if (!description) {
      if (codeStart === undefined) codeStart = start;
      cursor = end;
      continue;
    }

    if (codeStart !== undefined) {
      if (start > codeStart) units.push({ start: codeStart, end: start, kind: 'code' });
      codeStart = undefined;
    }

    if (
      description.classNode
      && end - start > maxChars
      && description.classNode.members.length > 0
    ) {
      units.push(...largeClassUnits(start, end, description.classNode, description.symbol, sourceFile));
    } else {
      units.push({ start, end, kind: description.kind, symbol: description.symbol });
    }
    cursor = end;
  }

  if (codeStart !== undefined) {
    if (content.length > codeStart) units.push({ start: codeStart, end: content.length, kind: 'code' });
  } else if (units.length > 0) {
    // Trailing whitespace and comments belong to the last source unit.
    units[units.length - 1]!.end = content.length;
  }

  if (units.length === 0 && content.length > 0) {
    return [{ start: 0, end: content.length, kind: 'code' }];
  }
  return units;
}

type StatementDescription = {
  kind: 'function' | 'class';
  symbol?: string;
  classNode?: ts.ClassDeclaration | ts.ClassExpression;
};

function describeStatement(statement: ts.Statement, sourceFile: ts.SourceFile): StatementDescription | undefined {
  if (ts.isFunctionDeclaration(statement)) {
    return { kind: 'function', symbol: statement.name?.text ?? 'default' };
  }

  if (ts.isClassDeclaration(statement)) {
    const symbol = statement.name?.text ?? 'default';
    return { kind: 'class', symbol, classNode: statement };
  }

  if (ts.isVariableStatement(statement)) {
    const functionNames = statement.declarationList.declarations
      .filter(declaration => isFunctionLike(unwrapExpression(declaration.initializer)))
      .map(declaration => declaration.name.getText(sourceFile));
    if (functionNames.length > 0) {
      return { kind: 'function', symbol: functionNames.join(', ') };
    }
  }

  if (ts.isExportAssignment(statement) && isFunctionLike(unwrapExpression(statement.expression))) {
    return { kind: 'function', symbol: 'default' };
  }

  return undefined;
}

function unwrapExpression(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current))) {
    current = current.expression;
  }
  return current;
}

function isFunctionLike(node: ts.Expression | undefined): node is FunctionLikeNode {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function largeClassUnits(
  start: number,
  end: number,
  classNode: ts.ClassDeclaration | ts.ClassExpression,
  className: string | undefined,
  sourceFile: ts.SourceFile,
): ChunkUnit[] {
  const owner = className ?? 'anonymous';
  const memberStarts = classNode.members
    .map(member => ({ start: member.getFullStart(), member }))
    .filter(item => item.start > start && item.start < end)
    .sort((left, right) => left.start - right.start);

  const distinct: Array<{ start: number; member: ts.ClassElement }> = [];
  for (const item of memberStarts) {
    if (distinct.length === 0 || distinct[distinct.length - 1]!.start !== item.start) distinct.push(item);
  }
  if (distinct.length === 0) return [{ start, end, kind: 'class', symbol: owner }];

  const result: ChunkUnit[] = [];
  const firstMemberStart = distinct[0]!.start;
  if (firstMemberStart > start) result.push({ start, end: firstMemberStart, kind: 'class', symbol: owner });

  for (let index = 0; index < distinct.length; index += 1) {
    const current = distinct[index]!;
    const nextStart = distinct[index + 1]?.start ?? end;
    if (nextStart <= current.start) continue;
    const description = describeClassMember(current.member, sourceFile);
    if (description.kind === 'function') {
      result.push({
        start: current.start,
        end: nextStart,
        kind: 'function',
        symbol: `${owner}.${description.symbol}`,
      });
    } else {
      result.push({ start: current.start, end: nextStart, kind: 'class', symbol: owner });
    }
  }
  return result;
}

function describeClassMember(member: ts.ClassElement, sourceFile: ts.SourceFile): { kind: 'function' | 'class'; symbol: string } {
  const name = classMemberName(member, sourceFile);
  if (
    ts.isMethodDeclaration(member)
    || ts.isConstructorDeclaration(member)
    || ts.isGetAccessorDeclaration(member)
    || ts.isSetAccessorDeclaration(member)
  ) {
    return { kind: 'function', symbol: name };
  }
  if (ts.isPropertyDeclaration(member) && isFunctionLike(unwrapExpression(member.initializer))) {
    return { kind: 'function', symbol: name };
  }
  return { kind: 'class', symbol: name };
}

function classMemberName(member: ts.ClassElement, sourceFile: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  const named = member as ts.ClassElement & { name?: ts.PropertyName };
  return named.name?.getText(sourceFile) ?? 'member';
}

function markdownUnits(content: string): ChunkUnit[] {
  const lines = sourceLines(content);
  const headings: Array<{ start: number; title: string }> = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.text;

    if (fence) {
      const close = /^ {0,3}(`+|~+)\s*$/.exec(trimmed);
      if (close && close[1]![0] === fence.marker && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }

    const fenceStart = /^ {0,3}(`{3,}|~{3,})/.exec(trimmed);
    if (fenceStart) {
      const marker = fenceStart[1]![0] as '`' | '~';
      fence = { marker, length: fenceStart[1]!.length };
      continue;
    }

    const atx = /^ {0,3}#{1,6}(?:[ \t]+|$)(.*?)\s*#*\s*$/.exec(trimmed);
    if (atx) {
      headings.push({ start: line.start, title: atx[1]!.trim() || 'Untitled' });
      continue;
    }

    const next = lines[index + 1];
    if (next && trimmed.trim() !== '' && /^ {0,3}(?:=+|-+)\s*$/.test(next.text)) {
      headings.push({ start: line.start, title: trimmed.trim() });
      index += 1;
    }
  }

  if (headings.length === 0) {
    return [{ start: 0, end: content.length, kind: 'text', paragraphBoundaries: true }];
  }

  const units: ChunkUnit[] = [];
  if (headings[0]!.start > 0) {
    units.push({ start: 0, end: headings[0]!.start, kind: 'text', paragraphBoundaries: true });
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const end = headings[index + 1]?.start ?? content.length;
    if (end > heading.start) {
      units.push({
        start: heading.start,
        end,
        kind: 'doc_section',
        symbol: heading.title,
        paragraphBoundaries: true,
      });
    }
  }
  return units;
}

function splitUnit(
  content: string,
  unit: ChunkUnit,
  maxChars: number,
): Array<ChunkUnit & { isFragment: boolean; fragmentIndex?: number; fragmentCount?: number }> {
  if (unit.end <= unit.start) return [];
  if (unit.end - unit.start <= maxChars) return [{ ...unit, isFragment: false }];

  const ranges: Array<{ start: number; end: number }> = [];
  let start = unit.start;
  while (start < unit.end) {
    const end = nextSafeBoundary(content, start, unit.end, maxChars, !!unit.paragraphBoundaries);
    ranges.push({ start, end });
    start = end;
  }
  return ranges.map((range, fragmentIndex) => ({
    ...unit,
    ...range,
    isFragment: true,
    fragmentIndex,
    fragmentCount: ranges.length,
  }));
}

function nextSafeBoundary(content: string, start: number, end: number, maxChars: number, preferParagraph: boolean): number {
  const limit = Math.min(end, start + maxChars);
  if (limit === end) return end;
  const preferredStart = start + Math.ceil((limit - start) * 0.55);

  if (preferParagraph) {
    const paragraph = lastParagraphBoundary(content, start, limit);
    if (paragraph !== undefined && paragraph >= preferredStart) {
      return adjustSafeBoundary(content, start, paragraph, limit);
    }
  }

  const newline = content.lastIndexOf('\n', limit - 1);
  const lineBoundary = newline >= start ? newline + 1 : -1;
  if (lineBoundary >= preferredStart && lineBoundary <= limit) {
    return adjustSafeBoundary(content, start, lineBoundary, limit);
  }

  const whitespace = lastWhitespaceBoundary(content, preferredStart, limit);
  if (whitespace !== undefined) return adjustSafeBoundary(content, start, whitespace, limit);

  return adjustSafeBoundary(content, start, limit, limit);
}

function adjustSafeBoundary(content: string, start: number, candidate: number, limit: number): number {
  let boundary = candidate;
  if (boundary > start && boundary < content.length) {
    const previous = content.charCodeAt(boundary - 1);
    const next = content.charCodeAt(boundary);
    // Keep UTF-16 surrogate pairs intact, even when a requested limit lands
    // between their code units.
    if (isHighSurrogate(previous) && isLowSurrogate(next)) boundary -= 1;
    // If a whitespace candidate lands between CR and LF, include the LF when
    // it still fits; otherwise keep the pair together in the next chunk.
    if (content.charCodeAt(boundary - 1) === 13 && content.charCodeAt(boundary) === 10) {
      boundary = boundary + 1 <= limit ? boundary + 1 : boundary - 1;
    }
  }
  if (boundary <= start) boundary = limit;
  return boundary;
}

function lastParagraphBoundary(content: string, start: number, limit: number): number | undefined {
  const slice = content.slice(start, limit);
  const pattern = /\r?\n[ \t]*(?:\r?\n)+/g;
  let selected: number | undefined;
  for (const match of slice.matchAll(pattern)) {
    const boundary = start + match.index! + match[0].length;
    if (boundary <= limit) selected = boundary;
  }
  return selected;
}

function lastWhitespaceBoundary(content: string, start: number, limit: number): number | undefined {
  for (let index = limit - 1; index >= start; index -= 1) {
    if (/\s/.test(content[index]!)) return index + 1;
  }
  return undefined;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function sourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < content.length) {
    const newline = content.indexOf('\n', start);
    const end = newline < 0 ? content.length : newline + 1;
    const textEnd = newline < 0 ? content.length : newline > start && content.charCodeAt(newline - 1) === 13 ? newline - 1 : newline;
    lines.push({ start, end, text: content.slice(start, textEnd) });
    start = end;
  }
  return lines;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAt(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lineStarts[middle]! <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rangesCoverSource(units: ChunkUnit[], length: number): boolean {
  if (length === 0) return units.length === 0;
  if (units.length === 0 || units[0]!.start !== 0 || units[units.length - 1]!.end !== length) return false;
  for (let index = 0; index < units.length; index += 1) {
    if (units[index]!.end <= units[index]!.start) return false;
    if (index > 0 && units[index - 1]!.end !== units[index]!.start) return false;
  }
  return true;
}
