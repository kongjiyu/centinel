import crypto from 'node:crypto';
import ts from 'typescript';
import type { Artifact } from '../artifacts.js';
import type { EvidenceArtifact } from './evidenceSufficiency.js';

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
    unsupportedArtifacts: Array<{ artifactId: string; filePath: string; reason: string }>;
    unresolvedEdgeCount: number;
    exhaustive: false;
    limitations: string[];
  };
  features: ReviewAnalysisFeature[];
};

const DOMAINS: ReviewDomain[] = ['security', 'business', 'technical', 'personnel'];
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.html', '.css']);
const MAX_FEATURES = 30;
const MAX_PATHS_PER_FEATURE = 12;
const MAX_UNRESOLVED_PER_FEATURE = 12;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
const UI_EVENTS = new Set(['onClick', 'onSubmit', 'onChange', 'onKeyDown', 'onBlur']);

type ParsedArtifact = { artifact: Artifact; source: ts.SourceFile };
type FunctionEntry = { name: string; node: ts.FunctionLikeDeclaration; artifact: Artifact; source: ts.SourceFile; exported: boolean };
type FeatureDraft = { label: string; refs: AnalysisEvidenceReference[]; handler?: FunctionEntry; key: string; middleware?: boolean };

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
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) && node.name) return node.name.getText();
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if (node.parent && ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
  return undefined;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node) || ts.isMethodSignature(node);
}

function isExported(node: ts.Node): boolean {
  const hasModifier = (modifiers: readonly ts.ModifierLike[] | undefined) => !!modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword || item.kind === ts.SyntaxKind.DefaultKeyword);
  if (hasModifier(ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)) return true;
  let parent = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isVariableStatement(parent)) return hasModifier(ts.getModifiers(parent));
    parent = parent.parent;
  }
  return false;
}

function collectFunctions(parsed: ParsedArtifact[]): FunctionEntry[] {
  const output: FunctionEntry[] = [];
  for (const item of parsed) {
    const visit = (node: ts.Node) => {
      if (isFunctionLike(node)) {
        const name = functionName(node) ?? `<anonymous@${sourceLine(item.source, node)}>`;
        if (node.body) output.push({ name, node, artifact: item.artifact, source: item.source, exported: isExported(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(item.source);
  }
  return output;
}

function staticText(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
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
      unsupportedArtifacts.push({ artifactId: item.artifact.id, filePath: item.artifact.filePath, reason: CONFIG_EXTENSIONS.has(ext) ? 'Configuration or markup is outside the executable JavaScript/TypeScript control-flow parser.' : 'Language or file format is not supported by the bounded JavaScript/TypeScript control-flow parser.' });
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

  const functions = collectFunctions(supported);
  const functionByNode = new Map(functions.map(item => [item.node, item]));
  const drafts: FeatureDraft[] = [];
  let omittedEntryPoints = 0;
  const addDraft = (label: string, entry: FunctionEntry | undefined, refs: AnalysisEvidenceReference[], key: string) => {
    if (!refs.length) return;
    if (drafts.some(item => item.key === key)) return;
    if (drafts.length >= MAX_FEATURES) { omittedEntryPoints++; return; }
    drafts.push({ label: safeSummary(label), handler: entry, refs: refs.slice(0, 4), key });
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

  for (const entry of functions.filter(item => item.exported)) {
    addDraft(`Exported operation ${entry.name}`, entry, [refFor(entry.artifact, entry.source, entry.node)], `${entry.artifact.id}|export|${sourceLine(entry.source, entry.node)}|${entry.name}`);
  }

  const truncatedFeatures = omittedEntryPoints;

  const features: ReviewAnalysisFeature[] = drafts.map(draft => {
    const id = `feature-${digest(draft.key)}`;
    const feature: ReviewAnalysisFeature = { id, label: draft.label, provisional: true, entryPoints: draft.refs, paths: [], assessments: freshAssessments(), unresolved: [] };
    if (draft.middleware) feature.unresolved.push({ reason: 'Middleware order, early exits and guards before this handler are not expanded by this local map.', evidence: draft.refs.slice(0, 1) });
    if (draft.handler) branchPaths(feature, draft.handler, functions);
    else {
      addPath(feature, 'normal', 'The entry point is present, but its handler body was not resolved.', draft.refs.slice(0, 1));
      feature.unresolved.push({ reason: 'The handler body is unresolved, so normal, alternate, failure, and recovery outcomes remain unverified.', evidence: draft.refs.slice(0, 1) });
    }
    return feature;
  });

  const unresolvedEdgeCount = features.reduce((sum, feature) => sum + feature.unresolved.length, 0);
  const limitations = [
    'This is bounded syntax extraction for JavaScript and TypeScript artifacts only; it is not a complete control-flow or security proof.',
    'Features inferred from route names, exports, and UI event handlers are provisional until confirmed against requirements or design evidence.',
    'Inter-function, framework, dynamic dispatch, imported dependency, asynchronous, background-job, deployment, and runtime paths may be incomplete.',
  ];
  if (unsupportedArtifacts.length) limitations.push(`${unsupportedArtifacts.length} source or configuration artifact${unsupportedArtifacts.length === 1 ? ' was' : 's were'} outside the supported parser and remain unverified.`);
  if (truncatedFeatures > 0) limitations.push(`${truncatedFeatures} additional recognized entry point${truncatedFeatures === 1 ? ' was' : 's were'} omitted because the bounded feature limit was reached.`);
  if (!features.length) limitations.push('No statically recognizable route, exported operation, or selected UI event entry point was found. Feature scope remains unresolved.');

  return {
    schemaVersion: 1,
    status: 'unverified',
    coverage: { sourceArtifacts: sourceArtifacts.length, parsedArtifacts: supported.length, unsupportedArtifacts: unsupportedArtifacts.slice(0, 100), unresolvedEdgeCount, exhaustive: false, limitations },
    features,
  };
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
      const refs = Array.isArray(item.evidence) ? item.evidence.map(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
        const ref = candidate as Record<string, unknown>;
        const valid = knownRefs.get(`${String(ref.artifactId)}:${String(ref.filePath)}:${String(ref.lineNumber)}:${ref.sourceVersion == null ? '' : String(ref.sourceVersion)}`);
        return valid ?? null;
      }).filter((ref): ref is AnalysisEvidenceReference => ref !== null) : [];
      const summary = safeSummary(item.summary);
      const status = item.status === 'assessed' && outcome !== 'unverified' && refs.length > 0 && Array.isArray(item.evidence) && refs.length === item.evidence.length && summary ? 'assessed' : 'unverified';
      const finalOutcome = status === 'assessed' ? outcome as FeatureAnalysisAssessment['outcome'] : 'unverified';
      return { domain: current.domain, status, outcome: finalOutcome, summary: status === 'assessed' ? summary : 'Assessment evidence did not map to this feature’s frozen source references; coverage remains unverified.', evidence: status === 'assessed' ? refs.slice(0, 8) : [] };
    });
    return { ...feature, assessments: normalized };
  });
  const complete = features.length > 0 && features.every(feature => feature.assessments.every(item => item.status === 'assessed'));
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

