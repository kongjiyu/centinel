import crypto from 'node:crypto';
import ts from 'typescript';
import type { Artifact } from '../artifacts.js';
import type { EvidenceArtifact } from './evidenceSufficiency.js';
import { DEFAULT_EXPORT_EXPRESSION, SelectedModuleResolver } from './selectedModuleResolver.js';

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
  entryPointStatus?: 'resolved' | 'unresolved';
  entryPoints: AnalysisEvidenceReference[];
  paths: FeatureAnalysisPath[];
  assessments: FeatureAnalysisAssessment[];
  unresolved: Array<{ reason: string; evidence: AnalysisEvidenceReference[] }>;
};
export type ReviewAnalysisMap = {
  schemaVersion: 1;
  status: 'unverified' | 'partial' | 'assessed';
  coverage: {
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
    unsupportedArtifacts: Array<{ artifactId: string; filePath: string; reason: string; parserExclusion?: 'configuration' }>;
    unsupportedExecutableArtifacts?: number;
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
const MAX_FEATURE_INVENTORY = 1_000;
const MAX_PATHS_PER_FEATURE = 12;
const MAX_UNRESOLVED_PER_FEATURE = 12;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
const UI_EVENTS = new Set(['onClick', 'onSubmit', 'onChange', 'onKeyDown', 'onBlur']);

type ParsedArtifact = { artifact: Artifact; source: ts.SourceFile };
type FunctionEntry = { name: string; node: ts.FunctionLikeDeclaration; artifact: Artifact; source: ts.SourceFile };
type FeatureDraft = {
  label: string;
  refs: AnalysisEvidenceReference[];
  handler?: FunctionEntry;
  key: string;
  middleware?: boolean;
  unresolvedReason?: string;
  initializationLabel?: string;
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
  const operationKey = (node: ts.Node, name: string, kind = 'export') => `${parsed.artifact.id}|${kind}|${sourceLine(source, node)}|${name}`;
  const keyForNode = (node: ts.Node, name: string, kind = 'export') => {
    const owner = parsedBySource.get(node.getSourceFile());
    return `${owner?.artifact.id ?? parsed.artifact.id}|${kind}|${owner ? sourceLine(owner.source, node) : sourceLine(source, node)}|${name}`;
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
        `${parsed.artifact.id}|selected-export|${sourceLine(source, evidenceNode)}|${publicName}|${target.artifact.id}`);
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
        `${parsed.artifact.id}|selected-export|${sourceLine(source, evidenceNode)}|${publicName}|${target.artifact.id}`);
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
            `${parsed.artifact.id}|selected-export|${sourceLine(source, evidenceNode)}|${childName}|${target.artifact.id}`);
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
            `${parsed.artifact.id}|selected-factory|${sourceLine(source, evidenceNode)}|${publicName}|${target.artifact.id}`);
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
            sink(label, callback, parent, `${parsed.artifact.id}|callback|${sourceLine(source, parent)}|${registration}|${callback.name}`);
            exportedNodes.add(callback.node);
          }
        } else if (parent && ts.isCallExpression(parent) && parent.expression === callbackNode) {
          const immediatelyInvoked = functionByNode.get(node);
          if (immediatelyInvoked && !exportedNodes.has(immediatelyInvoked.node)) {
            sink(`Internal operation ${immediatelyInvoked.name} called by ${caller.name}`, immediatelyInvoked, parent,
              `${parsed.artifact.id}|iife|${sourceLine(source, parent)}|${caller.name}|${immediatelyInvoked.name}`);
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
          sink(label, callee, node, `${parsed.artifact.id}|reachable|${sourceLine(source, node)}|${caller.name}|${callee.name}`);
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

function directHandler(call: ts.CallExpression, functions: FunctionEntry[]): FunctionEntry | undefined {
  const last = call.arguments.at(-1);
  if (!last) return undefined;
  if (ts.isArrowFunction(last) || ts.isFunctionExpression(last)) return functions.find(item => item.node === last);
  if (!ts.isIdentifier(last)) return undefined;
  const candidates = functions.filter(item => item.source === call.getSourceFile() && item.name === last.text);
  return candidates.length === 1 ? candidates[0] : undefined;
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
 * Extracts an intentionally bounded, syntax-backed map from frozen JavaScript
 * and TypeScript artifacts. It does not claim whole-program reachability or
 * enumerate dynamic, interprocedural, deployment, or runtime behavior.
 */
export function deriveReviewAnalysisMap(evidence: EvidenceArtifact[]): ReviewAnalysisMap {
  const supported: ParsedArtifact[] = [];
  const unsupportedArtifacts: ReviewAnalysisMap['coverage']['unsupportedArtifacts'] = [];
  const sourceArtifacts = evidence.filter(item => item.artifact.type === 'source_code' || SUPPORTED_EXTENSIONS.has(extension(item.artifact.fileName)) || CONFIG_EXTENSIONS.has(extension(item.artifact.fileName)));

  for (const item of sourceArtifacts) {
    const ext = extension(item.artifact.fileName);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath,
        ...(CONFIG_EXTENSIONS.has(ext) ? { parserExclusion: 'configuration' as const } : {}),
        reason: CONFIG_EXTENSIONS.has(ext) ? 'Configuration or markup is outside the executable JavaScript/TypeScript control-flow parser.' : 'Language or file format is not supported by the bounded JavaScript/TypeScript control-flow parser.' });
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
  const drafts: FeatureDraft[] = [];
  const seenDraftKeys = new Set<string>();
  let omittedEntryPoints = 0;
  const addDraft = (label: string, entry: FunctionEntry | undefined, refs: AnalysisEvidenceReference[], key: string,
    unresolvedReason?: string, initializationLabel?: string) => {
    if (!refs.length) return;
    if (seenDraftKeys.has(key)) return;
    seenDraftKeys.add(key);
    if (drafts.length >= MAX_FEATURE_INVENTORY) { omittedEntryPoints++; return; }
    drafts.push({ label: safeSummary(label), handler: entry, refs: refs.slice(0, 4), key, unresolvedReason, initializationLabel });
  };

  for (const parsed of supported) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression.getText(parsed.source) : '';
        if (name && HTTP_METHODS.has(name.toLowerCase()) && /(?:^|\.)(?:app|router|server)$/i.test(receiver)) {
          const staticRoute = staticText(node.arguments[0]);
          const routeLabel = `${name.toUpperCase()} ${staticRoute ?? '[dynamic route]'}`;
          const handler = directHandler(node, functions);
          const refs = [refFor(parsed.artifact, parsed.source, node), ...(handler ? [refFor(handler.artifact, handler.source, handler.node)] : [])];
          addDraft(`Route ${routeLabel}`, handler, refs, `${parsed.artifact.id}|route|${sourceLine(parsed.source, node)}|${routeLabel}`);
          const routeDraft = drafts.find(item => item.key === `${parsed.artifact.id}|route|${sourceLine(parsed.source, node)}|${routeLabel}`);
          if (routeDraft && node.arguments.length > 2) routeDraft.middleware = true;
          if (!staticRoute) {
            const current = drafts.find(item => item.key === `${parsed.artifact.id}|route|${sourceLine(parsed.source, node)}|${routeLabel}`);
            if (current) current.refs.push(refFor(parsed.artifact, parsed.source, node));
          }
        }
      } else if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name) && UI_EVENTS.has(node.name.text)) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !isFunctionLike(parent)) parent = parent.parent;
        const owner = (parent ? functionByNode.get(parent)?.name : undefined) ?? 'component';
        const expression = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
        const entry = expression && isFunctionLike(expression) ? functionByNode.get(expression)
          : expression && ts.isIdentifier(expression) ? functions.find(item => item.source === parsed.source && item.name === expression.text) : undefined;
        addDraft(`UI ${node.name.text} flow in ${owner}`, entry, [refFor(parsed.artifact, parsed.source, node), ...(entry ? [refFor(entry.artifact, entry.source, entry.node)] : [])], `${parsed.artifact.id}|ui|${sourceLine(parsed.source, node)}|${node.name.text}`);
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

  const truncatedFeatures = omittedEntryPoints;

  const features: ReviewAnalysisFeature[] = drafts.map(draft => {
    const id = `feature-${digest(draft.key)}`;
    const feature: ReviewAnalysisFeature = { id, label: draft.label, provisional: true,
      entryPointStatus: draft.handler || draft.initializationLabel ? 'resolved' : 'unresolved', entryPoints: draft.refs, paths: [], assessments: freshAssessments(), unresolved: [] };
    if (draft.middleware) feature.unresolved.push({ reason: 'Middleware order, early exits and guards before this handler are not expanded by this local map.', evidence: draft.refs.slice(0, 1) });
    if (draft.handler) branchPaths(feature, draft.handler, functions);
    else if (draft.initializationLabel) {
      addPath(feature, 'normal', draft.initializationLabel, draft.refs.slice(0, 1));
      feature.unresolved.push({ reason: draft.unresolvedReason ?? 'The module initialization is identified, but its returned runtime surface remains unresolved.', evidence: draft.refs.slice(0, 1) });
    }
    else {
      addPath(feature, 'normal', 'The entry point is present, but its handler body was not resolved.', draft.refs.slice(0, 1));
      feature.unresolved.push({ reason: draft.unresolvedReason ?? 'The handler body is unresolved, so normal, alternate, failure, and recovery outcomes remain unverified.', evidence: draft.refs.slice(0, 1) });
    }
    return feature;
  });

  const unresolvedEdgeCount = features.reduce((sum, feature) => sum + feature.unresolved.length, 0);
  const limitations = [
    'This is bounded syntax extraction for JavaScript and TypeScript artifacts only; it is not a complete control-flow or security proof.',
    'Features inferred from route names, exports, and UI event handlers are provisional until confirmed against requirements or design evidence.',
    'Inter-function, framework, dynamic dispatch, unselected dependencies, asynchronous, background-job, deployment, and runtime paths may be incomplete.',
  ];
  if (declarationClassifications.length) limitations.push(`${declarationClassifications.length} declaration-only artifact${declarationClassifications.length === 1 ? ' was' : 's were'} retained for full source sweeps; signatures do not create executable operations or absence-resolution proof.`);
  if (nonExecutableClassifications.length) limitations.push(`${nonExecutableClassifications.length} statically literal or inert artifact${nonExecutableClassifications.length === 1 ? ' was' : 's were'} retained for full source sweeps; these inputs do not create executable operations or absence-resolution proof.`);
  if (unsupportedArtifactCount > 0) limitations.push(`${unsupportedArtifactCount} source or configuration artifact${unsupportedArtifactCount === 1 ? ' was' : 's were'} outside the supported parser and remain unverified.`);
  if (unsupportedArtifacts.length > 100) limitations.push(`${unsupportedArtifacts.length - 100} additional unsupported artifacts were omitted from the map listing; all remain unverified.`);
  if (resolvedModuleEdgeCount || unresolvedModuleEdgeCount) limitations.push(`Selected-source module resolution mapped ${resolvedModuleEdgeCount} named edge${resolvedModuleEdgeCount === 1 ? '' : 's'} and left ${unresolvedModuleEdgeCount} edge${unresolvedModuleEdgeCount === 1 ? '' : 's'} unresolved; only frozen selected sources were considered.`);
  const selectedModuleGraphWork = resolver.graphWork;
  if (selectedModuleGraphWork.truncated) limitations.push(`Selected-source module resolution stopped at its explicit ${selectedModuleGraphWork.limit}-step work or depth bound; remaining graph scope stays unresolved.`);
  if (exportExpansionTruncatedCount) limitations.push(`${exportExpansionTruncatedCount} artifact export expansion${exportExpansionTruncatedCount === 1 ? ' reached' : 's reached'} its explicit ${MAX_EXPORT_EXPANSION_WORK}-step or ${MAX_EXPORT_EXPANSION_DEPTH}-level safety bound; omitted operation scope remains unresolved.`);
  if (truncatedFeatures > 0) limitations.push(`${truncatedFeatures} additional recognized entry point${truncatedFeatures === 1 ? ' was' : 's were'} omitted after the deterministic ${MAX_FEATURE_INVENTORY}-feature inventory safety limit; omitted scope remains unverified.`);
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

