import crypto from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import { SelectedModuleResolver, type SelectedModule } from './selectedModuleResolver.js';

export type CommonJsContextSegment = EvidenceArtifact & { content: string; lineStart: number; lineEnd: number };
export type CommonJsContextResult<T extends CommonJsContextSegment> = {
  sources: T[];
  addedCount: number;
  omittedCount: number;
};

const MAX_COMMON_JS_IMPORTERS_PER_BATCH = 64;
const MAX_COMMON_JS_CANDIDATES_PER_BATCH = 128;
const MAX_COMMON_JS_DEPENDENCIES_PER_BATCH = 8;
const MAX_COMMON_JS_SOURCE_CHARACTERS = 64_000;
const COMMON_JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

type RequireBinding = {
  name: string;
  declaration: ts.VariableDeclaration;
  call: ts.CallExpression;
};

function scriptKind(fileName: string): ts.ScriptKind {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSource(fileName: string, content: string): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKind(fileName));
}

function hasParseErrors(source: ts.SourceFile): boolean {
  return ((source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0;
}

function hashMatches(item: EvidenceArtifact): boolean {
  return typeof item.content === 'string' && !!item.artifact.contentHash
    && crypto.createHash('sha256').update(item.content, 'utf8').digest('hex') === item.artifact.contentHash;
}

function isBindingName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent)
      || ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)
      || ts.isImportEqualsDeclaration(parent)
      || ts.isBindingElement(parent) || ts.isTypeParameterDeclaration(parent)
      || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent)
      || ts.isModuleDeclaration(parent)) && parent.name === node;
}

function declarationNamed(source: ts.SourceFile, name: string, except?: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (node !== except && ts.isIdentifier(node) && node.text === name && isBindingName(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  if (isBindingName(node)) return false;
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isLabeledStatement(parent) && parent.label === node)) return false;
  return true;
}

function isStaticPropertyAccess(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node)) return true;
  return ts.isElementAccessExpression(node)
    && !!node.argumentExpression
    && (ts.isStringLiteralLike(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression));
}

function containsNode(root: ts.Node, target: ts.Node): boolean {
  if (root === target) return true;
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (node === target) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function containsIdentifierNamed(root: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function assignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function bindingWritten(source: ts.SourceFile, name: string): boolean {
  let written = false;
  const visit = (node: ts.Node) => {
    if (written) return;
    if (ts.isBinaryExpression(node) && assignmentOperator(node.operatorToken.kind)
      && containsIdentifierNamed(node.left, name)) { written = true; return; }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      && containsIdentifierNamed(node.operand, name)) { written = true; return; }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && containsIdentifierNamed(node.initializer, name)) {
      written = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return written;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current) || ts.isPartiallyEmittedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function hasDynamicScope(source: ts.SourceFile): boolean {
  let dynamic = false;
  const visit = (node: ts.Node) => {
    if (dynamic) return;
    if (ts.isWithStatement(node)
      || (ts.isCallExpression(node) && ts.isIdentifier(unwrapExpression(node.expression))
        && (unwrapExpression(node.expression) as ts.Identifier).text === 'eval')) {
      dynamic = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return dynamic;
}

function isWrittenAccess(access: ts.Expression): boolean {
  for (let ancestor: ts.Node | undefined = access.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isBinaryExpression(ancestor) && assignmentOperator(ancestor.operatorToken.kind)
      && containsNode(ancestor.left, access)) return true;
    if (ts.isDeleteExpression(ancestor) && containsNode(ancestor.expression, access)) return true;
    if ((ts.isPrefixUnaryExpression(ancestor) || ts.isPostfixUnaryExpression(ancestor))
      && (ancestor.operator === ts.SyntaxKind.PlusPlusToken || ancestor.operator === ts.SyntaxKind.MinusMinusToken)
      && containsNode(ancestor.operand, access)) return true;
    if ((ts.isForInStatement(ancestor) || ts.isForOfStatement(ancestor)) && containsNode(ancestor.initializer, access)) return true;
    if (ts.isStatement(ancestor) || ts.isCallExpression(ancestor) || ts.isNewExpression(ancestor)) break;
  }
  return false;
}

function selectedNamespaceNames(source: ts.SourceFile, selected: CommonJsContextSegment[]): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
      const parent = node.parent;
      const access = (ts.isPropertyAccessExpression(parent) && parent.expression === node)
        || (ts.isElementAccessExpression(parent) && parent.expression === node) ? parent : null;
      if (access && isStaticPropertyAccess(access)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (selected.some(segment => segment.lineStart <= line && line <= segment.lineEnd)) names.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function namespaceUsage(source: ts.SourceFile, binding: RequireBinding, selected: CommonJsContextSegment[]): {
  referencedInPacket: boolean;
  immutableNamespace: boolean;
} {
  if (declarationNamed(source, binding.name, binding.declaration.name)) {
    return { referencedInPacket: false, immutableNamespace: false };
  }
  let referencedInPacket = false;
  let immutableNamespace = true;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === binding.name && node !== binding.declaration.name && isReferenceIdentifier(node)) {
      const parent = node.parent;
      const access = (ts.isPropertyAccessExpression(parent) && parent.expression === node)
        || (ts.isElementAccessExpression(parent) && parent.expression === node) ? parent : null;
      if (!access || !isStaticPropertyAccess(access)) {
        immutableNamespace = false;
      } else {
        let outermost: ts.Expression = access;
        while ((ts.isPropertyAccessExpression(outermost.parent) && outermost.parent.expression === outermost)
          || (ts.isElementAccessExpression(outermost.parent) && outermost.parent.expression === outermost)) {
          outermost = outermost.parent;
          if (!isStaticPropertyAccess(outermost)) immutableNamespace = false;
        }
        if (isWrittenAccess(outermost)) immutableNamespace = false;
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (selected.some(segment => segment.lineStart <= line && line <= segment.lineEnd)) referencedInPacket = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { referencedInPacket, immutableNamespace };
}

function requireBindings(source: ts.SourceFile): RequireBinding[] {
  const bindings: RequireBinding[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)
        || !ts.isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== 'require') continue;
      bindings.push({ name: declaration.name.text, declaration, call: declaration.initializer });
    }
  }
  return bindings;
}

function requireSpecifier(binding: RequireBinding): string | null {
  if (binding.call.arguments.length !== 1) return null;
  const argument = binding.call.arguments[0];
  if (!argument || (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument))) return null;
  return argument.text;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function exactSegment(item: EvidenceArtifact): CommonJsContextSegment | null {
  if (!hashMatches(item) || !item.artifact.versionId || item.state && item.state !== 'available') return null;
  const content = item.content!;
  return { ...item, content, lineStart: 1, lineEnd: content.split('\n').length };
}

/**
 * Adds one-hop context from exact selected CommonJS namespace requires. This is
 * frozen-source prompt context only; it does not execute modules or establish a
 * runtime dependency graph or callgraph.
 */
export function addCommonJsDependencyContext<T extends CommonJsContextSegment>(
  artifacts: EvidenceArtifact[],
  originalSources: T[],
  maxCharacters: number,
): CommonJsContextResult<T> {
  const sources = [...originalSources];
  let addedCount = 0;
  let omittedCount = 0;
  if (!originalSources.length || !Number.isFinite(maxCharacters) || maxCharacters < 0) {
    return { sources, addedCount, omittedCount };
  }

  const artifactsById = new Map(artifacts.map(item => [item.artifact.id, item]));
  const importerSegments = new Map<string, CommonJsContextSegment[]>();
  for (const segment of originalSources) {
    if (segment.artifact.type !== 'source_code') continue;
    const list = importerSegments.get(segment.artifact.id) ?? [];
    list.push(segment);
    importerSegments.set(segment.artifact.id, list);
  }
  if (!importerSegments.size) return { sources, addedCount, omittedCount };

  const sourceArtifacts = artifacts.filter(item => item.artifact.type === 'source_code' && item.artifact.filePath
    && COMMON_JS_EXTENSIONS.has(path.extname(item.artifact.filePath).toLowerCase()));
  const selectedModules: SelectedModule[] = sourceArtifacts.map(item => {
    const content = typeof item.content === 'string' ? item.content : '';
    // Keep every selected path in the resolver so duplicate paths remain ambiguous.
    // Large modules cannot be added whole under the packet ceiling, so an empty
    // syntax tree is sufficient for path-only resolution and will never be emitted.
    const source = parseSource(item.artifact.filePath, content.length <= MAX_COMMON_JS_SOURCE_CHARACTERS ? content : '');
    return { artifact: item.artifact, source };
  });
  const resolver = new SelectedModuleResolver(selectedModules);
  const moduleByArtifactId = new Map(selectedModules.map(module => [module.artifact.id, module]));

  const importerIds = [...importerSegments.keys()];
  if (importerIds.length > MAX_COMMON_JS_IMPORTERS_PER_BATCH) importerIds.length = MAX_COMMON_JS_IMPORTERS_PER_BATCH;
  const alreadyFull = new Set(originalSources.flatMap(source => {
    const item = artifactsById.get(source.artifact.id);
    return item && source.lineStart === 1 && source.lineEnd === source.content.split('\n').length
      && source.content === item.content ? [source.artifact.id] : [];
  }));
  const addedIds = new Set<string>();
  let candidateCount = 0;

  for (const importerId of importerIds) {
    const item = artifactsById.get(importerId);
    const importerModule = moduleByArtifactId.get(importerId);
    const segments = importerSegments.get(importerId) ?? [];
    if (!item || !importerModule || !hashMatches(item) || !item.artifact.versionId
      || item.state && item.state !== 'available' || item.content!.length > MAX_COMMON_JS_SOURCE_CHARACTERS) continue;
    if (segments.some(segment => segment.artifact.versionId !== item.artifact.versionId
      || segment.artifact.contentHash !== item.artifact.contentHash
      || segment.lineStart < 1 || segment.lineEnd < segment.lineStart
      || segment.lineEnd > item.content!.split('\n').length
      || segment.content !== item.content!.split('\n').slice(segment.lineStart - 1, segment.lineEnd).join('\n'))) continue;
    const source = parseSource(item.artifact.filePath, item.content!);
    if (hasParseErrors(source)) continue;
    const bindings = requireBindings(source);
    if (!bindings.length) continue;
    const requireShadowed = declarationNamed(source, 'require') || bindingWritten(source, 'require');
    const dynamicScope = hasDynamicScope(source);
    const selectedNames = selectedNamespaceNames(source, segments);

    for (let index = 0; index < bindings.length; index++) {
      const binding = bindings[index]!;
      if (!selectedNames.has(binding.name)) continue;
      if (candidateCount >= MAX_COMMON_JS_CANDIDATES_PER_BATCH) {
        omittedCount += bindings.slice(index).filter(candidate => selectedNames.has(candidate.name)).length;
        break;
      }
      candidateCount++;
      const usage = namespaceUsage(source, binding, segments);
      if (!usage.referencedInPacket) continue;
      if (requireShadowed || dynamicScope || !usage.immutableNamespace) { omittedCount++; continue; }
      const specifier = requireSpecifier(binding);
      if (!specifier || !isRelative(specifier)) { omittedCount++; continue; }
      const resolution = resolver.resolveModule(importerModule, specifier);
      const dependencyModule = resolution.module;
      const dependencyArtifact = dependencyModule && artifactsById.get(dependencyModule.artifact.id);
      if (!dependencyModule || !dependencyArtifact || resolver.isDeclarationFile(dependencyModule)) { omittedCount++; continue; }
      if (alreadyFull.has(dependencyArtifact.artifact.id) || addedIds.has(dependencyArtifact.artifact.id)) continue;
      const dependency = exactSegment(dependencyArtifact);
      if (!dependency || hasParseErrors(parseSource(dependency.artifact.filePath, dependency.content))) { omittedCount++; continue; }
      if (addedCount >= MAX_COMMON_JS_DEPENDENCIES_PER_BATCH || dependency.content.length > maxCharacters) {
        omittedCount++;
        continue;
      }
      sources.push(dependency as T);
      maxCharacters -= dependency.content.length;
      addedCount++;
      addedIds.add(dependency.artifact.id);
    }
  }
  return { sources, addedCount, omittedCount };
}
