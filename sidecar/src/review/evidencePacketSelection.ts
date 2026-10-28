import crypto from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import type { ReviewAnalysisFeature, AnalysisEvidenceReference } from './featurePathAnalysis.js';
import { SelectedModuleResolver, type SelectedModule } from './selectedModuleResolver.js';
import type { RetrievedContext } from './contextTypes.js';

export type EvidencePacketFallbackReason =
  | 'unsupported_language'
  | 'source_hash_mismatch'
  | 'parse_error'
  | 'dynamic_scope'
  | 'invalid_feature_reference'
  | 'selected_module_ambiguous'
  | 'selected_module_unresolved';

export type EvidencePacketMethod = 'ast_dependency_units' | 'full_source_fallback';
export type EvidencePacketRange = { lineStart: number; lineEnd: number };
export type EvidencePacketUnit = EvidencePacketRange & { kind: 'function' | 'arrow' | 'class' | 'retrieved' };
export type EvidencePacketSelection = {
  artifact: EvidenceArtifact['artifact'];
  ranges: EvidencePacketRange[];
  units: EvidencePacketUnit[];
  diagnostics: {
    method: EvidencePacketMethod;
    fallbackReason: EvidencePacketFallbackReason | null;
    sourceCharacters: number;
    retainedCharacters: number;
    selectedUnitCount: number;
    retainedRangeCount: number;
    addedRetrievedUnitCount: number;
  };
};

export type EvidencePacketSelectionPlan = {
  byArtifactId: Map<string, EvidencePacketSelection>;
  /** Hash of the ordered, exact retrieval identities accepted for this packet. */
  contextIdentityHash: string | null;
  /** Number of direct reverse callers added from mapped units. */
  callerUnitCount: number;
  /** Direct caller units omitted by the caller-context bound. */
  omittedCallerUnitCount: number;
  /** Number of exact retrieved units added to the packet. */
  retrievedUnitCount: number;
};

export type EvidencePacketSelectionOptions = { includeCallers?: boolean; maxCallerUnits?: number };

export const MAX_RETRIEVED_PACKET_UNITS = 8;
export const MAX_RETRIEVED_PACKET_CHARACTERS = 8_000;

type Unit = {
  id: string;
  name: string;
  node: ts.Node;
  kind: 'function' | 'arrow' | 'class';
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  removable: boolean;
  identifiers: Set<string>;
  callIdentifiers: Set<string>;
  /** Dependencies in class accessors; these can execute on a property read. */
  accessorIdentifiers: Set<string>;
};

type ParsedModule = {
  evidence: EvidenceArtifact;
  selected: SelectedModule | null;
  source: ts.SourceFile | null;
  lines: string[];
  units: Unit[];
  candidatesByName: Map<string, Unit[]>;
  fallbackReason: EvidencePacketFallbackReason | null;
  /** False when the source is unavailable or parser recovery makes graph use unsafe. */
  canTraverse: boolean;
};

type UnitNode = { module: ParsedModule; unit: Unit };
type ImportedTarget = { localName: string; targetArtifactId: string; targetUnitId?: string; traverseBodies?: boolean; failure?: EvidencePacketFallbackReason };
type SelectionGraph = {
  validModules: Array<ParsedModule & { selected: SelectedModule; source: ts.SourceFile }>;
  resolver: SelectedModuleResolver;
  unitsById: Map<string, UnitNode>;
  localNeighbors: Map<string, Set<string>>;
  importedTargets: Map<string, ImportedTarget[]>;
  candidateUnits: UnitNode[];
  callersByTargetId: Map<string, string[]>;
};

const JS_TS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const isRelativeModule = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../');
const hashText = (content: string) => crypto.createHash('sha256').update(content, 'utf8').digest('hex');

function scriptKind(fileName: string): ts.ScriptKind {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function identifiersIn(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child)) names.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

/** Visit only expressions evaluated while defining a function-like member. */
function visitFunctionDefinitionEffects(node: ts.Node, visit: (child: ts.Node) => void) {
  if (ts.canHaveDecorators(node)) for (const decorator of ts.getDecorators(node) ?? []) visit(decorator);
  const named = node as ts.NamedDeclaration;
  if (named.name && ts.isComputedPropertyName(named.name)) visit(named.name.expression);
  if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))) {
    for (const parameter of node.parameters) if (ts.canHaveDecorators(parameter)) {
      for (const decorator of ts.getDecorators(parameter) ?? []) visit(decorator);
    }
  }
}

/** Module initialization does not execute nested function bodies. */
function identifiersInModuleInitialization(node: ts.Node, includeFunctionBodies = false): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node, root = false) => {
    if (!includeFunctionBodies && !root && isFunctionBoundary(child)) {
      visitFunctionDefinitionEffects(child, item => visit(item));
      return;
    }
    if (ts.isDecorator(child)) for (const name of identifiersIn(child.expression)) names.add(name);
    if (ts.isIdentifier(child)) names.add(child.text);
    ts.forEachChild(child, item => visit(item));
  };
  visit(node, true);
  return names;
}

/** Call targets in executed module initialization, excluding callback bodies. */
function callsInModuleInitialization(node: ts.Node, includeFunctionBodies = false): Set<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node, root = false) => {
    if (!includeFunctionBodies && !root && isFunctionBoundary(child)) {
      visitFunctionDefinitionEffects(child, item => visit(item));
      return;
    }
    if (ts.isDecorator(child)) for (const name of identifiersIn(child.expression)) names.add(name);
    if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
      for (const name of identifiersIn(child.expression)) names.add(name);
    }
    if (ts.isTaggedTemplateExpression(child)) {
      for (const name of identifiersIn(child.tag)) names.add(name);
    }
    ts.forEachChild(child, item => visit(item));
  };
  visit(node, true);
  return names;
}

type SimpleAliasAnalysis = { aliases: Map<string, string | null>; tainted: Set<string> };

function analyzeTopLevelAliases(source: ts.SourceFile): SimpleAliasAnalysis {
  const aliases = new Map<string, string | null>();
  const counts = new Map<string, number>();
  const written = new Set<string>();
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isIdentifier(declaration.initializer)) continue;
      const name = declaration.name.text;
      const target = declaration.initializer.text;
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      const prior = aliases.get(name);
      aliases.set(name, count > 1 && prior !== target ? null : prior === undefined ? target : prior);
    }
  }
  const scanWrites = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) written.add(node.left.text);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      && ts.isIdentifier(node.operand)) written.add(node.operand.text);
    ts.forEachChild(node, scanWrites);
  };
  scanWrites(source);
  const tainted = new Set([...written, ...[...counts].filter(([, count]) => count > 1).map(([name]) => name)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, target] of aliases) if (!target || tainted.has(target)) {
      if (!tainted.has(name)) { tainted.add(name); changed = true; }
    }
  }
  for (const name of tainted) if (aliases.has(name)) aliases.set(name, null);
  return { aliases, tainted };
}

function hasDynamicScope(source: ts.SourceFile): boolean {
  let found = false;
  const namespaceImports = new Set<string>();
  const aliasAnalysis = analyzeTopLevelAliases(source);
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
      && ts.isNamespaceImport(statement.importClause.namedBindings)) namespaceImports.add(statement.importClause.namedBindings.name.text);
  }
  const isStaticKey = (node: ts.Expression | undefined) => !!node
    && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node));
  const isDynamicReceiver = (node: ts.Expression) => ts.isIdentifier(node)
    && (namespaceImports.has(node.text) || ['globalThis', 'global', 'window', 'self', 'exports'].includes(node.text));
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isWithStatement(node)) { found = true; return; }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && (node.expression.text === 'eval' || node.expression.text === 'Function')) { found = true; return; }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node))
      && [...identifiersIn(node.expression)].some(name => aliasAnalysis.tainted.has(name) && aliasAnalysis.aliases.has(name))) { found = true; return; }
    if (ts.isTaggedTemplateExpression(node)
      && [...identifiersIn(node.tag)].some(name => aliasAnalysis.tainted.has(name) && aliasAnalysis.aliases.has(name))) { found = true; return; }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') { found = true; return; }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'eval') { found = true; return; }
    if (ts.isElementAccessExpression(node) && isDynamicReceiver(node.expression)) { found = true; return; }
    if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)
      && (!isStaticKey(node.expression.argumentExpression) || isDynamicReceiver(node.expression.expression))) { found = true; return; }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Reflect'
      && node.expression.name.text === 'get' && node.arguments.length >= 2
      && (ts.isIdentifier(node.arguments[0]) && ['exports', 'globalThis', 'window', 'self'].includes(node.arguments[0].text)
        || !isStaticKey(node.arguments[1]))) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function nodeLineRange(source: ts.SourceFile, node: ts.Node): EvidencePacketRange {
  const start = Math.max(0, node.getStart(source));
  const end = Math.max(start, node.getEnd() - 1);
  return {
    lineStart: source.getLineAndCharacterOfPosition(start).line + 1,
    lineEnd: source.getLineAndCharacterOfPosition(end).line + 1,
  };
}

function lineStartOffset(source: ts.SourceFile, lineIndex: number): number {
  return source.getPositionOfLineAndCharacter(lineIndex, 0);
}

function lineEndOffset(text: string, start: number): number {
  const newline = text.indexOf('\n', start);
  return newline < 0 ? text.length : newline;
}

function sourceLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
}

function lineStartAt(starts: number[], lineNumber: number, contentLength: number): number {
  return starts[lineNumber - 1] ?? contentLength;
}

function lineAfterAt(starts: number[], lineNumber: number, contentLength: number): number {
  return starts[lineNumber] ?? contentLength;
}

function lineNumberAtOffset(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

/** A unit is removable only when its own complete lines contain no other code or trivia. */
function standaloneLines(source: ts.SourceFile, node: ts.Node): boolean {
  const start = node.getStart(source);
  const end = node.getEnd();
  const startLine = source.getLineAndCharacterOfPosition(start).line;
  const endPosition = Math.max(start, end - 1);
  const endLine = source.getLineAndCharacterOfPosition(endPosition).line;
  const before = source.text.slice(lineStartOffset(source, startLine), start);
  const after = source.text.slice(end, lineEndOffset(source.text, lineStartOffset(source, endLine)));
  return /^[\t \r]*$/.test(before) && /^[\t \r]*$/.test(after);
}

function hasClassDefinitionEffects(node: ts.ClassDeclaration): boolean {
  if (node.heritageClauses?.length) return true;
  if (ts.canHaveDecorators(node) && !!ts.getDecorators(node)?.length) return true;
  for (const member of node.members) {
    if (ts.canHaveDecorators(member) && !!ts.getDecorators(member)?.length) return true;
    if ((ts.isConstructorDeclaration(member) || ts.isMethodDeclaration(member)
      || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))
      && member.parameters.some(parameter => ts.canHaveDecorators(parameter) && !!ts.getDecorators(parameter)?.length)) return true;
    if (ts.isClassStaticBlockDeclaration(member)) return true;
    const named = member as ts.ClassElement & { name?: ts.PropertyName };
    if (named.name && ts.isComputedPropertyName(named.name)) return true;
    if (ts.isPropertyDeclaration(member) && member.initializer
      && ts.canHaveModifiers(member) && !!ts.getModifiers(member)?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) return true;
  }
  return false;
}

function makeUnit(module: ParsedModule, node: ts.Node, name: string, kind: Unit['kind'], removable: boolean, callNode: ts.Node = node): Unit {
  const source = module.source!;
  const accessorIdentifiers = new Set<string>();
  if (ts.isClassDeclaration(node)) for (const member of node.members) {
    if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      for (const identifier of identifiersIn(member)) accessorIdentifiers.add(identifier);
    }
  }
  return {
    id: `${module.evidence.artifact.id}:${node.getStart(source)}:${node.getEnd()}`,
    name,
    node,
    kind,
    start: node.getStart(source),
    end: node.getEnd(),
    ...nodeLineRange(source, node),
    removable: removable && standaloneLines(source, node),
    identifiers: identifiersIn(node),
    callIdentifiers: callsInModuleInitialization(callNode),
    accessorIdentifiers,
  };
}

/** Resolve simple, unambiguous top-level identifier aliases. */
function simpleAliases(module: ParsedModule): Map<string, string | null> {
  return module.source ? analyzeTopLevelAliases(module.source).aliases : new Map();
}

function resolveSimpleAlias(aliases: Map<string, string | null>, name: string): string | null {
    const seen = new Set<string>();
    let current = name;
    while (aliases.has(current)) {
      if (seen.has(current)) return null;
      seen.add(current);
      const next = aliases.get(current);
      if (!next) return null;
      current = next;
    }
    return current === name ? null : current;
}

function expandSimpleAliases(module: ParsedModule): void {
  const aliases = simpleAliases(module);
  for (const unit of module.units) for (const name of [...unit.identifiers, ...unit.accessorIdentifiers, ...unit.callIdentifiers]) {
    const target = resolveSimpleAlias(aliases, name);
    if (!target) continue;
    unit.identifiers.add(target);
    if (unit.accessorIdentifiers.has(name)) unit.accessorIdentifiers.add(target);
    if (unit.callIdentifiers.has(name)) unit.callIdentifiers.add(target);
  }
}

function parsedModule(evidence: EvidenceArtifact): ParsedModule | null {
  if (evidence.artifact.type !== 'source_code' || typeof evidence.content !== 'string'
    || (evidence.state && evidence.state !== 'available')) return null;
  const name = evidence.artifact.fileName || evidence.artifact.filePath;
  const extension = path.extname(name).toLowerCase();
  const sourceText = evidence.content;
  const lines = sourceText.split('\n');
  const fallback = (reason: EvidencePacketFallbackReason, source: ts.SourceFile | null = null, selected: SelectedModule | null = null, canTraverse = false): ParsedModule => ({
    evidence,
    selected,
    source,
    lines,
    units: [],
    candidatesByName: new Map<string, Unit[]>(),
    fallbackReason: reason,
    canTraverse,
  });
  if (!JS_TS_EXTENSIONS.has(extension)) return fallback('unsupported_language');
  if (hashText(sourceText) !== evidence.artifact.contentHash) return fallback('source_hash_mismatch');

  const source = ts.createSourceFile(name, sourceText, ts.ScriptTarget.Latest, true, scriptKind(name));
  const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0) return fallback('parse_error');

  const selected: SelectedModule = { artifact: evidence.artifact, source };
  const module: ParsedModule = {
    evidence, selected, source, lines, units: [], candidatesByName: new Map<string, Unit[]>(),
    fallbackReason: hasDynamicScope(source) ? 'dynamic_scope' : null, canTraverse: true,
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const name = statement.name.text;
      const unit = makeUnit(module, statement, name, 'function', true);
      module.units.push(unit);
    } else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      const declaration = statement.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name) && declaration.initializer
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        const name = declaration.name.text;
        const unit = makeUnit(module, statement, name, 'arrow', true, declaration.initializer);
        module.units.push(unit);
      }
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      // Pure class declarations are removable from this bounded feature packet;
      // the planner still schedules an unchanged full-source sweep for every file.
      module.units.push(makeUnit(module, statement, statement.name.text, 'class', !hasClassDefinitionEffects(statement)));
    }
  }
  for (const unit of module.units) {
    const items = module.candidatesByName.get(unit.name) ?? [];
    items.push(unit);
    module.candidatesByName.set(unit.name, items);
  }
  expandSimpleAliases(module);
  return module;
}

function fullRanges(lines: string[]): EvidencePacketRange[] {
  return lines.length ? [{ lineStart: 1, lineEnd: lines.length }] : [];
}

function rangesForLines(keep: boolean[]): EvidencePacketRange[] {
  const ranges: EvidencePacketRange[] = [];
  let start = -1;
  for (let index = 0; index <= keep.length; index++) {
    if (index < keep.length && keep[index]) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0) {
      ranges.push({ lineStart: start + 1, lineEnd: index });
      start = -1;
    }
  }
  return ranges;
}

function charactersInRanges(lines: string[], ranges: EvidencePacketRange[]): number {
  return ranges.reduce((sum, range) => sum + lines.slice(range.lineStart - 1, range.lineEnd).join('\n').length, 0);
}

function fallbackSelection(module: ParsedModule, reason = module.fallbackReason ?? 'invalid_feature_reference'): EvidencePacketSelection {
  const ranges = fullRanges(module.lines);
  return {
    artifact: module.evidence.artifact,
    ranges,
    units: [],
    diagnostics: {
      method: 'full_source_fallback', fallbackReason: reason,
      sourceCharacters: module.evidence.content?.length ?? 0,
      retainedCharacters: module.evidence.content?.length ?? 0,
      selectedUnitCount: 0, retainedRangeCount: ranges.length, addedRetrievedUnitCount: 0,
    },
  };
}

function featureReferences(feature: ReviewAnalysisFeature): AnalysisEvidenceReference[] {
  return [...feature.entryPoints, ...feature.paths.flatMap(path => path.evidence)];
}

function lineIsInNode(source: ts.SourceFile, node: ts.Node, lineNumber: number): boolean {
  const range = nodeLineRange(source, node);
  return lineNumber >= range.lineStart && lineNumber <= range.lineEnd;
}

function addCandidateByName(module: ParsedModule, name: string, into: Set<string>) {
  for (const unit of module.candidatesByName.get(name) ?? []) into.add(unit.id);
}

function retrievalMatches(
  artifacts: EvidenceArtifact[], features: readonly ReviewAnalysisFeature[], context: RetrievedContext | undefined,
  modules?: Map<string, ParsedModule>,
): Array<{ module: ParsedModule; unit: Unit; identity: [string, string, number] }> {
  if (!context?.selectedChunks?.length) return [];
  const parsed = modules ?? new Map<string, ParsedModule>();
  if (!modules) for (const artifact of artifacts) {
    const module = parsedModule(artifact);
    if (module) parsed.set(artifact.artifact.id, module);
  }
  const accepted: Array<{ module: ParsedModule; unit: Unit; identity: [string, string, number] }> = [];
  const acceptedUnits = new Set<string>();
  let totalCharacters = 0;
  for (const chunk of context.selectedChunks) {
    if (accepted.length >= MAX_RETRIEVED_PACKET_UNITS) break;
    if (typeof chunk.content !== 'string' || !chunk.content.length) continue;
    const matching = artifacts.filter(item => item.artifact.type === 'source_code' && item.artifact.filePath === chunk.filePath
      && item.artifact.versionId === chunk.artifactVersionId && (!chunk.artifactId || item.artifact.id === chunk.artifactId));
    if (matching.length !== 1) continue;
    const evidence = matching[0];
    if (!evidence) continue;
    const module = parsed.get(evidence.artifact.id);
    if (!module || !module.canTraverse || module.fallbackReason) continue;
    const content = evidence.content ?? '';
    // Retrieval is additive only when the durable identity proves one exact
    // slice of this frozen version. Content-only and stale rows are ranking
    // aids at most; they cannot root an evidence packet.
    const start = chunk.startOffset;
    const end = chunk.endOffset;
    if (!chunk.artifactId || chunk.artifactId !== evidence.artifact.id
      || !chunk.contentHash || chunk.contentHash !== hashText(chunk.content)
      || !Number.isInteger(start) || !Number.isInteger(end) || start! < 0 || end! <= start! || end! > content.length
      || !Number.isInteger(chunk.ordinal) || chunk.ordinal < 0
      || content.slice(start!, end!) !== chunk.content) continue;
    const starts = sourceLineStarts(content);
    const actualLineStart = lineNumberAtOffset(starts, start!);
    const actualLineEnd = lineNumberAtOffset(starts, end! - 1);
    if (chunk.lineStart !== actualLineStart || chunk.lineEnd !== actualLineEnd) continue;
    // Chunk boundaries may include leading comments/trivia. Accept them when
    // the exact offsets still enclose one complete frozen AST unit.
    const overlappingUnits = module.units.filter(candidate => start! < candidate.end && end! > candidate.start);
    if (overlappingUnits.length !== 1) continue;
    // A verified semantic fragment may hit only part of an AST unit. Promote
    // that hit to the complete unit; never include the fragment itself as
    // partial source evidence.
    const unit = overlappingUnits[0];
    if (!unit || acceptedUnits.has(unit.id)) continue;
    const unitCharacters = content.slice(
      lineStartAt(starts, unit.lineStart, content.length),
      lineAfterAt(starts, unit.lineEnd, content.length),
    ).length;
    if (totalCharacters + unitCharacters > MAX_RETRIEVED_PACKET_CHARACTERS) continue;
    totalCharacters += unitCharacters;
    acceptedUnits.add(unit.id);
    accepted.push({ module, unit, identity: [chunk.filePath, chunk.artifactVersionId, chunk.ordinal] });
  }
  return accepted;
}

function buildSelectionGraph(modules: Map<string, ParsedModule>): SelectionGraph {
  const validModules = [...modules.values()].filter((module): module is ParsedModule & { selected: SelectedModule; source: ts.SourceFile } =>
    module.canTraverse && !!module.selected && !!module.source);
  const resolver = new SelectedModuleResolver(validModules.map(module => module.selected));
  const unitsById = new Map<string, UnitNode>();
  const localNeighbors = new Map<string, Set<string>>();
  const importedTargets = new Map<string, ImportedTarget[]>();

  for (const module of validModules) for (const unit of module.units) {
    unitsById.set(unit.id, { module, unit });
    localNeighbors.set(unit.id, new Set());
  }

  const candidateUnits = [...unitsById.values()];
  for (const { module, unit } of candidateUnits) {
    const localEdges = localNeighbors.get(unit.id)!;
    for (const name of unit.identifiers) for (const target of module.candidatesByName.get(name) ?? []) localEdges.add(target.id);
    const targets: ImportedTarget[] = [];
    for (const [localName, binding] of resolver.imports(module.selected!)) {
      if (!unit.identifiers.has(localName) || binding.typeOnly || !isRelativeModule(binding.moduleSpecifier)) continue;
      const resolved = resolver.resolveLocal(module.selected!, localName);
      if (resolved.status === 'unresolved') {
        targets.push({ localName, targetArtifactId: module.evidence.artifact.id, failure: 'selected_module_unresolved' });
        continue;
      }
      if (resolved.status === 'type_only') continue;
      if (resolved.localName === '*') {
        targets.push({ localName, targetArtifactId: resolved.module.artifact.id, failure: 'selected_module_ambiguous' });
        continue;
      }
      const targetModule = modules.get(resolved.module.artifact.id);
      if (!targetModule?.canTraverse || !targetModule.selected || !targetModule.source) {
        targets.push({ localName, targetArtifactId: resolved.module.artifact.id, failure: targetModule?.fallbackReason ?? 'selected_module_unresolved' });
        continue;
      }
      const targetUnits = targetModule.candidatesByName.get(resolved.localName) ?? [];
      targets.push({ localName, targetArtifactId: resolved.module.artifact.id,
        ...(targetUnits.length ? { targetUnitId: targetUnits[0]?.id, traverseBodies: unit.kind !== 'class' || unit.callIdentifiers.has(localName) } : {}) });
      for (const target of targetUnits) localEdges.add(target.id);
    }
    importedTargets.set(unit.id, targets);
  }

  // Precompute direct same-module and explicit-import callers once per plan.
  const mutableCallers = new Map<string, Set<string>>();
  for (const { module, unit } of candidateUnits) {
    for (const name of unit.identifiers) for (const target of module.candidatesByName.get(name) ?? []) {
      if (target.id === unit.id) continue;
      const callers = mutableCallers.get(target.id) ?? new Set<string>();
      callers.add(unit.id);
      mutableCallers.set(target.id, callers);
    }
    for (const target of importedTargets.get(unit.id) ?? []) if (target.targetUnitId) {
      const callers = mutableCallers.get(target.targetUnitId) ?? new Set<string>();
      callers.add(unit.id);
      mutableCallers.set(target.targetUnitId, callers);
    }
  }
  return {
    validModules, resolver, unitsById, localNeighbors, importedTargets, candidateUnits,
    callersByTargetId: new Map([...mutableCallers].map(([id, callers]) => [id, [...callers]])),
  };
}

/**
 * Select verbatim, complete AST units for mapped feature evidence. A bounded
 * feature packet may omit standalone, complete function/arrow units and pure
 * class declarations outside its mapped/dependency closure, including exported
 * units; every selected artifact still receives an unchanged full-source sweep.
 * Imports, module initialization, class definition effects, and incomplete or
 * ambiguous units remain available verbatim or force a full-source fallback.
 */
function selectEvidencePacketsPrepared(
  artifacts: EvidenceArtifact[],
  features: readonly ReviewAnalysisFeature[],
  context: RetrievedContext | undefined,
  options: EvidencePacketSelectionOptions,
  modules: Map<string, ParsedModule>,
  graph: SelectionGraph,
): EvidencePacketSelectionPlan {
  const output = new Map<string, EvidencePacketSelection>();
  const { resolver, unitsById, localNeighbors, importedTargets, callersByTargetId } = graph;
  const relevantFeatures = features.flatMap(feature => featureReferences(feature).map(reference => ({ feature, reference })));
  const selectedUnitIds = new Map<string, Set<string>>();
  const mappedSeedUnitIds = new Set<string>();
  const selectedArtifactIds = new Set<string>();
  const contextRootNodes = new Map<string, ts.Node[]>();
  const fallbackReasons = new Map<string, EvidencePacketFallbackReason>();

  for (const { reference } of relevantFeatures) {
    const module = modules.get(reference.artifactId);
    const evidence = artifacts.find(item => item.artifact.id === reference.artifactId);
    if (!module || !module.canTraverse) {
      if (evidence?.artifact.type === 'source_code') {
        selectedArtifactIds.add(reference.artifactId);
        if (module?.fallbackReason) fallbackReasons.set(reference.artifactId, module.fallbackReason);
      }
      continue;
    }
    selectedArtifactIds.add(reference.artifactId);
    if (module.fallbackReason) fallbackReasons.set(reference.artifactId, module.fallbackReason);
    if (reference.filePath !== module.evidence.artifact.filePath || reference.sourceVersion !== module.evidence.artifact.contentHash
      || !Number.isInteger(reference.lineNumber) || reference.lineNumber < 1 || reference.lineNumber > module.lines.length) {
      fallbackReasons.set(reference.artifactId, 'invalid_feature_reference');
      continue;
    }
    let foundTopLevel = false;
    for (const statement of module.source!.statements) {
      if (!lineIsInNode(module.source!, statement, reference.lineNumber)) continue;
      foundTopLevel = true;
      const containingUnits = module.units.filter(unit => lineIsInNode(module.source!, unit.node, reference.lineNumber));
      if (containingUnits.length) {
        const selected = selectedUnitIds.get(reference.artifactId) ?? new Set<string>();
        containingUnits.forEach(unit => { selected.add(unit.id); mappedSeedUnitIds.add(unit.id); });
        selectedUnitIds.set(reference.artifactId, selected);
      }
      const roots = contextRootNodes.get(reference.artifactId) ?? [];
      roots.push(statement);
      contextRootNodes.set(reference.artifactId, roots);
    }
    if (!foundTopLevel) fallbackReasons.set(reference.artifactId, 'invalid_feature_reference');
  }

  const retrieved = retrievalMatches(artifacts, features, context, modules);
  for (const { module, unit } of retrieved) {
    selectedArtifactIds.add(module.evidence.artifact.id);
    const selected = selectedUnitIds.get(module.evidence.artifact.id) ?? new Set<string>();
    selected.add(unit.id);
    selectedUnitIds.set(module.evidence.artifact.id, selected);
  }

  const callerCandidates = new Set<string>();
  for (const mappedId of mappedSeedUnitIds) {
    for (const callerId of callersByTargetId.get(mappedId) ?? []) {
      if (callerId !== mappedId && !mappedSeedUnitIds.has(callerId)) callerCandidates.add(callerId);
    }
  }
  const callerLimit = options.maxCallerUnits === undefined ? Number.POSITIVE_INFINITY
    : Number.isInteger(options.maxCallerUnits) ? Math.max(0, options.maxCallerUnits) : 0;
  const callerIds = [...callerCandidates].slice(0, callerLimit);
  const callerUnitsToAdd = new Set(options.includeCallers === false ? [] : callerIds);
  const omittedCallerUnitCount = callerCandidates.size - callerUnitsToAdd.size;

  // Mapped and retrieved units are operation seeds. Module-state references
  // may retain a referenced function/class without executing all of its
  // dormant method bodies.
  const seeds = new Set<string>([...selectedUnitIds.values()].flatMap(set => [...set]));
  const visited = new Set<string>();
  const traversedUnits = new Set<string>();
  const pendingUnits: Array<{ id: string; traverseBodies: boolean }> = [...seeds].map(id => ({ id, traverseBodies: true }));
  const pendingArtifacts = [...selectedArtifactIds];
  const processedArtifacts = new Map<string, boolean>();
  while (pendingUnits.length || pendingArtifacts.length) {
    while (pendingArtifacts.length) {
      const artifactId = pendingArtifacts.pop()!;
      const module = modules.get(artifactId);
      if (!module?.canTraverse || !module.source || !module.selected) continue;
      const fullFallback = !!module.fallbackReason || fallbackReasons.has(artifactId);
      const priorMode = processedArtifacts.get(artifactId);
      if (priorMode === true || priorMode === fullFallback) continue;
      processedArtifacts.set(artifactId, fullFallback);
      // Full-source fallbacks preserve every byte, but dormant function bodies
      // do not become module-initialization roots merely because they remain in
      // the source. Explicitly mapped/called functions are traversed below.
      const isFunctionUnit = (statement: ts.Node) => module.units.some(unit => unit.node === statement
        && (unit.kind === 'function' || unit.kind === 'arrow'));
      const rootNodes: ts.Node[] = [...module.source.statements].filter(statement => !isFunctionUnit(statement)
        && (fullFallback || !module.units.some(unit => unit.node === statement && unit.removable)));
      rootNodes.push(...(contextRootNodes.get(artifactId) ?? []).filter(node => !ts.isImportDeclaration(node)
        && !ts.isExportDeclaration(node) && !isFunctionUnit(node)));
      // Import declarations stay in the source packet, but their declared
      // names alone are not evidence that an imported body is used. Named
      // export lists are binding declarations too; only export assignments
      // contain expressions evaluated during module initialization.
      const dependencyNodes = rootNodes.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node));
      const names = new Set(dependencyNodes.flatMap(node => [...identifiersInModuleInitialization(node)]));
      const callNames = new Set(dependencyNodes.flatMap(node => [...callsInModuleInitialization(node)]));
      const aliases = simpleAliases(module);
      for (const name of [...names, ...callNames]) {
        const target = resolveSimpleAlias(aliases, name);
        if (!target) continue;
        names.add(target);
        if (callNames.has(name)) callNames.add(target);
      }
      for (const name of names) for (const unit of module.candidatesByName.get(name) ?? []) {
        pendingUnits.push({ id: unit.id, traverseBodies: callNames.has(name) });
      }
      for (const [localName, binding] of resolver.imports(module.selected)) {
        if (!names.has(localName) || binding.typeOnly || !isRelativeModule(binding.moduleSpecifier)) continue;
        const resolved = resolver.resolveLocal(module.selected, localName);
        if (resolved.status === 'unresolved') {
          if (!fullFallback) {
            fallbackReasons.set(artifactId, 'selected_module_unresolved');
            pendingArtifacts.push(artifactId);
          }
          continue;
        }
        if (resolved.status === 'type_only') continue;
        if (resolved.localName === '*') {
          if (!fullFallback) {
            fallbackReasons.set(artifactId, 'selected_module_ambiguous');
            pendingArtifacts.push(artifactId);
          }
          selectedArtifactIds.add(resolved.module.artifact.id);
          pendingArtifacts.push(resolved.module.artifact.id);
          fallbackReasons.set(resolved.module.artifact.id, 'selected_module_ambiguous');
          continue;
        }
        selectedArtifactIds.add(resolved.module.artifact.id);
        pendingArtifacts.push(resolved.module.artifact.id);
        const targetModule = modules.get(resolved.module.artifact.id);
        const targetUnits = targetModule?.candidatesByName.get(resolved.localName) ?? [];
        targetUnits.forEach(unit => pendingUnits.push({ id: unit.id, traverseBodies: unit.kind !== 'class' || callNames.has(localName) }));
      }
    }

    const task = pendingUnits.pop();
    if (!task) continue;
    const { id } = task;
    if (task.traverseBodies && traversedUnits.has(id)) continue;
    visited.add(id);
    const node = unitsById.get(id);
    if (!node) continue;
    selectedArtifactIds.add(node.module.evidence.artifact.id);
    if (!task.traverseBodies) {
      // Accessors can be invoked by a property read even when the class itself
      // is referenced only as a value (for example through `.prototype`). Keep
      // their local closure without promoting ordinary dormant method bodies.
      if (node.unit.kind === 'class') {
        for (const name of node.unit.accessorIdentifiers) for (const target of node.module.candidatesByName.get(name) ?? []) {
          pendingUnits.push({ id: target.id, traverseBodies: target.kind !== 'class' || node.unit.callIdentifiers.has(name) });
        }
        for (const target of importedTargets.get(id) ?? []) {
          if (!node.unit.accessorIdentifiers.has(target.localName) && !node.unit.callIdentifiers.has(target.localName)) continue;
          selectedArtifactIds.add(target.targetArtifactId);
          pendingArtifacts.push(target.targetArtifactId);
          if (target.targetUnitId) pendingUnits.push({ id: target.targetUnitId, traverseBodies: target.traverseBodies ?? true });
        }
      }
      continue;
    }
    traversedUnits.add(id);
    for (const target of importedTargets.get(id) ?? []) {
      selectedArtifactIds.add(target.targetArtifactId);
      pendingArtifacts.push(target.targetArtifactId);
      if (target.failure) {
        const ownerWasFallback = !!node.module.fallbackReason || fallbackReasons.has(node.module.evidence.artifact.id);
        if (!node.module.fallbackReason && !fallbackReasons.has(node.module.evidence.artifact.id)) {
          fallbackReasons.set(node.module.evidence.artifact.id, target.failure);
        }
        if (!ownerWasFallback) pendingArtifacts.push(node.module.evidence.artifact.id);
        if (target.targetArtifactId !== node.module.evidence.artifact.id) {
          const targetModule = modules.get(target.targetArtifactId);
          const targetWasFallback = !!targetModule?.fallbackReason || fallbackReasons.has(target.targetArtifactId);
          if (!targetModule?.fallbackReason && !fallbackReasons.has(target.targetArtifactId)) fallbackReasons.set(target.targetArtifactId, target.failure);
          if (!targetWasFallback && targetModule?.canTraverse) pendingArtifacts.push(target.targetArtifactId);
        }
      }
      if (target.targetUnitId) pendingUnits.push({ id: target.targetUnitId, traverseBodies: target.traverseBodies ?? true });
    }
    for (const neighbor of localNeighbors.get(id) ?? []) {
      const target = unitsById.get(neighbor);
      pendingUnits.push({ id: neighbor, traverseBodies: !!target
        && (target.unit.kind !== 'class' || node.unit.kind === 'class' || node.unit.callIdentifiers.has(target.unit.name)) });
    }
    // Direct callers of mapped units are useful neighborhood context. Deeper
    // reverse expansion is optional and is bounded by the planner.
    if (!mappedSeedUnitIds.has(id)) continue;
    for (const callerId of callersByTargetId.get(id) ?? []) {
      if (!callerUnitsToAdd.has(callerId)) continue;
      const caller = unitsById.get(callerId);
      if (!caller) continue;
      pendingUnits.push({ id: callerId, traverseBodies: true });
      selectedArtifactIds.add(caller.module.evidence.artifact.id);
      pendingArtifacts.push(caller.module.evidence.artifact.id);
    }
  }

  // Record a full-source fallback for a module whenever an actually selected
  // unit crosses a relative import that cannot be resolved uniquely.
  for (const id of visited) {
    const node = unitsById.get(id);
    if (!node) continue;
    for (const target of importedTargets.get(id) ?? []) if (target.failure
      && !node.module.fallbackReason && !fallbackReasons.has(node.module.evidence.artifact.id)) {
      fallbackReasons.set(node.module.evidence.artifact.id, target.failure);
    }
  }

  for (const artifactId of selectedArtifactIds) {
    const module = modules.get(artifactId);
    if (!module) continue;
    const fallbackReason = fallbackReasons.get(artifactId) ?? module.fallbackReason;
    if (fallbackReason) {
      output.set(artifactId, fallbackSelection(module, fallbackReason));
      continue;
    }
    const selectedIds = visited;
    const units = module.units.filter(unit => selectedIds.has(unit.id));
    const retrievedForModule = retrieved.filter(item => item.module.evidence.artifact.id === artifactId);
    const retainedUnits: EvidencePacketUnit[] = [
      ...units.map(unit => ({ lineStart: unit.lineStart, lineEnd: unit.lineEnd, kind: unit.kind })),
      ...retrievedForModule.map(({ unit }) => ({ lineStart: unit.lineStart, lineEnd: unit.lineEnd, kind: 'retrieved' as const })),
    ];
    const keep = module.lines.map(() => true);
    for (const unit of module.units) {
      if (!unit.removable || selectedIds.has(unit.id)) continue;
      for (let line = unit.lineStart; line <= unit.lineEnd; line++) keep[line - 1] = false;
    }
    // `split('\n')` exposes one synthetic trailing empty entry when the
    // original file ends in a newline. Do not emit that entry as a detached
    // blank packet range after its preceding source line was omitted.
    if (module.lines.length > 1 && module.lines[module.lines.length - 1] === ''
      && keep[module.lines.length - 1] && !keep[module.lines.length - 2]) keep[module.lines.length - 1] = false;
    const ranges = rangesForLines(keep);
    output.set(artifactId, {
      artifact: module.evidence.artifact,
      ranges,
      units: retainedUnits,
      diagnostics: {
        method: 'ast_dependency_units', fallbackReason: null,
        sourceCharacters: module.evidence.content?.length ?? 0,
        retainedCharacters: charactersInRanges(module.lines, ranges),
        selectedUnitCount: units.length,
        retainedRangeCount: ranges.length,
        addedRetrievedUnitCount: retrievedForModule.length,
      },
    });
  }

  // Unsupported or hash-mismatched files that are directly required are still
  // surfaced with the full original bytes. They never gain AST coverage.
  for (const artifactId of selectedArtifactIds) {
    if (output.has(artifactId)) continue;
    const module = modules.get(artifactId);
    if (module) output.set(artifactId, fallbackSelection(module, fallbackReasons.get(artifactId) ?? module.fallbackReason ?? 'unsupported_language'));
  }

  const acceptedIdentities = retrieved.map(({ identity }) => identity);
  const contextIdentityHash = acceptedIdentities.length
    ? crypto.createHash('sha256').update(JSON.stringify(acceptedIdentities)).digest('hex')
    : null;
  const callerUnitCount = [...callerUnitsToAdd].filter(id => visited.has(id)).length;
  return { byArtifactId: output, contextIdentityHash, callerUnitCount, omittedCallerUnitCount, retrievedUnitCount: retrieved.length };
}

export type EvidencePacketSelector = (
  features: readonly ReviewAnalysisFeature[],
  context?: RetrievedContext | null,
  options?: EvidencePacketSelectionOptions,
) => EvidencePacketSelectionPlan;

/** Prepare parse/module edges once for a bounded planning operation. */
export function createEvidencePacketSelector(artifacts: EvidenceArtifact[]): EvidencePacketSelector {
  const modules = new Map<string, ParsedModule>();
  for (const evidence of artifacts) {
    const module = parsedModule(evidence);
    if (module) modules.set(evidence.artifact.id, module);
  }
  const graph = buildSelectionGraph(modules);
  return (features, context, options = {}) => selectEvidencePacketsPrepared(artifacts, features, context ?? undefined, options, modules, graph);
}

/** One-shot convenience API; planners should prefer the operation-scoped selector. */
export function selectEvidencePackets(
  artifacts: EvidenceArtifact[],
  features: readonly ReviewAnalysisFeature[],
  context?: RetrievedContext | null,
  options: EvidencePacketSelectionOptions = {},
): EvidencePacketSelectionPlan {
  return createEvidencePacketSelector(artifacts)(features, context, options);
}

