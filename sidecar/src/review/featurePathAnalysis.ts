import crypto from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { Artifact } from '../artifacts.js';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import { DEFAULT_EXPORT_EXPRESSION, SelectedModuleResolver } from './selectedModuleResolver.js';
import { hasPlainTextSourceIntent, isReadablePlainText, segmentPlainTextLogic, type PlainTextLogicSourceRange } from './plainTextLogic.js';

export type ReviewDomain = 'security' | 'business' | 'technical' | 'personnel';
export type AnalysisPathKind = 'normal' | 'alternate' | 'failure' | 'recovery' | 'unresolved';
export type AnalysisEvidenceReference = {
  artifactId: string;
  filePath: string;
  lineNumber: number;
  sourceVersion: string | null;
};
export type FeatureAnalysisAssessment = {
  domain: ReviewDomain;
  status: 'assessed' | 'unverified';
  outcome: 'potential_gap' | 'no_issue_identified' | 'not_applicable' | 'unverified';
  summary: string;
  evidence: AnalysisEvidenceReference[];
};
export type FeatureAnalysisPath = {
  id: string;
  kind: AnalysisPathKind;
  label: string;
  status: 'inferred' | 'unverified';
  evidence: AnalysisEvidenceReference[];
};
export type ReviewAnalysisFeature = {
  id: string;
  label: string;
  provisional: true;
  analysisKind?: 'plain_text_logic';
  sourceRange?: PlainTextLogicSourceRange;
  entryPointStatus?: 'resolved' | 'external_boundary' | 'unresolved';
  entryPoints: AnalysisEvidenceReference[];
  paths: FeatureAnalysisPath[];
  assessments: FeatureAnalysisAssessment[];
  unresolved: Array<{ reason: string; evidence: AnalysisEvidenceReference[] }>;
};
export type ReviewAnalysisMap = {
  schemaVersion: 1;
  status: 'unverified' | 'partial' | 'assessed';
  coverage: {
    assessmentMode?: 'plain_text_context_fallback';
    syntaxFeatureCount?: number;
    sourceArtifacts: number;
    parsedArtifacts: number;
    /** Parsed artifacts that contain executable operation or module-initialization code. */
    executableArtifacts?: number;
    declarationArtifacts?: Array<{ artifactId: string; filePath: string; reason: string }>;
    declarationArtifactCount?: number;
    nonExecutableArtifacts?: Array<{ artifactId: string; filePath: string; reason: string }>;
    nonExecutableArtifactCount?: number;
    unsupportedArtifactCount?: number;
    unsupportedArtifactsTruncated?: boolean;
    artifactClassificationTruncated?: boolean;
    resolvedModuleEdgeCount?: number;
    unresolvedModuleEdgeCount?: number;
    selectedModuleGraphWorkCount?: number;
    selectedModuleGraphWorkLimit?: number;
    selectedModuleGraphTruncated?: boolean;
    exportExpansionTruncatedCount?: number;
    unsupportedArtifacts: Array<{ artifactId: string; filePath: string; reason: string; parserExclusion?: 'configuration' | 'plain_text_logic' }>;
    unsupportedExecutableArtifacts?: number;
    plainTextLogicArtifactCount?: number;
    plainTextLogicUnitCount?: number;
    omittedPlainTextLogicUnitCount?: number;
    externalCallbackBoundaryCount?: number;
    unresolvedEdgeCount: number;
    featureInventoryLimit: number;
    omittedEntryPointCount: number;
    featureInventoryTruncated: boolean;
    exhaustive: false;
    limitations: string[];
  };
  features: ReviewAnalysisFeature[];
};

const DOMAINS: ReviewDomain[] = ['security', 'business', 'technical', 'personnel'];
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.html', '.css']);
export const MAX_FEATURES_PER_BATCH = 30;
const MAX_FEATURE_INVENTORY = 2_048;
const MAX_PATHS_PER_FEATURE = 12;
const MAX_UNRESOLVED_PER_FEATURE = 12;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

type ParsedArtifact = { artifact: Artifact; source: ts.SourceFile };
type FunctionEntry = { name: string; node: ts.FunctionLikeDeclaration; artifact: Artifact; source: ts.SourceFile };
type FeatureDraft = {
  label: string;
  refs: AnalysisEvidenceReference[];
  handler?: FunctionEntry;
  handlers?: FunctionEntry[];
  key: string;
  analysisKind?: 'plain_text_logic';
  sourceRange?: PlainTextLogicSourceRange;
  middleware?: boolean;
  unresolvedReason?: string;
  initializationLabel?: string;
  externalCallbackBoundaryReason?: string;
  callbackRuntimeBoundaryReason?: string;
};

type CallbackResolution =
  | { status: 'resolved'; handlers: FunctionEntry[]; runtimeBoundaryReason?: string }
  | { status: 'external_boundary'; handlers: FunctionEntry[]; reason: string; runtimeBoundaryReason?: string }
  | { status: 'unresolved'; handlers: FunctionEntry[]; reason: string }
  | { status: 'empty'; handlers: [] };

type CallbackResolverContext = {
  checker: ts.TypeChecker;
  resolver: SelectedModuleResolver;
  parsedBySource: Map<ts.SourceFile, ParsedArtifact>;
  functionsByNode: Map<ts.FunctionLikeDeclaration, FunctionEntry>;
  importCache: Map<string, CallbackResolution>;
  mutatedSymbols: Set<ts.Symbol>;
  work: number;
};

function extension(filePath: string): string {
  const base = filePath.toLowerCase().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot);
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function sourceLine(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source, false)).line + 1;
}

function refFor(artifact: Artifact, source: ts.SourceFile, node: ts.Node): AnalysisEvidenceReference {
  return { artifactId: artifact.id, filePath: artifact.filePath, lineNumber: sourceLine(source, node), sourceVersion: artifact.contentHash || null };
}

function scriptKind(ext: string): ts.ScriptKind {
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function functionName(node: ts.FunctionLikeDeclaration): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name) return node.name.getText();
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (node.parent && ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
  return undefined;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node) || ts.isMethodSignature(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function collectFunctions(parsed: ParsedArtifact[]): FunctionEntry[] {
  const output: FunctionEntry[] = [];
  for (const item of parsed) {
    const visit = (node: ts.Node) => {
      if (isFunctionLike(node)) {
        const name = functionName(node) ?? `<anonymous@${sourceLine(item.source, node)}>`;
        if (node.body) output.push({ name, node, artifact: item.artifact, source: item.source });
      }
      ts.forEachChild(node, visit);
    };
    visit(item.source);
  }
  return output;
}

const MAX_CALLBACK_RESOLUTION_DEPTH = 16;
const MAX_CALLBACK_RESOLUTION_WORK = 20_000;

function callbackFileKey(fileName: string): string {
  const resolved = path.resolve(fileName).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Bind only the frozen selected sources. noResolve/noLib prevents ambient disk reads. */
function callbackChecker(parsed: ParsedArtifact[]): ts.TypeChecker | undefined {
  if (!parsed.length) return undefined;
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.Preserve,
  };
  const sources = new Map(parsed.map(item => [callbackFileKey(item.source.fileName), item.source]));
  if (sources.size !== parsed.length) return undefined;
  const host = ts.createCompilerHost(options);
  host.getSourceFile = fileName => sources.get(callbackFileKey(fileName));
  host.fileExists = fileName => sources.has(callbackFileKey(fileName));
  host.readFile = fileName => sources.get(callbackFileKey(fileName))?.text;
  const program = ts.createProgram(parsed.map(item => item.source.fileName), options, host);
  return program.getTypeChecker();
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function writableReferenceWithin(node: ts.Identifier, target: ts.Node): boolean {
  let current: ts.Node = node;
  while (current !== target) {
    const parent = current.parent;
    if ((ts.isPropertyAccessExpression(parent) && parent.expression === current)
      || (ts.isElementAccessExpression(parent) && parent.expression === current)
      || (ts.isArrayLiteralExpression(parent) && parent.elements.some(item => item === current))
      || (ts.isObjectLiteralExpression(parent) && parent.properties.some(item => item === current))
      || (ts.isPropertyAssignment(parent) && parent.initializer === current)
      || (ts.isShorthandPropertyAssignment(parent) && parent.name === current)) {
      current = parent;
      continue;
    }
    return false;
  }
  return true;
}

function isWriteReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && isAssignmentOperator(parent.operatorToken.kind)
    && writableReferenceWithin(node, parent.left)) return true;
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken, ts.SyntaxKind.DeleteKeyword].includes(parent.operator)
    && parent.operand === node) return true;
  if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent))
    && writableReferenceWithin(node, parent.initializer)) return true;
  return false;
}

function isMemberWriteReference(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && isAssignmentOperator(parent.operatorToken.kind) && parent.left === node) return true;
  if (ts.isDeleteExpression(parent) && parent.expression === node) return true;
  if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === node) return true;
  return (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken, ts.SyntaxKind.DeleteKeyword].includes(parent.operator)
    && parent.operand === node;
}

function rootObjectIdentifier(node: ts.Expression): ts.Identifier | undefined {
  let current = unwrapExpression(node);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? current : undefined;
}

function collectMutatedSymbols(parsed: ParsedArtifact[], checker: ts.TypeChecker): Set<ts.Symbol> {
  const mutated = new Set<ts.Symbol>();
  for (const item of parsed) {
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && isWriteReference(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) mutated.add(symbol);
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isMemberWriteReference(node)) {
        const member = ts.isPropertyAccessExpression(node) ? node.name : node;
        const memberSymbol = checker.getSymbolAtLocation(member);
        if (memberSymbol) mutated.add(memberSymbol);
        const root = rootObjectIdentifier(node.expression);
        const rootSymbol = root && checker.getSymbolAtLocation(root);
        if (rootSymbol) mutated.add(rootSymbol);
      }
      ts.forEachChild(node, visit);
    };
    visit(item.source);
  }
  return mutated;
}

function createCallbackResolverContext(
  parsed: ParsedArtifact[],
  resolver: SelectedModuleResolver,
  parsedBySource: Map<ts.SourceFile, ParsedArtifact>,
  functions: FunctionEntry[],
): CallbackResolverContext | undefined {
  const checker = callbackChecker(parsed);
  if (!checker) return undefined;
  return {
    checker,
    resolver,
    parsedBySource,
    functionsByNode: new Map(functions.map(item => [item.node, item])),
    importCache: new Map(),
    mutatedSymbols: collectMutatedSymbols(parsed, checker),
    work: 0,
  };
}

const CALLBACK_TARGET_UNRESOLVED = 'The JSX callback target could not be resolved to a unique, stable body in the selected frozen sources.';

function unresolvedCallback(reason = CALLBACK_TARGET_UNRESOLVED): CallbackResolution {
  return { status: 'unresolved', handlers: [], reason };
}

function externalCallback(reason: string, runtimeBoundaryReason?: string): CallbackResolution {
  return { status: 'external_boundary', handlers: [], reason,
    ...(runtimeBoundaryReason ? { runtimeBoundaryReason } : {}) };
}

function isImportSymbol(symbol: ts.Symbol): boolean {
  return !!symbol.declarations?.some(declaration => ts.isImportSpecifier(declaration)
    || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportEqualsDeclaration(declaration));
}

function parameterAncestor(node: ts.Node): ts.ParameterDeclaration | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isParameter(current)) return current;
    if (ts.isSourceFile(current)) return undefined;
  }
  return undefined;
}

function hasParameterAncestor(node: ts.Node): boolean {
  return !!parameterAncestor(node);
}

function uniqueHandlers(handlers: FunctionEntry[]): FunctionEntry[] {
  return [...new Map(handlers.map(handler => [`${handler.artifact.id}:${handler.node.getStart(handler.source, false)}:${handler.node.end}`, handler])).values()];
}

function mergeCallbackAlternatives(left: CallbackResolution, right: CallbackResolution): CallbackResolution {
  if (left.status === 'unresolved') return left;
  if (right.status === 'unresolved') return right;
  const handlers = uniqueHandlers([...left.handlers, ...right.handlers]);
  if (handlers.length > 8) return unresolvedCallback('The JSX callback expression selects more targets than the bounded resolver can safely map.');
  const runtimeBoundaryReason = left.status === 'resolved' ? left.runtimeBoundaryReason
    : left.status === 'external_boundary' ? left.runtimeBoundaryReason : undefined;
  const otherRuntimeReason = right.status === 'resolved' ? right.runtimeBoundaryReason
    : right.status === 'external_boundary' ? right.runtimeBoundaryReason : undefined;
  const external = left.status === 'external_boundary' || right.status === 'external_boundary';
  if (external) return {
    status: 'external_boundary', handlers,
    reason: 'At least one callback target is supplied by a caller and its implementation is outside the selected frozen sources.',
    ...(runtimeBoundaryReason || otherRuntimeReason ? { runtimeBoundaryReason: runtimeBoundaryReason ?? otherRuntimeReason } : {}),
  };
  if (!handlers.length) return { status: 'empty', handlers: [] };
  const hasEmptyAlternative = left.status === 'empty' || right.status === 'empty';
  return {
    status: 'resolved', handlers,
    ...(runtimeBoundaryReason || otherRuntimeReason || hasEmptyAlternative
      ? { runtimeBoundaryReason: runtimeBoundaryReason ?? otherRuntimeReason ?? 'The callback is conditionally absent on one selected local branch.' } : {}),
  };
}

function parameterCallback(symbol: ts.Symbol, context: CallbackResolverContext): CallbackResolution | undefined {
  const parameters = (symbol.declarations ?? []).map(parameterAncestor).filter((item): item is ts.ParameterDeclaration => !!item);
  if (!parameters.length) return undefined;
  if (context.mutatedSymbols.has(symbol)) return unresolvedCallback('The caller-supplied callback parameter is reassigned or mutated in the selected source.');
  if (parameters.some(parameter => !!parameter.initializer)
    || symbol.declarations?.some(declaration => ts.isBindingElement(declaration) && hasParameterAncestor(declaration) && !!declaration.initializer)) {
    return unresolvedCallback('The callback parameter has a local default expression and a caller-supplied value; its selected target is ambiguous.');
  }
  return {
    status: 'external_boundary', handlers: [],
    reason: 'The JSX callback is supplied through a parameter of the containing function; its caller-provided implementation is outside the selected source scope.',
  };
}

function declarationBindingSymbol(declaration: ts.Declaration, checker: ts.TypeChecker): ts.Symbol | undefined {
  const name = (declaration as ts.NamedDeclaration).name;
  return name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined;
}

function selectedDeclarationResolution(
  module: { artifact: Artifact; source: ts.SourceFile },
  localName: string,
  current: ParsedArtifact,
  context: CallbackResolverContext,
  visited: Set<ts.Symbol>,
  depth: number,
): CallbackResolution {
  const parsed = context.parsedBySource.get(module.source);
  if (!parsed) return unresolvedCallback('The imported callback is not in the selected frozen source set.');
  if (localName === DEFAULT_EXPORT_EXPRESSION) {
    const assignment = module.source.statements.find(ts.isExportAssignment);
    if (assignment) return resolveCallbackExpression(assignment.expression, parsed, context, visited, depth + 1);
    const declaration = module.source.statements.find(statement =>
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && hasModifier(statement, ts.SyntaxKind.DefaultKeyword));
    if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body) {
      const binding = declarationBindingSymbol(declaration, context.checker);
      if (binding && context.mutatedSymbols.has(binding)) return unresolvedCallback('The selected imported callback binding is reassigned or mutated.');
      if (binding && visited.has(binding)) return unresolvedCallback('The selected imported callback binding contains a cycle.');
      const handler = context.functionsByNode.get(declaration);
      return handler ? { status: 'resolved', handlers: [handler] } : unresolvedCallback();
    }
    return unresolvedCallback('The selected default export does not resolve to one local callback body.');
  }
  const declaration = context.resolver.declarations(module).get(localName);
  if (!declaration) return unresolvedCallback('The selected import has no unique local callback declaration.');
  const binding = declarationBindingSymbol(declaration, context.checker);
  if (binding && context.mutatedSymbols.has(binding)) return unresolvedCallback('The selected imported callback binding is reassigned or mutated.');
  if (binding && visited.has(binding)) return unresolvedCallback('The selected imported callback binding contains a cycle.');
  const selectedVisited = binding ? new Set(visited).add(binding) : visited;
  return resolveCallbackDeclaration(declaration, parsed, context, selectedVisited, depth + 1);
}

function selectedImportResolution(
  parsed: ParsedArtifact,
  localName: string,
  context: CallbackResolverContext,
  visited: Set<ts.Symbol>,
  depth: number,
): CallbackResolution {
  const key = `${parsed.artifact.id}\u0000${localName}`;
  const cached = context.importCache.get(key);
  if (cached) return cached;
  const result = context.resolver.resolveLocal(parsed, localName);
  const resolved = result.status === 'resolved'
    ? selectedDeclarationResolution(result.module, result.localName, parsed, context, visited, depth + 1)
    : unresolvedCallback(result.status === 'type_only'
      ? 'The imported callback is type-only and has no selected executable body.'
      : result.reason || 'The imported callback does not resolve to one selected frozen body.');
  context.importCache.set(key, resolved);
  return resolved;
}

function variableDeclarationForBinding(node: ts.Node): ts.VariableDeclaration | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isVariableDeclaration(current)) return current;
    if (ts.isParameter(current) || ts.isSourceFile(current)) return undefined;
  }
  return undefined;
}

function resolveObjectMember(
  object: ts.Expression,
  memberName: string,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  visited: Set<ts.Symbol>,
  depth: number,
): CallbackResolution {
  if (depth > MAX_CALLBACK_RESOLUTION_DEPTH || ++context.work > MAX_CALLBACK_RESOLUTION_WORK) {
    return unresolvedCallback('The selected callback exceeded the bounded lexical-resolution work limit.');
  }
  const expression = unwrapExpression(object);
  if (ts.isObjectLiteralExpression(expression)) {
    if (expression.properties.some(property => ts.isSpreadAssignment(property))) {
      return unresolvedCallback('The selected callback object contains a spread whose property precedence is unresolved.');
    }
    const hasUnknownComputedKey = expression.properties.some(property => {
      const name = 'name' in property ? property.name : undefined;
      return !!name && ts.isComputedPropertyName(name) && staticPropertyName(name) === undefined;
    });
    if (hasUnknownComputedKey) {
      return unresolvedCallback('The selected callback object contains a computed key that may overwrite its callback property.');
    }
    const matches = expression.properties.filter(property => staticPropertyName(property.name) === memberName);
    if (matches.length !== 1) return unresolvedCallback('The selected object callback property is missing or ambiguous.');
    const property = matches[0]!;
    if (ts.isMethodDeclaration(property) && property.body) {
      const handler = context.functionsByNode.get(property);
      return handler ? { status: 'resolved', handlers: [handler] } : unresolvedCallback();
    }
    if (ts.isPropertyAssignment(property)) return resolveCallbackExpression(property.initializer, parsed, context, visited, depth + 1);
    if (ts.isShorthandPropertyAssignment(property)) return resolveCallbackExpression(property.name, parsed, context, visited, depth + 1);
    return unresolvedCallback('The selected object callback property is not a statically callable value.');
  }
  if (ts.isIdentifier(expression)) {
    const symbol = context.checker.getSymbolAtLocation(expression);
    if (!symbol) return unresolvedCallback();
    if (visited.has(symbol)) return unresolvedCallback('The selected callback object alias contains a cycle.');
    const nextVisited = new Set(visited).add(symbol);
    if (context.mutatedSymbols.has(symbol)) return unresolvedCallback('The selected callback object is mutated, so its property target is unresolved.');
    const external = parameterCallback(symbol, context);
    if (external) return external;
    if (isImportSymbol(symbol)) {
      const binding = context.resolver.imports(parsed).get(expression.text);
      if (!binding || binding.typeOnly) return unresolvedCallback('The imported callback object is not a selected runtime binding.');
      if (binding.importedName === '*') {
        const target = context.resolver.resolveModule(parsed, binding.moduleSpecifier);
        if (!target.module) return unresolvedCallback(target.reason);
        const exported = context.resolver.resolveExport(target.module, memberName);
        return exported.status === 'resolved'
          ? selectedDeclarationResolution(exported.module, exported.localName, parsed, context, nextVisited, depth + 1)
          : unresolvedCallback(exported.status === 'unresolved' ? exported.reason : 'The selected namespace member is type-only.');
      }
      return unresolvedCallback('A default-imported callback object has an unresolved selected member.');
    }
    const declaration = symbol.declarations?.filter(ts.isVariableDeclaration);
    if (declaration?.length === 1 && declaration[0].initializer) {
      return resolveObjectMember(declaration[0].initializer, memberName, parsed, context, nextVisited, depth + 1);
    }
  }
  return unresolvedCallback('The JSX callback property is dynamic or not backed by one selected object literal.');
}

function resolveCallbackDeclaration(
  declaration: ts.Declaration,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  visited: Set<ts.Symbol>,
  depth: number,
): CallbackResolution {
  if (isFunctionLike(declaration)) {
    const handler = context.functionsByNode.get(declaration);
    return handler ? { status: 'resolved', handlers: [handler] } : unresolvedCallback('The selected callback declaration has no executable body.');
  }
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    return resolveCallbackExpression(declaration.initializer, parsed, context, visited, depth + 1);
  }
  if (ts.isBindingElement(declaration)) {
    const parameter = hasParameterAncestor(declaration);
    if (parameter) return {
      status: 'external_boundary', handlers: [],
      reason: 'The JSX callback is destructured from a parameter of the containing function; its caller-provided implementation is outside the selected source scope.',
    };
    const variable = variableDeclarationForBinding(declaration);
    if (!variable?.initializer) return unresolvedCallback('The destructured callback has no statically available initializer.');
    if (ts.isArrayBindingPattern(declaration.parent)) {
      const elements = declaration.parent.elements;
      if (elements.length === 2 && elements[1] === declaration && ts.isIdentifier(declaration.name)
        && !declaration.dotDotDotToken && !declaration.initializer) {
        const initializer = unwrapExpression(variable.initializer);
        if (ts.isCallExpression(initializer) && isReactHookCall(initializer, 'useState', parsed, context)) {
          return externalCallback('The callback is the setter returned in the second slot of an imported React useState tuple.',
            'React state scheduling and the surrounding hook lifecycle remain external runtime behavior.');
        }
      }
      return unresolvedCallback('The array-destructured callback is not a uniquely proven React state setter.');
    }
    const propertyName = staticPropertyName(declaration.propertyName ?? declaration.name as ts.PropertyName);
    if (propertyName && ts.isObjectLiteralExpression(unwrapExpression(variable.initializer))) {
      return resolveObjectMember(variable.initializer, propertyName, parsed, context, visited, depth + 1);
    }
    if (propertyName && ts.isObjectBindingPattern(declaration.parent)) {
      const contextMember = resolveSelectedContextHookMember(variable.initializer, propertyName, parsed, context, depth + 1);
      if (contextMember) return contextMember;
    }
    return resolveCallbackExpression(variable.initializer, parsed, context, visited, depth + 1);
  }
  return unresolvedCallback('The selected callback binding is not a stable local function, variable, or parameter.');
}

function isReactHookCall(call: ts.CallExpression, hookName: string, parsed: ParsedArtifact, context: CallbackResolverContext): boolean {
  const imports = context.resolver.imports(parsed);
  const isImportedReactBinding = (identifier: ts.Identifier, importedNames: string[]) => {
    const binding = imports.get(identifier.text);
    const symbol = context.checker.getSymbolAtLocation(identifier);
    return !!binding && binding.moduleSpecifier === 'react' && !binding.typeOnly
      && importedNames.includes(binding.importedName) && !!symbol && isImportSymbol(symbol)
      && !context.mutatedSymbols.has(symbol);
  };
  if (ts.isIdentifier(call.expression)) return isImportedReactBinding(call.expression, [hookName]);
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== hookName
    || !ts.isIdentifier(call.expression.expression)) return false;
  const member = context.checker.getSymbolAtLocation(call.expression.name);
  return (!member || !context.mutatedSymbols.has(member))
    && isImportedReactBinding(call.expression.expression, ['*', 'default']);
}

function isReactUseCallback(call: ts.CallExpression, parsed: ParsedArtifact, context: CallbackResolverContext): boolean {
  return isReactHookCall(call, 'useCallback', parsed, context);
}

const VITEST_MOCK_CONFIGURATION_METHODS = new Set([
  'mockImplementation', 'mockImplementationOnce', 'mockReturnThis', 'mockReturnValue', 'mockReturnValueOnce',
  'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce',
]);

function isImportedVitestVi(identifier: ts.Identifier, parsed: ParsedArtifact, context: CallbackResolverContext): boolean {
  const binding = context.resolver.imports(parsed).get(identifier.text);
  const symbol = context.checker.getSymbolAtLocation(identifier);
  return !!binding && binding.moduleSpecifier === 'vitest' && binding.importedName === 'vi' && !binding.typeOnly
    && !!symbol && isImportSymbol(symbol) && !context.mutatedSymbols.has(symbol);
}

function isVitestMockCallback(rawExpression: ts.Expression, parsed: ParsedArtifact, context: CallbackResolverContext): boolean {
  let expression = unwrapExpression(rawExpression);
  for (let depth = 0; depth < 8; depth++) {
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
    const property = expression.expression.name;
    const member = context.checker.getSymbolAtLocation(property);
    if (member && context.mutatedSymbols.has(member)) return false;
    if (property.text === 'fn') {
      return ts.isIdentifier(expression.expression.expression)
        && isImportedVitestVi(expression.expression.expression, parsed, context);
    }
    if (!VITEST_MOCK_CONFIGURATION_METHODS.has(property.text)) return false;
    expression = unwrapExpression(expression.expression.expression);
  }
  return false;
}

function soleDirectReturnExpression(fn: ts.FunctionLikeDeclaration): ts.Expression | undefined {
  if (!fn.body) return undefined;
  if (!ts.isBlock(fn.body)) return fn.body;
  const returns: ts.ReturnStatement[] = [];
  const visit = (node: ts.Node) => {
    if (node !== fn.body && isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  if (returns.length !== 1) return undefined;
  let current: ts.Node = returns[0]!;
  while (current.parent !== fn.body) {
    current = current.parent;
    if (!ts.isBlock(current)) return undefined;
  }
  return returns[0]!.expression;
}

function functionFromDeclaration(declaration: ts.Declaration | undefined): ts.FunctionLikeDeclaration | undefined {
  if (!declaration) return undefined;
  if (isFunctionLike(declaration) && declaration.body) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const initializer = unwrapExpression(declaration.initializer);
    if (isFunctionLike(initializer) && initializer.body) return initializer;
  }
  return undefined;
}

function selectedContextValueObject(
  rawExpression: ts.Expression,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  visited = new Set<ts.Symbol>(),
  depth = 0,
): ts.ObjectLiteralExpression | undefined {
  if (depth > MAX_CALLBACK_RESOLUTION_DEPTH || ++context.work > MAX_CALLBACK_RESOLUTION_WORK) return undefined;
  const expression = unwrapExpression(rawExpression);
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isIdentifier(expression)) {
    const symbol = context.checker.getSymbolAtLocation(expression);
    if (!symbol || visited.has(symbol) || context.mutatedSymbols.has(symbol)) return undefined;
    const declarations = (symbol.declarations ?? []).filter(ts.isVariableDeclaration);
    if (declarations.length !== 1 || !declarations[0]!.initializer) return undefined;
    const nextVisited = new Set(visited).add(symbol);
    return selectedContextValueObject(declarations[0]!.initializer!, parsed, context, nextVisited, depth + 1);
  }
  if (ts.isCallExpression(expression) && isReactHookCall(expression, 'useMemo', parsed, context)
    && expression.arguments[0]) {
    const callback = unwrapExpression(expression.arguments[0]);
    if (!isFunctionLike(callback) || !callback.body) return undefined;
    const returned = soleDirectReturnExpression(callback);
    return returned ? selectedContextValueObject(returned, parsed, context, visited, depth + 1) : undefined;
  }
  return undefined;
}

function selectedReactContextMember(
  contextSymbol: ts.Symbol,
  memberName: string,
  context: CallbackResolverContext,
): { parsed: ParsedArtifact; expression?: ts.Expression; handler?: FunctionEntry } | undefined {
  if (context.mutatedSymbols.has(contextSymbol)) return undefined;
  const declarations = (contextSymbol.declarations ?? []).filter(ts.isVariableDeclaration);
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (!declaration?.initializer) return undefined;
  const parsed = context.parsedBySource.get(declaration.getSourceFile());
  const initializer = unwrapExpression(declaration.initializer);
  if (!parsed || !ts.isCallExpression(initializer) || !isReactHookCall(initializer, 'createContext', parsed, context)) return undefined;

  const providerValues: Array<ts.Expression | undefined> = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isPropertyAccessExpression(tag) && tag.name.text === 'Provider' && ts.isIdentifier(tag.expression)
        && context.checker.getSymbolAtLocation(tag.expression) === contextSymbol) {
        const value = node.attributes.properties.find((attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'value');
        providerValues.push(value?.initializer && ts.isJsxExpression(value.initializer)
          ? value.initializer.expression : undefined);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.source);
  const providerValue = providerValues.length === 1 ? providerValues[0] : undefined;
  if (!providerValue) return undefined;
  const object = selectedContextValueObject(providerValue, parsed, context);
  if (!object || object.properties.some(property => ts.isSpreadAssignment(property)
    || ('name' in property && !!property.name && ts.isComputedPropertyName(property.name) && staticPropertyName(property.name) === undefined))) return undefined;
  const matches = object.properties.filter(property => staticPropertyName('name' in property ? property.name : undefined) === memberName);
  if (matches.length !== 1) return undefined;
  const property = matches[0]!;
  if (ts.isMethodDeclaration(property) && property.body) {
    const handler = context.functionsByNode.get(property);
    return handler ? { parsed, handler } : undefined;
  }
  if (ts.isPropertyAssignment(property)) return { parsed, expression: property.initializer };
  if (ts.isShorthandPropertyAssignment(property)) return { parsed, expression: property.name };
  return undefined;
}

function contextReadCall(
  rawExpression: ts.Expression,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  visited = new Set<ts.Symbol>(),
): ts.CallExpression | undefined {
  const expression = unwrapExpression(rawExpression);
  if (ts.isCallExpression(expression)) return isReactHookCall(expression, 'useContext', parsed, context) ? expression : undefined;
  if (!ts.isIdentifier(expression)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(expression);
  if (!symbol || visited.has(symbol) || context.mutatedSymbols.has(symbol)) return undefined;
  const declarations = (symbol.declarations ?? []).filter(ts.isVariableDeclaration);
  if (declarations.length !== 1 || !declarations[0]!.initializer) return undefined;
  return contextReadCall(declarations[0]!.initializer!, parsed, context, new Set(visited).add(symbol));
}

function resolveSelectedContextHookMember(
  rawExpression: ts.Expression,
  memberName: string,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  depth: number,
): CallbackResolution | undefined {
  const expression = unwrapExpression(rawExpression);
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
  const localName = expression.expression.text;
  const binding = context.resolver.imports(parsed).get(localName);
  const importSymbol = context.checker.getSymbolAtLocation(expression.expression);
  if (!binding || binding.importedName === '*' || !importSymbol || !isImportSymbol(importSymbol)) return undefined;
  if (binding.typeOnly || !importSymbol || context.mutatedSymbols.has(importSymbol)) {
    return unresolvedCallback('The selected context hook binding is type-only, mutated, or unavailable as a stable runtime import.');
  }
  if (depth > MAX_CALLBACK_RESOLUTION_DEPTH || ++context.work > MAX_CALLBACK_RESOLUTION_WORK) {
    return unresolvedCallback('The selected callback exceeded the bounded lexical-resolution work limit.');
  }
  const hook = context.resolver.resolveLocal(parsed, localName);
  if (hook.status !== 'resolved') return unresolvedCallback(hook.status === 'type_only'
    ? 'The selected context hook is type-only.' : hook.reason || 'The selected context hook is not uniquely available in frozen sources.');
  const hookParsed = context.parsedBySource.get(hook.module.source);
  const hookDeclaration = context.resolver.declarations(hook.module).get(hook.localName);
  const hookSymbol = hookDeclaration && declarationBindingSymbol(hookDeclaration, context.checker);
  const hookBindings: ts.Declaration[] = [];
  for (const statement of hook.module.source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === hook.localName) hookBindings.push(statement);
    if (ts.isVariableStatement(statement)) hookBindings.push(...statement.declarationList.declarations.filter(declaration =>
      ts.isIdentifier(declaration.name) && declaration.name.text === hook.localName));
  }
  const hookFunctionDeclarations = hookBindings.filter(isFunctionLike);
  const hookFunctionBodies = hookFunctionDeclarations.filter(declaration => !!declaration.body);
  const hookVariableDeclarations = hookBindings.filter(ts.isVariableDeclaration);
  const hookFunction = hookFunctionDeclarations.length
    ? hookFunctionBodies.length === 1 && hookVariableDeclarations.length === 0 ? hookFunctionBodies[0]
      : undefined
    : hookVariableDeclarations.length === 1 && hookBindings.length === 1
      ? functionFromDeclaration(hookVariableDeclarations[0]) : undefined;
  if (!hookParsed || !hookFunction || (hookSymbol && context.mutatedSymbols.has(hookSymbol))) {
    return unresolvedCallback('The selected context hook does not have one stable local function body.');
  }
  const returned = soleDirectReturnExpression(hookFunction);
  const contextRead = returned && contextReadCall(returned, hookParsed, context);
  if (!contextRead || contextRead.arguments.length !== 1 || !ts.isIdentifier(contextRead.arguments[0])) {
    return unresolvedCallback('The selected context hook does not return one direct React context value.');
  }
  const contextSymbol = context.checker.getSymbolAtLocation(contextRead.arguments[0]);
  if (!contextSymbol || context.mutatedSymbols.has(contextSymbol)) {
    return unresolvedCallback('The selected context hook binding is missing or mutated.');
  }
  const member = selectedReactContextMember(contextSymbol, memberName, context);
  if (!member) return unresolvedCallback('The selected context hook member is absent, ambiguous, or not backed by one selected React provider.');
  const property: CallbackResolution = member.handler
    ? { status: 'resolved', handlers: [member.handler] }
    : member.expression
      ? resolveCallbackExpression(member.expression, member.parsed, context, new Set(), depth + 1)
      : unresolvedCallback('The selected context hook member has no callback value.');
  if (property.status === 'unresolved' || property.status === 'empty') {
    return unresolvedCallback('The selected context hook member is not backed by a stable callback value.');
  }
  return {
    status: 'external_boundary', handlers: property.handlers,
    reason: 'The callback is selected through a frozen-source React context hook; active provider selection remains a runtime boundary.',
    runtimeBoundaryReason: 'React context provider selection and hook lifecycle remain outside the selected source map.',
  };
}

function uniqueLocalFunction(symbol: ts.Symbol, context: CallbackResolverContext): ts.FunctionLikeDeclaration | undefined {
  if (isImportSymbol(symbol) || context.mutatedSymbols.has(symbol)) return undefined;
  const declarations = symbol.declarations ?? [];
  const functionDeclarations = declarations.filter((declaration): declaration is ts.FunctionLikeDeclaration =>
    isFunctionLike(declaration) && !!declaration.body);
  const variableDeclarations = declarations.filter(ts.isVariableDeclaration);
  if (functionDeclarations.length === 1 && variableDeclarations.length === 0) return functionDeclarations[0];
  if (functionDeclarations.length === 0 && variableDeclarations.length === 1 && declarations.length === 1) {
    return functionFromDeclaration(variableDeclarations[0]);
  }
  return undefined;
}

function resolveLocalCallbackFactoryCall(
  call: ts.CallExpression,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  depth: number,
): CallbackResolution | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const symbol = context.checker.getSymbolAtLocation(call.expression);
  if (!symbol || isImportSymbol(symbol)) return undefined;
  if (depth > MAX_CALLBACK_RESOLUTION_DEPTH || ++context.work > MAX_CALLBACK_RESOLUTION_WORK) {
    return unresolvedCallback('The selected callback exceeded the bounded lexical-resolution work limit.');
  }
  if (context.mutatedSymbols.has(symbol)) return unresolvedCallback('The selected local callback factory binding is reassigned or mutated.');
  const factory = uniqueLocalFunction(symbol, context);
  if (!factory) return undefined;
  const returned = soleDirectReturnExpression(factory);
  const callback = returned && unwrapExpression(returned);
  if (!callback || !isFunctionLike(callback) || !callback.body) {
    return unresolvedCallback('The selected local callback factory does not return one stable inline function body.');
  }
  const handler = context.functionsByNode.get(callback);
  if (!handler) return unresolvedCallback('The selected local callback factory returns a function without a mapped executable body.');
  return { status: 'resolved', handlers: [handler],
    runtimeBoundaryReason: 'The selected local callback factory is mapped, while argument values and invocation-time captures remain runtime dependent.' };
}

function resolveCallbackExpression(
  rawExpression: ts.Expression,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
  visited = new Set<ts.Symbol>(),
  depth = 0,
): CallbackResolution {
  if (depth > MAX_CALLBACK_RESOLUTION_DEPTH || ++context.work > MAX_CALLBACK_RESOLUTION_WORK) {
    return unresolvedCallback('The selected callback exceeded the bounded lexical-resolution work limit.');
  }
  const expression = unwrapExpression(rawExpression);
  if (ts.isFunctionLike(expression)) {
    const handler = context.functionsByNode.get(expression);
    return handler ? { status: 'resolved', handlers: [handler] } : unresolvedCallback('The JSX callback function has no executable body.');
  }
  if (ts.isIdentifier(expression)) {
    if (expression.text === 'undefined') return { status: 'empty', handlers: [] };
    const symbol = ts.isShorthandPropertyAssignment(expression.parent) && expression.parent.name === expression
      ? context.checker.getShorthandAssignmentValueSymbol(expression.parent) ?? context.checker.getSymbolAtLocation(expression)
      : context.checker.getSymbolAtLocation(expression);
    if (!symbol) return unresolvedCallback();
    if (visited.has(symbol)) return unresolvedCallback('The selected callback alias contains a cycle.');
    const nextVisited = new Set(visited).add(symbol);
    if (context.mutatedSymbols.has(symbol)) return unresolvedCallback('The selected callback binding is reassigned or mutated.');
    const external = parameterCallback(symbol, context);
    if (external) return external;
    if (isImportSymbol(symbol)) return selectedImportResolution(parsed, expression.text, context, nextVisited, depth + 1);
    const declarations = symbol.declarations ?? [];
    const functions = declarations.filter((item): item is ts.FunctionLikeDeclaration => isFunctionLike(item) && !!item.body);
    if (functions.length === 1) {
      const handler = context.functionsByNode.get(functions[0]!);
      return handler ? { status: 'resolved', handlers: [handler] } : unresolvedCallback();
    }
    if (functions.length > 1) return unresolvedCallback('The callback identifier resolves to multiple function bodies.');
    if (declarations.length === 1) return resolveCallbackDeclaration(declarations[0]!, parsed, context, nextVisited, depth + 1);
    const variables = declarations.filter(ts.isVariableDeclaration);
    if (variables.length === 1) return resolveCallbackDeclaration(variables[0]!, parsed, context, nextVisited, depth + 1);
    return unresolvedCallback('The callback identifier is shadowed, ambiguous, or has no selected body.');
  }
  if (ts.isConditionalExpression(expression)) {
    const left = resolveCallbackExpression(expression.whenTrue, parsed, context, visited, depth + 1);
    const right = resolveCallbackExpression(expression.whenFalse, parsed, context, visited, depth + 1);
    return mergeCallbackAlternatives(left, right);
  }
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.AmpersandAmpersandToken].includes(expression.operatorToken.kind)) {
    const left = resolveCallbackExpression(expression.left, parsed, context, visited, depth + 1);
    const right = resolveCallbackExpression(expression.right, parsed, context, visited, depth + 1);
    return mergeCallbackAlternatives(left, right);
  }
  if (ts.isCallExpression(expression)) {
    if (isVitestMockCallback(expression, parsed, context)) {
      return externalCallback('The callback is a Vitest mock function created by an imported test-runtime binding.',
        'Vitest mock invocation and configured behavior remain external runtime behavior.');
    }
    if (isReactUseCallback(expression, parsed, context)) {
      if (!expression.arguments[0]) return unresolvedCallback('The imported React useCallback call has no selected callback argument.');
      const callback = resolveCallbackExpression(expression.arguments[0], parsed, context, visited, depth + 1);
      if (callback.status === 'unresolved' || callback.status === 'empty') return callback;
      const runtimeBoundaryReason = 'The selected callback body is mapped, but the external React hook lifecycle remains unverified.';
      return { ...callback, runtimeBoundaryReason };
    }
    const factory = resolveLocalCallbackFactoryCall(expression, parsed, context, depth + 1);
    if (factory) return factory;
    return unresolvedCallback('The JSX callback is produced by an unrecognized call; its return value is not inferred.');
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const member = context.checker.getSymbolAtLocation(expression.name);
    if (member && context.mutatedSymbols.has(member)) return unresolvedCallback('The selected callback property is reassigned or mutated.');
    const external = ts.isIdentifier(expression.expression)
      ? context.checker.getSymbolAtLocation(expression.expression) : undefined;
    if (external) {
      const parameter = parameterCallback(external, context);
      if (parameter) return parameter;
    }
    return resolveObjectMember(expression.expression, expression.name.text, parsed, context, visited, depth + 1);
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const memberName = staticText(expression.argumentExpression);
    if (memberName !== undefined) return resolveObjectMember(expression.expression, memberName, parsed, context, visited, depth + 1);
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return { status: 'empty', handlers: [] };
  return unresolvedCallback('The JSX callback uses a dynamic expression outside the bounded selected-source resolver.');
}

function resolveJsxCallback(
  expression: ts.Expression | undefined,
  parsed: ParsedArtifact,
  context: CallbackResolverContext | undefined,
  functionsByNode: Map<ts.FunctionLikeDeclaration, FunctionEntry>,
): CallbackResolution {
  if (!expression) return unresolvedCallback('The JSX callback attribute has no statically supplied callback expression.');
  const unwrapped = unwrapExpression(expression);
  if (ts.isFunctionLike(unwrapped)) {
    const handler = functionsByNode.get(unwrapped);
    return handler ? { status: 'resolved', handlers: [handler] } : unresolvedCallback('The JSX callback function has no executable body.');
  }
  return context ? resolveCallbackExpression(unwrapped, parsed, context) : unresolvedCallback();
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(modifier => modifier.kind === kind);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
}

function isStaticDataExpression(rawExpression: ts.Expression): boolean {
  const expression = unwrapExpression(rawExpression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)
    || expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword || expression.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) return true;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.every(element =>
    ts.isExpression(element) && isStaticDataExpression(element));
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.every(property =>
    ts.isPropertyAssignment(property) && !!staticPropertyName(property.name) && isStaticDataExpression(property.initializer));
  return false;
}

function staticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticText(name.expression);
  return undefined;
}

function isPublicClassMember(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node) ?? [];
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) return false;
  }
  const name = 'name' in node ? (node as ts.NamedDeclaration).name : undefined;
  return !name || !ts.isPrivateIdentifier(name);
}

type ExportOperationSink = (label: string, handler: FunctionEntry | undefined, referenceNode: ts.Node, key: string,
  unresolvedReason?: string, initializationLabel?: string) => void;
type ExportOperationCollectionResult = { resolvedModuleEdges: number; unresolvedModuleEdges: number; expansionTruncated: number };

const MAX_EXPORT_EXPANSION_WORK = 20_000;
const MAX_EXPORT_EXPANSION_DEPTH = 96;

/** Collect public operations from ESM declarations and statically named CommonJS exports. */
function collectExportedOperations(parsed: ParsedArtifact, functions: FunctionEntry[], resolver: SelectedModuleResolver,
  parsedBySource: Map<ts.SourceFile, ParsedArtifact>, allFunctions: FunctionEntry[], emit: ExportOperationSink): ExportOperationCollectionResult {
  const source = parsed.source;
  const functionByNode = new Map(functions.filter(item => item.source === source).map(item => [item.node, item]));
  const exportedHandlers = new Set<FunctionEntry>();
  const sink: ExportOperationSink = (label, handler, referenceNode, key, unresolvedReason, initializationLabel) => {
    emit(label, handler, referenceNode, key, unresolvedReason, initializationLabel);
    if (handler) exportedHandlers.add(handler);
  };
  let resolvedModuleEdges = 0;
  let unresolvedModuleEdges = 0;
  const noteModuleResolution = (status: 'resolved' | 'type_only' | 'unresolved') => {
    if (status === 'unresolved') unresolvedModuleEdges++;
    else resolvedModuleEdges++;
  };
  const declarations = new Map<string, ts.Declaration | ts.ImportDeclaration>();
  for (const statement of source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
    }
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      if (statement.importClause.name) declarations.set(statement.importClause.name.text, statement);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) declarations.set(bindings.name.text, statement);
      if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) declarations.set(specifier.name.text, specifier);
    }
  }

  const exportedPrototypeLocals = new Set<string>();
  const operationKey = (node: ts.Node, name: string, kind = 'export') => {
    const owner = parsedBySource.get(node.getSourceFile());
    const sourceFile = owner?.source ?? source;
    return `${owner?.artifact.id ?? parsed.artifact.id}|${kind}|${node.getStart(sourceFile, false)}-${node.getEnd()}|${name}`;
  };
  const keyForNode = (node: ts.Node, name: string, kind = 'export') => {
    const owner = parsedBySource.get(node.getSourceFile());
    const sourceFile = owner?.source ?? source;
    return `${owner?.artifact.id ?? parsed.artifact.id}|${kind}|${node.getStart(sourceFile, false)}-${node.getEnd()}|${name}`;
  };
  const addUnresolved = (name: string, node: ts.Node, reason: string, kind = 'export') => {
    sink(`Unresolved exported operation ${name}`, undefined, node, keyForNode(node, name, kind), reason);
  };
  const addInitializationBoundary = (name: string, node: ts.Node, reason: string, initializationLabel: string,
    kind = 'initializer', featureLabel = `Module initialization for ${name}`) => {
    sink(featureLabel, undefined, node, keyForNode(node, name, kind), reason, initializationLabel);
  };
  const isUnavailableDependency = (reason: string) => reason === 'The import is not a relative path within the selected frozen source set.'
    || reason === 'The import target is not present in the selected frozen source set.';
  const addSelectedResolution = (name: string, node: ts.Node, reason: string, kind = 'selected-module') => {
    if (isUnavailableDependency(reason)) {
      addInitializationBoundary(name, node,
        'The selected source binds this export to a dependency whose implementation and operation surface are outside the frozen source set.',
        'The selected source initializes or re-exports a binding from an unselected dependency; its operation surface remains unresolved.',
        'external-reexport', `External module initialization for ${name}`);
    } else addUnresolved(name, node, reason, kind);
  };
  const addSelectedResolutionCollection = (name: string, node: ts.Node, reasons: string[]) => {
    const dependencyReasons = reasons.filter(isUnavailableDependency);
    const graphReasons = reasons.filter(reason => !isUnavailableDependency(reason));
    if (dependencyReasons.length) addSelectedResolution(`${name}.[unselected dependency]`, node, dependencyReasons[0]);
    if (graphReasons.length) addUnresolved(`${name}.[unresolved surface]`, node, graphReasons.join(' '), 'selected-module');
  };
  const selectedFunctionEntry = (targetModule: { artifact: Artifact; source: ts.SourceFile }, localName: string): FunctionEntry | undefined => {
    const declaration = resolver.declarations(targetModule).get(localName);
    if (!declaration) return undefined;
    if (ts.isFunctionDeclaration(declaration)) return allFunctions.find(item => item.node === declaration);
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapExpression(declaration.initializer);
      if (isFunctionLike(initializer)) return allFunctions.find(item => item.node === initializer);
    }
    return undefined;
  };

  let expansionWork = 0;
  let expansionLimitHit = false;
  let expansionTruncated = 0;
  const consumeExpansion = (name: string, node: ts.Node, depth: number, kind = 'selected-module'): boolean => {
    if (expansionLimitHit) return false;
    if (depth > MAX_EXPORT_EXPANSION_DEPTH || expansionWork >= MAX_EXPORT_EXPANSION_WORK) {
      expansionLimitHit = true;
      expansionTruncated++;
      addUnresolved(`${name}.[expansion limit]`, node,
        'Selected-source operation expansion reached its explicit work or depth limit; remaining operation scope is unresolved.', kind);
      return false;
    }
    expansionWork++;
    return true;
  };

  const classDecorators = (classNode: ts.ClassLikeDeclaration, publicName: string) => {
    if (ts.canHaveDecorators(classNode)) for (const decorator of ts.getDecorators(classNode) ?? []) {
      addInitializationBoundary(publicName, decorator,
        'A class decorator executes during class initialization and may alter the exported class surface.',
        'The class decorator runs during module initialization; its effects on the exported surface remain unresolved.', 'class-decorator', `Class initialization for ${publicName}`);
    }
    if (classNode.heritageClauses?.length) addInitializationBoundary(publicName, classNode,
      'Class heritage expressions execute during class initialization and may resolve to external or dynamic behavior.',
      'The class heritage expression runs during module initialization; the selected superclass behavior is not expanded.', 'class-heritage', `Class initialization for ${publicName}`);
  };

  const addClassOperations = (classNode: ts.ClassLikeDeclaration, publicName: string, _nodeForEvidence: ts.Node,
    localName?: string, selected = false, visited = new Set<string>()) => {
    if (localName && !selected) exportedPrototypeLocals.add(localName);
    classDecorators(classNode, publicName);
    for (const member of classNode.members) {
      if (!consumeExpansion(publicName, member, visited.size, 'class-member')) break;
      if (ts.isClassStaticBlockDeclaration(member)) {
        addInitializationBoundary(publicName, member,
          'A class static block executes during module initialization; its calls and state changes are not expanded here.',
          'The class static block runs during module initialization; its internal control flow remains unresolved.', 'class-static-block', `Class static initialization for ${publicName}`);
        continue;
      }
      if (ts.canHaveDecorators(member)) for (const decorator of ts.getDecorators(member) ?? []) {
        addInitializationBoundary(publicName, decorator,
          'A class member decorator executes during class initialization and may alter the member surface.',
          'The member decorator runs during module initialization; its effects remain unresolved.', 'class-member-decorator', `Class initialization for ${publicName}`);
      }
      if (ts.isPropertyDeclaration(member) && member.initializer && !isPublicClassMember(member)
        && !isStaticDataExpression(member.initializer)) {
        const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
        addInitializationBoundary(`${publicName}.[private field]`, member,
          'A private class field initializer executes but is outside the public operation inventory; its effects remain unresolved.',
          isStatic
            ? 'The private static field initializer runs during module initialization; its effects remain unresolved.'
            : 'The private instance field initializer runs when an instance is created; its effects remain unresolved.',
          'private-class-field-initializer', `Class field initialization for ${publicName}`);
        continue;
      }
      if (!(ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member)
        || ts.isSetAccessorDeclaration(member) || ts.isPropertyDeclaration(member)) || !isPublicClassMember(member)) continue;
      const memberName = ts.isConstructorDeclaration(member) ? 'constructor' : staticPropertyName(member.name);
      const label = memberName ? `${publicName}.${memberName}` : `${publicName}.[computed member]`;
      if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && !member.body) continue;
      if (ts.isPropertyDeclaration(member) && !member.initializer) continue;
      if (ts.isPropertyDeclaration(member) && member.initializer && isStaticDataExpression(member.initializer)) continue;
      const candidate = ts.isPropertyDeclaration(member) && member.initializer
        ? unwrapExpression(member.initializer)
        : member;
      if (!memberName) addInitializationBoundary(label, member,
        'A computed class member name executes during class evaluation and cannot be assigned a stable public name.',
        'The computed class member name is evaluated during class initialization; its public identity remains unresolved.', 'class-member-name', `Class initialization for ${publicName}`);
      if (!memberName) {
        if (isFunctionLike(candidate)) {
          const handler = allFunctions.find(item => item.node === candidate);
          if (handler) sink(`Exported operation ${label}`, handler, member, keyForNode(member, label, 'class-member'));
          else addUnresolved(label, member, 'The computed public class member has no statically available function body.', 'class-member');
        } else if (ts.isPropertyDeclaration(member) && member.initializer && !isFunctionLike(candidate)) {
          addInitializationBoundary(label, member,
            'A computed class field has an initializer whose public name and resulting surface are unresolved.',
            'The computed class field initializer runs during class evaluation or instance creation; its resulting surface remains unresolved.', 'class-member-initializer', `Class field initialization for ${publicName}`);
        }
        continue;
      }
      if (ts.isFunctionLike(candidate)) {
        const handler = allFunctions.find(item => item.node === candidate);
        if (handler) sink(`Exported operation ${label}`, handler, member, keyForNode(member, label, 'class-member'));
        else addUnresolved(label, member, 'The public class member has no statically available function body.', 'class-member');
        continue;
      }
      if (ts.isPropertyDeclaration(member) && member.initializer) {
        if (ts.isObjectLiteralExpression(candidate) || ts.isIdentifier(candidate)) {
          if (selected) {
            const owner = parsedBySource.get(member.getSourceFile());
            if (owner) processSelectedValue(owner, candidate, label, member, visited);
            else addUnresolved(label, member, 'The selected class field has no matching parsed source artifact.', 'selected-module');
          } else processValue(candidate, label, member, new Set());
        } else {
          const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
          addInitializationBoundary(label, member,
            'The public class field initializer is executable, but its resulting value or operation surface is not statically enumerable.',
            isStatic
              ? 'The static field initializer runs during module initialization; its resulting surface remains unresolved.'
              : 'The instance field initializer runs when an instance is created; its resulting surface remains unresolved.', 'class-field-initializer', `Class field initialization for ${publicName}`);
        }
      }
    }
  };

  const selectedOperations = (targetModule: { artifact: Artifact; source: ts.SourceFile }, localName: string,
    publicName: string, evidenceNode: ts.Node, visited = new Set<string>()): void => {
    const target = parsedBySource.get(targetModule.source);
    if (!target) {
      addUnresolved(publicName, evidenceNode, 'The resolved selected module has no matching parsed artifact record.', 'selected-module');
      return;
    }
    if (!consumeExpansion(publicName, evidenceNode, visited.size)) return;
    const identity = `${target.artifact.id}|${localName}`;
    if (visited.has(identity)) {
      addUnresolved(publicName, evidenceNode, 'The selected export resolves through a recursive alias that cannot be expanded safely.', 'selected-module');
      return;
    }
    const next = new Set(visited).add(identity);
    if (localName === '*') {
      const inventory = resolver.exportedNames(targetModule);
      for (const exportedName of inventory.names) {
        const resolution = resolver.resolveExport(targetModule, exportedName);
        noteModuleResolution(resolution.status);
        if (resolution.status === 'resolved') {
          selectedOperations(resolution.module, resolution.localName, `${publicName}.${exportedName}`, evidenceNode, next);
        } else if (resolution.status === 'unresolved') {
          addSelectedResolution(`${publicName}.${exportedName}`, evidenceNode, resolution.reason);
        }
      }
      if (inventory.unresolved.length) addSelectedResolutionCollection(`${publicName}.[namespace surface]`, evidenceNode, inventory.unresolved);
      return;
    }
    const declaration = resolver.declarations(targetModule).get(localName);
    if (!declaration && localName === DEFAULT_EXPORT_EXPRESSION) {
      const assignment = target.source.statements.find(ts.isExportAssignment);
      if (assignment) processSelectedValue(target, assignment.expression, publicName, evidenceNode, next);
      else addUnresolved(publicName, evidenceNode, 'The selected default expression is not statically available.', 'selected-module');
      return;
    }
    if (!declaration) {
      addUnresolved(publicName, evidenceNode, 'The selected export has no matching top-level declaration in its frozen source.', 'selected-module');
      return;
    }
    if (ts.isFunctionDeclaration(declaration)) {
      const handler = allFunctions.find(item => item.node === declaration);
      if (handler) sink(`Exported operation ${publicName}`, handler, evidenceNode,
        keyForNode(handler.node, `${publicName}|${target.artifact.id}`, 'selected-export'));
      else addUnresolved(publicName, evidenceNode, 'The selected export has no statically available function body.', 'selected-module');
      return;
    }
    if (ts.isClassDeclaration(declaration)) {
      addClassOperations(declaration, publicName, evidenceNode, localName, true, next);
      return;
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      processSelectedValue(target, declaration.initializer, publicName, evidenceNode, next);
      return;
    }
    addUnresolved(publicName, evidenceNode, 'The selected export has no statically available executable declaration.', 'selected-module');
  };

  const processSelectedValue = (target: ParsedArtifact, rawExpression: ts.Expression, publicName: string,
    evidenceNode: ts.Node, visited: Set<string>): void => {
    const expression = unwrapExpression(rawExpression);
    const identity = `${target.artifact.id}|${expression.pos}:${expression.end}:${expression.kind}`;
    if (visited.has(identity)) {
      addUnresolved(publicName, evidenceNode, 'The selected exported value resolves through a recursive alias or object cycle and cannot be expanded safely.', 'selected-module');
      return;
    }
    if (!consumeExpansion(publicName, evidenceNode, visited.size)) return;
    const nextVisited = new Set(visited).add(identity);
    if (isStaticDataExpression(expression)) return;
    if (isFunctionLike(expression)) {
      const handler = allFunctions.find(item => item.node === expression);
      if (handler) sink(`Exported operation ${publicName}`, handler, evidenceNode,
        keyForNode(handler.node, `${publicName}|${target.artifact.id}`, 'selected-export'));
      else addUnresolved(publicName, evidenceNode, 'The selected exported function body cannot be resolved.', 'selected-module');
      return;
    }
    if (ts.isClassExpression(expression)) {
      addClassOperations(expression, publicName, evidenceNode, expression.name?.text, true, nextVisited);
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (let index = 0; index < expression.elements.length; index++) {
        const element = expression.elements[index];
        if (ts.isSpreadElement(element)) {
          addInitializationBoundary(`${publicName}[${index}]`, element,
            'A selected array spread may introduce callable values that cannot be enumerated safely.',
            'The selected array spread is evaluated during module initialization; its values remain unresolved.', 'selected-array-spread');
        } else if (!ts.isOmittedExpression(element)) processSelectedValue(target, element, `${publicName}[${index}]`, element, nextVisited);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (!consumeExpansion(publicName, property, visited.size)) break;
        if (ts.isSpreadAssignment(property)) {
          processSelectedValue(target, property.expression, publicName, evidenceNode, nextVisited);
          continue;
        }
        const memberName = staticPropertyName(property.name);
        if (!memberName) {
          const dynamicLabel = `${publicName}.[computed member]`;
          const value = ts.isPropertyAssignment(property) ? unwrapExpression(property.initializer) : property;
          if (isFunctionLike(value)) {
            const handler = allFunctions.find(item => item.node === value);
            if (handler) sink(`Callable body for ${dynamicLabel}`, handler, property, keyForNode(property, dynamicLabel, 'computed-object-member'));
            else addUnresolved(dynamicLabel, property, 'The selected computed object member has no statically available function body.', 'selected-module');
          } else if (ts.isPropertyAssignment(property)) {
            const propertyValue = unwrapExpression(property.initializer);
            if (!isStaticDataExpression(propertyValue)) processSelectedValue(target, propertyValue, dynamicLabel, property, nextVisited);
          }
          addInitializationBoundary(dynamicLabel, property,
            'A computed selected object member name executes during object initialization and cannot be assigned a stable public name.',
            'The selected computed object member name is evaluated when the object is created; the public identity remains unresolved.',
            'selected-computed-member', `Object initialization for ${publicName}`);
          continue;
        }
        const childName = publicName === 'default' ? memberName : `${publicName}.${memberName}`;
        if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
          const handler = allFunctions.find(item => item.node === property);
          if (handler) sink(`Exported operation ${childName}`, handler, property,
            keyForNode(property, `${childName}|${target.artifact.id}`, 'selected-export'));
          else addUnresolved(childName, property, 'The selected object member has no statically available function body.', 'selected-module');
        } else if (ts.isPropertyAssignment(property)) {
          const value = unwrapExpression(property.initializer);
          if (!isStaticDataExpression(value)) processSelectedValue(target, value, childName, property, nextVisited);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          processSelectedValue(target, property.name, childName, property, nextVisited);
        }
      }
      return;
    }
    if (ts.isIdentifier(expression)) {
      const resolution = resolver.resolveLocal(target, expression.text);
      if (resolution.status === 'type_only') return;
      if (resolution.status === 'resolved') {
        selectedOperations(resolution.module, resolution.localName, publicName, evidenceNode, nextVisited);
        return;
      }
      const declaration = resolver.declarations(target).get(expression.text);
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        selectedOperations(target, expression.text, publicName, evidenceNode, nextVisited);
        return;
      }
      const binding = resolver.imports(target).get(expression.text);
      if (binding && !binding.moduleSpecifier.startsWith('./') && !binding.moduleSpecifier.startsWith('../')) {
        addInitializationBoundary(publicName, expression,
          'The selected value comes from an unselected external module; its implementation and operation surface are not present in frozen sources.',
          'The selected module initializes this value from an external import; its implementation and operation surface remain unresolved.', 'external-import');
      } else addSelectedResolution(publicName, evidenceNode, resolution.reason);
      return;
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.expression.getText(target.source) === 'Object' && expression.expression.name.text === 'assign') {
      for (const value of expression.arguments) processSelectedValue(target, value, publicName, evidenceNode, nextVisited);
      return;
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.expression.getText(target.source) === 'Object'
      && ['freeze', 'seal'].includes(expression.expression.name.text) && expression.arguments[0]) {
      processSelectedValue(target, expression.arguments[0], publicName, evidenceNode, nextVisited);
      return;
    }
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
      const callee = ts.isCallExpression(expression) ? expression.expression : expression.expression;
      const calleeNameValue = ts.isIdentifier(callee) ? callee.text : undefined;
      if (ts.isNewExpression(expression) && calleeNameValue) {
        const local = resolver.resolveLocal(target, calleeNameValue);
        if (local.status === 'resolved') {
          const declaration = resolver.declarations(local.module).get(local.localName);
          if (ts.isClassDeclaration(declaration)) {
            addClassOperations(declaration, publicName, expression, local.localName, true, nextVisited);
            addInitializationBoundary(publicName, expression,
              'The selected class constructor executes, but runtime instance substitution and the full returned surface remain unresolved.',
              'The selected class is instantiated during module initialization; constructor effects and the resulting instance surface remain unresolved.', 'selected-constructor-init');
            return;
          }
        }
      }
      if (calleeNameValue) {
        const local = resolver.resolveLocal(target, calleeNameValue);
        if (local.status === 'resolved') {
          const factory = selectedFunctionEntry(local.module, local.localName);
          if (factory) sink(`Factory operation ${factory.name} initializes ${publicName}`, factory, expression,
            keyForNode(expression, `${publicName}|${target.artifact.id}|${factory.name}`, 'selected-factory'));
        }
      }
      addInitializationBoundary(publicName, expression,
        'The factory call executes during module initialization, but its returned operation surface remains unresolved.',
        'The selected factory call executes during module initialization; its returned operation surface remains unresolved.', 'selected-factory-init');
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      processSelectedValue(target, expression.whenTrue, `${publicName}.[true value]`, expression.whenTrue, nextVisited);
      processSelectedValue(target, expression.whenFalse, `${publicName}.[false value]`, expression.whenFalse, nextVisited);
      addInitializationBoundary(publicName, expression,
        'The selected exported value is initialized from a dynamic or conditional expression whose resulting operation surface cannot be enumerated.',
        'The selected expression executes during module initialization; its resulting operation surface remains unresolved.', 'selected-initializer');
      return;
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
      processSelectedValue(target, expression.left, `${publicName}.[left value]`, expression.left, nextVisited);
      processSelectedValue(target, expression.right, `${publicName}.[right value]`, expression.right, nextVisited);
      addInitializationBoundary(publicName, expression,
        'The selected exported value uses conditional logical evaluation whose resulting operation surface cannot be enumerated.',
        'The selected logical expression executes during module initialization; its resulting operation surface remains unresolved.', 'selected-initializer');
      return;
    }
    addInitializationBoundary(publicName, expression,
      'The selected exported value uses executable syntax whose resulting operation surface is outside the supported static resolver.',
      'The selected expression executes during module initialization; its resulting operation surface remains unresolved.', 'selected-initializer');
  };

  const processValue = (rawExpression: ts.Expression, publicName: string, referenceNode: ts.Node, seen = new Set<string>(), localAlias?: string): void => {
    const expression = unwrapExpression(rawExpression);
    if (isStaticDataExpression(expression)) return;
    const owner = parsedBySource.get(expression.getSourceFile());
    const identity = `${owner?.artifact.id ?? parsed.artifact.id}|${expression.pos}:${expression.end}:${expression.kind}`;
    if (seen.has(identity)) {
      addUnresolved(publicName, referenceNode, 'The exported value resolves through a recursive alias that cannot be expanded safely.');
      return;
    }
    if (!consumeExpansion(publicName, referenceNode, seen.size, 'export')) return;
    const nextSeen = new Set(seen).add(identity);
    if (isFunctionLike(expression)) {
      const handler = functionByNode.get(expression);
      if (localAlias && !ts.isArrowFunction(expression)) exportedPrototypeLocals.add(localAlias);
      const displayName = publicName === 'default' && handler && !handler.name.startsWith('<anonymous@')
        ? `default ${handler.name}` : publicName;
      if (handler) sink(`Exported operation ${displayName}`, handler, referenceNode, operationKey(referenceNode, publicName));
      else addUnresolved(publicName, referenceNode, 'The exported function body cannot be resolved from this frozen artifact.');
      return;
    }
    if (ts.isClassExpression(expression)) {
      addClassOperations(expression, publicName, referenceNode, localAlias ?? expression.name?.text);
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      let recognized = 0;
      for (const property of expression.properties) {
        if (!consumeExpansion(publicName, property, seen.size, 'export')) break;
        if (ts.isSpreadAssignment(property)) {
          processStaticSpread(property.expression, publicName, property, nextSeen);
          recognized++;
          continue;
        }
        const memberName = staticPropertyName(property.name);
        if (!memberName) {
          const dynamicLabel = `${publicName}.[computed member]`;
          const candidate = ts.isPropertyAssignment(property) ? unwrapExpression(property.initializer) : property;
          if (isFunctionLike(candidate)) {
            const handler = functionByNode.get(candidate as ts.FunctionLikeDeclaration);
            if (handler) sink(`Callable body for ${dynamicLabel}`, handler, property, keyForNode(property, dynamicLabel, 'computed-object-member'));
            else addUnresolved(dynamicLabel, property, 'The computed object member has no statically available function body.', 'computed-object-member');
          } else if (ts.isPropertyAssignment(property)) {
            const value = unwrapExpression(property.initializer);
            if (!isStaticDataExpression(value) && (ts.isObjectLiteralExpression(value) || ts.isIdentifier(value))) {
              processValue(value, dynamicLabel, property, nextSeen);
            }
          }
          addInitializationBoundary(dynamicLabel, property,
            'A computed object member name executes during object initialization and cannot be assigned a stable public name.',
            'The computed object member name is evaluated when the object is created; the public member identity remains unresolved.',
            'computed-object-member-name', `Object initialization for ${publicName}`);
          continue;
        }
        const childName = publicName === 'default' ? memberName : `${publicName}.${memberName}`;
        if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
          const handler = functionByNode.get(property);
          if (handler) sink(`Exported operation ${childName}`, handler, property, operationKey(property, childName, 'object-member'));
          else addUnresolved(childName, property, 'The exported object member has no statically available function body.', 'object-member');
          recognized++;
        } else if (ts.isPropertyAssignment(property)) {
          const value = unwrapExpression(property.initializer);
          if (!isStaticDataExpression(value) && (ts.isFunctionLike(value) || ts.isClassExpression(value) || ts.isObjectLiteralExpression(value)
            || ts.isIdentifier(value) || ts.isCallExpression(value) || ts.isNewExpression(value) || ts.isPropertyAccessExpression(value)
            || ts.isElementAccessExpression(value) || ts.isConditionalExpression(value))) {
            processValue(value, childName, property, nextSeen);
            recognized++;
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          processValue(property.name, childName, property, nextSeen);
          recognized++;
        }
      }
      if (!recognized && !expression.properties.length) addUnresolved(publicName, referenceNode, 'The exported object is empty, so its operation surface is not established.');
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (let index = 0; index < expression.elements.length; index++) {
        const element = expression.elements[index];
        if (ts.isSpreadElement(element)) {
          addInitializationBoundary(`${publicName}[${index}]`, element,
            'An exported array spread may introduce callable values that cannot be enumerated safely.',
            'The exported array spread is evaluated during module initialization; its values remain unresolved.', 'array-spread');
        } else if (!ts.isOmittedExpression(element)) processValue(element, `${publicName}[${index}]`, element, nextSeen);
      }
      return;
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.expression.getText(source) === 'Object' && expression.expression.name.text === 'assign') {
      if (expression.arguments.length < 2) {
        addUnresolved(publicName, referenceNode, 'Object.assign does not expose a statically enumerable operation object.');
      } else {
        for (const value of expression.arguments) processValue(value, publicName, referenceNode, nextSeen);
      }
      return;
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.expression.getText(source) === 'Object'
      && ['freeze', 'seal'].includes(expression.expression.name.text) && expression.arguments[0]) {
      processValue(expression.arguments[0], publicName, referenceNode, nextSeen, localAlias);
      return;
    }
    if (ts.isIdentifier(expression)) {
      const declaration = declarations.get(expression.text);
      if (declaration && ts.isFunctionDeclaration(declaration)) {
        if (!declaration.body || hasModifier(declaration, ts.SyntaxKind.DeclareKeyword)) return;
        const handler = functionByNode.get(declaration);
        if (declaration.name) exportedPrototypeLocals.add(declaration.name.text);
        const displayName = publicName === 'default' && handler && !handler.name.startsWith('<anonymous@')
          ? `default ${handler.name}` : publicName;
        if (handler) sink(`Exported operation ${displayName}`, handler, referenceNode, operationKey(referenceNode, publicName));
        else addUnresolved(publicName, referenceNode, 'The exported function declaration has no statically available body.');
        return;
      }
      if (declaration && ts.isClassDeclaration(declaration)) {
        addClassOperations(declaration, publicName, referenceNode, declaration.name?.text ?? expression.text);
        return;
      }
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        processValue(declaration.initializer, publicName, referenceNode, nextSeen, expression.text);
        return;
      }
      if (declaration && ts.isImportSpecifier(declaration)) {
        const resolution = resolver.resolveLocal(parsed, expression.text);
        noteModuleResolution(resolution.status);
        if (resolution.status === 'resolved') selectedOperations(resolution.module, resolution.localName, publicName, referenceNode, nextSeen);
        else if (resolution.status === 'unresolved') {
          const binding = resolver.imports(parsed).get(expression.text);
          if (binding && !binding.moduleSpecifier.startsWith('./') && !binding.moduleSpecifier.startsWith('../')) {
            addInitializationBoundary(publicName, expression,
              'The exported value comes from an unselected external module; its implementation and operation surface are not present in frozen sources.',
              'The selected module initializes this value from an external import; its implementation and operation surface remain unresolved.', 'external-import');
          } else addSelectedResolution(publicName, referenceNode, resolution.reason);
        }
        return;
      }
      if (declaration && ts.isImportDeclaration(declaration)) {
        const resolution = resolver.resolveLocal(parsed, expression.text);
        noteModuleResolution(resolution.status);
        if (resolution.status === 'resolved') selectedOperations(resolution.module, resolution.localName, publicName, referenceNode, nextSeen);
        else if (resolution.status === 'unresolved') {
          const binding = resolver.imports(parsed).get(expression.text);
          if (binding && !binding.moduleSpecifier.startsWith('./') && !binding.moduleSpecifier.startsWith('../')) {
            addInitializationBoundary(publicName, expression,
              'The exported value comes from an unselected external module; its implementation and operation surface are not present in frozen sources.',
              'The selected module initializes this value from an external import; its implementation and operation surface remain unresolved.', 'external-import');
          } else addSelectedResolution(publicName, referenceNode, resolution.reason);
        }
        return;
      }
      addInitializationBoundary(publicName, expression,
        'The exported identifier has no selected frozen declaration; its runtime value and operation surface remain unresolved.',
        'The selected module initializes this value from an unselected runtime binding; its operation surface remains unresolved.', 'unselected-identifier');
      return;
    }
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
        && ['require', 'eval', 'Function'].includes(expression.expression.text)) {
        addInitializationBoundary(publicName, expression,
          'The exported value crosses a dynamic module-loading or dynamic-code boundary; the external implementation and returned surface are not selected-source evidence.',
          'The dynamic loader or code generator runs during module initialization; its external or generated operation surface remains unresolved.', 'dynamic-export');
        return;
      }
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
        const declaration = declarations.get(expression.expression.text);
        let factory: FunctionEntry | undefined;
        if (declaration && ts.isFunctionDeclaration(declaration)) {
          factory = functionByNode.get(declaration);
        } else if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && isFunctionLike(unwrapExpression(declaration.initializer))) {
          const factoryNode = unwrapExpression(declaration.initializer) as ts.FunctionLikeDeclaration;
          factory = functionByNode.get(factoryNode);
        } else if (declaration && (ts.isImportSpecifier(declaration) || ts.isImportDeclaration(declaration))) {
          const resolution = resolver.resolveLocal(parsed, expression.expression.text);
          noteModuleResolution(resolution.status);
          if (resolution.status === 'resolved') {
            factory = selectedFunctionEntry(resolution.module, resolution.localName);
          }
        }
        if (factory) sink(`Factory operation ${factory.name} initializes ${publicName}`, factory, expression,
          operationKey(expression, `${publicName}|factory|${factory.name}`));
      }
      if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression)) {
        const className = expression.expression.text;
        const declaration = declarations.get(className);
        if (declaration && ts.isClassDeclaration(declaration)) {
          addClassOperations(declaration, publicName, expression, className);
          addInitializationBoundary(publicName, expression,
            'The class constructor executes, but the runtime instance and returned surface cannot be proven from the selected source.',
            'The selected class is instantiated during module initialization; constructor effects and the resulting instance surface remain unresolved.', 'constructor-init');
          return;
        }
        if (declaration && (ts.isImportSpecifier(declaration) || ts.isImportDeclaration(declaration))) {
          const resolution = resolver.resolveLocal(parsed, className);
          noteModuleResolution(resolution.status);
          if (resolution.status === 'resolved') {
            const selectedDeclaration = resolver.declarations(resolution.module).get(resolution.localName);
            if (ts.isClassDeclaration(selectedDeclaration)) {
              selectedOperations(resolution.module, resolution.localName, publicName, expression, nextSeen);
              addInitializationBoundary(publicName, expression,
                'The selected class constructor executes, but runtime instance substitution and the full returned surface remain unresolved.',
                'The selected class is instantiated during module initialization; constructor effects and the resulting instance surface remain unresolved.', 'selected-constructor-init');
              return;
            }
          }
        }
      }
      addInitializationBoundary(publicName, expression,
        'The factory call executes during module initialization, but its returned operation surface remains unresolved.',
        'The exported factory call executes during module initialization; its returned operation surface remains unresolved.', 'module-factory');
      return;
    }
    if (ts.isConditionalExpression(expression)
      || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression) || ts.isAwaitExpression(expression)) {
      if (ts.isConditionalExpression(expression)) {
        processValue(expression.whenTrue, `${publicName}.[true value]`, expression.whenTrue, nextSeen);
        processValue(expression.whenFalse, `${publicName}.[false value]`, expression.whenFalse, nextSeen);
      }
      addInitializationBoundary(publicName, expression,
        'The exported value is initialized from a dynamic or conditional expression whose resulting operation surface cannot be enumerated.',
        'The selected expression executes during module initialization; its resulting operation surface remains unresolved.', 'dynamic-initializer');
      return;
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
      processValue(expression.left, `${publicName}.[left value]`, expression.left, nextSeen);
      processValue(expression.right, `${publicName}.[right value]`, expression.right, nextSeen);
      addInitializationBoundary(publicName, expression,
        'The exported value uses conditional logical evaluation whose resulting operation surface cannot be enumerated.',
        'The selected logical expression executes during module initialization; its resulting operation surface remains unresolved.', 'dynamic-initializer');
      return;
    }
    addInitializationBoundary(publicName, expression,
      'The exported value uses executable syntax whose resulting operation surface is outside the supported static resolver.',
      'The selected expression executes during module initialization; its resulting operation surface remains unresolved.', 'dynamic-initializer');
  };

  const processStaticSpread = (rawExpression: ts.Expression, publicName: string, referenceNode: ts.Node,
    seen: Set<string>, resolving = new Set<string>()): void => {
    const expression = unwrapExpression(rawExpression);
    if (!consumeExpansion(publicName, referenceNode, resolving.size, 'object-spread')) return;
    if (isStaticDataExpression(expression)) return;
    if (ts.isObjectLiteralExpression(expression)) {
      processValue(expression, publicName, referenceNode, seen);
      return;
    }
    if (ts.isIdentifier(expression)) {
      if (resolving.has(expression.text)) {
        addUnresolved(`${publicName}.[spread]`, referenceNode, 'A recursive object spread cannot be expanded safely.');
        return;
      }
      const nextResolving = new Set(resolving).add(expression.text);
      const declaration = declarations.get(expression.text);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        processStaticSpread(declaration.initializer, publicName, referenceNode, seen, nextResolving);
        return;
      }
      const importBinding = resolver.imports(parsed).get(expression.text);
      if (importBinding) {
        const resolution = resolver.resolveLocal(parsed, expression.text);
        noteModuleResolution(resolution.status);
        if (resolution.status === 'type_only') return;
        if (resolution.status === 'resolved') {
          const target = parsedBySource.get(resolution.module.source);
          const targetDeclaration = resolver.declarations(resolution.module).get(resolution.localName);
          if (target && ts.isVariableDeclaration(targetDeclaration) && targetDeclaration.initializer) {
            processSelectedValue(target, targetDeclaration.initializer, publicName, referenceNode, seen);
            return;
          }
        }
        if (resolution.status === 'unresolved') addSelectedResolution(`${publicName}.[spread]`, referenceNode, resolution.reason);
        else addUnresolved(`${publicName}.[spread]`, referenceNode, 'The selected imported spread is not a statically enumerable object value.', 'selected-module');
        return;
      }
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.expression.getText(source) === 'Object'
      && ['assign', 'freeze', 'seal'].includes(expression.expression.name.text)) {
      processValue(expression, publicName, referenceNode, seen);
      return;
    }
    addUnresolved(`${publicName}.[spread]`, referenceNode,
      'An object spread is not a statically known local object or selected-source object value.');
  };

  const rejectUnresolvedDirectExport = (name: string, node: ts.Node): boolean => {
    const resolution=resolver.resolveExport(parsed,name);
    if(resolution.status==='resolved') return false;
    if(resolution.status==='unresolved') {
      unresolvedModuleEdges++;
      addSelectedResolution(name,node,resolution.reason);
    }
    return true;
  };
  const processExportedDeclaration = (declaration: ts.Statement) => {
    if (ts.isFunctionDeclaration(declaration)) {
      if (!declaration.body) return;
      const name = declaration.name?.text ?? 'default';
      if(rejectUnresolvedDirectExport(hasModifier(declaration,ts.SyntaxKind.DefaultKeyword)?'default':name,declaration)) return;
      const handler = functionByNode.get(declaration);
      if (declaration.name) exportedPrototypeLocals.add(declaration.name.text);
      if (handler) sink(`Exported operation ${name}`, handler, declaration, operationKey(declaration, name));
      return;
    }
    if (ts.isClassDeclaration(declaration)) {
      if(rejectUnresolvedDirectExport(hasModifier(declaration,ts.SyntaxKind.DefaultKeyword)?'default':declaration.name?.text ?? 'default',declaration)) return;
      addClassOperations(declaration, declaration.name?.text ?? 'default', declaration, declaration.name?.text);
      return;
    }
    if (ts.isVariableStatement(declaration)) {
      for (const variable of declaration.declarationList.declarations) {
        if (!variable.initializer || !ts.isIdentifier(variable.name)) continue;
        if(rejectUnresolvedDirectExport(variable.name.text,variable)) continue;
        processValue(variable.initializer, variable.name.text, variable, new Set(), variable.name.text);
      }
    }
  };

  for (const statement of source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement))
      && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
      processExportedDeclaration(statement);
    } else if (ts.isExportAssignment(statement)) {
      if(rejectUnresolvedDirectExport('default',statement)) continue;
      processValue(statement.expression, 'default', statement);
    } else if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        if (!statement.moduleSpecifier || !staticText(statement.moduleSpecifier)) {
          addUnresolved('module export surface', statement, 'The export declaration has no statically named selected-source target.');
          unresolvedModuleEdges++;
          continue;
        }
        if (statement.isTypeOnly) {
          resolvedModuleEdges++;
          continue;
        }
        const exported = resolver.exportedNames(parsed);
        if (exported.unresolved.length) {
          unresolvedModuleEdges++;
          addSelectedResolutionCollection(`module surface from ${staticText(statement.moduleSpecifier)}`, statement, exported.unresolved);
        } else resolvedModuleEdges++;
        for (const publicName of exported.names) {
          if (publicName === 'default') continue;
          const resolution = resolver.resolveExport(parsed, publicName);
          noteModuleResolution(resolution.status);
          if (resolution.status === 'resolved') selectedOperations(resolution.module, resolution.localName, publicName, statement);
          else if (resolution.status === 'unresolved') addSelectedResolution(publicName, statement, resolution.reason);
        }
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        const sourceName = statement.moduleSpecifier && staticText(statement.moduleSpecifier);
        if (!sourceName) {
          addUnresolved(statement.exportClause.name.text, statement, 'A namespace export has no statically named selected-source target.', 'selected-module');
          unresolvedModuleEdges++;
          continue;
        }
        const target = resolver.resolveModule(parsed, sourceName);
        if (!target.module) {
          unresolvedModuleEdges++;
          addSelectedResolution(statement.exportClause.name.text, statement, target.reason ?? 'The selected namespace target could not be resolved.');
          continue;
        }
        const exported = resolver.exportedNames(target.module);
        if (exported.unresolved.length) {
          unresolvedModuleEdges++;
          addSelectedResolutionCollection(statement.exportClause.name.text, statement, exported.unresolved);
        } else resolvedModuleEdges++;
        for (const memberName of exported.names) {
          if (memberName === 'default') continue;
          const resolution = resolver.resolveExport(target.module, memberName);
          noteModuleResolution(resolution.status);
          if (resolution.status === 'resolved') selectedOperations(resolution.module, resolution.localName, `${statement.exportClause.name.text}.${memberName}`, statement);
          else if (resolution.status === 'unresolved') addSelectedResolution(`${statement.exportClause.name.text}.${memberName}`, statement, resolution.reason);
        }
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const publicName = specifier.name.text;
          if (statement.isTypeOnly || specifier.isTypeOnly) {
            continue;
          }
          if (statement.moduleSpecifier) {
            const resolution = resolver.resolveExport(parsed, publicName);
            noteModuleResolution(resolution.status);
            if (resolution.status === 'resolved') selectedOperations(resolution.module, resolution.localName, publicName, specifier);
            else if (resolution.status === 'unresolved') addSelectedResolution(publicName, specifier, resolution.reason);
          } else {
            const localName = (specifier.propertyName ?? specifier.name).text;
            processValue(ts.factory.createIdentifier(localName), publicName, specifier);
          }
        }
      }
    }
  }

  const cjsExportName = (expression: ts.Expression): { matched: boolean; name?: string; dynamic?: boolean } => {
    const parts: Array<string | undefined> = [];
    let base: ts.Expression = expression;
    while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
      if (ts.isPropertyAccessExpression(base)) {
        parts.unshift(base.name.text);
        base = base.expression;
      } else {
        const value = base.argumentExpression && staticText(base.argumentExpression);
        parts.unshift(value);
        base = base.expression;
      }
    }
    if (!ts.isIdentifier(base)) return { matched: false };
    if (base.text === 'exports' && parts.length > 0) {
      return parts.some(part => part === undefined) ? { matched: true, dynamic: true } : { matched: true, name: parts.join('.') };
    }
    if (base.text === 'module' && parts[0] === 'exports') {
      if (parts.length === 1) return { matched: true, name: 'default' };
      return parts.slice(1).some(part => part === undefined) ? { matched: true, dynamic: true } : { matched: true, name: parts.slice(1).join('.') };
    }
    return { matched: false };
  };

  const addCommonJsExport = (target: ts.Expression, value: ts.Expression, referenceNode: ts.Node) => {
    const exported = cjsExportName(target);
    if (!exported.matched) return;
    if (exported.dynamic) {
      processValue(value, 'dynamic CommonJS export', referenceNode);
      addInitializationBoundary('dynamic CommonJS export', referenceNode,
        'A computed CommonJS export name is evaluated during module initialization and cannot be assigned a stable public name.',
        'The dynamic CommonJS export name is evaluated during module initialization; the exported name remains unresolved.',
        'commonjs-dynamic', 'CommonJS export initialization');
      return;
    }
    processValue(value, exported.name ?? 'default', referenceNode);
  };

  const collectCommonJs = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      addCommonJsExport(node.left, node.right, node);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'Object'
      && node.expression.name.text === 'assign' && node.arguments.length >= 2) {
      const target = node.arguments[0];
      const exported = cjsExportName(target);
      const targetsExportsObject = ts.isIdentifier(target) && target.text === 'exports';
      if (exported.matched || targetsExportsObject) {
        if (exported.dynamic) addUnresolved('dynamic CommonJS export', node, 'Object.assign writes through a computed CommonJS export name.', 'commonjs-dynamic');
        else {
          const publicName = exported.name && exported.name !== 'default' ? exported.name : 'default';
          for (const value of node.arguments.slice(1)) processValue(value, publicName, node);
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'Object'
      && node.expression.name.text === 'defineProperty' && node.arguments.length >= 3) {
      const target = node.arguments[0];
      const property = staticText(node.arguments[1]);
      if (property && (ts.isIdentifier(target) && target.text === 'exports' || cjsExportName(target).name === 'default')) {
        const descriptor = unwrapExpression(node.arguments[2]);
        if (ts.isObjectLiteralExpression(descriptor)) {
          const value = descriptor.properties.find(item => (ts.isPropertyAssignment(item) || ts.isMethodDeclaration(item)) && staticPropertyName(item.name) === 'value');
          if (value && ts.isPropertyAssignment(value)) processValue(value.initializer, property, node);
          else addUnresolved(property, node, 'The CommonJS property descriptor does not expose a statically readable operation body.', 'commonjs-dynamic');
        }
      } else if (ts.isIdentifier(target) && target.text === 'exports' || cjsExportName(target).matched) {
        addUnresolved(property ?? 'dynamic CommonJS export', node, 'A computed CommonJS property descriptor cannot be enumerated from this frozen artifact.', 'commonjs-dynamic');
      }
    }
    ts.forEachChild(node, collectCommonJs);
  };
  collectCommonJs(source);

  const prototypeProperty = (expression: ts.Expression): { owner?: string; member?: string; dynamic?: boolean } => {
    const parts: Array<string | undefined> = [];
    let base: ts.Expression = expression;
    while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
      if (ts.isPropertyAccessExpression(base)) {
        parts.unshift(base.name.text);
        base = base.expression;
      } else {
        parts.unshift(base.argumentExpression && staticText(base.argumentExpression));
        base = base.expression;
      }
    }
    if (!ts.isIdentifier(base) || parts[0] !== 'prototype' || !exportedPrototypeLocals.has(base.text)) return {};
    if (parts.length === 1) return { owner: base.text, member: '', dynamic: false };
    if (parts.slice(1).some(part => part === undefined)) return { owner: base.text, dynamic: true };
    return { owner: base.text, member: parts.slice(1).join('.') };
  };

  const collectPrototypeOperations = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = prototypeProperty(node.left);
      if (target.owner) {
        if (target.member === '' && ts.isObjectLiteralExpression(unwrapExpression(node.right))) {
          processValue(unwrapExpression(node.right), target.owner, node, new Set(), target.owner);
          ts.forEachChild(node, collectPrototypeOperations);
          return;
        }
        const label = target.member ? `${target.owner}.${target.member}` : `${target.owner}.[computed prototype member]`;
        if (target.dynamic) {
          processValue(node.right, label, node, new Set(), target.owner);
          addInitializationBoundary(label, node,
            'A computed prototype member name is evaluated during module initialization and cannot be assigned a stable method name.',
            'The computed prototype assignment runs during module initialization; its target name remains unresolved.',
            'prototype-dynamic', `Prototype initialization for ${target.owner}`);
        } else processValue(node.right, label, node, new Set(), target.owner);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'Object' && node.expression.name.text === 'assign' && node.arguments.length >= 2) {
      const target = prototypeProperty(node.arguments[0]);
      if (target.owner && target.member === '') {
        for (const value of node.arguments.slice(1)) {
          const expression = unwrapExpression(value);
          if (ts.isObjectLiteralExpression(expression)) processValue(expression, target.owner, node, new Set(), target.owner);
          else addUnresolved(`${target.owner}.[prototype spread]`, node,
            'Object.assign writes prototype operations from a value that is not a selected static object literal.', 'prototype');
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'Object' && node.expression.name.text === 'defineProperty' && node.arguments.length >= 3) {
      const target = prototypeProperty(node.arguments[0]);
      if (target.owner && target.member === '') {
        const memberName = staticText(node.arguments[1]);
        const descriptor = unwrapExpression(node.arguments[2]);
        if (ts.isObjectLiteralExpression(descriptor)) {
          const valueProperty = descriptor.properties.find(property =>
            (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) && staticPropertyName(property.name) === 'value');
          if (valueProperty && ts.isPropertyAssignment(valueProperty) && memberName) processValue(valueProperty.initializer, `${target.owner}.${memberName}`, node, new Set(), target.owner);
          else if (valueProperty && ts.isPropertyAssignment(valueProperty)) {
            const label = `${target.owner}.[computed prototype member]`;
            processValue(valueProperty.initializer, label, node, new Set(), target.owner);
            addInitializationBoundary(label, node,
              'A computed prototype property name is evaluated during module initialization and cannot be assigned a stable method name.',
              'The computed prototype property name remains unresolved.', 'prototype-dynamic', `Prototype initialization for ${target.owner}`);
          } else addUnresolved(`${target.owner}.${memberName ?? '[computed member]'}`, node,
            'The prototype property descriptor does not expose a statically readable callable value.', 'prototype');
        } else addUnresolved(`${target.owner}.[computed prototype member]`, node,
          'A computed prototype property cannot be assigned a stable operation name.', 'prototype');
      }
    }
    ts.forEachChild(node, collectPrototypeOperations);
  };
  collectPrototypeOperations(source);

  // Include one-hop, file-local function bodies called by an exported operation.
  // This exposes important implementation operations while keeping nested and
  // dynamically dispatched functions out of the inventory.
  const internalFunctions = new Map<string, FunctionEntry>();
  for (const [name, declaration] of declarations) {
    if (ts.isFunctionDeclaration(declaration)) {
      const entry = functionByNode.get(declaration);
      if (entry) internalFunctions.set(name, entry);
    } else if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapExpression(declaration.initializer);
      if (isFunctionLike(initializer)) {
        const entry = functionByNode.get(initializer);
        if (entry) internalFunctions.set(name, entry);
      }
    }
  }
  const exportedNodes = new Set([...exportedHandlers].map(entry => entry.node));
  // `sink` adds discovered callbacks to exportedHandlers. JavaScript Set
  // iteration visits those additions, so their bodies can contribute their
  // own explicitly registered callbacks without descending into dormant
  // nested function declarations.
  for (const caller of exportedHandlers) {
    const body = caller.node.body;
    if (!body) continue;
    const visitCalls = (node: ts.Node) => {
      if (node !== body && isFunctionLike(node)) {
        let callbackNode: ts.Node = node;
        while (callbackNode.parent && (ts.isParenthesizedExpression(callbackNode.parent) || ts.isAsExpression(callbackNode.parent)
          || ts.isTypeAssertionExpression(callbackNode.parent))) callbackNode = callbackNode.parent;
        const parent = callbackNode.parent;
        const isRegisteredArgument = parent && ((ts.isCallExpression(parent) && parent.arguments.includes(callbackNode as ts.Expression))
          || (ts.isNewExpression(parent) && !!parent.arguments?.includes(callbackNode as ts.Expression)));
        if (parent && isRegisteredArgument) {
          const callback = functionByNode.get(node);
          if (callback && !exportedNodes.has(callback.node)) {
            const registration = ts.isCallExpression(parent) ? calleeName(parent) ?? 'call'
              : ts.isIdentifier(parent.expression) ? parent.expression.text : 'constructor';
            const label = `Callback operation ${callback.name} registered within ${caller.name}`;
            sink(label, callback, parent, keyForNode(parent, `${registration}|${callback.name}`, 'callback'));
            exportedNodes.add(callback.node);
          }
        } else if (parent && ts.isCallExpression(parent) && parent.expression === callbackNode) {
          const immediatelyInvoked = functionByNode.get(node);
          if (immediatelyInvoked && !exportedNodes.has(immediatelyInvoked.node)) {
            sink(`Internal operation ${immediatelyInvoked.name} called by ${caller.name}`, immediatelyInvoked, parent,
              keyForNode(parent, `${caller.name}|${immediatelyInvoked.name}`, 'iife'));
            exportedNodes.add(immediatelyInvoked.node);
          }
        }
        // Function bodies execute separately. Only an explicit callback
        // registration or immediately invoked function is mapped above; a
        // dormant nested declaration cannot make its callees reachable.
        return;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = internalFunctions.get(node.expression.text);
        if (callee && !exportedNodes.has(callee.node)) {
          const label = `Internal operation ${callee.name} called by ${caller.name}`;
          sink(label, callee, node, keyForNode(node, `${caller.name}|${callee.name}`, 'reachable'));
          exportedNodes.add(callee.node);
        }
      }
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(body);
  }

  return { resolvedModuleEdges, unresolvedModuleEdges, expansionTruncated };
}

function staticText(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function artifactExecutionClass(parsed: ParsedArtifact): { kind: 'declaration' | 'non_executable' | 'executable'; reason: string } {
  const source = parsed.source;
  if (source.isDeclarationFile || parsed.artifact.fileName.toLowerCase().endsWith('.d.ts')) {
    return { kind: 'declaration', reason: 'Declaration-file signatures are retained in the full source sweep and are not executable operation bodies.' };
  }
  const isInertClass = (node: ts.ClassDeclaration) => {
    if (node.heritageClauses?.length || (ts.canHaveDecorators(node) && !!ts.getDecorators(node)?.length)) return false;
    return node.members.every(member => {
        if (ts.canHaveDecorators(member) && !!ts.getDecorators(member)?.length) return false;
        const memberName = 'name' in member ? (member as ts.NamedDeclaration).name : undefined;
        if (memberName && ts.isComputedPropertyName(memberName) && !staticText(memberName.expression)) return false;
      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) return !member.body;
      if (ts.isPropertyDeclaration(member)) return !member.initializer || isStaticDataExpression(member.initializer);
        if (ts.isIndexSignatureDeclaration(member)) return true;
        return false;
    });
  };
  const typeOnlyStatement = (statement: ts.Statement): boolean => {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return true;
    if (ts.isImportDeclaration(statement)) return !!statement.importClause?.isTypeOnly;
    if (ts.isExportDeclaration(statement)) return statement.isTypeOnly || (!!statement.exportClause && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every(element => element.isTypeOnly));
    if (ts.isFunctionDeclaration(statement)) return !statement.body || hasModifier(statement, ts.SyntaxKind.DeclareKeyword);
    if (ts.isClassDeclaration(statement)) return hasModifier(statement, ts.SyntaxKind.DeclareKeyword) || isInertClass(statement);
    if (ts.isVariableStatement(statement)) return hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
      || statement.declarationList.declarations.every(declaration => !declaration.initializer);
    return false;
  };
  const allDeclarations = source.statements.every(typeOnlyStatement);
  if (allDeclarations) return { kind: 'declaration', reason: 'Only type declarations and bodyless contracts are present; all text remains in the full source sweep.' };

  let executable = false;
  for (const statement of source.statements) {
    if (typeOnlyStatement(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.some(declaration => declaration.initializer && !isStaticDataExpression(declaration.initializer))) executable = true;
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (!isStaticDataExpression(statement.expression)) executable = true;
      continue;
    }
    if (ts.isClassDeclaration(statement) && isInertClass(statement)) continue;
    // Enums, namespaces, side-effect imports, expression statements and all
    // unrecognized top-level syntax can execute and remain in executable scope.
    executable = true;
  }
  if (executable) return { kind: 'executable', reason: '' };
  return { kind: 'non_executable', reason: 'The parsed source contains only statically literal data and inert declarations; it remains in the full source sweep.' };
}

function calleeName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  if (ts.isElementAccessExpression(call.expression) && call.expression.argumentExpression && ts.isStringLiteral(call.expression.argumentExpression)) return call.expression.argumentExpression.text;
  return undefined;
}

type RouteHandlerResolution = { handler?: FunctionEntry; runtimeBoundaryReason?: string };

function selectedLocalWrapperCallback(
  wrapperCall: ts.CallExpression,
  parsed: ParsedArtifact,
  context: CallbackResolverContext,
): RouteHandlerResolution {
  if (!ts.isIdentifier(wrapperCall.expression) || wrapperCall.arguments.length !== 1) return {};
  const wrapperSymbol = context.checker.getSymbolAtLocation(wrapperCall.expression);
  if (!wrapperSymbol || isImportSymbol(wrapperSymbol)) return {};
  const wrapper = uniqueLocalFunction(wrapperSymbol, context);
  if (!wrapper || wrapper.parameters.length !== 1) return {};
  const parameter = wrapper.parameters[0]!;
  if (!ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken) return {};
  const parameterSymbol = context.checker.getSymbolAtLocation(parameter.name);
  if (!parameterSymbol || context.mutatedSymbols.has(parameterSymbol)) return {};
  const returned = soleDirectReturnExpression(wrapper);
  const adapter = returned && unwrapExpression(returned);
  if (!adapter || !isFunctionLike(adapter) || !adapter.body) return {};
  let directCalls = 0;
  const visit = (node: ts.Node) => {
    if (node !== adapter && isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && context.checker.getSymbolAtLocation(node.expression) === parameterSymbol) directCalls++;
    ts.forEachChild(node, visit);
  };
  if (ts.isBlock(adapter.body)) visit(adapter.body);
  else visit(adapter.body);
  if (directCalls === 0) return {};

  const callback = unwrapExpression(wrapperCall.arguments[0]!);
  if (!isFunctionLike(callback) || !callback.body) return {};
  const handler = context.functionsByNode.get(callback);
  if (!handler) return {};
  return { handler,
    runtimeBoundaryReason: 'The route callback is passed through a selected local wrapper; wrapper scheduling and error propagation remain explicit runtime boundaries.' };
}

function directHandler(call: ts.CallExpression, parsed: ParsedArtifact, context: CallbackResolverContext | undefined): RouteHandlerResolution {
  const last = call.arguments.at(-1);
  if (!last || !context) return {};
  const expression = unwrapExpression(last);
  if (isFunctionLike(expression)) {
    const handler = context.functionsByNode.get(expression);
    return handler ? { handler } : {};
  }
  if (ts.isIdentifier(expression)) {
    const resolved = resolveCallbackExpression(expression, parsed, context);
    return resolved.status === 'resolved' && resolved.handlers.length === 1
      ? { handler: resolved.handlers[0], ...(resolved.runtimeBoundaryReason ? { runtimeBoundaryReason: resolved.runtimeBoundaryReason } : {}) }
      : {};
  }
  return ts.isCallExpression(expression) ? selectedLocalWrapperCallback(expression, parsed, context) : {};
}

function safeSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, '[credential redacted]')
    .replace(/\b(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret)\s*([:=])\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, 500);
}

function freshAssessments(): FeatureAnalysisAssessment[] {
  return DOMAINS.map(domain => ({ domain, status: 'unverified', outcome: 'unverified', summary: 'No domain assessment was returned for this feature.', evidence: [] }));
}

function nodeEvidence(node: ts.Node, artifact: Artifact, source: ts.SourceFile): AnalysisEvidenceReference {
  return refFor(artifact, source, node);
}

function addPath(feature: ReviewAnalysisFeature, kind: AnalysisPathKind, label: string, refs: AnalysisEvidenceReference[]) {
  if (feature.paths.length >= MAX_PATHS_PER_FEATURE) {
    const reason = 'Additional code branches were omitted because the local path limit was reached; remaining coverage is unverified.';
    if (!feature.unresolved.some(item => item.reason === reason)) feature.unresolved.push({ reason, evidence: refs.slice(0, 1) });
    return;
  }
  const id = `path-${digest(`${feature.id}|${kind}|${label}|${refs.map(ref => `${ref.artifactId}:${ref.lineNumber}`).join(',')}`)}`;
  if (!feature.paths.some(path => path.id === id)) feature.paths.push({ id, kind, label: safeSummary(label), status: 'inferred', evidence: refs.slice(0, 3) });
}

function branchPaths(feature: ReviewAnalysisFeature, handler: FunctionEntry, functions: FunctionEntry[]) {
  const body = handler.node.body;
  if (!body) return;
  addPath(feature, 'normal', `Execution enters ${handler.name}.`, [nodeEvidence(handler.node, handler.artifact, handler.source)]);
  const localNames = new Set(functions.map(item => item.name));
  let unresolvedCount = 0;
  const addUnresolved = (reason: string, node: ts.Node) => {
    if (feature.unresolved.length >= MAX_UNRESOLVED_PER_FEATURE) return;
    feature.unresolved.push({ reason, evidence: [nodeEvidence(node, handler.artifact, handler.source)] });
    unresolvedCount++;
  };
  const visit = (node: ts.Node) => {
    if (node !== body && isFunctionLike(node)) return;
    if (ts.isIfStatement(node)) {
      const lineRef = nodeEvidence(node, handler.artifact, handler.source);
      addPath(feature, 'alternate', 'Condition true branch.', [lineRef]);
      addPath(feature, 'alternate', node.elseStatement ? 'Condition false branch.' : 'Condition false path is implicit; following execution is unresolved.', [lineRef]);
      if (!node.elseStatement) addUnresolved('The branch is conditional and its false-path outcome is not represented by this bounded local map.', node);
    } else if (ts.isConditionalExpression(node)) {
      const ref = nodeEvidence(node, handler.artifact, handler.source);
      addPath(feature, 'alternate', 'Conditional expression true result.', [ref]);
      addPath(feature, 'alternate', 'Conditional expression false result.', [ref]);
    } else if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        addPath(feature, 'alternate', ts.isCaseClause(clause) ? 'A switch case selects an alternate outcome.' : 'Switch default branch.', [nodeEvidence(clause, handler.artifact, handler.source)]);
      }
    } else if (ts.isTryStatement(node)) {
      if (node.catchClause) {
        addPath(feature, 'failure', 'An exception enters the catch branch.', [nodeEvidence(node.tryBlock, handler.artifact, handler.source)]);
        addPath(feature, 'recovery', 'The catch branch handles an exception; recovery effect is not proven by syntax.', [nodeEvidence(node.catchClause, handler.artifact, handler.source)]);
      }
      if (node.finallyBlock) addPath(feature, 'recovery', 'A finally branch runs during exit; state restoration is not proven by syntax.', [nodeEvidence(node.finallyBlock, handler.artifact, handler.source)]);
    } else if (ts.isThrowStatement(node)) {
      addPath(feature, 'failure', 'Execution throws an exception.', [nodeEvidence(node, handler.artifact, handler.source)]);
    } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      addPath(feature, 'alternate', 'Loop body may repeat or exit; iteration bounds are not established.', [nodeEvidence(node, handler.artifact, handler.source)]);
      addUnresolved('Loop termination and iteration bounds are not established by this bounded map.', node);
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (!name || name === 'eval' || name === 'Function' || name === 'require') {
        addUnresolved('Dynamic dispatch, reflection, or a dynamic code boundary is unresolved.', node);
      } else {
        addUnresolved(`${localNames.has(name) ? 'Inter-function' : 'External'} call to ${name} is not expanded by this bounded map.`, node);
      }
    } else if (ts.isAwaitExpression(node)) {
      addUnresolved('Asynchronous completion and rejection paths are not enumerated by this bounded map.', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (!feature.paths.some(path => path.kind === 'failure')) addPath(feature, 'unresolved', 'No explicit failure path was identified; external and asynchronous failures may remain.', [nodeEvidence(handler.node, handler.artifact, handler.source)]);
  if (unresolvedCount === 0) addUnresolved('The map covers only syntax inside this handler; imported, framework, deployment, and runtime behavior are not verified.', handler.node);
}

/**
 * Extracts an intentionally bounded syntax-backed map from frozen JavaScript
 * and TypeScript artifacts, plus explicitly marked plain-text units for other
 * readable source languages. Unsupported text never acquires parser-backed
 * executable-path or runtime proof.
 */
export function deriveReviewAnalysisMap(
  evidence: EvidenceArtifact[],
  options: { plainTextArtifactIds?: ReadonlySet<string> } = {},
): ReviewAnalysisMap {
  const supported: ParsedArtifact[] = [];
  const unsupportedArtifacts: ReviewAnalysisMap['coverage']['unsupportedArtifacts'] = [];
  const plainTextLogicArtifacts: Array<{ item: EvidenceArtifact; segments: ReturnType<typeof segmentPlainTextLogic> }> = [];
  const sourceArtifacts = evidence.filter(item => hasPlainTextSourceIntent(item.artifact) || SUPPORTED_EXTENSIONS.has(extension(item.artifact.fileName)) || CONFIG_EXTENSIONS.has(extension(item.artifact.fileName)));

  for (const item of sourceArtifacts) {
    const ext = extension(item.artifact.fileName);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      const configuration = CONFIG_EXTENSIONS.has(ext);
      const availableSourceText = hasPlainTextSourceIntent(item.artifact) && typeof item.content === 'string'
        && item.state !== 'inaccessible' && item.state !== 'deleted' && item.state !== 'stale';
      const readableSourceText = availableSourceText && isReadablePlainText(item.content!);
      const segments = !configuration && readableSourceText ? segmentPlainTextLogic(item.content!) : [];
      if (readableSourceText && !configuration) plainTextLogicArtifacts.push({ item, segments });
      unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath,
        ...(configuration ? { parserExclusion: 'configuration' as const }
          : readableSourceText ? { parserExclusion: 'plain_text_logic' as const } : {}),
        reason: configuration
          ? 'Configuration or markup is outside the executable JavaScript/TypeScript control-flow parser.'
          : segments.length
            ? 'Unsupported source language is retained for bounded plain-text logic assessment; parser-backed paths remain unverified.'
            : readableSourceText
              ? 'Empty unsupported source text is retained as plain-text-only input; no assessment unit or executable-path proof is created.'
              : availableSourceText
                ? 'Frozen source text contains binary control characters and is unavailable for plain-text logic assessment.'
                : 'Language or file format is not supported by the bounded JavaScript/TypeScript control-flow parser, or frozen text is unavailable.' });
      continue;
    }
    if (typeof item.content !== 'string' || item.state === 'inaccessible' || item.state === 'deleted' || item.state === 'stale') {
      unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath, reason: 'Frozen source content is unavailable for parsing.' });
      continue;
    }
    const source = ts.createSourceFile(item.artifact.filePath, item.content, ts.ScriptTarget.Latest, true, scriptKind(ext));
    const syntaxErrors = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length;
    if (syntaxErrors > 0) {
      unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath, reason: `Source has ${syntaxErrors} parser diagnostic${syntaxErrors === 1 ? '' : 's'}; feature paths are unverified.` });
      continue;
    }
    if (options.plainTextArtifactIds?.has(item.artifact.id)) {
      if (!isReadablePlainText(item.content)) {
        unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath,
          reason: 'Parsed source contains unreadable control bytes and cannot enter bounded plain-text logic assessment.' });
        continue;
      }
      const segments = segmentPlainTextLogic(item.content);
      plainTextLogicArtifacts.push({ item, segments });
      if (segments.length) {
        unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath,
          parserExclusion: 'plain_text_logic',
          reason: 'Successfully parsed source was selected for bounded plain-text logic assessment; syntax, dependency, branch and runtime coverage remain unverified.' });
      } else {
        unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath,
          parserExclusion: 'plain_text_logic',
          reason: 'Successfully parsed source is empty after line segmentation; no assessment unit or executable-path proof is created.' });
      }
      continue;
    }
    supported.push({ artifact: item.artifact, source });
  }

  const unsupportedArtifactCount = unsupportedArtifacts.length;
  const resolver = new SelectedModuleResolver(supported);
  const parsedBySource = new Map(supported.map(parsed => [parsed.source, parsed]));
  const classifications = supported.map(parsed => ({ parsed, ...artifactExecutionClass(parsed) }));
  const declarationClassifications = classifications.filter(item => item.kind === 'declaration');
  const nonExecutableClassifications = classifications.filter(item => item.kind === 'non_executable');
  const executableArtifactCount = classifications.filter(item => item.kind === 'executable').length;
  const coverageArtifactLimit = 1_000;
  const functions = collectFunctions(supported);
  const functionByNode = new Map(functions.map(item => [item.node, item]));
  const callbackContext = createCallbackResolverContext(supported, resolver, parsedBySource, functions);
  const drafts: FeatureDraft[] = [];
  const seenDraftKeys = new Set<string>();
  let omittedEntryPoints = 0;
  let omittedPlainTextLogicUnits = 0;
  const addDraft = (label: string, entry: FunctionEntry | undefined, refs: AnalysisEvidenceReference[], key: string,
    unresolvedReason?: string, initializationLabel?: string,
    analysis?: { analysisKind: 'plain_text_logic'; sourceRange: PlainTextLogicSourceRange },
    callback?: Pick<FeatureDraft, 'handlers' | 'externalCallbackBoundaryReason' | 'callbackRuntimeBoundaryReason'>) => {
    if (!refs.length) return;
    if (seenDraftKeys.has(key)) return;
    seenDraftKeys.add(key);
    if (drafts.length >= MAX_FEATURE_INVENTORY) {
      omittedEntryPoints++;
      if (analysis?.analysisKind === 'plain_text_logic') omittedPlainTextLogicUnits++;
      return;
    }
    drafts.push({ label: safeSummary(label), handler: entry, refs: refs.slice(0, 4), key, unresolvedReason, initializationLabel, ...analysis, ...callback });
  };

  for (const parsed of supported) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression.getText(parsed.source) : '';
        if (name && HTTP_METHODS.has(name.toLowerCase()) && /(?:^|\.)(?:app|router|server)$/i.test(receiver)) {
          const staticRoute = staticText(node.arguments[0]);
          const routeLabel = `${name.toUpperCase()} ${staticRoute ?? '[dynamic route]'}`;
          const routeHandler = directHandler(node, parsed, callbackContext);
          const handler = routeHandler.handler;
          const refs = [refFor(parsed.artifact, parsed.source, node), ...(handler ? [refFor(handler.artifact, handler.source, handler.node)] : [])];
          const routeKey = `${parsed.artifact.id}|route|${node.getStart(parsed.source, false)}-${node.getEnd()}|${routeLabel}`;
          addDraft(`Route ${routeLabel}`, handler, refs,
            routeKey, undefined, undefined, undefined,
            handler && routeHandler.runtimeBoundaryReason
              ? { handlers: [handler], callbackRuntimeBoundaryReason: routeHandler.runtimeBoundaryReason } : undefined);
          const routeDraft = drafts.find(item => item.key === routeKey);
          if (routeDraft && node.arguments.length > 2) routeDraft.middleware = true;
          if (!staticRoute) {
            const current = drafts.find(item => item.key === routeKey);
            if (current) current.refs.push(refFor(parsed.artifact, parsed.source, node));
          }
        }
      } else if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name) && /^on[A-Z]/.test(node.name.text)) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !isFunctionLike(parent)) parent = parent.parent;
        const owner = (parent ? functionByNode.get(parent)?.name : undefined) ?? 'component';
        const expression = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
        const resolution = resolveJsxCallback(expression, parsed, callbackContext, functionByNode);
        const handlers = resolution.status === 'unresolved' || resolution.status === 'empty' ? [] : resolution.handlers;
        const entry = handlers[0];
        const refs = [refFor(parsed.artifact, parsed.source, node), ...handlers.map(handler => refFor(handler.artifact, handler.source, handler.node))];
        const unresolvedReason = resolution.status === 'unresolved' ? resolution.reason
          : resolution.status === 'empty' ? 'The JSX callback expression resolves to no callback target.' : undefined;
        const callbackRuntimeBoundaryReason = 'runtimeBoundaryReason' in resolution ? resolution.runtimeBoundaryReason : undefined;
        addDraft(`UI ${node.name.text} flow in ${owner}`, entry, refs,
          `${parsed.artifact.id}|ui|${node.getStart(parsed.source, false)}-${node.getEnd()}|${node.name.text}`,
          unresolvedReason,
          undefined,
          undefined,
          {
            ...(resolution.status === 'external_boundary' ? { externalCallbackBoundaryReason: resolution.reason } : {}),
            ...(callbackRuntimeBoundaryReason ? { callbackRuntimeBoundaryReason } : {}),
            ...(handlers.length ? { handlers } : {}),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.source);
  }

  let resolvedModuleEdgeCount = 0;
  let unresolvedModuleEdgeCount = 0;
  let exportExpansionTruncatedCount = 0;
  for (const parsed of supported) {
    if (resolver.isDeclarationFile(parsed)) continue;
    const edges = collectExportedOperations(parsed, functions, resolver, parsedBySource, functions, (label, entry, referenceNode, key, unresolvedReason, initializationLabel) => {
      const referenceSource = parsedBySource.get(referenceNode.getSourceFile()) ?? parsed;
      const refs = [refFor(referenceSource.artifact, referenceSource.source, referenceNode)];
      if (entry && (entry.artifact.id !== referenceSource.artifact.id || sourceLine(entry.source, entry.node) !== sourceLine(referenceSource.source, referenceNode))) {
        refs.push(refFor(entry.artifact, entry.source, entry.node));
      }
      addDraft(label, entry, refs, key, unresolvedReason, initializationLabel);
    });
    resolvedModuleEdgeCount += edges.resolvedModuleEdges;
    unresolvedModuleEdgeCount += edges.unresolvedModuleEdges;
    exportExpansionTruncatedCount += edges.expansionTruncated;
  }

  const plainTextLogicUnitCount = plainTextLogicArtifacts.reduce((sum, artifact) => sum + artifact.segments.length, 0);
  for (const { item, segments } of plainTextLogicArtifacts) {
    for (const segment of segments) {
      const { lineStart, lineEnd } = segment.sourceRange;
      const sourceVersion = item.artifact.contentHash || null;
      const refs: AnalysisEvidenceReference[] = [{ artifactId: item.artifact.id, filePath: item.artifact.filePath, lineNumber: lineStart, sourceVersion }];
      if (lineEnd !== lineStart) refs.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath, lineNumber: lineEnd, sourceVersion });
      const key = `${item.artifact.id}|plain-text-logic|${sourceVersion ?? ''}|${lineStart}-${lineEnd}`;
      addDraft(`Plain-text logic review: ${item.artifact.filePath} lines ${lineStart}-${lineEnd}`, undefined, refs, key,
        'No parser-backed entry point, branch, dependency, or runtime path is inferred for this unsupported language segment.', undefined,
        { analysisKind: 'plain_text_logic', sourceRange: segment.sourceRange });
    }
  }

  const truncatedFeatures = omittedEntryPoints;

  const features: ReviewAnalysisFeature[] = drafts.map(draft => {
    const id = `feature-${digest(draft.key)}`;
    const handlers = uniqueHandlers(draft.handlers ?? (draft.handler ? [draft.handler] : []));
    const externalCallbackBoundary = !!draft.externalCallbackBoundaryReason;
    const feature: ReviewAnalysisFeature = { id, label: draft.label, provisional: true,
      ...(draft.analysisKind === 'plain_text_logic' ? { analysisKind: draft.analysisKind, sourceRange: draft.sourceRange } : {}),
      ...(draft.analysisKind === 'plain_text_logic' ? {} : { entryPointStatus: draft.initializationLabel ? 'resolved' as const
        : externalCallbackBoundary ? 'external_boundary' as const : handlers.length ? 'resolved' as const : 'unresolved' as const }),
      entryPoints: draft.refs, paths: [], assessments: freshAssessments(), unresolved: [] };
    if (draft.analysisKind === 'plain_text_logic') {
      const evidence = draft.refs.slice(0, 2);
      feature.paths.push({ id: `path-${digest(`${id}|plain-text-logic-unresolved`)}`, kind: 'unresolved',
        label: 'Plain-text logic only; parser and runtime paths remain unresolved.', status: 'unverified', evidence });
      feature.unresolved.push({ reason: draft.unresolvedReason ?? 'Parser-backed control flow and runtime behavior are not verified for this plain-text segment.', evidence });
      return feature;
    }
    if (draft.middleware) feature.unresolved.push({ reason: 'Middleware order, early exits and guards before this handler are not expanded by this local map.', evidence: draft.refs.slice(0, 1) });
    if (draft.callbackRuntimeBoundaryReason) {
      const evidence = draft.refs.slice(0, 1);
      addPath(feature, 'unresolved', draft.callbackRuntimeBoundaryReason, evidence);
      feature.unresolved.push({ reason: draft.callbackRuntimeBoundaryReason, evidence });
    }
    if (externalCallbackBoundary) {
      const evidence = draft.refs.slice(0, 1);
      addPath(feature, 'unresolved', 'The callback is supplied by a caller; its implementation is outside the selected frozen source set.', evidence);
      feature.unresolved.push({ reason: draft.externalCallbackBoundaryReason!, evidence });
    }
    if (handlers.length) {
      for (const handler of handlers) branchPaths(feature, handler, functions);
    } else if (draft.initializationLabel) {
      addPath(feature, 'normal', draft.initializationLabel, draft.refs.slice(0, 1));
      feature.unresolved.push({ reason: draft.unresolvedReason ?? 'The module initialization is identified, but its returned runtime surface remains unresolved.', evidence: draft.refs.slice(0, 1) });
    }
    else if (externalCallbackBoundary) {
      // The local JSX binding can be assessed, while the caller-owned body remains an explicit boundary.
    }
    else {
      addPath(feature, 'normal', 'The entry point is present, but its handler body was not resolved.', draft.refs.slice(0, 1));
      feature.unresolved.push({ reason: draft.unresolvedReason ?? 'The handler body is unresolved, so normal, alternate, failure, and recovery outcomes remain unverified.', evidence: draft.refs.slice(0, 1) });
    }
    return feature;
  });

  const unresolvedEdgeCount = features.reduce((sum, feature) => sum + feature.unresolved.length, 0);
  const externalCallbackBoundaryCount = features.filter(feature => feature.entryPointStatus === 'external_boundary').length;
  const limitations = [
    'This is bounded syntax extraction for JavaScript and TypeScript artifacts plus explicitly marked plain-text logic reviews; it is not a complete control-flow or security proof.',
    'Features inferred from route names, exports, and UI event handlers are provisional until confirmed against requirements or design evidence.',
    'Inter-function, framework, dynamic dispatch, unselected dependencies, asynchronous, background-job, deployment, and runtime paths may be incomplete.',
  ];
  if (declarationClassifications.length) limitations.push(`${declarationClassifications.length} declaration-only artifact${declarationClassifications.length === 1 ? ' was' : 's were'} retained for full source sweeps; signatures do not create executable operations or absence-resolution proof.`);
  if (nonExecutableClassifications.length) limitations.push(`${nonExecutableClassifications.length} statically literal or inert artifact${nonExecutableClassifications.length === 1 ? ' was' : 's were'} retained for full source sweeps; these inputs do not create executable operations or absence-resolution proof.`);
  if (unsupportedArtifactCount > 0) limitations.push(`${unsupportedArtifactCount} source or configuration artifact${unsupportedArtifactCount === 1 ? ' was' : 's were'} outside the supported parser; parser-backed coverage remains unverified.`);
  if (plainTextLogicArtifacts.length > 0) limitations.push(`${plainTextLogicArtifacts.length} unsupported source artifact${plainTextLogicArtifacts.length === 1 ? ' uses' : 's use'} plain-text-only handling across ${plainTextLogicUnitCount} bounded assessment unit${plainTextLogicUnitCount === 1 ? '' : 's'}; parser, executable-path and runtime coverage remain unverified.`);
  if (externalCallbackBoundaryCount > 0) limitations.push(`${externalCallbackBoundaryCount} JSX callback binding${externalCallbackBoundaryCount === 1 ? ' is' : 's are'} supplied by an enclosing caller; local binding syntax may be assessed, but callback behavior remains outside the selected source scope and cannot support absence-based resolution.`);
  if (unsupportedArtifacts.length > 100) limitations.push(`${unsupportedArtifacts.length - 100} additional unsupported artifacts were omitted from the map listing; all remain unverified.`);
  if (resolvedModuleEdgeCount || unresolvedModuleEdgeCount) limitations.push(`Selected-source module resolution mapped ${resolvedModuleEdgeCount} named edge${resolvedModuleEdgeCount === 1 ? '' : 's'} and left ${unresolvedModuleEdgeCount} edge${unresolvedModuleEdgeCount === 1 ? '' : 's'} unresolved; only frozen selected sources were considered.`);
  const selectedModuleGraphWork = resolver.graphWork;
  if (selectedModuleGraphWork.truncated) limitations.push(`Selected-source module resolution stopped at its explicit ${selectedModuleGraphWork.limit}-step work or depth bound; remaining graph scope stays unresolved.`);
  if (exportExpansionTruncatedCount) limitations.push(`${exportExpansionTruncatedCount} artifact export expansion${exportExpansionTruncatedCount === 1 ? ' reached' : 's reached'} its explicit ${MAX_EXPORT_EXPANSION_WORK}-step or ${MAX_EXPORT_EXPANSION_DEPTH}-level safety bound; omitted operation scope remains unresolved.`);
  if (truncatedFeatures > 0) limitations.push(`${truncatedFeatures} additional feature or plain-text assessment unit${truncatedFeatures === 1 ? ' was' : 's were'} omitted after the deterministic ${MAX_FEATURE_INVENTORY}-feature inventory safety limit; omitted scope remains unverified.`);
  if (omittedPlainTextLogicUnits > 0) limitations.push(`${omittedPlainTextLogicUnits} plain-text logic unit${omittedPlainTextLogicUnits === 1 ? ' was' : 's were'} omitted at the feature inventory limit; omitted text scope remains unverified.`);
  if (!features.length && executableArtifactCount > 0) limitations.push('No statically recognizable route, exported operation, or selected UI event entry point was found in executable artifacts. Feature scope remains unresolved.');

  return {
    schemaVersion: 1,
    status: 'unverified',
    coverage: {
      sourceArtifacts: sourceArtifacts.length,
      parsedArtifacts: supported.length,
      executableArtifacts: executableArtifactCount,
      declarationArtifacts: declarationClassifications.slice(0, coverageArtifactLimit).map(item => ({ artifactId: item.parsed.artifact.id, filePath: item.parsed.artifact.filePath, reason: item.reason })),
      declarationArtifactCount: declarationClassifications.length,
      nonExecutableArtifacts: nonExecutableClassifications.slice(0, coverageArtifactLimit).map(item => ({ artifactId: item.parsed.artifact.id, filePath: item.parsed.artifact.filePath, reason: item.reason })),
      nonExecutableArtifactCount: nonExecutableClassifications.length,
      unsupportedArtifactCount: unsupportedArtifacts.length,
      unsupportedArtifactsTruncated: unsupportedArtifacts.length > 100,
      artifactClassificationTruncated: declarationClassifications.length + nonExecutableClassifications.length > coverageArtifactLimit,
      resolvedModuleEdgeCount,
      unresolvedModuleEdgeCount,
      selectedModuleGraphWorkCount: selectedModuleGraphWork.count,
      selectedModuleGraphWorkLimit: selectedModuleGraphWork.limit,
      selectedModuleGraphTruncated: selectedModuleGraphWork.truncated,
      exportExpansionTruncatedCount,
      unsupportedArtifacts: unsupportedArtifacts.slice(0, 100),
      unsupportedExecutableArtifacts: unsupportedArtifacts.filter(item => item.parserExclusion !== 'configuration').length,
      plainTextLogicArtifactCount: plainTextLogicArtifacts.length,
      plainTextLogicUnitCount,
      omittedPlainTextLogicUnitCount: omittedPlainTextLogicUnits,
      externalCallbackBoundaryCount,
      unresolvedEdgeCount,
      featureInventoryLimit: MAX_FEATURE_INVENTORY,
      omittedEntryPointCount: truncatedFeatures,
      featureInventoryTruncated: truncatedFeatures > 0,
      exhaustive: false,
      limitations,
    },
    features,
  };
}

/** Split a full feature inventory into deterministic provider-sized request batches. */
export function batchReviewAnalysisFeatures(features: ReviewAnalysisFeature[], maxFeatures = MAX_FEATURES_PER_BATCH): ReviewAnalysisFeature[][] {
  if (!Number.isInteger(maxFeatures) || maxFeatures < 1) throw new RangeError('maxFeatures must be a positive integer.');
  const batches: ReviewAnalysisFeature[][] = [];
  for (let offset = 0; offset < features.length; offset += maxFeatures) batches.push(features.slice(offset, offset + maxFeatures));
  return batches;
}

function isDomain(value: unknown): value is ReviewDomain {
  return DOMAINS.includes(value as ReviewDomain);
}

function evidenceKey(ref: AnalysisEvidenceReference): string {
  return `${ref.artifactId}:${ref.filePath}:${ref.lineNumber}:${ref.sourceVersion ?? ''}`;
}

/** Validate provider analysis against the AST map before storing any claim. */
export function applyFeatureDomainAssessments(map: ReviewAnalysisMap, value: unknown): ReviewAnalysisMap {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rows = Array.isArray(raw.featureAssessments) ? raw.featureAssessments : [];
  const features = map.features.map(feature => {
    if (feature.entryPointStatus === 'unresolved') return feature;
    const matchingRows = rows.filter(candidate => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).featureId === feature.id);
    const row = matchingRows.length === 1 ? matchingRows[0] as Record<string, unknown> : undefined;
    const assessments = Array.isArray(row?.assessments) ? row.assessments : [];
    const knownRefs = new Map([...feature.entryPoints, ...feature.paths.flatMap(path => path.evidence)].map(ref => [evidenceKey(ref), ref]));
    const normalized = feature.assessments.map((current): FeatureAnalysisAssessment => {
      const matchingAssessments = assessments.filter(candidate => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).domain === current.domain);
      const item = matchingAssessments.length === 1 ? matchingAssessments[0] as Record<string, unknown> : undefined;
      if (!item) return current;
      const outcome = item.outcome;
      if (!['potential_gap', 'no_issue_identified', 'not_applicable', 'unverified'].includes(String(outcome))) return current;
      const hasEvidenceArray = Array.isArray(item.evidence);
      const rawEvidence = hasEvidenceArray ? item.evidence as unknown[] : [];
      const refs = rawEvidence.map(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
        const ref = candidate as Record<string, unknown>;
        const valid = knownRefs.get(`${String(ref.artifactId)}:${String(ref.filePath)}:${String(ref.lineNumber)}:${ref.sourceVersion == null ? '' : String(ref.sourceVersion)}`);
        return valid ?? null;
      }).filter((ref): ref is AnalysisEvidenceReference => ref !== null);
      const summary = safeSummary(item.summary);
      const explicitUnverified = item.status === 'unverified' && outcome === 'unverified';
      if (explicitUnverified) {
        const invalidEvidence = (item.evidence != null && !hasEvidenceArray) || refs.length !== rawEvidence.length;
        const includesPrivateReasoningLabel = /\b(?:chain[\s._-]*of[\s._-]*thought|private[\s._-]+reasoning|internal[\s._-]+analysis)\b/i.test(summary);
        const safeUnverifiedSummary = includesPrivateReasoningLabel
          ? 'The provider summary was not retained; coverage remains unverified.'
          : summary || 'No usable public summary was provided; coverage remains unverified.';
        return {
          domain: current.domain,
          status: 'unverified',
          outcome: 'unverified',
          summary: invalidEvidence
            ? 'Assessment evidence did not map to this feature’s frozen source references; coverage remains unverified.'
            : safeUnverifiedSummary,
          evidence: refs.slice(0, 8),
        };
      }
      const status = item.status === 'assessed' && outcome !== 'unverified' && refs.length > 0 && Array.isArray(item.evidence) && refs.length === item.evidence.length && summary ? 'assessed' : 'unverified';
      const finalOutcome = status === 'assessed' ? outcome as FeatureAnalysisAssessment['outcome'] : 'unverified';
      return { domain: current.domain, status, outcome: finalOutcome, summary: status === 'assessed' ? summary : 'Assessment evidence did not map to this feature’s frozen source references; coverage remains unverified.', evidence: status === 'assessed' ? refs.slice(0, 8) : [] };
    });
    return { ...feature, assessments: normalized };
  });
  const complete = features.length > 0 && !map.coverage.featureInventoryTruncated
    && features.every(feature => feature.assessments.every(item => item.status === 'assessed'));
  const hasAssessed = features.some(feature => feature.assessments.some(item => item.status === 'assessed'));
  return { ...map, status: complete ? 'assessed' : hasAssessed ? 'partial' : 'unverified', features };
}

export function linkFindingToAnalysis(finding: Record<string, unknown>, map: ReviewAnalysisMap): Record<string, unknown> {
  const locator = finding.sourceLocator && typeof finding.sourceLocator === 'object' && !Array.isArray(finding.sourceLocator)
    ? { ...(finding.sourceLocator as Record<string, unknown>) } : {};
  const link = locator.analysis && typeof locator.analysis === 'object' && !Array.isArray(locator.analysis)
    ? locator.analysis as Record<string, unknown> : null;
  delete locator.analysis;
  if (!link || typeof link.featureId !== 'string' || typeof link.pathId !== 'string' || !isDomain(link.domain)) return { ...finding, sourceLocator: locator };
  const feature = map.features.find(item => item.id === link.featureId);
  const path = feature?.paths.find(item => item.id === link.pathId);
  const assessment = feature?.assessments.find(item => item.domain === link.domain && item.status === 'assessed');
  if (!feature || !path || !assessment || !path.evidence.some(ref => ref.artifactId === finding.artifactId && ref.filePath === finding.filePath && ref.lineNumber === finding.lineNumber)) return { ...finding, sourceLocator: locator };
  return { ...finding, sourceLocator: { ...locator, analysis: { featureId: feature.id, pathId: path.id, domain: link.domain } } };
}

export function reviewAnalysisMapForAudit(map: ReviewAnalysisMap): ReviewAnalysisMap {
  // The map contains source locations and short model summaries only. Source
  // text, prompts, raw provider output, secrets, and private reasoning are
  // intentionally excluded from this persisted audit payload.
  return structuredClone(map);
}

